import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { YxConfig, YxConfigSchema } from "./schema.js";
import { CliError } from "../errors.js";

const CONFIG_DIR_NAME = ".yx";
const CONFIG_FILE_NAME = "config.json";

export function getConfigDir(): string {
  return path.join(os.homedir(), CONFIG_DIR_NAME);
}

export function getConfigPath(): string {
  return path.join(getConfigDir(), CONFIG_FILE_NAME);
}

export function getDefaultConfig(): YxConfig {
  return YxConfigSchema.parse({});
}

export function loadConfig(): YxConfig {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) {
    return getDefaultConfig();
  }

  let rawParsed: unknown;
  try {
    rawParsed = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } catch (error) {
    throw new CliError(`Invalid config JSON at ${configPath}. Fix the file or run \`yx config get\` to inspect it.`, error);
  }

  try {
    return YxConfigSchema.parse(rawParsed);
  } catch (error) {
    throw new CliError(`Invalid config format: ${formatConfigValidationError(error)}`, error);
  }
}

export function saveConfig(config: YxConfig): void {
  const validated = YxConfigSchema.parse(config);
  writeConfigFile(validated);
}

export function updateConfig(mutator: (config: YxConfig) => YxConfig): YxConfig {
  const current = loadConfig();
  const next = mutator(current);
  saveConfig(next);
  return next;
}

export function maskToken(token?: string): string {
  if (!token) {
    return "(not set)";
  }
  if (token.length <= 8) {
    return "*".repeat(token.length);
  }
  return `${token.slice(0, 4)}${"*".repeat(token.length - 8)}${token.slice(-4)}`;
}

function formatConfigValidationError(error: unknown): string {
  if (error && typeof error === "object" && "issues" in error) {
    const issues = (error as { issues?: Array<{ path?: Array<string | number>; message?: string }> }).issues;
    const first = issues?.[0];
    if (first) {
      const where = first.path && first.path.length > 0 ? first.path.join(".") : "(root)";
      const message = typeof first.message === "string" ? first.message : "invalid value";
      return `${where}: ${message}`;
    }
  }
  return "schema validation failed";
}

function writeConfigFile(config: YxConfig): void {
  const dir = getConfigDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(getConfigPath(), `${JSON.stringify(config, null, 2)}\n`, "utf-8");
}
