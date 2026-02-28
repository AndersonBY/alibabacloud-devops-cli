import { Command } from "commander";
import { loadConfig } from "../core/config/store.js";
import { withApiClient, YunxiaoApiClient } from "../core/api/client.js";
import {
  assertRichOutputFileOption,
  normalizeRichOutputFormat,
  printRichData,
  renderRichOutput,
  writeRichOutputFile,
} from "../core/output/rich.js";
import { parseKeyValuePairs } from "../core/utils/args.js";
import { maybeJson } from "../core/utils/json.js";

export function registerApiCommand(program: Command): void {
  const api = program.command("api").description("Call Yunxiao OpenAPI directly");

  api
    .command("get")
    .description("GET request")
    .argument("<path>", "API path, e.g. /oapi/v1/platform/user")
    .option("--query <key=value>", "Query parameter, repeatable", collect, [])
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write API get output to file")
    .option("--json", "Print raw JSON")
    .action(async (path: string, options: { query: string[]; format?: string; out?: string; json?: boolean }) => {
      const config = loadConfig();
      const outputFormat = normalizeRichOutputFormat(options.format, options.json);
      assertRichOutputFileOption(options.out, outputFormat);
      const query = parseKeyValuePairs(options.query ?? []);
      const result = await withApiClient(config, (client) => client.get(path, query));
      if (options.out) {
        writeRichOutputFile(options.out, renderRichOutput(result, outputFormat));
        process.stdout.write(`Saved api get output to ${options.out}.\n`);
        return;
      }
      printRichData(result, outputFormat);
    });

  registerApiWriteCommand(api, {
    name: "post",
    method: "POST",
    description: "POST request",
    defaultBody: {},
  });
  registerApiWriteCommand(api, {
    name: "put",
    method: "PUT",
    description: "PUT request",
  });
  registerApiWriteCommand(api, {
    name: "patch",
    method: "PATCH",
    description: "PATCH request",
  });
  registerApiWriteCommand(api, {
    name: "delete",
    method: "DELETE",
    description: "DELETE request",
  });
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function registerApiWriteCommand(
  api: Command,
  input: {
    name: "post" | "put" | "patch" | "delete";
    method: "POST" | "PUT" | "PATCH" | "DELETE";
    description: string;
    defaultBody?: unknown;
  }
): void {
  api
    .command(input.name)
    .description(input.description)
    .argument("<path>", "API path")
    .option("--query <key=value>", "Query parameter, repeatable", collect, [])
    .option("--body <json>", "JSON body")
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write API output to file")
    .option("--json", "Print raw JSON")
    .action(async (path: string, options: { query: string[]; body?: string; format?: string; out?: string; json?: boolean }) => {
      const config = loadConfig();
      const outputFormat = normalizeRichOutputFormat(options.format, options.json);
      assertRichOutputFileOption(options.out, outputFormat);
      const query = parseKeyValuePairs(options.query ?? []);
      const body = options.body === undefined ? input.defaultBody : maybeJson(options.body);
      const result = await withApiClient(config, (client) =>
        requestWithCompatFallback(client, {
          method: input.method,
          path,
          query,
          body,
        })
      );
      if (options.out) {
        writeRichOutputFile(options.out, renderRichOutput(result, outputFormat));
        process.stdout.write(`Saved api ${input.name} output to ${options.out}.\n`);
        return;
      }
      printRichData(result, outputFormat);
    });
}

async function requestWithCompatFallback(
  client: YunxiaoApiClient,
  input: {
    method: "POST" | "PUT" | "PATCH" | "DELETE";
    path: string;
    query?: Record<string, unknown>;
    body?: unknown;
  }
): Promise<unknown> {
  try {
    return await client.request(input.path, {
      method: input.method,
      query: input.query,
      body: input.body,
    });
  } catch (error) {
    if (!isCompatFallbackError(error)) {
      throw error;
    }

    const candidates = buildCompatCandidates(input);
    if (candidates.length === 0) {
      throw error;
    }

    let lastError: unknown = error;
    for (const candidate of candidates) {
      try {
        return await client.request(candidate.path, {
          method: candidate.method,
          query: candidate.query,
          body: candidate.body,
        });
      } catch (candidateError) {
        lastError = candidateError;
        if (!isCompatFallbackError(candidateError)) {
          throw candidateError;
        }
      }
    }

    throw lastError;
  }
}

function isCompatFallbackError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return (
    /^Yunxiao API (404|405):/.test(error.message) ||
    error.message.includes("returned HTML document unexpectedly")
  );
}

function buildCompatCandidates(input: {
  method: "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  query?: Record<string, unknown>;
  body?: unknown;
}): Array<{
  method: "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  query?: Record<string, unknown>;
  body?: unknown;
}> {
  const candidates: Array<{
    method: "POST" | "PUT" | "PATCH" | "DELETE";
    path: string;
    query?: Record<string, unknown>;
    body?: unknown;
  }> = [];

  if (input.method === "PATCH") {
    candidates.push({
      method: "PUT",
      path: input.path,
      query: input.query,
      body: input.body,
    });

    const oapiChangeRequestMatch = input.path.match(
      /^\/oapi\/v1\/codeup\/organizations\/([^/]+)\/repositories\/([^/]+)\/changeRequests\/([^/?#]+)$/
    );
    if (oapiChangeRequestMatch) {
      const [, organizationId, repositoryIdentity, localId] = oapiChangeRequestMatch;
      const fallbackQuery = {
        ...(input.query ?? {}),
        organizationId,
      };
      candidates.push({
        method: "PUT",
        path: `/api/v4/projects/${repositoryIdentity}/merge_requests/${localId}`,
        query: fallbackQuery,
        body: input.body,
      });
    }
  }

  return candidates;
}
