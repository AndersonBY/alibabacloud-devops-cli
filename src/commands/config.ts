import { Command } from "commander";
import { z } from "zod";
import { getByPath, parseConfigValue, setByPath } from "../core/utils/object-path.js";
import { getConfigPath, loadConfig, saveConfig } from "../core/config/store.js";
import { YxConfigSchema } from "../core/config/schema.js";
import {
  assertRichOutputFileOption,
  normalizeRichOutputFormat,
  printRichData,
  renderRichOutput,
  writeRichOutputFile,
} from "../core/output/rich.js";
import { CliError } from "../core/errors.js";

const JsonStringSchema = z.string().min(1);

export function registerConfigCommand(program: Command): void {
  const configCommand = program.command("config").description("Read or update yx configuration");

  configCommand
    .command("path")
    .description("Print config file path")
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write config path output to file")
    .option("--json", "Print raw JSON")
    .action((options: { format?: string; out?: string; json?: boolean }) => {
      const outputFormat = normalizeRichOutputFormat(options.format, options.json);
      assertRichOutputFileOption(options.out, outputFormat);
      const configPath = getConfigPath();
      const payload = {
        path: configPath,
      };
      if (options.out) {
        writeRichOutputFile(options.out, renderRichOutput(payload, outputFormat));
        process.stdout.write(`Saved config path output to ${options.out}.\n`);
        return;
      }
      if (outputFormat !== "table") {
        printRichData(payload, outputFormat);
        return;
      }
      process.stdout.write(`${configPath}\n`);
    });

  configCommand
    .command("get")
    .description("Get full config or one value by dotted path")
    .argument("[key]", "Dotted key path")
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write config get output to file")
    .option("--json", "Print raw JSON")
    .action((key: string | undefined, options: { format?: string; out?: string; json?: boolean }) => {
      assertSupportedConfigKey(key);
      const outputFormat = normalizeRichOutputFormat(options.format, options.json);
      assertRichOutputFileOption(options.out, outputFormat);
      const config = loadConfig();
      const result = key ? getByPath(config, key) : config;
      if (options.out) {
        writeRichOutputFile(options.out, renderRichOutput(result, outputFormat));
        process.stdout.write(`Saved config get output to ${options.out}.\n`);
        return;
      }
      printRichData(result, outputFormat);
    });

  configCommand
    .command("set")
    .description("Set one config value by dotted path")
    .argument("<key>", "Dotted key path")
    .argument("<value>", "Value, supports JSON literals")
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write config set output to file")
    .option("--json", "Print raw JSON")
    .action((key: string, value: string, options: { format?: string; out?: string; json?: boolean }) => {
      assertSupportedConfigKey(key);
      const outputFormat = normalizeRichOutputFormat(options.format, options.json);
      assertRichOutputFileOption(options.out, outputFormat);
      const config = loadConfig();
      const parsedValue = parseConfigValue(value);

      try {
        const mutable = structuredClone(config) as Record<string, unknown>;
        setByPath(mutable, key, parsedValue);
        const validated = YxConfigSchema.parse(mutable);
        saveConfig(validated);
        const payload = {
          updated: true,
          key,
        };
        if (options.out) {
          writeRichOutputFile(options.out, renderRichOutput(payload, outputFormat));
          process.stdout.write(`Saved config set output to ${options.out}.\n`);
          return;
        }
        if (outputFormat !== "table") {
          printRichData(payload, outputFormat);
          return;
        }
        process.stdout.write(`Updated ${key}\n`);
      } catch {
        const mutable = structuredClone(config) as Record<string, unknown>;
        setByPath(mutable, key, value);
        const validated = YxConfigSchema.parse(mutable);
        saveConfig(validated);
        const payload = {
          updated: true,
          key,
        };
        if (options.out) {
          writeRichOutputFile(options.out, renderRichOutput(payload, outputFormat));
          process.stdout.write(`Saved config set output to ${options.out}.\n`);
          return;
        }
        if (outputFormat !== "table") {
          printRichData(payload, outputFormat);
          return;
        }
        process.stdout.write(`Updated ${key}\n`);
      }
    });

  configCommand
    .command("unset")
    .description("Remove one config value by dotted path")
    .argument("<key>", "Dotted key path")
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write config unset output to file")
    .option("--json", "Print raw JSON")
    .action((key: string, options: { format?: string; out?: string; json?: boolean }) => {
      assertSupportedConfigKey(key);
      const outputFormat = normalizeRichOutputFormat(options.format, options.json);
      assertRichOutputFileOption(options.out, outputFormat);
      const config = loadConfig();
      const mutable = structuredClone(config) as Record<string, unknown>;
      unsetByPath(mutable, key);
      const validated = YxConfigSchema.parse(mutable);
      saveConfig(validated);
      const payload = {
        removed: true,
        key,
      };
      if (options.out) {
        writeRichOutputFile(options.out, renderRichOutput(payload, outputFormat));
        process.stdout.write(`Saved config unset output to ${options.out}.\n`);
        return;
      }
      if (outputFormat !== "table") {
        printRichData(payload, outputFormat);
        return;
      }
      process.stdout.write(`Removed ${key}\n`);
    });

  configCommand
    .command("set-api-base-url")
    .description("Set Yunxiao OpenAPI base URL")
    .requiredOption("--url <url>", "API base URL, e.g. https://openapi-rdc.aliyuncs.com")
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write set-api-base-url output to file")
    .option("--json", "Print raw JSON")
    .action((options: { url: string; format?: string; out?: string; json?: boolean }) => {
      const outputFormat = normalizeRichOutputFormat(options.format, options.json);
      assertRichOutputFileOption(options.out, outputFormat);
      JsonStringSchema.parse(options.url);
      const config = loadConfig();
      config.api.baseUrl = options.url;
      saveConfig(config);
      const payload = {
        updated: true,
        key: "api.baseUrl",
        value: options.url,
      };
      if (options.out) {
        writeRichOutputFile(options.out, renderRichOutput(payload, outputFormat));
        process.stdout.write(`Saved set-api-base-url output to ${options.out}.\n`);
        return;
      }
      if (outputFormat !== "table") {
        printRichData(payload, outputFormat);
        return;
      }
      process.stdout.write(`API base URL updated: ${options.url}\n`);
    });
}

function unsetByPath(obj: Record<string, unknown>, dottedPath: string): void {
  const parts = dottedPath.split(".");
  if (parts.length === 0) {
    return;
  }
  let cursor: Record<string, unknown> = obj;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const key = parts[index];
    const next = cursor[key];
    if (typeof next !== "object" || next === null || Array.isArray(next)) {
      return;
    }
    cursor = next as Record<string, unknown>;
  }
  delete cursor[parts[parts.length - 1]];
}

function assertSupportedConfigKey(key?: string): void {
  if (!key) {
    return;
  }
  if (key === "output" || key.startsWith("output.")) {
    throw new CliError("`output.*` config has been removed. Use explicit `--json` when you need JSON output.");
  }
}
