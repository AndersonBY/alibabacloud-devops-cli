export function resolveRepositoryWebUrl(response: unknown): string | undefined {
  const repo = extractPrimaryRecord(response);
  if (!repo) {
    return undefined;
  }

  const direct = readStringIn(repo, ["webUrl", "web_url", "url", "httpUrlToRepo", "http_url_to_repo"]);
  if (!direct) {
    return undefined;
  }

  return direct.endsWith(".git") ? direct.slice(0, -4) : direct;
}

export function resolvePullRequestWebUrl(response: unknown, input?: {
  repositoryWebUrl?: string;
  localId?: string;
}): string | undefined {
  const pr = extractPrimaryRecord(response);
  if (pr) {
    const direct = readStringIn(pr, ["detailUrl", "link", "webUrl", "web_url", "url"]);
    if (direct) {
      return direct;
    }
  }

  if (!input?.repositoryWebUrl || !input.localId) {
    return undefined;
  }
  return buildPullRequestUrlFromRepo(input.repositoryWebUrl, input.localId);
}

export function resolveIssueWebUrl(response: unknown): string | undefined {
  const issue = extractPrimaryRecord(response);
  if (!issue) {
    return undefined;
  }

  return readStringIn(issue, ["webUrl", "web_url", "url", "detailUrl", "workItemUrl", "link"]);
}

function extractPrimaryRecord(response: unknown): Record<string, unknown> | undefined {
  if (!isRecord(response)) {
    return undefined;
  }

  for (const key of ["result", "data", "body"]) {
    const value = response[key];
    if (isRecord(value)) {
      return value;
    }
  }
  return response;
}

function readStringIn(input: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function buildPullRequestUrlFromRepo(repositoryWebUrl: string, localId: string): string {
  const normalizedRepoUrl = repositoryWebUrl.replace(/\/+$/, "");
  if (normalizedRepoUrl.includes("codeup.aliyun.com")) {
    return `${normalizedRepoUrl}/change/${localId}`;
  }
  return `${normalizedRepoUrl}/-/merge_requests/${localId}`;
}
