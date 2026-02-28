import { Command } from "commander";
import { parsePositiveIntegerOption } from "../core/utils/options.js";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "../core/config/store.js";
import { withApiClient } from "../core/api/client.js";
import {
  createPipelineRun,
  getPipelineArtifactUrl,
  getPipelineJobRunLog,
  getPipelineRun,
  listPipelineRuns,
  retryPipelineJobRun,
  stopPipelineRun,
} from "../core/api/pipeline.js";
import {
  assertRichOutputFileOption,
  normalizeRichOutputFormat,
  printRichData,
  renderRichOutput,
  writeRichOutputFile,
} from "../core/output/rich.js";
import { resolveOrganizationId } from "../core/utils/context.js";
import { maybeJson } from "../core/utils/json.js";
import { CliError } from "../core/errors.js";

const TERMINAL_STATUS_KEYWORDS = [
  "success",
  "succeeded",
  "failed",
  "failure",
  "cancel",
  "canceled",
  "cancelled",
  "stopped",
  "done",
  "finish",
  "finished",
  "complete",
  "completed",
  "pass",
];

export function registerRunCommand(program: Command): void {
  const run = program.command("run").description("Workflow run commands (gh-compatible alias)");

  run
    .command("list")
    .description("List runs of one workflow")
    .requiredOption("-w, --workflow <workflowId>", "Workflow ID (pipeline ID)")
    .option("--org <organizationId>", "Organization ID")
    .option("-L, --limit <number>", "Maximum results", parsePositiveIntegerOption, 20)
    .option("--status <status>", "Run status")
    .option("--page <number>", "Page number", parsePositiveIntegerOption)
    .option("--per-page <number>", "Items per page", parsePositiveIntegerOption)
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write run list output to file")
    .option("--json", "Print raw JSON")
    .action(async (options: RunListOptions) => {
      const config = loadConfig();
      const outputFormat = normalizeRichOutputFormat(options.format, options.json);
      assertRichOutputFileOption(options.out, outputFormat);
      const organizationId = resolveOrganizationId(config, options.org);

      const maxResults = Math.max(1, options.limit);
      const pageSize = Math.max(1, Math.min(100, options.perPage ?? maxResults));
      const startPage = options.page ?? 1;
      const runs: Record<string, unknown>[] = [];
      let currentPage = startPage;

      await withApiClient(config, async (client) => {
        while (runs.length < maxResults) {
          const response = await listPipelineRuns(client, {
            organizationId,
            pipelineId: options.workflow,
            page: currentPage,
            perPage: pageSize,
            status: options.status,
          });
          const current = extractRuns(response);
          if (current.length === 0) {
            break;
          }

          runs.push(...current);

          if (options.page !== undefined || current.length < pageSize) {
            break;
          }

          currentPage += 1;
        }
      });

      const payload = runs.slice(0, maxResults);
      if (options.out) {
        writeRichOutputFile(options.out, renderRichOutput(payload, outputFormat));
        process.stdout.write(`Saved run list output to ${options.out}.\n`);
        return;
      }
      printRichData(payload, outputFormat);
    });

  run
    .command("view")
    .description("View one run")
    .argument("<workflowId>", "Workflow ID (pipeline ID)")
    .argument("<runId>", "Run ID")
    .option("--org <organizationId>", "Organization ID")
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write run view output to file")
    .option("--json", "Print raw JSON")
    .action(async (workflowId: string, runId: string, options: RunViewOptions) => {
      const config = loadConfig();
      const outputFormat = normalizeRichOutputFormat(options.format, options.json);
      assertRichOutputFileOption(options.out, outputFormat);
      const organizationId = resolveOrganizationId(config, options.org);

      const result = await withApiClient(config, async (client) => {
        try {
          return await getPipelineRun(client, {
            organizationId,
            pipelineId: workflowId,
            runId,
          });
        } catch {
          const list = await listPipelineRuns(client, {
            organizationId,
            pipelineId: workflowId,
            page: 1,
            perPage: 100,
          });
          const runs = extractRuns(list);
          return runs.find((item) => String(item.id ?? item.runId ?? "") === runId) ?? null;
        }
      });

      if (options.out) {
        writeRichOutputFile(options.out, renderRichOutput(result, outputFormat));
        process.stdout.write(`Saved run view output to ${options.out}.\n`);
        return;
      }
      printRichData(result, outputFormat);
    });

  run
    .command("cancel")
    .description("Cancel a run (gh-like)")
    .argument("<workflowId>", "Workflow ID (pipeline ID)")
    .argument("<runId>", "Run ID")
    .option("--org <organizationId>", "Organization ID")
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write run cancel output to file")
    .option("--json", "Print raw JSON")
    .action(async (workflowId: string, runId: string, options: RunCancelOptions) => {
      const config = loadConfig();
      const outputFormat = normalizeRichOutputFormat(options.format, options.json);
      assertRichOutputFileOption(options.out, outputFormat);
      const organizationId = resolveOrganizationId(config, options.org);

      const result = await withApiClient(config, (client) =>
        stopPipelineRun(client, {
          organizationId,
          pipelineId: workflowId,
          runId,
        })
      );

      if (options.out) {
        writeRichOutputFile(options.out, renderRichOutput(result, outputFormat));
        process.stdout.write(`Saved run cancel output to ${options.out}.\n`);
        return;
      }
      printRichData(result, outputFormat);
    });

  run
    .command("rerun")
    .description("Rerun a workflow run (gh-like)")
    .argument("<workflowId>", "Workflow ID (pipeline ID)")
    .argument("<runId>", "Run ID")
    .option("--org <organizationId>", "Organization ID")
    .option("--job <jobId>", "Retry one job only")
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write run rerun output to file")
    .option("--json", "Print raw JSON")
    .action(async (workflowId: string, runId: string, options: RunRerunOptions) => {
      const config = loadConfig();
      const outputFormat = normalizeRichOutputFormat(options.format, options.json);
      assertRichOutputFileOption(options.out, outputFormat);
      const organizationId = resolveOrganizationId(config, options.org);

      const result = await withApiClient(config, async (client) => {
        if (options.job) {
          return retryPipelineJobRun(client, {
            organizationId,
            pipelineId: workflowId,
            runId,
            jobId: options.job,
          });
        }

        const detail = await getPipelineRun(client, {
          organizationId,
          pipelineId: workflowId,
          runId,
        });
        const runParams = extractRunParams(detail);
        return createPipelineRun(client, {
          organizationId,
          pipelineId: workflowId,
          params: runParams,
        });
      });

      if (options.out) {
        writeRichOutputFile(options.out, renderRichOutput(result, outputFormat));
        process.stdout.write(`Saved run rerun output to ${options.out}.\n`);
        return;
      }
      printRichData(result, outputFormat);
    });

  run
    .command("logs")
    .description("Show logs for one run job (gh-like)")
    .argument("<workflowId>", "Workflow ID (pipeline ID)")
    .argument("<runId>", "Run ID")
    .option("--job <jobId>", "Job ID")
    .option("--job-name <name>", "Resolve job by name (alternative to --job)")
    .option("--follow", "Follow log output until run is complete", false)
    .option("--interval <seconds>", "Polling interval in seconds", parseFloat, 3)
    .option("--timeout <seconds>", "Max follow time in seconds", parseFloat, 1800)
    .option("--org <organizationId>", "Organization ID")
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write run logs output to file")
    .option("--json", "Print raw JSON")
    .action(async (workflowId: string, runId: string, options: RunLogsOptions) => {
      const config = loadConfig();
      const outputFormat = normalizeRichOutputFormat(options.format, options.json);
      assertRichOutputFileOption(options.out, outputFormat);
      const organizationId = resolveOrganizationId(config, options.org);
      const intervalMs = Math.max(1, Math.round(options.interval * 1000));
      const timeoutMs = Math.max(1, Math.round(options.timeout * 1000));

      let jobId = options.job;
      if (!jobId && options.jobName) {
        const runDetail = await safeGetRunDetail(config, {
          organizationId,
          workflowId,
          runId,
        });
        jobId = runDetail ? resolveJobIdByName(runDetail, options.jobName) : undefined;
      }
      if (!jobId) {
        throw new CliError("Missing job selector. Use --job <jobId> or --job-name <name>.");
      }

      const plainLogMode = outputFormat === "table" && !options.out && !options.json;
      if (!options.follow) {
        const result = await withApiClient(config, (client) =>
          getPipelineJobRunLog(client, {
            organizationId,
            pipelineId: workflowId,
            runId,
            jobId,
          })
        );

        if (plainLogMode) {
          const text = extractRunLogText(result);
          if (text) {
            process.stdout.write(text.endsWith("\n") ? text : `${text}\n`);
            return;
          }
        }

        if (options.out) {
          writeRichOutputFile(options.out, renderRichOutput(result, outputFormat));
          process.stdout.write(`Saved run logs output to ${options.out}.\n`);
          return;
        }
        printRichData(result, outputFormat);
        return;
      }

      const started = Date.now();
      let previous = "";
      let latest: unknown = null;
      while (true) {
        latest = await withApiClient(config, (client) =>
          getPipelineJobRunLog(client, {
            organizationId,
            pipelineId: workflowId,
            runId,
            jobId,
          })
        );
        const text = extractRunLogText(latest) ?? "";
        if (plainLogMode) {
          const delta = computeLogDelta(previous, text);
          if (delta) {
            process.stdout.write(delta);
          }
        }
        previous = text;

        const runStatus = await safeGetRunDetail(config, {
          organizationId,
          workflowId,
          runId,
        });
        const status = readRunStatus(runStatus);
        const more = readLogHasMore(latest);
        if (isTerminalRunStatus(status) && !more) {
          break;
        }
        if (Date.now() - started >= timeoutMs) {
          break;
        }
        await sleep(intervalMs);
      }

      if (options.out) {
        writeRichOutputFile(options.out, renderRichOutput(latest, outputFormat));
        process.stdout.write(`Saved run logs output to ${options.out}.\n`);
        return;
      }
      if (options.json || outputFormat !== "table") {
        printRichData(latest, outputFormat);
      }
    });

  run
    .command("download")
    .description("Download one run artifact (gh-like)")
    .argument("<workflowId>", "Workflow ID (pipeline ID)")
    .argument("<runId>", "Run ID")
    .option("--org <organizationId>", "Organization ID")
    .option("--name <fileName>", "Artifact file name")
    .option("--path <filePath>", "Artifact file path")
    .option("-D, --dir <directory>", "Target directory", ".")
    .option("-o, --output <file>", "Target output file path")
    .option("--print-url", "Only print artifact URL without downloading", false)
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write run download output to file")
    .option("--json", "Print raw JSON")
    .action(async (workflowId: string, runId: string, options: RunDownloadOptions) => {
      const config = loadConfig();
      const outputFormat = normalizeRichOutputFormat(options.format, options.json);
      assertRichOutputFileOption(options.out, outputFormat);
      const organizationId = resolveOrganizationId(config, options.org);

      if (!options.name && !options.path) {
        throw new CliError("Missing artifact selector. Use --name <fileName> and/or --path <filePath>.");
      }

      const response = await withApiClient(config, (client) =>
        getPipelineArtifactUrl(client, {
          organizationId,
          pipelineId: workflowId,
          runId,
          fileName: options.name,
          filePath: options.path,
        })
      );

      const artifactUrl = extractArtifactUrl(response);
      if (!artifactUrl) {
        throw new CliError("Failed to parse artifact URL from API response. Try `--json` to inspect raw output.");
      }

      if (options.printUrl) {
        const payload = {
          url: artifactUrl,
          response,
        };
        if (options.out) {
          writeRichOutputFile(options.out, renderRichOutput(payload, outputFormat));
          process.stdout.write(`Saved run download output to ${options.out}.\n`);
          return;
        }
        printRichData(payload, outputFormat);
        return;
      }

      const outputPath = resolveArtifactOutputPath(artifactUrl, options);
      const bytes = await downloadFile(artifactUrl, outputPath, config.auth.token ?? process.env.YUNXIAO_ACCESS_TOKEN);
      const payload = {
        workflowId,
        runId,
        url: artifactUrl,
        output: outputPath,
        bytes,
      };
      if (options.out) {
        writeRichOutputFile(options.out, renderRichOutput(payload, outputFormat));
        process.stdout.write(`Saved run download output to ${options.out}.\n`);
        return;
      }
      printRichData(payload, outputFormat);
    });

  run
    .command("watch")
    .description("Watch a run until it finishes (gh-like)")
    .argument("<workflowId>", "Workflow ID (pipeline ID)")
    .argument("<runId>", "Run ID")
    .option("--org <organizationId>", "Organization ID")
    .option("--interval <seconds>", "Polling interval in seconds", parseFloat, 5)
    .option("--timeout <seconds>", "Max watch time in seconds", parseFloat, 1800)
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write run watch output to file")
    .option("--json", "Print raw JSON")
    .action(async (workflowId: string, runId: string, options: RunWatchOptions) => {
      const config = loadConfig();
      const outputFormat = normalizeRichOutputFormat(options.format, options.json);
      assertRichOutputFileOption(options.out, outputFormat);
      const organizationId = resolveOrganizationId(config, options.org);
      const intervalMs = Math.max(1, Math.round(options.interval * 1000));
      const timeoutMs = Math.max(1, Math.round(options.timeout * 1000));

      const started = Date.now();
      let previousStatus = "";
      let latest: unknown = null;

      while (true) {
        latest = await withApiClient(config, (client) =>
          getPipelineRun(client, {
            organizationId,
            pipelineId: workflowId,
            runId,
          })
        );
        const currentStatus = readRunStatus(latest);
        if (outputFormat === "table" && !options.out && !options.json && currentStatus !== previousStatus) {
          const elapsed = Math.floor((Date.now() - started) / 1000);
          process.stdout.write(`[${elapsed}s] status=${currentStatus || "(unknown)"}\n`);
          previousStatus = currentStatus;
        }

        if (isTerminalRunStatus(currentStatus)) {
          break;
        }

        if (Date.now() - started >= timeoutMs) {
          break;
        }

        await sleep(intervalMs);
      }

      if (options.out) {
        writeRichOutputFile(options.out, renderRichOutput(latest, outputFormat));
        process.stdout.write(`Saved run watch output to ${options.out}.\n`);
        return;
      }
      printRichData(latest, outputFormat);
    });
}

async function safeGetRunDetail(config: ReturnType<typeof loadConfig>, input: {
  organizationId: string;
  workflowId: string;
  runId: string;
}): Promise<unknown> {
  try {
    return await withApiClient(config, (client) =>
      getPipelineRun(client, {
        organizationId: input.organizationId,
        pipelineId: input.workflowId,
        runId: input.runId,
      })
    );
  } catch {
    try {
      const list = await withApiClient(config, (client) =>
        listPipelineRuns(client, {
          organizationId: input.organizationId,
          pipelineId: input.workflowId,
          page: 1,
          perPage: 100,
        })
      );
      const items = extractRuns(list);
      return items.find((item) => String(item.id ?? item.runId ?? "") === input.runId) ?? null;
    } catch {
      return null;
    }
  }
}

function extractRuns(response: unknown): Record<string, unknown>[] {
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

function extractRunParams(run: unknown): unknown {
  if (!isRecord(run)) {
    return undefined;
  }

  const candidates = ["params", "runParams", "runtimeParams"];
  for (const key of candidates) {
    const value = run[key];
    if (typeof value === "string") {
      return maybeJson(value);
    }
    if (value !== undefined && value !== null) {
      return value;
    }
  }

  return undefined;
}

function readRunStatus(run: unknown): string {
  if (!isRecord(run)) {
    return "";
  }

  const directKeys = ["status", "pipelineStatus", "state", "result"];
  for (const key of directKeys) {
    const value = run[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return "";
}

function isTerminalRunStatus(status: string): boolean {
  const normalized = status.toLowerCase();
  if (!normalized) {
    return false;
  }
  return TERMINAL_STATUS_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractRunLogText(log: unknown): string | undefined {
  if (typeof log === "string" && log.trim()) {
    return log;
  }

  if (!isRecord(log)) {
    return undefined;
  }

  const direct = [log.content, log.log];
  for (const value of direct) {
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }

  if (isRecord(log.log)) {
    const nested = log.log.content;
    if (typeof nested === "string" && nested.trim()) {
      return nested;
    }
  }

  const nestedCandidates = [log.data, log.result, log.body];
  for (const candidate of nestedCandidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate;
    }
    if (!isRecord(candidate)) {
      continue;
    }
    const value = candidate.content ?? candidate.log;
    if (typeof value === "string" && value.trim()) {
      return value;
    }
    if (isRecord(value) && typeof value.content === "string" && value.content.trim()) {
      return value.content;
    }
  }

  return undefined;
}

function readLogHasMore(log: unknown): boolean {
  if (!isRecord(log)) {
    return false;
  }

  const candidates = [log.more, isRecord(log.log) ? log.log.more : undefined];
  for (const candidate of candidates) {
    if (typeof candidate === "boolean") {
      return candidate;
    }
  }

  const nested = [log.body, log.result, log.data];
  for (const item of nested) {
    if (!isRecord(item)) {
      continue;
    }
    if (typeof item.more === "boolean") {
      return item.more;
    }
    if (isRecord(item.log) && typeof item.log.more === "boolean") {
      return item.log.more;
    }
  }

  return false;
}

function computeLogDelta(previous: string, current: string): string {
  if (!current) {
    return "";
  }
  if (!previous) {
    return current.endsWith("\n") ? current : `${current}\n`;
  }
  if (current.startsWith(previous)) {
    const delta = current.slice(previous.length);
    if (!delta) {
      return "";
    }
    return delta.endsWith("\n") ? delta : `${delta}\n`;
  }
  return current.endsWith("\n") ? current : `${current}\n`;
}

function resolveJobIdByName(run: unknown, jobName: string): string | undefined {
  const normalized = jobName.trim().toLowerCase();
  if (!normalized || !isRecord(run)) {
    return undefined;
  }

  const directCollections = [run.jobs, run.pipelineJobs, run.jobRuns];
  for (const collection of directCollections) {
    if (!Array.isArray(collection)) {
      continue;
    }
    const id = resolveJobIdInList(collection, normalized);
    if (id) {
      return id;
    }
  }

  const stages = run.stages;
  if (Array.isArray(stages)) {
    for (const stage of stages) {
      if (!isRecord(stage)) {
        continue;
      }
      const stageInfo = isRecord(stage.stageInfo) ? stage.stageInfo : undefined;
      const jobs = stageInfo?.jobs;
      if (!Array.isArray(jobs)) {
        continue;
      }
      const id = resolveJobIdInList(jobs, normalized);
      if (id) {
        return id;
      }
    }
  }

  return undefined;
}

function resolveJobIdInList(list: unknown[], jobNameNormalized: string): string | undefined {
  for (const item of list) {
    if (!isRecord(item)) {
      continue;
    }
    const name = String(item.name ?? item.jobName ?? item.displayName ?? "").trim().toLowerCase();
    if (!name) {
      continue;
    }
    if (name === jobNameNormalized || name.includes(jobNameNormalized)) {
      const id = item.id ?? item.jobId ?? item.identifier;
      if (typeof id === "string" && id.trim()) {
        return id.trim();
      }
      if (typeof id === "number" && Number.isFinite(id)) {
        return String(Math.round(id));
      }
    }
  }
  return undefined;
}

function extractArtifactUrl(response: unknown): string | undefined {
  if (typeof response === "string" && response.trim()) {
    return response;
  }

  if (!isRecord(response)) {
    return undefined;
  }

  const directKeys = ["fileUrl", "url", "downloadUrl", "artifactUrl", "link"];
  for (const key of directKeys) {
    const value = response[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  const nestedKeys = ["result", "data", "body"];
  for (const key of nestedKeys) {
    const value = response[key];
    if (!isRecord(value)) {
      continue;
    }
    const nested = extractArtifactUrl(value);
    if (nested) {
      return nested;
    }
  }

  return undefined;
}

function resolveArtifactOutputPath(url: string, options: RunDownloadOptions): string {
  if (options.output) {
    return options.output;
  }

  const nameFromOption = options.name?.trim();
  if (nameFromOption) {
    return path.join(options.dir, nameFromOption);
  }

  try {
    const pathname = new URL(url).pathname;
    const fallback = path.basename(pathname) || `artifact-${Date.now()}.bin`;
    return path.join(options.dir, fallback);
  } catch {
    return path.join(options.dir, `artifact-${Date.now()}.bin`);
  }
}

async function downloadFile(url: string, outputPath: string, token?: string): Promise<number> {
  await mkdir(path.dirname(outputPath), { recursive: true });

  const baseHeaders: Record<string, string> = {
    "User-Agent": "yx-cli/0.1.0",
  };
  let response = await fetch(url, {
    method: "GET",
    headers: baseHeaders,
  });
  if (!response.ok && token && (response.status === 401 || response.status === 403)) {
    response = await fetch(url, {
      method: "GET",
      headers: {
        ...baseHeaders,
        "x-yunxiao-token": token,
      },
    });
  }

  if (!response.ok) {
    throw new CliError(`Failed to download artifact: HTTP ${response.status} ${response.statusText}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  await writeFile(outputPath, buffer);
  return buffer.byteLength;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type RunListOptions = {
  workflow: string;
  org?: string;
  limit: number;
  status?: string;
  page?: number;
  perPage?: number;
  format?: string;
  out?: string;
  json?: boolean;
};

type RunViewOptions = {
  org?: string;
  format?: string;
  out?: string;
  json?: boolean;
};

type RunCancelOptions = {
  org?: string;
  format?: string;
  out?: string;
  json?: boolean;
};

type RunRerunOptions = {
  org?: string;
  job?: string;
  format?: string;
  out?: string;
  json?: boolean;
};

type RunLogsOptions = {
  org?: string;
  job?: string;
  jobName?: string;
  follow?: boolean;
  interval: number;
  timeout: number;
  format?: string;
  out?: string;
  json?: boolean;
};

type RunDownloadOptions = {
  org?: string;
  name?: string;
  path?: string;
  dir: string;
  output?: string;
  printUrl?: boolean;
  format?: string;
  out?: string;
  json?: boolean;
};

type RunWatchOptions = {
  org?: string;
  interval: number;
  timeout: number;
  format?: string;
  out?: string;
  json?: boolean;
};
