import { Command } from "commander";
import { loadConfig, updateConfig } from "../core/config/store.js";
import { CliError } from "../core/errors.js";
import {
  assertRichOutputFileOption,
  normalizeRichOutputFormat,
  printRichData,
  renderRichOutput,
  writeRichOutputFile,
} from "../core/output/rich.js";
import { expandAliasArgv, tokenizeAliasExpansion, validateAliasName } from "../core/utils/alias.js";

const RESERVED_ALIAS_NAMES = new Set([
  "alias",
  "api",
  "auth",
  "browse",
  "config",
  "doctor",
  "help",
  "issue",
  "label",
  "org",
  "pipeline",
  "pr",
  "repo",
  "release",
  "run",
  "search",
  "secret",
  "status",
  "sprint",
  "test",
  "workitem",
  "workflow",
]);

type AliasListOptions = {
  format?: string;
  out?: string;
  json?: boolean;
};

type AliasSetOptions = {
  format?: string;
  out?: string;
  json?: boolean;
};

type AliasDeleteOptions = {
  format?: string;
  out?: string;
  json?: boolean;
};

export function registerAliasCommand(program: Command): void {
  const alias = program.command("alias").description("Manage command aliases");

  alias
    .command("list")
    .description("List aliases")
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write alias list output to file")
    .option("--json", "Print raw JSON")
    .action((options: AliasListOptions) => {
      const config = loadConfig();
      const outputFormat = normalizeRichOutputFormat(options.format, options.json);
      assertRichOutputFileOption(options.out, outputFormat);
      const aliases = Object.entries(config.aliases)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([name, expansion]) => ({ name, expansion }));
      if (options.out) {
        writeRichOutputFile(options.out, renderRichOutput(aliases, outputFormat));
        process.stdout.write(`Saved alias list output to ${options.out}.\n`);
        return;
      }
      printRichData(aliases, outputFormat);
    });

  alias
    .command("set")
    .description("Create or update an alias")
    .argument("<name>", "Alias name")
    .argument("<expansion...>", "Expansion command")
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write alias set output to file")
    .option("--json", "Print raw JSON")
    .action((name: string, expansionParts: string[], options: AliasSetOptions) => {
      const outputFormat = normalizeRichOutputFormat(options.format, options.json);
      assertRichOutputFileOption(options.out, outputFormat);
      const expansion = expansionParts.join(" ").trim();
      if (!expansion) {
        throw new CliError("Alias expansion cannot be empty.");
      }

      validateAliasName(name, RESERVED_ALIAS_NAMES);
      tokenizeAliasExpansion(expansion);

      const updated = updateConfig((config) => {
        const aliases = {
          ...config.aliases,
          [name]: expansion,
        };
        // Validate recursion using real expansion logic.
        expandAliasArgv([name], aliases);
        return {
          ...config,
          aliases,
        };
      });

      const result = {
        name,
        expansion: updated.aliases[name],
      };
      if (options.out) {
        writeRichOutputFile(options.out, renderRichOutput(result, outputFormat));
        process.stdout.write(`Saved alias set output to ${options.out}.\n`);
        return;
      }
      printRichData(result, outputFormat);
    });

  alias
    .command("delete")
    .description("Delete an alias")
    .argument("<name>", "Alias name")
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write alias delete output to file")
    .option("--json", "Print raw JSON")
    .action((name: string, options: AliasDeleteOptions) => {
      const outputFormat = normalizeRichOutputFormat(options.format, options.json);
      assertRichOutputFileOption(options.out, outputFormat);
      const current = loadConfig();
      if (!current.aliases[name]) {
        throw new CliError(`Alias not found: ${name}`);
      }

      const updated = updateConfig((config) => {
        const aliases = {
          ...config.aliases,
        };
        delete aliases[name];
        return {
          ...config,
          aliases,
        };
      });

      const result = {
        removed: true,
        name,
      };
      if (options.out) {
        writeRichOutputFile(options.out, renderRichOutput(result, outputFormat));
        process.stdout.write(`Saved alias delete output to ${options.out}.\n`);
        return;
      }
      printRichData(result, outputFormat);
    });
}
