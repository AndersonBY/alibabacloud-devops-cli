import { Command } from "commander";
import { parsePositiveIntegerOption } from "../core/utils/options.js";
import { loadConfig } from "../core/config/store.js";
import { withApiClient } from "../core/api/client.js";
import { getTestCase, listTestCases, listTestPlans, listTestResults } from "../core/api/test.js";
import {
  assertRichOutputFileOption,
  normalizeRichOutputFormat,
  printRichData,
  renderRichOutput,
  writeRichOutputFile,
} from "../core/output/rich.js";
import { resolveOrganizationId } from "../core/utils/context.js";

export function registerTestCommand(program: Command): void {
  const test = program.command("test").description("Test management commands");

  test
    .command("plans")
    .description("List test plans")
    .option("--org <organizationId>", "Organization ID")
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write test plans output to file")
    .option("--json", "Print raw JSON")
    .action(async (options: TestPlansOptions) => {
      const config = loadConfig();
      const outputFormat = normalizeRichOutputFormat(options.format, options.json);
      assertRichOutputFileOption(options.out, outputFormat);
      const organizationId = resolveOrganizationId(config, options.org);

      const result = await withApiClient(config, (client) =>
        listTestPlans(client, {
          organizationId,
        })
      );

      if (options.out) {
        writeRichOutputFile(options.out, renderRichOutput(result, outputFormat));
        process.stdout.write(`Saved test plans output to ${options.out}.\n`);
        return;
      }
      printRichData(result, outputFormat);
    });

  test
    .command("results")
    .description("List test results in one test plan directory")
    .argument("<testPlanId>", "Test plan identifier")
    .argument("<directoryId>", "Directory identifier")
    .option("--org <organizationId>", "Organization ID")
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write test results output to file")
    .option("--json", "Print raw JSON")
    .action(async (testPlanId: string, directoryId: string, options: TestResultsOptions) => {
      const config = loadConfig();
      const outputFormat = normalizeRichOutputFormat(options.format, options.json);
      assertRichOutputFileOption(options.out, outputFormat);
      const organizationId = resolveOrganizationId(config, options.org);

      const result = await withApiClient(config, (client) =>
        listTestResults(client, {
          organizationId,
          testPlanIdentifier: testPlanId,
          directoryIdentifier: directoryId,
        })
      );

      if (options.out) {
        writeRichOutputFile(options.out, renderRichOutput(result, outputFormat));
        process.stdout.write(`Saved test results output to ${options.out}.\n`);
        return;
      }
      printRichData(result, outputFormat);
    });

  test
    .command("cases")
    .description("List test cases by test repo")
    .requiredOption("--repo <testRepoId>", "Test repo ID")
    .option("--org <organizationId>", "Organization ID")
    .option("--page <number>", "Page number", parsePositiveIntegerOption)
    .option("--per-page <number>", "Items per page", parsePositiveIntegerOption)
    .option("--order-by <field>", "Order field, e.g. gmtCreate|name", "gmtCreate")
    .option("--sort <direction>", "asc | desc", "desc")
    .option("--directory <directoryId>", "Directory ID")
    .option("--conditions <json>", "Conditions JSON string")
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write test cases output to file")
    .option("--json", "Print raw JSON")
    .action(async (options: TestCasesOptions) => {
      const config = loadConfig();
      const outputFormat = normalizeRichOutputFormat(options.format, options.json);
      assertRichOutputFileOption(options.out, outputFormat);
      const organizationId = resolveOrganizationId(config, options.org);

      const result = await withApiClient(config, (client) =>
        listTestCases(client, {
          organizationId,
          testRepoId: options.repo,
          page: options.page,
          perPage: options.perPage,
          orderBy: options.orderBy,
          sort: options.sort,
          directoryId: options.directory,
          conditions: options.conditions,
        })
      );

      if (options.out) {
        writeRichOutputFile(options.out, renderRichOutput(result, outputFormat));
        process.stdout.write(`Saved test cases output to ${options.out}.\n`);
        return;
      }
      printRichData(result, outputFormat);
    });

  test
    .command("case")
    .description("Show one test case")
    .argument("<testRepoId>", "Test repo ID")
    .argument("<testcaseId>", "Test case ID")
    .option("--org <organizationId>", "Organization ID")
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write test case output to file")
    .option("--json", "Print raw JSON")
    .action(async (testRepoId: string, testcaseId: string, options: TestCaseOptions) => {
      const config = loadConfig();
      const outputFormat = normalizeRichOutputFormat(options.format, options.json);
      assertRichOutputFileOption(options.out, outputFormat);
      const organizationId = resolveOrganizationId(config, options.org);

      const result = await withApiClient(config, (client) =>
        getTestCase(client, {
          organizationId,
          testRepoId,
          testcaseId,
        })
      );

      if (options.out) {
        writeRichOutputFile(options.out, renderRichOutput(result, outputFormat));
        process.stdout.write(`Saved test case output to ${options.out}.\n`);
        return;
      }
      printRichData(result, outputFormat);
    });
}

type TestPlansOptions = {
  org?: string;
  format?: string;
  out?: string;
  json?: boolean;
};

type TestResultsOptions = {
  org?: string;
  format?: string;
  out?: string;
  json?: boolean;
};

type TestCasesOptions = {
  org?: string;
  repo: string;
  page?: number;
  perPage?: number;
  orderBy?: string;
  sort?: string;
  directory?: string;
  conditions?: string;
  format?: string;
  out?: string;
  json?: boolean;
};

type TestCaseOptions = {
  org?: string;
  format?: string;
  out?: string;
  json?: boolean;
};
