import fs from "node:fs";
import { Command } from "commander";
import { parsePositiveIntegerOption } from "../core/utils/options.js";
import { loadConfig } from "../core/config/store.js";
import { withApiClient } from "../core/api/client.js";
import { listRepositoryBranches } from "../core/api/repo.js";
import { createRelease, deleteRelease, getRelease, listReleases } from "../core/api/release.js";
import { CliError } from "../core/errors.js";
import { printData } from "../core/output/print.js";
import { resolveOrganizationId, resolveRepositoryId } from "../core/utils/context.js";

export function registerReleaseCommand(program: Command): void {
  const release = program.command("release").description("Manage releases (tag-based)");

  release
    .command("list")
    .description("List releases")
    .option("--org <organizationId>", "Organization ID")
    .option("--repo <repositoryId>", "Repository ID/path")
    .option("--page <number>", "Page number", parsePositiveIntegerOption)
    .option("--per-page <number>", "Items per page", parsePositiveIntegerOption)
    .option("--search <keyword>", "Search by tag")
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write release list output to file")
    .option("--json", "Print raw JSON")
    .action(async (options: ReleaseListOptions) => {
      const config = loadConfig();
      const organizationId = resolveOrganizationId(config, options.org);
      const repositoryId = resolveRepositoryId(config, options.repo);
      const outputFormat = normalizeReleaseOutputFormat(options.format, options.json);
      if (options.out && outputFormat === "table") {
        throw new CliError("`--out` requires --format tsv/json (or --json).");
      }

      const result = await withApiClient(config, (client) =>
        listReleases(client, {
          organizationId,
          repositoryId,
          page: options.page,
          perPage: options.perPage,
          search: options.search,
        })
      );
      const releases = extractReleaseRecords(result);

      if (options.out) {
        await writeReleaseOutputFile(options.out, formatReleaseListOutput(releases, outputFormat));
        process.stdout.write(`Saved release list output to ${options.out}.\n`);
        return;
      }
      if (outputFormat === "tsv") {
        process.stdout.write(`${formatReleaseListTsv(releases)}\n`);
        return;
      }
      printData(outputFormat === "json" ? releases : releases, {
        format: outputFormat === "json" ? "json" : "table",
      });
    });

  release
    .command("view")
    .description("View one release by tag")
    .argument("<tag>", "Tag name")
    .option("--org <organizationId>", "Organization ID")
    .option("--repo <repositoryId>", "Repository ID/path")
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write release view output to file")
    .option("--json", "Print raw JSON")
    .action(async (tag: string, options: ReleaseViewOptions) => {
      const config = loadConfig();
      const organizationId = resolveOrganizationId(config, options.org);
      const repositoryId = resolveRepositoryId(config, options.repo);
      const outputFormat = normalizeReleaseOutputFormat(options.format, options.json);
      if (options.out && outputFormat === "table") {
        throw new CliError("`--out` requires --format tsv/json (or --json).");
      }

      const result = await withApiClient(config, (client) =>
        getRelease(client, {
          organizationId,
          repositoryId,
          tag,
        })
      );

      if (options.out) {
        await writeReleaseOutputFile(options.out, formatReleaseEntityOutput(result, outputFormat));
        process.stdout.write(`Saved release view output to ${options.out}.\n`);
        return;
      }
      if (outputFormat === "tsv") {
        process.stdout.write(`${formatReleaseEntityTsv(result)}\n`);
        return;
      }
      printData(result, {
        format: outputFormat === "json" ? "json" : "table",
      });
    });

  release
    .command("create")
    .description("Create one release (create annotated tag)")
    .requiredOption("--tag <tag>", "Tag name")
    .option("--org <organizationId>", "Organization ID")
    .option("--repo <repositoryId>", "Repository ID/path")
    .option("--ref <ref>", "Target ref (branch/SHA). Auto-detect default branch when omitted")
    .option("--title <title>", "Release title")
    .option("--notes <text>", "Release notes")
    .option("--notes-file <path>", "Read release notes from file")
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write release create output to file")
    .option("--json", "Print raw JSON")
    .action(async (options: ReleaseCreateOptions) => {
      const config = loadConfig();
      const organizationId = resolveOrganizationId(config, options.org);
      const repositoryId = resolveRepositoryId(config, options.repo);
      const outputFormat = normalizeReleaseOutputFormat(options.format, options.json);
      if (options.out && outputFormat === "table") {
        throw new CliError("`--out` requires --format tsv/json (or --json).");
      }
      const notes = resolveNotes(options.notes, options.notesFile);
      const message = buildReleaseMessage(options.title, notes);
      const ref = options.ref ?? (await resolveDefaultRef(config, organizationId, repositoryId));

      const result = await withApiClient(config, (client) =>
        createRelease(client, {
          organizationId,
          repositoryId,
          tag: options.tag,
          ref,
          message,
        })
      );

      if (options.out) {
        await writeReleaseOutputFile(options.out, formatReleaseEntityOutput(result, outputFormat));
        process.stdout.write(`Saved release create output to ${options.out}.\n`);
        return;
      }
      if (outputFormat === "tsv") {
        process.stdout.write(`${formatReleaseEntityTsv(result)}\n`);
        return;
      }
      printData(result, {
        format: outputFormat === "json" ? "json" : "table",
      });
    });

  release
    .command("delete")
    .description("Delete one release by tag")
    .argument("<tag>", "Tag name")
    .option("--org <organizationId>", "Organization ID")
    .option("--repo <repositoryId>", "Repository ID/path")
    .option("--yes", "Skip confirmation", false)
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write release delete output to file")
    .option("--json", "Print raw JSON")
    .action(async (tag: string, options: ReleaseDeleteOptions) => {
      if (!options.yes) {
        throw new CliError("Refusing to delete release without confirmation. Re-run with `--yes`.");
      }

      const config = loadConfig();
      const organizationId = resolveOrganizationId(config, options.org);
      const repositoryId = resolveRepositoryId(config, options.repo);
      const outputFormat = normalizeReleaseOutputFormat(options.format, options.json);
      if (options.out && outputFormat === "table") {
        throw new CliError("`--out` requires --format tsv/json (or --json).");
      }

      const result = await withApiClient(config, (client) =>
        deleteRelease(client, {
          organizationId,
          repositoryId,
          tag,
        })
      );

      if (options.out) {
        await writeReleaseOutputFile(options.out, formatReleaseEntityOutput(result, outputFormat));
        process.stdout.write(`Saved release delete output to ${options.out}.\n`);
        return;
      }
      if (outputFormat === "tsv") {
        process.stdout.write(`${formatReleaseEntityTsv(result)}\n`);
        return;
      }
      printData(result, {
        format: outputFormat === "json" ? "json" : "table",
      });
    });
}

function normalizeReleaseOutputFormat(format: string, jsonFlag?: boolean): "table" | "tsv" | "json" {
  if (jsonFlag) {
    return "json";
  }
  if (format === "table" || format === "tsv" || format === "json") {
    return format;
  }
  throw new CliError(`Invalid --format value: ${format}. Use table, tsv, or json.`);
}

function formatReleaseListOutput(result: Record<string, unknown>[], format: "table" | "tsv" | "json"): string {
  if (format === "json") {
    return `${JSON.stringify(result, null, 2)}\n`;
  }
  if (format === "tsv") {
    return `${formatReleaseListTsv(result)}\n`;
  }
  return `${JSON.stringify(result, null, 2)}\n`;
}

function formatReleaseEntityOutput(result: unknown, format: "table" | "tsv" | "json"): string {
  if (format === "json") {
    return `${JSON.stringify(result, null, 2)}\n`;
  }
  if (format === "tsv") {
    return `${formatReleaseEntityTsv(result)}\n`;
  }
  return `${JSON.stringify(result, null, 2)}\n`;
}

function formatReleaseListTsv(result: Record<string, unknown>[]): string {
  if (result.length === 0) {
    return "tagName\tname\tref\tcreatedAt\treleasedAt";
  }
  const columns = ["tagName", "name", "ref", "createdAt", "releasedAt", "updatedAt", "webUrl"];
  const header = columns.join("\t");
  const rows = result.map((item) =>
    columns.map((column) => formatTsvCell(item[column])).join("\t")
  );
  return [header, ...rows].join("\n");
}

function formatReleaseEntityTsv(result: unknown): string {
  if (!isRecord(result)) {
    return `key\tvalue\nvalue\t${formatTsvCell(result)}`;
  }
  const lines = ["key\tvalue"];
  for (const [key, value] of Object.entries(result)) {
    lines.push(`${key}\t${formatTsvCell(value)}`);
  }
  return lines.join("\n");
}

async function writeReleaseOutputFile(path: string, content: string): Promise<void> {
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

function extractReleaseRecords(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) {
    return payload.filter(isRecord);
  }
  if (!isRecord(payload)) {
    return [];
  }
  if (Array.isArray(payload.items)) {
    return payload.items.filter(isRecord);
  }
  if (Array.isArray(payload.result)) {
    return payload.result.filter(isRecord);
  }
  if (Array.isArray(payload.data)) {
    return payload.data.filter(isRecord);
  }
  return [];
}

async function resolveDefaultRef(config: ReturnType<typeof loadConfig>, organizationId: string, repositoryId: string): Promise<string> {
  const response = await withApiClient(config, (client) =>
    listRepositoryBranches(client, {
      organizationId,
      repositoryId,
      perPage: 100,
    })
  );

  const branches = extractBranchRecords(response);
  const byDefault = branches.find((item) => item.defaultBranch === true);
  if (byDefault?.name) {
    return byDefault.name;
  }

  const preferredNames = ["main", "master", "trunk", "develop", "dev"];
  for (const name of preferredNames) {
    if (branches.some((item) => item.name === name)) {
      return name;
    }
  }

  const fallback = branches[0]?.name;
  if (fallback) {
    return fallback;
  }
  throw new CliError("Cannot resolve default ref. Pass --ref explicitly.");
}

function extractBranchRecords(response: unknown): Array<{ name?: string; defaultBranch?: boolean }> {
  if (!Array.isArray(response)) {
    return [];
  }
  return response
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null && !Array.isArray(item))
    .map((item) => ({
      name: typeof item.name === "string" ? item.name : undefined,
      defaultBranch: item.defaultBranch === true,
    }))
    .filter((item) => Boolean(item.name));
}

function resolveNotes(notes?: string, notesFile?: string): string | undefined {
  if (notes !== undefined && notesFile !== undefined) {
    throw new CliError("Use either --notes or --notes-file, not both.");
  }
  if (notesFile !== undefined) {
    const content = fs.readFileSync(notesFile, "utf8");
    return content.trim();
  }
  return notes?.trim();
}

function buildReleaseMessage(title?: string, notes?: string): string | undefined {
  const normalizedTitle = title?.trim();
  const normalizedNotes = notes?.trim();
  if (!normalizedTitle && !normalizedNotes) {
    return undefined;
  }
  if (normalizedTitle && normalizedNotes) {
    return `${normalizedTitle}\n\n${normalizedNotes}`;
  }
  return normalizedTitle ?? normalizedNotes;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type ReleaseListOptions = {
  org?: string;
  repo?: string;
  page?: number;
  perPage?: number;
  search?: string;
  format: string;
  out?: string;
  json?: boolean;
};

type ReleaseViewOptions = {
  org?: string;
  repo?: string;
  format: string;
  out?: string;
  json?: boolean;
};

type ReleaseCreateOptions = {
  tag: string;
  org?: string;
  repo?: string;
  ref?: string;
  title?: string;
  notes?: string;
  notesFile?: string;
  format: string;
  out?: string;
  json?: boolean;
};

type ReleaseDeleteOptions = {
  org?: string;
  repo?: string;
  yes?: boolean;
  format: string;
  out?: string;
  json?: boolean;
};
