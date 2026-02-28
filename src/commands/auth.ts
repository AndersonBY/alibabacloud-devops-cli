import { Command } from "commander";
import { getConfigPath, loadConfig, maskToken, saveConfig } from "../core/config/store.js";
import {
  assertRichOutputFileOption,
  normalizeRichOutputFormat,
  printRichData,
  renderRichOutput,
  writeRichOutputFile,
} from "../core/output/rich.js";

export function registerAuthCommand(program: Command): void {
  const auth = program.command("auth").description("Manage Yunxiao authentication for yx");

  auth
    .command("login")
    .description("Save Yunxiao personal access token")
    .requiredOption("--token <token>", "Yunxiao PAT token")
    .option("--org <organizationId>", "Default organization ID")
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write auth login output to file")
    .option("--json", "Print raw JSON")
    .action((options: { token: string; org?: string; format?: string; out?: string; json?: boolean }) => {
      const config = loadConfig();
      const outputFormat = normalizeRichOutputFormat(options.format, options.json);
      assertRichOutputFileOption(options.out, outputFormat);
      config.auth.token = options.token;
      if (options.org) {
        config.defaults.organizationId = options.org;
      }
      saveConfig(config);

      const payload = {
        saved: true,
        configPath: getConfigPath(),
        token: maskToken(config.auth.token),
        defaults: {
          organizationId: config.defaults.organizationId ?? null,
        },
      };
      if (options.out) {
        writeRichOutputFile(options.out, renderRichOutput(payload, outputFormat));
        process.stdout.write(`Saved auth login output to ${options.out}.\n`);
        return;
      }
      if (outputFormat !== "table") {
        printRichData(payload, outputFormat);
        return;
      }

      process.stdout.write("Token saved to ~/.yx/config.json\n");
      if (options.org) {
        process.stdout.write(`Default organization: ${options.org}\n`);
      }
    });

  auth
    .command("status")
    .description("Show auth status")
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write auth status output to file")
    .option("--json", "Print raw JSON")
    .action((options: { format?: string; out?: string; json?: boolean }) => {
      const config = loadConfig();
      const outputFormat = normalizeRichOutputFormat(options.format, options.json);
      assertRichOutputFileOption(options.out, outputFormat);
      const payload = {
        token: maskToken(config.auth.token),
        hasToken: Boolean(config.auth.token),
        defaults: {
          organizationId: config.defaults.organizationId ?? null,
          projectId: config.defaults.projectId ?? null,
          repositoryId: config.defaults.repositoryId ?? null,
        },
        api: {
          baseUrl: config.api.baseUrl,
          timeoutMs: config.api.timeoutMs,
        },
      };
      if (options.out) {
        writeRichOutputFile(options.out, renderRichOutput(payload, outputFormat));
        process.stdout.write(`Saved auth status output to ${options.out}.\n`);
        return;
      }
      if (outputFormat !== "table") {
        printRichData(payload, outputFormat);
        return;
      }
      process.stdout.write(`Token: ${maskToken(config.auth.token)}\n`);
      process.stdout.write(`Default organization: ${config.defaults.organizationId ?? "(not set)"}\n`);
      process.stdout.write(`Default project: ${config.defaults.projectId ?? "(not set)"}\n`);
      process.stdout.write(`Default repository: ${config.defaults.repositoryId ?? "(not set)"}\n`);
      process.stdout.write(`API base URL: ${config.api.baseUrl}\n`);
    });

  auth
    .command("logout")
    .description("Remove saved token")
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write auth logout output to file")
    .option("--json", "Print raw JSON")
    .action((options: { format?: string; out?: string; json?: boolean }) => {
      const config = loadConfig();
      const outputFormat = normalizeRichOutputFormat(options.format, options.json);
      assertRichOutputFileOption(options.out, outputFormat);
      const hadToken = Boolean(config.auth.token);
      delete config.auth.token;
      saveConfig(config);

      const payload = {
        removed: true,
        hadToken,
        configPath: getConfigPath(),
      };
      if (options.out) {
        writeRichOutputFile(options.out, renderRichOutput(payload, outputFormat));
        process.stdout.write(`Saved auth logout output to ${options.out}.\n`);
        return;
      }
      if (outputFormat !== "table") {
        printRichData(payload, outputFormat);
        return;
      }

      process.stdout.write("Token removed from ~/.yx/config.json\n");
    });
}
