import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { Command } from "commander";
import { parsePositiveIntegerOption } from "../core/utils/options.js";
import { loadConfig } from "../core/config/store.js";
import { withApiClient } from "../core/api/client.js";
import {
  createWorkItem,
  createWorkItemComment,
  deleteWorkItem,
  deleteWorkItemComment,
  getWorkItem,
  getWorkItemTypeWorkflow,
  listProjectWorkItemTypes,
  listWorkItemTypeFields,
  listWorkItemComments,
  listWorkItemActivities,
  searchWorkItems,
  updateWorkItemComment,
  updateWorkItemFields,
  updateWorkItem,
} from "../core/api/workitem.js";
import { CliError } from "../core/errors.js";
import { printData } from "../core/output/print.js";
import { resolveOrganizationId, resolveProjectId } from "../core/utils/context.js";
import { resolveUserSelector } from "../core/utils/user.js";
import { YunxiaoApiClient } from "../core/api/client.js";
import { openInBrowser } from "../core/utils/browser.js";
import { resolveIssueWebUrl } from "../core/utils/web-url.js";

const CLOSED_STATUS_CANDIDATES = ["Closed", "Done", "Resolved", "已关闭", "已完成", "已解决"];
const REOPEN_STATUS_CANDIDATES = ["Open", "To Do", "In Progress", "Reopen", "待处理", "进行中", "已激活"];

export function registerIssueCommand(program: Command): void {
  const issue = program.command("issue").description("Issue commands (Bug workitem alias)");

  issue
    .command("list")
    .description("List issues (gh-compatible options)")
    .option("--org <organizationId>", "Organization ID")
    .option("--project <projectId>", "Project ID (spaceId)")
    .option("-s, --state <state>", "open | closed | all | <raw status>", "open")
    .option("-a, --assignee <userId>", "Assignee user ID, supports self")
    .option("-A, --author <userId>", "Author/creator user ID, supports self")
    .option("-l, --label <name>", "Label filter, repeatable", collect, [])
    .option("-S, --search <query>", "Search query in title")
    .option("-L, --limit <number>", "Maximum results", parsePositiveIntegerOption, 30)
    .option("--page <number>", "Start page", parsePositiveIntegerOption)
    .option("--per-page <number>", "Page size", parsePositiveIntegerOption)
    .option("--order-by <field>", "Order field", "gmtCreate")
    .option("--sort <direction>", "asc | desc", "desc")
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write issue list output to file")
    .option("--json", "Print raw JSON")
    .action(async (options: IssueListOptions) => {
      const config = loadConfig();
      const organizationId = resolveOrganizationId(config, options.org);
      const projectId = resolveProjectId(config, options.project);
      const outputFormat = normalizeIssueCommentOutputFormat(options.format, options.json);
      if (options.out && outputFormat === "table") {
        throw new CliError("`--out` requires --format tsv/json (or --json).");
      }
      const { mode, rawStatus } = parseStateOption(options.state);
      const fetchLimit =
        mode === "all" || rawStatus !== undefined
          ? options.limit
          : Math.min(Math.max(options.limit * 4, options.limit + 20), 400);

      const items = await withApiClient(config, (client) =>
        fetchIssuesWithLimit(client, {
          organizationId,
          projectId,
          limit: fetchLimit,
          page: options.page,
          perPage: options.perPage,
          orderBy: options.orderBy,
          sort: options.sort,
          subject: options.search,
          creator: options.author,
          assignee: options.assignee,
          tag: options.label.length ? options.label.join(",") : undefined,
          status: rawStatus,
        })
      );

      const filtered = filterIssuesByState(items, mode).slice(0, Math.max(1, options.limit));
      if (options.out) {
        await writeIssueOutputFile(options.out, formatIssueListOutput(filtered, outputFormat));
        process.stdout.write(`Saved issue list output to ${options.out}.\n`);
        return;
      }
      if (outputFormat === "tsv") {
        process.stdout.write(`${formatIssueListTsv(filtered)}\n`);
        return;
      }

      printData(filtered, { format: outputFormat === "json" ? "json" : "table" });
    });

  issue
    .command("view")
    .description("Show one issue")
    .argument("<issueId>", "Issue ID (workitem ID)")
    .option("--org <organizationId>", "Organization ID")
    .option("--web", "Open issue in browser", false)
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write issue view output to file")
    .option("--json", "Print raw JSON")
    .action(async (issueId: string, options: IssueViewOptions) => {
      const config = loadConfig();
      const organizationId = resolveOrganizationId(config, options.org);
      const outputFormat = normalizeIssueCommentOutputFormat(options.format, options.json);
      if (options.out && outputFormat === "table") {
        throw new CliError("`--out` requires --format tsv/json (or --json).");
      }

      const result = await withApiClient(config, (client) =>
        getWorkItem(client, {
          organizationId,
          workItemId: issueId,
        })
      );
      if (options.web && outputFormat !== "json") {
        const url = resolveIssueWebUrl(result);
        if (!url) {
          throw new CliError("Cannot resolve issue web URL from API response.");
        }
        openInBrowser(url);
        const webResult = {
          issueId,
          url,
          opened: true,
        };
        if (options.out) {
          await writeIssueOutputFile(options.out, formatIssueCommentOutput(webResult, outputFormat));
          process.stdout.write(`Saved issue view output to ${options.out}.\n`);
          return;
        }
        if (outputFormat === "tsv") {
          process.stdout.write(`${formatIssueCommentEntityTsv(webResult)}\n`);
          return;
        }
        printData(webResult, { format: "table" });
        return;
      }

      if (options.out) {
        await writeIssueOutputFile(options.out, formatIssueCommentOutput(result, outputFormat));
        process.stdout.write(`Saved issue view output to ${options.out}.\n`);
        return;
      }
      if (outputFormat === "tsv") {
        process.stdout.write(`${formatIssueCommentEntityTsv(result)}\n`);
        return;
      }

      printData(result, { format: outputFormat === "json" ? "json" : "table" });
    });

  issue
    .command("create")
    .description("Create one issue (Bug workitem)")
    .requiredOption("--project <projectId>", "Project ID (spaceId)")
    .requiredOption("-t, --title <title>", "Issue title")
    .option("--org <organizationId>", "Organization ID")
    .option("--type <workitemTypeId>", "Bug workitem type ID")
    .option("-a, --assignee <userId>", "Assignee user ID, default self")
    .option("-b, --body <text>", "Issue body")
    .option("--description <text>", "Issue description (alias of --body)")
    .option("--severity <value>", "Issue severity (name or option id), default medium")
    .option("-l, --label <name>", "Label, repeatable", collect, [])
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write issue create output to file")
    .option("--json", "Print raw JSON")
    .action(async (options: IssueCreateOptions) => {
      const config = loadConfig();
      const organizationId = resolveOrganizationId(config, options.org);
      const projectId = resolveProjectId(config, options.project);
      const description = options.body ?? options.description;
      const outputFormat = normalizeIssueCommentOutputFormat(options.format, options.json);
      if (options.out && outputFormat === "table") {
        throw new CliError("`--out` requires --format tsv/json (or --json).");
      }

      const result = await withApiClient(config, async (client) => {
        const assignee = await resolveUserSelector(client, options.assignee ?? "self");
        if (!assignee) {
          throw new CliError("Cannot resolve assignee. Pass --assignee <userId> or ensure current user is available.");
        }

        const workitemTypeId = options.type ?? (await resolveDefaultBugTypeId(client, organizationId, projectId));
        if (!workitemTypeId) {
          throw new CliError("Cannot resolve Bug workitem type ID. Pass --type <workitemTypeId> explicitly.");
        }

        const customFieldValues = await resolveIssueCreateCustomFields(client, {
          organizationId,
          projectId,
          workitemTypeId,
          severityInput: options.severity,
        });

        return createWorkItem(client, {
          organizationId,
          assignedTo: assignee,
          spaceId: projectId,
          subject: options.title,
          workitemTypeId,
          description,
          labels: options.label.length ? options.label : undefined,
          customFieldValues,
        });
      });

      if (options.out) {
        await writeIssueOutputFile(options.out, formatIssueCommentOutput(result, outputFormat));
        process.stdout.write(`Saved issue create output to ${options.out}.\n`);
        return;
      }
      if (outputFormat === "tsv") {
        process.stdout.write(`${formatIssueCommentEntityTsv(result)}\n`);
        return;
      }

      printData(result, { format: outputFormat === "json" ? "json" : "table" });
    });

  issue
    .command("edit")
    .description("Edit issue (gh-compatible alias of update)")
    .argument("<issueId>", "Issue ID (workitem ID)")
    .option("--org <organizationId>", "Organization ID")
    .option("-t, --title <title>", "Issue title")
    .option("-b, --body <text>", "Issue body")
    .option("--description <text>", "Issue description (alias of --body)")
    .option("-s, --state <status>", "Issue state/status")
    .option("-a, --assignee <userId>", "Assignee user ID, supports self")
    .option("--priority <priority>", "Priority")
    .option("-l, --label <name>", "Label, repeatable", collect, [])
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write issue edit output to file")
    .option("--json", "Print raw JSON")
    .action(async (issueId: string, options: IssueUpdateOptions) => {
      await runIssueUpdate(issueId, options);
    });

  issue
    .command("update")
    .description("Update one issue")
    .argument("<issueId>", "Issue ID (workitem ID)")
    .option("--org <organizationId>", "Organization ID")
    .option("--title <title>", "Issue title")
    .option("--description <text>", "Issue description")
    .option("--state <status>", "Issue state/status")
    .option("--assignee <userId>", "Assignee user ID, supports self")
    .option("--priority <priority>", "Priority")
    .option("--label <name>", "Label, repeatable", collect, [])
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write issue update output to file")
    .option("--json", "Print raw JSON")
    .action(async (issueId: string, options: IssueUpdateOptions) => {
      await runIssueUpdate(issueId, options);
    });

  issue
    .command("assign")
    .description("Assign issue to a user (gh-like)")
    .argument("<issueId>", "Issue ID (workitem ID)")
    .option("--org <organizationId>", "Organization ID")
    .option("-a, --assignee <userId>", "Assignee user ID, supports self", "self")
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write issue assign output to file")
    .option("--json", "Print raw JSON")
    .action(async (issueId: string, options: IssueAssignOptions) => {
      const config = loadConfig();
      const organizationId = resolveOrganizationId(config, options.org);
      const outputFormat = normalizeIssueCommentOutputFormat(options.format, options.json);
      if (options.out && outputFormat === "table") {
        throw new CliError("`--out` requires --format tsv/json (or --json).");
      }

      const result = await withApiClient(config, async (client) => {
        const assignee = await resolveUserSelector(client, options.assignee ?? "self");
        if (!assignee) {
          throw new CliError("Cannot resolve assignee. Pass --assignee <userId> or ensure current user is available.");
        }

        const response = await updateWorkItem(client, {
          organizationId,
          workItemId: issueId,
          assignedTo: assignee,
        });
        return {
          issueId,
          assignee,
          result: response,
        };
      });
      if (options.out) {
        await writeIssueOutputFile(options.out, formatIssueCommentOutput(result, outputFormat));
        process.stdout.write(`Saved issue assign output to ${options.out}.\n`);
        return;
      }
      if (outputFormat === "tsv") {
        process.stdout.write(`${formatIssueCommentEntityTsv(result)}\n`);
        return;
      }

      printData(result, {
        format: outputFormat === "json" ? "json" : "table",
      });
    });

  issue
    .command("unassign")
    .description("Remove assignee from issue (gh-like, template-dependent)")
    .argument("<issueId>", "Issue ID (workitem ID)")
    .option("--org <organizationId>", "Organization ID")
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write issue unassign output to file")
    .option("--json", "Print raw JSON")
    .action(async (issueId: string, options: IssueAssignOptions) => {
      const config = loadConfig();
      const organizationId = resolveOrganizationId(config, options.org);
      const outputFormat = normalizeIssueCommentOutputFormat(options.format, options.json);
      if (options.out && outputFormat === "table") {
        throw new CliError("`--out` requires --format tsv/json (or --json).");
      }

      const result = await withApiClient(config, (client) =>
        unassignIssue(client, {
          organizationId,
          issueId,
        })
      );
      if (options.out) {
        await writeIssueOutputFile(options.out, formatIssueCommentOutput(result, outputFormat));
        process.stdout.write(`Saved issue unassign output to ${options.out}.\n`);
        return;
      }
      if (outputFormat === "tsv") {
        process.stdout.write(`${formatIssueCommentEntityTsv(result)}\n`);
        return;
      }

      printData(result, {
        format: outputFormat === "json" ? "json" : "table",
      });
    });

  issue
    .command("close")
    .description("Close an issue")
    .argument("<issueId>", "Issue ID (workitem ID)")
    .option("--org <organizationId>", "Organization ID")
    .option("-s, --state <status>", "Explicit closed status to use")
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write issue close output to file")
    .option("--json", "Print raw JSON")
    .action(async (issueId: string, options: IssueTransitionOptions) => {
      const config = loadConfig();
      const organizationId = resolveOrganizationId(config, options.org);
      const outputFormat = normalizeIssueCommentOutputFormat(options.format, options.json);
      if (options.out && outputFormat === "table") {
        throw new CliError("`--out` requires --format tsv/json (or --json).");
      }

      const result = await withApiClient(config, async (client) =>
        transitionIssueStatus(client, {
          organizationId,
          issueId,
          action: "close",
          explicitStatus: options.state,
        })
      );
      if (options.out) {
        await writeIssueOutputFile(options.out, formatIssueCommentOutput(result, outputFormat));
        process.stdout.write(`Saved issue close output to ${options.out}.\n`);
        return;
      }
      if (outputFormat === "tsv") {
        process.stdout.write(`${formatIssueCommentEntityTsv(result)}\n`);
        return;
      }

      printData(result, {
        format: outputFormat === "json" ? "json" : "table",
      });
    });

  issue
    .command("reopen")
    .description("Reopen an issue")
    .argument("<issueId>", "Issue ID (workitem ID)")
    .option("--org <organizationId>", "Organization ID")
    .option("-s, --state <status>", "Explicit open status to use")
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write issue reopen output to file")
    .option("--json", "Print raw JSON")
    .action(async (issueId: string, options: IssueTransitionOptions) => {
      const config = loadConfig();
      const organizationId = resolveOrganizationId(config, options.org);
      const outputFormat = normalizeIssueCommentOutputFormat(options.format, options.json);
      if (options.out && outputFormat === "table") {
        throw new CliError("`--out` requires --format tsv/json (or --json).");
      }

      const result = await withApiClient(config, async (client) =>
        transitionIssueStatus(client, {
          organizationId,
          issueId,
          action: "reopen",
          explicitStatus: options.state,
        })
      );
      if (options.out) {
        await writeIssueOutputFile(options.out, formatIssueCommentOutput(result, outputFormat));
        process.stdout.write(`Saved issue reopen output to ${options.out}.\n`);
        return;
      }
      if (outputFormat === "tsv") {
        process.stdout.write(`${formatIssueCommentEntityTsv(result)}\n`);
        return;
      }

      printData(result, {
        format: outputFormat === "json" ? "json" : "table",
      });
    });

  issue
    .command("lock")
    .description("Lock issue conversation (gh-like, best effort)")
    .argument("<issueId>", "Issue ID (workitem ID)")
    .option("--org <organizationId>", "Organization ID")
    .option("-r, --reason <reason>", "Lock reason")
    .option("--field <fieldIdentifier>", "Custom lock field identifier, repeatable", collect, [])
    .option("--value <value>", "Custom lock field value, repeatable", collect, [])
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write issue lock output to file")
    .option("--json", "Print raw JSON")
    .action(async (issueId: string, options: IssueLockOptions) => {
      const config = loadConfig();
      const organizationId = resolveOrganizationId(config, options.org);
      const outputFormat = normalizeIssueCommentOutputFormat(options.format, options.json);
      if (options.out && outputFormat === "table") {
        throw new CliError("`--out` requires --format tsv/json (or --json).");
      }

      const result = await withApiClient(config, (client) =>
        applyIssueLockState(client, {
          organizationId,
          issueId,
          action: "lock",
          reason: options.reason,
          customFields: buildCustomLockFields(options.field, options.value, "lock"),
        })
      );
      if (options.out) {
        await writeIssueOutputFile(options.out, formatIssueCommentOutput(result, outputFormat));
        process.stdout.write(`Saved issue lock output to ${options.out}.\n`);
        return;
      }
      if (outputFormat === "tsv") {
        process.stdout.write(`${formatIssueCommentEntityTsv(result)}\n`);
        return;
      }

      printData(result, { format: outputFormat === "json" ? "json" : "table" });
    });

  issue
    .command("unlock")
    .description("Unlock issue conversation (gh-like, best effort)")
    .argument("<issueId>", "Issue ID (workitem ID)")
    .option("--org <organizationId>", "Organization ID")
    .option("--field <fieldIdentifier>", "Custom unlock field identifier, repeatable", collect, [])
    .option("--value <value>", "Custom unlock field value, repeatable", collect, [])
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write issue unlock output to file")
    .option("--json", "Print raw JSON")
    .action(async (issueId: string, options: IssueLockOptions) => {
      const config = loadConfig();
      const organizationId = resolveOrganizationId(config, options.org);
      const outputFormat = normalizeIssueCommentOutputFormat(options.format, options.json);
      if (options.out && outputFormat === "table") {
        throw new CliError("`--out` requires --format tsv/json (or --json).");
      }

      const result = await withApiClient(config, (client) =>
        applyIssueLockState(client, {
          organizationId,
          issueId,
          action: "unlock",
          customFields: buildCustomLockFields(options.field, options.value, "unlock"),
        })
      );
      if (options.out) {
        await writeIssueOutputFile(options.out, formatIssueCommentOutput(result, outputFormat));
        process.stdout.write(`Saved issue unlock output to ${options.out}.\n`);
        return;
      }
      if (outputFormat === "tsv") {
        process.stdout.write(`${formatIssueCommentEntityTsv(result)}\n`);
        return;
      }

      printData(result, { format: outputFormat === "json" ? "json" : "table" });
    });

  issue
    .command("pin")
    .description("Pin an issue (gh-like, best effort)")
    .argument("<issueId>", "Issue ID (workitem ID)")
    .option("--org <organizationId>", "Organization ID")
    .option("--field <fieldIdentifier>", "Custom pin field identifier, repeatable", collect, [])
    .option("--value <value>", "Custom pin field value, repeatable", collect, [])
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write issue pin output to file")
    .option("--json", "Print raw JSON")
    .action(async (issueId: string, options: IssuePinOptions) => {
      const config = loadConfig();
      const organizationId = resolveOrganizationId(config, options.org);
      const outputFormat = normalizeIssueCommentOutputFormat(options.format, options.json);
      if (options.out && outputFormat === "table") {
        throw new CliError("`--out` requires --format tsv/json (or --json).");
      }

      const result = await withApiClient(config, (client) =>
        applyIssuePinState(client, {
          organizationId,
          issueId,
          action: "pin",
          customFields: buildCustomPinFields(options.field, options.value, "pin"),
        })
      );
      if (options.out) {
        await writeIssueOutputFile(options.out, formatIssueCommentOutput(result, outputFormat));
        process.stdout.write(`Saved issue pin output to ${options.out}.\n`);
        return;
      }
      if (outputFormat === "tsv") {
        process.stdout.write(`${formatIssueCommentEntityTsv(result)}\n`);
        return;
      }

      printData(result, { format: outputFormat === "json" ? "json" : "table" });
    });

  issue
    .command("unpin")
    .description("Unpin an issue (gh-like, best effort)")
    .argument("<issueId>", "Issue ID (workitem ID)")
    .option("--org <organizationId>", "Organization ID")
    .option("--field <fieldIdentifier>", "Custom unpin field identifier, repeatable", collect, [])
    .option("--value <value>", "Custom unpin field value, repeatable", collect, [])
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write issue unpin output to file")
    .option("--json", "Print raw JSON")
    .action(async (issueId: string, options: IssuePinOptions) => {
      const config = loadConfig();
      const organizationId = resolveOrganizationId(config, options.org);
      const outputFormat = normalizeIssueCommentOutputFormat(options.format, options.json);
      if (options.out && outputFormat === "table") {
        throw new CliError("`--out` requires --format tsv/json (or --json).");
      }

      const result = await withApiClient(config, (client) =>
        applyIssuePinState(client, {
          organizationId,
          issueId,
          action: "unpin",
          customFields: buildCustomPinFields(options.field, options.value, "unpin"),
        })
      );
      if (options.out) {
        await writeIssueOutputFile(options.out, formatIssueCommentOutput(result, outputFormat));
        process.stdout.write(`Saved issue unpin output to ${options.out}.\n`);
        return;
      }
      if (outputFormat === "tsv") {
        process.stdout.write(`${formatIssueCommentEntityTsv(result)}\n`);
        return;
      }

      printData(result, { format: outputFormat === "json" ? "json" : "table" });
    });

  issue
    .command("transfer")
    .description("Transfer issue to another project (gh-like)")
    .argument("<issueId>", "Issue ID (workitem ID)")
    .requiredOption("--project <projectId>", "Target project ID (spaceId)")
    .option("--org <organizationId>", "Organization ID")
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write issue transfer output to file")
    .option("--json", "Print raw JSON")
    .action(async (issueId: string, options: IssueTransferOptions) => {
      const config = loadConfig();
      const organizationId = resolveOrganizationId(config, options.org);
      const outputFormat = normalizeIssueCommentOutputFormat(options.format, options.json);
      if (options.out && outputFormat === "table") {
        throw new CliError("`--out` requires --format tsv/json (or --json).");
      }

      const result = await withApiClient(config, async (client) => {
        const transferResult = await transferIssueProject(client, {
          organizationId,
          issueId,
          targetProjectId: options.project,
        });

        return {
          issueId,
          targetProjectId: options.project,
          ...transferResult,
        };
      });
      if (options.out) {
        await writeIssueOutputFile(options.out, formatIssueCommentOutput(result, outputFormat));
        process.stdout.write(`Saved issue transfer output to ${options.out}.\n`);
        return;
      }
      if (outputFormat === "tsv") {
        process.stdout.write(`${formatIssueCommentEntityTsv(result)}\n`);
        return;
      }

      printData(result, { format: outputFormat === "json" ? "json" : "table" });
    });

  issue
    .command("delete")
    .description("Delete an issue (gh-like)")
    .argument("<issueId>", "Issue ID (workitem ID)")
    .option("--org <organizationId>", "Organization ID")
    .option("--yes", "Skip confirmation", false)
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write issue delete output to file")
    .option("--json", "Print raw JSON")
    .action(async (issueId: string, options: IssueDeleteOptions) => {
      if (!options.yes) {
        throw new CliError("Refusing to delete issue without confirmation. Re-run with `--yes`.");
      }

      const config = loadConfig();
      const organizationId = resolveOrganizationId(config, options.org);
      const outputFormat = normalizeIssueCommentOutputFormat(options.format, options.json);
      if (options.out && outputFormat === "table") {
        throw new CliError("`--out` requires --format tsv/json (or --json).");
      }

      const result = await withApiClient(config, (client) =>
        deleteWorkItem(client, {
          organizationId,
          workItemId: issueId,
        })
      );
      if (options.out) {
        await writeIssueOutputFile(options.out, formatIssueCommentOutput(result, outputFormat));
        process.stdout.write(`Saved issue delete output to ${options.out}.\n`);
        return;
      }
      if (outputFormat === "tsv") {
        process.stdout.write(`${formatIssueCommentEntityTsv(result)}\n`);
        return;
      }

      printData(result, {
        format: outputFormat === "json" ? "json" : "table",
      });
    });

  issue
    .command("develop")
    .description("Create and checkout a local branch for this issue (gh-like)")
    .argument("<issueId>", "Issue ID (workitem ID)")
    .option("--org <organizationId>", "Organization ID")
    .option("--repo-dir <path>", "Local git repository path", ".")
    .option("--name <branch>", "Explicit branch name")
    .option("--prefix <prefix>", "Branch prefix when auto-generating name", "issue")
    .option("--base <ref>", "Base branch/ref for the new branch")
    .option("--force", "Use checkout -B to reset existing branch", false)
    .option("--dry-run", "Print git command without executing", false)
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write issue develop output to file")
    .option("--json", "Print raw JSON")
    .action(async (issueId: string, options: IssueDevelopOptions) => {
      const config = loadConfig();
      const organizationId = resolveOrganizationId(config, options.org);
      const outputFormat = normalizeIssueCommentOutputFormat(options.format, options.json);
      if (options.out && outputFormat === "table") {
        throw new CliError("`--out` requires --format tsv/json (or --json).");
      }

      const result = await withApiClient(config, async (client) => {
        const detail = await getWorkItem(client, {
          organizationId,
          workItemId: issueId,
        });
        const issue = extractIssueRecord(detail);
        const issueTitle = issue ? readIssueTitle(issue) : undefined;
        const branchName =
          options.name ?? buildIssueBranchName(options.prefix, issueId, issueTitle);

        const checkoutFlag = options.force ? "-B" : "-b";
        const command = ["git", "-C", options.repoDir, "checkout", checkoutFlag, branchName];
        if (options.base) {
          command.push(options.base);
        }

        if (options.dryRun) {
          return {
            issueId,
            issueTitle,
            branch: branchName,
            command: command.join(" "),
            executed: false,
          };
        }

        runGitCommand(command.slice(1));
        return {
          issueId,
          issueTitle,
          branch: branchName,
          basedOn: options.base,
          executed: true,
        };
      });
      if (options.out) {
        await writeIssueOutputFile(options.out, formatIssueCommentOutput(result, outputFormat));
        process.stdout.write(`Saved issue develop output to ${options.out}.\n`);
        return;
      }
      if (outputFormat === "tsv") {
        process.stdout.write(`${formatIssueCommentEntityTsv(result)}\n`);
        return;
      }

      printData(result, { format: outputFormat === "json" ? "json" : "table" });
    });

  issue
    .command("status")
    .description("Show issue status for current user")
    .option("--org <organizationId>", "Organization ID")
    .option("--project <projectId>", "Project ID (spaceId)")
    .option("-L, --limit <number>", "Maximum results per bucket", parsePositiveIntegerOption, 20)
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write issue status output to file")
    .option("--json", "Print raw JSON")
    .action(async (options: IssueStatusOptions) => {
      const config = loadConfig();
      const organizationId = resolveOrganizationId(config, options.org);
      const projectId = resolveProjectId(config, options.project);
      const outputFormat = normalizeIssueCommentOutputFormat(options.format, options.json);
      if (options.out && outputFormat === "table") {
        throw new CliError("`--out` requires --format tsv/json (or --json).");
      }

      const result = await withApiClient(config, async (client) => {
        const assigned = await fetchIssuesWithLimit(client, {
          organizationId,
          projectId,
          assignee: "self",
          limit: options.limit,
          orderBy: "gmtCreate",
          sort: "desc",
        });
        const created = await fetchIssuesWithLimit(client, {
          organizationId,
          projectId,
          creator: "self",
          limit: options.limit,
          orderBy: "gmtCreate",
          sort: "desc",
        });

        return {
          assigned: splitIssueStates(assigned),
          created: splitIssueStates(created),
        };
      });
      if (options.out) {
        await writeIssueOutputFile(options.out, formatIssueCommentOutput(result, outputFormat));
        process.stdout.write(`Saved issue status output to ${options.out}.\n`);
        return;
      }
      if (outputFormat === "tsv") {
        process.stdout.write(`${formatIssueCommentEntityTsv(result)}\n`);
        return;
      }

      printData(result, { format: outputFormat === "json" ? "json" : "table" });
    });

  issue
    .command("activities")
    .description("List issue activities")
    .argument("<issueId>", "Issue ID (workitem ID)")
    .option("--org <organizationId>", "Organization ID")
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write issue activities output to file")
    .option("--json", "Print raw JSON")
    .action(async (issueId: string, options: IssueActivitiesOptions) => {
      const config = loadConfig();
      const organizationId = resolveOrganizationId(config, options.org);
      const outputFormat = normalizeIssueCommentOutputFormat(options.format, options.json);
      if (options.out && outputFormat === "table") {
        throw new CliError("`--out` requires --format tsv/json (or --json).");
      }

      const result = await withApiClient(config, (client) =>
        listWorkItemActivities(client, {
          organizationId,
          workItemId: issueId,
        })
      );
      if (options.out) {
        await writeIssueOutputFile(options.out, formatIssueCommentOutput(result, outputFormat));
        process.stdout.write(`Saved issue activities output to ${options.out}.\n`);
        return;
      }
      if (outputFormat === "tsv") {
        process.stdout.write(`${formatIssueCommentEntityTsv(result)}\n`);
        return;
      }

      printData(result, { format: outputFormat === "json" ? "json" : "table" });
    });

  issue
    .command("fields")
    .description("List available fields for one issue template")
    .argument("<issueId>", "Issue ID (workitem ID)")
    .option("--org <organizationId>", "Organization ID")
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write issue fields output to file")
    .option("--json", "Print raw JSON")
    .action(async (issueId: string, options: IssueFieldsOptions) => {
      const config = loadConfig();
      const organizationId = resolveOrganizationId(config, options.org);
      const outputFormat = normalizeIssueCommentOutputFormat(options.format, options.json);
      if (options.out && outputFormat === "table") {
        throw new CliError("`--out` requires --format tsv/json (or --json).");
      }

      const result = await withApiClient(config, async (client) => {
        const detail = await getWorkItem(client, {
          organizationId,
          workItemId: issueId,
        });
        const issue = extractIssueRecord(detail);
        if (!issue) {
          throw new CliError("Unexpected issue detail response.");
        }

        const context = resolveIssueTemplateContext(issue);
        if (!context.projectId || !context.workItemTypeId) {
          throw new CliError("Cannot resolve issue project/workitem type. Please check this issue's template metadata.");
        }

        const fieldsRaw = await listWorkItemTypeFields(client, {
          organizationId,
          projectId: context.projectId,
          workItemTypeId: context.workItemTypeId,
        });
        const fields = normalizeIssueFields(fieldsRaw);

        return {
          issueId,
          projectId: context.projectId,
          workItemTypeId: context.workItemTypeId,
          fields,
          lockCandidates: collectFieldIdCandidates(fields, ["lock", "locked", "锁", "评论", "comment"]),
          pinCandidates: collectFieldIdCandidates(fields, ["pin", "pinned", "top", "置顶"]),
        };
      });
      if (options.out) {
        await writeIssueOutputFile(options.out, formatIssueCommentOutput(result, outputFormat));
        process.stdout.write(`Saved issue fields output to ${options.out}.\n`);
        return;
      }
      if (outputFormat === "tsv") {
        process.stdout.write(`${formatIssueCommentEntityTsv(result)}\n`);
        return;
      }

      printData(result, { format: outputFormat === "json" ? "json" : "table" });
    });

  issue
    .command("field-set")
    .description("Set one or more issue custom fields")
    .argument("<issueId>", "Issue ID (workitem ID)")
    .option("--org <organizationId>", "Organization ID")
    .option("--field <fieldIdentifier>", "Field identifier, repeatable", collect, [])
    .option("--value <fieldValue>", "Field value, repeatable", collect, [])
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write issue field-set output to file")
    .option("--json", "Print raw JSON")
    .action(async (issueId: string, options: IssueFieldSetOptions) => {
      const config = loadConfig();
      const organizationId = resolveOrganizationId(config, options.org);
      const outputFormat = normalizeIssueCommentOutputFormat(options.format, options.json);
      if (options.out && outputFormat === "table") {
        throw new CliError("`--out` requires --format tsv/json (or --json).");
      }
      if (!options.field.length) {
        throw new CliError("Missing --field. Use --field <fieldIdentifier> --value <fieldValue>.");
      }
      if (!options.value.length) {
        throw new CliError("Missing --value. Use --field <fieldIdentifier> --value <fieldValue>.");
      }
      if (options.field.length !== options.value.length) {
        throw new CliError("The number of --field and --value options must match.");
      }

      const fields = options.field
        .map((fieldIdentifier, index) => ({
          fieldIdentifier: fieldIdentifier.trim(),
          fieldValue: options.value[index],
        }))
        .filter((item) => item.fieldIdentifier);
      if (!fields.length) {
        throw new CliError("No valid --field values provided.");
      }

      const result = await withApiClient(config, async (client) => {
        const response = await applyIssueCustomFields(client, {
          organizationId,
          issueId,
          fields,
        });
        return {
          issueId,
          method: response.method,
          fields,
          response: response.result,
        };
      });
      if (options.out) {
        await writeIssueOutputFile(options.out, formatIssueCommentOutput(result, outputFormat));
        process.stdout.write(`Saved issue field-set output to ${options.out}.\n`);
        return;
      }
      if (outputFormat === "tsv") {
        process.stdout.write(`${formatIssueCommentEntityTsv(result)}\n`);
        return;
      }

      printData(result, {
        format: outputFormat === "json" ? "json" : "table",
      });
    });

  issue
    .command("comments")
    .description("List issue comments")
    .argument("<issueId>", "Issue ID (workitem ID)")
    .option("--org <organizationId>", "Organization ID")
    .option("--page <number>", "Page number", parsePositiveIntegerOption)
    .option("--per-page <number>", "Items per page", parsePositiveIntegerOption)
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write issue comments output to file")
    .option("--json", "Print raw JSON")
    .action(async (issueId: string, options: IssueCommentsOptions) => {
      const config = loadConfig();
      const organizationId = resolveOrganizationId(config, options.org);
      const outputFormat = normalizeIssueCommentOutputFormat(options.format, options.json);
      if (options.out && outputFormat === "table") {
        throw new CliError("`--out` requires --format tsv/json (or --json).");
      }

      const result = await withApiClient(config, (client) =>
        listWorkItemComments(client, {
          organizationId,
          workItemId: issueId,
          page: options.page,
          perPage: options.perPage,
        })
      );
      const comments = extractIssueCommentRecords(result);
      if (options.out) {
        await writeIssueOutputFile(options.out, formatIssueCommentsOutput(result, comments, outputFormat));
        process.stdout.write(`Saved issue comments output to ${options.out}.\n`);
        return;
      }
      if (outputFormat === "tsv") {
        process.stdout.write(`${formatIssueCommentListTsv(comments)}\n`);
        return;
      }

      printData(outputFormat === "json" ? result : comments, {
        format: outputFormat === "json" ? "json" : "table",
      });
    });

  issue
    .command("comment")
    .description("Create issue comment")
    .argument("<issueId>", "Issue ID (workitem ID)")
    .option("-b, --body <text>", "Comment body")
    .option("--content <text>", "Comment content (alias of --body)")
    .option("--org <organizationId>", "Organization ID")
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write issue comment output to file")
    .option("--json", "Print raw JSON")
    .action(async (issueId: string, options: IssueCommentOptions) => {
      const config = loadConfig();
      const organizationId = resolveOrganizationId(config, options.org);
      const outputFormat = normalizeIssueCommentOutputFormat(options.format, options.json);
      if (options.out && outputFormat === "table") {
        throw new CliError("`--out` requires --format tsv/json (or --json).");
      }
      const content = options.body ?? options.content;
      if (!content) {
        throw new CliError("Missing comment body. Use --body <text>.");
      }

      const result = await withApiClient(config, (client) =>
        createWorkItemComment(client, {
          organizationId,
          workItemId: issueId,
          content,
        })
      );
      if (options.out) {
        await writeIssueOutputFile(options.out, formatIssueCommentOutput(result, outputFormat));
        process.stdout.write(`Saved issue comment output to ${options.out}.\n`);
        return;
      }
      if (outputFormat === "tsv") {
        process.stdout.write(`${formatIssueCommentEntityTsv(result)}\n`);
        return;
      }

      printData(result, {
        format: outputFormat === "json" ? "json" : "table",
      });
    });

  issue
    .command("comment-edit")
    .description("Edit one issue comment")
    .argument("<issueId>", "Issue ID (workitem ID)")
    .argument("<commentId>", "Comment ID")
    .option("-b, --body <text>", "Comment body")
    .option("--content <text>", "Comment content (alias of --body)")
    .option("--comment-format <formatType>", "Comment format: MARKDOWN | RICHTEXT")
    .option("--org <organizationId>", "Organization ID")
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write issue comment edit output to file")
    .option("--json", "Print raw JSON")
    .action(async (issueId: string, commentId: string, options: IssueCommentEditOptions) => {
      const config = loadConfig();
      const organizationId = resolveOrganizationId(config, options.org);
      const outputFormat = normalizeIssueCommentOutputFormat(options.format, options.json);
      if (options.out && outputFormat === "table") {
        throw new CliError("`--out` requires --format tsv/json (or --json).");
      }
      const content = options.body ?? options.content;
      if (!content) {
        throw new CliError("Missing comment body. Use --body <text>.");
      }

      const result = await withApiClient(config, async (client) => {
        const formatType = await resolveIssueCommentFormatType(client, {
          organizationId,
          issueId,
          commentId,
          preferred: options.commentFormat,
        });

        return updateWorkItemComment(client, {
          organizationId,
          workItemId: issueId,
          commentId,
          content,
          formatType,
        });
      });
      if (options.out) {
        await writeIssueOutputFile(options.out, formatIssueCommentOutput(result, outputFormat));
        process.stdout.write(`Saved issue comment edit output to ${options.out}.\n`);
        return;
      }
      if (outputFormat === "tsv") {
        process.stdout.write(`${formatIssueCommentEntityTsv(result)}\n`);
        return;
      }

      printData(result, {
        format: outputFormat === "json" ? "json" : "table",
      });
    });

  issue
    .command("comment-delete")
    .description("Delete one issue comment")
    .argument("<issueId>", "Issue ID (workitem ID)")
    .argument("<commentId>", "Comment ID")
    .option("--org <organizationId>", "Organization ID")
    .option("--yes", "Skip confirmation", false)
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write issue comment delete output to file")
    .option("--json", "Print raw JSON")
    .action(async (issueId: string, commentId: string, options: IssueCommentDeleteOptions) => {
      if (!options.yes) {
        throw new CliError("Refusing to delete comment without confirmation. Re-run with `--yes`.");
      }

      const config = loadConfig();
      const organizationId = resolveOrganizationId(config, options.org);
      const outputFormat = normalizeIssueCommentOutputFormat(options.format, options.json);
      if (options.out && outputFormat === "table") {
        throw new CliError("`--out` requires --format tsv/json (or --json).");
      }
      const result = await withApiClient(config, (client) =>
        deleteWorkItemComment(client, {
          organizationId,
          workItemId: issueId,
          commentId,
        })
      );
      if (options.out) {
        await writeIssueOutputFile(options.out, formatIssueCommentOutput(result, outputFormat));
        process.stdout.write(`Saved issue comment delete output to ${options.out}.\n`);
        return;
      }
      if (outputFormat === "tsv") {
        process.stdout.write(`${formatIssueCommentEntityTsv(result)}\n`);
        return;
      }

      printData(result, {
        format: outputFormat === "json" ? "json" : "table",
      });
    });
}

function normalizeIssueCommentOutputFormat(format: string, jsonFlag?: boolean): "table" | "tsv" | "json" {
  if (jsonFlag) {
    return "json";
  }
  if (format === "table" || format === "tsv" || format === "json") {
    return format;
  }
  throw new CliError(`Invalid --format value: ${format}. Use table, tsv, or json.`);
}

function formatIssueListOutput(items: Record<string, unknown>[], format: "table" | "tsv" | "json"): string {
  if (format === "json") {
    return `${JSON.stringify(items, null, 2)}\n`;
  }
  if (format === "tsv") {
    return `${formatIssueListTsv(items)}\n`;
  }
  return `${JSON.stringify(items, null, 2)}\n`;
}

function formatIssueCommentsOutput(
  raw: unknown,
  comments: Record<string, unknown>[],
  format: "table" | "tsv" | "json"
): string {
  if (format === "json") {
    return `${JSON.stringify(raw, null, 2)}\n`;
  }
  if (format === "tsv") {
    return `${formatIssueCommentListTsv(comments)}\n`;
  }
  return `${JSON.stringify(comments, null, 2)}\n`;
}

function formatIssueCommentOutput(result: unknown, format: "table" | "tsv" | "json"): string {
  if (format === "json") {
    return `${JSON.stringify(result, null, 2)}\n`;
  }
  if (format === "tsv") {
    return `${formatIssueCommentEntityTsv(result)}\n`;
  }
  return `${JSON.stringify(result, null, 2)}\n`;
}

function formatIssueCommentListTsv(items: Record<string, unknown>[]): string {
  const columns = ["id", "commentId", "content", "creator", "createdAt", "updatedAt"];
  const header = columns.join("\t");
  if (items.length === 0) {
    return header;
  }
  const rows = items.map((item) =>
    columns
      .map((column) => {
        const value =
          column === "creator"
            ? item.creator ?? item.author
            : column === "createdAt"
              ? item.createdAt ?? item.gmtCreate
              : column === "updatedAt"
                ? item.updatedAt ?? item.gmtModified
                : item[column];
        return formatIssueTsvCell(value);
      })
      .join("\t")
  );
  return [header, ...rows].join("\n");
}

function formatIssueCommentEntityTsv(result: unknown): string {
  if (!isRecord(result)) {
    return `key\tvalue\nvalue\t${formatIssueTsvCell(result)}`;
  }
  const lines = ["key\tvalue"];
  for (const [key, value] of Object.entries(result)) {
    lines.push(`${key}\t${formatIssueTsvCell(value)}`);
  }
  return lines.join("\n");
}

function formatIssueListTsv(items: Record<string, unknown>[]): string {
  const columns = ["id", "identifier", "subject", "status", "assignee", "creator", "createdAt", "updatedAt"];
  const header = columns.join("\t");
  if (items.length === 0) {
    return header;
  }

  const rows = items.map((item) =>
    columns
      .map((column) => {
        if (column === "subject") {
          return formatIssueTsvCell(readIssueTitle(item));
        }
        if (column === "status") {
          return formatIssueTsvCell(readStatusText(item));
        }
        if (column === "assignee") {
          return formatIssueTsvCell(readIssueActor(item, "assignee"));
        }
        if (column === "creator") {
          return formatIssueTsvCell(readIssueActor(item, "creator"));
        }
        if (column === "createdAt") {
          return formatIssueTsvCell(item.createdAt ?? item.gmtCreate);
        }
        if (column === "updatedAt") {
          return formatIssueTsvCell(item.updatedAt ?? item.gmtModified);
        }
        return formatIssueTsvCell(item[column]);
      })
      .join("\t")
  );
  return [header, ...rows].join("\n");
}

function readIssueActor(item: Record<string, unknown>, type: "assignee" | "creator"): string | undefined {
  const directKeys =
    type === "assignee"
      ? ["assignedTo", "assignee", "owner", "assignedToUserId"]
      : ["creator", "author", "createdBy", "creatorId"];

  for (const key of directKeys) {
    const value = item[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (isRecord(value)) {
      for (const nestedKey of ["name", "displayName", "username", "nickName", "id", "userId"]) {
        const nestedValue = value[nestedKey];
        if (typeof nestedValue === "string" && nestedValue.trim()) {
          return nestedValue.trim();
        }
      }
    }
  }

  return undefined;
}

function extractIssueCommentRecords(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) {
    return payload.filter(isRecord);
  }
  if (!isRecord(payload)) {
    return [];
  }
  for (const key of ["comments", "items", "records", "result", "data"]) {
    const value = payload[key];
    if (Array.isArray(value)) {
      return value.filter(isRecord);
    }
  }
  if (isRecord(payload.body)) {
    return extractIssueCommentRecords(payload.body);
  }
  return [];
}

async function writeIssueOutputFile(path: string, content: string): Promise<void> {
  fs.writeFileSync(path, content, "utf8");
}

function formatIssueTsvCell(value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value === "string") {
    return value.replaceAll("\t", " ").replaceAll("\r", " ").replaceAll("\n", " ");
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value).replaceAll("\t", " ").replaceAll("\r", " ").replaceAll("\n", " ");
}

async function runIssueUpdate(issueId: string, options: IssueUpdateOptions): Promise<void> {
  const config = loadConfig();
  const organizationId = resolveOrganizationId(config, options.org);
  const description = options.body ?? options.description;
  const outputFormat = normalizeIssueCommentOutputFormat(options.format, options.json);
  if (options.out && outputFormat === "table") {
    throw new CliError("`--out` requires --format tsv/json (or --json).");
  }

  const result = await withApiClient(config, async (client) => {
    const assignee = await resolveUserSelector(client, options.assignee);

    const hasAnyUpdate =
      options.title !== undefined ||
      description !== undefined ||
      options.state !== undefined ||
      assignee !== undefined ||
      options.priority !== undefined ||
      options.label.length > 0;

    if (!hasAnyUpdate) {
      throw new CliError("No update fields provided. Use options like --state/--assignee/--description.");
    }

    return updateWorkItem(client, {
      organizationId,
      workItemId: issueId,
      subject: options.title,
      description,
      status: options.state,
      assignedTo: assignee,
      priority: options.priority,
      labels: options.label.length ? options.label : undefined,
    });
  });
  if (options.out) {
    await writeIssueOutputFile(options.out, formatIssueCommentOutput(result, outputFormat));
    process.stdout.write(`Saved issue update output to ${options.out}.\n`);
    return;
  }
  if (outputFormat === "tsv") {
    process.stdout.write(`${formatIssueCommentEntityTsv(result)}\n`);
    return;
  }

  printData(result, { format: outputFormat === "json" ? "json" : "table" });
}

async function resolveDefaultBugTypeId(client: YunxiaoApiClient, organizationId: string, projectId: string): Promise<string | undefined> {
  const types = await listProjectWorkItemTypes(client, {
    organizationId,
    projectId,
    category: "Bug",
  });

  for (const item of types) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }

    const record = item as Record<string, unknown>;
    const candidate = record.id ?? record.identifier ?? record.workitemTypeId;
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate;
    }
    if (typeof candidate === "number") {
      return String(Math.round(candidate));
    }
  }

  return undefined;
}

async function resolveIssueCreateCustomFields(client: YunxiaoApiClient, input: {
  organizationId: string;
  projectId: string;
  workitemTypeId: string;
  severityInput?: string;
}): Promise<Record<string, unknown> | undefined> {
  const fields = await listWorkItemTypeFields(client, {
    organizationId: input.organizationId,
    projectId: input.projectId,
    workItemTypeId: input.workitemTypeId,
  });

  const severityField = findSeverityField(fields);
  if (!severityField) {
    if (input.severityInput) {
      throw new CliError("This issue type has no severity field. Remove --severity or use a different workitem type.");
    }
    return undefined;
  }

  const severityOptionId = resolveSeverityOptionId(severityField, input.severityInput);
  if (!severityOptionId) {
    if (severityField.required) {
      throw new CliError(
        `Severity field is required but no default option can be resolved for field "${severityField.name ?? severityField.id}".`
      );
    }
    return undefined;
  }

  return {
    [severityField.id]: severityOptionId,
  };
}

function findSeverityField(fields: unknown[]): {
  id: string;
  name?: string;
  required: boolean;
  options: Array<{ id: string; value?: string; displayValue?: string }>;
} | undefined {
  for (const item of fields) {
    if (!isRecord(item)) {
      continue;
    }

    const id = asNonEmptyString(item.id);
    if (!id) {
      continue;
    }
    const name = asNonEmptyString(item.name);
    const marker = `${id} ${name ?? ""}`.toLowerCase();
    if (!marker.includes("serious") && !marker.includes("severity") && !marker.includes("严重程度")) {
      continue;
    }

    const optionsRaw = Array.isArray(item.options) ? item.options : [];
    const options: Array<{ id: string; value?: string; displayValue?: string }> = [];
    for (const optionRaw of optionsRaw) {
      if (!isRecord(optionRaw)) {
        continue;
      }

      const optionId = asNonEmptyString(optionRaw.id);
      if (!optionId) {
        continue;
      }

      options.push({
        id: optionId,
        value: asNonEmptyString(optionRaw.value),
        displayValue: asNonEmptyString(optionRaw.displayValue),
      });
    }

    return {
      id,
      name,
      required: Boolean(item.required),
      options,
    };
  }

  return undefined;
}

function resolveSeverityOptionId(input: {
  id: string;
  name?: string;
  required: boolean;
  options: Array<{ id: string; value?: string; displayValue?: string }>;
}, preferred?: string): string | undefined {
  if (!input.options.length) {
    return undefined;
  }

  const normalizedPreferred = preferred?.trim().toLowerCase();
  if (normalizedPreferred) {
    const direct = input.options.find((option) => option.id.toLowerCase() === normalizedPreferred);
    if (direct) {
      return direct.id;
    }

    const aliasToKeyword = normalizeSeverityAlias(normalizedPreferred);
    const keyword = aliasToKeyword ?? normalizedPreferred;
    const matched = input.options.find((option) => optionMatches(option, keyword));
    if (matched) {
      return matched.id;
    }

    const available = input.options
      .map((option) => option.displayValue ?? option.value ?? option.id)
      .filter(Boolean)
      .join(", ");
    throw new CliError(`Unknown --severity "${preferred}". Available values: ${available}`);
  }

  const mediumKeywords = ["3-", "3", "normal", "medium", "一般", "中"];
  for (const keyword of mediumKeywords) {
    const matched = input.options.find((option) => optionMatches(option, keyword));
    if (matched) {
      return matched.id;
    }
  }

  const highKeywords = ["2-", "major", "high", "严重", "高"];
  for (const keyword of highKeywords) {
    const matched = input.options.find((option) => optionMatches(option, keyword));
    if (matched) {
      return matched.id;
    }
  }

  return input.options[0]?.id;
}

function normalizeSeverityAlias(value: string): string | undefined {
  const alias: Record<string, string> = {
    critical: "1-",
    blocker: "1-",
    fatal: "1-",
    severe: "2-",
    major: "2-",
    high: "2-",
    medium: "3-",
    normal: "3-",
    moderate: "3-",
    low: "4-",
    trivial: "4-",
    minor: "4-",
    "1": "1-",
    "2": "2-",
    "3": "3-",
    "4": "4-",
  };
  return alias[value];
}

function optionMatches(option: { id: string; value?: string; displayValue?: string }, keyword: string): boolean {
  const target = keyword.trim().toLowerCase();
  if (!target) {
    return false;
  }

  const candidates = [option.id, option.value ?? "", option.displayValue ?? ""]
    .map((item) => item.toLowerCase());
  return candidates.some((item) => item === target || item.includes(target));
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  return undefined;
}

function resolveIssueTemplateContext(issue: Record<string, unknown>): {
  projectId?: string;
  workItemTypeId?: string;
} {
  return {
    projectId: readNestedText(issue, [
      ["space", "id"],
      ["space", "identifier"],
      ["spaceId"],
      ["spaceIdentifier"],
      ["projectId"],
    ]),
    workItemTypeId: readNestedText(issue, [
      ["workitemType", "id"],
      ["workItemType", "id"],
      ["workitemTypeId"],
      ["workItemTypeId"],
    ]),
  };
}

function normalizeIssueFields(fieldsRaw: unknown[]): IssueFieldSummary[] {
  const result: IssueFieldSummary[] = [];
  for (const item of fieldsRaw) {
    if (!isRecord(item)) {
      continue;
    }

    const id = asNonEmptyString(item.id);
    if (!id) {
      continue;
    }

    result.push({
      id,
      name: asNonEmptyString(item.name),
      type: asNonEmptyString(item.type),
      format: asNonEmptyString(item.format),
      required: Boolean(item.required),
      options: normalizeIssueFieldOptions(item.options),
    });
  }
  return result;
}

function normalizeIssueFieldOptions(value: unknown): IssueFieldOption[] | undefined {
  if (!Array.isArray(value) || !value.length) {
    return undefined;
  }

  const options: IssueFieldOption[] = [];
  for (const item of value) {
    if (!isRecord(item)) {
      continue;
    }

    const id = asNonEmptyString(item.id);
    if (!id) {
      continue;
    }

    options.push({
      id,
      value: asNonEmptyString(item.value),
      displayValue: asNonEmptyString(item.displayValue),
    });
  }

  return options.length ? options : undefined;
}

function collectFieldIdCandidates(fields: IssueFieldSummary[], keywords: string[]): string[] {
  const normalizedKeywords = keywords.map((item) => item.toLowerCase()).filter(Boolean);
  if (!normalizedKeywords.length) {
    return [];
  }

  const ids: string[] = [];
  const seen = new Set<string>();
  for (const field of fields) {
    const haystack = `${field.id} ${field.name ?? ""} ${field.type ?? ""} ${field.format ?? ""}`.toLowerCase();
    if (!normalizedKeywords.some((keyword) => haystack.includes(keyword))) {
      continue;
    }
    if (seen.has(field.id)) {
      continue;
    }
    seen.add(field.id);
    ids.push(field.id);
  }
  return ids;
}

async function resolveIssueCommentFormatType(client: YunxiaoApiClient, input: {
  organizationId: string;
  issueId: string;
  commentId: string;
  preferred?: string;
}): Promise<"MARKDOWN" | "RICHTEXT" | undefined> {
  if (input.preferred) {
    return normalizeCommentFormatOption(input.preferred);
  }

  const perPage = 100;
  for (let page = 1; page <= 5; page += 1) {
    const response = await listWorkItemComments(client, {
      organizationId: input.organizationId,
      workItemId: input.issueId,
      page,
      perPage,
    });
    const comments = extractIssueComments(response);
    if (!comments.length) {
      break;
    }

    for (const comment of comments) {
      const id = asNonEmptyString(comment.id);
      if (id !== input.commentId) {
        continue;
      }

      const raw = asNonEmptyString(comment.contentFormat) ?? asNonEmptyString(comment.formatType);
      if (!raw) {
        return undefined;
      }

      const normalized = raw.toUpperCase();
      if (normalized.includes("MARKDOWN")) {
        return "MARKDOWN";
      }
      if (normalized.includes("RICH")) {
        return "RICHTEXT";
      }
      return undefined;
    }

    if (comments.length < perPage) {
      break;
    }
  }

  return undefined;
}

function normalizeCommentFormatOption(value: string): "MARKDOWN" | "RICHTEXT" {
  const normalized = value.trim().toUpperCase();
  if (normalized === "MARKDOWN" || normalized === "MD") {
    return "MARKDOWN";
  }
  if (normalized === "RICHTEXT" || normalized === "RICH_TEXT" || normalized === "RICH-TEXT") {
    return "RICHTEXT";
  }
  throw new CliError("Invalid --format. Use MARKDOWN or RICHTEXT.");
}

function extractIssueComments(response: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(response)) {
    return response.filter(isRecord);
  }
  if (!isRecord(response)) {
    return [];
  }

  for (const key of ["items", "records", "result", "data"]) {
    const value = response[key];
    if (Array.isArray(value)) {
      return value.filter(isRecord);
    }
  }

  return [];
}

async function unassignIssue(client: YunxiaoApiClient, input: {
  organizationId: string;
  issueId: string;
}): Promise<{
  issueId: string;
  method: string;
  result: unknown;
}> {
  const attempts: Array<{
    method: string;
    run: () => Promise<unknown>;
  }> = [
    {
      method: "updateWorkItem(assignedTo='')",
      run: () =>
        updateWorkItem(client, {
          organizationId: input.organizationId,
          workItemId: input.issueId,
          assignedTo: "",
        }),
    },
    {
      method: "updateWorkItemFields(assignedTo='')",
      run: () =>
        updateWorkItemFields(client, {
          organizationId: input.organizationId,
          workItemId: input.issueId,
          fields: [
            {
              fieldIdentifier: "assignedTo",
              fieldValue: "",
            },
          ],
        }),
    },
    {
      method: "updateWorkItemFields(owner='')",
      run: () =>
        updateWorkItemFields(client, {
          organizationId: input.organizationId,
          workItemId: input.issueId,
          fields: [
            {
              fieldIdentifier: "owner",
              fieldValue: "",
            },
          ],
        }),
    },
  ];

  let lastError: unknown;
  for (const attempt of attempts) {
    try {
      const result = await attempt.run();
      return {
        issueId: input.issueId,
        method: attempt.method,
        result,
      };
    } catch (error) {
      lastError = error;
    }
  }

  const suffix = lastError instanceof Error ? ` Last error: ${lastError.message}` : "";
  throw new CliError(
    `Failed to unassign issue. This issue template may require assignee to be non-empty.${suffix}`
  );
}

async function transitionIssueStatus(client: YunxiaoApiClient, input: {
  organizationId: string;
  issueId: string;
  action: "close" | "reopen";
  explicitStatus?: string;
}): Promise<unknown> {
  const candidates = input.explicitStatus
    ? [input.explicitStatus]
    : await resolveTransitionCandidates(client, input);

  let lastError: unknown;
  for (const status of candidates) {
    try {
      const result = await updateWorkItem(client, {
        organizationId: input.organizationId,
        workItemId: input.issueId,
        status,
      });
      return {
        action: input.action,
        issueId: input.issueId,
        status,
        result,
      };
    } catch (error) {
      lastError = error;
    }
  }

  const suffix = lastError instanceof Error ? ` Last error: ${lastError.message}` : "";
  throw new CliError(`Failed to ${input.action} issue. Tried statuses: ${candidates.join(", ")}.${suffix}`);
}

async function resolveTransitionCandidates(client: YunxiaoApiClient, input: {
  organizationId: string;
  issueId: string;
  action: "close" | "reopen";
}): Promise<string[]> {
  const fallback = input.action === "close" ? CLOSED_STATUS_CANDIDATES : REOPEN_STATUS_CANDIDATES;
  const detail = await getWorkItem(client, {
    organizationId: input.organizationId,
    workItemId: input.issueId,
  });

  if (!isRecord(detail)) {
    return fallback;
  }

  const projectId = readNestedText(detail, [
    ["space", "id"],
    ["space", "identifier"],
    ["spaceId"],
    ["spaceIdentifier"],
    ["projectId"],
  ]);
  const workItemTypeId = readNestedText(detail, [
    ["workitemType", "id"],
    ["workItemType", "id"],
    ["workitemTypeId"],
    ["workItemTypeId"],
  ]);

  if (!projectId || !workItemTypeId) {
    return fallback;
  }

  const workflow = await getWorkItemTypeWorkflow(client, {
    organizationId: input.organizationId,
    projectId,
    workItemTypeId,
  });
  if (!workflow) {
    return fallback;
  }

  const statuses = Array.isArray(workflow.statuses)
    ? workflow.statuses.filter((item): item is Record<string, unknown> => isRecord(item))
    : [];
  if (!statuses.length) {
    return fallback;
  }

  const primaryKeywords =
    input.action === "close"
      ? ["closed", "close", "已关闭", "关闭"]
      : ["reopen", "open", "new", "再次打开", "待确认", "处理中", "进行中", "待处理"];
  const secondaryKeywords =
    input.action === "close"
      ? ["fixed", "resolve", "done", "complete", "wont", "won't", "已修复", "已解决", "已完成", "暂不修复"]
      : ["in progress", "处理中", "进行中"];

  const primary = collectWorkflowStatusValues(statuses, primaryKeywords);
  const secondary = collectWorkflowStatusValues(statuses, secondaryKeywords);
  const dynamic = dedupeStrings([...primary, ...secondary]);
  if (!dynamic.length) {
    return fallback;
  }

  return dedupeStrings([...dynamic, ...fallback]);
}

function collectWorkflowStatusValues(statuses: Record<string, unknown>[], keywords: string[]): string[] {
  const result: string[] = [];
  for (const status of statuses) {
    const id = asNonEmptyString(status.id);
    const names = [
      asNonEmptyString(status.name),
      asNonEmptyString(status.displayName),
      asNonEmptyString(status.nameEn),
    ].filter((item): item is string => Boolean(item));
    if (!names.length && !id) {
      continue;
    }

    const haystack = names.join(" ").toLowerCase();
    const matched = keywords.some((keyword) => haystack.includes(keyword.toLowerCase()));
    if (!matched) {
      continue;
    }

    if (id) {
      result.push(id);
    }
    result.push(...names);
  }
  return result;
}

function dedupeStrings(items: string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const normalized = item.trim();
    if (!normalized) {
      continue;
    }
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function readNestedText(source: Record<string, unknown>, paths: string[][]): string | undefined {
  for (const path of paths) {
    let current: unknown = source;
    let ok = true;
    for (const key of path) {
      if (!isRecord(current)) {
        ok = false;
        break;
      }
      current = current[key];
    }
    if (!ok) {
      continue;
    }

    if (typeof current === "string" && current.trim()) {
      return current.trim();
    }
    if (typeof current === "number" && Number.isFinite(current)) {
      return String(Math.round(current));
    }
  }
  return undefined;
}

async function transferIssueProject(client: YunxiaoApiClient, input: {
  organizationId: string;
  issueId: string;
  targetProjectId: string;
}): Promise<{
  method: string;
  response: unknown;
}> {
  const attempts: Array<{
    method: string;
    run: () => Promise<unknown>;
  }> = [
    {
      method: "projex:updateWorkItem(spaceId)",
      run: () =>
        updateWorkItem(client, {
          organizationId: input.organizationId,
          workItemId: input.issueId,
          spaceId: input.targetProjectId,
        }),
    },
    {
      method: "workitemField:spaceIdentifier",
      run: () =>
        updateWorkItemFields(client, {
          organizationId: input.organizationId,
          workItemId: input.issueId,
          fields: [
            {
              fieldIdentifier: "spaceIdentifier",
              fieldValue: input.targetProjectId,
            },
          ],
        }),
    },
    {
      method: "workitemField:spaceId",
      run: () =>
        updateWorkItemFields(client, {
          organizationId: input.organizationId,
          workItemId: input.issueId,
          fields: [
            {
              fieldIdentifier: "spaceId",
              fieldValue: input.targetProjectId,
            },
          ],
        }),
    },
  ];

  let lastError: unknown;
  for (const attempt of attempts) {
    try {
      const response = await attempt.run();
      return {
        method: attempt.method,
        response,
      };
    } catch (error) {
      lastError = error;
    }
  }

  const suffix = lastError instanceof Error ? ` Last error: ${lastError.message}` : "";
  throw new CliError(`Failed to transfer issue to project ${input.targetProjectId}.${suffix}`);
}

async function applyIssueLockState(client: YunxiaoApiClient, input: {
  organizationId: string;
  issueId: string;
  action: "lock" | "unlock";
  reason?: string;
  customFields?: Array<{
    fieldIdentifier: string;
    fieldValue: string;
  }>;
}): Promise<{
  issueId: string;
  action: "lock" | "unlock";
  reason?: string;
  method: string;
  fields: Array<{ fieldIdentifier: string; fieldValue: string }>;
  response: unknown;
}> {
  const attempts: Array<{
    method: string;
    fields: Array<{ fieldIdentifier: string; fieldValue: string }>;
  }> = [];

  if (input.customFields?.length) {
    attempts.push({
      method: "custom",
      fields: input.customFields,
    });
  } else {
    attempts.push(
      ...(await resolveIssueToggleFieldAttempts(client, {
        organizationId: input.organizationId,
        issueId: input.issueId,
        action: input.action,
      }))
    );
  }

  if (input.action === "lock") {
    attempts.push(
      { method: "field:isLocked", fields: [{ fieldIdentifier: "isLocked", fieldValue: "true" }] },
      { method: "field:locked", fields: [{ fieldIdentifier: "locked", fieldValue: "true" }] },
      { method: "field:lock", fields: [{ fieldIdentifier: "lock", fieldValue: "true" }] },
      { method: "field:commentPermission", fields: [{ fieldIdentifier: "commentPermission", fieldValue: "LOCKED" }] },
      { method: "field:commentStatus", fields: [{ fieldIdentifier: "commentStatus", fieldValue: "LOCKED" }] },
      { method: "field:allowComment", fields: [{ fieldIdentifier: "allowComment", fieldValue: "false" }] }
    );
  } else {
    attempts.push(
      { method: "field:isLocked", fields: [{ fieldIdentifier: "isLocked", fieldValue: "false" }] },
      { method: "field:locked", fields: [{ fieldIdentifier: "locked", fieldValue: "false" }] },
      { method: "field:lock", fields: [{ fieldIdentifier: "lock", fieldValue: "false" }] },
      { method: "field:commentPermission", fields: [{ fieldIdentifier: "commentPermission", fieldValue: "OPEN" }] },
      { method: "field:commentStatus", fields: [{ fieldIdentifier: "commentStatus", fieldValue: "OPEN" }] },
      { method: "field:allowComment", fields: [{ fieldIdentifier: "allowComment", fieldValue: "true" }] }
    );
  }

  let lastError: unknown;
  for (const attempt of attempts) {
    try {
      const response = await applyIssueCustomFields(client, {
        organizationId: input.organizationId,
        issueId: input.issueId,
        fields: attempt.fields,
      });

      return {
        issueId: input.issueId,
        action: input.action,
        reason: input.reason,
        method: `${attempt.method} (${response.method})`,
        fields: attempt.fields,
        response: response.result,
      };
    } catch (error) {
      lastError = error;
    }
  }

  const suffix = lastError instanceof Error ? ` Last error: ${lastError.message}` : "";
  throw new CliError(
    `Failed to ${input.action} issue using known lock fields. Try --field <identifier> --value <value> for your project template.${suffix}`
  );
}

async function applyIssuePinState(client: YunxiaoApiClient, input: {
  organizationId: string;
  issueId: string;
  action: "pin" | "unpin";
  customFields?: Array<{
    fieldIdentifier: string;
    fieldValue: string;
  }>;
}): Promise<{
  issueId: string;
  action: "pin" | "unpin";
  method: string;
  fields: Array<{ fieldIdentifier: string; fieldValue: string }>;
  response: unknown;
}> {
  const attempts: Array<{
    method: string;
    fields: Array<{ fieldIdentifier: string; fieldValue: string }>;
  }> = [];

  if (input.customFields?.length) {
    attempts.push({
      method: "custom",
      fields: input.customFields,
    });
  } else {
    attempts.push(
      ...(await resolveIssueToggleFieldAttempts(client, {
        organizationId: input.organizationId,
        issueId: input.issueId,
        action: input.action,
      }))
    );
  }

  if (input.action === "pin") {
    attempts.push(
      { method: "field:isPinned", fields: [{ fieldIdentifier: "isPinned", fieldValue: "true" }] },
      { method: "field:pinned", fields: [{ fieldIdentifier: "pinned", fieldValue: "true" }] },
      { method: "field:pin", fields: [{ fieldIdentifier: "pin", fieldValue: "true" }] },
      { method: "field:top", fields: [{ fieldIdentifier: "top", fieldValue: "true" }] },
      { method: "field:pinnedStatus", fields: [{ fieldIdentifier: "pinnedStatus", fieldValue: "PINNED" }] }
    );
  } else {
    attempts.push(
      { method: "field:isPinned", fields: [{ fieldIdentifier: "isPinned", fieldValue: "false" }] },
      { method: "field:pinned", fields: [{ fieldIdentifier: "pinned", fieldValue: "false" }] },
      { method: "field:pin", fields: [{ fieldIdentifier: "pin", fieldValue: "false" }] },
      { method: "field:top", fields: [{ fieldIdentifier: "top", fieldValue: "false" }] },
      { method: "field:pinnedStatus", fields: [{ fieldIdentifier: "pinnedStatus", fieldValue: "NORMAL" }] }
    );
  }

  let lastError: unknown;
  for (const attempt of attempts) {
    try {
      const response = await applyIssueCustomFields(client, {
        organizationId: input.organizationId,
        issueId: input.issueId,
        fields: attempt.fields,
      });

      return {
        issueId: input.issueId,
        action: input.action,
        method: `${attempt.method} (${response.method})`,
        fields: attempt.fields,
        response: response.result,
      };
    } catch (error) {
      lastError = error;
    }
  }

  const suffix = lastError instanceof Error ? ` Last error: ${lastError.message}` : "";
  throw new CliError(
    `Failed to ${input.action} issue using known pin fields. Try --field <identifier> --value <value> for your project template.${suffix}`
  );
}

async function resolveIssueToggleFieldAttempts(client: YunxiaoApiClient, input: {
  organizationId: string;
  issueId: string;
  action: "lock" | "unlock" | "pin" | "unpin";
}): Promise<Array<{ method: string; fields: Array<{ fieldIdentifier: string; fieldValue: string }> }>> {
  const detail = await getWorkItem(client, {
    organizationId: input.organizationId,
    workItemId: input.issueId,
  });
  const issue = extractIssueRecord(detail);
  if (!issue) {
    return [];
  }

  const context = resolveIssueTemplateContext(issue);
  if (!context.projectId || !context.workItemTypeId) {
    return [];
  }

  const fields = normalizeIssueFields(
    await listWorkItemTypeFields(client, {
      organizationId: input.organizationId,
      projectId: context.projectId,
      workItemTypeId: context.workItemTypeId,
    })
  );
  if (!fields.length) {
    return [];
  }

  const fieldKeywords = resolveToggleFieldKeywords(input.action);
  const candidateFieldIds = collectFieldIdCandidates(fields, fieldKeywords);
  const attempts: Array<{ method: string; fields: Array<{ fieldIdentifier: string; fieldValue: string }> }> = [];
  for (const fieldId of candidateFieldIds) {
    const field = fields.find((item) => item.id === fieldId);
    if (!field) {
      continue;
    }

    const fieldValue = resolveToggleFieldValue(field, input.action);
    if (fieldValue === undefined) {
      continue;
    }

    attempts.push({
      method: `field:auto:${field.id}`,
      fields: [{ fieldIdentifier: field.id, fieldValue }],
    });
  }

  return attempts;
}

function resolveToggleFieldKeywords(action: "lock" | "unlock" | "pin" | "unpin"): string[] {
  if (action === "lock" || action === "unlock") {
    return ["lock", "locked", "comment", "discussion", "评论", "锁", "禁言"];
  }
  return ["pin", "pinned", "top", "置顶", "star", "加星"];
}

function resolveToggleFieldValue(field: IssueFieldSummary, action: "lock" | "unlock" | "pin" | "unpin"): string | undefined {
  if (field.options?.length) {
    const option = pickToggleOption(field.options, action);
    if (option) {
      return option.id;
    }
  }

  const normalizedFormat = (field.format ?? "").toLowerCase();
  if (normalizedFormat === "bool" || normalizedFormat === "boolean" || normalizedFormat === "checkbox") {
    return action === "lock" || action === "pin" ? "true" : "false";
  }

  if (!field.options || !field.options.length) {
    return action === "lock" || action === "pin" ? "true" : "false";
  }

  return undefined;
}

function pickToggleOption(options: IssueFieldOption[], action: "lock" | "unlock" | "pin" | "unpin"): IssueFieldOption | undefined {
  const keywords = resolveToggleOptionKeywords(action);
  for (const option of options) {
    if (optionMatchesAnyKeyword(option, keywords.exact)) {
      return option;
    }
  }
  for (const option of options) {
    if (optionMatchesAnyKeyword(option, keywords.fuzzy)) {
      return option;
    }
  }
  return undefined;
}

function resolveToggleOptionKeywords(action: "lock" | "unlock" | "pin" | "unpin"): {
  exact: string[];
  fuzzy: string[];
} {
  if (action === "lock") {
    return {
      exact: ["lock", "locked", "true", "yes", "on", "pin", "pinned", "置顶", "锁定", "关闭评论"],
      fuzzy: ["lock", "锁", "禁止", "close comment"],
    };
  }
  if (action === "unlock") {
    return {
      exact: ["unlock", "open", "normal", "false", "no", "off", "unlocked", "未锁定", "开放评论"],
      fuzzy: ["unlock", "open", "normal", "未锁", "可评论"],
    };
  }
  if (action === "pin") {
    return {
      exact: ["pin", "pinned", "top", "true", "yes", "on", "置顶"],
      fuzzy: ["pin", "top", "置顶", "star"],
    };
  }
  return {
    exact: ["unpin", "normal", "none", "false", "no", "off", "取消置顶", "未置顶"],
    fuzzy: ["unpin", "normal", "none", "取消", "未置顶"],
  };
}

function optionMatchesAnyKeyword(option: IssueFieldOption, keywords: string[]): boolean {
  const markers = [option.id, option.value ?? "", option.displayValue ?? ""]
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  if (!markers.length) {
    return false;
  }

  for (const keyword of keywords) {
    const normalizedKeyword = keyword.trim().toLowerCase();
    if (!normalizedKeyword) {
      continue;
    }
    if (markers.some((marker) => marker === normalizedKeyword || marker.includes(normalizedKeyword))) {
      return true;
    }
  }
  return false;
}

async function applyIssueCustomFields(client: YunxiaoApiClient, input: {
  organizationId: string;
  issueId: string;
  fields: Array<{ fieldIdentifier: string; fieldValue: string }>;
}): Promise<{ method: string; result: unknown }> {
  const customFieldValues: Record<string, unknown> = {};
  for (const item of input.fields) {
    customFieldValues[item.fieldIdentifier] = item.fieldValue;
  }

  const attempts: Array<{ method: string; run: () => Promise<unknown> }> = [
    {
      method: "updateWorkItem",
      run: () =>
        updateWorkItem(client, {
          organizationId: input.organizationId,
          workItemId: input.issueId,
          customFieldValues,
        }),
    },
    {
      method: "updateWorkItemFields",
      run: () =>
        updateWorkItemFields(client, {
          organizationId: input.organizationId,
          workItemId: input.issueId,
          fields: input.fields,
        }),
    },
  ];

  let lastError: unknown;
  for (const attempt of attempts) {
    try {
      const result = await attempt.run();
      return {
        method: attempt.method,
        result,
      };
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }
  throw new CliError("Failed to update issue custom fields.");
}

function buildCustomLockFields(
  fields: string[],
  values: string[],
  action: "lock" | "unlock"
): Array<{ fieldIdentifier: string; fieldValue: string }> | undefined {
  if (!fields.length) {
    return undefined;
  }

  return fields
    .map((fieldIdentifier, index) => ({
      fieldIdentifier: fieldIdentifier.trim(),
      fieldValue: values[index] ?? (action === "lock" ? "true" : "false"),
    }))
    .filter((item) => item.fieldIdentifier);
}

function buildCustomPinFields(
  fields: string[],
  values: string[],
  action: "pin" | "unpin"
): Array<{ fieldIdentifier: string; fieldValue: string }> | undefined {
  if (!fields.length) {
    return undefined;
  }

  return fields
    .map((fieldIdentifier, index) => ({
      fieldIdentifier: fieldIdentifier.trim(),
      fieldValue: values[index] ?? (action === "pin" ? "true" : "false"),
    }))
    .filter((item) => item.fieldIdentifier);
}

async function fetchIssuesWithLimit(client: YunxiaoApiClient, input: {
  organizationId: string;
  projectId: string;
  limit?: number;
  page?: number;
  perPage?: number;
  orderBy?: string;
  sort?: string;
  subject?: string;
  creator?: string;
  assignee?: string;
  tag?: string;
  status?: string;
}): Promise<Record<string, unknown>[]> {
  const maxResults = Math.max(1, input.limit ?? 30);
  const startPage = input.page ?? 1;
  const pageSize = Math.max(1, Math.min(100, input.perPage ?? maxResults));
  const items: Record<string, unknown>[] = [];

  let page = startPage;
  while (items.length < maxResults) {
    const response = await searchWorkItems(client, {
      organizationId: input.organizationId,
      category: "Bug",
      spaceId: input.projectId,
      subject: input.subject,
      creator: input.creator,
      assignedTo: input.assignee,
      tag: input.tag,
      status: input.status,
      orderBy: input.orderBy,
      sort: input.sort,
      page,
      perPage: pageSize,
    });

    const current = extractWorkItems(response);
    if (current.length === 0) {
      break;
    }

    items.push(...current);

    if (input.page !== undefined || current.length < pageSize) {
      break;
    }

    page += 1;
  }

  return items.slice(0, maxResults);
}

function extractIssueRecord(response: unknown): Record<string, unknown> | undefined {
  if (!isRecord(response)) {
    return undefined;
  }

  for (const key of ["result", "data", "body"]) {
    const value = response[key];
    if (isRecord(value)) {
      return value;
    }
  }

  return response;
}

function extractWorkItems(response: unknown): Record<string, unknown>[] {
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

function parseStateOption(state: string | undefined): {
  mode: "open" | "closed" | "all";
  rawStatus?: string;
} {
  const normalized = (state ?? "open").trim().toLowerCase();
  if (normalized === "all") {
    return { mode: "all" };
  }
  if (normalized === "closed") {
    return { mode: "closed" };
  }
  if (normalized === "open") {
    return { mode: "open" };
  }
  return { mode: "all", rawStatus: state };
}

function filterIssuesByState(items: Record<string, unknown>[], mode: "open" | "closed" | "all"): Record<string, unknown>[] {
  if (mode === "all") {
    return items;
  }
  return items.filter((item) => classifyIssueState(item) === mode);
}

function splitIssueStates(items: Record<string, unknown>[]): {
  open: Record<string, unknown>[];
  closed: Record<string, unknown>[];
} {
  const open: Record<string, unknown>[] = [];
  const closed: Record<string, unknown>[] = [];
  for (const item of items) {
    if (classifyIssueState(item) === "closed") {
      closed.push(item);
      continue;
    }
    open.push(item);
  }
  return { open, closed };
}

function classifyIssueState(item: Record<string, unknown>): "open" | "closed" {
  const status = readStatusText(item).toLowerCase();
  const closedKeywords = ["closed", "done", "resolved", "complete", "已关闭", "关闭", "已完成", "完成", "已解决", "解决"];
  for (const keyword of closedKeywords) {
    if (status.includes(keyword)) {
      return "closed";
    }
  }
  return "open";
}

function readStatusText(item: Record<string, unknown>): string {
  const directKeys = ["status", "statusName", "state", "statusIdentifier"];
  for (const key of directKeys) {
    const value = item[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }

  const complexKeys = ["status", "state"];
  for (const key of complexKeys) {
    const value = item[key];
    if (!isRecord(value)) {
      continue;
    }

    const nestedKeys = ["name", "displayName", "statusName", "identifier", "value"];
    for (const nestedKey of nestedKeys) {
      const nested = value[nestedKey];
      if (typeof nested === "string" && nested.trim()) {
        return nested;
      }
    }
  }

  return "";
}

function readIssueTitle(item: Record<string, unknown>): string | undefined {
  const candidates = ["subject", "title", "name"];
  for (const key of candidates) {
    const value = item[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function buildIssueBranchName(prefix: string, issueId: string, title?: string): string {
  const cleanedPrefix = sanitizeBranchSegment(prefix) || "issue";
  const cleanedId = sanitizeBranchSegment(issueId) || issueId;
  const cleanedTitle = sanitizeBranchSegment(title);
  return cleanedTitle
    ? `${cleanedPrefix}/${cleanedId}-${cleanedTitle}`
    : `${cleanedPrefix}/${cleanedId}`;
}

function sanitizeBranchSegment(value: string | undefined): string {
  if (!value) {
    return "";
  }
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

type IssueFieldOption = {
  id: string;
  value?: string;
  displayValue?: string;
};

type IssueFieldSummary = {
  id: string;
  name?: string;
  type?: string;
  format?: string;
  required: boolean;
  options?: IssueFieldOption[];
};

type IssueListOptions = {
  org?: string;
  project?: string;
  state?: string;
  assignee?: string;
  author?: string;
  label: string[];
  search?: string;
  limit: number;
  page?: number;
  perPage?: number;
  orderBy?: string;
  sort?: string;
  format: string;
  out?: string;
  json?: boolean;
};

type IssueViewOptions = {
  org?: string;
  web?: boolean;
  format: string;
  out?: string;
  json?: boolean;
};

type IssueCreateOptions = {
  org?: string;
  project: string;
  title: string;
  type?: string;
  assignee?: string;
  body?: string;
  description?: string;
  severity?: string;
  label: string[];
  format: string;
  out?: string;
  json?: boolean;
};

type IssueUpdateOptions = {
  org?: string;
  title?: string;
  body?: string;
  description?: string;
  state?: string;
  assignee?: string;
  priority?: string;
  label: string[];
  format: string;
  out?: string;
  json?: boolean;
};

type IssueAssignOptions = {
  org?: string;
  assignee?: string;
  format: string;
  out?: string;
  json?: boolean;
};

type IssueTransitionOptions = {
  org?: string;
  state?: string;
  format: string;
  out?: string;
  json?: boolean;
};

type IssueTransferOptions = {
  org?: string;
  project: string;
  format: string;
  out?: string;
  json?: boolean;
};

type IssueLockOptions = {
  org?: string;
  reason?: string;
  field: string[];
  value: string[];
  format: string;
  out?: string;
  json?: boolean;
};

type IssuePinOptions = {
  org?: string;
  field: string[];
  value: string[];
  format: string;
  out?: string;
  json?: boolean;
};

type IssueDeleteOptions = {
  org?: string;
  yes?: boolean;
  format: string;
  out?: string;
  json?: boolean;
};

type IssueDevelopOptions = {
  org?: string;
  repoDir: string;
  name?: string;
  prefix: string;
  base?: string;
  force?: boolean;
  dryRun?: boolean;
  format: string;
  out?: string;
  json?: boolean;
};

type IssueStatusOptions = {
  org?: string;
  project?: string;
  limit: number;
  format: string;
  out?: string;
  json?: boolean;
};

type IssueActivitiesOptions = {
  org?: string;
  format: string;
  out?: string;
  json?: boolean;
};

type IssueFieldsOptions = {
  org?: string;
  format: string;
  out?: string;
  json?: boolean;
};

type IssueFieldSetOptions = {
  org?: string;
  field: string[];
  value: string[];
  format: string;
  out?: string;
  json?: boolean;
};

type IssueCommentsOptions = {
  org?: string;
  page?: number;
  perPage?: number;
  format: string;
  out?: string;
  json?: boolean;
};

type IssueCommentOptions = {
  org?: string;
  body?: string;
  content?: string;
  format: string;
  out?: string;
  json?: boolean;
};

type IssueCommentEditOptions = {
  org?: string;
  body?: string;
  content?: string;
  commentFormat?: string;
  format: string;
  out?: string;
  json?: boolean;
};

type IssueCommentDeleteOptions = {
  org?: string;
  yes?: boolean;
  format: string;
  out?: string;
  json?: boolean;
};
