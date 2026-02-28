import { spawnSync } from "node:child_process";
import { Command } from "commander";
import { parsePositiveIntegerOption } from "../core/utils/options.js";
import { loadConfig, saveConfig } from "../core/config/store.js";
import { withApiClient, YunxiaoApiClient } from "../core/api/client.js";
import {
  createCommitStatus,
  listCommitStatuses,
} from "../core/api/commit-status.js";
import {
  createGroupMember,
  createRepositoryMember,
  deleteGroupMember,
  deleteRepositoryMember,
  getMemberHttpsCloneUsername,
  listGroupMembers,
  listRepositoryMembers,
  updateGroupMember,
  updateRepositoryMember,
} from "../core/api/member.js";
import {
  createRepositoryWebhook,
  deleteRepositoryWebhook,
  getRepositoryWebhook,
  listRepositoryWebhooks,
  updateRepositoryWebhook,
} from "../core/api/webhook.js";
import {
  createCheckRun,
  getCheckRun,
  listCheckRuns,
  updateCheckRun,
} from "../core/api/check-run.js";
import {
  assertRichOutputFileOption,
  normalizeRichOutputFormat,
  printRichData,
  renderRichOutput,
  writeRichOutputFile,
} from "../core/output/rich.js";
import {
  createRepositoryProtectedBranch,
  createRepositoryTag,
  createRepository,
  createRepositoryBranch,
  deleteRepository,
  deleteRepositoryProtectedBranch,
  deleteRepositoryTag,
  deleteRepositoryBranch,
  getRepositoryProtectedBranch,
  getRepository,
  listRepositoryProtectedBranches,
  listRepositoryTags,
  listRepositories,
  listRepositoryBranches,
  updateRepositoryProtectedBranch,
  updateRepository,
} from "../core/api/repo.js";
import { resolveOrganizationId } from "../core/utils/context.js";
import { CliError } from "../core/errors.js";
import { openInBrowser } from "../core/utils/browser.js";
import { resolveRepositoryWebUrl } from "../core/utils/web-url.js";

export function registerRepoCommand(program: Command): void {
  const repo = program.command("repo").description("Repository commands");

  repo
    .command("list")
    .description("List repositories")
    .option("--org <organizationId>", "Organization ID")
    .option("--page <number>", "Page number", parsePositiveIntegerOption)
    .option("--per-page <number>", "Items per page", parsePositiveIntegerOption)
    .option("--order-by <field>", "Sort field", "created_at")
    .option("--sort <direction>", "Sort direction", "desc")
    .option("--search <keyword>", "Search keyword")
    .option("--archived", "Include archived repositories", false)
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write repository list output to file")
    .option("--json", "Print raw JSON")
    .action(async (options: RepoListOptions) => {
      const config = loadConfig();
      const output = resolveRepoOutputSettings(options);
      const organizationId = resolveOrganizationId(config, options.org);

      const payload: Record<string, unknown> = {
        organizationId,
        page: options.page,
        perPage: options.perPage,
        orderBy: options.orderBy,
        sort: options.sort,
        search: options.search,
        archived: options.archived,
      };

      const result = await withApiClient(config, (client) =>
        listRepositories(client, payload as {
          organizationId: string;
          page?: number;
          perPage?: number;
          orderBy?: string;
          sort?: string;
          search?: string;
          archived?: boolean;
        })
      );
      emitRepoOutput(result, output, "repository list");
    });

  repo
    .command("view")
    .description("Show one repository")
    .argument("<repositoryId>", "Repository ID")
    .option("--org <organizationId>", "Organization ID")
    .option("--web", "Open repository in browser", false)
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write repository view output to file")
    .option("--json", "Print raw JSON")
    .action(async (repositoryId: string, options: RepoViewOptions) => {
      const config = loadConfig();
      const output = resolveRepoOutputSettings(options);
      const organizationId = resolveOrganizationId(config, options.org);

      const result = await withApiClient(config, (client) =>
        getRepository(client, {
          organizationId,
          repositoryId,
        })
      );
      if (options.web && output.format === "table" && !output.out) {
        const url = resolveRepositoryWebUrl(result);
        if (!url) {
          throw new CliError("Cannot resolve repository web URL from API response.");
        }
        openInBrowser(url);
        emitRepoOutput(
          {
            repositoryId,
            url,
            opened: true,
          },
          output,
          "repository view"
        );
        return;
      }
      emitRepoOutput(result, output, "repository view");
    });

  repo
    .command("create")
    .description("Create a repository (gh-like)")
    .argument("[name]", "Repository name")
    .option("--name <name>", "Repository name (alias)")
    .option("--org <organizationId>", "Organization ID")
    .option("--path <path>", "Repository path")
    .option("--description <text>", "Repository description")
    .option("--visibility <level>", "private | internal | public")
    .option("--private", "Set visibility to private", false)
    .option("--internal", "Set visibility to internal", false)
    .option("--public", "Set visibility to public", false)
    .option("--add-readme", "Initialize with README", false)
    .option("--gitignore <template>", "Initialize with .gitignore template")
    .option("--clone", "Clone locally after creation", false)
    .option("--directory <path>", "Target directory when cloning")
    .option("--remote-name <name>", "Git remote name", "origin")
    .option("--dry-run", "Print request/commands without executing", false)
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write repository create output to file")
    .option("--json", "Print raw JSON")
    .action(async (nameArg: string | undefined, options: RepoCreateOptions) => {
      const config = loadConfig();
      const output = resolveRepoOutputSettings(options);
      const organizationId = resolveOrganizationId(config, options.org);
      const name = options.name ?? nameArg;
      if (!name) {
        throw new CliError("Missing repository name. Use `yx repo create <name>` or `--name <name>`.");
      }

      const visibilityLevel = resolveVisibilityLevel(options);
      const payload = {
        organizationId,
        name,
        path: options.path ?? name,
        description: options.description,
        visibilityLevel,
        readmeType: options.addReadme ? "README.md" : undefined,
        gitignoreType: options.gitignore,
      };

      if (options.dryRun) {
        const preview: Record<string, unknown> = {
          createRequest: payload,
        };
        if (options.clone) {
          preview.clone = {
            note: "Clone command will run after repository is created.",
            remoteName: options.remoteName,
            directory: options.directory,
          };
        }
        emitRepoOutput(preview, output, "repository create");
        return;
      }

      const created = await withApiClient(config, async (client) => {
        const result = await createRepository(client, payload);
        if (!options.clone) {
          return result;
        }

        const detail = extractRepositoryRecord(result) ?? (isRecord(result) ? result : undefined);
        const cloneUrl = detail ? resolveRepositoryCloneUrl(detail, "auto") : undefined;
        if (!cloneUrl) {
          return {
            create: result,
            clone: {
              executed: false,
              reason: "Cannot detect clone URL from create response.",
            },
          };
        }

        const command = ["git", "clone", "--origin", options.remoteName, cloneUrl];
        if (options.directory) {
          command.push(options.directory);
        }
        runGitCommand(command.slice(1));

        return {
          create: result,
          clone: {
            executed: true,
            cloneUrl,
            directory: options.directory ?? deriveDirectoryFromCloneUrl(cloneUrl),
          },
        };
      });

      emitRepoOutput(created, output, "repository create");
    });

  repo
    .command("clone")
    .description("Clone a repository locally (gh-like)")
    .argument("<repositoryId>", "Repository ID or path")
    .argument("[directory]", "Target directory")
    .option("--org <organizationId>", "Organization ID")
    .option("--protocol <type>", "auto | ssh | http | https", "auto")
    .option("--remote-name <name>", "Git remote name", "origin")
    .option("--dry-run", "Print git command without executing", false)
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write repository clone output to file")
    .option("--json", "Print raw JSON")
    .action(async (repositoryId: string, directory: string | undefined, options: RepoCloneOptions) => {
      const config = loadConfig();
      const output = resolveRepoOutputSettings(options);
      const organizationId = resolveOrganizationId(config, options.org);

      const result = await withApiClient(config, async (client) => {
        const detail = await getRepository(client, {
          organizationId,
          repositoryId,
        });

        if (!isRecord(detail)) {
          throw new CliError("Unexpected repository detail response.");
        }

        const cloneUrl = resolveRepositoryCloneUrl(detail, options.protocol);
        if (!cloneUrl) {
          throw new CliError("Cannot detect clone URL from repository detail.");
        }

        const command = ["git", "clone", "--origin", options.remoteName, cloneUrl];
        if (directory) {
          command.push(directory);
        }

        if (options.dryRun) {
          return {
            repositoryId,
            cloneUrl,
            command: command.join(" "),
            executed: false,
          };
        }

        runGitCommand(command.slice(1));
        return {
          repositoryId,
          cloneUrl,
          directory: directory ?? deriveDirectoryFromCloneUrl(cloneUrl),
          executed: true,
        };
      });

      emitRepoOutput(result, output, "repository clone");
    });

  repo
    .command("edit")
    .description("Edit repository settings (gh-like)")
    .argument("<repositoryId>", "Repository ID or path")
    .option("--org <organizationId>", "Organization ID")
    .option("--name <name>", "Repository name")
    .option("--path <path>", "Repository path")
    .option("--description <text>", "Repository description")
    .option("--default-branch <branch>", "Default branch")
    .option("--visibility <level>", "private | internal | public")
    .option("--private", "Set visibility to private", false)
    .option("--internal", "Set visibility to internal", false)
    .option("--public", "Set visibility to public", false)
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write repository edit output to file")
    .option("--json", "Print raw JSON")
    .action(async (repositoryId: string, options: RepoEditOptions) => {
      const config = loadConfig();
      const output = resolveRepoOutputSettings(options);
      const organizationId = resolveOrganizationId(config, options.org);
      const visibilityLevel = resolveVisibilityLevel(options);
      if (
        options.name === undefined &&
        options.path === undefined &&
        options.description === undefined &&
        options.defaultBranch === undefined &&
        visibilityLevel === undefined
      ) {
        throw new CliError("No update fields provided. Use options like --name/--description/--default-branch.");
      }

      const result = await withApiClient(config, (client) =>
        updateRepository(client, {
          organizationId,
          repositoryId,
          name: options.name,
          path: options.path,
          description: options.description,
          defaultBranch: options.defaultBranch,
          visibilityLevel,
        })
      );

      emitRepoOutput(result, output, "repository edit");
    });

  repo
    .command("delete")
    .description("Delete a repository (gh-like)")
    .argument("<repositoryId>", "Repository ID or path")
    .option("--org <organizationId>", "Organization ID")
    .option("--reason <text>", "Delete reason")
    .option("--yes", "Skip confirmation", false)
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write repository delete output to file")
    .option("--json", "Print raw JSON")
    .action(async (repositoryId: string, options: RepoDeleteOptions) => {
      if (!options.yes) {
        throw new CliError("Refusing to delete repository without confirmation. Re-run with `--yes`.");
      }

      const config = loadConfig();
      const output = resolveRepoOutputSettings(options);
      const organizationId = resolveOrganizationId(config, options.org);
      const result = await withApiClient(config, (client) =>
        deleteRepository(client, {
          organizationId,
          repositoryId,
          reason: options.reason,
        })
      );

      emitRepoOutput(result, output, "repository delete");
    });

  const branch = repo.command("branch").description("Repository branch commands (gh-like)");

  branch
    .command("list")
    .description("List branches in a repository")
    .argument("<repositoryId>", "Repository ID or path")
    .option("--org <organizationId>", "Organization ID")
    .option("--page <number>", "Page number", parsePositiveIntegerOption)
    .option("--per-page <number>", "Items per page", parsePositiveIntegerOption)
    .option("--sort <direction>", "Sort mode, e.g. name_asc|name_desc|updated_asc|updated_desc")
    .option("--search <keyword>", "Branch name filter")
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write branch list output to file")
    .option("--json", "Print raw JSON")
    .action(async (repositoryId: string, options: RepoBranchListOptions) => {
      const config = loadConfig();
      const output = resolveRepoOutputSettings(options);
      const organizationId = resolveOrganizationId(config, options.org);

      const result = await withApiClient(config, (client) =>
        listRepositoryBranches(client, {
          organizationId,
          repositoryId,
          page: options.page,
          perPage: options.perPage,
          sort: options.sort,
          search: options.search,
        })
      );

      emitRepoOutput(result, output, "branch list");
    });

  branch
    .command("create")
    .description("Create a branch in a repository")
    .argument("<repositoryId>", "Repository ID or path")
    .argument("<branch>", "New branch name")
    .option("--org <organizationId>", "Organization ID")
    .option("--ref <ref>", "Source ref/branch (default: repository default branch)")
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write branch create output to file")
    .option("--json", "Print raw JSON")
    .action(async (repositoryId: string, branchName: string, options: RepoBranchCreateOptions) => {
      const config = loadConfig();
      const output = resolveRepoOutputSettings(options);
      const organizationId = resolveOrganizationId(config, options.org);

      const result = await withApiClient(config, async (client) => {
        const ref = await resolveRefOrDefaultBranch(client, organizationId, repositoryId, options.ref);
        return createRepositoryBranch(client, {
          organizationId,
          repositoryId,
          branch: branchName,
          ref,
        });
      });

      emitRepoOutput(result, output, "branch create");
    });

  branch
    .command("delete")
    .description("Delete a branch in a repository")
    .argument("<repositoryId>", "Repository ID or path")
    .argument("<branch>", "Branch name")
    .option("--org <organizationId>", "Organization ID")
    .option("--yes", "Skip confirmation", false)
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write branch delete output to file")
    .option("--json", "Print raw JSON")
    .action(async (repositoryId: string, branchName: string, options: RepoBranchDeleteOptions) => {
      if (!options.yes) {
        throw new CliError("Refusing to delete branch without confirmation. Re-run with `--yes`.");
      }

      const config = loadConfig();
      const output = resolveRepoOutputSettings(options);
      const organizationId = resolveOrganizationId(config, options.org);
      const result = await withApiClient(config, (client) =>
        deleteRepositoryBranch(client, {
          organizationId,
          repositoryId,
          branch: branchName,
        })
      );

      emitRepoOutput(result, output, "branch delete");
    });

  const protect = branch.command("protect").description("Protected branch rule commands");

  protect
    .command("list")
    .description("List protected branch rules")
    .argument("<repositoryId>", "Repository ID or path")
    .option("--org <organizationId>", "Organization ID")
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write protected branch list output to file")
    .option("--json", "Print raw JSON")
    .action(async (repositoryId: string, options: RepoBranchProtectListOptions) => {
      const config = loadConfig();
      const output = resolveRepoOutputSettings(options);
      const organizationId = resolveOrganizationId(config, options.org);

      const result = await withApiClient(config, (client) =>
        listRepositoryProtectedBranches(client, {
          organizationId,
          repositoryId,
        })
      );

      emitRepoOutput(result, output, "protected branch list");
    });

  protect
    .command("create")
    .description("Create a protected branch rule")
    .argument("<repositoryId>", "Repository ID or path")
    .argument("<branch>", "Branch name or branch pattern")
    .option("--org <organizationId>", "Organization ID")
    .option("--allow-push-roles <roles>", "Comma-separated role IDs")
    .option("--allow-merge-roles <roles>", "Comma-separated role IDs")
    .option("--allow-push-user-ids <userIds>", "Comma-separated user IDs")
    .option("--allow-merge-user-ids <userIds>", "Comma-separated user IDs")
    .option("--merge-request-setting <json>", "Raw JSON for mergeRequestSetting")
    .option("--test-setting <json>", "Raw JSON for testSetting")
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write protected branch create output to file")
    .option("--json", "Print raw JSON")
    .action(async (repositoryId: string, branchName: string, options: RepoBranchProtectCreateOptions) => {
      const config = loadConfig();
      const output = resolveRepoOutputSettings(options);
      const organizationId = resolveOrganizationId(config, options.org);

      const result = await withApiClient(config, (client) =>
        createRepositoryProtectedBranch(client, {
          organizationId,
          repositoryId,
          branch: branchName,
          allowPushRoles: parseCommaNumberList(options.allowPushRoles),
          allowMergeRoles: parseCommaNumberList(options.allowMergeRoles),
          allowPushUserIds: parseCommaList(options.allowPushUserIds),
          allowMergeUserIds: parseCommaList(options.allowMergeUserIds),
          mergeRequestSetting: parseJsonRecordOption(options.mergeRequestSetting, "--merge-request-setting"),
          testSetting: parseJsonRecordOption(options.testSetting, "--test-setting"),
        })
      );

      emitRepoOutput(result, output, "protected branch create");
    });

  protect
    .command("view")
    .description("Show one protected branch rule")
    .argument("<repositoryId>", "Repository ID or path")
    .argument("<protectedBranchId>", "Protected branch rule ID")
    .option("--org <organizationId>", "Organization ID")
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write protected branch view output to file")
    .option("--json", "Print raw JSON")
    .action(async (repositoryId: string, protectedBranchId: string, options: RepoBranchProtectViewOptions) => {
      const config = loadConfig();
      const output = resolveRepoOutputSettings(options);
      const organizationId = resolveOrganizationId(config, options.org);

      const result = await withApiClient(config, (client) =>
        getRepositoryProtectedBranch(client, {
          organizationId,
          repositoryId,
          protectedBranchId,
        })
      );

      emitRepoOutput(result, output, "protected branch view");
    });

  protect
    .command("update")
    .description("Update one protected branch rule")
    .argument("<repositoryId>", "Repository ID or path")
    .argument("<protectedBranchId>", "Protected branch rule ID")
    .option("--org <organizationId>", "Organization ID")
    .option("--branch <branch>", "Branch name or branch pattern")
    .option("--allow-push-roles <roles>", "Comma-separated role IDs")
    .option("--allow-merge-roles <roles>", "Comma-separated role IDs")
    .option("--allow-push-user-ids <userIds>", "Comma-separated user IDs")
    .option("--allow-merge-user-ids <userIds>", "Comma-separated user IDs")
    .option("--merge-request-setting <json>", "Raw JSON for mergeRequestSetting")
    .option("--test-setting <json>", "Raw JSON for testSetting")
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write protected branch update output to file")
    .option("--json", "Print raw JSON")
    .action(async (repositoryId: string, protectedBranchId: string, options: RepoBranchProtectUpdateOptions) => {
      const config = loadConfig();
      const output = resolveRepoOutputSettings(options);
      const organizationId = resolveOrganizationId(config, options.org);

      const existing = await withApiClient(config, (client) =>
        getRepositoryProtectedBranch(client, {
          organizationId,
          repositoryId,
          protectedBranchId,
        })
      );

      const branch = options.branch ?? readProtectedBranchName(existing);
      if (!branch) {
        throw new CliError("Missing branch name. Pass --branch explicitly when API response has no branch field.");
      }

      const result = await withApiClient(config, (client) =>
        updateRepositoryProtectedBranch(client, {
          organizationId,
          repositoryId,
          protectedBranchId,
          branch,
          allowPushRoles: parseCommaNumberList(options.allowPushRoles),
          allowMergeRoles: parseCommaNumberList(options.allowMergeRoles),
          allowPushUserIds: parseCommaList(options.allowPushUserIds),
          allowMergeUserIds: parseCommaList(options.allowMergeUserIds),
          mergeRequestSetting: parseJsonRecordOption(options.mergeRequestSetting, "--merge-request-setting"),
          testSetting: parseJsonRecordOption(options.testSetting, "--test-setting"),
        })
      );

      emitRepoOutput(result, output, "protected branch update");
    });

  protect
    .command("delete")
    .description("Delete one protected branch rule")
    .argument("<repositoryId>", "Repository ID or path")
    .argument("<protectedBranchId>", "Protected branch rule ID")
    .option("--org <organizationId>", "Organization ID")
    .option("--yes", "Skip confirmation", false)
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write protected branch delete output to file")
    .option("--json", "Print raw JSON")
    .action(async (repositoryId: string, protectedBranchId: string, options: RepoBranchProtectDeleteOptions) => {
      if (!options.yes) {
        throw new CliError("Refusing to delete protected branch rule without confirmation. Re-run with `--yes`.");
      }

      const config = loadConfig();
      const output = resolveRepoOutputSettings(options);
      const organizationId = resolveOrganizationId(config, options.org);
      const result = await withApiClient(config, (client) =>
        deleteRepositoryProtectedBranch(client, {
          organizationId,
          repositoryId,
          protectedBranchId,
        })
      );

      emitRepoOutput(result, output, "protected branch delete");
    });

  const tag = repo.command("tag").description("Repository tag commands (gh-like)");

  tag
    .command("list")
    .description("List tags in a repository")
    .argument("<repositoryId>", "Repository ID or path")
    .option("--org <organizationId>", "Organization ID")
    .option("--page <number>", "Page number", parsePositiveIntegerOption)
    .option("--per-page <number>", "Items per page", parsePositiveIntegerOption)
    .option("--sort <direction>", "Sort mode, e.g. updated_desc")
    .option("--search <keyword>", "Tag name filter")
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write tag list output to file")
    .option("--json", "Print raw JSON")
    .action(async (repositoryId: string, options: RepoTagListOptions) => {
      const config = loadConfig();
      const output = resolveRepoOutputSettings(options);
      const organizationId = resolveOrganizationId(config, options.org);

      const result = await withApiClient(config, (client) =>
        listRepositoryTags(client, {
          organizationId,
          repositoryId,
          page: options.page,
          perPage: options.perPage,
          sort: options.sort,
          search: options.search,
        })
      );

      emitRepoOutput(result, output, "tag list");
    });

  tag
    .command("create")
    .description("Create a tag in a repository")
    .argument("<repositoryId>", "Repository ID or path")
    .argument("<tag>", "Tag name")
    .option("--org <organizationId>", "Organization ID")
    .option("--ref <ref>", "Commit SHA or branch (default: repository default branch)")
    .option("--message <text>", "Tag message")
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write tag create output to file")
    .option("--json", "Print raw JSON")
    .action(async (repositoryId: string, tagName: string, options: RepoTagCreateOptions) => {
      const config = loadConfig();
      const output = resolveRepoOutputSettings(options);
      const organizationId = resolveOrganizationId(config, options.org);

      const result = await withApiClient(config, async (client) => {
        const ref = await resolveRefOrDefaultBranch(client, organizationId, repositoryId, options.ref);
        return createRepositoryTag(client, {
          organizationId,
          repositoryId,
          tag: tagName,
          ref,
          message: options.message,
        });
      });

      emitRepoOutput(result, output, "tag create");
    });

  tag
    .command("delete")
    .description("Delete a tag in a repository")
    .argument("<repositoryId>", "Repository ID or path")
    .argument("<tag>", "Tag name")
    .option("--org <organizationId>", "Organization ID")
    .option("--yes", "Skip confirmation", false)
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write tag delete output to file")
    .option("--json", "Print raw JSON")
    .action(async (repositoryId: string, tagName: string, options: RepoTagDeleteOptions) => {
      if (!options.yes) {
        throw new CliError("Refusing to delete tag without confirmation. Re-run with `--yes`.");
      }

      const config = loadConfig();
      const output = resolveRepoOutputSettings(options);
      const organizationId = resolveOrganizationId(config, options.org);
      const result = await withApiClient(config, (client) =>
        deleteRepositoryTag(client, {
          organizationId,
          repositoryId,
          tag: tagName,
        })
      );

      emitRepoOutput(result, output, "tag delete");
    });

  const checkRun = repo.command("check-run").description("Repository check run commands");

  checkRun
    .command("list")
    .description("List check runs by ref")
    .argument("<repositoryId>", "Repository ID or path")
    .requiredOption("--ref <ref>", "Commit SHA / branch / tag")
    .option("--org <organizationId>", "Organization ID")
    .option("--page <number>", "Page number", parsePositiveIntegerOption)
    .option("--per-page <number>", "Items per page", parsePositiveIntegerOption)
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write check run list output to file")
    .option("--json", "Print raw JSON")
    .action(async (repositoryId: string, options: RepoCheckRunListOptions) => {
      const config = loadConfig();
      const output = resolveRepoOutputSettings(options);
      const organizationId = resolveOrganizationId(config, options.org);
      const result = await withApiClient(config, (client) =>
        listCheckRuns(client, {
          organizationId,
          repositoryId,
          ref: options.ref,
          page: options.page,
          perPage: options.perPage,
        })
      );
      emitRepoOutput(result, output, "check run list");
    });

  checkRun
    .command("view")
    .description("Show one check run")
    .argument("<repositoryId>", "Repository ID or path")
    .argument("<checkRunId>", "Check run ID")
    .option("--org <organizationId>", "Organization ID")
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write check run view output to file")
    .option("--json", "Print raw JSON")
    .action(async (repositoryId: string, checkRunId: string, options: RepoCheckRunViewOptions) => {
      const config = loadConfig();
      const output = resolveRepoOutputSettings(options);
      const organizationId = resolveOrganizationId(config, options.org);
      const result = await withApiClient(config, (client) =>
        getCheckRun(client, {
          organizationId,
          repositoryId,
          checkRunId,
        })
      );
      emitRepoOutput(result, output, "check run view");
    });

  checkRun
    .command("create")
    .description("Create/write one check run")
    .argument("<repositoryId>", "Repository ID or path")
    .option("--org <organizationId>", "Organization ID")
    .option("--body <json>", "Raw JSON body")
    .option("--name <name>", "Check run name")
    .option("--head-sha <sha>", "Head commit SHA")
    .option("--status <status>", "queued | in_progress | completed")
    .option("--conclusion <conclusion>", "cancelled | failure | neutral | success | skipped | timed_out")
    .option("--details-url <url>", "Details URL")
    .option("--external-id <id>", "External ID")
    .option("--started-at <time>", "Started at (ISO 8601)")
    .option("--completed-at <time>", "Completed at (ISO 8601)")
    .option("--title <title>", "Output title")
    .option("--summary <markdown>", "Output summary")
    .option("--text <markdown>", "Output text")
    .option("--annotation <json>", "One annotation item JSON, repeatable", collect, [])
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write check run create output to file")
    .option("--json", "Print raw JSON")
    .action(async (repositoryId: string, options: RepoCheckRunMutateOptions) => {
      const config = loadConfig();
      const output = resolveRepoOutputSettings(options);
      const organizationId = resolveOrganizationId(config, options.org);
      const body = buildCheckRunPayload(options);
      const result = await withApiClient(config, (client) =>
        createCheckRun(client, {
          organizationId,
          repositoryId,
          body,
        })
      );
      emitRepoOutput(result, output, "check run create");
    });

  checkRun
    .command("update")
    .description("Update one check run")
    .argument("<repositoryId>", "Repository ID or path")
    .argument("<checkRunId>", "Check run ID")
    .option("--org <organizationId>", "Organization ID")
    .option("--body <json>", "Raw JSON body")
    .option("--name <name>", "Check run name")
    .option("--status <status>", "queued | in_progress | completed")
    .option("--conclusion <conclusion>", "cancelled | failure | neutral | success | skipped | timed_out")
    .option("--details-url <url>", "Details URL")
    .option("--external-id <id>", "External ID")
    .option("--started-at <time>", "Started at (ISO 8601)")
    .option("--completed-at <time>", "Completed at (ISO 8601)")
    .option("--title <title>", "Output title")
    .option("--summary <markdown>", "Output summary")
    .option("--text <markdown>", "Output text")
    .option("--annotation <json>", "One annotation item JSON, repeatable", collect, [])
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write check run update output to file")
    .option("--json", "Print raw JSON")
    .action(async (repositoryId: string, checkRunId: string, options: RepoCheckRunMutateOptions) => {
      const config = loadConfig();
      const output = resolveRepoOutputSettings(options);
      const organizationId = resolveOrganizationId(config, options.org);
      const rawBody = buildCheckRunPayload(options);
      const result = await withApiClient(config, async (client) => {
        const body: Record<string, unknown> = {
          ...rawBody,
        };

        if (isRecord(body.output) && body.output.title === undefined) {
          try {
            const existing = await getCheckRun(client, {
              organizationId,
              repositoryId,
              checkRunId,
            });
            const existingTitle = resolveCheckRunOutputTitle(existing);
            if (existingTitle) {
              body.output = {
                ...body.output,
                title: existingTitle,
              };
            }
          } catch {
            // Keep graceful behavior: update proceeds and backend validation remains visible if title is required.
          }
        }

        return updateCheckRun(client, {
          organizationId,
          repositoryId,
          checkRunId,
          body,
        });
      });
      emitRepoOutput(result, output, "check run update");
    });

  const commitStatus = repo.command("commit-status").description("Repository commit status commands");

  commitStatus
    .command("list")
    .description("List commit statuses by SHA")
    .argument("<repositoryId>", "Repository ID or path")
    .argument("<sha>", "Commit SHA")
    .option("--org <organizationId>", "Organization ID")
    .option("--page <number>", "Page number", parsePositiveIntegerOption)
    .option("--per-page <number>", "Items per page", parsePositiveIntegerOption)
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write commit status list output to file")
    .option("--json", "Print raw JSON")
    .action(async (repositoryId: string, sha: string, options: RepoCommitStatusListOptions) => {
      const config = loadConfig();
      const output = resolveRepoOutputSettings(options);
      const organizationId = resolveOrganizationId(config, options.org);
      const result = await withApiClient(config, (client) =>
        listCommitStatuses(client, {
          organizationId,
          repositoryId,
          sha,
          page: options.page,
          perPage: options.perPage,
        })
      );
      emitRepoOutput(result, output, "commit status list");
    });

  commitStatus
    .command("create")
    .description("Create or update one commit status")
    .argument("<repositoryId>", "Repository ID or path")
    .argument("<sha>", "Commit SHA")
    .option("--org <organizationId>", "Organization ID")
    .option("--body <json>", "Raw JSON body")
    .option("--context <context>", "Status context name")
    .option("--state <state>", "error | failure | pending | success")
    .option("--description <text>", "Status description")
    .option("--target-url <url>", "Status target URL")
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write commit status create output to file")
    .option("--json", "Print raw JSON")
    .action(async (repositoryId: string, sha: string, options: RepoCommitStatusCreateOptions) => {
      const config = loadConfig();
      const output = resolveRepoOutputSettings(options);
      const organizationId = resolveOrganizationId(config, options.org);
      const body = buildCommitStatusPayload(options);
      const result = await withApiClient(config, (client) =>
        createCommitStatus(client, {
          organizationId,
          repositoryId,
          sha,
          body,
        })
      );
      emitRepoOutput(result, output, "commit status create");
    });

  const member = repo.command("member").description("Repository/group member commands");

  member
    .command("list")
    .description("List repository members")
    .argument("<repositoryId>", "Repository ID or path")
    .option("--org <organizationId>", "Organization ID")
    .option("--access-level <level>", "Minimum access level: 20|30|40", parsePositiveIntegerOption)
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write repository member list output to file")
    .option("--json", "Print raw JSON")
    .action(async (repositoryId: string, options: RepoMemberListOptions) => {
      const config = loadConfig();
      const output = resolveRepoOutputSettings(options);
      const organizationId = resolveOrganizationId(config, options.org);
      const result = await withApiClient(config, (client) =>
        listRepositoryMembers(client, {
          organizationId,
          repositoryId,
          accessLevel: validateAccessLevel(options.accessLevel, false),
        })
      );
      emitRepoOutput(result, output, "repository member list");
    });

  member
    .command("add")
    .description("Add repository members")
    .argument("<repositoryId>", "Repository ID or path")
    .requiredOption("--access-level <level>", "Access level: 20|30|40", parsePositiveIntegerOption)
    .option("--user <userId>", "User ID, repeatable", collect, [])
    .option("--users <ids>", "Comma-separated user IDs")
    .option("--expires-at <date>", "Expire date (yyyy-MM-dd)")
    .option("--org <organizationId>", "Organization ID")
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write repository member add output to file")
    .option("--json", "Print raw JSON")
    .action(async (repositoryId: string, options: RepoMemberAddOptions) => {
      const config = loadConfig();
      const output = resolveRepoOutputSettings(options);
      const organizationId = resolveOrganizationId(config, options.org);
      const userId = resolveMemberUserIds(options.user, options.users);
      const accessLevel = validateAccessLevel(options.accessLevel, true);
      if (accessLevel === undefined) {
        throw new CliError("Missing --access-level. Use 20, 30, or 40.");
      }
      const result = await withApiClient(config, (client) =>
        createRepositoryMember(client, {
          organizationId,
          repositoryId,
          accessLevel,
          userId,
          expiresAt: validateExpiresAt(options.expiresAt),
        })
      );
      emitRepoOutput(result, output, "repository member add");
    });

  member
    .command("update")
    .description("Update one repository member access")
    .argument("<repositoryId>", "Repository ID or path")
    .argument("<userId>", "User ID")
    .requiredOption("--access-level <level>", "Access level: 20|30|40", parsePositiveIntegerOption)
    .option("--expires-at <date>", "Expire date (yyyy-MM-dd)")
    .option("--org <organizationId>", "Organization ID")
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write repository member update output to file")
    .option("--json", "Print raw JSON")
    .action(async (repositoryId: string, userId: string, options: RepoMemberUpdateOptions) => {
      const config = loadConfig();
      const output = resolveRepoOutputSettings(options);
      const organizationId = resolveOrganizationId(config, options.org);
      const accessLevel = validateAccessLevel(options.accessLevel, true);
      if (accessLevel === undefined) {
        throw new CliError("Missing --access-level. Use 20, 30, or 40.");
      }
      const result = await withApiClient(config, (client) =>
        updateRepositoryMember(client, {
          organizationId,
          repositoryId,
          userId,
          accessLevel,
          expiresAt: validateExpiresAt(options.expiresAt),
        })
      );
      emitRepoOutput(result, output, "repository member update");
    });

  member
    .command("remove")
    .description("Remove one repository member")
    .argument("<repositoryId>", "Repository ID or path")
    .argument("<userId>", "User ID")
    .option("--org <organizationId>", "Organization ID")
    .option("--yes", "Skip confirmation", false)
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write repository member remove output to file")
    .option("--json", "Print raw JSON")
    .action(async (repositoryId: string, userId: string, options: RepoMemberRemoveOptions) => {
      if (!options.yes) {
        throw new CliError("Refusing to remove member without confirmation. Re-run with `--yes`.");
      }
      const config = loadConfig();
      const output = resolveRepoOutputSettings(options);
      const organizationId = resolveOrganizationId(config, options.org);
      const result = await withApiClient(config, (client) =>
        deleteRepositoryMember(client, {
          organizationId,
          repositoryId,
          userId,
        })
      );
      emitRepoOutput(result, output, "repository member remove");
    });

  const groupMember = member.command("group").description("Group member commands");

  groupMember
    .command("list")
    .description("List group members")
    .argument("<groupId>", "Group ID or path")
    .option("--org <organizationId>", "Organization ID")
    .option("--access-level <level>", "Minimum access level: 20|30|40", parsePositiveIntegerOption)
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write group member list output to file")
    .option("--json", "Print raw JSON")
    .action(async (groupId: string, options: RepoMemberListOptions) => {
      const config = loadConfig();
      const output = resolveRepoOutputSettings(options);
      const organizationId = resolveOrganizationId(config, options.org);
      const result = await withApiClient(config, (client) =>
        listGroupMembers(client, {
          organizationId,
          groupId,
          accessLevel: validateAccessLevel(options.accessLevel, false),
        })
      );
      emitRepoOutput(result, output, "group member list");
    });

  groupMember
    .command("add")
    .description("Add group members")
    .argument("<groupId>", "Group ID or path")
    .requiredOption("--access-level <level>", "Access level: 20|30|40", parsePositiveIntegerOption)
    .option("--user <userId>", "User ID, repeatable", collect, [])
    .option("--users <ids>", "Comma-separated user IDs")
    .option("--expires-at <date>", "Expire date (yyyy-MM-dd)")
    .option("--org <organizationId>", "Organization ID")
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write group member add output to file")
    .option("--json", "Print raw JSON")
    .action(async (groupId: string, options: RepoMemberAddOptions) => {
      const config = loadConfig();
      const output = resolveRepoOutputSettings(options);
      const organizationId = resolveOrganizationId(config, options.org);
      const userId = resolveMemberUserIds(options.user, options.users);
      const accessLevel = validateAccessLevel(options.accessLevel, true);
      if (accessLevel === undefined) {
        throw new CliError("Missing --access-level. Use 20, 30, or 40.");
      }
      const result = await withApiClient(config, (client) =>
        createGroupMember(client, {
          organizationId,
          groupId,
          accessLevel,
          userId,
          expiresAt: validateExpiresAt(options.expiresAt),
        })
      );
      emitRepoOutput(result, output, "group member add");
    });

  groupMember
    .command("update")
    .description("Update one group member access")
    .argument("<groupId>", "Group ID or path")
    .argument("<userId>", "User ID")
    .requiredOption("--access-level <level>", "Access level: 20|30|40", parsePositiveIntegerOption)
    .option("--expires-at <date>", "Expire date (yyyy-MM-dd)")
    .option("--org <organizationId>", "Organization ID")
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write group member update output to file")
    .option("--json", "Print raw JSON")
    .action(async (groupId: string, userId: string, options: RepoMemberUpdateOptions) => {
      const config = loadConfig();
      const output = resolveRepoOutputSettings(options);
      const organizationId = resolveOrganizationId(config, options.org);
      const accessLevel = validateAccessLevel(options.accessLevel, true);
      if (accessLevel === undefined) {
        throw new CliError("Missing --access-level. Use 20, 30, or 40.");
      }
      const result = await withApiClient(config, (client) =>
        updateGroupMember(client, {
          organizationId,
          groupId,
          userId,
          accessLevel,
          expiresAt: validateExpiresAt(options.expiresAt),
        })
      );
      emitRepoOutput(result, output, "group member update");
    });

  groupMember
    .command("remove")
    .description("Remove one group member")
    .argument("<groupId>", "Group ID or path")
    .argument("<userId>", "User ID")
    .option("--org <organizationId>", "Organization ID")
    .option("--yes", "Skip confirmation", false)
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write group member remove output to file")
    .option("--json", "Print raw JSON")
    .action(async (groupId: string, userId: string, options: RepoMemberRemoveOptions) => {
      if (!options.yes) {
        throw new CliError("Refusing to remove member without confirmation. Re-run with `--yes`.");
      }
      const config = loadConfig();
      const output = resolveRepoOutputSettings(options);
      const organizationId = resolveOrganizationId(config, options.org);
      const result = await withApiClient(config, (client) =>
        deleteGroupMember(client, {
          organizationId,
          groupId,
          userId,
        })
      );
      emitRepoOutput(result, output, "group member remove");
    });

  member
    .command("clone-username")
    .description("Get HTTPS clone username of one user")
    .argument("<userId>", "User ID")
    .option("--org <organizationId>", "Organization ID")
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write clone username output to file")
    .option("--json", "Print raw JSON")
    .action(async (userId: string, options: RepoMemberCloneUsernameOptions) => {
      const config = loadConfig();
      const output = resolveRepoOutputSettings(options);
      const organizationId = resolveOrganizationId(config, options.org);
      const result = await withApiClient(config, (client) =>
        getMemberHttpsCloneUsername(client, {
          organizationId,
          userId,
        })
      );
      emitRepoOutput(result, output, "clone username");
    });

  const webhook = repo.command("webhook").description("Repository webhook commands");

  webhook
    .command("list")
    .description("List repository webhooks")
    .argument("<repositoryId>", "Repository ID or path")
    .option("--org <organizationId>", "Organization ID")
    .option("--page <number>", "Page number", parsePositiveIntegerOption)
    .option("--per-page <number>", "Items per page", parsePositiveIntegerOption)
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write webhook list output to file")
    .option("--json", "Print raw JSON")
    .action(async (repositoryId: string, options: RepoWebhookListOptions) => {
      const config = loadConfig();
      const output = resolveRepoOutputSettings(options);
      const organizationId = resolveOrganizationId(config, options.org);
      const result = await withApiClient(config, (client) =>
        listRepositoryWebhooks(client, {
          organizationId,
          repositoryId,
          page: options.page,
          perPage: options.perPage,
        })
      );
      emitRepoOutput(result, output, "webhook list");
    });

  webhook
    .command("view")
    .description("Show one repository webhook")
    .argument("<repositoryId>", "Repository ID or path")
    .argument("<hookId>", "Webhook ID")
    .option("--org <organizationId>", "Organization ID")
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write webhook view output to file")
    .option("--json", "Print raw JSON")
    .action(async (repositoryId: string, hookId: string, options: RepoWebhookViewOptions) => {
      const config = loadConfig();
      const output = resolveRepoOutputSettings(options);
      const organizationId = resolveOrganizationId(config, options.org);
      const result = await withApiClient(config, (client) =>
        getRepositoryWebhook(client, {
          organizationId,
          repositoryId,
          hookId,
        })
      );
      emitRepoOutput(result, output, "webhook view");
    });

  webhook
    .command("create")
    .description("Create one repository webhook")
    .argument("<repositoryId>", "Repository ID or path")
    .option("--org <organizationId>", "Organization ID")
    .option("--body <json>", "Raw webhook JSON body")
    .option("--url <url>", "Webhook URL")
    .option("--description <text>", "Webhook description")
    .option("--token <token>", "Secret token")
    .option("--enable-ssl-verification <boolean>", "true|false")
    .option("--push-events <boolean>", "true|false")
    .option("--merge-requests-events <boolean>", "true|false")
    .option("--note-events <boolean>", "true|false")
    .option("--tag-push-events <boolean>", "true|false")
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write webhook create output to file")
    .option("--json", "Print raw JSON")
    .action(async (repositoryId: string, options: RepoWebhookMutateOptions) => {
      const config = loadConfig();
      const output = resolveRepoOutputSettings(options);
      const organizationId = resolveOrganizationId(config, options.org);
      const body = buildWebhookPayload(options, "create");
      const result = await withApiClient(config, (client) =>
        createRepositoryWebhook(client, {
          organizationId,
          repositoryId,
          body,
        })
      );
      emitRepoOutput(result, output, "webhook create");
    });

  webhook
    .command("update")
    .description("Update one repository webhook")
    .argument("<repositoryId>", "Repository ID or path")
    .argument("<hookId>", "Webhook ID")
    .option("--org <organizationId>", "Organization ID")
    .option("--body <json>", "Raw webhook JSON body")
    .option("--url <url>", "Webhook URL")
    .option("--description <text>", "Webhook description")
    .option("--token <token>", "Secret token")
    .option("--enable-ssl-verification <boolean>", "true|false")
    .option("--push-events <boolean>", "true|false")
    .option("--merge-requests-events <boolean>", "true|false")
    .option("--note-events <boolean>", "true|false")
    .option("--tag-push-events <boolean>", "true|false")
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write webhook update output to file")
    .option("--json", "Print raw JSON")
    .action(async (repositoryId: string, hookId: string, options: RepoWebhookMutateOptions) => {
      const config = loadConfig();
      const output = resolveRepoOutputSettings(options);
      const organizationId = resolveOrganizationId(config, options.org);
      const rawBody = buildWebhookPayload(options, "update");
      const result = await withApiClient(config, async (client) => {
        const body: Record<string, unknown> = {
          ...rawBody,
        };
        if (body.url === undefined) {
          try {
            const existing = await getRepositoryWebhook(client, {
              organizationId,
              repositoryId,
              hookId,
            });
            const existingUrl = resolveWebhookUrl(existing);
            if (existingUrl) {
              body.url = existingUrl;
            }
          } catch {
            // Keep graceful behavior: update still proceeds and surfaces backend validation if url is required.
          }
        }

        return updateRepositoryWebhook(client, {
          organizationId,
          repositoryId,
          hookId,
          body,
        });
      });
      emitRepoOutput(result, output, "webhook update");
    });

  webhook
    .command("delete")
    .description("Delete one repository webhook")
    .argument("<repositoryId>", "Repository ID or path")
    .argument("<hookId>", "Webhook ID")
    .option("--org <organizationId>", "Organization ID")
    .option("--yes", "Skip confirmation", false)
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write webhook delete output to file")
    .option("--json", "Print raw JSON")
    .action(async (repositoryId: string, hookId: string, options: RepoWebhookDeleteOptions) => {
      if (!options.yes) {
        throw new CliError("Refusing to delete webhook without confirmation. Re-run with `--yes`.");
      }
      const config = loadConfig();
      const output = resolveRepoOutputSettings(options);
      const organizationId = resolveOrganizationId(config, options.org);
      const result = await withApiClient(config, (client) =>
        deleteRepositoryWebhook(client, {
          organizationId,
          repositoryId,
          hookId,
        })
      );
      emitRepoOutput(result, output, "webhook delete");
    });

  repo
    .command("set-default")
    .description("Set default repository in local config")
    .argument("<repositoryId>", "Repository ID or path")
    .option("--org <organizationId>", "Organization ID for optional verification")
    .option("--no-verify", "Skip repository existence check")
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write set-default output to file")
    .option("--json", "Print raw JSON")
    .action(async (repositoryId: string, options: RepoSetDefaultOptions) => {
      const config = loadConfig();
      const output = resolveRepoOutputSettings(options);

      if (options.verify !== false && options.org) {
        const organizationId = resolveOrganizationId(config, options.org);
        await withApiClient(config, (client) =>
          getRepository(client, {
            organizationId,
            repositoryId,
          })
        );
      }

      config.defaults.repositoryId = repositoryId;
      saveConfig(config);

      emitRepoOutput(
        {
          updated: true,
          defaults: {
            repositoryId,
          },
        },
        output,
        "set-default"
      );
    });
}

function resolveRepoOutputSettings(options: { json?: boolean }): {
  format: "table" | "tsv" | "json";
  out?: string;
} {
  const outputOptions = options as { format?: string; out?: string; json?: boolean };
  const format = normalizeRichOutputFormat(outputOptions.format, outputOptions.json);
  assertRichOutputFileOption(outputOptions.out, format);
  return {
    format,
    out: outputOptions.out,
  };
}

function emitRepoOutput(
  payload: unknown,
  output: { format: "table" | "tsv" | "json"; out?: string },
  label: string
): void {
  if (output.out) {
    writeRichOutputFile(output.out, renderRichOutput(payload, output.format));
    process.stdout.write(`Saved ${label} output to ${output.out}.\n`);
    return;
  }
  printRichData(payload, output.format);
}

type RepoListOptions = {
  org?: string;
  page?: number;
  perPage?: number;
  orderBy?: string;
  sort?: string;
  search?: string;
  archived?: boolean;
  format?: string;
  out?: string;
  json?: boolean;
};

type RepoViewOptions = {
  org?: string;
  web?: boolean;
  format?: string;
  out?: string;
  json?: boolean;
};

type RepoCloneOptions = {
  org?: string;
  protocol: "auto" | "ssh" | "http" | "https";
  remoteName: string;
  dryRun?: boolean;
  format?: string;
  out?: string;
  json?: boolean;
};

type RepoCreateOptions = {
  name?: string;
  org?: string;
  path?: string;
  description?: string;
  visibility?: "private" | "internal" | "public";
  private?: boolean;
  internal?: boolean;
  public?: boolean;
  addReadme?: boolean;
  gitignore?: string;
  clone?: boolean;
  directory?: string;
  remoteName: string;
  dryRun?: boolean;
  format?: string;
  out?: string;
  json?: boolean;
};

type RepoEditOptions = {
  org?: string;
  name?: string;
  path?: string;
  description?: string;
  defaultBranch?: string;
  visibility?: "private" | "internal" | "public";
  private?: boolean;
  internal?: boolean;
  public?: boolean;
  format?: string;
  out?: string;
  json?: boolean;
};

type RepoDeleteOptions = {
  org?: string;
  reason?: string;
  yes?: boolean;
  format?: string;
  out?: string;
  json?: boolean;
};

type RepoSetDefaultOptions = {
  org?: string;
  verify?: boolean;
  format?: string;
  out?: string;
  json?: boolean;
};

type RepoBranchListOptions = {
  org?: string;
  page?: number;
  perPage?: number;
  sort?: string;
  search?: string;
  format?: string;
  out?: string;
  json?: boolean;
};

type RepoBranchCreateOptions = {
  org?: string;
  ref?: string;
  format?: string;
  out?: string;
  json?: boolean;
};

type RepoBranchDeleteOptions = {
  org?: string;
  yes?: boolean;
  format?: string;
  out?: string;
  json?: boolean;
};

type RepoBranchProtectListOptions = {
  org?: string;
  format?: string;
  out?: string;
  json?: boolean;
};

type RepoBranchProtectCreateOptions = {
  org?: string;
  allowPushRoles?: string;
  allowMergeRoles?: string;
  allowPushUserIds?: string;
  allowMergeUserIds?: string;
  mergeRequestSetting?: string;
  testSetting?: string;
  format?: string;
  out?: string;
  json?: boolean;
};

type RepoBranchProtectViewOptions = {
  org?: string;
  format?: string;
  out?: string;
  json?: boolean;
};

type RepoBranchProtectUpdateOptions = {
  org?: string;
  branch?: string;
  allowPushRoles?: string;
  allowMergeRoles?: string;
  allowPushUserIds?: string;
  allowMergeUserIds?: string;
  mergeRequestSetting?: string;
  testSetting?: string;
  format?: string;
  out?: string;
  json?: boolean;
};

type RepoBranchProtectDeleteOptions = {
  org?: string;
  yes?: boolean;
  format?: string;
  out?: string;
  json?: boolean;
};

type RepoTagListOptions = {
  org?: string;
  page?: number;
  perPage?: number;
  sort?: string;
  search?: string;
  format?: string;
  out?: string;
  json?: boolean;
};

type RepoTagCreateOptions = {
  org?: string;
  ref?: string;
  message?: string;
  format?: string;
  out?: string;
  json?: boolean;
};

type RepoTagDeleteOptions = {
  org?: string;
  yes?: boolean;
  format?: string;
  out?: string;
  json?: boolean;
};

type RepoCheckRunListOptions = {
  org?: string;
  ref: string;
  page?: number;
  perPage?: number;
  format?: string;
  out?: string;
  json?: boolean;
};

type RepoCheckRunViewOptions = {
  org?: string;
  format?: string;
  out?: string;
  json?: boolean;
};

type RepoCheckRunMutateOptions = {
  org?: string;
  body?: string;
  name?: string;
  headSha?: string;
  status?: string;
  conclusion?: string;
  detailsUrl?: string;
  externalId?: string;
  startedAt?: string;
  completedAt?: string;
  title?: string;
  summary?: string;
  text?: string;
  annotation: string[];
  format?: string;
  out?: string;
  json?: boolean;
};

type RepoCommitStatusListOptions = {
  org?: string;
  page?: number;
  perPage?: number;
  format?: string;
  out?: string;
  json?: boolean;
};

type RepoCommitStatusCreateOptions = {
  org?: string;
  body?: string;
  context?: string;
  state?: string;
  description?: string;
  targetUrl?: string;
  format?: string;
  out?: string;
  json?: boolean;
};

type RepoMemberListOptions = {
  org?: string;
  accessLevel?: number;
  format?: string;
  out?: string;
  json?: boolean;
};

type RepoMemberAddOptions = {
  org?: string;
  accessLevel: number;
  user: string[];
  users?: string;
  expiresAt?: string;
  format?: string;
  out?: string;
  json?: boolean;
};

type RepoMemberUpdateOptions = {
  org?: string;
  accessLevel: number;
  expiresAt?: string;
  format?: string;
  out?: string;
  json?: boolean;
};

type RepoMemberRemoveOptions = {
  org?: string;
  yes?: boolean;
  format?: string;
  out?: string;
  json?: boolean;
};

type RepoMemberCloneUsernameOptions = {
  org?: string;
  format?: string;
  out?: string;
  json?: boolean;
};

type RepoWebhookListOptions = {
  org?: string;
  page?: number;
  perPage?: number;
  format?: string;
  out?: string;
  json?: boolean;
};

type RepoWebhookViewOptions = {
  org?: string;
  format?: string;
  out?: string;
  json?: boolean;
};

type RepoWebhookMutateOptions = {
  org?: string;
  body?: string;
  url?: string;
  description?: string;
  token?: string;
  enableSslVerification?: string;
  pushEvents?: string;
  mergeRequestsEvents?: string;
  noteEvents?: string;
  tagPushEvents?: string;
  format?: string;
  out?: string;
  json?: boolean;
};

type RepoWebhookDeleteOptions = {
  org?: string;
  yes?: boolean;
  format?: string;
  out?: string;
  json?: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolveRepositoryCloneUrl(detail: Record<string, unknown>, protocol: RepoCloneOptions["protocol"]): string | undefined {
  const sshCandidates = [
    "sshUrlToRepo",
    "ssh_url_to_repo",
    "sshCloneUrl",
    "cloneUrlSsh",
    "sshUrl",
    "sshAddress",
  ];
  const httpCandidates = [
    "httpUrlToRepo",
    "http_url_to_repo",
    "httpCloneUrl",
    "cloneUrlHttp",
    "httpsUrl",
    "httpsCloneUrl",
    "httpUrl",
  ];

  const readFrom = (keys: string[]): string | undefined => {
    for (const key of keys) {
      const value = detail[key];
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }
    return undefined;
  };

  const sshUrl = readFrom(sshCandidates);
  const httpUrl = readFrom(httpCandidates);
  if (protocol === "ssh") {
    return sshUrl ?? convertWebUrlToGit(detail.webUrl);
  }
  if (protocol === "http" || protocol === "https") {
    return httpUrl ?? convertWebUrlToGit(detail.webUrl);
  }

  return sshUrl ?? httpUrl ?? convertWebUrlToGit(detail.webUrl);
}

function convertWebUrlToGit(webUrlValue: unknown): string | undefined {
  if (typeof webUrlValue !== "string" || !webUrlValue.trim()) {
    return undefined;
  }
  const webUrl = webUrlValue.trim();
  if (webUrl.endsWith(".git")) {
    return webUrl;
  }
  return `${webUrl}.git`;
}

function deriveDirectoryFromCloneUrl(cloneUrl: string): string {
  const normalized = cloneUrl.replace(/\/+$/, "");
  const parts = normalized.split(/[/:]/);
  const last = parts[parts.length - 1] || "repo";
  return last.endsWith(".git") ? last.slice(0, -4) : last;
}

function resolveVisibilityLevel(options: {
  visibility?: "private" | "internal" | "public";
  private?: boolean;
  internal?: boolean;
  public?: boolean;
}): number | undefined {
  const flagCount = [options.private, options.internal, options.public].filter(Boolean).length;
  if (flagCount > 1) {
    throw new CliError("Choose only one visibility flag: --private, --internal, or --public.");
  }

  const explicit = options.visibility?.toLowerCase();
  if (explicit && !["private", "internal", "public"].includes(explicit)) {
    throw new CliError("Invalid --visibility value. Expected private | internal | public.");
  }

  const visibility = options.private
    ? "private"
    : options.internal
      ? "internal"
      : options.public
        ? "public"
        : explicit;

  if (!visibility) {
    return undefined;
  }

  if (visibility === "private") {
    return 0;
  }
  if (visibility === "internal") {
    return 10;
  }
  return 20;
}

function extractRepositoryRecord(response: unknown): Record<string, unknown> | undefined {
  if (!isRecord(response)) {
    return undefined;
  }

  const candidates = ["result", "data", "body"];
  for (const key of candidates) {
    const value = response[key];
    if (isRecord(value)) {
      return value;
    }
  }

  return response;
}

async function resolveRefOrDefaultBranch(
  client: YunxiaoApiClient,
  organizationId: string,
  repositoryId: string,
  ref?: string
): Promise<string> {
  if (ref && ref.trim()) {
    return ref.trim();
  }

  try {
    const detail = await getRepository(client, {
      organizationId,
      repositoryId,
    });
    const defaultBranch = readDefaultBranch(detail);
    if (defaultBranch) {
      return defaultBranch;
    }
  } catch {
    // Keep a safe fallback so create command can still proceed when detail API is limited.
  }

  try {
    const response = await listRepositoryBranches(client, {
      organizationId,
      repositoryId,
      page: 1,
      perPage: 20,
      sort: "name_asc",
    });
    const branchNames = extractBranchNames(response);
    const preferred = pickPreferredBranch(branchNames);
    if (preferred) {
      return preferred;
    }
  } catch {
    // Ignore and continue fallback.
  }

  return "master";
}

function readDefaultBranch(detail: unknown): string | undefined {
  if (!isRecord(detail)) {
    return undefined;
  }

  const direct = detail.defaultBranch;
  if (typeof direct === "string" && direct.trim()) {
    return direct.trim();
  }

  const nested = extractRepositoryRecord(detail);
  if (!nested) {
    return undefined;
  }

  const value = nested.defaultBranch;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseCommaList(value: string | undefined): string[] | undefined {
  if (!value) {
    return undefined;
  }
  const list = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (list.length === 0) {
    return undefined;
  }
  return Array.from(new Set(list));
}

function parseCommaNumberList(value: string | undefined): number[] | undefined {
  const list = parseCommaList(value);
  if (!list) {
    return undefined;
  }
  const numbers: number[] = [];
  for (const item of list) {
    if (!/^-?\d+$/.test(item)) {
      throw new CliError(`Invalid integer value in list: ${item}`);
    }
    numbers.push(Number.parseInt(item, 10));
  }
  return numbers;
}

function parseJsonRecordOption(value: string | undefined, optionName: string): Record<string, unknown> | undefined {
  if (!value || !value.trim()) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(value);
    if (!isRecord(parsed)) {
      throw new CliError(`${optionName} must be a JSON object.`);
    }
    return parsed;
  } catch (error) {
    if (error instanceof CliError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new CliError(`Invalid JSON for ${optionName}: ${message}`);
  }
}

function readProtectedBranchName(response: unknown): string | undefined {
  if (!isRecord(response)) {
    return undefined;
  }
  const value = response.branch;
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  return undefined;
}

function extractBranchNames(response: unknown): string[] {
  if (Array.isArray(response)) {
    return response
      .map((item) => (isRecord(item) ? item.name : undefined))
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .map((value) => value.trim());
  }

  if (!isRecord(response)) {
    return [];
  }

  const candidates = ["result", "data", "items", "branches"];
  for (const key of candidates) {
    const value = response[key];
    if (!Array.isArray(value)) {
      continue;
    }
    const names = value
      .map((item) => (isRecord(item) ? item.name : undefined))
      .filter((name): name is string => typeof name === "string" && name.trim().length > 0)
      .map((name) => name.trim());
    if (names.length > 0) {
      return names;
    }
  }

  return [];
}

function pickPreferredBranch(branchNames: string[]): string | undefined {
  if (branchNames.length === 0) {
    return undefined;
  }
  const preference = ["main", "master", "trunk", "develop", "dev"];
  for (const name of preference) {
    if (branchNames.includes(name)) {
      return name;
    }
  }
  return branchNames[0];
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

function buildCheckRunPayload(options: RepoCheckRunMutateOptions): Record<string, unknown> {
  const base = parseJsonRecordOption(options.body, "--body") ?? {};
  const payload: Record<string, unknown> = {
    ...base,
  };

  if (options.name !== undefined) {
    payload.name = options.name;
  }
  if (options.headSha !== undefined) {
    payload.headSha = options.headSha;
  }
  if (options.status !== undefined) {
    payload.status = options.status;
  }
  if (options.conclusion !== undefined) {
    payload.conclusion = options.conclusion;
  }
  if (options.detailsUrl !== undefined) {
    payload.detailsUrl = options.detailsUrl;
  }
  if (options.externalId !== undefined) {
    payload.externalId = options.externalId;
  }
  if (options.startedAt !== undefined) {
    payload.startedAt = options.startedAt;
  }
  if (options.completedAt !== undefined) {
    payload.completedAt = options.completedAt;
  }

  if (options.title !== undefined || options.summary !== undefined || options.text !== undefined) {
    const output = isRecord(payload.output) ? { ...payload.output } : {};
    if (options.title !== undefined) {
      output.title = options.title;
    }
    if (options.summary !== undefined) {
      output.summary = options.summary;
    }
    if (options.text !== undefined) {
      output.text = options.text;
    }
    payload.output = output;
  }

  if (options.annotation.length > 0) {
    payload.annotations = options.annotation.map((item, idx) => {
      const parsed = parseJsonRecordOption(item, `--annotation[${idx}]`);
      if (!parsed) {
        throw new CliError(`--annotation[${idx}] cannot be empty.`);
      }
      return parsed;
    });
  }

  if (Object.keys(payload).length === 0) {
    throw new CliError("No check-run payload provided. Use --body or options like --name/--status/--annotation.");
  }

  return payload;
}

function buildCommitStatusPayload(options: RepoCommitStatusCreateOptions): Record<string, unknown> {
  const base = parseJsonRecordOption(options.body, "--body") ?? {};
  const payload: Record<string, unknown> = {
    ...base,
  };

  if (options.context !== undefined) {
    payload.context = options.context;
  }
  if (options.state !== undefined) {
    payload.state = options.state;
  }
  if (options.description !== undefined) {
    payload.description = options.description;
  }
  if (options.targetUrl !== undefined) {
    payload.targetUrl = options.targetUrl;
  }

  if (Object.keys(payload).length === 0) {
    throw new CliError("No commit-status payload provided. Use --body or options like --state/--context.");
  }

  return payload;
}

function validateAccessLevel(value: number | undefined, required: boolean): number | undefined {
  if (value === undefined || Number.isNaN(value)) {
    if (required) {
      throw new CliError("Missing --access-level. Use 20, 30, or 40.");
    }
    return undefined;
  }

  const allowed = required ? [20, 30, 40] : [0, 20, 30, 40];
  if (!allowed.includes(value)) {
    throw new CliError(`Invalid access level: ${value}. Expected ${allowed.join("|")}.`);
  }
  return value;
}

function resolveMemberUserIds(userOptions: string[], usersCsv?: string): string {
  const merged = [...userOptions];
  if (usersCsv) {
    const parsed = parseCommaList(usersCsv);
    if (parsed) {
      merged.push(...parsed);
    }
  }

  const normalized = Array.from(
    new Set(
      merged
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );
  if (normalized.length === 0) {
    throw new CliError("Missing users. Pass --user <id> (repeatable) or --users <id1,id2>.");
  }

  return normalized.join(",");
}

function validateExpiresAt(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim();
  if (!normalized) {
    return undefined;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new CliError(`Invalid --expires-at: ${value}. Expected yyyy-MM-dd.`);
  }
  return normalized;
}

function buildWebhookPayload(options: RepoWebhookMutateOptions, mode: "create" | "update"): Record<string, unknown> {
  const base = parseJsonRecordOption(options.body, "--body") ?? {};
  const payload: Record<string, unknown> = {
    ...base,
  };

  if (options.url !== undefined) {
    payload.url = options.url;
  }
  if (options.description !== undefined) {
    payload.description = options.description;
  }
  if (options.token !== undefined) {
    payload.token = options.token;
  }

  const enableSslVerification = parseOptionalBoolean(options.enableSslVerification, "--enable-ssl-verification");
  if (enableSslVerification !== undefined) {
    payload.enableSslVerification = enableSslVerification;
  }
  const pushEvents = parseOptionalBoolean(options.pushEvents, "--push-events");
  if (pushEvents !== undefined) {
    payload.pushEvents = pushEvents;
  }
  const mergeRequestsEvents = parseOptionalBoolean(options.mergeRequestsEvents, "--merge-requests-events");
  if (mergeRequestsEvents !== undefined) {
    payload.mergeRequestsEvents = mergeRequestsEvents;
  }
  const noteEvents = parseOptionalBoolean(options.noteEvents, "--note-events");
  if (noteEvents !== undefined) {
    payload.noteEvents = noteEvents;
  }
  const tagPushEvents = parseOptionalBoolean(options.tagPushEvents, "--tag-push-events");
  if (tagPushEvents !== undefined) {
    payload.tagPushEvents = tagPushEvents;
  }

  if (mode === "create" && payload.url === undefined) {
    throw new CliError("Missing webhook URL. Use --url or include `url` in --body.");
  }
  if (Object.keys(payload).length === 0) {
    throw new CliError("No webhook payload provided. Use --body or options like --url/--push-events.");
  }

  return payload;
}

function parseOptionalBoolean(value: string | undefined, optionName: string): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "y", "on"].includes(normalized)) {
    return true;
  }
  if (["false", "0", "no", "n", "off"].includes(normalized)) {
    return false;
  }
  throw new CliError(`Invalid ${optionName}: ${value}. Expected true|false.`);
}

function resolveCheckRunOutputTitle(value: unknown): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const output = value.output;
  if (!isRecord(output)) {
    return undefined;
  }
  const title = output.title;
  if (typeof title !== "string") {
    return undefined;
  }
  const normalized = title.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function resolveWebhookUrl(value: unknown): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const candidates = ["url", "webUrl", "webhookUrl"];
  for (const key of candidates) {
    const current = value[key];
    if (typeof current === "string" && current.trim()) {
      return current;
    }
  }
  return undefined;
}
