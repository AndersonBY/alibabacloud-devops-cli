import { Command } from "commander";
import { parsePositiveIntegerOption } from "../core/utils/options.js";
import { loadConfig } from "../core/config/store.js";
import { withApiClient, YunxiaoApiClient } from "../core/api/client.js";
import { listChangeRequests } from "../core/api/pr.js";
import { listPipelineRuns } from "../core/api/pipeline.js";
import { searchWorkItems } from "../core/api/workitem.js";
import {
  assertRichOutputFileOption,
  normalizeRichOutputFormat,
  printRichData,
  renderRichOutput,
  writeRichOutputFile,
} from "../core/output/rich.js";
import { resolveOrganizationId, resolveProjectId } from "../core/utils/context.js";
import { resolveUserSelector } from "../core/utils/user.js";
import { classifyOpenClosed, extractRecordList } from "../core/utils/records.js";
import { CliError } from "../core/errors.js";

export function registerStatusCommand(program: Command): void {
  program
    .command("status")
    .description("Show your current status across issues/PRs/workflow runs (gh-like)")
    .option("--org <organizationId>", "Organization ID")
    .option("--project <projectId>", "Project ID (spaceId)")
    .option("--repo <projectIds>", "Repository IDs/paths, comma-separated")
    .option("--workflow <workflowId>", "Workflow ID for run summary")
    .option("-L, --limit <number>", "Maximum results per section", parsePositiveIntegerOption, 10)
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write status output to file")
    .option("--json", "Print raw JSON")
    .action(async (options: StatusOptions) => {
      const config = loadConfig();
      const outputFormat = normalizeRichOutputFormat(options.format, options.json);
      assertRichOutputFileOption(options.out, outputFormat);
      const organizationId = resolveOrganizationId(config, options.org);
      const projectId = resolveProjectId(config, options.project);
      const limit = Math.max(1, options.limit);

      const result = await withApiClient(config, async (client) => {
        const currentUserId = await resolveUserSelector(client, "self");
        if (!currentUserId) {
          throw new CliError("Cannot resolve current user ID.");
        }

        const [assignedIssues, createdIssues, authoredPrs, reviewPrs] = await Promise.all([
          fetchIssuesWithLimit(client, {
            organizationId,
            projectId,
            limit,
            assignee: "self",
          }),
          fetchIssuesWithLimit(client, {
            organizationId,
            projectId,
            limit,
            creator: "self",
          }),
          fetchPrsWithLimit(client, {
            organizationId,
            projectIds: options.repo,
            authorIds: currentUserId,
            state: "opened",
            limit,
          }),
          fetchPrsWithLimit(client, {
            organizationId,
            projectIds: options.repo,
            reviewerIds: currentUserId,
            state: "opened",
            limit,
          }),
        ]);

        const workflowRuns = options.workflow
          ? await fetchRunsWithLimit(client, {
              organizationId,
              workflowId: options.workflow,
              limit,
            })
          : [];

        return {
          currentUserId,
          issues: {
            assigned: summarizeByState(assignedIssues),
            created: summarizeByState(createdIssues),
          },
          prs: {
            authoredOpenCount: authoredPrs.length,
            authoredOpen: authoredPrs,
            reviewRequestedOpenCount: reviewPrs.length,
            reviewRequestedOpen: reviewPrs,
          },
          workflowRuns: options.workflow
            ? {
                workflowId: options.workflow,
                count: workflowRuns.length,
                runs: workflowRuns,
              }
            : {
                workflowId: null,
                count: 0,
                runs: [],
                note: "Pass --workflow <id> to include run status.",
              },
        };
      });

      if (options.out) {
        writeRichOutputFile(options.out, renderRichOutput(result, outputFormat));
        process.stdout.write(`Saved status output to ${options.out}.\n`);
        return;
      }
      printRichData(result, outputFormat);
    });
}

async function fetchIssuesWithLimit(client: YunxiaoApiClient, input: {
  organizationId: string;
  projectId: string;
  limit: number;
  creator?: string;
  assignee?: string;
}): Promise<Record<string, unknown>[]> {
  const pageSize = Math.max(1, Math.min(100, input.limit));
  const result: Record<string, unknown>[] = [];
  let page = 1;

  while (result.length < input.limit) {
    const response = await searchWorkItems(client, {
      organizationId: input.organizationId,
      category: "Bug",
      spaceId: input.projectId,
      creator: input.creator,
      assignedTo: input.assignee,
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

async function fetchPrsWithLimit(client: YunxiaoApiClient, input: {
  organizationId: string;
  projectIds?: string;
  authorIds?: string;
  reviewerIds?: string;
  state?: string;
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

async function fetchRunsWithLimit(client: YunxiaoApiClient, input: {
  organizationId: string;
  workflowId: string;
  limit: number;
}): Promise<Record<string, unknown>[]> {
  const pageSize = Math.max(1, Math.min(100, input.limit));
  const result: Record<string, unknown>[] = [];
  let page = 1;

  while (result.length < input.limit) {
    const response = await listPipelineRuns(client, {
      organizationId: input.organizationId,
      pipelineId: input.workflowId,
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

function summarizeByState(items: Record<string, unknown>[]): {
  openCount: number;
  closedCount: number;
  open: Record<string, unknown>[];
  closed: Record<string, unknown>[];
} {
  const open: Record<string, unknown>[] = [];
  const closed: Record<string, unknown>[] = [];
  for (const item of items) {
    if (classifyOpenClosed(item) === "closed") {
      closed.push(item);
      continue;
    }
    open.push(item);
  }
  return {
    openCount: open.length,
    closedCount: closed.length,
    open,
    closed,
  };
}

type StatusOptions = {
  org?: string;
  project?: string;
  repo?: string;
  workflow?: string;
  limit: number;
  format?: string;
  out?: string;
  json?: boolean;
};
