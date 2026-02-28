import { Command } from "commander";
import { parsePositiveIntegerOption } from "../core/utils/options.js";
import { loadConfig } from "../core/config/store.js";
import { withApiClient } from "../core/api/client.js";
import { createPipelineRun, listPipelineRuns, listPipelines } from "../core/api/pipeline.js";
import { maybeJson } from "../core/utils/json.js";
import {
  assertRichOutputFileOption,
  normalizeRichOutputFormat,
  printRichData,
  renderRichOutput,
  writeRichOutputFile,
} from "../core/output/rich.js";
import { resolveOrganizationId } from "../core/utils/context.js";

export function registerPipelineCommand(program: Command): void {
  const pipeline = program.command("pipeline").description("Pipeline commands");

  pipeline
    .command("list")
    .description("List pipelines")
    .option("--org <organizationId>", "Organization ID")
    .option("--name <pipelineName>", "Pipeline name")
    .option("--status <statusList>", "Status list, comma-separated")
    .option("--page <number>", "Page number", parsePositiveIntegerOption)
    .option("--per-page <number>", "Items per page", parsePositiveIntegerOption)
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write pipeline list output to file")
    .option("--json", "Print raw JSON")
    .action(async (options: PipelineListOptions) => {
      const config = loadConfig();
      const outputFormat = normalizeRichOutputFormat(options.format, options.json);
      assertRichOutputFileOption(options.out, outputFormat);
      const organizationId = resolveOrganizationId(config, options.org);

      const result = await withApiClient(config, (client) =>
        listPipelines(client, {
          organizationId,
          pipelineName: options.name,
          statusList: options.status,
          page: options.page,
          perPage: options.perPage,
        })
      );

      if (options.out) {
        writeRichOutputFile(options.out, renderRichOutput(result, outputFormat));
        process.stdout.write(`Saved pipeline list output to ${options.out}.\n`);
        return;
      }
      printRichData(result, outputFormat);
    });

  pipeline
    .command("runs")
    .description("List pipeline runs")
    .argument("<pipelineId>", "Pipeline ID")
    .option("--org <organizationId>", "Organization ID")
    .option("--page <number>", "Page number", parsePositiveIntegerOption)
    .option("--per-page <number>", "Items per page", parsePositiveIntegerOption)
    .option("--status <status>", "Run status")
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write pipeline runs output to file")
    .option("--json", "Print raw JSON")
    .action(async (pipelineId: string, options: PipelineRunsOptions) => {
      const config = loadConfig();
      const outputFormat = normalizeRichOutputFormat(options.format, options.json);
      assertRichOutputFileOption(options.out, outputFormat);
      const organizationId = resolveOrganizationId(config, options.org);

      const result = await withApiClient(config, (client) =>
        listPipelineRuns(client, {
          organizationId,
          pipelineId,
          page: options.page,
          perPage: options.perPage,
          status: options.status,
        })
      );

      if (options.out) {
        writeRichOutputFile(options.out, renderRichOutput(result, outputFormat));
        process.stdout.write(`Saved pipeline runs output to ${options.out}.\n`);
        return;
      }
      printRichData(result, outputFormat);
    });

  pipeline
    .command("run")
    .description("Trigger a pipeline run")
    .argument("<pipelineId>", "Pipeline ID")
    .option("--org <organizationId>", "Organization ID")
    .option("--params <json>", "Raw params JSON for pipeline run")
    .option("--description <text>", "Natural language description")
    .option("--branch <name>", "Branch, repeatable", collect, [])
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write pipeline run output to file")
    .option("--json", "Print raw JSON")
    .action(async (pipelineId: string, options: PipelineRunOptions) => {
      const config = loadConfig();
      const outputFormat = normalizeRichOutputFormat(options.format, options.json);
      assertRichOutputFileOption(options.out, outputFormat);
      const organizationId = resolveOrganizationId(config, options.org);

      const params = options.params ? maybeJson(options.params) : undefined;
      const result = await withApiClient(config, (client) =>
        createPipelineRun(client, {
          organizationId,
          pipelineId,
          params,
          description: options.description,
          branches: options.branch?.length ? options.branch : undefined,
        })
      );

      if (options.out) {
        writeRichOutputFile(options.out, renderRichOutput(result, outputFormat));
        process.stdout.write(`Saved pipeline run output to ${options.out}.\n`);
        return;
      }
      printRichData(result, outputFormat);
    });
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

type PipelineListOptions = {
  org?: string;
  name?: string;
  status?: string;
  page?: number;
  perPage?: number;
  format?: string;
  out?: string;
  json?: boolean;
};

type PipelineRunsOptions = {
  org?: string;
  page?: number;
  perPage?: number;
  status?: string;
  format?: string;
  out?: string;
  json?: boolean;
};

type PipelineRunOptions = {
  org?: string;
  params?: string;
  description?: string;
  branch?: string[];
  format?: string;
  out?: string;
  json?: boolean;
};
