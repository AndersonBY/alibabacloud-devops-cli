import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { Command } from "commander";
import { parsePositiveIntegerOption } from "../core/utils/options.js";
import { loadConfig } from "../core/config/store.js";
import { withApiClient, YunxiaoApiClient } from "../core/api/client.js";
import { listCheckRuns } from "../core/api/check-run.js";
import { listCommitStatuses } from "../core/api/commit-status.js";
import {
  closeChangeRequest,
  createChangeRequestComment,
  createChangeRequest,
  deleteChangeRequestComment,
  getMergeRequestChangeTree,
  getRepositoryCompare,
  getChangeRequest,
  listChangeRequestComments,
  listChangeRequestPatchSets,
  listChangeRequests,
  markChangeRequestReady,
  mergeChangeRequest,
  reviewMergeRequest,
  reopenChangeRequest,
  updateChangeRequestComment,
  updateChangeRequestCommentResolved,
  updateChangeRequest,
  updateChangeRequestPersonnel,
} from "../core/api/pr.js";
import { getRepository, listRepositoryBranches } from "../core/api/repo.js";
import { printData } from "../core/output/print.js";
import { resolveOrganizationId, resolveRepositoryId } from "../core/utils/context.js";
import { CliError } from "../core/errors.js";
import { resolveUserSelector } from "../core/utils/user.js";
import { openInBrowser } from "../core/utils/browser.js";
import { resolvePullRequestWebUrl, resolveRepositoryWebUrl } from "../core/utils/web-url.js";

export function registerPrCommand(program: Command): void {
  const pr = program.command("pr").description("Change request (merge request) commands");

  pr
    .command("list")
    .description("List change requests")
    .option("--org <organizationId>", "Organization ID")
    .option("--repo <projectIds>", "Repository IDs/paths, comma-separated")
    .option("--author-ids <ids>", "Author user IDs, comma-separated")
    .option("--reviewer-ids <ids>", "Reviewer user IDs, comma-separated")
    .option("--state <state>", "opened | merged | closed")
    .option("--search <keyword>", "Search in title")
    .option("--page <number>", "Page number", parsePositiveIntegerOption)
    .option("--per-page <number>", "Items per page", parsePositiveIntegerOption)
    .option("--order-by <field>", "created_at | updated_at", "updated_at")
    .option("--sort <direction>", "asc | desc", "desc")
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write list output to file")
    .option("--json", "Print raw JSON")
    .action(async (options: PrListOptions) => {
      const config = loadConfig();
      const organizationId = resolveOrganizationId(config, options.org);
      const outputFormat = normalizePrListOutputFormat(options.format, options.json);

      const payload = {
        organizationId,
        projectIds: options.repo,
        authorIds: options.authorIds,
        reviewerIds: options.reviewerIds,
        state: options.state,
        search: options.search,
        page: options.page,
        perPage: options.perPage,
        orderBy: options.orderBy,
        sort: options.sort,
      };

      const result = await withApiClient(config, (client) => listChangeRequests(client, payload));

      if (options.out) {
        await writePrListOutputFile(options.out, formatPrListOutput(result, outputFormat));
        process.stdout.write(`Saved pull request list output to ${options.out}.\n`);
        return;
      }

      if (outputFormat === "tsv") {
        process.stdout.write(`${formatPrListTsv(result)}\n`);
        return;
      }

      printData(result, {
        format: outputFormat === "json" ? "json" : "table",
      });
    });

  pr
    .command("view")
    .description("View one change request")
    .argument("<repositoryId>", "Repository ID")
    .argument("<localId>", "Change request local ID")
    .option("--org <organizationId>", "Organization ID")
    .option("--comments", "Include PR comments in result", false)
    .option("--comments-state <state>", "opened | draft | all", "opened")
    .option("--comments-limit <number>", "Maximum comments to include", parsePositiveIntegerOption, 200)
    .option("--web", "Open pull request in browser", false)
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write pull request output to file")
    .option("--json", "Print raw JSON")
    .action(async (repositoryId: string, localId: string, options: PrViewOptions) => {
      const config = loadConfig();
      const organizationId = resolveOrganizationId(config, options.org);
      const outputFormat = normalizePrViewOutputFormat(options.format, options.json);

      const result = await withApiClient(config, async (client) => {
        const detail = await getChangeRequest(client, {
          organizationId,
          repositoryId,
          localId,
        });
        let payload: unknown = detail;
        if (!options.comments) {
          if (options.web) {
            const url = await resolvePrViewWebUrl(client, {
              organizationId,
              repositoryId,
              localId,
              detail,
            });
            return {
              payload,
              webUrl: url,
            };
          }
          return payload;
        }

        const commentRequests = resolveCommentFilter({
          type: "all",
          state: normalizeCommentsState(options.commentsState),
        });
        const allComments: Record<string, unknown>[] = [];
        for (const request of commentRequests) {
          const comments = await listChangeRequestComments(client, {
            organizationId,
            repositoryId,
            localId,
            commentType: request.commentType,
            state: request.state,
            resolved: false,
          });
          allComments.push(...extractRecords(comments));
        }
        const deduped = dedupeRecords(allComments).slice(0, Math.max(1, options.commentsLimit ?? 200));

        if (!isRecord(detail)) {
          payload = {
            detail,
            comments: deduped,
          };
          if (options.web) {
            const url = await resolvePrViewWebUrl(client, {
              organizationId,
              repositoryId,
              localId,
              detail,
            });
            return {
              payload,
              webUrl: url,
            };
          }
          return payload;
        }

        payload = {
          ...detail,
          comments: deduped,
        };

        if (options.web) {
          const url = await resolvePrViewWebUrl(client, {
            organizationId,
            repositoryId,
            localId,
            detail,
          });
          return {
            payload,
            webUrl: url,
          };
        }

        return payload;
      });

      let output: unknown = isRecord(result) && "payload" in result ? (result.payload as unknown) : result;
      if (options.web && outputFormat !== "json") {
        if (!isRecord(result)) {
          throw new CliError("Unexpected pull request response for --web mode.");
        }

        const webUrl = typeof result.webUrl === "string" ? result.webUrl : undefined;
        if (!webUrl) {
          throw new CliError("Cannot resolve pull request web URL from API response.");
        }

        openInBrowser(webUrl);
        output = {
          repositoryId,
          localId,
          url: webUrl,
          opened: true,
        };
      }

      if (options.out) {
        await writePrViewOutputFile(options.out, formatPrViewOutput(output, outputFormat));
        process.stdout.write(`Saved pull request output to ${options.out}.\n`);
        return;
      }

      if (outputFormat === "tsv") {
        process.stdout.write(`${formatPrViewTsv(output)}\n`);
        return;
      }

      printData(output, {
        format: outputFormat === "json" ? "json" : "table",
      });
    });

  pr
    .command("create")
    .description("Create a change request")
    .option("--repo <repositoryId>", "Repository ID")
    .requiredOption("--title <title>", "Title")
    .requiredOption("--source <branch>", "Source branch")
    .requiredOption("--target <branch>", "Target branch")
    .option("--org <organizationId>", "Organization ID")
    .option("--description <text>", "Description")
    .option("--reviewer <userId>", "Reviewer user ID, repeatable", collect, [])
    .option("--work-item <id>", "Work item ID, repeatable", collect, [])
    .option("--source-project-id <id>", "Optional source project ID")
    .option("--target-project-id <id>", "Optional target project ID")
    .option("--ai-review", "Trigger AI review run", false)
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write create output to file")
    .option("--json", "Print raw JSON")
    .action(async (options: PrCreateOptions) => {
      const config = loadConfig();
      const organizationId = resolveOrganizationId(config, options.org);
      const repositoryId = resolveRepositoryId(config, options.repo);
      const outputFormat = normalizePrCreateOutputFormat(options.format, options.json);
      if (options.out && outputFormat === "table") {
        throw new CliError("`--out` requires --format tsv/json (or --json).");
      }

      const payload = {
        organizationId,
        repositoryId,
        title: options.title,
        sourceBranch: options.source,
        targetBranch: options.target,
        description: options.description,
        reviewerUserIds: options.reviewer?.length ? options.reviewer : undefined,
        workItemIds: options.workItem?.length ? options.workItem : undefined,
        triggerAIReviewRun: options.aiReview,
        sourceProjectId: options.sourceProjectId,
        targetProjectId: options.targetProjectId,
      };

      const result = await withApiClient(config, (client) => createChangeRequest(client, payload));

      if (options.out) {
        await writePrCreateOutputFile(options.out, formatPrCreateOutput(result, outputFormat));
        process.stdout.write(`Saved pull request create output to ${options.out}.\n`);
        return;
      }

      if (outputFormat === "tsv") {
        process.stdout.write(`${formatPrCreateTsv(result)}\n`);
        return;
      }

      printData(result, {
        format: outputFormat === "json" ? "json" : "table",
      });
    });

  pr
    .command("edit")
    .description("Edit a pull request (gh-like)")
    .argument("<repositoryId>", "Repository ID")
    .argument("<localId>", "Change request local ID")
    .option("--org <organizationId>", "Organization ID")
    .option("--title <title>", "Pull request title")
    .option("-b, --body <text>", "Pull request body/description")
    .option("-F, --body-file <path>", "Read pull request body from file")
    .option("--description <text>", "Pull request description (alias of --body)")
    .option("--base <branch>", "Target branch (gh --base equivalent)")
    .option("--reviewer <userId>", "Set reviewer list, repeatable", collect, [])
    .option("--add-reviewer <userId>", "Add reviewer, repeatable", collect, [])
    .option("--remove-reviewer <userId>", "Remove reviewer, repeatable", collect, [])
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write edit output to file")
    .option("--json", "Print raw JSON")
    .action(async (repositoryId: string, localId: string, options: PrEditOptions) => {
      const config = loadConfig();
      const organizationId = resolveOrganizationId(config, options.org);
      const description = await resolvePrEditDescription(options);
      const outputFormat = normalizePrEditOutputFormat(options.format, options.json);

      const hasPrUpdate =
        options.title !== undefined ||
        description !== undefined ||
        options.base !== undefined;
      const hasSetReviewers = options.reviewer.length > 0;
      const hasDeltaReviewers = options.addReviewer.length > 0 || options.removeReviewer.length > 0;
      if (hasSetReviewers && hasDeltaReviewers) {
        throw new CliError("Do not combine --reviewer with --add-reviewer/--remove-reviewer in one command.");
      }
      const hasReviewerUpdate = hasSetReviewers || hasDeltaReviewers;

      if (!hasPrUpdate && !hasReviewerUpdate) {
        throw new CliError("No update fields provided. Use options like --title/--body/--base/--reviewer.");
      }

      const result = await withApiClient(config, async (client) => {
        const output: Record<string, unknown> = {};
        let targetReviewers: string[] | undefined;

        if (hasPrUpdate) {
          output.pullRequest = await updateChangeRequest(client, {
            organizationId,
            repositoryId,
            localId,
            title: options.title,
            description,
            targetBranch: options.base,
          });
        }

        if (hasReviewerUpdate) {
          if (hasSetReviewers) {
            targetReviewers = uniqueStrings(options.reviewer);
          } else {
            const detail = await getChangeRequest(client, {
              organizationId,
              repositoryId,
              localId,
            });
            if (!isRecord(detail)) {
              throw new CliError("Unexpected pull request detail response when updating reviewers.");
            }

            const existing = extractReviewers(detail)
              .map((item) => item.userId)
              .filter((item): item is string => Boolean(item));
            const next = new Set(existing);
            for (const userId of options.addReviewer) {
              next.add(userId);
            }
            for (const userId of options.removeReviewer) {
              next.delete(userId);
            }
            targetReviewers = Array.from(next);
          }

          output.reviewers = await updateChangeRequestPersonnel(client, {
            organizationId,
            repositoryId,
            localId,
            personType: "reviewer",
            userIds: targetReviewers,
          });
        }

        return output;
      });

      if (options.out) {
        await writePrEditOutputFile(options.out, formatPrEditOutput(result, outputFormat));
        process.stdout.write(`Saved pull request edit output to ${options.out}.\n`);
        return;
      }

      if (outputFormat === "tsv") {
        process.stdout.write(`${formatPrEditTsv(result)}\n`);
        return;
      }

      printData(result, {
        format: outputFormat === "json" ? "json" : "table",
      });
    });

  pr
    .command("status")
    .description("Show your pull request status (gh-like)")
    .option("--org <organizationId>", "Organization ID")
    .option("--repo <projectIds>", "Repository IDs/paths, comma-separated")
    .option("-L, --limit <number>", "Maximum PRs per bucket", parsePositiveIntegerOption, 20)
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write status output to file")
    .option("--json", "Print raw JSON")
    .action(async (options: PrStatusOptions) => {
      const config = loadConfig();
      const organizationId = resolveOrganizationId(config, options.org);
      const limit = Math.max(1, options.limit);
      const outputFormat = normalizePrStatusOutputFormat(options.format, options.json);

      const result: PrStatusResult = await withApiClient(config, async (client) => {
        const currentUserId = await resolveUserSelector(client, "self");
        if (!currentUserId) {
          throw new CliError("Cannot resolve current user ID for `pr status`.");
        }

        const [authoredOpen, reviewRequestedOpen] = await Promise.all([
          fetchPullRequestsWithLimit(client, {
            organizationId,
            projectIds: options.repo,
            state: "opened",
            authorIds: currentUserId,
            orderBy: "updated_at",
            sort: "desc",
            limit,
          }),
          fetchPullRequestsWithLimit(client, {
            organizationId,
            projectIds: options.repo,
            state: "opened",
            reviewerIds: currentUserId,
            orderBy: "updated_at",
            sort: "desc",
            limit,
          }),
        ]);

        return {
          currentUserId,
          authored: {
            openCount: authoredOpen.length,
            open: authoredOpen,
          },
          reviewRequested: {
            openCount: reviewRequestedOpen.length,
            open: reviewRequestedOpen,
          },
        };
      });

      if (options.out) {
        await writePrStatusOutputFile(options.out, formatPrStatusOutput(result, outputFormat));
        process.stdout.write(`Saved status output to ${options.out}.\n`);
        return;
      }

      if (outputFormat === "tsv") {
        process.stdout.write(`${formatPrStatusTsv(result)}\n`);
        return;
      }

      printData(result, {
        format: outputFormat === "json" ? "json" : "table",
      });
    });

  pr
    .command("checkout")
    .description("Check out a PR branch locally (gh-like)")
    .argument("<repositoryId>", "Repository ID")
    .argument("<localId>", "Change request local ID")
    .option("--org <organizationId>", "Organization ID")
    .option("--repo-dir <path>", "Local git repository path", ".")
    .option("--remote <name>", "Git remote name", "origin")
    .option("--branch <name>", "Local branch name (default: pr/<localId>)")
    .option("--detach", "Checkout detached HEAD", false)
    .option("--dry-run", "Print git commands without executing", false)
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write checkout output to file")
    .option("--json", "Print raw JSON")
    .action(async (repositoryId: string, localId: string, options: PrCheckoutOptions) => {
      const config = loadConfig();
      const organizationId = resolveOrganizationId(config, options.org);
      const outputFormat = normalizePrCheckoutOutputFormat(options.format, options.json);
      if (options.out && outputFormat === "table") {
        throw new CliError("`--out` requires --format tsv/json (or --json).");
      }

      const result = await withApiClient(config, async (client) => {
        const detail = await getChangeRequest(client, {
          organizationId,
          repositoryId,
          localId,
        });

        if (!isRecord(detail)) {
          throw new CliError("Unexpected PR detail response.");
        }

        const sourceBranch = readPrSourceBranch(detail);
        if (!sourceBranch) {
          throw new CliError("Cannot detect source branch from PR detail.");
        }

        const localBranch = options.branch ?? `pr/${localId}`;
        const commands = [
          ["git", "-C", options.repoDir, "fetch", options.remote, sourceBranch],
          options.detach
            ? ["git", "-C", options.repoDir, "checkout", "--detach", "FETCH_HEAD"]
            : ["git", "-C", options.repoDir, "checkout", "-B", localBranch, "FETCH_HEAD"],
        ];

        if (options.dryRun) {
          return {
            repositoryId,
            localId,
            sourceBranch,
            commands: commands.map((cmd) => cmd.join(" ")),
            executed: false,
          };
        }

        for (const command of commands) {
          runGitCommand(command.slice(1));
        }

        return {
          repositoryId,
          localId,
          sourceBranch,
          localBranch: options.detach ? "(detached)" : localBranch,
          executed: true,
        };
      });

      if (options.out) {
        await writePrCheckoutOutputFile(options.out, formatPrCheckoutOutput(result, outputFormat));
        process.stdout.write(`Saved checkout output to ${options.out}.\n`);
        return;
      }

      if (outputFormat === "tsv") {
        process.stdout.write(`${formatPrCheckoutTsv(result)}\n`);
        return;
      }

      printData(result, {
        format: outputFormat === "json" ? "json" : "table",
      });
    });

  pr
    .command("comment")
    .description("Add a pull request comment (gh-like)")
    .argument("<repositoryId>", "Repository ID")
    .argument("<localId>", "Change request local ID")
    .option("--org <organizationId>", "Organization ID")
    .option("-b, --body <text>", "Comment body")
    .option("-F, --body-file <path>", "Read comment body from file")
    .option("--inline", "Create inline comment on one file/line", false)
    .option("--file <path>", "Inline comment file path")
    .option("--line <number>", "Inline comment line number", parsePositiveIntegerOption)
    .option("--patchset <patchsetBizId>", "Patchset biz ID")
    .option("--from <patchsetBizId>", "Inline comment from patchset biz ID")
    .option("--to <patchsetBizId>", "Inline comment to patchset biz ID")
    .option("--reply-to <commentBizId>", "Reply to an existing comment biz ID")
    .option("--draft", "Create draft comment", false)
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write comment output to file")
    .option("--json", "Print raw JSON")
    .action(async (repositoryId: string, localId: string, options: PrCommentOptions) => {
      const config = loadConfig();
      const organizationId = resolveOrganizationId(config, options.org);
      const outputFormat = normalizePrCommentWriteOutputFormat(options.format, options.json);
      if (options.out && outputFormat === "table") {
        throw new CliError("`--out` requires --format tsv/json (or --json).");
      }
      const content = await resolvePrCommentBody(options);
      if (!content) {
        throw new CliError("Missing comment body. Use --body <text> or --body-file <path>.");
      }
      if (options.inline && options.patchset) {
        throw new CliError("Do not combine --inline with --patchset. Use --from/--to for inline comments.");
      }

      const result = await withApiClient(config, async (client) => {
        if (options.inline) {
          if (!options.file) {
            throw new CliError("Missing inline file path. Use --file <path> with --inline.");
          }
          if (!options.line || options.line <= 0) {
            throw new CliError("Missing inline line number. Use --line <number> with --inline.");
          }

          const context = await resolvePatchsetDiffContext(client, {
            organizationId,
            repositoryId,
            localId,
            from: options.from,
            to: options.to,
          });
          if (!context.range.fromPatchSetBizId || !context.range.toPatchSetBizId) {
            throw new CliError("Cannot resolve inline patchset range. Pass --from and --to explicitly.");
          }

          return createChangeRequestComment(client, {
            organizationId,
            repositoryId,
            localId,
            content,
            draft: options.draft,
            patchsetBizId: context.range.toPatchSetBizId,
            commentType: "INLINE_COMMENT",
            filePath: options.file,
            lineNumber: options.line,
            fromPatchsetBizId: context.range.fromPatchSetBizId,
            toPatchsetBizId: context.range.toPatchSetBizId,
            parentCommentBizId: options.replyTo,
          });
        }

        const patchsetBizId =
          options.patchset ??
          (await resolveLatestPatchsetBizId(client, {
            organizationId,
            repositoryId,
            localId,
          }));
        if (!patchsetBizId) {
          throw new CliError("Cannot resolve patchset biz ID. Pass --patchset <patchsetBizId> explicitly.");
        }
        return createChangeRequestComment(client, {
          organizationId,
          repositoryId,
          localId,
          content,
          draft: options.draft,
          patchsetBizId,
          parentCommentBizId: options.replyTo,
        });
      });

      if (options.out) {
        await writePrCommentWriteOutputFile(options.out, formatPrCommentWriteOutput(result, outputFormat));
        process.stdout.write(`Saved comment output to ${options.out}.\n`);
        return;
      }

      if (outputFormat === "tsv") {
        process.stdout.write(`${formatPrCommentWriteTsv(result)}\n`);
        return;
      }

      printData(result, {
        format: outputFormat === "json" ? "json" : "table",
      });
    });

  pr
    .command("comment-reply")
    .description("Reply to a pull request comment")
    .argument("<repositoryId>", "Repository ID")
    .argument("<localId>", "Change request local ID")
    .argument("<commentBizId>", "Parent comment biz ID")
    .option("--org <organizationId>", "Organization ID")
    .option("-b, --body <text>", "Reply body")
    .option("-F, --body-file <path>", "Read reply body from file")
    .option("--patchset <patchsetBizId>", "Patchset biz ID")
    .option("--draft", "Create draft comment", false)
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write comment reply output to file")
    .option("--json", "Print raw JSON")
    .action(
      async (repositoryId: string, localId: string, commentBizId: string, options: PrCommentReplyOptions) => {
        const config = loadConfig();
        const organizationId = resolveOrganizationId(config, options.org);
        const outputFormat = normalizePrCommentWriteOutputFormat(options.format, options.json);
        if (options.out && outputFormat === "table") {
          throw new CliError("`--out` requires --format tsv/json (or --json).");
        }
        const content = await resolvePrCommentBody(options);
        if (!content) {
          throw new CliError("Missing reply body. Use --body <text> or --body-file <path>.");
        }

        const result = await withApiClient(config, async (client) => {
          const patchsetBizId =
            options.patchset ??
            (await resolveLatestPatchsetBizId(client, {
              organizationId,
              repositoryId,
              localId,
            }));
          if (!patchsetBizId) {
            throw new CliError("Cannot resolve patchset biz ID. Pass --patchset <patchsetBizId> explicitly.");
          }

          return createChangeRequestComment(client, {
            organizationId,
            repositoryId,
            localId,
            content,
            draft: options.draft,
            patchsetBizId,
            parentCommentBizId: commentBizId,
          });
        });

        if (options.out) {
          await writePrCommentWriteOutputFile(options.out, formatPrCommentWriteOutput(result, outputFormat));
          process.stdout.write(`Saved comment reply output to ${options.out}.\n`);
          return;
        }

        if (outputFormat === "tsv") {
          process.stdout.write(`${formatPrCommentWriteTsv(result)}\n`);
          return;
        }

        printData(result, {
          format: outputFormat === "json" ? "json" : "table",
        });
      }
    );

  pr
    .command("comment-edit")
    .description("Edit a pull request comment")
    .argument("<repositoryId>", "Repository ID")
    .argument("<localId>", "Change request local ID")
    .argument("<commentBizId>", "Comment biz ID")
    .option("--org <organizationId>", "Organization ID")
    .option("-b, --body <text>", "Comment body")
    .option("-F, --body-file <path>", "Read comment body from file")
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write comment edit output to file")
    .option("--json", "Print raw JSON")
    .action(async (repositoryId: string, localId: string, commentBizId: string, options: PrCommentEditOptions) => {
      const config = loadConfig();
      const organizationId = resolveOrganizationId(config, options.org);
      const outputFormat = normalizePrCommentWriteOutputFormat(options.format, options.json);
      if (options.out && outputFormat === "table") {
        throw new CliError("`--out` requires --format tsv/json (or --json).");
      }
      const content = await resolvePrCommentBody(options);
      if (!content) {
        throw new CliError("Missing comment body. Use --body <text> or --body-file <path>.");
      }

      const result = await withApiClient(config, (client) =>
        updateChangeRequestComment(client, {
          organizationId,
          repositoryId,
          localId,
          commentBizId,
          content,
        })
      );

      if (options.out) {
        await writePrCommentWriteOutputFile(options.out, formatPrCommentWriteOutput(result, outputFormat));
        process.stdout.write(`Saved comment edit output to ${options.out}.\n`);
        return;
      }

      if (outputFormat === "tsv") {
        process.stdout.write(`${formatPrCommentWriteTsv(result)}\n`);
        return;
      }

      printData(result, {
        format: outputFormat === "json" ? "json" : "table",
      });
    });

  pr
    .command("comment-delete")
    .description("Delete a pull request comment")
    .argument("<repositoryId>", "Repository ID")
    .argument("<localId>", "Change request local ID")
    .argument("<commentBizId>", "Comment biz ID")
    .option("--org <organizationId>", "Organization ID")
    .option("--yes", "Skip confirmation", false)
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write comment delete output to file")
    .option("--json", "Print raw JSON")
    .action(async (repositoryId: string, localId: string, commentBizId: string, options: PrCommentDeleteOptions) => {
      if (!options.yes) {
        throw new CliError("Refusing to delete pull request comment without confirmation. Re-run with `--yes`.");
      }

      const config = loadConfig();
      const organizationId = resolveOrganizationId(config, options.org);
      const outputFormat = normalizePrCommentWriteOutputFormat(options.format, options.json);
      if (options.out && outputFormat === "table") {
        throw new CliError("`--out` requires --format tsv/json (or --json).");
      }

      const result = await withApiClient(config, (client) =>
        deleteChangeRequestComment(client, {
          organizationId,
          repositoryId,
          localId,
          commentBizId,
        })
      );

      if (options.out) {
        await writePrCommentWriteOutputFile(options.out, formatPrCommentWriteOutput(result, outputFormat));
        process.stdout.write(`Saved comment delete output to ${options.out}.\n`);
        return;
      }

      if (outputFormat === "tsv") {
        process.stdout.write(`${formatPrCommentWriteTsv(result)}\n`);
        return;
      }

      printData(result, {
        format: outputFormat === "json" ? "json" : "table",
      });
    });

  pr
    .command("comment-resolve")
    .description("Resolve a pull request comment")
    .argument("<repositoryId>", "Repository ID")
    .argument("<localId>", "Change request local ID")
    .argument("<commentBizId>", "Comment biz ID")
    .option("--org <organizationId>", "Organization ID")
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write comment resolve output to file")
    .option("--json", "Print raw JSON")
    .action(
      async (repositoryId: string, localId: string, commentBizId: string, options: PrCommentResolveOptions) => {
        await handlePrCommentResolveToggle(repositoryId, localId, commentBizId, options, true);
      }
    );

  pr
    .command("comment-unresolve")
    .description("Reopen a resolved pull request comment")
    .argument("<repositoryId>", "Repository ID")
    .argument("<localId>", "Change request local ID")
    .argument("<commentBizId>", "Comment biz ID")
    .option("--org <organizationId>", "Organization ID")
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write comment unresolve output to file")
    .option("--json", "Print raw JSON")
    .action(
      async (repositoryId: string, localId: string, commentBizId: string, options: PrCommentResolveOptions) => {
        await handlePrCommentResolveToggle(repositoryId, localId, commentBizId, options, false);
      }
    );

  pr
    .command("comments")
    .description("List pull request comments (gh-like)")
    .argument("<repositoryId>", "Repository ID")
    .argument("<localId>", "Change request local ID")
    .option("--org <organizationId>", "Organization ID")
    .option("--type <type>", "all | global | inline", "all")
    .option("--state <state>", "opened | draft | all", "opened")
    .option("--file <path>", "Filter by file path (inline comments)")
    .option("--summary", "Print aggregated comment summary", false)
    .option("--resolved", "Only resolved comments", false)
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write comments output to file")
    .option("--json", "Print raw JSON")
    .action(async (repositoryId: string, localId: string, options: PrCommentsOptions) => {
      const config = loadConfig();
      const organizationId = resolveOrganizationId(config, options.org);
      const outputFormat = normalizePrCommentsOutputFormat(options.format, options.json);
      const summaryMode = options.summary === true;

      const result: PrCommentsSummary | Record<string, unknown>[] = await withApiClient(config, async (client) => {
        const requests = resolveCommentFilter(options);
        const items: Record<string, unknown>[] = [];
        for (const request of requests) {
          const response = await listChangeRequestComments(client, {
            organizationId,
            repositoryId,
            localId,
            commentType: request.commentType,
            state: request.state,
            resolved: options.resolved,
            filePath: options.file,
          });
          items.push(...extractRecords(response));
        }

        const comments = dedupeRecords(items);
        if (summaryMode) {
          return summarizePrComments(comments);
        }
        return comments;
      });

      if (options.out) {
        await writePrCommentsOutputFile(options.out, formatPrCommentsOutput(result, outputFormat, summaryMode));
        process.stdout.write(`Saved comments output to ${options.out}.\n`);
        return;
      }

      if (outputFormat === "tsv") {
        process.stdout.write(`${formatPrCommentsOutput(result, "tsv", summaryMode)}`);
        return;
      }

      printData(result, {
        format: outputFormat === "json" ? "json" : "table",
      });
    });

  pr
    .command("threads")
    .description("List pull request comment threads")
    .argument("<repositoryId>", "Repository ID")
    .argument("<localId>", "Change request local ID")
    .option("--org <organizationId>", "Organization ID")
    .option("--state <state>", "opened | draft | all", "opened")
    .option("--file <path>", "Filter threads by file path")
    .option("--author <nameOrUserId>", "Filter threads by author, repeatable", collect, [])
    .option("--mine", "Only include threads authored by current user", false)
    .option("--with-replies", "Only include threads with at least one reply", false)
    .option("--since <isoDatetime>", "Only include threads active since this ISO-8601 time")
    .option("--contains <keyword>", "Filter threads by comment content keyword, repeatable", collect, [])
    .option("--sort <order>", "latest | oldest", "latest")
    .option("--all", "Include resolved threads", false)
    .option("-L, --limit <number>", "Max threads to show", parsePositiveIntegerOption, 200)
    .option("--ids-only", "Only print compact thread identifiers", false)
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write threads output to file")
    .option("--summary", "Print aggregated thread summary", false)
    .option("--json", "Print raw JSON")
    .action(async (repositoryId: string, localId: string, options: PrThreadsOptions) => {
      const config = loadConfig();
      const organizationId = resolveOrganizationId(config, options.org);
      const state = normalizeCommentsState(options.state);
      const sort = normalizePrThreadsSort(options.sort);
      const outputFormat = normalizePrThreadsOutputFormat(options.format, options.json);

      const threads = await withApiClient(config, async (client) => {
        const requests = resolveCommentFilter({
          type: "all",
          state,
        });
        const resolvedOptions = options.all ? [false, true] : [false];
        const authors = [...options.author];
        if (options.mine) {
          const currentUserId = await resolveUserSelector(client, "self");
          if (!currentUserId) {
            throw new CliError("Cannot resolve current user ID for `pr threads --mine`.");
          }
          authors.push(currentUserId);
        }
        const items: Record<string, unknown>[] = [];

        for (const request of requests) {
          for (const resolved of resolvedOptions) {
            const response = await listChangeRequestComments(client, {
              organizationId,
              repositoryId,
              localId,
              commentType: request.commentType,
              state: request.state,
              resolved,
              filePath: options.file,
            });
            items.push(...extractRecords(response));
          }
        }

        const comments = dedupeRecords(items);
        return summarizePrCommentThreads(comments, {
          filePath: options.file,
          authors,
          withReplies: options.withReplies,
          since: options.since,
          contains: options.contains,
          sort,
        });
      });

      if (options.summary) {
        const summary = summarizePrCommentThreadsSummary(threads);
        if (options.out) {
          await writePrThreadsOutputFile(options.out, formatPrThreadsOutput(summary, outputFormat, true));
          process.stdout.write(`Saved threads output to ${options.out}.\n`);
          return;
        }
        if (outputFormat === "tsv") {
          renderPrThreadsSummaryTsv(summary);
          return;
        }
        printData(summary, {
          format: outputFormat === "json" ? "json" : "table",
        });
        return;
      }

      const slicedThreads = slicePrCommentThreads(threads, options.limit);
      const compact = compactPrCommentThreads(slicedThreads.items);
      if (options.idsOnly) {
        if (options.out) {
          await writePrThreadsOutputFile(options.out, formatPrThreadsOutput(compact, outputFormat, false));
          process.stdout.write(`Saved threads output to ${options.out}.\n`);
          if (slicedThreads.truncated) {
            process.stdout.write(
              `Showing first ${slicedThreads.items.length} of ${slicedThreads.total} threads. Use --limit to adjust.\n`
            );
          }
          return;
        }
        if (outputFormat === "tsv") {
          renderPrThreadsTsv(compact);
        } else {
          printData(compact, {
            format: outputFormat === "json" ? "json" : "table",
          });
        }
        if (!options.json && slicedThreads.truncated) {
          process.stdout.write(
            `\nShowing first ${slicedThreads.items.length} of ${slicedThreads.total} threads. Use --limit to adjust.\n`
          );
        }
        return;
      }

      if (options.out) {
        const payload = outputFormat === "tsv" ? compact : slicedThreads.items;
        await writePrThreadsOutputFile(options.out, formatPrThreadsOutput(payload, outputFormat, false));
        process.stdout.write(`Saved threads output to ${options.out}.\n`);
        if (slicedThreads.truncated) {
          process.stdout.write(
            `Showing first ${slicedThreads.items.length} of ${slicedThreads.total} threads. Use --limit to adjust.\n`
          );
        }
        return;
      }

      if (outputFormat === "tsv") {
        renderPrThreadsTsv(compact);
        if (!options.json && slicedThreads.truncated) {
          process.stdout.write(
            `\nShowing first ${slicedThreads.items.length} of ${slicedThreads.total} threads. Use --limit to adjust.\n`
          );
        }
        return;
      }

      if (outputFormat === "table") {
        renderPrCommentThreads(slicedThreads.items);
        if (slicedThreads.truncated) {
          process.stdout.write(
            `\nShowing first ${slicedThreads.items.length} of ${slicedThreads.total} threads. Use --limit to adjust.\n`
          );
        }
        return;
      }

      printData(slicedThreads.items, {
        format: "json",
      });
    });

  pr
    .command("patchsets")
    .description("List pull request patchsets (for diff range selection)")
    .argument("<repositoryId>", "Repository ID")
    .argument("<localId>", "Change request local ID")
    .option("--org <organizationId>", "Organization ID")
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write patchsets output to file")
    .option("--json", "Print raw JSON")
    .action(async (repositoryId: string, localId: string, options: PrPatchsetsOptions) => {
      const config = loadConfig();
      const organizationId = resolveOrganizationId(config, options.org);
      const outputFormat = normalizePrPatchsetsOutputFormat(options.format, options.json);

      const payload = await withApiClient(config, async (client) => {
        const response = await listChangeRequestPatchSets(client, {
          organizationId,
          repositoryId,
          localId,
        });

        const output = summarizePatchsets(response);
        return {
          table: output,
          json: {
            ...output,
            raw: response,
          },
        };
      });

      if (outputFormat === "json") {
        if (options.out) {
          await writePrPatchsetsOutputFile(options.out, `${JSON.stringify(payload.json, null, 2)}\n`);
          process.stdout.write(`Saved patchsets output to ${options.out}.\n`);
          return;
        }
        printData(payload.json, {
          format: "json",
        });
        return;
      }

      if (options.out) {
        await writePrPatchsetsOutputFile(options.out, formatPrPatchsetsOutput(payload.table, outputFormat));
        process.stdout.write(`Saved patchsets output to ${options.out}.\n`);
        return;
      }

      if (outputFormat === "tsv") {
        process.stdout.write(`${formatPrPatchsetsTsv(payload.table)}\n`);
        return;
      }

      printData(payload.table, {
        format: "table",
      });
    });

  pr
    .command("files")
    .description("List pull request changed files (gh-like)")
    .argument("<repositoryId>", "Repository ID")
    .argument("<localId>", "Change request local ID")
    .option("--org <organizationId>", "Organization ID")
    .option("--from <patchsetBizId>", "From patchset biz ID")
    .option("--to <patchsetBizId>", "To patchset biz ID")
    .option("--tree", "Print changed files as a path tree", false)
    .option("--stat", "Include file-level +/- statistics", false)
    .option("-L, --limit <number>", "Max files to show", parsePositiveIntegerOption, 200)
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write files output to file")
    .option("--json", "Print raw JSON")
    .action(async (repositoryId: string, localId: string, options: PrFilesOptions) => {
      const config = loadConfig();
      const organizationId = resolveOrganizationId(config, options.org);
      const outputFormat = normalizePrFilesOutputFormat(options.format, options.json);
      if (options.tree && options.stat) {
        throw new CliError("Do not combine --tree and --stat in one command.");
      }

      const snapshot = await withApiClient(config, (client) =>
        resolvePrDiffSnapshot(client, {
          organizationId,
          repositoryId,
          localId,
          fromPatchSetBizId: options.from,
          toPatchSetBizId: options.to,
          limit: options.limit,
        })
      );
      const mode: PrFilesRenderMode = options.tree ? "tree" : options.stat ? "stat" : "paths";
      const jsonPayload = {
        ...snapshot.summary,
        patchSets: snapshot.range,
        warning: snapshot.warning,
        raw: snapshot.raw,
      };

      if (outputFormat === "json") {
        if (options.out) {
          await writePrFilesOutputFile(options.out, `${JSON.stringify(jsonPayload, null, 2)}\n`);
          process.stdout.write(`Saved files output to ${options.out}.\n`);
          return;
        }
        printData(jsonPayload, {
          format: "json",
        });
        return;
      }

      if (snapshot.warning) {
        if (outputFormat === "table") {
          process.stdout.write(`Warning: ${snapshot.warning}\n`);
        } else {
          process.stderr.write(`Warning: ${snapshot.warning}\n`);
        }
      }

      if (options.out) {
        await writePrFilesOutputFile(options.out, formatPrFilesOutput(snapshot.summary, outputFormat, mode));
        process.stdout.write(`Saved files output to ${options.out}.\n`);
        return;
      }

      if (outputFormat === "tsv") {
        process.stdout.write(`${formatPrFilesTsv(snapshot.summary, mode)}\n`);
        return;
      }

      if (snapshot.summary.files.length === 0) {
        process.stdout.write("No file-level diff details available.\n");
        return;
      }

      const lines = formatPrFilesText(snapshot.summary, mode);
      process.stdout.write(`${lines.join("\n")}\n`);
      if (mode === "stat") {
        process.stdout.write(
          `\n${snapshot.summary.changedFilesCount} files changed, +${snapshot.summary.totalAdditions} -${snapshot.summary.totalDeletions}\n`
        );
      } else if (snapshot.summary.truncated) {
        process.stdout.write(
          `\nShowing first ${snapshot.summary.files.length} of ${snapshot.summary.changedFilesCount} changed files.\n`
        );
      }
    });

  pr
    .command("diff")
    .description("View pull request diff summary (gh-like)")
    .argument("<repositoryId>", "Repository ID")
    .argument("<localId>", "Change request local ID")
    .option("--org <organizationId>", "Organization ID")
    .option("--from <patchsetBizId>", "From patchset biz ID")
    .option("--to <patchsetBizId>", "To patchset biz ID")
    .option("--file <path>", "Filter by changed file path, repeatable", collect, [])
    .option("--name-only", "Only print changed file names", false)
    .option("--files", "Alias of --name-only", false)
    .option("--stat", "Print file change statistics in text format", false)
    .option("--patch", "Print unified patch content", false)
    .option("--save <path>", "Save patch output to file (requires --patch)")
    .option("-L, --limit <number>", "Max files to show", parsePositiveIntegerOption, 200)
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write diff output to file")
    .option("--json", "Print raw JSON")
    .action(async (repositoryId: string, localId: string, options: PrDiffOptions) => {
      const config = loadConfig();
      const organizationId = resolveOrganizationId(config, options.org);
      const outputFormat = normalizePrDiffOutputFormat(options.format, options.json);
      if (options.out && outputFormat === "table") {
        throw new CliError("`--out` requires --format tsv/json (or --json).");
      }
      if (options.patch && (options.nameOnly || options.files || options.stat)) {
        throw new CliError("Do not combine --patch with --name-only/--files/--stat.");
      }
      if (options.save && !options.patch) {
        throw new CliError("Do not use --save without --patch.");
      }

      const result = await withApiClient(config, async (client): Promise<PrDiffCommandResult> => {
        const snapshot = await resolvePrDiffSnapshot(client, {
          organizationId,
          repositoryId,
          localId,
          fromPatchSetBizId: options.from,
          toPatchSetBizId: options.to,
          limit: options.limit,
        });
        const summary = filterDiffSummaryByFiles(snapshot.summary, options.file);

        if (options.patch) {
          const patches = await resolvePrDiffPatches(client, {
            organizationId,
            repositoryId,
            localId,
            snapshot,
            filePaths: options.file,
          });
          const patchText = formatPrDiffPatch(patches);
          if (options.save) {
            await savePrDiffPatch(options.save, patchText);
          }

          return {
            mode: "patch",
            summary,
            payload: {
              ...summary,
              patchSets: snapshot.range,
              warning: snapshot.warning,
              patches,
              savedTo: options.save,
              raw: snapshot.raw,
            },
            patchText,
          };
        }

        const payload = {
          ...summary,
          patchSets: snapshot.range,
          warning: snapshot.warning,
        };
        const mode: PrDiffRenderMode = (options.nameOnly || options.files)
          ? "paths"
          : options.stat
            ? "stat"
            : "summary";
        return {
          mode,
          summary,
          payload: outputFormat === "json"
            ? {
                ...payload,
                raw: snapshot.raw,
              }
            : payload,
        };
      });

      if (options.out) {
        await writePrDiffOutputFile(options.out, formatPrDiffOutput(result, outputFormat));
        process.stdout.write(`Saved diff output to ${options.out}.\n`);
        return;
      }

      if (outputFormat === "tsv") {
        process.stdout.write(formatPrDiffOutput(result, "tsv"));
        return;
      }

      if (outputFormat === "table") {
        renderPrDiffTable(result);
        return;
      }

      printData(result.payload, {
        format: "json",
      });
    });

  pr
    .command("reviews")
    .description("Show pull request review status (gh-like)")
    .argument("<repositoryId>", "Repository ID")
    .argument("<localId>", "Change request local ID")
    .option("--org <organizationId>", "Organization ID")
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write reviews output to file")
    .option("--json", "Print raw JSON")
    .action(async (repositoryId: string, localId: string, options: PrReviewsOptions) => {
      const config = loadConfig();
      const organizationId = resolveOrganizationId(config, options.org);
      const outputFormat = normalizePrReviewsOutputFormat(options.format, options.json);

      const result = await withApiClient(config, async (client) => {
        const detail = await getChangeRequest(client, {
          organizationId,
          repositoryId,
          localId,
        });
        if (!isRecord(detail)) {
          return {
            reviewers: [],
            summary: {
              approved: 0,
              changesRequested: 0,
              commented: 0,
              pending: 0,
            },
          };
        }

        const reviewers = extractReviewers(detail);
        const summary = {
          approved: reviewers.filter((item) => item.state === "approved").length,
          changesRequested: reviewers.filter((item) => item.state === "changes_requested").length,
          commented: reviewers.filter((item) => item.state === "commented").length,
          pending: reviewers.filter((item) => item.state === "pending").length,
        };

        return {
          pullRequestStatus: readStringIn(detail, ["status", "state"]),
          summary,
          reviewers,
        };
      });

      if (options.out) {
        await writePrReviewsOutputFile(options.out, formatPrReviewsOutput(result, outputFormat));
        process.stdout.write(`Saved reviews output to ${options.out}.\n`);
        return;
      }

      if (outputFormat === "tsv") {
        process.stdout.write(`${formatPrReviewsTsv(result)}\n`);
        return;
      }

      printData(result, {
        format: outputFormat === "json" ? "json" : "table",
      });
    });

  pr
    .command("review")
    .description("Submit a pull request review (gh-like)")
    .argument("<repositoryId>", "Repository ID")
    .argument("<localId>", "Change request local ID")
    .option("--org <organizationId>", "Organization ID")
    .option("-b, --body <text>", "Review body")
    .option("-F, --body-file <path>", "Read review body from file")
    .option("--approve", "Approve the pull request", false)
    .option("--request-changes", "Request changes", false)
    .option("--comment", "Comment without final opinion", false)
    .option("--opinion <value>", "Raw review opinion value")
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write review output to file")
    .option("--json", "Print raw JSON")
    .action(async (repositoryId: string, localId: string, options: PrReviewOptions) => {
      const config = loadConfig();
      const organizationId = resolveOrganizationId(config, options.org);
      const outputFormat = normalizePrReviewOutputFormat(options.format, options.json);
      if (options.out && outputFormat === "table") {
        throw new CliError("`--out` requires --format tsv/json (or --json).");
      }
      const reviewComment = await resolvePrCommentBody({
        body: options.body,
        bodyFile: options.bodyFile,
      });

      const opinions = resolveReviewOpinions(options);
      const result = await withApiClient(config, async (client) => {
        let lastError: unknown;
        for (const opinion of opinions) {
          try {
            return await reviewMergeRequest(client, {
              organizationId,
              repositoryIdentity: repositoryId,
              localId,
              reviewOpinion: opinion,
              reviewComment,
            });
          } catch (error) {
            lastError = error;
          }
        }

        const suffix = lastError instanceof Error ? ` Last error: ${lastError.message}` : "";
        throw new CliError(`Failed to submit review for pull request ${localId}.${suffix}`);
      });

      if (options.out) {
        await writePrReviewOutputFile(options.out, formatPrReviewOutput(result, outputFormat));
        process.stdout.write(`Saved pull request review output to ${options.out}.\n`);
        return;
      }

      if (outputFormat === "tsv") {
        process.stdout.write(`${formatPrReviewTsv(result)}\n`);
        return;
      }

      printData(result, {
        format: outputFormat === "json" ? "json" : "table",
      });
    });

  pr
    .command("ready")
    .description("Mark a pull request as ready for review (gh-like)")
    .argument("<repositoryId>", "Repository ID")
    .argument("<localId>", "Change request local ID")
    .option("--org <organizationId>", "Organization ID")
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write ready output to file")
    .option("--json", "Print raw JSON")
    .action(async (repositoryId: string, localId: string, options: PrTransitionOptions) => {
      const config = loadConfig();
      const organizationId = resolveOrganizationId(config, options.org);
      const outputFormat = normalizePrTransitionOutputFormat(options.format, options.json);
      if (options.out && outputFormat === "table") {
        throw new CliError("`--out` requires --format tsv/json (or --json).");
      }

      const result = await withApiClient(config, (client) =>
        markChangeRequestReady(client, {
          organizationId,
          repositoryId,
          localId,
        })
      );

      if (options.out) {
        await writePrTransitionOutputFile(options.out, formatPrTransitionOutput(result, outputFormat));
        process.stdout.write(`Saved pull request transition output to ${options.out}.\n`);
        return;
      }

      if (outputFormat === "tsv") {
        process.stdout.write(`${formatPrTransitionTsv(result)}\n`);
        return;
      }

      printData(result, {
        format: outputFormat === "json" ? "json" : "table",
      });
    });

  pr
    .command("checks")
    .description("Show pull request checks (gh-like)")
    .argument("<repositoryId>", "Repository ID")
    .argument("<localId>", "Change request local ID")
    .option("--org <organizationId>", "Organization ID")
    .option("--watch", "Watch checks until completion", false)
    .option("--interval <seconds>", "Polling interval in seconds", parseFloat, 5)
    .option("--timeout <seconds>", "Max watch time in seconds", parseFloat, 1800)
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write checks output to file")
    .option("--json", "Print raw JSON")
    .action(async (repositoryId: string, localId: string, options: PrChecksOptions) => {
      const config = loadConfig();
      const organizationId = resolveOrganizationId(config, options.org);
      const outputFormat = normalizePrChecksOutputFormat(options.format, options.json);
      const intervalMs = Math.max(1, Math.round(options.interval * 1000));
      const timeoutMs = Math.max(1, Math.round(options.timeout * 1000));
      const started = Date.now();
      let latest = await withApiClient(config, (client) =>
        getChangeRequest(client, {
          organizationId,
          repositoryId,
          localId,
        })
      );

      let checkRuns = await withApiClient(config, (client) =>
        tryListCheckRunsForPr(client, {
          organizationId,
          repositoryId,
          detail: latest,
        })
      );
      let commitStatuses = await withApiClient(config, (client) =>
        tryListCommitStatusesForPr(client, {
          organizationId,
          repositoryId,
          detail: latest,
        })
      );

      let status = summarizePrChecks(latest, checkRuns, commitStatuses);
      let snapshot = statusKey(status);

      while (options.watch && status.pending > 0 && Date.now() - started < timeoutMs) {
        await sleep(intervalMs);
        const polled = await withApiClient(config, async (client) => {
          const detail = await getChangeRequest(client, {
            organizationId,
            repositoryId,
            localId,
          });
          const runs = await tryListCheckRunsForPr(client, {
            organizationId,
            repositoryId,
            detail,
          });
          const statuses = await tryListCommitStatusesForPr(client, {
            organizationId,
            repositoryId,
            detail,
          });
          return {
            detail,
            runs,
            statuses,
          };
        });
        latest = polled.detail;
        checkRuns = polled.runs;
        commitStatuses = polled.statuses;
        status = summarizePrChecks(latest, checkRuns, commitStatuses);
        const nextSnapshot = statusKey(status);
        if (outputFormat === "table" && !options.out && nextSnapshot !== snapshot) {
          const elapsed = Math.floor((Date.now() - started) / 1000);
          process.stdout.write(`[${elapsed}s] checks: pass=${status.pass} fail=${status.fail} pending=${status.pending}\n`);
          snapshot = nextSnapshot;
        }
      }

      const output = summarizePrChecks(latest, checkRuns, commitStatuses);
      if (options.out) {
        await writePrChecksOutputFile(options.out, formatPrChecksOutput(output, outputFormat));
        process.stdout.write(`Saved checks output to ${options.out}.\n`);
        return;
      }

      if (outputFormat === "tsv") {
        process.stdout.write(`${formatPrChecksTsv(output)}\n`);
        return;
      }

      printData(output, {
        format: outputFormat === "json" ? "json" : "table",
      });
    });

  pr
    .command("merge")
    .description("Merge a pull request (gh-like)")
    .argument("<repositoryId>", "Repository ID")
    .argument("<localId>", "Change request local ID")
    .option("--org <organizationId>", "Organization ID")
    .option("--merge-message <text>", "Merge commit message")
    .option("--method <method>", "ff-only | no-fast-forward | squash | rebase", "no-fast-forward")
    .option("--delete-branch", "Delete source branch after merge", false)
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write merge output to file")
    .option("--json", "Print raw JSON")
    .action(async (repositoryId: string, localId: string, options: PrMergeOptions) => {
      const config = loadConfig();
      const organizationId = resolveOrganizationId(config, options.org);
      const outputFormat = normalizePrMergeOutputFormat(options.format, options.json);
      if (options.out && outputFormat === "table") {
        throw new CliError("`--out` requires --format tsv/json (or --json).");
      }

      const result = await withApiClient(config, (client) =>
        mergeChangeRequest(client, {
          organizationId,
          repositoryId,
          localId,
          mergeMessage: options.mergeMessage,
          mergeType: options.method,
          removeSourceBranch: options.deleteBranch,
        })
      );

      if (options.out) {
        await writePrMergeOutputFile(options.out, formatPrMergeOutput(result, outputFormat));
        process.stdout.write(`Saved pull request merge output to ${options.out}.\n`);
        return;
      }

      if (outputFormat === "tsv") {
        process.stdout.write(`${formatPrMergeTsv(result)}\n`);
        return;
      }

      printData(result, {
        format: outputFormat === "json" ? "json" : "table",
      });
    });

  pr
    .command("close")
    .description("Close a pull request")
    .argument("<repositoryId>", "Repository ID")
    .argument("<localId>", "Change request local ID")
    .option("--org <organizationId>", "Organization ID")
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write close output to file")
    .option("--json", "Print raw JSON")
    .action(async (repositoryId: string, localId: string, options: PrTransitionOptions) => {
      const config = loadConfig();
      const organizationId = resolveOrganizationId(config, options.org);
      const outputFormat = normalizePrTransitionOutputFormat(options.format, options.json);
      if (options.out && outputFormat === "table") {
        throw new CliError("`--out` requires --format tsv/json (or --json).");
      }

      const result = await withApiClient(config, (client) =>
        closeChangeRequest(client, {
          organizationId,
          repositoryId,
          localId,
        })
      );

      if (options.out) {
        await writePrTransitionOutputFile(options.out, formatPrTransitionOutput(result, outputFormat));
        process.stdout.write(`Saved pull request transition output to ${options.out}.\n`);
        return;
      }

      if (outputFormat === "tsv") {
        process.stdout.write(`${formatPrTransitionTsv(result)}\n`);
        return;
      }

      printData(result, {
        format: outputFormat === "json" ? "json" : "table",
      });
    });

  pr
    .command("reopen")
    .description("Reopen a pull request")
    .argument("<repositoryId>", "Repository ID")
    .argument("<localId>", "Change request local ID")
    .option("--org <organizationId>", "Organization ID")
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write reopen output to file")
    .option("--json", "Print raw JSON")
    .action(async (repositoryId: string, localId: string, options: PrTransitionOptions) => {
      const config = loadConfig();
      const organizationId = resolveOrganizationId(config, options.org);
      const outputFormat = normalizePrTransitionOutputFormat(options.format, options.json);
      if (options.out && outputFormat === "table") {
        throw new CliError("`--out` requires --format tsv/json (or --json).");
      }

      const result = await withApiClient(config, (client) =>
        reopenChangeRequest(client, {
          organizationId,
          repositoryId,
          localId,
        })
      );

      if (options.out) {
        await writePrTransitionOutputFile(options.out, formatPrTransitionOutput(result, outputFormat));
        process.stdout.write(`Saved pull request transition output to ${options.out}.\n`);
        return;
      }

      if (outputFormat === "tsv") {
        process.stdout.write(`${formatPrTransitionTsv(result)}\n`);
        return;
      }

      printData(result, {
        format: outputFormat === "json" ? "json" : "table",
      });
    });
}

async function handlePrCommentResolveToggle(
  repositoryId: string,
  localId: string,
  commentBizId: string,
  options: PrCommentResolveOptions,
  resolved: boolean
): Promise<void> {
  const config = loadConfig();
  const organizationId = resolveOrganizationId(config, options.org);
  const outputFormat = normalizePrCommentWriteOutputFormat(options.format, options.json);
  if (options.out && outputFormat === "table") {
    throw new CliError("`--out` requires --format tsv/json (or --json).");
  }

  const result = await withApiClient(config, (client) =>
    updateChangeRequestCommentResolved(client, {
      organizationId,
      repositoryId,
      localId,
      commentBizId,
      resolved,
    })
  );

  const payload = {
    repositoryId,
    localId,
    commentBizId,
    resolved,
    result,
  };
  if (options.out) {
    await writePrCommentWriteOutputFile(options.out, formatPrCommentWriteOutput(payload, outputFormat));
    process.stdout.write(`Saved comment ${resolved ? "resolve" : "unresolve"} output to ${options.out}.\n`);
    return;
  }
  if (outputFormat === "tsv") {
    process.stdout.write(`${formatPrCommentWriteTsv(payload)}\n`);
    return;
  }

  printData(payload, {
    format: outputFormat === "json" ? "json" : "table",
  });
}

async function fetchPullRequestsWithLimit(client: YunxiaoApiClient, input: {
  organizationId: string;
  projectIds?: string;
  authorIds?: string;
  reviewerIds?: string;
  state?: string;
  search?: string;
  orderBy?: string;
  sort?: string;
  limit: number;
}): Promise<Record<string, unknown>[]> {
  const pageSize = Math.max(1, Math.min(100, input.limit));
  let page = 1;
  const result: Record<string, unknown>[] = [];

  while (result.length < input.limit) {
    const response = await listChangeRequests(client, {
      organizationId: input.organizationId,
      projectIds: input.projectIds,
      authorIds: input.authorIds,
      reviewerIds: input.reviewerIds,
      state: input.state,
      search: input.search,
      orderBy: input.orderBy,
      sort: input.sort,
      page,
      perPage: pageSize,
    });
    const current = extractRecords(response);
    if (current.length === 0) {
      break;
    }

    result.push(...current);
    if (current.length < pageSize) {
      break;
    }
    page += 1;
  }

  return result.slice(0, input.limit);
}

function formatPrViewTsv(result: unknown): string {
  const lines = [["key", "value"].join("\t")];
  const rows: Array<[string, string]> = [];
  collectPrViewTsvRows(rows, result, "");
  if (rows.length === 0) {
    rows.push(["value", ""]);
  }
  for (const [key, value] of rows) {
    lines.push([key, value].map(escapeTsvCell).join("\t"));
  }
  return lines.join("\n");
}

function collectPrViewTsvRows(rows: Array<[string, string]>, input: unknown, keyPrefix: string): void {
  if (input === null || input === undefined) {
    rows.push([keyPrefix || "value", ""]);
    return;
  }

  if (typeof input === "string") {
    rows.push([keyPrefix || "value", input]);
    return;
  }
  if (typeof input === "number" || typeof input === "boolean") {
    rows.push([keyPrefix || "value", String(input)]);
    return;
  }

  if (Array.isArray(input)) {
    if (input.length === 0) {
      rows.push([keyPrefix || "value", "[]"]);
      return;
    }
    for (let index = 0; index < input.length; index += 1) {
      const childKey = keyPrefix ? `${keyPrefix}[${index}]` : `[${index}]`;
      collectPrViewTsvRows(rows, input[index], childKey);
    }
    return;
  }

  if (!isRecord(input)) {
    rows.push([keyPrefix || "value", JSON.stringify(input)]);
    return;
  }

  const keys = Object.keys(input);
  if (keys.length === 0) {
    rows.push([keyPrefix || "value", "{}"]);
    return;
  }

  for (const key of keys) {
    const childKey = keyPrefix ? `${keyPrefix}.${key}` : key;
    collectPrViewTsvRows(rows, input[key], childKey);
  }
}

function formatPrViewOutput(result: unknown, format: "table" | "tsv" | "json"): string {
  if (format === "json") {
    return `${JSON.stringify(result, null, 2)}\n`;
  }
  if (format === "tsv") {
    return `${formatPrViewTsv(result)}\n`;
  }
  throw new CliError("`--out` requires --format tsv/json (or --json).");
}

async function writePrViewOutputFile(path: string, content: string): Promise<void> {
  await writeFile(path, content, "utf-8");
}

function formatPrCheckoutTsv(result: unknown): string {
  return formatPrViewTsv(result);
}

function formatPrCheckoutOutput(result: unknown, format: "table" | "tsv" | "json"): string {
  if (format === "json") {
    return `${JSON.stringify(result, null, 2)}\n`;
  }
  if (format === "tsv") {
    return `${formatPrCheckoutTsv(result)}\n`;
  }
  throw new CliError("`--out` requires --format tsv/json (or --json).");
}

async function writePrCheckoutOutputFile(path: string, content: string): Promise<void> {
  await writeFile(path, content, "utf-8");
}

function formatPrCommentWriteTsv(result: unknown): string {
  return formatPrViewTsv(result);
}

function formatPrCommentWriteOutput(result: unknown, format: "table" | "tsv" | "json"): string {
  if (format === "json") {
    return `${JSON.stringify(result, null, 2)}\n`;
  }
  if (format === "tsv") {
    return `${formatPrCommentWriteTsv(result)}\n`;
  }
  throw new CliError("`--out` requires --format tsv/json (or --json).");
}

async function writePrCommentWriteOutputFile(path: string, content: string): Promise<void> {
  await writeFile(path, content, "utf-8");
}

function formatPrCreateTsv(result: unknown): string {
  return formatPrViewTsv(result);
}

function formatPrCreateOutput(result: unknown, format: "table" | "tsv" | "json"): string {
  if (format === "json") {
    return `${JSON.stringify(result, null, 2)}\n`;
  }
  if (format === "tsv") {
    return `${formatPrCreateTsv(result)}\n`;
  }
  throw new CliError("`--out` requires --format tsv/json (or --json).");
}

async function writePrCreateOutputFile(path: string, content: string): Promise<void> {
  await writeFile(path, content, "utf-8");
}

function formatPrMergeTsv(result: unknown): string {
  return formatPrViewTsv(result);
}

function formatPrMergeOutput(result: unknown, format: "table" | "tsv" | "json"): string {
  if (format === "json") {
    return `${JSON.stringify(result, null, 2)}\n`;
  }
  if (format === "tsv") {
    return `${formatPrMergeTsv(result)}\n`;
  }
  throw new CliError("`--out` requires --format tsv/json (or --json).");
}

async function writePrMergeOutputFile(path: string, content: string): Promise<void> {
  await writeFile(path, content, "utf-8");
}

function formatPrTransitionTsv(result: unknown): string {
  return formatPrViewTsv(result);
}

function formatPrTransitionOutput(result: unknown, format: "table" | "tsv" | "json"): string {
  if (format === "json") {
    return `${JSON.stringify(result, null, 2)}\n`;
  }
  if (format === "tsv") {
    return `${formatPrTransitionTsv(result)}\n`;
  }
  throw new CliError("`--out` requires --format tsv/json (or --json).");
}

async function writePrTransitionOutputFile(path: string, content: string): Promise<void> {
  await writeFile(path, content, "utf-8");
}

function formatPrReviewTsv(result: unknown): string {
  return formatPrViewTsv(result);
}

function formatPrReviewOutput(result: unknown, format: "table" | "tsv" | "json"): string {
  if (format === "json") {
    return `${JSON.stringify(result, null, 2)}\n`;
  }
  if (format === "tsv") {
    return `${formatPrReviewTsv(result)}\n`;
  }
  throw new CliError("`--out` requires --format tsv/json (or --json).");
}

async function writePrReviewOutputFile(path: string, content: string): Promise<void> {
  await writeFile(path, content, "utf-8");
}

function formatPrEditTsv(result: unknown): string {
  return formatPrViewTsv(result);
}

function formatPrEditOutput(result: unknown, format: "table" | "tsv" | "json"): string {
  if (format === "json") {
    return `${JSON.stringify(result, null, 2)}\n`;
  }
  if (format === "tsv") {
    return `${formatPrEditTsv(result)}\n`;
  }
  throw new CliError("`--out` requires --format tsv/json (or --json).");
}

async function writePrEditOutputFile(path: string, content: string): Promise<void> {
  await writeFile(path, content, "utf-8");
}

function formatPrCommentsTsv(comments: Record<string, unknown>[]): string {
  const lines = [
    [
      "commentBizId",
      "parentCommentBizId",
      "commentType",
      "state",
      "resolved",
      "filePath",
      "author",
      "commentTime",
      "content",
    ].join("\t"),
  ];

  for (const item of comments) {
    lines.push(
      [
        readCommentBizId(item) ?? "",
        readParentCommentBizId(item) ?? "",
        readStringIn(item, ["comment_type", "commentType", "type"]) ?? "",
        readStringIn(item, ["state"]) ?? "",
        item.resolved === true || item.resolved === "true" || item.resolved === 1 ? "true" : "false",
        readCommentFilePath(item) ?? "",
        extractPrCommentAuthor(item) ?? "",
        readStringIn(item, ["comment_time", "commentTime", "createTime", "commentAt"]) ?? "",
        readStringIn(item, ["content", "body", "text", "message"]) ?? "",
      ]
        .map(escapeTsvCell)
        .join("\t")
    );
  }

  return lines.join("\n");
}

function formatPrCommentsSummaryTsv(summary: PrCommentsSummary): string {
  const lines = [["section", "key", "value", "path"].join("\t")];
  lines.push(["summary", "total", String(summary.total), ""].join("\t"));
  lines.push(["summary", "byType.global", String(summary.byType.global), ""].join("\t"));
  lines.push(["summary", "byType.inline", String(summary.byType.inline), ""].join("\t"));
  lines.push(["summary", "byType.unknown", String(summary.byType.unknown), ""].join("\t"));
  lines.push(["summary", "byState.opened", String(summary.byState.opened), ""].join("\t"));
  lines.push(["summary", "byState.draft", String(summary.byState.draft), ""].join("\t"));
  lines.push(["summary", "byState.other", String(summary.byState.other), ""].join("\t"));
  lines.push(["summary", "resolved.resolved", String(summary.resolved.resolved), ""].join("\t"));
  lines.push(["summary", "resolved.unresolved", String(summary.resolved.unresolved), ""].join("\t"));
  lines.push(["summary", "replies.root", String(summary.replies.root), ""].join("\t"));
  lines.push(["summary", "replies.reply", String(summary.replies.reply), ""].join("\t"));
  for (const item of summary.files) {
    lines.push(["file", "comments", String(item.count), item.path].map(escapeTsvCell).join("\t"));
  }
  return lines.join("\n");
}

function formatPrCommentsOutput(
  result: PrCommentsSummary | Record<string, unknown>[],
  format: "table" | "tsv" | "json",
  summary: boolean
): string {
  if (format === "json") {
    return `${JSON.stringify(result, null, 2)}\n`;
  }
  if (format === "tsv") {
    return summary
      ? `${formatPrCommentsSummaryTsv(result as PrCommentsSummary)}\n`
      : `${formatPrCommentsTsv(result as Record<string, unknown>[])}\n`;
  }
  throw new CliError("`--out` requires --format tsv/json (or --json).");
}

async function writePrCommentsOutputFile(path: string, content: string): Promise<void> {
  await writeFile(path, content, "utf-8");
}

function formatPrListTsv(result: unknown): string {
  const lines = [
    [
      "localId",
      "title",
      "state",
      "author",
      "sourceBranch",
      "targetBranch",
      "updatedAt",
      "url",
    ].join("\t"),
  ];
  const items = extractRecords(result);
  for (const item of items) {
    lines.push(
      [
        readPrStatusLocalId(item) ?? "",
        readPrStatusTitle(item) ?? "",
        readStringIn(item, ["state", "status"]) ?? "",
        readPrStatusAuthor(item) ?? "",
        readStringIn(item, ["sourceBranch", "source_branch", "sourceRefName", "sourceRef"]) ?? "",
        readStringIn(item, ["targetBranch", "target_branch", "targetRefName", "targetRef"]) ?? "",
        readStringIn(item, ["updatedAt", "updateTime", "gmtModified", "updated_at"]) ?? "",
        readPrStatusUrl(item) ?? "",
      ]
        .map(escapeTsvCell)
        .join("\t")
    );
  }
  return lines.join("\n");
}

function formatPrListOutput(result: unknown, format: "table" | "tsv" | "json"): string {
  if (format === "json") {
    return `${JSON.stringify(result, null, 2)}\n`;
  }
  if (format === "tsv") {
    return `${formatPrListTsv(result)}\n`;
  }
  throw new CliError("`--out` requires --format tsv/json (or --json).");
}

async function writePrListOutputFile(path: string, content: string): Promise<void> {
  await writeFile(path, content, "utf-8");
}

function formatPrStatusTsv(result: PrStatusResult): string {
  const lines = [
    [
      "section",
      "localId",
      "title",
      "status",
      "author",
      "sourceBranch",
      "targetBranch",
      "updatedAt",
      "url",
      "key",
      "value",
    ].join("\t"),
    ["summary", "", "", "", "", "", "", "", "", "currentUserId", result.currentUserId].map(escapeTsvCell).join("\t"),
    ["summary", "", "", "", "", "", "", "", "", "authoredOpenCount", String(result.authored.openCount)].join("\t"),
    [
      "summary",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "reviewRequestedOpenCount",
      String(result.reviewRequested.openCount),
    ].join("\t"),
  ];

  const append = (section: "authored" | "reviewRequested", items: Record<string, unknown>[]): void => {
    for (const item of items) {
      lines.push(
        [
          section,
          readPrStatusLocalId(item) ?? "",
          readPrStatusTitle(item) ?? "",
          readStringIn(item, ["status", "state"]) ?? "",
          readPrStatusAuthor(item) ?? "",
          readStringIn(item, ["sourceBranch", "source_branch", "sourceRefName", "sourceRef"]) ?? "",
          readStringIn(item, ["targetBranch", "target_branch", "targetRefName", "targetRef"]) ?? "",
          readStringIn(item, ["updatedAt", "updateTime", "gmtModified", "updated_at"]) ?? "",
          readPrStatusUrl(item) ?? "",
          "",
          "",
        ]
          .map(escapeTsvCell)
          .join("\t")
      );
    }
  };

  append("authored", result.authored.open);
  append("reviewRequested", result.reviewRequested.open);
  return lines.join("\n");
}

function formatPrStatusOutput(result: PrStatusResult, format: "table" | "tsv" | "json"): string {
  if (format === "json") {
    return `${JSON.stringify(result, null, 2)}\n`;
  }
  if (format === "tsv") {
    return `${formatPrStatusTsv(result)}\n`;
  }
  throw new CliError("`--out` requires --format tsv/json (or --json).");
}

async function writePrStatusOutputFile(path: string, content: string): Promise<void> {
  await writeFile(path, content, "utf-8");
}

function readPrStatusLocalId(item: Record<string, unknown>): string | undefined {
  return readStringIn(item, ["localId", "local_id", "iid", "number", "id"]);
}

function readPrStatusTitle(item: Record<string, unknown>): string | undefined {
  return readStringIn(item, ["title", "subject", "name"]);
}

function readPrStatusUrl(item: Record<string, unknown>): string | undefined {
  return readStringIn(item, ["webUrl", "url", "detailUrl", "targetUrl"]);
}

function readPrStatusAuthor(item: Record<string, unknown>): string | undefined {
  const direct = readStringIn(item, ["authorName", "authorUsername", "creatorName", "creatorUsername"]);
  if (direct) {
    return direct;
  }

  const author = item.author;
  if (isRecord(author)) {
    const nested = readStringIn(author, ["name", "username", "displayName", "id"]);
    if (nested) {
      return nested;
    }
  }

  const creator = item.creator;
  if (isRecord(creator)) {
    return readStringIn(creator, ["name", "username", "displayName", "id"]);
  }

  return undefined;
}

function readPrSourceBranch(detail: Record<string, unknown>): string | undefined {
  const directKeys = ["sourceBranch", "source_branch", "sourceRef", "sourceRefName"];
  for (const key of directKeys) {
    const value = detail[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }

  const nestedKeys = ["source", "sourceRepository", "sourceProject"];
  for (const key of nestedKeys) {
    const value = detail[key];
    if (!isRecord(value)) {
      continue;
    }
    const nested = value.branch ?? value.name ?? value.ref;
    if (typeof nested === "string" && nested.trim()) {
      return nested;
    }
  }

  return undefined;
}

function extractRecords(response: unknown): Record<string, unknown>[] {
  if (Array.isArray(response)) {
    return response.filter(isRecord);
  }

  if (!isRecord(response)) {
    return [];
  }

  const candidates = ["items", "result", "data", "records"];
  for (const key of candidates) {
    const value = response[key];
    if (Array.isArray(value)) {
      return value.filter(isRecord);
    }
  }

  return [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function runGitCommand(args: string[]): void {
  const result = spawnSync("git", args, {
    encoding: "utf-8",
  });
  if (result.status === 0) {
    return;
  }

  const stderr = (result.stderr ?? "").trim();
  const stdout = (result.stdout ?? "").trim();
  const message = stderr || stdout || "git command failed";
  throw new CliError(`Git command failed: git ${args.join(" ")}\n${message}`);
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function uniqueStrings(values: string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const item = value.trim();
    if (!item || seen.has(item)) {
      continue;
    }
    seen.add(item);
    result.push(item);
  }
  return result;
}

async function resolvePrCommentBody(options: PrCommentBodyInput): Promise<string | undefined> {
  if (options.body && options.body.trim()) {
    return options.body;
  }
  if (!options.bodyFile) {
    return undefined;
  }

  const content = await readFile(options.bodyFile, "utf-8");
  return content.trim() ? content : undefined;
}

async function resolvePrEditDescription(options: PrEditOptions): Promise<string | undefined> {
  if (options.body && options.body.trim()) {
    return options.body;
  }

  if (options.bodyFile) {
    const content = await readFile(options.bodyFile, "utf-8");
    if (content.trim()) {
      return content;
    }
  }

  if (options.description !== undefined) {
    return options.description;
  }

  return undefined;
}

async function resolvePrViewWebUrl(client: YunxiaoApiClient, input: {
  organizationId: string;
  repositoryId: string;
  localId: string;
  detail: unknown;
}): Promise<string | undefined> {
  const direct = resolvePullRequestWebUrl(input.detail);
  if (direct) {
    return direct;
  }

  const repo = await getRepository(client, {
    organizationId: input.organizationId,
    repositoryId: input.repositoryId,
  });
  const repoUrl = resolveRepositoryWebUrl(repo);
  return resolvePullRequestWebUrl(null, {
    repositoryWebUrl: repoUrl,
    localId: input.localId,
  });
}

async function resolveLatestPatchsetBizId(client: YunxiaoApiClient, input: {
  organizationId: string;
  repositoryId: string;
  localId: string;
}): Promise<string | undefined> {
  const response = await listChangeRequestPatchSets(client, input);
  const refs = extractPatchsetRefs(response);
  const latestSource = findLatestPatchsetByType(refs, "merge_source");
  if (latestSource) {
    return latestSource.id;
  }
  return refs[refs.length - 1]?.id;
}

async function resolvePatchsetRange(client: YunxiaoApiClient, input: {
  organizationId: string;
  repositoryId: string;
  localId: string;
  from?: string;
  to?: string;
}): Promise<{ fromPatchSetBizId?: string; toPatchSetBizId?: string }> {
  const context = await resolvePatchsetDiffContext(client, input);
  return context.range;
}

async function resolvePatchsetDiffContext(client: YunxiaoApiClient, input: {
  organizationId: string;
  repositoryId: string;
  localId: string;
  from?: string;
  to?: string;
}): Promise<{
  refs: PatchsetRef[];
  range: {
    fromPatchSetBizId?: string;
    toPatchSetBizId?: string;
  };
  fromRef?: PatchsetRef;
  toRef?: PatchsetRef;
}> {
  const response = await listChangeRequestPatchSets(client, {
    organizationId: input.organizationId,
    repositoryId: input.repositoryId,
    localId: input.localId,
  });
  const refs = extractPatchsetRefs(response);
  const range = normalizePatchsetRange({
    refs,
    fromPatchSetBizId: input.from,
    toPatchSetBizId: input.to,
  });
  return {
    refs,
    range,
    fromRef: findPatchsetById(refs, range.fromPatchSetBizId),
    toRef: findPatchsetById(refs, range.toPatchSetBizId),
  };
}

async function resolvePrDiffSnapshot(client: YunxiaoApiClient, input: {
  organizationId: string;
  repositoryId: string;
  localId: string;
  fromPatchSetBizId?: string;
  toPatchSetBizId?: string;
  limit: number;
}): Promise<{
  range: {
    fromPatchSetBizId?: string;
    toPatchSetBizId?: string;
  };
  patchsetContext?: {
    fromRef?: PatchsetRef;
    toRef?: PatchsetRef;
  };
  summary: PrDiffResult;
  raw?: unknown;
  warning?: string;
}> {
  const patchsetContext = await resolvePatchsetDiffContext(client, {
    organizationId: input.organizationId,
    repositoryId: input.repositoryId,
    localId: input.localId,
    from: input.fromPatchSetBizId,
    to: input.toPatchSetBizId,
  });
  const range = patchsetContext.range;

  try {
    const tree = await getMergeRequestChangeTree(client, {
      organizationId: input.organizationId,
      repositoryIdentity: input.repositoryId,
      localId: input.localId,
      fromPatchSetBizId: range.fromPatchSetBizId,
      toPatchSetBizId: range.toPatchSetBizId,
    });

    return {
      range,
      patchsetContext: {
        fromRef: patchsetContext.fromRef,
        toRef: patchsetContext.toRef,
      },
      summary: summarizeDiffTree(tree, Math.max(1, input.limit)),
      raw: tree,
    };
  } catch (error) {
    const detail = await getChangeRequest(client, {
      organizationId: input.organizationId,
      repositoryId: input.repositoryId,
      localId: input.localId,
    });
    return {
      range,
      patchsetContext: {
        fromRef: patchsetContext.fromRef,
        toRef: patchsetContext.toRef,
      },
      summary: summarizeDiffFromDetail(detail),
      warning:
        error instanceof Error
          ? `Diff detail API not available: ${error.message}`
          : "Diff detail API not available.",
    };
  }
}

type PatchsetType = "merge_source" | "merge_target" | "unknown";

type PatchsetRef = {
  id: string;
  version: number;
  createTime: number;
  type: PatchsetType;
  commitId: string | undefined;
};

function summarizePatchsets(response: unknown): PrPatchsetsSummary {
  const refs = extractPatchsetRefs(response);
  return {
    total: refs.length,
    patchsets: refs.map((item) => ({
      id: item.id,
      version: item.version,
      type: item.type,
      createdAt: item.createTime > 0 ? new Date(item.createTime).toISOString() : undefined,
      commitId: item.commitId,
    })),
    suggestedRange: normalizePatchsetRange({ refs }),
  };
}

function formatPrPatchsetsTsv(summary: PrPatchsetsSummary): string {
  const fromPatchSetBizId = summary.suggestedRange.fromPatchSetBizId ?? "";
  const toPatchSetBizId = summary.suggestedRange.toPatchSetBizId ?? "";
  return [
    ["id", "version", "type", "createdAt", "commitId", "suggestedFrom", "suggestedTo"].join("\t"),
    ...summary.patchsets.map((item) =>
      [
        item.id,
        String(item.version),
        item.type,
        item.createdAt ?? "",
        item.commitId ?? "",
        item.id === fromPatchSetBizId ? "true" : "false",
        item.id === toPatchSetBizId ? "true" : "false",
      ]
        .map(escapeTsvCell)
        .join("\t")
    ),
  ].join("\n");
}

function formatPrPatchsetsOutput(summary: PrPatchsetsSummary, format: "table" | "tsv" | "json"): string {
  if (format === "tsv") {
    return `${formatPrPatchsetsTsv(summary)}\n`;
  }
  throw new CliError("`--out` requires --format tsv/json (or --json).");
}

async function writePrPatchsetsOutputFile(path: string, content: string): Promise<void> {
  await writeFile(path, content, "utf-8");
}

function extractPatchsetRefs(response: unknown): PatchsetRef[] {
  const refs = extractRecords(response)
    .map((item) => {
      const id = readStringIn(item, ["patchSetBizId", "patchsetBizId", "patch_set_biz_id", "bizId", "id"]);
      if (!id) {
        return undefined;
      }
      const version = Number(item.versionNo ?? item.version ?? item.index ?? 0);
      const createTime = Date.parse(readStringIn(item, ["createTime", "createdAt", "gmtCreate"]) ?? "");
      return {
        id,
        version: Number.isFinite(version) ? version : 0,
        createTime: Number.isFinite(createTime) ? createTime : 0,
        type: resolvePatchsetType(item),
        commitId: readStringIn(item, ["commitId", "commit_id", "sha", "revision"]),
      };
    })
    .filter((item): item is PatchsetRef => item !== undefined);

  refs.sort((a, b) => {
    if (a.version !== b.version) {
      return a.version - b.version;
    }
    return a.createTime - b.createTime;
  });

  return refs;
}

function resolvePatchsetType(item: Record<string, unknown>): PatchsetType {
  const relatedType = readStringIn(item, [
    "relatedMergeItemType",
    "relatedMergeType",
    "mergeItemType",
    "patchSetType",
    "type",
  ]);
  const normalized = (relatedType ?? "").toUpperCase();
  if (normalized.includes("SOURCE")) {
    return "merge_source";
  }
  if (normalized.includes("TARGET")) {
    return "merge_target";
  }

  const ref = readStringIn(item, ["ref"]) ?? "";
  if (ref.includes("/target/")) {
    return "merge_target";
  }
  if (ref.includes("/changes/")) {
    return "merge_source";
  }

  return "unknown";
}

function findLatestPatchsetByType(refs: PatchsetRef[], type: PatchsetType): PatchsetRef | undefined {
  const scoped = refs.filter((item) => item.type === type);
  return scoped[scoped.length - 1];
}

function normalizePatchsetRange(input: {
  refs: PatchsetRef[];
  fromPatchSetBizId?: string;
  toPatchSetBizId?: string;
}): { fromPatchSetBizId?: string; toPatchSetBizId?: string } {
  const refs = input.refs;
  if (refs.length === 0) {
    return {};
  }

  const suggested = suggestPatchsetRange(refs);
  let fromPatchSetBizId = input.fromPatchSetBizId ?? suggested.fromPatchSetBizId;
  let toPatchSetBizId = input.toPatchSetBizId ?? suggested.toPatchSetBizId;

  if (!toPatchSetBizId) {
    const next =
      findLatestPatchsetByType(refs, "merge_source") ?? findLatestPatchsetExcluding(refs, fromPatchSetBizId);
    toPatchSetBizId = next?.id;
  }

  if (!fromPatchSetBizId) {
    const toRef = findPatchsetById(refs, toPatchSetBizId);
    const base = toRef ? pickBestBasePatchset(refs, toRef) : findLatestPatchsetExcluding(refs, toPatchSetBizId);
    fromPatchSetBizId = base?.id;
  }

  if (fromPatchSetBizId && toPatchSetBizId && fromPatchSetBizId === toPatchSetBizId) {
    fromPatchSetBizId = findLatestPatchsetExcluding(refs, toPatchSetBizId)?.id;
  }

  return {
    fromPatchSetBizId,
    toPatchSetBizId,
  };
}

function suggestPatchsetRange(refs: PatchsetRef[]): { fromPatchSetBizId?: string; toPatchSetBizId?: string } {
  const to = findLatestPatchsetByType(refs, "merge_source") ?? refs[refs.length - 1];
  if (!to) {
    return {};
  }

  const from = pickBestBasePatchset(refs, to);
  if (!from) {
    return { toPatchSetBizId: to.id };
  }

  return {
    fromPatchSetBizId: from.id,
    toPatchSetBizId: to.id,
  };
}

function pickBestBasePatchset(refs: PatchsetRef[], to: PatchsetRef): PatchsetRef | undefined {
  const targetCandidates = refs.filter((item) => item.type === "merge_target" && item.id !== to.id);
  if (targetCandidates.length > 0) {
    const sameOrBefore = targetCandidates.filter((item) => item.version <= to.version);
    if (sameOrBefore.length > 0) {
      return sameOrBefore[sameOrBefore.length - 1];
    }
    return targetCandidates[targetCandidates.length - 1];
  }

  const previousSource = refs.filter((item) => item.type === "merge_source" && item.id !== to.id);
  if (previousSource.length > 0) {
    return previousSource[previousSource.length - 1];
  }

  return findLatestPatchsetExcluding(refs, to.id);
}

function findPatchsetById(refs: PatchsetRef[], patchSetBizId?: string): PatchsetRef | undefined {
  if (!patchSetBizId) {
    return undefined;
  }
  return refs.find((item) => item.id === patchSetBizId);
}

function findLatestPatchsetExcluding(refs: PatchsetRef[], excludedId?: string): PatchsetRef | undefined {
  for (let i = refs.length - 1; i >= 0; i -= 1) {
    if (refs[i].id !== excludedId) {
      return refs[i];
    }
  }
  return undefined;
}

function summarizeDiffTree(response: unknown, limit: number): PrDiffResult {
  const payload = extractFirstRecord(response, ["result", "data", "body"]) ?? (isRecord(response) ? response : {});
  const changedFiles = extractRecords(
    payload.changedTreeItems ?? payload.changedFilesInfos ?? payload.files ?? payload.changedFiles ?? payload.items
  );
  const files = changedFiles.slice(0, limit).map((item) => {
    const path = readStringIn(item, ["newPath", "new_path", "path", "filePath", "oldPath", "old_path"]);
    const additions = readNumberIn(item, ["addLines", "additions", "addedLines", "insertions"]);
    const deletions = readNumberIn(item, ["delLines", "deletions", "deletedLines"]);
    return {
      path: path ?? "(unknown)",
      additions,
      deletions,
      renamed: Boolean(item.renamedFile ?? item.renamed ?? false),
      binary: Boolean(item.isBinary ?? item.binaryFile ?? item.binary ?? false),
    };
  });

  const changedCount = readNumberIn(payload, ["changedFilesCount", "filesCount", "changed_files_count", "count"]) ?? changedFiles.length;
  const totalAdditions =
    readNumberIn(payload, ["totalAddLines", "totalAdditions", "total_add_lines"]) ??
    files.reduce((sum, item) => sum + (item.additions ?? 0), 0);
  const totalDeletions =
    readNumberIn(payload, ["totalDelLines", "totalDeletions", "total_del_lines"]) ??
    files.reduce((sum, item) => sum + (item.deletions ?? 0), 0);

  return {
    changedFilesCount: changedCount,
    totalAdditions,
    totalDeletions,
    files,
    truncated: changedFiles.length > files.length,
  };
}

function summarizeDiffFromDetail(detail: unknown): PrDiffResult {
  if (!isRecord(detail)) {
    return {
      changedFilesCount: 0,
      totalAdditions: 0,
      totalDeletions: 0,
      files: [],
      truncated: false,
    };
  }

  const changedFilesCount =
    readNumberIn(detail, ["changedFilesCount", "changedFileCount", "diffFileCount", "fileCount"]) ?? 0;
  const totalAdditions =
    readNumberIn(detail, ["totalAdditions", "additions", "addLines", "addLineCount"]) ?? 0;
  const totalDeletions =
    readNumberIn(detail, ["totalDeletions", "deletions", "delLines", "deleteLineCount"]) ?? 0;

  return {
    changedFilesCount,
    totalAdditions,
    totalDeletions,
    files: [],
    truncated: false,
  };
}

function formatPrDiffStat(summary: PrDiffResult): string[] {
  const lines = summary.files.map((item) => {
    const plus = item.additions ?? 0;
    const minus = item.deletions ?? 0;
    return `${item.path} | +${plus} -${minus}`;
  });
  lines.push(``);
  lines.push(`${summary.changedFilesCount} files changed, +${summary.totalAdditions} -${summary.totalDeletions}`);
  return lines;
}

function formatPrFilesText(summary: PrDiffResult, mode: PrFilesRenderMode): string[] {
  if (mode === "tree") {
    return formatPathTree(summary.files.map((item) => item.path));
  }
  if (mode === "stat") {
    return summary.files.map((item) => {
      const plus = item.additions ?? 0;
      const minus = item.deletions ?? 0;
      return `${item.path} | +${plus} -${minus}`;
    });
  }
  return summary.files.map((item) => item.path);
}

function formatPrFilesTsv(summary: PrDiffResult, mode: PrFilesRenderMode): string {
  if (mode === "tree") {
    return [
      ["line"].join("\t"),
      ...formatPathTree(summary.files.map((item) => item.path)).map((line) => escapeTsvCell(line)),
    ].join("\n");
  }
  if (mode === "stat") {
    return [
      ["path", "additions", "deletions", "renamed", "binary"].join("\t"),
      ...summary.files.map((item) =>
        [
          item.path,
          String(item.additions ?? 0),
          String(item.deletions ?? 0),
          item.renamed ? "true" : "false",
          item.binary ? "true" : "false",
        ]
          .map(escapeTsvCell)
          .join("\t")
      ),
    ].join("\n");
  }
  return [
    ["path"].join("\t"),
    ...summary.files.map((item) => escapeTsvCell(item.path)),
  ].join("\n");
}

function formatPrFilesOutput(summary: PrDiffResult, format: "table" | "tsv" | "json", mode: PrFilesRenderMode): string {
  if (format === "tsv") {
    return `${formatPrFilesTsv(summary, mode)}\n`;
  }
  throw new CliError("`--out` requires --format tsv/json (or --json).");
}

async function writePrFilesOutputFile(path: string, content: string): Promise<void> {
  await writeFile(path, content, "utf-8");
}

function formatPrDiffOutput(result: PrDiffCommandResult, format: "table" | "tsv" | "json"): string {
  if (format === "json") {
    return `${JSON.stringify(result.payload, null, 2)}\n`;
  }
  if (format === "tsv") {
    const mode: PrFilesRenderMode = result.mode === "paths" ? "paths" : "stat";
    return `${formatPrFilesTsv(result.summary, mode)}\n`;
  }
  throw new CliError("`--out` requires --format tsv/json (or --json).");
}

async function writePrDiffOutputFile(path: string, content: string): Promise<void> {
  await writeFile(path, content, "utf-8");
}

function renderPrDiffTable(result: PrDiffCommandResult): void {
  if (result.mode === "patch") {
    const warning = isRecord(result.payload) ? readStringIn(result.payload, ["warning"]) : undefined;
    if (warning) {
      process.stdout.write(`Warning: ${warning}\n`);
    }

    const patches = isRecord(result.payload) && Array.isArray(result.payload.patches) ? result.payload.patches : [];
    const savedTo = isRecord(result.payload) ? readStringIn(result.payload, ["savedTo"]) : undefined;
    if (patches.length === 0 && !savedTo) {
      process.stdout.write("No patch content available.\n");
      return;
    }

    if (savedTo) {
      process.stdout.write(`Saved patch to ${savedTo} (${patches.length} file${patches.length === 1 ? "" : "s"}).\n`);
      return;
    }

    process.stdout.write(`${result.patchText ?? ""}\n`);
    return;
  }

  if (result.mode === "paths") {
    const lines = result.summary.files.map((item) => String(item.path ?? "")).filter(Boolean);
    process.stdout.write(`${lines.join("\n")}${lines.length ? "\n" : ""}`);
    return;
  }

  if (result.mode === "stat") {
    const lines = formatPrDiffStat(result.summary);
    process.stdout.write(`${lines.join("\n")}${lines.length ? "\n" : ""}`);
    return;
  }

  printData(result.payload, {
    format: "table",
  });
}

function filterDiffSummaryByFiles(summary: PrDiffResult, filePaths: string[]): PrDiffResult {
  const filters = normalizePathFilters(filePaths);
  if (filters.length === 0) {
    return summary;
  }

  const files = summary.files.filter((item) => matchesPathFilters(item.path, filters));
  return {
    ...summary,
    files,
    changedFilesCount: files.length,
    totalAdditions: files.reduce((sum, item) => sum + (item.additions ?? 0), 0),
    totalDeletions: files.reduce((sum, item) => sum + (item.deletions ?? 0), 0),
    truncated: false,
  };
}

async function resolvePrDiffPatches(client: YunxiaoApiClient, input: {
  organizationId: string;
  repositoryId: string;
  localId: string;
  snapshot: {
    range: {
      fromPatchSetBizId?: string;
      toPatchSetBizId?: string;
    };
    patchsetContext?: {
      fromRef?: PatchsetRef;
      toRef?: PatchsetRef;
    };
  };
  filePaths: string[];
}): Promise<PrPatchItem[]> {
  const fromRef = input.snapshot.patchsetContext?.fromRef;
  const toRef = input.snapshot.patchsetContext?.toRef;
  const fromCommit = fromRef?.commitId;
  const toCommit = toRef?.commitId;
  if (!fromCommit || !toCommit) {
    throw new CliError(
      `Cannot resolve commit IDs for patchset range (from=${input.snapshot.range.fromPatchSetBizId ?? "?"}, to=${input.snapshot.range.toPatchSetBizId ?? "?"}).`
    );
  }

  const response = await getRepositoryCompare(client, {
    organizationId: input.organizationId,
    repositoryIdentity: input.repositoryId,
    from: fromCommit,
    to: toCommit,
    straight: true,
  });

  const all = extractPrPatchItems(response);
  const filters = normalizePathFilters(input.filePaths);
  if (filters.length === 0) {
    return all;
  }
  return all.filter((item) => matchesPathFilters(item.path, filters));
}

function extractPrPatchItems(response: unknown): PrPatchItem[] {
  const diffs = extractRecords(response).length > 0 ? extractRecords(response) : extractCompareDiffRecords(response);
  return diffs
    .map((item) => {
      const path =
        readStringIn(item, ["newPath", "new_path", "path", "filePath", "oldPath", "old_path"]) ?? "(unknown)";
      const patch = readStringIn(item, ["diff", "patch"]);
      if (!patch) {
        return undefined;
      }
      return {
        path,
        patch,
        renamed: Boolean(item.renamedFile ?? item.renamed ?? false),
        binary: Boolean(item.isBinary ?? item.binary ?? false),
      };
    })
    .filter((item): item is PrPatchItem => item !== undefined);
}

function extractCompareDiffRecords(response: unknown): Record<string, unknown>[] {
  if (!isRecord(response)) {
    return [];
  }
  const direct = response.diffs;
  if (Array.isArray(direct)) {
    return direct.filter(isRecord);
  }
  return [];
}

function formatPrDiffPatch(items: PrPatchItem[]): string {
  const blocks: string[] = [];
  for (const item of items) {
    blocks.push(`# ${item.path}`);
    blocks.push(item.patch.endsWith("\n") ? item.patch.slice(0, -1) : item.patch);
  }
  return blocks.join("\n");
}

async function savePrDiffPatch(filePath: string, content: string): Promise<void> {
  const value = content && !content.endsWith("\n") ? `${content}\n` : content;
  await writeFile(filePath, value, "utf-8");
}

function normalizePathFilters(paths: string[]): string[] {
  return paths
    .map((item) => item.trim().replace(/\\/g, "/"))
    .filter(Boolean);
}

function matchesPathFilters(path: string, filters: string[]): boolean {
  const normalized = path.replace(/\\/g, "/");
  return filters.some((filter) => normalized === filter || normalized.endsWith(`/${filter}`));
}

function extractReviewers(detail: Record<string, unknown>): PrReviewerStatus[] {
  const reviewersRaw = detail.reviewers;
  if (!Array.isArray(reviewersRaw)) {
    return [];
  }

  const result: PrReviewerStatus[] = [];
  for (const item of reviewersRaw) {
    if (!isRecord(item)) {
      continue;
    }
    const rawOpinion = readStringIn(item, ["reviewOpinionStatus", "status", "state"]) ?? "";
    const name = readStringIn(item, ["name", "username", "userName"]) ?? "(unknown)";
    const id = readStringIn(item, ["userId", "id"]);
    const state = normalizeReviewerState(rawOpinion, item);
    result.push({
      name,
      userId: id,
      state,
      reviewOpinionStatus: rawOpinion || undefined,
      reviewTime: readStringIn(item, ["reviewTime"]),
    });
  }
  return result;
}

function formatPrReviewsTsv(result: PrReviewsResult): string {
  const lines = [["section", "name", "state", "userId", "reviewOpinionStatus", "reviewTime", "key", "value"].join("\t")];
  lines.push(["summary", "", "", "", "", "", "approved", String(result.summary.approved)].join("\t"));
  lines.push(["summary", "", "", "", "", "", "changesRequested", String(result.summary.changesRequested)].join("\t"));
  lines.push(["summary", "", "", "", "", "", "commented", String(result.summary.commented)].join("\t"));
  lines.push(["summary", "", "", "", "", "", "pending", String(result.summary.pending)].join("\t"));
  if (result.pullRequestStatus) {
    lines.push(["summary", "", "", "", "", "", "pullRequestStatus", result.pullRequestStatus].map(escapeTsvCell).join("\t"));
  }

  for (const reviewer of result.reviewers) {
    lines.push(
      [
        "reviewer",
        reviewer.name,
        reviewer.state,
        reviewer.userId ?? "",
        reviewer.reviewOpinionStatus ?? "",
        reviewer.reviewTime ?? "",
        "",
        "",
      ]
        .map(escapeTsvCell)
        .join("\t")
    );
  }

  return lines.join("\n");
}

function formatPrReviewsOutput(result: PrReviewsResult, format: "table" | "tsv" | "json"): string {
  if (format === "json") {
    return `${JSON.stringify(result, null, 2)}\n`;
  }
  if (format === "tsv") {
    return `${formatPrReviewsTsv(result)}\n`;
  }
  throw new CliError("`--out` requires --format tsv/json (or --json).");
}

async function writePrReviewsOutputFile(path: string, content: string): Promise<void> {
  await writeFile(path, content, "utf-8");
}

function normalizeReviewerState(rawStatus: string, reviewer: Record<string, unknown>): PrReviewerState {
  const status = rawStatus.toLowerCase();
  if (status) {
    if (status.includes("reject") || status.includes("changes") || status.includes("disagree")) {
      return "changes_requested";
    }
    if (status.includes("approve") || status.includes("pass")) {
      return "approved";
    }
    if (status.includes("comment")) {
      return "commented";
    }
    if (status.includes("pending") || status.includes("waiting") || status.includes("reviewing")) {
      return "pending";
    }
  }

  if (reviewer.hasReviewed === true) {
    return "commented";
  }
  if (reviewer.hasCommented === true) {
    return "commented";
  }
  return "pending";
}

function resolveCommentFilter(options: {
  type: "all" | "global" | "inline";
  state: "opened" | "draft" | "all";
}): Array<{
  commentType: "GLOBAL_COMMENT" | "INLINE_COMMENT";
  state: "OPENED" | "DRAFT";
}> {
  const states = options.state === "all" ? ["OPENED", "DRAFT"] : [options.state === "draft" ? "DRAFT" : "OPENED"];
  const types =
    options.type === "all"
      ? (["GLOBAL_COMMENT", "INLINE_COMMENT"] as const)
      : ([options.type === "inline" ? "INLINE_COMMENT" : "GLOBAL_COMMENT"] as const);

  const requests: Array<{ commentType: "GLOBAL_COMMENT" | "INLINE_COMMENT"; state: "OPENED" | "DRAFT" }> = [];
  for (const state of states) {
    for (const commentType of types) {
      requests.push({
        commentType,
        state: state as "OPENED" | "DRAFT",
      });
    }
  }
  return requests;
}

function normalizeCommentsState(value: string): "opened" | "draft" | "all" {
  if (value === "draft" || value === "all") {
    return value;
  }
  return "opened";
}

function dedupeRecords(records: Record<string, unknown>[]): Record<string, unknown>[] {
  const seen = new Set<string>();
  const result: Record<string, unknown>[] = [];

  for (const item of records) {
    const key =
      readCommentBizId(item) ??
      `${readStringIn(item, ["content"]) ?? ""}|${readStringIn(item, ["comment_time", "commentTime", "createTime"]) ?? ""}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(item);
  }
  return result;
}

function summarizePrCommentThreads(
  records: Record<string, unknown>[],
  options?: {
    filePath?: string;
    authors?: string[];
    withReplies?: boolean;
    since?: string;
    contains?: string[];
    sort?: "latest" | "oldest";
  }
): PrCommentThread[] {
  const normalizedFileFilter = normalizePathFilters(options?.filePath ? [options.filePath] : []);
  const authorFilters = normalizeAuthorFilters(options?.authors ?? []);
  const containsFilters = normalizeContainsFilters(options?.contains ?? []);
  const sinceMs = parseIsoTimeOption(options?.since, "--since");
  const nodeById = new Map<string, PrCommentThreadNode>();

  for (const record of records) {
    const node = toPrCommentThreadNode(record);
    if (node) {
      mergePrCommentThreadNode(nodeById, node);
    }

    const parentId = readStringIn(record, ["comment_biz_id", "commentBizId", "id", "bizId"]);
    const children = record.child_comments_list;
    if (!Array.isArray(children)) {
      continue;
    }
    for (const child of children) {
      if (!isRecord(child)) {
        continue;
      }
      const childNode = toPrCommentThreadNode(child, parentId);
      if (childNode) {
        mergePrCommentThreadNode(nodeById, childNode);
      }
    }
  }

  const threadBuckets = new Map<string, PrCommentThreadNode[]>();
  for (const node of nodeById.values()) {
    const key = resolvePrCommentThreadRootId(node, nodeById);
    const bucket = threadBuckets.get(key) ?? [];
    bucket.push(node);
    threadBuckets.set(key, bucket);
  }

  const threads: PrCommentThread[] = [];
  for (const [threadId, nodes] of threadBuckets.entries()) {
    nodes.sort(comparePrCommentThreadNode);
    const rootNode =
      nodeById.get(threadId) ??
      nodes.find((item) => !item.parentCommentBizId) ??
      nodes[0];
    if (!rootNode) {
      continue;
    }
    const replies = nodes.filter((item) => item.id !== rootNode.id);
    if (options?.withReplies && replies.length === 0) {
      continue;
    }

    const filePaths = uniqueStrings(nodes.map((item) => item.filePath ?? "").filter(Boolean));
    if (
      normalizedFileFilter.length > 0 &&
      !filePaths.some((item) => matchesPathFilters(item, normalizedFileFilter))
    ) {
      continue;
    }

    const participantSet = new Set<string>();
    const participantKeys = new Set<string>();
    for (const item of nodes) {
      if (item.author) {
        participantSet.add(item.author);
      }
      for (const candidate of item.authorCandidates) {
        participantKeys.add(normalizeAuthorFilterValue(candidate));
      }
    }

    if (authorFilters.length > 0 && !authorFilters.some((item) => participantKeys.has(item))) {
      continue;
    }

    if (containsFilters.length > 0) {
      const contentJoined = nodes
        .map((item) => item.content ?? "")
        .join("\n")
        .toLowerCase();
      if (!containsFilters.every((keyword) => contentJoined.includes(keyword))) {
        continue;
      }
    }

    const lastCommentTime =
      [...nodes]
        .sort(comparePrCommentThreadNode)
        .slice(-1)[0]
        ?.commentTime ?? undefined;
    if (sinceMs !== undefined) {
      const lastCommentMs = lastCommentTime ? Date.parse(lastCommentTime) : Number.NaN;
      if (!Number.isFinite(lastCommentMs) || lastCommentMs < sinceMs) {
        continue;
      }
    }

    threads.push({
      threadId: rootNode.id,
      resolved: nodes.every((item) => item.resolved),
      totalComments: nodes.length,
      commentType: rootNode.commentType,
      state: rootNode.state,
      filePaths,
      participants: Array.from(participantSet),
      lastCommentAt: lastCommentTime,
      rootComment: rootNode.raw,
      replies: replies.map((item) => item.raw),
    });
  }

  if (options?.sort === "oldest") {
    threads.sort((left, right) => compareIsoTimeAsc(left.lastCommentAt, right.lastCommentAt));
  } else {
    threads.sort((left, right) => compareIsoTimeDesc(left.lastCommentAt, right.lastCommentAt));
  }
  return threads;
}

function toPrCommentThreadNode(
  record: Record<string, unknown>,
  fallbackParentCommentBizId?: string
): PrCommentThreadNode | undefined {
  const id = readCommentBizId(record);
  if (!id) {
    return undefined;
  }

  const author = extractPrCommentAuthor(record);
  const authorCandidates = extractPrCommentAuthorCandidates(record);
  const content = readStringIn(record, ["content", "body", "text", "message"]);
  return {
    id,
    parentCommentBizId:
      readParentCommentBizId(record) ??
      fallbackParentCommentBizId,
    resolved: record.resolved === true || record.resolved === "true" || record.resolved === 1,
    state: readStringIn(record, ["state"]),
    commentType: readStringIn(record, ["comment_type", "commentType"]),
    filePath: readCommentFilePath(record),
    commentTime: readStringIn(record, ["comment_time", "commentTime", "createTime", "commentAt"]),
    author,
    authorCandidates,
    content,
    raw: record,
  };
}

function readCommentBizId(record: Record<string, unknown>): string | undefined {
  return readStringIn(record, ["comment_biz_id", "commentBizId", "id", "bizId"]);
}

function readParentCommentBizId(record: Record<string, unknown>): string | undefined {
  return readStringIn(record, ["parent_comment_biz_id", "parentCommentBizId", "parentId"]);
}

function mergePrCommentThreadNode(target: Map<string, PrCommentThreadNode>, next: PrCommentThreadNode): void {
  const current = target.get(next.id);
  if (!current) {
    target.set(next.id, next);
    return;
  }

  target.set(next.id, {
    id: current.id,
    parentCommentBizId: current.parentCommentBizId ?? next.parentCommentBizId,
    resolved: current.resolved || next.resolved,
    state: current.state ?? next.state,
    commentType: current.commentType ?? next.commentType,
    filePath: current.filePath ?? next.filePath,
    commentTime: current.commentTime ?? next.commentTime,
    author: current.author ?? next.author,
    authorCandidates: mergeAuthorCandidates(current.authorCandidates, next.authorCandidates),
    content: current.content ?? next.content,
    raw: current.content ? current.raw : next.raw,
  });
}

function extractPrCommentAuthor(record: Record<string, unknown>): string | undefined {
  const direct = readStringIn(record, ["authorName", "username", "userName", "creatorName"]);
  if (direct) {
    return direct;
  }

  const author = record.author;
  if (!isRecord(author)) {
    return undefined;
  }
  return readStringIn(author, ["name", "username", "userName"]);
}

function extractPrCommentAuthorCandidates(record: Record<string, unknown>): string[] {
  const candidates: string[] = collectStringsIn(record, [
    "authorName",
    "username",
    "userName",
    "creatorName",
    "userId",
    "authorId",
  ]);

  const author = record.author;
  if (isRecord(author)) {
    candidates.push(...collectStringsIn(author, ["name", "username", "userName", "userId", "id", "email"]));
  }

  return uniqueStrings(candidates);
}

function mergeAuthorCandidates(left: string[], right: string[]): string[] {
  return uniqueStrings([...left, ...right]);
}

function normalizeAuthorFilters(values: string[]): string[] {
  return uniqueStrings(values.map((item) => normalizeAuthorFilterValue(item)).filter(Boolean));
}

function normalizeAuthorFilterValue(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeContainsFilters(values: string[]): string[] {
  return uniqueStrings(values.map((item) => item.trim().toLowerCase()).filter(Boolean));
}

function collectStringsIn(input: Record<string, unknown>, keys: string[]): string[] {
  const values: string[] = [];
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) {
      values.push(value.trim());
      continue;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      values.push(String(Math.round(value)));
    }
  }
  return values;
}

function resolvePrCommentThreadRootId(
  node: PrCommentThreadNode,
  byId: Map<string, PrCommentThreadNode>
): string {
  const visited = new Set<string>([node.id]);
  let current = node;

  while (current.parentCommentBizId && byId.has(current.parentCommentBizId)) {
    const next = byId.get(current.parentCommentBizId);
    if (!next || visited.has(next.id)) {
      break;
    }
    visited.add(next.id);
    current = next;
  }

  if (current.parentCommentBizId && !byId.has(current.parentCommentBizId)) {
    return current.parentCommentBizId;
  }

  return current.id;
}

function comparePrCommentThreadNode(left: PrCommentThreadNode, right: PrCommentThreadNode): number {
  const timeDelta = compareIsoTimeAsc(left.commentTime, right.commentTime);
  if (timeDelta !== 0) {
    return timeDelta;
  }
  return left.id.localeCompare(right.id);
}

function compareIsoTimeAsc(left?: string, right?: string): number {
  const leftMs = left ? Date.parse(left) : Number.NaN;
  const rightMs = right ? Date.parse(right) : Number.NaN;
  const leftValue = Number.isFinite(leftMs) ? leftMs : 0;
  const rightValue = Number.isFinite(rightMs) ? rightMs : 0;
  return leftValue - rightValue;
}

function compareIsoTimeDesc(left?: string, right?: string): number {
  return compareIsoTimeAsc(right, left);
}

function parseIsoTimeOption(value: string | undefined, optionName: string): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new CliError(`Invalid ${optionName} value: ${value}. Expected ISO-8601 datetime.`);
  }
  return parsed;
}

function normalizePrThreadsSort(value: string): "latest" | "oldest" {
  if (value === "latest" || value === "oldest") {
    return value;
  }
  throw new CliError(`Invalid --sort value: ${value}. Use latest or oldest.`);
}

function normalizePrStatusOutputFormat(format: string, jsonFlag?: boolean): "table" | "tsv" | "json" {
  if (format === "table" || format === "tsv" || format === "json") {
    return jsonFlag ? "json" : format;
  }
  throw new CliError(`Invalid --format value: ${format}. Use table, tsv, or json.`);
}

function normalizePrViewOutputFormat(format: string, jsonFlag?: boolean): "table" | "tsv" | "json" {
  if (format === "table" || format === "tsv" || format === "json") {
    return jsonFlag ? "json" : format;
  }
  throw new CliError(`Invalid --format value: ${format}. Use table, tsv, or json.`);
}

function normalizePrCheckoutOutputFormat(format: string, jsonFlag?: boolean): "table" | "tsv" | "json" {
  if (format === "table" || format === "tsv" || format === "json") {
    return jsonFlag ? "json" : format;
  }
  throw new CliError(`Invalid --format value: ${format}. Use table, tsv, or json.`);
}

function normalizePrCommentWriteOutputFormat(format: string, jsonFlag?: boolean): "table" | "tsv" | "json" {
  if (format === "table" || format === "tsv" || format === "json") {
    return jsonFlag ? "json" : format;
  }
  throw new CliError(`Invalid --format value: ${format}. Use table, tsv, or json.`);
}

function normalizePrCreateOutputFormat(format: string, jsonFlag?: boolean): "table" | "tsv" | "json" {
  if (format === "table" || format === "tsv" || format === "json") {
    return jsonFlag ? "json" : format;
  }
  throw new CliError(`Invalid --format value: ${format}. Use table, tsv, or json.`);
}

function normalizePrMergeOutputFormat(format: string, jsonFlag?: boolean): "table" | "tsv" | "json" {
  if (format === "table" || format === "tsv" || format === "json") {
    return jsonFlag ? "json" : format;
  }
  throw new CliError(`Invalid --format value: ${format}. Use table, tsv, or json.`);
}

function normalizePrTransitionOutputFormat(format: string, jsonFlag?: boolean): "table" | "tsv" | "json" {
  if (format === "table" || format === "tsv" || format === "json") {
    return jsonFlag ? "json" : format;
  }
  throw new CliError(`Invalid --format value: ${format}. Use table, tsv, or json.`);
}

function normalizePrReviewOutputFormat(format: string, jsonFlag?: boolean): "table" | "tsv" | "json" {
  if (format === "table" || format === "tsv" || format === "json") {
    return jsonFlag ? "json" : format;
  }
  throw new CliError(`Invalid --format value: ${format}. Use table, tsv, or json.`);
}

function normalizePrEditOutputFormat(format: string, jsonFlag?: boolean): "table" | "tsv" | "json" {
  if (format === "table" || format === "tsv" || format === "json") {
    return jsonFlag ? "json" : format;
  }
  throw new CliError(`Invalid --format value: ${format}. Use table, tsv, or json.`);
}

function normalizePrListOutputFormat(format: string, jsonFlag?: boolean): "table" | "tsv" | "json" {
  if (format === "table" || format === "tsv" || format === "json") {
    return jsonFlag ? "json" : format;
  }
  throw new CliError(`Invalid --format value: ${format}. Use table, tsv, or json.`);
}

function normalizePrCommentsOutputFormat(format: string, jsonFlag?: boolean): "table" | "tsv" | "json" {
  if (format === "table" || format === "tsv" || format === "json") {
    return jsonFlag ? "json" : format;
  }
  throw new CliError(`Invalid --format value: ${format}. Use table, tsv, or json.`);
}

function normalizePrPatchsetsOutputFormat(format: string, jsonFlag?: boolean): "table" | "tsv" | "json" {
  if (format === "table" || format === "tsv" || format === "json") {
    return jsonFlag ? "json" : format;
  }
  throw new CliError(`Invalid --format value: ${format}. Use table, tsv, or json.`);
}

function normalizePrReviewsOutputFormat(format: string, jsonFlag?: boolean): "table" | "tsv" | "json" {
  if (format === "table" || format === "tsv" || format === "json") {
    return jsonFlag ? "json" : format;
  }
  throw new CliError(`Invalid --format value: ${format}. Use table, tsv, or json.`);
}

function normalizePrChecksOutputFormat(format: string, jsonFlag?: boolean): "table" | "tsv" | "json" {
  if (format === "table" || format === "tsv" || format === "json") {
    return jsonFlag ? "json" : format;
  }
  throw new CliError(`Invalid --format value: ${format}. Use table, tsv, or json.`);
}

function normalizePrFilesOutputFormat(format: string, jsonFlag?: boolean): "table" | "tsv" | "json" {
  if (format === "table" || format === "tsv" || format === "json") {
    return jsonFlag ? "json" : format;
  }
  throw new CliError(`Invalid --format value: ${format}. Use table, tsv, or json.`);
}

function normalizePrDiffOutputFormat(format: string, jsonFlag?: boolean): "table" | "tsv" | "json" {
  if (format === "table" || format === "tsv" || format === "json") {
    return jsonFlag ? "json" : format;
  }
  throw new CliError(`Invalid --format value: ${format}. Use table, tsv, or json.`);
}

function normalizePrThreadsOutputFormat(format: string, jsonFlag?: boolean): "table" | "tsv" | "json" {
  if (format === "table" || format === "tsv" || format === "json") {
    return jsonFlag ? "json" : format;
  }
  throw new CliError(`Invalid --format value: ${format}. Use table, tsv, or json.`);
}

function formatPrThreadsOutput(
  payload: PrCommentThreadsSummary | PrCommentThreadCompact[] | PrCommentThread[],
  format: "table" | "tsv" | "json",
  isSummary: boolean
): string {
  if (format === "json") {
    return `${JSON.stringify(payload, null, 2)}\n`;
  }
  if (format === "tsv") {
    if (isSummary) {
      return `${formatPrThreadsSummaryTsv(payload as PrCommentThreadsSummary)}\n`;
    }
    return `${formatPrThreadsTsv(payload as PrCommentThreadCompact[])}\n`;
  }
  throw new CliError("`--out` requires --format tsv/json (or --json).");
}

async function writePrThreadsOutputFile(path: string, content: string): Promise<void> {
  await writeFile(path, content, "utf-8");
}

function renderPrCommentThreads(threads: PrCommentThread[]): void {
  if (threads.length === 0) {
    process.stdout.write("No comment threads.\n");
    return;
  }

  for (const thread of threads) {
    const header = [
      `[${thread.resolved ? "resolved" : "open"}]`,
      `thread=${thread.threadId}`,
      `comments=${thread.totalComments}`,
      thread.commentType ? `type=${thread.commentType}` : "",
      thread.filePaths.length > 0 ? `files=${thread.filePaths.join(",")}` : "",
    ]
      .filter(Boolean)
      .join(" ");
    process.stdout.write(`${header}\n`);

    const comments = [thread.rootComment, ...thread.replies];
    for (const item of comments) {
      const author = extractPrCommentAuthor(item) ?? "(unknown)";
      const time = readStringIn(item, ["comment_time", "commentTime", "createTime", "commentAt"]) ?? "-";
      const content = formatThreadCommentPreview(readStringIn(item, ["content", "body", "text", "message"]) ?? "");
      const marker = item.resolved === true || item.resolved === "true" || item.resolved === 1 ? "resolved" : "open";
      process.stdout.write(`  - [${marker}] ${author} @ ${time}: ${content}\n`);
    }
  }
}

function summarizePrCommentThreadsSummary(threads: PrCommentThread[]): PrCommentThreadsSummary {
  const byFile = new Map<string, { threads: number; comments: number }>();
  const summary: PrCommentThreadsSummary = {
    totalThreads: threads.length,
    openThreads: 0,
    resolvedThreads: 0,
    totalComments: 0,
    byType: {
      global: 0,
      inline: 0,
      unknown: 0,
    },
    byState: {
      opened: 0,
      draft: 0,
      other: 0,
    },
    files: [],
  };

  for (const thread of threads) {
    summary.totalComments += thread.totalComments;
    if (thread.resolved) {
      summary.resolvedThreads += 1;
    } else {
      summary.openThreads += 1;
    }

    const commentType = (thread.commentType ?? "").toUpperCase();
    if (commentType === "GLOBAL_COMMENT") {
      summary.byType.global += 1;
    } else if (commentType === "INLINE_COMMENT") {
      summary.byType.inline += 1;
    } else {
      summary.byType.unknown += 1;
    }

    const state = (thread.state ?? "").toUpperCase();
    if (state === "OPENED") {
      summary.byState.opened += 1;
    } else if (state === "DRAFT") {
      summary.byState.draft += 1;
    } else {
      summary.byState.other += 1;
    }

    for (const filePath of thread.filePaths) {
      const current = byFile.get(filePath) ?? { threads: 0, comments: 0 };
      current.threads += 1;
      current.comments += thread.totalComments;
      byFile.set(filePath, current);
    }
  }

  summary.files = Array.from(byFile.entries())
    .map(([path, item]) => ({
      path,
      threads: item.threads,
      comments: item.comments,
    }))
    .sort((left, right) => {
      if (left.threads !== right.threads) {
        return right.threads - left.threads;
      }
      if (left.comments !== right.comments) {
        return right.comments - left.comments;
      }
      return left.path.localeCompare(right.path);
    });

  return summary;
}

function compactPrCommentThreads(threads: PrCommentThread[]): PrCommentThreadCompact[] {
  return threads.map((thread) => {
    const rootCommentBizId = readCommentBizId(thread.rootComment) ?? thread.threadId;
    const replyCommentBizIds = thread.replies
      .map((item) => readCommentBizId(item))
      .filter((item): item is string => Boolean(item));
    return {
      threadId: thread.threadId,
      rootCommentBizId,
      replyCommentBizIds,
      commentBizIds: [rootCommentBizId, ...replyCommentBizIds],
      totalComments: thread.totalComments,
      resolved: thread.resolved,
      lastCommentAt: thread.lastCommentAt,
      commentType: thread.commentType,
      state: thread.state,
      filePaths: thread.filePaths,
      participants: thread.participants,
    };
  });
}

function renderPrThreadsTsv(threads: PrCommentThreadCompact[]): void {
  process.stdout.write(`${formatPrThreadsTsv(threads)}\n`);
}

function renderPrThreadsSummaryTsv(summary: PrCommentThreadsSummary): void {
  process.stdout.write(`${formatPrThreadsSummaryTsv(summary)}\n`);
}

function formatPrThreadsTsv(threads: PrCommentThreadCompact[]): string {
  return [
    [
      "threadId",
      "rootCommentBizId",
      "totalComments",
      "resolved",
      "lastCommentAt",
      "commentType",
      "state",
      "filePaths",
      "participants",
      "commentBizIds",
    ].join("\t"),
    ...threads.map((item) =>
      [
        item.threadId,
        item.rootCommentBizId,
        String(item.totalComments),
        item.resolved ? "true" : "false",
        item.lastCommentAt ?? "",
        item.commentType ?? "",
        item.state ?? "",
        item.filePaths.join(","),
        item.participants.join(","),
        item.commentBizIds.join(","),
      ]
        .map(escapeTsvCell)
        .join("\t")
    ),
  ].join("\n");
}

function formatPrThreadsSummaryTsv(summary: PrCommentThreadsSummary): string {
  const lines = [["section", "key", "value"].join("\t")];
  lines.push(["overall", "totalThreads", String(summary.totalThreads)].join("\t"));
  lines.push(["overall", "openThreads", String(summary.openThreads)].join("\t"));
  lines.push(["overall", "resolvedThreads", String(summary.resolvedThreads)].join("\t"));
  lines.push(["overall", "totalComments", String(summary.totalComments)].join("\t"));
  lines.push(["byType", "global", String(summary.byType.global)].join("\t"));
  lines.push(["byType", "inline", String(summary.byType.inline)].join("\t"));
  lines.push(["byType", "unknown", String(summary.byType.unknown)].join("\t"));
  lines.push(["byState", "opened", String(summary.byState.opened)].join("\t"));
  lines.push(["byState", "draft", String(summary.byState.draft)].join("\t"));
  lines.push(["byState", "other", String(summary.byState.other)].join("\t"));

  for (const file of summary.files) {
    lines.push(["file", `${file.path}.threads`, String(file.threads)].map(escapeTsvCell).join("\t"));
    lines.push(["file", `${file.path}.comments`, String(file.comments)].map(escapeTsvCell).join("\t"));
  }

  return lines.join("\n");
}

function escapeTsvCell(value: string): string {
  return value.replace(/\r?\n/g, " ").replace(/\t/g, " ");
}

function slicePrCommentThreads(threads: PrCommentThread[], limit: number): {
  items: PrCommentThread[];
  total: number;
  truncated: boolean;
} {
  const safeLimit = Math.max(1, limit);
  const items = threads.slice(0, safeLimit);
  return {
    items,
    total: threads.length,
    truncated: threads.length > items.length,
  };
}

function formatThreadCommentPreview(content: string): string {
  const compact = content.replace(/\s+/g, " ").trim();
  if (!compact) {
    return "(empty)";
  }
  if (compact.length <= 120) {
    return compact;
  }
  return `${compact.slice(0, 117)}...`;
}

function extractFirstRecord(response: unknown, keys: string[]): Record<string, unknown> | undefined {
  if (!isRecord(response)) {
    return undefined;
  }

  for (const key of keys) {
    const value = response[key];
    if (isRecord(value)) {
      return value;
    }
  }
  return undefined;
}

function summarizePrChecks(
  detail: unknown,
  checkRuns?: Record<string, unknown>[],
  commitStatuses?: Record<string, unknown>[]
): PrChecksResult {
  const checks: PrCheckItem[] = [];
  if (checkRuns?.length) {
    for (const item of checkRuns) {
      const check = normalizeCheckItem(item);
      if (check) {
        checks.push(check);
      }
    }
  }
  if (commitStatuses?.length) {
    for (const item of commitStatuses) {
      const check = normalizeCheckItem(item);
      if (check) {
        checks.push(check);
      }
    }
  }

  if (isRecord(detail)) {
    const conflictStatus = readStringIn(detail, ["conflictCheckStatus"]);
    if (conflictStatus) {
      checks.push({
        name: "conflict",
        status: conflictStatus,
        conclusion: normalizeCheckConclusion(conflictStatus),
      });
    }

    if (typeof detail.allRequirementsPass === "boolean") {
      checks.push({
        name: "requirements",
        status: detail.allRequirementsPass ? "PASS" : "FAIL",
        conclusion: detail.allRequirementsPass ? "pass" : "fail",
      });
    }

    for (const key of ["checks", "checkRuns", "check_runs", "pipelines", "pipelineRuns", "jobs", "builds", "statuses", "contexts"]) {
      const value = detail[key];
      if (!Array.isArray(value)) {
        continue;
      }

      for (const item of value) {
        if (!isRecord(item)) {
          continue;
        }
        const check = normalizeCheckItem(item);
        if (check) {
          checks.push(check);
        }
      }
    }

    if (checks.length === 0) {
      const prStatus = readStringIn(detail, ["status", "state"]);
      if (prStatus) {
        checks.push({
          name: "pull-request",
          status: prStatus,
          conclusion: normalizeCheckConclusion(prStatus),
        });
      }
    }
  }

  const deduped = dedupeChecks(checks);
  const counts = {
    total: deduped.length,
    pass: deduped.filter((item) => item.conclusion === "pass").length,
    fail: deduped.filter((item) => item.conclusion === "fail").length,
    pending: deduped.filter((item) => item.conclusion === "pending").length,
    neutral: deduped.filter((item) => item.conclusion === "neutral").length,
  };

  return {
    ...counts,
    checks: deduped,
    pullRequestStatus: isRecord(detail) ? readStringIn(detail, ["status", "state"]) : undefined,
  };
}

function formatPrChecksTsv(result: PrChecksResult): string {
  const lines = [["section", "name", "status", "conclusion", "description", "url", "key", "value"].join("\t")];
  lines.push(["summary", "", "", "", "", "", "total", String(result.total)].join("\t"));
  lines.push(["summary", "", "", "", "", "", "pass", String(result.pass)].join("\t"));
  lines.push(["summary", "", "", "", "", "", "fail", String(result.fail)].join("\t"));
  lines.push(["summary", "", "", "", "", "", "pending", String(result.pending)].join("\t"));
  lines.push(["summary", "", "", "", "", "", "neutral", String(result.neutral)].join("\t"));
  if (result.pullRequestStatus) {
    lines.push(["summary", "", "", "", "", "", "pullRequestStatus", result.pullRequestStatus].map(escapeTsvCell).join("\t"));
  }

  for (const item of result.checks) {
    lines.push(
      [
        "check",
        item.name,
        item.status,
        item.conclusion,
        item.description ?? "",
        item.url ?? "",
        "",
        "",
      ]
        .map(escapeTsvCell)
        .join("\t")
    );
  }

  return lines.join("\n");
}

function formatPrChecksOutput(result: PrChecksResult, format: "table" | "tsv" | "json"): string {
  if (format === "json") {
    return `${JSON.stringify(result, null, 2)}\n`;
  }
  if (format === "tsv") {
    return `${formatPrChecksTsv(result)}\n`;
  }
  throw new CliError("`--out` requires --format tsv/json (or --json).");
}

async function writePrChecksOutputFile(path: string, content: string): Promise<void> {
  await writeFile(path, content, "utf-8");
}

async function tryListCheckRunsForPr(client: YunxiaoApiClient, input: {
  organizationId: string;
  repositoryId: string;
  detail: unknown;
}): Promise<Record<string, unknown>[]> {
  if (!isRecord(input.detail)) {
    return [];
  }

  const ref = readPrCheckRef(input.detail);
  if (!ref) {
    return [];
  }

  try {
    const response = await listCheckRuns(client, {
      organizationId: input.organizationId,
      repositoryId: input.repositoryId,
      ref,
      page: 1,
      perPage: 100,
    });
    return extractRecords(response);
  } catch {
    return [];
  }
}

async function tryListCommitStatusesForPr(client: YunxiaoApiClient, input: {
  organizationId: string;
  repositoryId: string;
  detail: unknown;
}): Promise<Record<string, unknown>[]> {
  if (!isRecord(input.detail)) {
    return [];
  }

  const sha = await resolvePrHeadSha(client, {
    organizationId: input.organizationId,
    repositoryId: input.repositoryId,
    detail: input.detail,
  });
  if (!sha) {
    return [];
  }

  try {
    const response = await listCommitStatuses(client, {
      organizationId: input.organizationId,
      repositoryId: input.repositoryId,
      sha,
      page: 1,
      perPage: 100,
    });
    return extractRecords(response);
  } catch {
    return [];
  }
}

async function resolvePrHeadSha(client: YunxiaoApiClient, input: {
  organizationId: string;
  repositoryId: string;
  detail: Record<string, unknown>;
}): Promise<string | undefined> {
  const direct = readPrHeadSha(input.detail);
  if (direct) {
    return direct;
  }

  const sourceBranch = readPrSourceBranch(input.detail);
  if (!sourceBranch) {
    return undefined;
  }

  try {
    const response = await listRepositoryBranches(client, {
      organizationId: input.organizationId,
      repositoryId: input.repositoryId,
      page: 1,
      perPage: 100,
      search: sourceBranch,
    });
    const branches = extractRecords(response);
    const exact = branches.find((item) => readStringIn(item, ["name"]) === sourceBranch);
    if (exact) {
      return readBranchCommitSha(exact);
    }

    for (const item of branches) {
      const sha = readBranchCommitSha(item);
      if (sha) {
        return sha;
      }
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function readBranchCommitSha(branch: Record<string, unknown>): string | undefined {
  const direct = readStringIn(branch, ["commitId", "headSha", "sha"]);
  if (direct) {
    return direct;
  }

  const commit = branch.commit;
  if (isRecord(commit)) {
    return readStringIn(commit, ["id", "sha", "commitId"]);
  }

  return undefined;
}

function readPrCheckRef(detail: Record<string, unknown>): string | undefined {
  const sha = readPrHeadSha(detail);
  if (sha) {
    return sha;
  }

  return readPrSourceBranch(detail);
}

function readPrHeadSha(detail: Record<string, unknown>): string | undefined {
  return readStringIn(detail, [
    "sourceCommitSha",
    "sourceHeadSha",
    "headSha",
    "sourceSha",
    "lastCommitSha",
    "sourceLatestCommitSha",
    "latestCommitSha",
  ]);
}

function normalizeCheckItem(item: Record<string, unknown>): PrCheckItem | undefined {
  const name =
    readStringIn(item, ["name", "title", "context", "jobName", "pipelineName", "checkName", "displayName"]) ??
    readStringIn(item, ["id", "jobId", "pipelineId"]);
  const status = readStringIn(item, ["status", "state", "conclusion", "result", "checkStatus", "reviewOpinionStatus"]);
  if (!name && !status) {
    return undefined;
  }

  return {
    name: name ?? "check",
    status: status ?? "UNKNOWN",
    conclusion: normalizeCheckConclusion(status ?? "UNKNOWN"),
    description: readStringIn(item, ["description", "message", "summary", "detail"]),
    url: readStringIn(item, ["url", "webUrl", "detailUrl", "detailsUrl", "targetUrl", "link"]),
  };
}

function normalizeCheckConclusion(value: string): PrCheckConclusion {
  const status = value.toLowerCase();
  if (!status) {
    return "neutral";
  }

  if (["no_conflict"].includes(status)) {
    return "pass";
  }
  if (["has_conflict"].includes(status)) {
    return "fail";
  }
  if (["checking"].includes(status)) {
    return "pending";
  }

  const failKeywords = ["fail", "error", "conflict", "reject", "cancel", "timeout", "blocked"];
  for (const keyword of failKeywords) {
    if (status.includes(keyword)) {
      return "fail";
    }
  }

  const passKeywords = ["success", "succeed", "passed", "pass", "ok", "approve", "merge", "done", "resolved"];
  for (const keyword of passKeywords) {
    if (status.includes(keyword)) {
      return "pass";
    }
  }

  const pendingKeywords = ["pending", "running", "checking", "wait", "queue", "process", "review", "open", "under_"];
  for (const keyword of pendingKeywords) {
    if (status.includes(keyword)) {
      return "pending";
    }
  }

  return "neutral";
}

function dedupeChecks(checks: PrCheckItem[]): PrCheckItem[] {
  const seen = new Set<string>();
  const result: PrCheckItem[] = [];

  for (const check of checks) {
    const key = `${check.name}|${check.status}|${check.description ?? ""}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(check);
  }

  return result;
}

function summarizePrComments(comments: Record<string, unknown>[]): PrCommentsSummary {
  const summary: PrCommentsSummary = {
    total: comments.length,
    byType: {
      global: 0,
      inline: 0,
      unknown: 0,
    },
    byState: {
      opened: 0,
      draft: 0,
      other: 0,
    },
    resolved: {
      resolved: 0,
      unresolved: 0,
    },
    replies: {
      root: 0,
      reply: 0,
    },
    files: [],
  };
  const fileCounts = new Map<string, number>();

  for (const item of comments) {
    const type = (readStringIn(item, ["comment_type", "commentType", "type"]) ?? "").toUpperCase();
    if (type === "GLOBAL_COMMENT") {
      summary.byType.global += 1;
    } else if (type === "INLINE_COMMENT") {
      summary.byType.inline += 1;
    } else {
      summary.byType.unknown += 1;
    }

    const state = (readStringIn(item, ["state"]) ?? "").toUpperCase();
    if (state === "OPENED") {
      summary.byState.opened += 1;
    } else if (state === "DRAFT") {
      summary.byState.draft += 1;
    } else {
      summary.byState.other += 1;
    }

    if (item.resolved === true || item.resolved === "true" || item.resolved === 1) {
      summary.resolved.resolved += 1;
    } else {
      summary.resolved.unresolved += 1;
    }

    const parentCommentBizId = readStringIn(item, ["parent_comment_biz_id", "parentCommentBizId", "parentId"]);
    if (parentCommentBizId) {
      summary.replies.reply += 1;
    } else {
      summary.replies.root += 1;
    }

    const filePath = readCommentFilePath(item);
    if (filePath) {
      fileCounts.set(filePath, (fileCounts.get(filePath) ?? 0) + 1);
    }
  }

  summary.files = Array.from(fileCounts.entries())
    .map(([path, count]) => ({ path, count }))
    .sort((left, right) => {
      if (left.count !== right.count) {
        return right.count - left.count;
      }
      return left.path.localeCompare(right.path);
    });

  return summary;
}

function readCommentFilePath(input: Record<string, unknown>): string | undefined {
  const direct = readStringIn(input, ["file_path", "filePath", "path", "new_path", "newPath"]);
  if (direct) {
    return direct;
  }

  const location = input.location;
  if (isRecord(location)) {
    return readStringIn(location, ["file_path", "filePath", "path", "new_path", "newPath"]);
  }

  return undefined;
}

function formatPathTree(paths: string[]): string[] {
  type TreeNode = {
    isFile: boolean;
    children: Map<string, TreeNode>;
  };

  const root: TreeNode = {
    isFile: false,
    children: new Map(),
  };

  for (const rawPath of paths) {
    const normalized = rawPath.replace(/\\/g, "/").trim();
    if (!normalized) {
      continue;
    }

    const parts = normalized.split("/").filter(Boolean);
    if (parts.length === 0) {
      continue;
    }

    let current = root;
    for (let i = 0; i < parts.length; i += 1) {
      const part = parts[i];
      const isLeaf = i === parts.length - 1;
      const next = current.children.get(part) ?? {
        isFile: false,
        children: new Map<string, TreeNode>(),
      };
      if (isLeaf) {
        next.isFile = true;
      }
      current.children.set(part, next);
      current = next;
    }
  }

  const lines: string[] = [];
  const render = (node: TreeNode, prefix: string): void => {
    const entries = Array.from(node.children.entries());
    entries.sort((left, right) => {
      const [leftName, leftNode] = left;
      const [rightName, rightNode] = right;
      if (leftNode.isFile !== rightNode.isFile) {
        return leftNode.isFile ? 1 : -1;
      }
      return leftName.localeCompare(rightName);
    });

    entries.forEach(([name, child], index) => {
      const isLast = index === entries.length - 1;
      const branch = isLast ? "└── " : "├── ";
      lines.push(`${prefix}${branch}${name}`);
      if (child.children.size > 0) {
        const nextPrefix = `${prefix}${isLast ? "    " : "│   "}`;
        render(child, nextPrefix);
      }
    });
  };

  render(root, "");
  return lines;
}

function readStringIn(input: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(Math.round(value));
    }
  }
  return undefined;
}

function readNumberIn(input: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return undefined;
}

function resolveReviewOpinions(options: PrReviewOptions): string[] {
  if (options.opinion) {
    return [options.opinion];
  }

  const flags = [options.approve, options.requestChanges, options.comment].filter(Boolean).length;
  if (flags > 1) {
    throw new CliError("Choose only one review mode: --approve, --request-changes, or --comment.");
  }

  if (options.requestChanges) {
    return ["REJECT", "REQUEST_CHANGES"];
  }
  if (options.comment) {
    return ["COMMENT", "NO_OPINION"];
  }

  return ["PASS", "APPROVE"];
}

function statusKey(status: PrChecksResult): string {
  return `${status.pass}/${status.fail}/${status.pending}/${status.total}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type PrListOptions = {
  org?: string;
  repo?: string;
  authorIds?: string;
  reviewerIds?: string;
  state?: string;
  search?: string;
  page?: number;
  perPage?: number;
  orderBy?: string;
  sort?: string;
  format: string;
  out?: string;
  json?: boolean;
};

type PrViewOptions = {
  org?: string;
  comments?: boolean;
  commentsState: string;
  commentsLimit?: number;
  web?: boolean;
  format: string;
  out?: string;
  json?: boolean;
};

type PrCreateOptions = {
  org?: string;
  repo?: string;
  title: string;
  source: string;
  target: string;
  description?: string;
  reviewer?: string[];
  workItem?: string[];
  sourceProjectId?: string;
  targetProjectId?: string;
  aiReview?: boolean;
  format: string;
  out?: string;
  json?: boolean;
};

type PrEditOptions = {
  org?: string;
  title?: string;
  body?: string;
  bodyFile?: string;
  description?: string;
  base?: string;
  reviewer: string[];
  addReviewer: string[];
  removeReviewer: string[];
  format: string;
  out?: string;
  json?: boolean;
};

type PrStatusOptions = {
  org?: string;
  repo?: string;
  limit: number;
  format: string;
  out?: string;
  json?: boolean;
};

type PrCheckoutOptions = {
  org?: string;
  repoDir: string;
  remote: string;
  branch?: string;
  detach?: boolean;
  dryRun?: boolean;
  format: string;
  out?: string;
  json?: boolean;
};

type PrCommentOptions = {
  org?: string;
  body?: string;
  bodyFile?: string;
  inline?: boolean;
  file?: string;
  line?: number;
  patchset?: string;
  from?: string;
  to?: string;
  replyTo?: string;
  draft?: boolean;
  format: string;
  out?: string;
  json?: boolean;
};

type PrCommentEditOptions = {
  org?: string;
  body?: string;
  bodyFile?: string;
  format: string;
  out?: string;
  json?: boolean;
};

type PrCommentReplyOptions = {
  org?: string;
  body?: string;
  bodyFile?: string;
  patchset?: string;
  draft?: boolean;
  format: string;
  out?: string;
  json?: boolean;
};

type PrCommentDeleteOptions = {
  org?: string;
  yes?: boolean;
  format: string;
  out?: string;
  json?: boolean;
};

type PrCommentResolveOptions = {
  org?: string;
  format: string;
  out?: string;
  json?: boolean;
};

type PrCommentsOptions = {
  org?: string;
  type: "all" | "global" | "inline";
  state: "opened" | "draft" | "all";
  file?: string;
  summary?: boolean;
  resolved?: boolean;
  format: string;
  out?: string;
  json?: boolean;
};

type PrThreadsOptions = {
  org?: string;
  state: string;
  file?: string;
  author: string[];
  mine?: boolean;
  withReplies?: boolean;
  since?: string;
  contains: string[];
  sort: string;
  format: string;
  out?: string;
  all?: boolean;
  limit: number;
  idsOnly?: boolean;
  summary?: boolean;
  json?: boolean;
};

type PrCommentBodyInput = {
  body?: string;
  bodyFile?: string;
};

type PrPatchsetsOptions = {
  org?: string;
  format: string;
  out?: string;
  json?: boolean;
};

type PrFilesOptions = {
  org?: string;
  from?: string;
  to?: string;
  tree?: boolean;
  stat?: boolean;
  limit: number;
  format: string;
  out?: string;
  json?: boolean;
};

type PrDiffOptions = {
  org?: string;
  from?: string;
  to?: string;
  file: string[];
  nameOnly?: boolean;
  files?: boolean;
  stat?: boolean;
  patch?: boolean;
  save?: string;
  limit: number;
  format: string;
  out?: string;
  json?: boolean;
};

type PrCommentsSummary = {
  total: number;
  byType: {
    global: number;
    inline: number;
    unknown: number;
  };
  byState: {
    opened: number;
    draft: number;
    other: number;
  };
  resolved: {
    resolved: number;
    unresolved: number;
  };
  replies: {
    root: number;
    reply: number;
  };
  files: Array<{
    path: string;
    count: number;
  }>;
};

type PrCommentThreadNode = {
  id: string;
  parentCommentBizId?: string;
  resolved: boolean;
  state?: string;
  commentType?: string;
  filePath?: string;
  commentTime?: string;
  author?: string;
  authorCandidates: string[];
  content?: string;
  raw: Record<string, unknown>;
};

type PrCommentThread = {
  threadId: string;
  resolved: boolean;
  totalComments: number;
  commentType?: string;
  state?: string;
  filePaths: string[];
  participants: string[];
  lastCommentAt?: string;
  rootComment: Record<string, unknown>;
  replies: Record<string, unknown>[];
};

type PrCommentThreadsSummary = {
  totalThreads: number;
  openThreads: number;
  resolvedThreads: number;
  totalComments: number;
  byType: {
    global: number;
    inline: number;
    unknown: number;
  };
  byState: {
    opened: number;
    draft: number;
    other: number;
  };
  files: Array<{
    path: string;
    threads: number;
    comments: number;
  }>;
};

type PrCommentThreadCompact = {
  threadId: string;
  rootCommentBizId: string;
  replyCommentBizIds: string[];
  commentBizIds: string[];
  totalComments: number;
  resolved: boolean;
  lastCommentAt?: string;
  commentType?: string;
  state?: string;
  filePaths: string[];
  participants: string[];
};

type PrReviewsOptions = {
  org?: string;
  format: string;
  out?: string;
  json?: boolean;
};

type PrReviewOptions = {
  org?: string;
  body?: string;
  bodyFile?: string;
  approve?: boolean;
  requestChanges?: boolean;
  comment?: boolean;
  opinion?: string;
  format: string;
  out?: string;
  json?: boolean;
};

type PrChecksOptions = {
  org?: string;
  watch?: boolean;
  interval: number;
  timeout: number;
  format: string;
  out?: string;
  json?: boolean;
};

type PrMergeOptions = {
  org?: string;
  mergeMessage?: string;
  method: "ff-only" | "no-fast-forward" | "squash" | "rebase";
  deleteBranch?: boolean;
  format: string;
  out?: string;
  json?: boolean;
};

type PrTransitionOptions = {
  org?: string;
  format: string;
  out?: string;
  json?: boolean;
};

type PrCheckConclusion = "pass" | "fail" | "pending" | "neutral";

type PrCheckItem = {
  name: string;
  status: string;
  conclusion: PrCheckConclusion;
  description?: string;
  url?: string;
};

type PrChecksResult = {
  total: number;
  pass: number;
  fail: number;
  pending: number;
  neutral: number;
  checks: PrCheckItem[];
  pullRequestStatus?: string;
};

type PrStatusBucket = {
  openCount: number;
  open: Record<string, unknown>[];
};

type PrStatusResult = {
  currentUserId: string;
  authored: PrStatusBucket;
  reviewRequested: PrStatusBucket;
};

type PrDiffResult = {
  changedFilesCount: number;
  totalAdditions: number;
  totalDeletions: number;
  files: Array<{
    path: string;
    additions?: number;
    deletions?: number;
    renamed: boolean;
    binary: boolean;
  }>;
  truncated: boolean;
};

type PrDiffRenderMode = "summary" | "paths" | "stat" | "patch";

type PrDiffCommandResult = {
  mode: PrDiffRenderMode;
  summary: PrDiffResult;
  payload: Record<string, unknown>;
  patchText?: string;
};

type PrPatchsetsSummary = {
  total: number;
  patchsets: Array<{
    id: string;
    version: number;
    type: PatchsetType;
    createdAt?: string;
    commitId?: string;
  }>;
  suggestedRange: {
    fromPatchSetBizId?: string;
    toPatchSetBizId?: string;
  };
};

type PrFilesRenderMode = "paths" | "tree" | "stat";

type PrPatchItem = {
  path: string;
  patch: string;
  renamed: boolean;
  binary: boolean;
};

type PrReviewerState = "approved" | "changes_requested" | "commented" | "pending";

type PrReviewerStatus = {
  name: string;
  userId?: string;
  state: PrReviewerState;
  reviewOpinionStatus?: string;
  reviewTime?: string;
};

type PrReviewsResult = {
  pullRequestStatus?: string;
  summary: {
    approved: number;
    changesRequested: number;
    commented: number;
    pending: number;
  };
  reviewers: PrReviewerStatus[];
};
