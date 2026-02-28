import fs from "node:fs";
import { Command } from "commander";
import { loadConfig } from "../core/config/store.js";
import { withApiClient } from "../core/api/client.js";
import { createMilestone, deleteMilestone, listMilestones, updateMilestone } from "../core/api/milestone.js";
import { printData } from "../core/output/print.js";
import { resolveOrganizationId, resolveProjectId } from "../core/utils/context.js";
import { parsePositiveIntegerOption } from "../core/utils/options.js";
import { resolveUserSelector } from "../core/utils/user.js";
import { CliError } from "../core/errors.js";
import { YunxiaoApiClient } from "../core/api/client.js";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function registerMilestoneCommand(program: Command): void {
  const milestone = program.command("milestone").description("Manage projex milestones");

  milestone
    .command("list")
    .description("List milestones in one project")
    .option("--org <organizationId>", "Organization ID")
    .option("--project <projectId>", "Project ID (spaceIdentifier)")
    .option("--status <statusList>", "Filter by status list, comma-separated")
    .option("--page <number>", "Page number", parsePositiveIntegerOption)
    .option("--per-page <number>", "Items per page", parsePositiveIntegerOption)
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write milestone list output to file")
    .option("--json", "Print raw JSON")
    .action(async (options: MilestoneListOptions) => {
      const config = loadConfig();
      const organizationId = resolveOrganizationId(config, options.org);
      const projectId = resolveProjectId(config, options.project);
      const outputFormat = normalizeMilestoneOutputFormat(options.format, options.json);
      if (options.out && outputFormat === "table") {
        throw new CliError("`--out` requires --format tsv/json (or --json).");
      }

      const result = await withApiClient(config, (client) =>
        listMilestones(client, {
          organizationId,
          projectId,
          status: parseStatusList(options.status),
          page: options.page,
          perPage: options.perPage,
        })
      );
      const items = extractMilestoneList(result);

      if (options.out) {
        await writeMilestoneOutputFile(options.out, formatMilestoneListOutput(items, outputFormat));
        process.stdout.write(`Saved milestone list output to ${options.out}.\n`);
        return;
      }

      if (outputFormat === "tsv") {
        process.stdout.write(`${formatMilestoneListTsv(items)}\n`);
        return;
      }

      printData(items, {
        format: outputFormat === "json" ? "json" : "table",
      });
    });

  milestone
    .command("view")
    .description("View one milestone by ID")
    .argument("<milestoneId>", "Milestone ID")
    .option("--org <organizationId>", "Organization ID")
    .option("--project <projectId>", "Project ID (spaceIdentifier)")
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write milestone view output to file")
    .option("--json", "Print raw JSON")
    .action(async (milestoneId: string, options: MilestoneViewOptions) => {
      const config = loadConfig();
      const organizationId = resolveOrganizationId(config, options.org);
      const projectId = resolveProjectId(config, options.project);
      const outputFormat = normalizeMilestoneOutputFormat(options.format, options.json);
      if (options.out && outputFormat === "table") {
        throw new CliError("`--out` requires --format tsv/json (or --json).");
      }

      const result = await withApiClient(config, async (client) =>
        findMilestoneById(client, {
          organizationId,
          projectId,
          milestoneId,
          perPage: 100,
        })
      );

      if (options.out) {
        await writeMilestoneOutputFile(options.out, formatMilestoneEntityOutput(result, outputFormat));
        process.stdout.write(`Saved milestone view output to ${options.out}.\n`);
        return;
      }
      if (outputFormat === "tsv") {
        process.stdout.write(`${formatMilestoneEntityTsv(result)}\n`);
        return;
      }

      printData(result, {
        format: outputFormat === "json" ? "json" : "table",
      });
    });

  milestone
    .command("create")
    .description("Create one milestone")
    .requiredOption("--subject <subject>", "Milestone title")
    .requiredOption("--plan-end-date <date>", "Planned end date (YYYY-MM-DD)")
    .option("--org <organizationId>", "Organization ID")
    .option("--project <projectId>", "Project ID (spaceIdentifier)")
    .option("--assignee <userId>", "Assignee user ID, supports self", "self")
    .option("--description <text>", "Milestone description")
    .option("--operator <userId>", "Operator user ID (optional)")
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write milestone create output to file")
    .option("--json", "Print raw JSON")
    .action(async (options: MilestoneCreateOptions) => {
      validateIsoDate("plan-end-date", options.planEndDate);

      const config = loadConfig();
      const organizationId = resolveOrganizationId(config, options.org);
      const projectId = resolveProjectId(config, options.project);
      const outputFormat = normalizeMilestoneOutputFormat(options.format, options.json);
      if (options.out && outputFormat === "table") {
        throw new CliError("`--out` requires --format tsv/json (or --json).");
      }

      const result = await withApiClient(config, async (client) => {
        const assignedTo = await resolveUserSelector(client, options.assignee ?? "self");
        if (!assignedTo) {
          throw new CliError(
            "Cannot resolve assignee. Pass --assignee <userId> or ensure current user is available."
          );
        }

        return createMilestone(client, {
          organizationId,
          projectId,
          subject: options.subject,
          planEndDate: options.planEndDate,
          assignedTo,
          description: options.description,
          operatorId: options.operator,
        });
      });

      if (options.out) {
        await writeMilestoneOutputFile(options.out, formatMilestoneEntityOutput(result, outputFormat));
        process.stdout.write(`Saved milestone create output to ${options.out}.\n`);
        return;
      }
      if (outputFormat === "tsv") {
        process.stdout.write(`${formatMilestoneEntityTsv(result)}\n`);
        return;
      }

      printData(result, {
        format: outputFormat === "json" ? "json" : "table",
      });
    });

  milestone
    .command("update")
    .description("Update one milestone")
    .argument("<milestoneId>", "Milestone ID")
    .option("--org <organizationId>", "Organization ID")
    .option("--project <projectId>", "Project ID (spaceIdentifier)")
    .option("--subject <subject>", "Milestone title")
    .option("--plan-end-date <date>", "Planned end date (YYYY-MM-DD)")
    .option("--actual-end-date <date>", "Actual end date (YYYY-MM-DD)")
    .option("--status <status>", "Milestone status")
    .option("--assignee <userId>", "Assignee user ID, supports self")
    .option("--description <text>", "Milestone description")
    .option("--operator <userId>", "Operator user ID (optional)")
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write milestone update output to file")
    .option("--json", "Print raw JSON")
    .action(async (milestoneId: string, options: MilestoneUpdateOptions) => {
      validateIsoDate("plan-end-date", options.planEndDate);
      validateIsoDate("actual-end-date", options.actualEndDate);

      if (!hasMilestoneUpdateChanges(options)) {
        throw new CliError(
          "No update fields provided. Pass at least one of --subject/--plan-end-date/--actual-end-date/--status/--assignee/--description."
        );
      }

      const config = loadConfig();
      const organizationId = resolveOrganizationId(config, options.org);
      const projectId = resolveProjectId(config, options.project);
      const outputFormat = normalizeMilestoneOutputFormat(options.format, options.json);
      if (options.out && outputFormat === "table") {
        throw new CliError("`--out` requires --format tsv/json (or --json).");
      }

      const result = await withApiClient(config, async (client) => {
        const assignedTo = options.assignee ? await resolveUserSelector(client, options.assignee) : undefined;
        if (options.assignee && !assignedTo) {
          throw new CliError(
            "Cannot resolve assignee. Pass --assignee <userId> or ensure current user is available."
          );
        }

        const response = await updateMilestone(client, {
          organizationId,
          projectId,
          milestoneId,
          subject: options.subject,
          planEndDate: options.planEndDate,
          actualEndDate: options.actualEndDate,
          assignedTo,
          description: options.description,
          status: options.status,
          operatorId: options.operator,
        });

        if (outputFormat === "json") {
          return {
            milestoneId,
            result: response ?? null,
          };
        }

        return {
          milestoneId,
          updated: true,
          subject: options.subject,
          planEndDate: options.planEndDate,
          actualEndDate: options.actualEndDate,
          status: options.status,
          assignedTo,
          description: options.description,
        };
      });

      if (options.out) {
        await writeMilestoneOutputFile(options.out, formatMilestoneEntityOutput(result, outputFormat));
        process.stdout.write(`Saved milestone update output to ${options.out}.\n`);
        return;
      }
      if (outputFormat === "tsv") {
        process.stdout.write(`${formatMilestoneEntityTsv(result)}\n`);
        return;
      }

      printData(result, {
        format: outputFormat === "json" ? "json" : "table",
      });
    });

  milestone
    .command("delete")
    .description("Delete one milestone")
    .argument("<milestoneId>", "Milestone ID")
    .option("--org <organizationId>", "Organization ID")
    .option("--project <projectId>", "Project ID (spaceIdentifier)")
    .option("--operator <userId>", "Operator user ID (optional)")
    .option("--yes", "Skip confirmation", false)
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write milestone delete output to file")
    .option("--json", "Print raw JSON")
    .action(async (milestoneId: string, options: MilestoneDeleteOptions) => {
      if (!options.yes) {
        throw new CliError("Refusing to delete milestone without confirmation. Re-run with `--yes`.");
      }

      const config = loadConfig();
      const organizationId = resolveOrganizationId(config, options.org);
      const projectId = resolveProjectId(config, options.project);
      const outputFormat = normalizeMilestoneOutputFormat(options.format, options.json);
      if (options.out && outputFormat === "table") {
        throw new CliError("`--out` requires --format tsv/json (or --json).");
      }

      const result = await withApiClient(config, async (client) => {
        const response = await deleteMilestone(client, {
          organizationId,
          projectId,
          milestoneId,
          operatorId: options.operator,
        });

        if (outputFormat === "json") {
          return {
            method: response.method,
            result: response.result ?? null,
          };
        }

        return {
          milestoneId,
          deleted: true,
          method: response.method,
        };
      });

      if (options.out) {
        await writeMilestoneOutputFile(options.out, formatMilestoneEntityOutput(result, outputFormat));
        process.stdout.write(`Saved milestone delete output to ${options.out}.\n`);
        return;
      }
      if (outputFormat === "tsv") {
        process.stdout.write(`${formatMilestoneEntityTsv(result)}\n`);
        return;
      }

      printData(result, {
        format: outputFormat === "json" ? "json" : "table",
      });
    });
}

function normalizeMilestoneOutputFormat(format: string, jsonFlag?: boolean): "table" | "tsv" | "json" {
  if (jsonFlag) {
    return "json";
  }
  if (format === "table" || format === "tsv" || format === "json") {
    return format;
  }
  throw new CliError(`Invalid --format value: ${format}. Use table, tsv, or json.`);
}

function formatMilestoneListOutput(result: Record<string, unknown>[], format: "table" | "tsv" | "json"): string {
  if (format === "json") {
    return `${JSON.stringify(result, null, 2)}\n`;
  }
  if (format === "tsv") {
    return `${formatMilestoneListTsv(result)}\n`;
  }
  return `${JSON.stringify(result, null, 2)}\n`;
}

function formatMilestoneEntityOutput(result: unknown, format: "table" | "tsv" | "json"): string {
  if (format === "json") {
    return `${JSON.stringify(result, null, 2)}\n`;
  }
  if (format === "tsv") {
    return `${formatMilestoneEntityTsv(result)}\n`;
  }
  return `${JSON.stringify(result, null, 2)}\n`;
}

function formatMilestoneListTsv(result: Record<string, unknown>[]): string {
  const columns = ["id", "subject", "status", "assignedTo", "planEndDate", "actualEndDate", "createdAt", "updatedAt"];
  const header = columns.join("\t");
  if (result.length === 0) {
    return header;
  }
  const rows = result.map((item) =>
    columns.map((column) => formatTsvCell(item[column])).join("\t")
  );
  return [header, ...rows].join("\n");
}

function formatMilestoneEntityTsv(result: unknown): string {
  if (!isRecord(result)) {
    return `key\tvalue\nvalue\t${formatTsvCell(result)}`;
  }
  const lines = ["key\tvalue"];
  for (const [key, value] of Object.entries(result)) {
    lines.push(`${key}\t${formatTsvCell(value)}`);
  }
  return lines.join("\n");
}

async function writeMilestoneOutputFile(path: string, content: string): Promise<void> {
  fs.writeFileSync(path, content, "utf8");
}

function formatTsvCell(value: unknown): string {
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

function validateIsoDate(fieldName: string, value?: string): void {
  if (!value) {
    return;
  }
  if (!ISO_DATE_RE.test(value)) {
    throw new CliError(`Invalid --${fieldName} value: ${value}. Expected YYYY-MM-DD.`);
  }
}

function parseStatusList(value?: string): string[] | undefined {
  if (!value || !value.trim()) {
    return undefined;
  }
  const items = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length ? [...new Set(items)] : undefined;
}

function hasMilestoneUpdateChanges(options: MilestoneUpdateOptions): boolean {
  return Boolean(
    options.subject ??
      options.planEndDate ??
      options.actualEndDate ??
      options.status ??
      options.assignee ??
      options.description
  );
}

function extractMilestoneList(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) {
    return payload.filter(isRecord);
  }
  if (!isRecord(payload)) {
    return [];
  }

  const candidates = [payload.items, payload.milestones, payload.result, payload.data];
  for (const value of candidates) {
    if (Array.isArray(value)) {
      return value.filter(isRecord);
    }
  }

  if (isRecord(payload.body)) {
    return extractMilestoneList(payload.body);
  }

  return [];
}

async function findMilestoneById(
  client: YunxiaoApiClient,
  input: {
    organizationId: string;
    projectId: string;
    milestoneId: string;
    perPage: number;
  }
): Promise<Record<string, unknown>> {
  const pageSize = Math.max(1, Math.min(100, input.perPage));
  let page = 1;
  while (page <= 200) {
    const response = await listMilestones(client, {
      organizationId: input.organizationId,
      projectId: input.projectId,
      page,
      perPage: pageSize,
    });
    const items = extractMilestoneList(response);
    const found = items.find((item) => {
      const id = item.id;
      return typeof id === "string" && id === input.milestoneId;
    });
    if (found) {
      return found;
    }
    if (items.length < pageSize) {
      break;
    }
    page += 1;
  }

  throw new CliError(`Milestone ${input.milestoneId} not found in project ${input.projectId}.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type MilestoneListOptions = {
  org?: string;
  project?: string;
  status?: string;
  page?: number;
  perPage?: number;
  format: string;
  out?: string;
  json?: boolean;
};

type MilestoneViewOptions = {
  org?: string;
  project?: string;
  format: string;
  out?: string;
  json?: boolean;
};

type MilestoneCreateOptions = {
  org?: string;
  project?: string;
  subject: string;
  planEndDate: string;
  assignee?: string;
  description?: string;
  operator?: string;
  format: string;
  out?: string;
  json?: boolean;
};

type MilestoneUpdateOptions = {
  org?: string;
  project?: string;
  subject?: string;
  planEndDate?: string;
  actualEndDate?: string;
  status?: string;
  assignee?: string;
  description?: string;
  operator?: string;
  format: string;
  out?: string;
  json?: boolean;
};

type MilestoneDeleteOptions = {
  org?: string;
  project?: string;
  operator?: string;
  yes?: boolean;
  format: string;
  out?: string;
  json?: boolean;
};
