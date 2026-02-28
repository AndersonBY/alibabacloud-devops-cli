import fs from "node:fs";
import { Command } from "commander";
import { loadConfig } from "../core/config/store.js";
import { withApiClient } from "../core/api/client.js";
import { createSprint, getSprintInfo, listSprints, updateSprint } from "../core/api/sprint.js";
import { printData } from "../core/output/print.js";
import { resolveOrganizationId, resolveProjectId } from "../core/utils/context.js";
import { parsePositiveIntegerOption } from "../core/utils/options.js";
import { resolveUserSelectors } from "../core/utils/user.js";
import { CliError } from "../core/errors.js";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SPRINT_STATUS_SET = new Set(["TODO", "DOING", "ARCHIVED"]);

export function registerSprintCommand(program: Command): void {
  const sprint = program.command("sprint").description("Manage projex sprints (iterations)");

  sprint
    .command("list")
    .description("List sprints for one project")
    .option("--org <organizationId>", "Organization ID")
    .option("--project <projectId>", "Project ID (spaceIdentifier)")
    .option("--status <statusList>", "Filter by status list, comma-separated (TODO,DOING,ARCHIVED)")
    .option("--page <number>", "Page number", parsePositiveIntegerOption)
    .option("--per-page <number>", "Items per page", parsePositiveIntegerOption)
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write sprint list output to file")
    .option("--json", "Print raw JSON")
    .action(async (options: SprintListOptions) => {
      const config = loadConfig();
      const organizationId = resolveOrganizationId(config, options.org);
      const projectId = resolveProjectId(config, options.project);
      const statuses = parseSprintStatuses(options.status);
      const outputFormat = normalizeSprintOutputFormat(options.format, options.json);
      if (options.out && outputFormat === "table") {
        throw new CliError("`--out` requires --format tsv/json (or --json).");
      }

      const result = await withApiClient(config, (client) =>
        listSprints(client, {
          organizationId,
          projectId,
          status: statuses,
          page: options.page,
          perPage: options.perPage,
        })
      );
      const items = extractSprintList(result);

      if (options.out) {
        await writeSprintOutputFile(options.out, formatSprintListOutput(items, outputFormat));
        process.stdout.write(`Saved sprint list output to ${options.out}.\n`);
        return;
      }
      if (outputFormat === "tsv") {
        process.stdout.write(`${formatSprintListTsv(items)}\n`);
        return;
      }

      printData(items, {
        format: outputFormat === "json" ? "json" : "table",
      });
    });

  sprint
    .command("view")
    .description("View one sprint")
    .argument("<sprintId>", "Sprint ID/identifier")
    .option("--org <organizationId>", "Organization ID")
    .option("--project <projectId>", "Project ID (spaceIdentifier)")
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write sprint view output to file")
    .option("--json", "Print raw JSON")
    .action(async (sprintId: string, options: SprintViewOptions) => {
      const config = loadConfig();
      const organizationId = resolveOrganizationId(config, options.org);
      const projectId = resolveProjectId(config, options.project);
      const outputFormat = normalizeSprintOutputFormat(options.format, options.json);
      if (options.out && outputFormat === "table") {
        throw new CliError("`--out` requires --format tsv/json (or --json).");
      }

      const result = await withApiClient(config, (client) =>
        getSprintInfo(client, {
          organizationId,
          projectId,
          sprintId,
        })
      );
      const viewData = extractSprintDetail(result) ?? result;

      if (options.out) {
        await writeSprintOutputFile(options.out, formatSprintEntityOutput(viewData, outputFormat));
        process.stdout.write(`Saved sprint view output to ${options.out}.\n`);
        return;
      }
      if (outputFormat === "tsv") {
        process.stdout.write(`${formatSprintEntityTsv(viewData)}\n`);
        return;
      }

      printData(outputFormat === "json" ? result : viewData, {
        format: outputFormat === "json" ? "json" : "table",
      });
    });

  sprint
    .command("create")
    .description("Create one sprint")
    .requiredOption("--name <name>", "Sprint name")
    .option("--org <organizationId>", "Organization ID")
    .option("--project <projectId>", "Project ID (spaceIdentifier)")
    .option("--owner <selectors>", "Owner user IDs, comma-separated; supports self", "self")
    .option("--start-date <date>", "Sprint start date (YYYY-MM-DD)")
    .option("--end-date <date>", "Sprint end date (YYYY-MM-DD)")
    .option("--description <text>", "Sprint description")
    .option("--capacity-hours <hours>", "Sprint capacity hours", parsePositiveIntegerOption)
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write sprint create output to file")
    .option("--json", "Print raw JSON")
    .action(async (options: SprintCreateOptions) => {
      validateIsoDate("start-date", options.startDate);
      validateIsoDate("end-date", options.endDate);
      validateDateOrder(options.startDate, options.endDate);

      const config = loadConfig();
      const organizationId = resolveOrganizationId(config, options.org);
      const projectId = resolveProjectId(config, options.project);
      const outputFormat = normalizeSprintOutputFormat(options.format, options.json);
      if (options.out && outputFormat === "table") {
        throw new CliError("`--out` requires --format tsv/json (or --json).");
      }

      const result = await withApiClient(config, async (client) => {
        const owners = await resolveUserSelectors(client, options.owner ?? "self");
        if (!owners || owners.length === 0) {
          throw new CliError("Cannot resolve sprint owners. Pass --owner <userId[,userId]>.");
        }

        return createSprint(client, {
          organizationId,
          projectId,
          name: options.name,
          owners,
          startDate: options.startDate,
          endDate: options.endDate,
          description: options.description,
          capacityHours: options.capacityHours,
        });
      });
      const detailData = extractSprintDetail(result) ?? result;

      if (options.out) {
        await writeSprintOutputFile(options.out, formatSprintEntityOutput(detailData, outputFormat));
        process.stdout.write(`Saved sprint create output to ${options.out}.\n`);
        return;
      }
      if (outputFormat === "tsv") {
        process.stdout.write(`${formatSprintEntityTsv(detailData)}\n`);
        return;
      }

      printData(outputFormat === "json" ? result : detailData, {
        format: outputFormat === "json" ? "json" : "table",
      });
    });

  sprint
    .command("update")
    .description("Update one sprint")
    .argument("<sprintId>", "Sprint ID/identifier")
    .requiredOption("--name <name>", "Sprint name")
    .option("--org <organizationId>", "Organization ID")
    .option("--project <projectId>", "Project ID (spaceIdentifier)")
    .option("--owner <selectors>", "Owner user IDs, comma-separated; supports self")
    .option("--start-date <date>", "Sprint start date (YYYY-MM-DD)")
    .option("--end-date <date>", "Sprint end date (YYYY-MM-DD)")
    .option("--description <text>", "Sprint description")
    .option("--capacity-hours <hours>", "Sprint capacity hours", parsePositiveIntegerOption)
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write sprint update output to file")
    .option("--json", "Print raw JSON")
    .action(async (sprintId: string, options: SprintUpdateOptions) => {
      validateIsoDate("start-date", options.startDate);
      validateIsoDate("end-date", options.endDate);
      validateDateOrder(options.startDate, options.endDate);

      const config = loadConfig();
      const organizationId = resolveOrganizationId(config, options.org);
      const projectId = resolveProjectId(config, options.project);
      const outputFormat = normalizeSprintOutputFormat(options.format, options.json);
      if (options.out && outputFormat === "table") {
        throw new CliError("`--out` requires --format tsv/json (or --json).");
      }

      const result = await withApiClient(config, async (client) => {
        const owners = options.owner ? await resolveUserSelectors(client, options.owner) : undefined;
        if (options.owner && (!owners || owners.length === 0)) {
          throw new CliError("Cannot resolve sprint owners. Pass --owner <userId[,userId]>.");
        }

        return updateSprint(client, {
          organizationId,
          projectId,
          sprintId,
          name: options.name,
          owners,
          startDate: options.startDate,
          endDate: options.endDate,
          description: options.description,
          capacityHours: options.capacityHours,
        });
      });
      const detailData = extractSprintDetail(result) ?? result;

      if (options.out) {
        await writeSprintOutputFile(options.out, formatSprintEntityOutput(detailData, outputFormat));
        process.stdout.write(`Saved sprint update output to ${options.out}.\n`);
        return;
      }
      if (outputFormat === "tsv") {
        process.stdout.write(`${formatSprintEntityTsv(detailData)}\n`);
        return;
      }

      printData(outputFormat === "json" ? result : detailData, {
        format: outputFormat === "json" ? "json" : "table",
      });
    });
}

function normalizeSprintOutputFormat(format: string, jsonFlag?: boolean): "table" | "tsv" | "json" {
  if (jsonFlag) {
    return "json";
  }
  if (format === "table" || format === "tsv" || format === "json") {
    return format;
  }
  throw new CliError(`Invalid --format value: ${format}. Use table, tsv, or json.`);
}

function formatSprintListOutput(result: Record<string, unknown>[], format: "table" | "tsv" | "json"): string {
  if (format === "json") {
    return `${JSON.stringify(result, null, 2)}\n`;
  }
  if (format === "tsv") {
    return `${formatSprintListTsv(result)}\n`;
  }
  return `${JSON.stringify(result, null, 2)}\n`;
}

function formatSprintEntityOutput(result: unknown, format: "table" | "tsv" | "json"): string {
  if (format === "json") {
    return `${JSON.stringify(result, null, 2)}\n`;
  }
  if (format === "tsv") {
    return `${formatSprintEntityTsv(result)}\n`;
  }
  return `${JSON.stringify(result, null, 2)}\n`;
}

function formatSprintListTsv(result: Record<string, unknown>[]): string {
  const columns = ["id", "identifier", "name", "status", "owners", "startDate", "endDate", "createdAt", "updatedAt"];
  const header = columns.join("\t");
  if (result.length === 0) {
    return header;
  }
  const rows = result.map((item) =>
    columns
      .map((column) =>
        column === "owners"
          ? formatTsvCell(formatSprintOwners(item.owners))
          : formatTsvCell(item[column])
      )
      .join("\t")
  );
  return [header, ...rows].join("\n");
}

function formatSprintEntityTsv(result: unknown): string {
  if (!isRecord(result)) {
    return `key\tvalue\nvalue\t${formatTsvCell(result)}`;
  }
  const lines = ["key\tvalue"];
  for (const [key, value] of Object.entries(result)) {
    if (key === "owners") {
      lines.push(`${key}\t${formatTsvCell(formatSprintOwners(value))}`);
      continue;
    }
    lines.push(`${key}\t${formatTsvCell(value)}`);
  }
  return lines.join("\n");
}

function formatSprintOwners(value: unknown): string {
  if (!Array.isArray(value)) {
    return "";
  }
  return value
    .map((item) => {
      if (typeof item === "string") {
        return item.trim();
      }
      if (isRecord(item)) {
        const id = typeof item.id === "string" ? item.id.trim() : "";
        const name = typeof item.name === "string" ? item.name.trim() : "";
        return name || id;
      }
      return "";
    })
    .filter(Boolean)
    .join(",");
}

async function writeSprintOutputFile(path: string, content: string): Promise<void> {
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
  if (value === undefined) {
    return;
  }
  if (!ISO_DATE_RE.test(value)) {
    throw new CliError(`Invalid --${fieldName} value: ${value}. Expected YYYY-MM-DD.`);
  }
}

function validateDateOrder(startDate?: string, endDate?: string): void {
  if (!startDate || !endDate) {
    return;
  }
  if (startDate > endDate) {
    throw new CliError(`Invalid date range: --start-date ${startDate} is after --end-date ${endDate}.`);
  }
}

function parseSprintStatuses(value?: string): string[] | undefined {
  if (!value || !value.trim()) {
    return undefined;
  }

  const statuses = value
    .split(",")
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
  if (statuses.length === 0) {
    return undefined;
  }
  for (const item of statuses) {
    if (!SPRINT_STATUS_SET.has(item)) {
      throw new CliError(`Invalid sprint status: ${item}. Use TODO,DOING,ARCHIVED.`);
    }
  }
  return [...new Set(statuses)];
}

function extractSprintList(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) {
    return payload.filter(isRecord);
  }
  if (!isRecord(payload)) {
    return [];
  }

  const candidates = [payload.sprints, payload.items, payload.result, payload.data];
  for (const value of candidates) {
    if (Array.isArray(value)) {
      return value.filter(isRecord);
    }
  }

  if (isRecord(payload.sprint)) {
    return [payload.sprint];
  }

  if (isRecord(payload.body)) {
    return extractSprintList(payload.body);
  }

  return [];
}

function extractSprintDetail(payload: unknown): Record<string, unknown> | undefined {
  if (!isRecord(payload)) {
    return undefined;
  }
  if (isRecord(payload.sprint)) {
    return payload.sprint;
  }
  if (isRecord(payload.body)) {
    return extractSprintDetail(payload.body);
  }
  return payload;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type SprintListOptions = {
  org?: string;
  project?: string;
  status?: string;
  page?: number;
  perPage?: number;
  format: string;
  out?: string;
  json?: boolean;
};

type SprintViewOptions = {
  org?: string;
  project?: string;
  format: string;
  out?: string;
  json?: boolean;
};

type SprintCreateOptions = {
  name: string;
  org?: string;
  project?: string;
  owner?: string;
  startDate?: string;
  endDate?: string;
  description?: string;
  capacityHours?: number;
  format: string;
  out?: string;
  json?: boolean;
};

type SprintUpdateOptions = {
  name: string;
  org?: string;
  project?: string;
  owner?: string;
  startDate?: string;
  endDate?: string;
  description?: string;
  capacityHours?: number;
  format: string;
  out?: string;
  json?: boolean;
};
