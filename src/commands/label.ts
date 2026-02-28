import fs from "node:fs";
import { Command } from "commander";
import { parsePositiveIntegerOption } from "../core/utils/options.js";
import { loadConfig } from "../core/config/store.js";
import { withApiClient, YunxiaoApiClient } from "../core/api/client.js";
import { getWorkItem, searchWorkItems, updateWorkItem } from "../core/api/workitem.js";
import {
  createRepositoryLabel,
  deleteRepositoryLabel,
  listRepositoryLabels,
  updateRepositoryLabel,
} from "../core/api/repo.js";
import { printData } from "../core/output/print.js";
import {
  resolveOrganizationId,
  resolveProjectId,
  resolveRepositoryId,
} from "../core/utils/context.js";
import { classifyOpenClosed, extractLabelNames, extractRecordList, isRecord } from "../core/utils/records.js";
import { CliError } from "../core/errors.js";

export function registerLabelCommand(program: Command): void {
  const label = program.command("label").description("Label commands (gh-like + issue labels)");

  label
    .command("list")
    .description("List labels (repository labels by default; issue label stats in issue mode)")
    .option("--org <organizationId>", "Organization ID")
    .option("--repo <repositoryId>", "Repository ID/path (use repository label mode)")
    .option("--project <projectId>", "Project ID (spaceId)")
    .option("--mode <mode>", "repo | issue | auto", "auto")
    .option("--page <number>", "Page number for repository labels", parsePositiveIntegerOption)
    .option("--per-page <number>", "Page size for repository labels", parsePositiveIntegerOption)
    .option("--order-by <field>", "Sort field for repository labels")
    .option("--sort <direction>", "Sort direction for repository labels")
    .option("--with-counts", "Include usage counts (if gateway supports)", false)
    .option("-s, --state <state>", "open | closed | all | <raw status>", "all")
    .option("-S, --search <query>", "Search query in issue title")
    .option("-L, --limit <number>", "Maximum issues to scan", parsePositiveIntegerOption, 200)
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write label list output to file")
    .option("--json", "Print raw JSON")
    .action(async (options: LabelListOptions) => {
      const config = loadConfig();
      const organizationId = resolveOrganizationId(config, options.org);
      const outputFormat = normalizeLabelOutputFormat(options.format, options.json);
      if (options.out && outputFormat === "table") {
        throw new CliError("`--out` requires --format tsv/json (or --json).");
      }
      const mode = resolveLabelListMode(config, options);
      if (mode === "repo") {
        const repositoryId = resolveRepositoryId(config, options.repo);
        const response = await withApiClient(config, (client) =>
          listRepositoryLabels(client, {
            organizationId,
            repositoryId,
            page: options.page,
            perPage: options.perPage,
            orderBy: options.orderBy,
            sort: options.sort,
            search: options.search,
            withCounts: options.withCounts,
          })
        );

        const labels = extractRepositoryLabels(response);
        const payload: Record<string, unknown> = {
          mode: "repo",
          repositoryId,
          labels,
          total: labels.length,
        };
        if (outputFormat === "json") {
          payload.raw = response;
        }
        if (options.out) {
          await writeLabelOutputFile(options.out, formatLabelListOutput(payload, labels, outputFormat));
          process.stdout.write(`Saved label list output to ${options.out}.\n`);
          return;
        }
        if (outputFormat === "tsv") {
          process.stdout.write(`${formatLabelListTsv(labels)}\n`);
          return;
        }
        printData(payload, { format: outputFormat === "json" ? "json" : "table" });
        return;
      }

      const projectId = resolveProjectId(config, options.project);
      const { mode: stateMode, rawStatus } = parseStateOption(options.state);

      const fetchLimit =
        stateMode === "all" || rawStatus !== undefined
          ? options.limit
          : Math.min(Math.max(options.limit * 3, options.limit + 20), 500);

      const issues = await withApiClient(config, (client) =>
        fetchIssuesWithLimit(client, {
          organizationId,
          projectId,
          limit: fetchLimit,
          subject: options.search,
          status: rawStatus,
        })
      );

      const filtered = filterByState(issues, stateMode).slice(0, Math.max(1, options.limit));
      const map = new Map<string, number>();
      for (const item of filtered) {
        for (const name of extractLabelNames(item)) {
          map.set(name, (map.get(name) ?? 0) + 1);
        }
      }

      const labels = Array.from(map.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => {
          if (b.count !== a.count) {
            return b.count - a.count;
          }
          return a.name.localeCompare(b.name);
        });

      const payload = {
        mode: "issue",
        scannedIssues: filtered.length,
        labels,
      };
      if (options.out) {
        await writeLabelOutputFile(options.out, formatLabelListOutput(payload, labels, outputFormat));
        process.stdout.write(`Saved label list output to ${options.out}.\n`);
        return;
      }
      if (outputFormat === "tsv") {
        process.stdout.write(`${formatLabelListTsv(labels)}\n`);
        return;
      }
      printData(payload, { format: outputFormat === "json" ? "json" : "table" });
    });

  label
    .command("create")
    .description("Create a repository label (gh-like)")
    .argument("<name>", "Label name")
    .option("--org <organizationId>", "Organization ID")
    .option("--repo <repositoryId>", "Repository ID/path")
    .option("--color <hex>", "Hex color (with/without #)", "bfd4f2")
    .option("--description <text>", "Label description")
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write label create output to file")
    .option("--json", "Print raw JSON")
    .action(async (name: string, options: LabelCreateOptions) => {
      const config = loadConfig();
      const outputFormat = normalizeLabelOutputFormat(options.format, options.json);
      if (options.out && outputFormat === "table") {
        throw new CliError("`--out` requires --format tsv/json (or --json).");
      }
      const organizationId = resolveOrganizationId(config, options.org);
      const repositoryId = resolveRepositoryId(config, options.repo);
      const color = normalizeLabelColor(options.color);

      const result = await withRepoLabelWriteHint(() =>
        withApiClient(config, (client) =>
          createRepositoryLabel(client, {
            organizationId,
            repositoryId,
            name: name.trim(),
            color,
            description: options.description,
          })
        )
      );

      const payload = {
        repositoryId,
        name: name.trim(),
        color,
        description: options.description,
        result,
      };
      if (options.out) {
        await writeLabelOutputFile(options.out, formatLabelEntityOutput(payload, outputFormat));
        process.stdout.write(`Saved label create output to ${options.out}.\n`);
        return;
      }
      if (outputFormat === "tsv") {
        process.stdout.write(`${formatLabelEntityTsv(payload)}\n`);
        return;
      }
      printData(payload, { format: outputFormat === "json" ? "json" : "table" });
    });

  label
    .command("edit")
    .description("Edit a repository label by name (gh-like)")
    .argument("<name>", "Current label name")
    .option("--org <organizationId>", "Organization ID")
    .option("--repo <repositoryId>", "Repository ID/path")
    .option("--new-name <newName>", "New label name")
    .option("--name <newName>", "Alias of --new-name")
    .option("--color <hex>", "Hex color (with/without #)")
    .option("--description <text>", "New description")
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write label edit output to file")
    .option("--json", "Print raw JSON")
    .action(async (name: string, options: LabelEditOptions) => {
      const nextName = options.newName?.trim() ?? options.name?.trim();
      if (!nextName && !options.color && options.description === undefined) {
        throw new CliError("No update fields provided. Use --name, --color or --description.");
      }

      const config = loadConfig();
      const outputFormat = normalizeLabelOutputFormat(options.format, options.json);
      if (options.out && outputFormat === "table") {
        throw new CliError("`--out` requires --format tsv/json (or --json).");
      }
      const organizationId = resolveOrganizationId(config, options.org);
      const repositoryId = resolveRepositoryId(config, options.repo);
      const target = await withApiClient(config, (client) =>
        findRepositoryLabelByName(client, organizationId, repositoryId, name)
      );
      if (!target) {
        throw new CliError(`Label not found: ${name}`);
      }

      const result = await withRepoLabelWriteHint(() =>
        withApiClient(config, (client) =>
          updateRepositoryLabel(client, {
            organizationId,
            repositoryId,
            labelId: target.id,
            name: nextName,
            color: options.color ? normalizeLabelColor(options.color) : undefined,
            description: options.description,
          })
        )
      );
      const latest = await withApiClient(config, (client) =>
        findRepositoryLabelById(client, organizationId, repositoryId, target.id)
      );
      const expectedColor = options.color ? normalizeLabelColor(options.color) : undefined;
      const applied = isRepositoryLabelUpdateApplied(
        latest,
        {
          name: nextName,
          color: expectedColor,
          description: options.description,
        }
      );

      const payload = {
        repositoryId,
        from: target.name,
        to: nextName ?? target.name,
        labelId: target.id,
        applied,
        current: latest,
        result,
      };
      if (options.out) {
        await writeLabelOutputFile(options.out, formatLabelEntityOutput(payload, outputFormat));
        process.stdout.write(`Saved label edit output to ${options.out}.\n`);
        return;
      }
      if (outputFormat === "tsv") {
        process.stdout.write(`${formatLabelEntityTsv(payload)}\n`);
        return;
      }
      printData(payload, { format: outputFormat === "json" ? "json" : "table" });
    });

  label
    .command("delete")
    .description("Delete a repository label by name (gh-like)")
    .argument("<name>", "Label name")
    .option("--org <organizationId>", "Organization ID")
    .option("--repo <repositoryId>", "Repository ID/path")
    .option("--yes", "Skip confirmation", false)
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write label delete output to file")
    .option("--json", "Print raw JSON")
    .action(async (name: string, options: LabelDeleteOptions) => {
      if (!options.yes) {
        throw new CliError("Refusing to delete label without confirmation. Re-run with `--yes`.");
      }

      const config = loadConfig();
      const outputFormat = normalizeLabelOutputFormat(options.format, options.json);
      if (options.out && outputFormat === "table") {
        throw new CliError("`--out` requires --format tsv/json (or --json).");
      }
      const organizationId = resolveOrganizationId(config, options.org);
      const repositoryId = resolveRepositoryId(config, options.repo);
      const target = await withApiClient(config, (client) =>
        findRepositoryLabelByName(client, organizationId, repositoryId, name)
      );
      if (!target) {
        throw new CliError(`Label not found: ${name}`);
      }

      const result = await withRepoLabelWriteHint(() =>
        withApiClient(config, (client) =>
          deleteRepositoryLabel(client, {
            organizationId,
            repositoryId,
            labelId: target.id,
          })
        )
      );

      const payload = {
        repositoryId,
        name: target.name,
        labelId: target.id,
        result,
      };
      if (options.out) {
        await writeLabelOutputFile(options.out, formatLabelEntityOutput(payload, outputFormat));
        process.stdout.write(`Saved label delete output to ${options.out}.\n`);
        return;
      }
      if (outputFormat === "tsv") {
        process.stdout.write(`${formatLabelEntityTsv(payload)}\n`);
        return;
      }
      printData(payload, { format: outputFormat === "json" ? "json" : "table" });
    });

  label
    .command("add")
    .description("Add labels to one issue")
    .argument("<issueId>", "Issue ID (workitem ID)")
    .argument("<labels...>", "Label names")
    .option("--org <organizationId>", "Organization ID")
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write label add output to file")
    .option("--json", "Print raw JSON")
    .action(async (issueId: string, labels: string[], options: LabelMutationOptions) => {
      const config = loadConfig();
      const outputFormat = normalizeLabelOutputFormat(options.format, options.json);
      if (options.out && outputFormat === "table") {
        throw new CliError("`--out` requires --format tsv/json (or --json).");
      }
      const organizationId = resolveOrganizationId(config, options.org);
      const normalized = normalizeLabels(labels);
      if (normalized.length === 0) {
        throw new CliError("No labels provided.");
      }

      const result = await withApiClient(config, async (client) => {
        const detail = await getWorkItem(client, {
          organizationId,
          workItemId: issueId,
        });
        if (!isRecord(detail)) {
          throw new CliError("Unexpected issue detail response.");
        }

        const current = extractLabelNames(detail);
        const next = Array.from(new Set([...current, ...normalized]));
        await updateWorkItem(client, {
          organizationId,
          workItemId: issueId,
          labels: next,
        });
        return {
          issueId,
          labels: next,
        };
      });

      if (options.out) {
        await writeLabelOutputFile(options.out, formatLabelEntityOutput(result, outputFormat));
        process.stdout.write(`Saved label add output to ${options.out}.\n`);
        return;
      }
      if (outputFormat === "tsv") {
        process.stdout.write(`${formatLabelEntityTsv(result)}\n`);
        return;
      }
      printData(result, { format: outputFormat === "json" ? "json" : "table" });
    });

  label
    .command("remove")
    .description("Remove labels from one issue")
    .argument("<issueId>", "Issue ID (workitem ID)")
    .argument("<labels...>", "Label names")
    .option("--org <organizationId>", "Organization ID")
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write label remove output to file")
    .option("--json", "Print raw JSON")
    .action(async (issueId: string, labels: string[], options: LabelMutationOptions) => {
      const config = loadConfig();
      const outputFormat = normalizeLabelOutputFormat(options.format, options.json);
      if (options.out && outputFormat === "table") {
        throw new CliError("`--out` requires --format tsv/json (or --json).");
      }
      const organizationId = resolveOrganizationId(config, options.org);
      const normalized = normalizeLabels(labels);
      if (normalized.length === 0) {
        throw new CliError("No labels provided.");
      }
      const removeSet = new Set(normalized);

      const result = await withApiClient(config, async (client) => {
        const detail = await getWorkItem(client, {
          organizationId,
          workItemId: issueId,
        });
        if (!isRecord(detail)) {
          throw new CliError("Unexpected issue detail response.");
        }

        const current = extractLabelNames(detail);
        const next = current.filter((labelName) => !removeSet.has(labelName));
        await updateWorkItem(client, {
          organizationId,
          workItemId: issueId,
          labels: next,
        });
        return {
          issueId,
          labels: next,
        };
      });

      if (options.out) {
        await writeLabelOutputFile(options.out, formatLabelEntityOutput(result, outputFormat));
        process.stdout.write(`Saved label remove output to ${options.out}.\n`);
        return;
      }
      if (outputFormat === "tsv") {
        process.stdout.write(`${formatLabelEntityTsv(result)}\n`);
        return;
      }
      printData(result, { format: outputFormat === "json" ? "json" : "table" });
    });
}

function normalizeLabelOutputFormat(format: string, jsonFlag?: boolean): "table" | "tsv" | "json" {
  if (jsonFlag) {
    return "json";
  }
  if (format === "table" || format === "tsv" || format === "json") {
    return format;
  }
  throw new CliError(`Invalid --format value: ${format}. Use table, tsv, or json.`);
}

function formatLabelListOutput(
  payload: unknown,
  items: Record<string, unknown>[],
  format: "table" | "tsv" | "json"
): string {
  if (format === "json") {
    return `${JSON.stringify(payload, null, 2)}\n`;
  }
  if (format === "tsv") {
    return `${formatLabelListTsv(items)}\n`;
  }
  return `${JSON.stringify(payload, null, 2)}\n`;
}

function formatLabelEntityOutput(result: unknown, format: "table" | "tsv" | "json"): string {
  if (format === "json") {
    return `${JSON.stringify(result, null, 2)}\n`;
  }
  if (format === "tsv") {
    return `${formatLabelEntityTsv(result)}\n`;
  }
  return `${JSON.stringify(result, null, 2)}\n`;
}

function formatLabelListTsv(items: Record<string, unknown>[]): string {
  const columns = collectLabelColumns(items);
  if (items.length === 0) {
    return columns.join("\t");
  }
  const lines = [columns.join("\t")];
  for (const item of items) {
    lines.push(columns.map((column) => formatLabelTsvCell(item[column])).join("\t"));
  }
  return lines.join("\n");
}

function collectLabelColumns(items: Record<string, unknown>[]): string[] {
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

function formatLabelEntityTsv(result: unknown): string {
  if (!isRecord(result)) {
    return `key\tvalue\nvalue\t${formatLabelTsvCell(result)}`;
  }
  const lines = ["key\tvalue"];
  for (const [key, value] of Object.entries(result)) {
    lines.push(`${key}\t${formatLabelTsvCell(value)}`);
  }
  return lines.join("\n");
}

function formatLabelTsvCell(value: unknown): string {
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

async function writeLabelOutputFile(path: string, content: string): Promise<void> {
  fs.writeFileSync(path, content, "utf8");
}

async function fetchIssuesWithLimit(client: YunxiaoApiClient, input: {
  organizationId: string;
  projectId: string;
  limit: number;
  subject?: string;
  status?: string;
}): Promise<Record<string, unknown>[]> {
  const pageSize = Math.max(1, Math.min(100, input.limit));
  const result: Record<string, unknown>[] = [];
  let page = 1;

  while (result.length < input.limit) {
    const response = await searchWorkItems(client, {
      organizationId: input.organizationId,
      category: "Bug",
      spaceId: input.projectId,
      subject: input.subject,
      status: input.status,
      orderBy: "gmtCreate",
      sort: "desc",
      page,
      perPage: pageSize,
    });
    const current = extractRecordList(response);
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

function parseStateOption(value: string | undefined): {
  mode: "open" | "closed" | "all";
  rawStatus?: string;
} {
  const normalized = (value ?? "all").trim().toLowerCase();
  if (normalized === "open") {
    return { mode: "open" };
  }
  if (normalized === "closed") {
    return { mode: "closed" };
  }
  if (normalized === "all") {
    return { mode: "all" };
  }
  return { mode: "all", rawStatus: value };
}

function filterByState(items: Record<string, unknown>[], mode: "open" | "closed" | "all"): Record<string, unknown>[] {
  if (mode === "all") {
    return items;
  }
  return items.filter((item) => classifyOpenClosed(item) === mode);
}

function normalizeLabels(labels: string[]): string[] {
  const normalized = labels
    .map((value) => value.trim())
    .filter(Boolean);
  return Array.from(new Set(normalized));
}

function resolveLabelListMode(config: ReturnType<typeof loadConfig>, options: LabelListOptions): "repo" | "issue" {
  const mode = (options.mode ?? "auto").trim().toLowerCase();
  if (mode === "repo") {
    return "repo";
  }
  if (mode === "issue") {
    return "issue";
  }

  if (options.repo || config.defaults.repositoryId) {
    return "repo";
  }
  return "issue";
}

function normalizeLabelColor(input: string): string {
  const raw = input.trim();
  const value = raw.startsWith("#") ? raw.slice(1) : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(value)) {
    throw new CliError(`Invalid label color: ${input}. Expected 6-digit hex like #bfd4f2.`);
  }
  return `#${value.toLowerCase()}`;
}

type RepositoryLabel = {
  id: string;
  name: string;
  color?: string;
  description?: string;
};

function extractRepositoryLabels(response: unknown): RepositoryLabel[] {
  const records = extractRecordList(response);
  const result: RepositoryLabel[] = [];
  for (const item of records) {
    const id = extractFirstString(item, ["id", "labelId"]);
    const name = extractFirstString(item, ["name", "label"]);
    if (!id || !name) {
      continue;
    }
    result.push({
      id,
      name,
      color: extractFirstString(item, ["color"]),
      description: extractFirstString(item, ["description"]),
    });
  }
  return result;
}

function extractFirstString(item: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = item[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return undefined;
}

async function findRepositoryLabelByName(
  client: YunxiaoApiClient,
  organizationId: string,
  repositoryId: string,
  name: string
): Promise<RepositoryLabel | undefined> {
  const normalized = name.trim().toLowerCase();
  const response = await listRepositoryLabels(client, {
    organizationId,
    repositoryId,
    search: name.trim(),
    page: 1,
    perPage: 200,
  });
  const labels = extractRepositoryLabels(response);
  return labels.find((label) => label.name.toLowerCase() === normalized);
}

async function findRepositoryLabelById(
  client: YunxiaoApiClient,
  organizationId: string,
  repositoryId: string,
  labelId: string
): Promise<RepositoryLabel | undefined> {
  const response = await listRepositoryLabels(client, {
    organizationId,
    repositoryId,
    page: 1,
    perPage: 200,
  });
  const labels = extractRepositoryLabels(response);
  return labels.find((label) => label.id === labelId);
}

function isRepositoryLabelUpdateApplied(
  latest: RepositoryLabel | undefined,
  expected: { name?: string; color?: string; description?: string }
): boolean {
  if (!latest) {
    return false;
  }
  if (expected.name !== undefined && latest.name !== expected.name) {
    return false;
  }
  if (expected.color !== undefined && latest.color?.toLowerCase() !== expected.color.toLowerCase()) {
    return false;
  }
  if (expected.description !== undefined && latest.description !== expected.description) {
    return false;
  }
  return true;
}

async function withRepoLabelWriteHint<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof CliError && error.message.includes("HTML document unexpectedly")) {
      throw new CliError(
        `${error.message} Current gateway may not expose repository label write APIs. You can retry in Web UI, or keep using \`yx label list\` in this tenant.`
      );
    }
    throw error;
  }
}

type LabelListOptions = {
  org?: string;
  repo?: string;
  project?: string;
  mode?: string;
  page?: number;
  perPage?: number;
  orderBy?: string;
  sort?: string;
  withCounts?: boolean;
  state?: string;
  search?: string;
  limit: number;
  format: string;
  out?: string;
  json?: boolean;
};

type LabelCreateOptions = {
  org?: string;
  repo?: string;
  color: string;
  description?: string;
  format: string;
  out?: string;
  json?: boolean;
};

type LabelEditOptions = {
  org?: string;
  repo?: string;
  newName?: string;
  name?: string;
  color?: string;
  description?: string;
  format: string;
  out?: string;
  json?: boolean;
};

type LabelDeleteOptions = {
  org?: string;
  repo?: string;
  yes?: boolean;
  format: string;
  out?: string;
  json?: boolean;
};

type LabelMutationOptions = {
  org?: string;
  format: string;
  out?: string;
  json?: boolean;
};
