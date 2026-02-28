import { YunxiaoApiClient, encodeRepositoryId } from "./client.js";
import { CliError } from "../errors.js";

type RequestCandidate = {
  method: "GET" | "POST";
  path: string;
  query?: Record<string, unknown>;
  body?: unknown;
};

export async function createCheckRun(client: YunxiaoApiClient, input: {
  organizationId: string;
  repositoryId: string;
  body: Record<string, unknown>;
}): Promise<unknown> {
  const encodedRepoId = encodeRepositoryId(input.repositoryId);
  return requestWithFallback(
    client,
    [
      {
        method: "POST",
        path: `/oapi/v1/codeup/organizations/${input.organizationId}/repositories/${encodedRepoId}/checkRuns`,
        body: input.body,
      },
      {
        method: "POST",
        path: `/repository/${encodedRepoId}/checkRuns`,
        query: {
          organizationId: input.organizationId,
        },
        body: input.body,
      },
    ],
    `Failed to create check run in repository ${input.repositoryId}`
  );
}

export async function getCheckRun(client: YunxiaoApiClient, input: {
  organizationId: string;
  repositoryId: string;
  checkRunId: string;
}): Promise<unknown> {
  const encodedRepoId = encodeRepositoryId(input.repositoryId);
  const encodedCheckRunId = encodeURIComponent(input.checkRunId);
  return requestWithFallback(
    client,
    [
      {
        method: "GET",
        path: `/oapi/v1/codeup/organizations/${input.organizationId}/repositories/${encodedRepoId}/checkRuns/${encodedCheckRunId}`,
      },
      {
        method: "GET",
        path: `/repository/${encodedRepoId}/checkRuns/${encodedCheckRunId}`,
        query: {
          organizationId: input.organizationId,
        },
      },
    ],
    `Failed to get check run ${input.checkRunId} in repository ${input.repositoryId}`
  );
}

export async function listCheckRuns(client: YunxiaoApiClient, input: {
  organizationId: string;
  repositoryId: string;
  ref: string;
  page?: number;
  perPage?: number;
}): Promise<unknown> {
  const encodedRepoId = encodeRepositoryId(input.repositoryId);
  return requestWithFallback(
    client,
    [
      {
        method: "GET",
        path: `/oapi/v1/codeup/organizations/${input.organizationId}/repositories/${encodedRepoId}/checkRuns`,
        query: {
          ref: input.ref,
          page: input.page,
          perPage: input.perPage,
        },
      },
      {
        method: "GET",
        path: `/repository/${encodedRepoId}/checkRuns`,
        query: {
          organizationId: input.organizationId,
          ref: input.ref,
          page: input.page,
          perPage: input.perPage,
        },
      },
    ],
    `Failed to list check runs in repository ${input.repositoryId}`
  );
}

export async function updateCheckRun(client: YunxiaoApiClient, input: {
  organizationId: string;
  repositoryId: string;
  checkRunId: string;
  body: Record<string, unknown>;
}): Promise<unknown> {
  const encodedRepoId = encodeRepositoryId(input.repositoryId);
  const encodedCheckRunId = encodeURIComponent(input.checkRunId);
  return requestWithFallback(
    client,
    [
      {
        method: "POST",
        path: `/oapi/v1/codeup/organizations/${input.organizationId}/repositories/${encodedRepoId}/checkRuns/${encodedCheckRunId}`,
        body: input.body,
      },
      {
        method: "POST",
        path: `/repository/${encodedRepoId}/checkRuns/${encodedCheckRunId}`,
        query: {
          organizationId: input.organizationId,
        },
        body: input.body,
      },
    ],
    `Failed to update check run ${input.checkRunId} in repository ${input.repositoryId}`
  );
}

async function requestWithFallback(
  client: YunxiaoApiClient,
  candidates: RequestCandidate[],
  failureMessage: string
): Promise<unknown> {
  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      return await client.request(candidate.path, {
        method: candidate.method,
        query: candidate.query,
        body: candidate.body,
      });
    } catch (error) {
      if (!shouldTryNextCandidate(error)) {
        throw error;
      }
      lastError = error;
    }
  }

  const suffix = lastError instanceof Error ? ` Last error: ${lastError.message}` : "";
  throw new CliError(`${failureMessage}.${suffix}`);
}

function shouldTryNextCandidate(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message ?? "";
  if (message.includes("Yunxiao API returned HTML document unexpectedly")) {
    return true;
  }

  return /Yunxiao API (404|405):/.test(message);
}
