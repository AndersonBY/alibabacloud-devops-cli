import { Command } from "commander";
import { createHash } from "node:crypto";
import { loadConfig } from "../core/config/store.js";
import { withApiClient } from "../core/api/client.js";
import {
  createFlowVariableGroup,
  deleteFlowVariableGroup,
  listFlowVariableGroups,
  updateFlowVariableGroup,
} from "../core/api/secret.js";
import { CliError } from "../core/errors.js";
import {
  assertRichOutputFileOption,
  normalizeRichOutputFormat,
  printRichData,
  renderRichOutput,
  writeRichOutputFile,
} from "../core/output/rich.js";
import { resolveOrganizationId, resolveRepositoryId } from "../core/utils/context.js";

type SecretScope = "org" | "repo" | "pipeline";

type SecretSetOptions = {
  org?: string;
  repo?: string;
  pipeline?: string;
  scope?: string;
  value: string;
  plain?: boolean;
  format?: string;
  out?: string;
  json?: boolean;
};

type SecretListOptions = {
  org?: string;
  repo?: string;
  pipeline?: string;
  scope?: string;
  format?: string;
  out?: string;
  json?: boolean;
};

type SecretDeleteOptions = {
  org?: string;
  repo?: string;
  pipeline?: string;
  scope?: string;
  format?: string;
  out?: string;
  json?: boolean;
};

const SECRET_SCOPE_SET = new Set<SecretScope>(["org", "repo", "pipeline"]);
const SECRET_GROUP_NAME_PREFIX = "yxs";
const SECRET_META_PREFIX = "yx-secret-meta:";

export function registerSecretCommand(program: Command): void {
  const secret = program.command("secret").description("Manage secrets (stored in flow variable groups)");

  secret
    .command("set")
    .description("Create or update one secret")
    .argument("<name>", "Secret name")
    .requiredOption("--value <value>", "Secret value")
    .option("--scope <scope>", "Secret scope: org|repo|pipeline", "org")
    .option("--org <organizationId>", "Organization ID")
    .option("--repo <repositoryId>", "Repository ID/path (required for --scope repo without default repo)")
    .option("--pipeline <pipelineId>", "Pipeline ID (required for --scope pipeline)")
    .option("--plain", "Store as plain variable instead of encrypted secret", false)
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write secret set output to file")
    .option("--json", "Print raw JSON")
    .action(async (name: string, options: SecretSetOptions) => {
      const config = loadConfig();
      const outputFormat = normalizeRichOutputFormat(options.format, options.json);
      assertRichOutputFileOption(options.out, outputFormat);
      const organizationId = resolveOrganizationId(config, options.org);
      const scope = resolveSecretScope(options.scope, "org");
      const target = resolveScopeTarget(config, scope, options.repo, options.pipeline, organizationId);
      const storageName = buildStorageName(scope, target, name);
      const description = buildSecretMeta(scope, target, name);
      const variables = JSON.stringify([
        {
          name: "SECRET_VALUE",
          value: options.value,
          isEncrypted: options.plain ? false : true,
        },
      ]);

      const groups = await withApiClient(config, (client) =>
        listFlowVariableGroups(client, {
          organizationId,
          maxResults: 200,
        })
      );
      const existing = groups.find((group) => group.name === storageName);

      let operation: "created" | "updated";
      let groupId: number;

      if (existing) {
        await withApiClient(config, (client) =>
          updateFlowVariableGroup(client, {
            organizationId,
            id: existing.id,
            name: storageName,
            description,
            variables,
          })
        );
        operation = "updated";
        groupId = existing.id;
      } else {
        groupId = await withApiClient(config, (client) =>
          createFlowVariableGroup(client, {
            organizationId,
            name: storageName,
            description,
            variables,
          })
        );
        operation = "created";
      }

      const payload = {
        operation,
        scope,
        name,
        target,
        groupId,
        encrypted: !options.plain,
        valueMasked: maskSecret(options.value),
      };
      if (options.out) {
        writeRichOutputFile(options.out, renderRichOutput(payload, outputFormat));
        process.stdout.write(`Saved secret set output to ${options.out}.\n`);
        return;
      }
      printRichData(payload, outputFormat);
    });

  secret
    .command("list")
    .description("List managed secrets")
    .option("--scope <scope>", "Filter scope: org|repo|pipeline")
    .option("--org <organizationId>", "Organization ID")
    .option("--repo <repositoryId>", "Repository ID/path filter (for repo scope)")
    .option("--pipeline <pipelineId>", "Pipeline ID filter (for pipeline scope)")
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write secret list output to file")
    .option("--json", "Print raw JSON")
    .action(async (options: SecretListOptions) => {
      const config = loadConfig();
      const outputFormat = normalizeRichOutputFormat(options.format, options.json);
      assertRichOutputFileOption(options.out, outputFormat);
      const organizationId = resolveOrganizationId(config, options.org);
      const scope = options.scope ? resolveSecretScope(options.scope) : undefined;
      const targetFilter = resolveScopeFilterTarget(config, scope, options.repo, options.pipeline, organizationId);

      const groups = await withApiClient(config, (client) =>
        listFlowVariableGroups(client, {
          organizationId,
          maxResults: 200,
        })
      );

      const rows = groups
        .map((group) => {
          const parsed = parseSecretMeta(group.description);
          if (!parsed) {
            return undefined;
          }
          if (scope && parsed.scope !== scope) {
            return undefined;
          }
          if (targetFilter && parsed.target !== targetFilter) {
            return undefined;
          }
          return {
            name: parsed.secretName,
            scope: parsed.scope,
            target: parsed.target,
            groupId: group.id,
            encrypted: group.variables.some((item) => item.isEncrypted === true),
            variableCount: group.variables.length,
            updatedAt: typeof group.updateTime === "number" ? new Date(group.updateTime).toISOString() : null,
          };
        })
        .filter((item): item is NonNullable<typeof item> => Boolean(item))
        .sort((a, b) => {
          if (a.scope !== b.scope) {
            return a.scope.localeCompare(b.scope);
          }
          if (a.target !== b.target) {
            return a.target.localeCompare(b.target);
          }
          return a.name.localeCompare(b.name);
        });

      if (options.out) {
        writeRichOutputFile(options.out, renderRichOutput(rows, outputFormat));
        process.stdout.write(`Saved secret list output to ${options.out}.\n`);
        return;
      }
      printRichData(rows, outputFormat);
    });

  secret
    .command("delete")
    .description("Delete one secret")
    .argument("<name>", "Secret name")
    .option("--scope <scope>", "Secret scope: org|repo|pipeline", "org")
    .option("--org <organizationId>", "Organization ID")
    .option("--repo <repositoryId>", "Repository ID/path (required for --scope repo without default repo)")
    .option("--pipeline <pipelineId>", "Pipeline ID (required for --scope pipeline)")
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write secret delete output to file")
    .option("--json", "Print raw JSON")
    .action(async (name: string, options: SecretDeleteOptions) => {
      const config = loadConfig();
      const outputFormat = normalizeRichOutputFormat(options.format, options.json);
      assertRichOutputFileOption(options.out, outputFormat);
      const organizationId = resolveOrganizationId(config, options.org);
      const scope = resolveSecretScope(options.scope, "org");
      const target = resolveScopeTarget(config, scope, options.repo, options.pipeline, organizationId);
      const storageName = buildStorageName(scope, target, name);

      const groups = await withApiClient(config, (client) =>
        listFlowVariableGroups(client, {
          organizationId,
          maxResults: 200,
        })
      );
      const existing = groups.find((group) => group.name === storageName);
      if (!existing) {
        throw new CliError(`Secret not found: ${name} (scope=${scope}, target=${target})`);
      }

      await withApiClient(config, (client) =>
        deleteFlowVariableGroup(client, {
          organizationId,
          id: existing.id,
        })
      );

      const payload = {
        removed: true,
        scope,
        name,
        target,
        groupId: existing.id,
      };
      if (options.out) {
        writeRichOutputFile(options.out, renderRichOutput(payload, outputFormat));
        process.stdout.write(`Saved secret delete output to ${options.out}.\n`);
        return;
      }
      printRichData(payload, outputFormat);
    });
}

function resolveSecretScope(scope?: string, fallback?: SecretScope): SecretScope {
  const value = (scope ?? fallback)?.trim();
  if (!value) {
    throw new CliError("Missing scope. Use --scope org|repo|pipeline.");
  }
  if (!SECRET_SCOPE_SET.has(value as SecretScope)) {
    throw new CliError(`Invalid scope: ${scope}. Expected one of: org, repo, pipeline.`);
  }
  return value as SecretScope;
}

function resolveScopeTarget(
  config: ReturnType<typeof loadConfig>,
  scope: SecretScope,
  repo: string | undefined,
  pipeline: string | undefined,
  organizationId: string
): string {
  if (scope === "org") {
    return organizationId;
  }
  if (scope === "repo") {
    return resolveRepositoryId(config, repo);
  }
  const pipelineId = pipeline?.trim();
  if (!pipelineId) {
    throw new CliError("Missing pipeline ID. Use --pipeline for --scope pipeline.");
  }
  return pipelineId;
}

function resolveScopeFilterTarget(
  config: ReturnType<typeof loadConfig>,
  scope: SecretScope | undefined,
  repo: string | undefined,
  pipeline: string | undefined,
  organizationId: string
): string | undefined {
  if (!scope) {
    return undefined;
  }
  if (scope === "org") {
    return organizationId;
  }
  if (scope === "repo") {
    if (!repo && !config.defaults.repositoryId) {
      return undefined;
    }
    return resolveRepositoryId(config, repo);
  }
  const pipelineId = pipeline?.trim();
  return pipelineId || undefined;
}

function buildStorageName(scope: SecretScope, target: string, secretName: string): string {
  const normalizedSecretName = secretName.trim();
  if (!normalizedSecretName) {
    throw new CliError("Secret name cannot be empty.");
  }
  const scopeKey = scope[0];
  const digest = createHash("sha1").update(`${scope}\n${target}\n${normalizedSecretName}`, "utf8").digest("hex").slice(0, 24);
  return `${SECRET_GROUP_NAME_PREFIX}-${scopeKey}-${digest}`;
}

function buildSecretMeta(scope: SecretScope, target: string, secretName: string): string {
  const payload = {
    scope,
    target,
    secretName: secretName.trim(),
  };
  return `${SECRET_META_PREFIX}${toBase64Url(JSON.stringify(payload))}`;
}

function parseSecretMeta(description?: string): { scope: SecretScope; target: string; secretName: string } | null {
  if (!description || !description.startsWith(SECRET_META_PREFIX)) {
    return null;
  }

  const encoded = description.slice(SECRET_META_PREFIX.length);
  if (!encoded) {
    return null;
  }

  try {
    const raw = fromBase64Url(encoded);
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const scope = typeof parsed.scope === "string" ? parsed.scope : "";
    const target = typeof parsed.target === "string" ? parsed.target : "";
    const secretName = typeof parsed.secretName === "string" ? parsed.secretName : "";
    if (!SECRET_SCOPE_SET.has(scope as SecretScope) || !target || !secretName) {
      return null;
    }
    return {
      scope: scope as SecretScope,
      target,
      secretName,
    };
  } catch {
    return null;
  }
}

function toBase64Url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function fromBase64Url(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function maskSecret(value: string): string {
  if (!value) {
    return "";
  }
  if (value.length <= 4) {
    return "*".repeat(value.length);
  }
  return `${"*".repeat(value.length - 4)}${value.slice(-4)}`;
}
