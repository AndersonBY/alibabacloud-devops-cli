#!/usr/bin/env node
import { Command } from "commander";
import { registerAuthCommand } from "./commands/auth.js";
import { registerConfigCommand } from "./commands/config.js";
import { registerApiCommand } from "./commands/api.js";
import { registerRepoCommand } from "./commands/repo.js";
import { registerPrCommand } from "./commands/pr.js";
import { registerPipelineCommand } from "./commands/pipeline.js";
import { registerOrgCommand } from "./commands/org.js";
import { registerWorkitemCommand } from "./commands/workitem.js";
import { registerIssueCommand } from "./commands/issue.js";
import { registerTestCommand } from "./commands/test.js";
import { registerWorkflowCommand } from "./commands/workflow.js";
import { registerRunCommand } from "./commands/run.js";
import { registerSearchCommand } from "./commands/search.js";
import { registerStatusCommand } from "./commands/status.js";
import { registerLabelCommand } from "./commands/label.js";
import { registerBrowseCommand } from "./commands/browse.js";
import { registerDoctorCommand } from "./commands/doctor.js";
import { registerAliasCommand } from "./commands/alias.js";
import { registerReleaseCommand } from "./commands/release.js";
import { registerSecretCommand } from "./commands/secret.js";
import { registerCompletionCommand } from "./commands/completion.js";
import { registerMilestoneCommand } from "./commands/milestone.js";
import { registerSprintCommand } from "./commands/sprint.js";
import { registerVersionCommand } from "./commands/version.js";
import { CliError } from "./core/errors.js";
import { loadConfig } from "./core/config/store.js";
import { expandAliasArgv } from "./core/utils/alias.js";

const BUILTIN_TOP_LEVEL_COMMANDS = new Set([
  "alias",
  "api",
  "auth",
  "browse",
  "completion",
  "config",
  "doctor",
  "help",
  "issue",
  "label",
  "milestone",
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
  "version",
  "workitem",
  "workflow",
]);

const program = new Command();

program
  .name("yx")
  .description("Yunxiao CLI (yx) - gh style command experience powered by OpenAPI")
  .version("0.1.0");

registerAuthCommand(program);
registerConfigCommand(program);
registerApiCommand(program);
registerRepoCommand(program);
registerPrCommand(program);
registerPipelineCommand(program);
registerOrgCommand(program);
registerWorkitemCommand(program);
registerIssueCommand(program);
registerTestCommand(program);
registerWorkflowCommand(program);
registerRunCommand(program);
registerSearchCommand(program);
registerStatusCommand(program);
registerLabelCommand(program);
registerBrowseCommand(program);
registerDoctorCommand(program);
registerAliasCommand(program);
registerReleaseCommand(program);
registerSecretCommand(program);
registerCompletionCommand(program);
registerMilestoneCommand(program);
registerSprintCommand(program);
registerVersionCommand(program);

const expandedArgv = resolveExpandedArgv(process.argv.slice(2));
program.parseAsync(["node", "yx", ...expandedArgv]).catch((error: unknown) => {
  if (error instanceof CliError) {
    process.stderr.write(`Error: ${error.message}\n`);
    process.exit(1);
  }

  if (error instanceof Error) {
    process.stderr.write(`Error: ${error.message}\n`);
    process.exit(1);
  }

  process.stderr.write(`Error: ${String(error)}\n`);
  process.exit(1);
});

function resolveExpandedArgv(argv: string[]): string[] {
  try {
    if (argv.length === 0 || argv[0] === "__complete" || BUILTIN_TOP_LEVEL_COMMANDS.has(argv[0])) {
      return argv;
    }
    const config = loadConfig();
    return expandAliasArgv(argv, config.aliases ?? {});
  } catch (error) {
    if (error instanceof CliError) {
      process.stderr.write(`Error: ${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }
}
