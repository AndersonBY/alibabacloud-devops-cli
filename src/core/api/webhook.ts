import { YunxiaoApiClient, encodeRepositoryId } from "./client.js";
import { CliError } from "../errors.js";

type RequestCandidate = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  query?: Record<string, unknown>;
  body?: unknown;
};

export async function listRepositoryWebhooks(client: YunxiaoApiClient, input: {
  organizationId: string;
  repositoryId: string;
  page?: number;
  perPage?: number;
}): Promise<unknown> {
  const encodedRepoId = encodeRepositoryId(input.repositoryId);
  return requestWithFallback(
    client,
    [
      {
        method: "GET",
        path: `/oapi/v1/codeup/organizations/${input.organizationId}/repositories/${encodedRepoId}/webhooks`,
        query: {
          page: input.page,
          perPage: input.perPage,
        },
      },
      {
        method: "GET",
        path: `/repository/${encodedRepoId}/webhooks`,
        query: {
          organizationId: input.organizationId,
          page: input.page,
          perPage: input.perPage,
        },
      },
      {
        method: "GET",
        path: `/repository/${encodedRepoId}/hooks`,
        query: {
          organizationId: input.organizationId,
          page: input.page,
          perPage: input.perPage,
        },
      },
    ],
    `Failed to list webhooks in repository ${input.repositoryId}`
  );
}

export async function getRepositoryWebhook(client: YunxiaoApiClient, input: {
  organizationId: string;
  repositoryId: string;
  hookId: string;
}): Promise<unknown> {
  const encodedRepoId = encodeRepositoryId(input.repositoryId);
  const encodedHookId = encodeURIComponent(input.hookId);
  return requestWithFallback(
    client,
    [
      {
        method: "GET",
        path: `/oapi/v1/codeup/organizations/${input.organizationId}/repositories/${encodedRepoId}/webhooks/${encodedHookId}`,
      },
      {
        method: "GET",
        path: `/repository/${encodedRepoId}/webhooks/${encodedHookId}`,
        query: {
          organizationId: input.organizationId,
        },
      },
      {
        method: "GET",
        path: `/repository/${encodedRepoId}/hooks/${encodedHookId}`,
        query: {
          organizationId: input.organizationId,
        },
      },
    ],
    `Failed to get webhook ${input.hookId} in repository ${input.repositoryId}`
  );
}

export async function createRepositoryWebhook(client: YunxiaoApiClient, input: {
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
        path: `/oapi/v1/codeup/organizations/${input.organizationId}/repositories/${encodedRepoId}/webhooks`,
        body: input.body,
      },
      {
        method: "POST",
        path: `/repository/${encodedRepoId}/webhooks`,
        query: {
          organizationId: input.organizationId,
        },
        body: input.body,
      },
      {
        method: "POST",
        path: `/repository/${encodedRepoId}/hooks`,
        query: {
          organizationId: input.organizationId,
        },
        body: input.body,
      },
    ],
    `Failed to create webhook in repository ${input.repositoryId}`
  );
}

export async function updateRepositoryWebhook(client: YunxiaoApiClient, input: {
  organizationId: string;
  repositoryId: string;
  hookId: string;
  body: Record<string, unknown>;
}): Promise<unknown> {
  const encodedRepoId = encodeRepositoryId(input.repositoryId);
  const encodedHookId = encodeURIComponent(input.hookId);
  return requestWithFallback(
    client,
    [
      {
        method: "PUT",
        path: `/oapi/v1/codeup/organizations/${input.organizationId}/repositories/${encodedRepoId}/webhooks/${encodedHookId}`,
        body: input.body,
      },
      {
        method: "PUT",
        path: `/repository/${encodedRepoId}/webhooks/${encodedHookId}`,
        query: {
          organizationId: input.organizationId,
        },
        body: input.body,
      },
      {
        method: "PUT",
        path: `/repository/${encodedRepoId}/hooks/${encodedHookId}`,
        query: {
          organizationId: input.organizationId,
        },
        body: input.body,
      },
      {
        method: "PATCH",
        path: `/oapi/v1/codeup/organizations/${input.organizationId}/repositories/${encodedRepoId}/webhooks/${encodedHookId}`,
        body: input.body,
      },
    ],
    `Failed to update webhook ${input.hookId} in repository ${input.repositoryId}`
  );
}

export async function deleteRepositoryWebhook(client: YunxiaoApiClient, input: {
  organizationId: string;
  repositoryId: string;
  hookId: string;
}): Promise<unknown> {
  const encodedRepoId = encodeRepositoryId(input.repositoryId);
  const encodedHookId = encodeURIComponent(input.hookId);
  return requestWithFallback(
    client,
    [
      {
        method: "DELETE",
        path: `/oapi/v1/codeup/organizations/${input.organizationId}/repositories/${encodedRepoId}/webhooks/${encodedHookId}`,
      },
      {
        method: "DELETE",
        path: `/repository/${encodedRepoId}/webhooks/${encodedHookId}`,
        query: {
          organizationId: input.organizationId,
        },
      },
      {
        method: "DELETE",
        path: `/repository/${encodedRepoId}/hooks/${encodedHookId}`,
        query: {
          organizationId: input.organizationId,
        },
      },
    ],
    `Failed to delete webhook ${input.hookId} from repository ${input.repositoryId}`
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
