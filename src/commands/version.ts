import { Command } from "commander";
import { loadConfig } from "../core/config/store.js";
import fs from "node:fs";
import { resolveOrganizationId, resolveProjectId } from "../core/utils/context.js";
import { parsePositiveIntegerOption } from "../core/utils/options.js";
import { withApiClient, YunxiaoApiClient } from "../core/api/client.js";
import { createVersion, deleteVersion, listVersions, updateVersion } from "../core/api/version.js";
import { printData } from "../core/output/print.js";
import { resolveUserSelectors } from "../core/utils/user.js";
import { CliError } from "../core/errors.js";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const VERSION_STATUS_SET = new Set(["TODO", "DOING", "ARCHIVED"]);

export function registerVersionCommand(program: Command): void {
  const version = program.command("version").description("Manage projex versions");

  version
    .command("list")
    .description("List versions in one project")
    .option("--org <organizationId>", "Organization ID")
    .option("--project <projectId>", "Project ID (spaceIdentifier)")
    .option("--status <statusList>", "Filter by status list, comma-separated (TODO,DOING,ARCHIVED)")
    .option("--page <number>", "Page number", parsePositiveIntegerOption)
    .option("--per-page <number>", "Items per page", parsePositiveIntegerOption)
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write version list output to file")
    .option("--json", "Print raw JSON")
    .action(async (options: VersionListOptions) => {
      const config = loadConfig();
      const organizationId = resolveOrganizationId(config, options.org);
      const projectId = resolveProjectId(config, options.project);
      const statuses = parseVersionStatuses(options.status);
      const outputFormat = normalizeVersionOutputFormat(options.format, options.json);
      if (options.out && outputFormat === "table") {
        throw new CliError("`--out` requires --format tsv/json (or --json).");
      }

      const result = await withApiClient(config, (client) =>
        listVersions(client, {
          organizationId,
          projectId,
          status: statuses,
          page: options.page,
          perPage: options.perPage,
        })
      );
      const items = extractVersionList(result);

      if (options.out) {
        await writeVersionOutputFile(options.out, formatVersionListOutput(items, outputFormat));
        process.stdout.write(`Saved version list output to ${options.out}.\n`);
        return;
      }

      if (outputFormat === "tsv") {
        process.stdout.write(`${formatVersionListTsv(items)}\n`);
        return;
      }

      printData(items, {
        format: outputFormat === "json" ? "json" : "table",
      });
    });

  version
    .command("view")
    .description("View one version by ID")
    .argument("<versionId>", "Version ID")
    .option("--org <organizationId>", "Organization ID")
    .option("--project <projectId>", "Project ID (spaceIdentifier)")
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write version view output to file")
    .option("--json", "Print raw JSON")
    .action(async (versionId: string, options: VersionViewOptions) => {
      const config = loadConfig();
      const organizationId = resolveOrganizationId(config, options.org);
      const projectId = resolveProjectId(config, options.project);
      const outputFormat = normalizeVersionOutputFormat(options.format, options.json);
      if (options.out && outputFormat === "table") {
        throw new CliError("`--out` requires --format tsv/json (or --json).");
      }

      const result = await withApiClient(config, (client) =>
        findVersionById(client, {
          organizationId,
          projectId,
          versionId,
          perPage: 100,
        })
      );

      if (options.out) {
        await writeVersionOutputFile(options.out, formatVersionEntityOutput(result, outputFormat));
        process.stdout.write(`Saved version view output to ${options.out}.\n`);
        return;
      }
      if (outputFormat === "tsv") {
        process.stdout.write(`${formatVersionEntityTsv(result)}\n`);
        return;
      }

      printData(result, {
        format: outputFormat === "json" ? "json" : "table",
      });
    });

  version
    .command("create")
    .description("Create one version")
    .requiredOption("--name <name>", "Version name")
    .option("--org <organizationId>", "Organization ID")
    .option("--project <projectId>", "Project ID (spaceIdentifier)")
    .option("--owner <selectors>", "Owner user IDs, comma-separated; supports self", "self")
    .option("--start-date <date>", "Start date (YYYY-MM-DD)")
    .option("--publish-date <date>", "Publish date (YYYY-MM-DD)")
    .option("--operator <userId>", "Operator user ID (optional)")
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write version create output to file")
    .option("--json", "Print raw JSON")
    .action(async (options: VersionCreateOptions) => {
      validateIsoDate("start-date", options.startDate);
      validateIsoDate("publish-date", options.publishDate);

      const config = loadConfig();
      const organizationId = resolveOrganizationId(config, options.org);
      const projectId = resolveProjectId(config, options.project);
      const outputFormat = normalizeVersionOutputFormat(options.format, options.json);
      if (options.out && outputFormat === "table") {
        throw new CliError("`--out` requires --format tsv/json (or --json).");
      }

      const result = await withApiClient(config, async (client) => {
        const owners = await resolveUserSelectors(client, options.owner ?? "self");
        if (!owners || owners.length === 0) {
          throw new CliError("Cannot resolve version owners. Pass --owner <userId[,userId]>.");
        }

        return createVersion(client, {
          organizationId,
          projectId,
          name: options.name,
          owners,
          startDate: options.startDate,
          publishDate: options.publishDate,
          operatorId: options.operator,
        });
      });

      if (options.out) {
        await writeVersionOutputFile(options.out, formatVersionEntityOutput(result, outputFormat));
        process.stdout.write(`Saved version create output to ${options.out}.\n`);
        return;
      }
      if (outputFormat === "tsv") {
        process.stdout.write(`${formatVersionEntityTsv(result)}\n`);
        return;
      }

      printData(result, {
        format: outputFormat === "json" ? "json" : "table",
      });
    });

  version
    .command("update")
    .description("Update one version")
    .argument("<versionId>", "Version ID")
    .requiredOption("--name <name>", "Version name")
    .option("--org <organizationId>", "Organization ID")
    .option("--project <projectId>", "Project ID (spaceIdentifier)")
    .option("--owner <selectors>", "Owner user IDs, comma-separated; supports self")
    .option("--start-date <date>", "Start date (YYYY-MM-DD)")
    .option("--publish-date <date>", "Publish date (YYYY-MM-DD)")
    .option("--operator <userId>", "Operator user ID (optional)")
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write version update output to file")
    .option("--json", "Print raw JSON")
    .action(async (versionId: string, options: VersionUpdateOptions) => {
      validateIsoDate("start-date", options.startDate);
      validateIsoDate("publish-date", options.publishDate);

      const config = loadConfig();
      const organizationId = resolveOrganizationId(config, options.org);
      const projectId = resolveProjectId(config, options.project);
      const outputFormat = normalizeVersionOutputFormat(options.format, options.json);
      if (options.out && outputFormat === "table") {
        throw new CliError("`--out` requires --format tsv/json (or --json).");
      }

      const result = await withApiClient(config, async (client) => {
        const owners = options.owner ? await resolveUserSelectors(client, options.owner) : undefined;
        if (options.owner && (!owners || owners.length === 0)) {
          throw new CliError("Cannot resolve version owners. Pass --owner <userId[,userId]>.");
        }

        const response = await updateVersion(client, {
          organizationId,
          projectId,
          versionId,
          name: options.name,
          owners,
          startDate: options.startDate,
          publishDate: options.publishDate,
          operatorId: options.operator,
        });

        if (outputFormat === "json") {
          return {
            versionId,
            result: response ?? null,
          };
        }

        return {
          versionId,
          updated: true,
          name: options.name,
          owners,
          startDate: options.startDate,
          publishDate: options.publishDate,
        };
      });

      if (options.out) {
        await writeVersionOutputFile(options.out, formatVersionEntityOutput(result, outputFormat));
        process.stdout.write(`Saved version update output to ${options.out}.\n`);
        return;
      }
      if (outputFormat === "tsv") {
        process.stdout.write(`${formatVersionEntityTsv(result)}\n`);
        return;
      }

      printData(result, {
        format: outputFormat === "json" ? "json" : "table",
      });
    });

  version
    .command("delete")
    .description("Delete one version")
    .argument("<versionId>", "Version ID")
    .option("--org <organizationId>", "Organization ID")
    .option("--project <projectId>", "Project ID (spaceIdentifier)")
    .option("--operator <userId>", "Operator user ID (optional)")
    .option("--yes", "Skip confirmation", false)
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write version delete output to file")
    .option("--json", "Print raw JSON")
    .action(async (versionId: string, options: VersionDeleteOptions) => {
      if (!options.yes) {
        throw new CliError("Refusing to delete version without confirmation. Re-run with `--yes`.");
      }

      const config = loadConfig();
      const organizationId = resolveOrganizationId(config, options.org);
      const projectId = resolveProjectId(config, options.project);
      const outputFormat = normalizeVersionOutputFormat(options.format, options.json);
      if (options.out && outputFormat === "table") {
        throw new CliError("`--out` requires --format tsv/json (or --json).");
      }

      const result = await withApiClient(config, async (client) => {
        const response = await deleteVersion(client, {
          organizationId,
          projectId,
          versionId,
          operatorId: options.operator,
        });

        if (outputFormat === "json") {
          return {
            versionId,
            result: response ?? null,
          };
        }

        return {
          versionId,
          deleted: true,
        };
      });

      if (options.out) {
        await writeVersionOutputFile(options.out, formatVersionEntityOutput(result, outputFormat));
        process.stdout.write(`Saved version delete output to ${options.out}.\n`);
        return;
      }
      if (outputFormat === "tsv") {
        process.stdout.write(`${formatVersionEntityTsv(result)}\n`);
        return;
      }

      printData(result, {
        format: outputFormat === "json" ? "json" : "table",
      });
    });
}

function normalizeVersionOutputFormat(format: string, jsonFlag?: boolean): "table" | "tsv" | "json" {
  if (jsonFlag) {
    return "json";
  }
  if (format === "table" || format === "tsv" || format === "json") {
    return format;
  }
  throw new CliError(`Invalid --format value: ${format}. Use table, tsv, or json.`);
}

function formatVersionListOutput(result: Record<string, unknown>[], format: "table" | "tsv" | "json"): string {
  if (format === "json") {
    return `${JSON.stringify(result, null, 2)}\n`;
  }
  if (format === "tsv") {
    return `${formatVersionListTsv(result)}\n`;
  }
  return `${JSON.stringify(result, null, 2)}\n`;
}

function formatVersionEntityOutput(result: unknown, format: "table" | "tsv" | "json"): string {
  if (format === "json") {
    return `${JSON.stringify(result, null, 2)}\n`;
  }
  if (format === "tsv") {
    return `${formatVersionEntityTsv(result)}\n`;
  }
  return `${JSON.stringify(result, null, 2)}\n`;
}

function formatVersionListTsv(result: Record<string, unknown>[]): string {
  const columns = ["id", "name", "status", "owners", "startDate", "publishDate", "createdAt", "updatedAt"];
  const header = columns.join("\t");
  if (result.length === 0) {
    return header;
  }
  const rows = result.map((item) =>
    columns
      .map((column) =>
        column === "owners"
          ? formatTsvCell(formatVersionOwners(item.ownerIds ?? item.owners))
          : formatTsvCell(item[column])
      )
      .join("\t")
  );
  return [header, ...rows].join("\n");
}

function formatVersionEntityTsv(result: unknown): string {
  if (!isRecord(result)) {
    return `key\tvalue\nvalue\t${formatTsvCell(result)}`;
  }
  const lines = ["key\tvalue"];
  for (const [key, value] of Object.entries(result)) {
    if (key === "owners" || key === "ownerIds") {
      lines.push(`${key}\t${formatTsvCell(formatVersionOwners(value))}`);
      continue;
    }
    lines.push(`${key}\t${formatTsvCell(value)}`);
  }
  return lines.join("\n");
}

function formatVersionOwners(value: unknown): string {
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

async function writeVersionOutputFile(path: string, content: string): Promise<void> {
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

function parseVersionStatuses(value?: string): string[] | undefined {
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
    if (!VERSION_STATUS_SET.has(item)) {
      throw new CliError(`Invalid version status: ${item}. Use TODO,DOING,ARCHIVED.`);
    }
  }
  return [...new Set(statuses)];
}

function validateIsoDate(fieldName: string, value?: string): void {
  if (value === undefined) {
    return;
  }
  if (!ISO_DATE_RE.test(value)) {
    throw new CliError(`Invalid --${fieldName} value: ${value}. Expected YYYY-MM-DD.`);
  }
}

function extractVersionList(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) {
    return payload.filter(isRecord);
  }
  if (!isRecord(payload)) {
    return [];
  }

  const candidates = [payload.versions, payload.items, payload.result, payload.data];
  for (const value of candidates) {
    if (Array.isArray(value)) {
      return value.filter(isRecord);
    }
  }

  if (isRecord(payload.body)) {
    return extractVersionList(payload.body);
  }

  return [];
}

async function findVersionById(client: YunxiaoApiClient, input: {
  organizationId: string;
  projectId: string;
  versionId: string;
  perPage: number;
}): Promise<Record<string, unknown>> {
  const pageSize = Math.max(1, Math.min(100, input.perPage));
  let page = 1;
  while (page <= 200) {
    const response = await listVersions(client, {
      organizationId: input.organizationId,
      projectId: input.projectId,
      page,
      perPage: pageSize,
    });
    const items = extractVersionList(response);
    const found = items.find((item) => {
      const id = item.id;
      return typeof id === "string" && id === input.versionId;
    });
    if (found) {
      return found;
    }
    if (items.length < pageSize) {
      break;
    }
    page += 1;
  }
  throw new CliError(`Version ${input.versionId} not found in project ${input.projectId}.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type VersionListOptions = {
  org?: string;
  project?: string;
  status?: string;
  page?: number;
  perPage?: number;
  format: string;
  out?: string;
  json?: boolean;
};

type VersionViewOptions = {
  org?: string;
  project?: string;
  format: string;
  out?: string;
  json?: boolean;
};

type VersionCreateOptions = {
  org?: string;
  project?: string;
  name: string;
  owner?: string;
  startDate?: string;
  publishDate?: string;
  operator?: string;
  format: string;
  out?: string;
  json?: boolean;
};

type VersionUpdateOptions = {
  org?: string;
  project?: string;
  name: string;
  owner?: string;
  startDate?: string;
  publishDate?: string;
  operator?: string;
  format: string;
  out?: string;
  json?: boolean;
};

type VersionDeleteOptions = {
  org?: string;
  project?: string;
  operator?: string;
  yes?: boolean;
  format: string;
  out?: string;
  json?: boolean;
};
