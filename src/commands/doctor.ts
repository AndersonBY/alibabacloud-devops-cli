import { Command } from "commander";
import { getCurrentUser, listUserOrganizations } from "../core/api/org.js";
import { getRepository } from "../core/api/repo.js";
import { withApiClient } from "../core/api/client.js";
import { loadConfig } from "../core/config/store.js";
import { CliError } from "../core/errors.js";
import {
  assertRichOutputFileOption,
  normalizeRichOutputFormat,
  printRichData,
  renderRichOutput,
  writeRichOutputFile,
} from "../core/output/rich.js";
import { extractRecordList, isRecord } from "../core/utils/records.js";

type DoctorOptions = {
  org?: string;
  repo?: string;
  format?: string;
  out?: string;
  json?: boolean;
};

type DoctorCheckStatus = "ok" | "warn" | "fail";

type DoctorCheck = {
  name: string;
  status: DoctorCheckStatus;
  detail: string;
};

export function registerDoctorCommand(program: Command): void {
  program
    .command("doctor")
    .description("Run environment and API diagnostics")
    .option("--org <organizationId>", "Organization ID override")
    .option("--repo <repositoryId>", "Repository ID/path override")
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write doctor output to file")
    .option("--json", "Print raw JSON")
    .action(async (options: DoctorOptions) => {
      const config = loadConfig();
      const outputFormat = normalizeRichOutputFormat(options.format, options.json);
      assertRichOutputFileOption(options.out, outputFormat);
      const checks: DoctorCheck[] = [];
      const selectedOrganizationId = normalizeOptional(options.org) ?? normalizeOptional(config.defaults.organizationId);
      const selectedRepositoryId = normalizeOptional(options.repo) ?? normalizeOptional(config.defaults.repositoryId);
      const token = config.auth.token ?? process.env.YUNXIAO_ACCESS_TOKEN;

      if (token) {
        checks.push({
          name: "auth.token",
          status: "ok",
          detail: `Token is configured (${config.auth.token ? "config" : "env"}).`,
        });
      } else {
        checks.push({
          name: "auth.token",
          status: "fail",
          detail: "Missing token. Run `yx auth login --token <TOKEN>`.",
        });
      }

      const baseUrl = normalizeOptional(config.api.baseUrl);
      if (!baseUrl) {
        checks.push({
          name: "api.baseUrl",
          status: "fail",
          detail: "Missing api.baseUrl in config.",
        });
      } else {
        try {
          const parsed = new URL(baseUrl);
          checks.push({
            name: "api.baseUrl",
            status: "ok",
            detail: `Using ${parsed.origin}.`,
          });
        } catch {
          checks.push({
            name: "api.baseUrl",
            status: "fail",
            detail: `Invalid URL: ${baseUrl}`,
          });
        }
      }

      let currentUserId: string | null = null;
      let organizationIds: string[] = [];
      const canCallApi = checks.every((item) => item.name !== "auth.token" && item.name !== "api.baseUrl" ? true : item.status !== "fail");

      if (canCallApi) {
        try {
          await withApiClient(config, async (client) => {
            const currentUser = await getCurrentUser(client);
            currentUserId = extractIdentity(currentUser);
            const orgs = await listUserOrganizations(client);
            organizationIds = extractOrganizationIds(orgs);
          });
          checks.push({
            name: "api.connectivity",
            status: "ok",
            detail: `OpenAPI reachable${currentUserId ? `, current user: ${currentUserId}` : ""}.`,
          });
        } catch (error) {
          checks.push({
            name: "api.connectivity",
            status: "fail",
            detail: error instanceof Error ? error.message : String(error),
          });
        }
      } else {
        checks.push({
          name: "api.connectivity",
          status: "warn",
          detail: "Skipped because token/baseUrl check failed.",
        });
      }

      if (!selectedOrganizationId) {
        checks.push({
          name: "context.organization",
          status: "warn",
          detail: "No organization selected. Use --org or set defaults.organizationId.",
        });
      } else if (organizationIds.length === 0) {
        const apiCheckFailed = checks.some((item) => item.name === "api.connectivity" && item.status === "fail");
        checks.push({
          name: "context.organization",
          status: apiCheckFailed ? "warn" : "ok",
          detail: apiCheckFailed
            ? `Cannot verify organization ${selectedOrganizationId} because API connectivity failed.`
            : `Using organization ${selectedOrganizationId}.`,
        });
      } else if (organizationIds.includes(selectedOrganizationId)) {
        checks.push({
          name: "context.organization",
          status: "ok",
          detail: `Organization ${selectedOrganizationId} is accessible.`,
        });
      } else {
        checks.push({
          name: "context.organization",
          status: "fail",
          detail: `Organization ${selectedOrganizationId} is not in current account's organization list.`,
        });
      }

      if (!selectedRepositoryId) {
        checks.push({
          name: "context.repository",
          status: "warn",
          detail: "No repository selected. Use --repo or set defaults.repositoryId.",
        });
      } else if (!selectedOrganizationId) {
        checks.push({
          name: "context.repository",
          status: "warn",
          detail: `Cannot verify repository ${selectedRepositoryId} without organization ID.`,
        });
      } else {
        try {
          await withApiClient(config, (client) =>
            getRepository(client, {
              organizationId: selectedOrganizationId,
              repositoryId: selectedRepositoryId,
            })
          );
          checks.push({
            name: "context.repository",
            status: "ok",
            detail: `Repository ${selectedRepositoryId} is accessible.`,
          });
        } catch (error) {
          checks.push({
            name: "context.repository",
            status: "fail",
            detail: error instanceof Error ? error.message : String(error),
          });
        }
      }

      const summary = buildSummary(checks);
      const result = {
        ok: summary.fail === 0,
        summary,
        context: {
          organizationId: selectedOrganizationId ?? null,
          repositoryId: selectedRepositoryId ?? null,
          userId: currentUserId,
          baseUrl: normalizeOptional(config.api.baseUrl) ?? null,
        },
        checks,
      };

      if (options.out) {
        writeRichOutputFile(options.out, renderRichOutput(result, outputFormat));
        process.stdout.write(`Saved doctor output to ${options.out}.\n`);
      } else {
        printRichData(result, outputFormat);
      }

      if (summary.fail > 0) {
        throw new CliError(`Doctor found ${summary.fail} failing check(s).`);
      }
    });
}

function buildSummary(checks: DoctorCheck[]): {
  ok: number;
  warn: number;
  fail: number;
  total: number;
} {
  const summary = {
    ok: 0,
    warn: 0,
    fail: 0,
    total: checks.length,
  };
  for (const item of checks) {
    summary[item.status] += 1;
  }
  return summary;
}

function normalizeOptional(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function extractIdentity(value: unknown): string | null {
  if (!isRecord(value)) {
    return null;
  }
  const candidates = ["id", "userId", "uid", "empId"];
  for (const key of candidates) {
    const current = value[key];
    if (typeof current === "string" && current.trim()) {
      return current.trim();
    }
    if (typeof current === "number") {
      return String(current);
    }
  }
  return null;
}

function extractOrganizationIds(response: unknown): string[] {
  const items = extractRecordList(response);
  const result: string[] = [];

  for (const item of items) {
    for (const key of ["id", "organizationId", "spaceId"]) {
      const value = item[key];
      if (typeof value === "string" && value.trim()) {
        result.push(value.trim());
        break;
      }
      if (typeof value === "number") {
        result.push(String(value));
        break;
      }
    }
  }

  return Array.from(new Set(result));
}
