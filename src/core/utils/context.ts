import { CliError } from "../errors.js";
import { YxConfig } from "../config/schema.js";
import { OutputFormat } from "../output/print.js";

export function resolveOrganizationId(config: YxConfig, provided?: string): string {
  const organizationId = provided ?? config.defaults.organizationId;
  if (!organizationId) {
    throw new CliError("Missing organization ID. Use --org or set defaults.organizationId via `yx config set defaults.organizationId <id>`.");
  }
  return organizationId;
}

export function resolveProjectId(config: YxConfig, provided?: string): string {
  const projectId = provided ?? config.defaults.projectId;
  if (!projectId) {
    throw new CliError("Missing project ID. Use --project or set defaults.projectId via `yx config set defaults.projectId <id>`.");
  }
  return projectId;
}

export function resolveRepositoryId(config: YxConfig, provided?: string): string {
  const repositoryId = provided ?? config.defaults.repositoryId;
  if (!repositoryId) {
    throw new CliError(
      "Missing repository ID. Use --repo or set defaults.repositoryId via `yx repo set-default <repo>`."
    );
  }
  return repositoryId;
}

export function resolveOutputFormat(config: YxConfig, jsonFlag?: boolean): OutputFormat {
  if (jsonFlag) {
    return "json";
  }
  return "table";
}

export function toRecord(input: unknown): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new CliError("Expected an object result.");
  }
  return input as Record<string, unknown>;
}
