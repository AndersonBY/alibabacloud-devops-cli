import { Command } from "commander";
import { loadConfig } from "../core/config/store.js";
import { withApiClient, YunxiaoApiClient } from "../core/api/client.js";
import { getRepository } from "../core/api/repo.js";
import { getChangeRequest } from "../core/api/pr.js";
import { getWorkItem } from "../core/api/workitem.js";
import { resolveOrganizationId, resolveRepositoryId } from "../core/utils/context.js";
import {
  assertRichOutputFileOption,
  normalizeRichOutputFormat,
  printRichData,
  renderRichOutput,
  writeRichOutputFile,
} from "../core/output/rich.js";
import { CliError } from "../core/errors.js";
import { openInBrowser } from "../core/utils/browser.js";
import { resolveIssueWebUrl, resolvePullRequestWebUrl, resolveRepositoryWebUrl } from "../core/utils/web-url.js";

export function registerBrowseCommand(program: Command): void {
  const browse = program.command("browse").description("Open repository/PR/issue in browser (gh-like)");

  browse
    .command("open", { isDefault: true })
    .description("Auto target by context (default repo / explicit --repo|--pr|--issue)")
    .option("--org <organizationId>", "Organization ID")
    .option("--repo <repositoryId>", "Repository ID/path for auto target")
    .option("--pr <localId>", "PR local ID for auto target")
    .option("--issue <issueId>", "Issue/workitem ID for auto target")
    .option("--print", "Print URL instead of opening browser", false)
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write browse output to file")
    .option("--json", "Print raw JSON")
    .action(async (options: BrowseAutoOptions) => {
      const config = loadConfig();
      const output = resolveBrowseOutput(options);
      const organizationId = resolveOrganizationId(config, options.org);
      const browseTarget = resolveAutoTarget(config, options);

      const result = await withApiClient(config, (client) => executeBrowseTarget(client, organizationId, browseTarget));
      emitBrowseResult(result, options, output);
    });

  browse
    .command("repo")
    .description("Open repository in browser")
    .argument("<repositoryId>", "Repository ID or path")
    .option("--org <organizationId>", "Organization ID")
    .option("--print", "Print URL instead of opening browser", false)
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write browse repo output to file")
    .option("--json", "Print raw JSON")
    .action(async (repositoryId: string, options: BrowseRepoOptions) => {
      const config = loadConfig();
      const output = resolveBrowseOutput(options);
      const organizationId = resolveOrganizationId(config, options.org);

      const result = await withApiClient(config, (client) =>
        openRepositoryTarget(client, organizationId, repositoryId)
      );

      emitBrowseResult(result, options, output);
    });

  browse
    .command("pr")
    .description("Open pull request in browser")
    .argument("<repositoryId>", "Repository ID or path")
    .argument("<localId>", "Change request local ID")
    .option("--org <organizationId>", "Organization ID")
    .option("--print", "Print URL instead of opening browser", false)
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write browse pr output to file")
    .option("--json", "Print raw JSON")
    .action(async (repositoryId: string, localId: string, options: BrowsePrOptions) => {
      const config = loadConfig();
      const output = resolveBrowseOutput(options);
      const organizationId = resolveOrganizationId(config, options.org);

      const result = await withApiClient(config, (client) =>
        openPullRequestTarget(client, organizationId, repositoryId, localId)
      );

      emitBrowseResult(result, options, output);
    });

  browse
    .command("issue")
    .description("Open issue in browser")
    .argument("<issueId>", "Issue ID (workitem ID)")
    .option("--org <organizationId>", "Organization ID")
    .option("--print", "Print URL instead of opening browser", false)
    .option("--format <format>", "table | tsv | json", "table")
    .option("--out <path>", "Write browse issue output to file")
    .option("--json", "Print raw JSON")
    .action(async (issueId: string, options: BrowseIssueOptions) => {
      const config = loadConfig();
      const output = resolveBrowseOutput(options);
      const organizationId = resolveOrganizationId(config, options.org);

      const result = await withApiClient(config, (client) =>
        openIssueTarget(client, organizationId, issueId)
      );

      emitBrowseResult(result, options, output);
    });
}

async function executeBrowseTarget(
  client: YunxiaoApiClient,
  organizationId: string,
  target: BrowseTarget
): Promise<{ url: string; [key: string]: unknown }> {
  if (target.type === "repo") {
    return openRepositoryTarget(client, organizationId, target.repositoryId);
  }
  if (target.type === "pr") {
    return openPullRequestTarget(client, organizationId, target.repositoryId, target.localId);
  }
  return openIssueTarget(client, organizationId, target.issueId);
}

async function openRepositoryTarget(
  client: YunxiaoApiClient,
  organizationId: string,
  repositoryId: string
): Promise<{ type: "repo"; repositoryId: string; url: string }> {
  const detail = await getRepository(client, {
    organizationId,
    repositoryId,
  });
  const url = resolveRepositoryWebUrl(detail);
  if (!url) {
    throw new CliError("Cannot resolve repository web URL from API response.");
  }
  return {
    type: "repo",
    repositoryId,
    url,
  };
}

async function openPullRequestTarget(
  client: YunxiaoApiClient,
  organizationId: string,
  repositoryId: string,
  localId: string
): Promise<{ type: "pr"; repositoryId: string; localId: string; url: string }> {
  const detail = await getChangeRequest(client, {
    organizationId,
    repositoryId,
    localId,
  });

  let url = resolvePullRequestWebUrl(detail);
  if (!url) {
    const repoDetail = await getRepository(client, {
      organizationId,
      repositoryId,
    });
    const repoUrl = resolveRepositoryWebUrl(repoDetail);
    if (repoUrl) {
      url = resolvePullRequestWebUrl(null, {
        repositoryWebUrl: repoUrl,
        localId,
      });
    }
  }

  if (!url) {
    throw new CliError("Cannot resolve pull request web URL from API response.");
  }

  return {
    type: "pr",
    repositoryId,
    localId,
    url,
  };
}

async function openIssueTarget(
  client: YunxiaoApiClient,
  organizationId: string,
  issueId: string
): Promise<{ type: "issue"; issueId: string; url: string }> {
  const detail = await getWorkItem(client, {
    organizationId,
    workItemId: issueId,
  });
  const url = resolveIssueWebUrl(detail);
  if (!url) {
    throw new CliError("Cannot resolve issue web URL from API response.");
  }
  return {
    type: "issue",
    issueId,
    url,
  };
}

function resolveAutoTarget(config: ReturnType<typeof loadConfig>, options: BrowseAutoOptions): BrowseTarget {
  if (options.issue) {
    return {
      type: "issue",
      issueId: options.issue,
    };
  }

  if (options.pr) {
    const repositoryId = resolveRepositoryId(config, options.repo);
    return {
      type: "pr",
      repositoryId,
      localId: options.pr,
    };
  }

  if (options.repo) {
    return {
      type: "repo",
      repositoryId: options.repo,
    };
  }

  return {
    type: "repo",
    repositoryId: resolveRepositoryId(config),
  };
}

function emitBrowseResult(
  result: {
    url: string;
    [key: string]: unknown;
  },
  options: {
    print?: boolean;
    json?: boolean;
  },
  output: {
    format: "table" | "tsv" | "json";
    out?: string;
  }
): void {
  if (output.out) {
    writeRichOutputFile(output.out, renderRichOutput(result, output.format));
    process.stdout.write(`Saved browse output to ${output.out}.\n`);
    return;
  }

  if (options.print && output.format === "table") {
    process.stdout.write(`${result.url}\n`);
    return;
  }

  if (output.format === "table") {
    openInBrowser(result.url);
  }
  printRichData(
    {
      ...result,
      opened: output.format === "table",
    },
    output.format
  );
}

function resolveBrowseOutput(options: { format?: string; out?: string; json?: boolean }): {
  format: "table" | "tsv" | "json";
  out?: string;
} {
  const format = normalizeRichOutputFormat(options.format, options.json);
  assertRichOutputFileOption(options.out, format);
  return {
    format,
    out: options.out,
  };
}

type BrowseRepoOptions = {
  org?: string;
  print?: boolean;
  format?: string;
  out?: string;
  json?: boolean;
};

type BrowsePrOptions = {
  org?: string;
  print?: boolean;
  format?: string;
  out?: string;
  json?: boolean;
};

type BrowseIssueOptions = {
  org?: string;
  print?: boolean;
  format?: string;
  out?: string;
  json?: boolean;
};

type BrowseAutoOptions = {
  org?: string;
  repo?: string;
  pr?: string;
  issue?: string;
  print?: boolean;
  format?: string;
  out?: string;
  json?: boolean;
};

type BrowseTarget =
  | {
      type: "repo";
      repositoryId: string;
    }
  | {
      type: "pr";
      repositoryId: string;
      localId: string;
    }
  | {
      type: "issue";
      issueId: string;
    };
