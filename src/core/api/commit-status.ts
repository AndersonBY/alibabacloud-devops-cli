import { YunxiaoApiClient, encodeRepositoryId } from "./client.js";
import { CliError } from "../errors.js";

type RequestCandidate = {
  method: "GET" | "POST";
  path: string;
  query?: Record<string, unknown>;
  body?: unknown;
};

export async function createCommitStatus(client: YunxiaoApiClient, input: {
  organizationId: string;
  repositoryId: string;
  sha: string;
  body: Record<string, unknown>;
}): Promise<unknown> {
  const encodedRepoId = encodeRepositoryId(input.repositoryId);
  const encodedSha = encodeURIComponent(input.sha);

  return requestWithFallback(
    client,
    [
      {
        method: "POST",
        path: `/oapi/v1/codeup/organizations/${input.organizationId}/repositories/${encodedRepoId}/commits/${encodedSha}/statuses`,
        body: input.body,
      },
      {
        method: "POST",
        path: `/repository/${encodedRepoId}/commits/${encodedSha}/statuses`,
        query: {
          organizationId: input.organizationId,
        },
        body: input.body,
      },
    ],
    `Failed to create commit status for ${input.sha} in repository ${input.repositoryId}`
  );
}

export async function listCommitStatuses(client: YunxiaoApiClient, input: {
  organizationId: string;
  repositoryId: string;
  sha: string;
  page?: number;
  perPage?: number;
}): Promise<unknown> {
  const encodedRepoId = encodeRepositoryId(input.repositoryId);
  const encodedSha = encodeURIComponent(input.sha);

  return requestWithFallback(
    client,
    [
      {
        method: "GET",
        path: `/oapi/v1/codeup/organizations/${input.organizationId}/repositories/${encodedRepoId}/commits/${encodedSha}/statuses`,
        query: {
          page: input.page,
          perPage: input.perPage,
        },
      },
      {
        method: "GET",
        path: `/repository/${encodedRepoId}/commits/${encodedSha}/statuses`,
        query: {
          organizationId: input.organizationId,
          page: input.page,
          perPage: input.perPage,
        },
      },
    ],
    `Failed to list commit statuses for ${input.sha} in repository ${input.repositoryId}`
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
      lastError = error;
    }
  }

  const suffix = lastError instanceof Error ? ` Last error: ${lastError.message}` : "";
  throw new CliError(`${failureMessage}.${suffix}`);
}
