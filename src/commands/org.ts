import fs from "node:fs";
import { Command } from "commander";
import { parsePositiveIntegerOption } from "../core/utils/options.js";
import { loadConfig, saveConfig } from "../core/config/store.js";
import { withApiClient, YunxiaoApiClient } from "../core/api/client.js";
import {
  buildProjectExtraConditions,
  createProjectMember,
  createProjectRole,
  createProject,
  deleteProjectMember,
  deleteProjectRole,
  deleteProject,
  getCurrentUser,
  listAllProjectRoles,
  listOrganizationMembers,
  listProjectMembers,
  listProjectRoles,
  listProjectTemplates,
  listUserOrganizations,
  searchProjects,
} from "../core/api/org.js";
import { printData } from "../core/output/print.js";
import { resolveOrganizationId, resolveOutputFormat, resolveProjectId } from "../core/utils/context.js";
import { resolveUserSelector, resolveUserSelectors } from "../core/utils/user.js";
import { CliError } from "../core/errors.js";

export function registerOrgCommand(program: Command): void {
  const org = program.command("org").description("Organization and project context commands");

  org
    .command("current")
    .description("Show current user profile and last organization")
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write org current output to file")
    .option("--json", "Print raw JSON")
    .action(async (options: OrgCurrentOptions) => {
      const config = loadConfig();
      const outputFormat = normalizeOrgOutputFormat(options.format, options.json);
      if (options.out && outputFormat === "table") {
        throw new CliError("`--out` requires --format tsv/json (or --json).");
      }
      const result = await withApiClient(config, (client) => getCurrentUser(client));
      if (options.out) {
        await writeOrgOutputFile(options.out, formatOrgEntityOutput(result, outputFormat));
        process.stdout.write(`Saved org current output to ${options.out}.\n`);
        return;
      }
      if (outputFormat === "tsv") {
        process.stdout.write(`${formatOrgEntityTsv(result)}\n`);
        return;
      }
      printData(result, { format: outputFormat === "json" ? "json" : "table" });
    });

  org
    .command("list")
    .description("List organizations that current user can access")
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write org list output to file")
    .option("--json", "Print raw JSON")
    .action(async (options: OrgListOptions) => {
      const config = loadConfig();
      const outputFormat = normalizeOrgOutputFormat(options.format, options.json);
      if (options.out && outputFormat === "table") {
        throw new CliError("`--out` requires --format tsv/json (or --json).");
      }
      const result = await withApiClient(config, (client) => listUserOrganizations(client));
      const items = extractOrgListItems(result);
      if (options.out) {
        await writeOrgOutputFile(options.out, formatOrgListOutput(result, items, outputFormat));
        process.stdout.write(`Saved org list output to ${options.out}.\n`);
        return;
      }
      if (outputFormat === "tsv") {
        process.stdout.write(`${formatOrgListTsv(items)}\n`);
        return;
      }
      printData(result, { format: outputFormat === "json" ? "json" : "table" });
    });

  org
    .command("members")
    .description("List organization members")
    .option("--org <organizationId>", "Organization ID")
    .option("--page <number>", "Page number", parsePositiveIntegerOption)
    .option("--per-page <number>", "Items per page", parsePositiveIntegerOption)
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write org members output to file")
    .option("--json", "Print raw JSON")
    .action(async (options: OrgMembersOptions) => {
      const config = loadConfig();
      const organizationId = resolveOrganizationId(config, options.org);
      const outputFormat = normalizeOrgOutputFormat(options.format, options.json);
      if (options.out && outputFormat === "table") {
        throw new CliError("`--out` requires --format tsv/json (or --json).");
      }

      const result = await withApiClient(config, (client) =>
        listOrganizationMembers(client, {
          organizationId,
          page: options.page,
          perPage: options.perPage,
        })
      );

      const items = extractOrgListItems(result);
      if (options.out) {
        await writeOrgOutputFile(options.out, formatOrgListOutput(result, items, outputFormat));
        process.stdout.write(`Saved org members output to ${options.out}.\n`);
        return;
      }
      if (outputFormat === "tsv") {
        process.stdout.write(`${formatOrgListTsv(items)}\n`);
        return;
      }
      printData(result, { format: outputFormat === "json" ? "json" : "table" });
    });

  org
    .command("projects")
    .description("List/search projects in an organization")
    .option("--org <organizationId>", "Organization ID")
    .option("--name <keyword>", "Project name keyword")
    .option("--status <status>", "Project status list, comma-separated")
    .option("--scenario <scenario>", "manage | participate | favorite")
    .option("--user <userId>", "User selector for --scenario, supports self", "self")
    .option("--extra-conditions <json>", "Raw extraConditions JSON string")
    .option("--order-by <field>", "Order field, e.g. gmtCreate|name", "gmtCreate")
    .option("--sort <direction>", "asc | desc", "desc")
    .option("--page <number>", "Page number", parsePositiveIntegerOption)
    .option("--per-page <number>", "Items per page", parsePositiveIntegerOption)
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write org projects output to file")
    .option("--json", "Print raw JSON")
    .action(async (options: OrgProjectsOptions) => {
      const config = loadConfig();
      const organizationId = resolveOrganizationId(config, options.org);
      const outputFormat = normalizeOrgOutputFormat(options.format, options.json);
      if (options.out && outputFormat === "table") {
        throw new CliError("`--out` requires --format tsv/json (or --json).");
      }

      const result = await withApiClient(config, async (client) => {
        let extraConditions = options.extraConditions;

        if (options.scenario) {
          const normalized = options.scenario.trim().toLowerCase();
          if (!["manage", "participate", "favorite"].includes(normalized)) {
            throw new CliError("Invalid --scenario. Use manage | participate | favorite.");
          }

          const userId = await resolveUserSelector(client, options.user ?? "self");
          if (!userId) {
            throw new CliError("Cannot resolve --user for project scenario filtering.");
          }

          extraConditions = buildProjectExtraConditions(
            normalized as "manage" | "participate" | "favorite",
            userId
          );
        }

        return searchProjects(client, {
          organizationId,
          name: options.name,
          status: options.status,
          extraConditions,
          orderBy: options.orderBy,
          sort: options.sort,
          page: options.page,
          perPage: options.perPage,
        });
      });

      const items = extractOrgListItems(result);
      if (options.out) {
        await writeOrgOutputFile(options.out, formatOrgListOutput(result, items, outputFormat));
        process.stdout.write(`Saved org projects output to ${options.out}.\n`);
        return;
      }
      if (outputFormat === "tsv") {
        process.stdout.write(`${formatOrgListTsv(items)}\n`);
        return;
      }
      printData(result, { format: outputFormat === "json" ? "json" : "table" });
    });

  org
    .command("project-templates")
    .description("List project templates (for issue/project bootstrap)")
    .option("--org <organizationId>", "Organization ID")
    .option("--category <category>", "Template category")
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write org project templates output to file")
    .option("--json", "Print raw JSON")
    .action(async (options: OrgProjectTemplatesOptions) => {
      const config = loadConfig();
      const organizationId = resolveOrganizationId(config, options.org);
      const outputFormat = normalizeOrgOutputFormat(options.format, options.json);
      if (options.out && outputFormat === "table") {
        throw new CliError("`--out` requires --format tsv/json (or --json).");
      }

      const result = await withApiClient(config, (client) =>
        listProjectTemplates(client, {
          organizationId,
          category: options.category,
        })
      );

      const items = extractOrgListItems(result);
      if (options.out) {
        await writeOrgOutputFile(options.out, formatOrgListOutput(result, items, outputFormat));
        process.stdout.write(`Saved org project templates output to ${options.out}.\n`);
        return;
      }
      if (outputFormat === "tsv") {
        process.stdout.write(`${formatOrgListTsv(items)}\n`);
        return;
      }
      printData(result, { format: outputFormat === "json" ? "json" : "table" });
    });

  org
    .command("roles")
    .description("List all available project roles in organization")
    .option("--org <organizationId>", "Organization ID")
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write org roles output to file")
    .option("--json", "Print raw JSON")
    .action(async (options: OrgRolesOptions) => {
      const config = loadConfig();
      const organizationId = resolveOrganizationId(config, options.org);
      const outputFormat = normalizeOrgOutputFormat(options.format, options.json);
      if (options.out && outputFormat === "table") {
        throw new CliError("`--out` requires --format tsv/json (or --json).");
      }

      const result = await withApiClient(config, (client) =>
        listAllProjectRoles(client, {
          organizationId,
        })
      );

      const items = extractOrgListItems(result);
      if (options.out) {
        await writeOrgOutputFile(options.out, formatOrgListOutput(result, items, outputFormat));
        process.stdout.write(`Saved org roles output to ${options.out}.\n`);
        return;
      }
      if (outputFormat === "tsv") {
        process.stdout.write(`${formatOrgListTsv(items)}\n`);
        return;
      }
      printData(result, { format: outputFormat === "json" ? "json" : "table" });
    });

  org
    .command("project-roles")
    .description("List roles in one project")
    .option("--org <organizationId>", "Organization ID")
    .option("--project <projectId>", "Project ID")
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write org project roles output to file")
    .option("--json", "Print raw JSON")
    .action(async (options: OrgProjectRolesOptions) => {
      const config = loadConfig();
      const organizationId = resolveOrganizationId(config, options.org);
      const projectId = resolveProjectId(config, options.project);
      const outputFormat = normalizeOrgOutputFormat(options.format, options.json);
      if (options.out && outputFormat === "table") {
        throw new CliError("`--out` requires --format tsv/json (or --json).");
      }

      const result = await withApiClient(config, (client) =>
        listProjectRoles(client, {
          organizationId,
          projectId,
        })
      );

      const items = extractOrgListItems(result);
      if (options.out) {
        await writeOrgOutputFile(options.out, formatOrgListOutput(result, items, outputFormat));
        process.stdout.write(`Saved org project roles output to ${options.out}.\n`);
        return;
      }
      if (outputFormat === "tsv") {
        process.stdout.write(`${formatOrgListTsv(items)}\n`);
        return;
      }
      printData(result, { format: outputFormat === "json" ? "json" : "table" });
    });

  org
    .command("project-role-add")
    .description("Add role(s) to one project")
    .requiredOption("--role <roleIds>", "Role IDs, comma-separated")
    .option("--org <organizationId>", "Organization ID")
    .option("--project <projectId>", "Project ID")
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write project role add output to file")
    .option("--json", "Print raw JSON")
    .action(async (options: OrgProjectRoleAddOptions) => {
      const config = loadConfig();
      const organizationId = resolveOrganizationId(config, options.org);
      const projectId = resolveProjectId(config, options.project);
      const outputFormat = normalizeOrgOutputFormat(options.format, options.json);
      if (options.out && outputFormat === "table") {
        throw new CliError("`--out` requires --format tsv/json (or --json).");
      }
      const roleIds = parseRoleIds(options.role);
      if (roleIds.length === 0) {
        throw new CliError("Missing --role. Pass at least one role ID.");
      }

      const result = await withApiClient(config, async (client) => {
        const response = await createProjectRole(client, {
          organizationId,
          projectId,
          roleIds,
        });

        return {
          projectId,
          roleIds,
          added: true,
          result: response ?? null,
        };
      });

      if (options.out) {
        await writeOrgOutputFile(options.out, formatOrgEntityOutput(result, outputFormat));
        process.stdout.write(`Saved project role add output to ${options.out}.\n`);
        return;
      }
      if (outputFormat === "tsv") {
        process.stdout.write(`${formatOrgEntityTsv(result)}\n`);
        return;
      }

      printData(result, { format: outputFormat === "json" ? "json" : "table" });
    });

  org
    .command("project-role-remove")
    .description("Remove role(s) from one project")
    .requiredOption("--role <roleIds>", "Role IDs, comma-separated")
    .option("--org <organizationId>", "Organization ID")
    .option("--project <projectId>", "Project ID")
    .option("--yes", "Skip confirmation", false)
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write project role remove output to file")
    .option("--json", "Print raw JSON")
    .action(async (options: OrgProjectRoleRemoveOptions) => {
      if (!options.yes) {
        throw new CliError("Refusing to remove project roles without confirmation. Re-run with `--yes`.");
      }

      const config = loadConfig();
      const organizationId = resolveOrganizationId(config, options.org);
      const projectId = resolveProjectId(config, options.project);
      const outputFormat = normalizeOrgOutputFormat(options.format, options.json);
      if (options.out && outputFormat === "table") {
        throw new CliError("`--out` requires --format tsv/json (or --json).");
      }
      const roleIds = parseRoleIds(options.role);
      if (roleIds.length === 0) {
        throw new CliError("Missing --role. Pass at least one role ID.");
      }

      const result = await withApiClient(config, async (client) => {
        const response = await deleteProjectRole(client, {
          organizationId,
          projectId,
          roleIds,
        });

        return {
          projectId,
          roleIds,
          removed: true,
          result: response ?? null,
        };
      });

      if (options.out) {
        await writeOrgOutputFile(options.out, formatOrgEntityOutput(result, outputFormat));
        process.stdout.write(`Saved project role remove output to ${options.out}.\n`);
        return;
      }
      if (outputFormat === "tsv") {
        process.stdout.write(`${formatOrgEntityTsv(result)}\n`);
        return;
      }

      printData(result, { format: outputFormat === "json" ? "json" : "table" });
    });

  org
    .command("project-members")
    .description("List members in one project")
    .option("--org <organizationId>", "Organization ID")
    .option("--project <projectId>", "Project ID")
    .option("--name <keyword>", "Member name keyword")
    .option("--role <roleId>", "Role ID filter, e.g. project.admin")
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write org project members output to file")
    .option("--json", "Print raw JSON")
    .action(async (options: OrgProjectMembersOptions) => {
      const config = loadConfig();
      const organizationId = resolveOrganizationId(config, options.org);
      const projectId = resolveProjectId(config, options.project);
      const outputFormat = normalizeOrgOutputFormat(options.format, options.json);
      if (options.out && outputFormat === "table") {
        throw new CliError("`--out` requires --format tsv/json (or --json).");
      }

      const result = await withApiClient(config, (client) =>
        listProjectMembers(client, {
          organizationId,
          projectId,
          name: options.name,
          roleId: options.role,
        })
      );

      const items = extractOrgListItems(result);
      if (options.out) {
        await writeOrgOutputFile(options.out, formatOrgListOutput(result, items, outputFormat));
        process.stdout.write(`Saved org project members output to ${options.out}.\n`);
        return;
      }
      if (outputFormat === "tsv") {
        process.stdout.write(`${formatOrgListTsv(items)}\n`);
        return;
      }
      printData(result, { format: outputFormat === "json" ? "json" : "table" });
    });

  org
    .command("project-member-add")
    .description("Add project member(s)")
    .requiredOption("--user <selectors>", "User ID selectors, comma-separated; supports self")
    .option("--org <organizationId>", "Organization ID")
    .option("--project <projectId>", "Project ID")
    .option("--role <roleId>", "Role ID", "project.participant")
    .option("--operator <userId>", "Operator user ID")
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write project member add output to file")
    .option("--json", "Print raw JSON")
    .action(async (options: OrgProjectMemberAddOptions) => {
      const config = loadConfig();
      const organizationId = resolveOrganizationId(config, options.org);
      const projectId = resolveProjectId(config, options.project);
      const outputFormat = normalizeOrgOutputFormat(options.format, options.json);
      if (options.out && outputFormat === "table") {
        throw new CliError("`--out` requires --format tsv/json (or --json).");
      }

      const result = await withApiClient(config, async (client) => {
        const userIds = await resolveUserSelectors(client, options.user);
        if (!userIds || userIds.length === 0) {
          throw new CliError("Cannot resolve users. Pass --user <userId[,userId]>.");
        }

        const response = await createProjectMember(client, {
          organizationId,
          projectId,
          roleId: options.role ?? "project.participant",
          userIds,
          operatorId: options.operator,
        });

        return {
          projectId,
          roleId: options.role ?? "project.participant",
          userIds,
          added: true,
          result: response ?? null,
        };
      });

      if (options.out) {
        await writeOrgOutputFile(options.out, formatOrgEntityOutput(result, outputFormat));
        process.stdout.write(`Saved project member add output to ${options.out}.\n`);
        return;
      }
      if (outputFormat === "tsv") {
        process.stdout.write(`${formatOrgEntityTsv(result)}\n`);
        return;
      }

      printData(result, { format: outputFormat === "json" ? "json" : "table" });
    });

  org
    .command("project-member-remove")
    .description("Remove project member role(s)")
    .requiredOption("--user <selectors>", "User ID selectors, comma-separated; supports self")
    .option("--org <organizationId>", "Organization ID")
    .option("--project <projectId>", "Project ID")
    .option("--role <roleIds>", "Role IDs, comma-separated", "project.participant")
    .option("--operator <userId>", "Operator user ID")
    .option("--yes", "Skip confirmation", false)
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write project member remove output to file")
    .option("--json", "Print raw JSON")
    .action(async (options: OrgProjectMemberRemoveOptions) => {
      if (!options.yes) {
        throw new CliError("Refusing to remove project member roles without confirmation. Re-run with `--yes`.");
      }

      const config = loadConfig();
      const organizationId = resolveOrganizationId(config, options.org);
      const projectId = resolveProjectId(config, options.project);
      const outputFormat = normalizeOrgOutputFormat(options.format, options.json);
      if (options.out && outputFormat === "table") {
        throw new CliError("`--out` requires --format tsv/json (or --json).");
      }
      const roleIds = parseRoleIds(options.role);
      if (roleIds.length === 0) {
        throw new CliError("Missing --role. Pass at least one role ID.");
      }

      const result = await withApiClient(config, async (client) => {
        const userIds = await resolveUserSelectors(client, options.user);
        if (!userIds || userIds.length === 0) {
          throw new CliError("Cannot resolve users. Pass --user <userId[,userId]>.");
        }

        const responses: unknown[] = [];
        for (const userId of userIds) {
          const response = await deleteProjectMember(client, {
            organizationId,
            projectId,
            roleIds,
            userId,
            operatorId: options.operator,
          });
          responses.push({
            userId,
            result: response ?? null,
          });
        }

        return {
          projectId,
          roleIds,
          userIds,
          removed: true,
          users: responses,
        };
      });

      if (options.out) {
        await writeOrgOutputFile(options.out, formatOrgEntityOutput(result, outputFormat));
        process.stdout.write(`Saved project member remove output to ${options.out}.\n`);
        return;
      }
      if (outputFormat === "tsv") {
        process.stdout.write(`${formatOrgEntityTsv(result)}\n`);
        return;
      }

      printData(result, { format: outputFormat === "json" ? "json" : "table" });
    });

  org
    .command("project-create")
    .description("Create a project for issue/workitem usage")
    .requiredOption("--name <name>", "Project name")
    .requiredOption("--template-id <templateId>", "Project template ID")
    .option("--org <organizationId>", "Organization ID")
    .option("--identifier <identifier>", "Project identifier/custom code")
    .option("--custom-code <code>", "Project custom code (4-6 uppercase letters)")
    .option("--scope <scope>", "private | public", "private")
    .option("--description <description>", "Project description")
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write org project create output to file")
    .option("--json", "Print raw JSON")
    .action(async (options: OrgProjectCreateOptions) => {
      const config = loadConfig();
      const organizationId = resolveOrganizationId(config, options.org);
      const outputFormat = normalizeOrgOutputFormat(options.format, options.json);
      if (options.out && outputFormat === "table") {
        throw new CliError("`--out` requires --format tsv/json (or --json).");
      }

      const result = await withApiClient(config, (client) =>
        createProject(client, {
          organizationId,
          name: options.name,
          templateId: options.templateId,
          identifier: options.identifier,
          customCode: options.customCode,
          scope: options.scope,
          description: options.description,
        })
      );

      if (options.out) {
        await writeOrgOutputFile(options.out, formatOrgEntityOutput(result, outputFormat));
        process.stdout.write(`Saved org project create output to ${options.out}.\n`);
        return;
      }
      if (outputFormat === "tsv") {
        process.stdout.write(`${formatOrgEntityTsv(result)}\n`);
        return;
      }
      printData(result, { format: outputFormat === "json" ? "json" : "table" });
    });

  org
    .command("project-delete")
    .description("Delete a project")
    .argument("<projectId>", "Project ID")
    .option("--org <organizationId>", "Organization ID")
    .option("--name <name>", "Project name (required by API, auto-detected if omitted)")
    .option("--yes", "Skip confirmation", false)
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write org project delete output to file")
    .option("--json", "Print raw JSON")
    .action(async (projectId: string, options: OrgProjectDeleteOptions) => {
      if (!options.yes) {
        throw new CliError("Refusing to delete project without confirmation. Re-run with `--yes`.");
      }

      const config = loadConfig();
      const organizationId = resolveOrganizationId(config, options.org);
      const outputFormat = normalizeOrgOutputFormat(options.format, options.json);
      if (options.out && outputFormat === "table") {
        throw new CliError("`--out` requires --format tsv/json (or --json).");
      }

      const result = await withApiClient(config, async (client) => {
        const projectName =
          options.name ??
          (await resolveProjectNameById(client, {
            organizationId,
            projectId,
          }));
        if (!projectName) {
          throw new CliError("Cannot resolve project name. Pass --name <projectName> explicitly.");
        }

        await deleteProject(client, {
          organizationId,
          projectId,
          name: projectName,
        });

        return {
          projectId,
          name: projectName,
          result: true,
        };
      });

      if (options.out) {
        await writeOrgOutputFile(options.out, formatOrgEntityOutput(result, outputFormat));
        process.stdout.write(`Saved org project delete output to ${options.out}.\n`);
        return;
      }
      if (outputFormat === "tsv") {
        process.stdout.write(`${formatOrgEntityTsv(result)}\n`);
        return;
      }
      printData(result, { format: outputFormat === "json" ? "json" : "table" });
    });

  org
    .command("use")
    .description("Set default organization/project in local config")
    .argument("<organizationId>", "Organization ID")
    .option("--project <projectId>", "Default project ID")
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write org use output to file")
    .option("--json", "Print raw JSON")
    .action(async (organizationId: string, options: OrgUseOptions) => {
      const config = loadConfig();
      const outputFormat = normalizeOrgOutputFormat(options.format, options.json);
      if (options.out && outputFormat === "table") {
        throw new CliError("`--out` requires --format tsv/json (or --json).");
      }
      config.defaults.organizationId = organizationId;
      if (options.project) {
        config.defaults.projectId = options.project;
      }
      saveConfig(config);

      const result = {
        updated: true,
        defaults: {
          organizationId,
          projectId: options.project ?? config.defaults.projectId ?? null,
        },
      };

      if (options.out) {
        await writeOrgOutputFile(options.out, formatOrgEntityOutput(result, outputFormat));
        process.stdout.write(`Saved org use output to ${options.out}.\n`);
        return;
      }
      if (outputFormat === "tsv") {
        process.stdout.write(`${formatOrgEntityTsv(result)}\n`);
        return;
      }
      if (outputFormat === "json") {
        printData(result, { format: "json" });
        return;
      }

      printData(result, { format: "table" });
    });
}

type OrgMembersOptions = {
  org?: string;
  page?: number;
  perPage?: number;
  format: string;
  out?: string;
  json?: boolean;
};

type OrgCurrentOptions = {
  format: string;
  out?: string;
  json?: boolean;
};

type OrgListOptions = {
  format: string;
  out?: string;
  json?: boolean;
};

type OrgProjectsOptions = {
  org?: string;
  name?: string;
  status?: string;
  scenario?: string;
  user?: string;
  extraConditions?: string;
  orderBy?: string;
  sort?: string;
  page?: number;
  perPage?: number;
  format: string;
  out?: string;
  json?: boolean;
};

type OrgProjectTemplatesOptions = {
  org?: string;
  category?: string;
  format: string;
  out?: string;
  json?: boolean;
};

type OrgRolesOptions = {
  org?: string;
  format: string;
  out?: string;
  json?: boolean;
};

type OrgProjectRolesOptions = {
  org?: string;
  project?: string;
  format: string;
  out?: string;
  json?: boolean;
};

type OrgProjectRoleAddOptions = {
  org?: string;
  project?: string;
  role: string;
  format: string;
  out?: string;
  json?: boolean;
};

type OrgProjectRoleRemoveOptions = {
  org?: string;
  project?: string;
  role: string;
  yes?: boolean;
  format: string;
  out?: string;
  json?: boolean;
};

type OrgProjectMembersOptions = {
  org?: string;
  project?: string;
  name?: string;
  role?: string;
  format: string;
  out?: string;
  json?: boolean;
};

type OrgProjectMemberAddOptions = {
  org?: string;
  project?: string;
  user: string;
  role?: string;
  operator?: string;
  format: string;
  out?: string;
  json?: boolean;
};

type OrgProjectMemberRemoveOptions = {
  org?: string;
  project?: string;
  user: string;
  role?: string;
  operator?: string;
  yes?: boolean;
  format: string;
  out?: string;
  json?: boolean;
};

type OrgProjectCreateOptions = {
  org?: string;
  name: string;
  templateId: string;
  identifier?: string;
  customCode?: string;
  scope?: "private" | "public";
  description?: string;
  format: string;
  out?: string;
  json?: boolean;
};

type OrgProjectDeleteOptions = {
  org?: string;
  name?: string;
  yes?: boolean;
  format: string;
  out?: string;
  json?: boolean;
};

type OrgUseOptions = {
  project?: string;
  format: string;
  out?: string;
  json?: boolean;
};

async function resolveProjectNameById(client: YunxiaoApiClient, input: {
  organizationId: string;
  projectId: string;
}): Promise<string | undefined> {
  const pageSize = 100;
  for (let page = 1; page <= 20; page += 1) {
    const response = await searchProjects(client, {
      organizationId: input.organizationId,
      page,
      perPage: pageSize,
      orderBy: "gmtCreate",
      sort: "desc",
    });
    const items = extractProjectItems(response);
    if (items.length === 0) {
      break;
    }

    const matched = items.find((item) => readProjectIdentifier(item) === input.projectId);
    if (matched) {
      const name = typeof matched.name === "string" ? matched.name.trim() : "";
      if (name) {
        return name;
      }
    }

    if (items.length < pageSize) {
      break;
    }
  }

  return undefined;
}

function extractProjectItems(response: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(response)) {
    return response.filter(isRecord);
  }
  if (!isRecord(response)) {
    return [];
  }

  const keys = ["items", "records", "result", "data"];
  for (const key of keys) {
    const value = response[key];
    if (!Array.isArray(value)) {
      continue;
    }
    return value.filter(isRecord);
  }
  return [];
}

function readProjectIdentifier(item: Record<string, unknown>): string | undefined {
  const candidateKeys = ["id", "identifier", "projectId", "spaceId"];
  for (const key of candidateKeys) {
    const value = item[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(Math.round(value));
    }
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseRoleIds(value?: string): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeOrgOutputFormat(format: string, jsonFlag?: boolean): "table" | "tsv" | "json" {
  if (jsonFlag) {
    return "json";
  }
  if (format === "table" || format === "tsv" || format === "json") {
    return format;
  }
  throw new CliError(`Invalid --format value: ${format}. Use table, tsv, or json.`);
}

function formatOrgListOutput(
  result: unknown,
  items: Record<string, unknown>[],
  format: "table" | "tsv" | "json"
): string {
  if (format === "json") {
    return `${JSON.stringify(result, null, 2)}\n`;
  }
  if (format === "tsv") {
    return `${formatOrgListTsv(items)}\n`;
  }
  return `${JSON.stringify(result, null, 2)}\n`;
}

function formatOrgListTsv(items: Record<string, unknown>[]): string {
  const columns = collectOrgListColumns(items);
  if (items.length === 0) {
    return columns.join("\t");
  }

  const lines = [columns.join("\t")];
  for (const item of items) {
    lines.push(columns.map((column) => formatOrgTsvCell(item[column])).join("\t"));
  }
  return lines.join("\n");
}

function collectOrgListColumns(items: Record<string, unknown>[]): string[] {
  const columns = new Set<string>();
  for (const item of items) {
    for (const key of Object.keys(item)) {
      columns.add(key);
    }
  }
  if (columns.size > 0) {
    return Array.from(columns);
  }
  return ["value"];
}

function extractOrgListItems(response: unknown): Record<string, unknown>[] {
  if (Array.isArray(response)) {
    return response.filter(isRecord);
  }
  if (!isRecord(response)) {
    return [];
  }

  const keys = ["items", "records", "result", "data", "list", "members", "projects", "roles"];
  for (const key of keys) {
    const value = response[key];
    if (!Array.isArray(value)) {
      continue;
    }
    return value.filter(isRecord);
  }
  return [];
}

function formatOrgEntityOutput(result: unknown, format: "table" | "tsv" | "json"): string {
  if (format === "json") {
    return `${JSON.stringify(result, null, 2)}\n`;
  }
  if (format === "tsv") {
    return `${formatOrgEntityTsv(result)}\n`;
  }
  return `${JSON.stringify(result, null, 2)}\n`;
}

function formatOrgEntityTsv(result: unknown): string {
  if (!isRecord(result)) {
    return `key\tvalue\nvalue\t${formatOrgTsvCell(result)}`;
  }
  const lines = ["key\tvalue"];
  for (const [key, value] of Object.entries(result)) {
    lines.push(`${key}\t${formatOrgTsvCell(value)}`);
  }
  return lines.join("\n");
}

function formatOrgTsvCell(value: unknown): string {
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

async function writeOrgOutputFile(path: string, content: string): Promise<void> {
  fs.writeFileSync(path, content, "utf8");
}
