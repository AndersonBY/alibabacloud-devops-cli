import { Command } from "commander";
import { parsePositiveIntegerOption } from "../core/utils/options.js";
import { loadConfig } from "../core/config/store.js";
import { withApiClient, YunxiaoApiClient } from "../core/api/client.js";
import { listChangeRequests } from "../core/api/pr.js";
import { listRepositories } from "../core/api/repo.js";
import { searchWorkItems } from "../core/api/workitem.js";
import {
  assertRichOutputFileOption,
  normalizeRichOutputFormat,
  printRichData,
  renderRichOutput,
  writeRichOutputFile,
} from "../core/output/rich.js";
import { resolveOrganizationId, resolveProjectId } from "../core/utils/context.js";
import { classifyOpenClosed, extractRecordList } from "../core/utils/records.js";

export function registerSearchCommand(program: Command): void {
  const search = program.command("search").description("Search across issues, PRs, and repositories (gh-like)");

  search
    .command("issues")
    .description("Search issues (Bug workitems)")
    .argument("[query]", "Search query")
    .option("--org <organizationId>", "Organization ID")
    .option("--project <projectId>", "Project ID (spaceId)")
    .option("-q, --query <text>", "Search query (same as positional argument)")
    .option("-s, --state <state>", "open | closed | all | <raw status>", "all")
    .option("-a, --assignee <userId>", "Assignee user ID, supports self")
    .option("-A, --author <userId>", "Author user ID, supports self")
    .option("-l, --label <name>", "Label filter, repeatable", collect, [])
    .option("-L, --limit <number>", "Maximum results", parsePositiveIntegerOption, 30)
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write issue search output to file")
    .option("--json", "Print raw JSON")
    .action(async (queryArg: string | undefined, options: SearchIssuesOptions) => {
      const config = loadConfig();
      const outputFormat = normalizeRichOutputFormat(options.format, options.json);
      assertRichOutputFileOption(options.out, outputFormat);
      const organizationId = resolveOrganizationId(config, options.org);
      const projectId = resolveProjectId(config, options.project);
      const query = options.query ?? queryArg;
      const { mode, rawStatus } = parseIssueState(options.state);

      const fetchLimit =
        mode === "all" || rawStatus !== undefined
          ? options.limit
          : Math.min(Math.max(options.limit * 4, options.limit + 20), 400);

      const result = await withApiClient(config, (client) =>
        fetchIssuesWithLimit(client, {
          organizationId,
          projectId,
          limit: fetchLimit,
          subject: query,
          creator: options.author,
          assignee: options.assignee,
          tag: options.label.length ? options.label.join(",") : undefined,
          status: rawStatus,
        })
      );

      const filtered = filterIssuesByState(result, mode).slice(0, Math.max(1, options.limit));
      if (options.out) {
        writeRichOutputFile(options.out, renderRichOutput(filtered, outputFormat));
        process.stdout.write(`Saved issue search output to ${options.out}.\n`);
        return;
      }
      printRichData(filtered, outputFormat);
    });

  search
    .command("prs")
    .description("Search pull requests")
    .argument("[query]", "Search query")
    .option("--org <organizationId>", "Organization ID")
    .option("--repo <projectIds>", "Repository IDs/paths, comma-separated")
    .option("-q, --query <text>", "Search query (same as positional argument)")
    .option("-s, --state <state>", "open | merged | closed | all", "all")
    .option("-A, --author <userId>", "Author user ID")
    .option("-R, --reviewer <userId>", "Reviewer user ID")
    .option("-L, --limit <number>", "Maximum results", parsePositiveIntegerOption, 30)
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write PR search output to file")
    .option("--json", "Print raw JSON")
    .action(async (queryArg: string | undefined, options: SearchPrsOptions) => {
      const config = loadConfig();
      const outputFormat = normalizeRichOutputFormat(options.format, options.json);
      assertRichOutputFileOption(options.out, outputFormat);
      const organizationId = resolveOrganizationId(config, options.org);
      const query = options.query ?? queryArg;

      const state = normalizePrState(options.state);
      const result = await withApiClient(config, (client) =>
        fetchPrsWithLimit(client, {
          organizationId,
          projectIds: options.repo,
          authorIds: options.author,
          reviewerIds: options.reviewer,
          state,
          search: query,
          limit: Math.max(1, options.limit),
        })
      );

      if (options.out) {
        writeRichOutputFile(options.out, renderRichOutput(result, outputFormat));
        process.stdout.write(`Saved PR search output to ${options.out}.\n`);
        return;
      }
      printRichData(result, outputFormat);
    });

  search
    .command("repos")
    .description("Search repositories")
    .argument("[query]", "Search query")
    .option("--org <organizationId>", "Organization ID")
    .option("-q, --query <text>", "Search query (same as positional argument)")
    .option("--archived", "Include archived repositories", false)
    .option("-L, --limit <number>", "Maximum results", parsePositiveIntegerOption, 30)
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write repository search output to file")
    .option("--json", "Print raw JSON")
    .action(async (queryArg: string | undefined, options: SearchReposOptions) => {
      const config = loadConfig();
      const outputFormat = normalizeRichOutputFormat(options.format, options.json);
      assertRichOutputFileOption(options.out, outputFormat);
      const organizationId = resolveOrganizationId(config, options.org);
      const query = options.query ?? queryArg;

      const result = await withApiClient(config, (client) =>
        fetchReposWithLimit(client, {
          organizationId,
          search: query,
          archived: options.archived,
          limit: Math.max(1, options.limit),
        })
      );

      if (options.out) {
        writeRichOutputFile(options.out, renderRichOutput(result, outputFormat));
        process.stdout.write(`Saved repository search output to ${options.out}.\n`);
        return;
      }
      printRichData(result, outputFormat);
    });
}

async function fetchIssuesWithLimit(client: YunxiaoApiClient, input: {
  organizationId: string;
  projectId: string;
  limit: number;
  subject?: string;
  creator?: string;
  assignee?: string;
  tag?: string;
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
      creator: input.creator,
      assignedTo: input.assignee,
      tag: input.tag,
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

function filterIssuesByState(items: Record<string, unknown>[], mode: "open" | "closed" | "all"): Record<string, unknown>[] {
  if (mode === "all") {
    return items;
  }
  return items.filter((item) => classifyOpenClosed(item) === mode);
}

function parseIssueState(value: string | undefined): {
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

function normalizePrState(value: string | undefined): string | undefined {
  const normalized = (value ?? "all").trim().toLowerCase();
  if (normalized === "all") {
    return undefined;
  }
  if (normalized === "open") {
    return "opened";
  }
  if (normalized === "opened" || normalized === "merged" || normalized === "closed") {
    return normalized;
  }
  return value;
}

async function fetchPrsWithLimit(client: YunxiaoApiClient, input: {
  organizationId: string;
  projectIds?: string;
  authorIds?: string;
  reviewerIds?: string;
  state?: string;
  search?: string;
  limit: number;
}): Promise<Record<string, unknown>[]> {
  const pageSize = Math.max(1, Math.min(100, input.limit));
  const result: Record<string, unknown>[] = [];
  let page = 1;

  while (result.length < input.limit) {
    const response = await listChangeRequests(client, {
      organizationId: input.organizationId,
      projectIds: input.projectIds,
      authorIds: input.authorIds,
      reviewerIds: input.reviewerIds,
      state: input.state,
      search: input.search,
      orderBy: "updated_at",
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

async function fetchReposWithLimit(client: YunxiaoApiClient, input: {
  organizationId: string;
  search?: string;
  archived?: boolean;
  limit: number;
}): Promise<Record<string, unknown>[]> {
  const pageSize = Math.max(1, Math.min(100, input.limit));
  const result: Record<string, unknown>[] = [];
  let page = 1;

  while (result.length < input.limit) {
    const response = await listRepositories(client, {
      organizationId: input.organizationId,
      page,
      perPage: pageSize,
      orderBy: "created_at",
      sort: "desc",
      search: input.search,
      archived: input.archived,
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

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

type SearchIssuesOptions = {
  org?: string;
  project?: string;
  query?: string;
  state?: string;
  assignee?: string;
  author?: string;
  label: string[];
  limit: number;
  format?: string;
  out?: string;
  json?: boolean;
};

type SearchPrsOptions = {
  org?: string;
  repo?: string;
  query?: string;
  state?: string;
  author?: string;
  reviewer?: string;
  limit: number;
  format?: string;
  out?: string;
  json?: boolean;
};

type SearchReposOptions = {
  org?: string;
  query?: string;
  archived?: boolean;
  limit: number;
  format?: string;
  out?: string;
  json?: boolean;
};
