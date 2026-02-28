import { Command } from "commander";
import { parsePositiveIntegerOption } from "../core/utils/options.js";
import { loadConfig } from "../core/config/store.js";
import { withApiClient } from "../core/api/client.js";
import { createPipelineRun, getPipeline, listPipelines, setPipelineEnabled } from "../core/api/pipeline.js";
import { maybeJson } from "../core/utils/json.js";
import {
  assertRichOutputFileOption,
  normalizeRichOutputFormat,
  printRichData,
  renderRichOutput,
  writeRichOutputFile,
} from "../core/output/rich.js";
import { resolveOrganizationId } from "../core/utils/context.js";

export function registerWorkflowCommand(program: Command): void {
  const workflow = program.command("workflow").description("Workflow commands (gh-compatible alias of pipeline)");

  workflow
    .command("list")
    .description("List workflows")
    .option("--org <organizationId>", "Organization ID")
    .option("--name <pipelineName>", "Workflow name")
    .option("--status <statusList>", "Status list, comma-separated")
    .option("--page <number>", "Page number", parsePositiveIntegerOption)
    .option("--per-page <number>", "Items per page", parsePositiveIntegerOption)
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write workflow list output to file")
    .option("--json", "Print raw JSON")
    .action(async (options: WorkflowListOptions) => {
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
        process.stdout.write(`Saved workflow list output to ${options.out}.\n`);
        return;
      }
      printRichData(result, outputFormat);
    });

  workflow
    .command("run")
    .description("Run a workflow")
    .argument("<workflowId>", "Workflow ID (pipeline ID)")
    .option("--org <organizationId>", "Organization ID")
    .option("--ref <branch>", "Git ref/branch (repeatable)", collect, [])
    .option("--params <json>", "Raw params JSON")
    .option("--description <text>", "Run description")
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write workflow run output to file")
    .option("--json", "Print raw JSON")
    .action(async (workflowId: string, options: WorkflowRunOptions) => {
      const config = loadConfig();
      const outputFormat = normalizeRichOutputFormat(options.format, options.json);
      assertRichOutputFileOption(options.out, outputFormat);
      const organizationId = resolveOrganizationId(config, options.org);

      const params = options.params ? maybeJson(options.params) : undefined;
      const result = await withApiClient(config, (client) =>
        createPipelineRun(client, {
          organizationId,
          pipelineId: workflowId,
          params,
          description: options.description,
          branches: options.ref?.length ? options.ref : undefined,
        })
      );

      if (options.out) {
        writeRichOutputFile(options.out, renderRichOutput(result, outputFormat));
        process.stdout.write(`Saved workflow run output to ${options.out}.\n`);
        return;
      }
      printRichData(result, outputFormat);
    });

  workflow
    .command("view")
    .description("View one workflow")
    .argument("<workflowId>", "Workflow ID (pipeline ID)")
    .option("--org <organizationId>", "Organization ID")
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write workflow view output to file")
    .option("--json", "Print raw JSON")
    .action(async (workflowId: string, options: WorkflowViewOptions) => {
      const config = loadConfig();
      const outputFormat = normalizeRichOutputFormat(options.format, options.json);
      assertRichOutputFileOption(options.out, outputFormat);
      const organizationId = resolveOrganizationId(config, options.org);

      const result = await withApiClient(config, (client) =>
        getPipeline(client, {
          organizationId,
          pipelineId: workflowId,
        })
      );

      if (options.out) {
        writeRichOutputFile(options.out, renderRichOutput(result, outputFormat));
        process.stdout.write(`Saved workflow view output to ${options.out}.\n`);
        return;
      }
      printRichData(result, outputFormat);
    });

  workflow
    .command("enable")
    .description("Enable a workflow (gh-like)")
    .argument("<workflowId>", "Workflow ID (pipeline ID)")
    .option("--org <organizationId>", "Organization ID")
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write workflow enable output to file")
    .option("--json", "Print raw JSON")
    .action(async (workflowId: string, options: WorkflowToggleOptions) => {
      const config = loadConfig();
      const outputFormat = normalizeRichOutputFormat(options.format, options.json);
      assertRichOutputFileOption(options.out, outputFormat);
      const organizationId = resolveOrganizationId(config, options.org);

      const result = await withApiClient(config, (client) =>
        setPipelineEnabled(client, {
          organizationId,
          pipelineId: workflowId,
          enabled: true,
        })
      );

      if (options.out) {
        writeRichOutputFile(options.out, renderRichOutput(result, outputFormat));
        process.stdout.write(`Saved workflow enable output to ${options.out}.\n`);
        return;
      }
      printRichData(result, outputFormat);
    });

  workflow
    .command("disable")
    .description("Disable a workflow (gh-like)")
    .argument("<workflowId>", "Workflow ID (pipeline ID)")
    .option("--org <organizationId>", "Organization ID")
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write workflow disable output to file")
    .option("--json", "Print raw JSON")
    .action(async (workflowId: string, options: WorkflowToggleOptions) => {
      const config = loadConfig();
      const outputFormat = normalizeRichOutputFormat(options.format, options.json);
      assertRichOutputFileOption(options.out, outputFormat);
      const organizationId = resolveOrganizationId(config, options.org);

      const result = await withApiClient(config, (client) =>
        setPipelineEnabled(client, {
          organizationId,
          pipelineId: workflowId,
          enabled: false,
        })
      );

      if (options.out) {
        writeRichOutputFile(options.out, renderRichOutput(result, outputFormat));
        process.stdout.write(`Saved workflow disable output to ${options.out}.\n`);
        return;
      }
      printRichData(result, outputFormat);
    });
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

type WorkflowListOptions = {
  org?: string;
  name?: string;
  status?: string;
  page?: number;
  perPage?: number;
  format?: string;
  out?: string;
  json?: boolean;
};

type WorkflowRunOptions = {
  org?: string;
  ref?: string[];
  params?: string;
  description?: string;
  format?: string;
  out?: string;
  json?: boolean;
};

type WorkflowViewOptions = {
  org?: string;
  format?: string;
  out?: string;
  json?: boolean;
};

type WorkflowToggleOptions = {
  org?: string;
  format?: string;
  out?: string;
  json?: boolean;
};
