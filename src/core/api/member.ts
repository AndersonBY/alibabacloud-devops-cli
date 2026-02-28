import { YunxiaoApiClient, encodeRepositoryId } from "./client.js";
import { CliError } from "../errors.js";

type RequestCandidate = {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  query?: Record<string, unknown>;
};

export async function listGroupMembers(client: YunxiaoApiClient, input: {
  organizationId: string;
  groupId: string;
  accessLevel?: number;
}): Promise<unknown> {
  const encodedGroupId = encodeRepositoryId(input.groupId);
  return requestWithFallback(
    client,
    [
      {
        method: "GET",
        path: `/oapi/v1/codeup/organizations/${input.organizationId}/groups/${encodedGroupId}/members`,
        query: {
          accessLevel: input.accessLevel,
        },
      },
      {
        method: "GET",
        path: `/groups/${encodedGroupId}/members`,
        query: {
          organizationId: input.organizationId,
          accessLevel: input.accessLevel,
        },
      },
    ],
    `Failed to list members of group ${input.groupId}`
  );
}

export async function listRepositoryMembers(client: YunxiaoApiClient, input: {
  organizationId: string;
  repositoryId: string;
  accessLevel?: number;
}): Promise<unknown> {
  const encodedRepoId = encodeRepositoryId(input.repositoryId);
  return requestWithFallback(
    client,
    [
      {
        method: "GET",
        path: `/oapi/v1/codeup/organizations/${input.organizationId}/repositories/${encodedRepoId}/members`,
        query: {
          accessLevel: input.accessLevel,
        },
      },
      {
        method: "GET",
        path: `/repository/${encodedRepoId}/members`,
        query: {
          organizationId: input.organizationId,
          accessLevel: input.accessLevel,
        },
      },
    ],
    `Failed to list members of repository ${input.repositoryId}`
  );
}

export async function createGroupMember(client: YunxiaoApiClient, input: {
  organizationId: string;
  groupId: string;
  accessLevel: number;
  userId: string;
  expiresAt?: string;
}): Promise<unknown> {
  const encodedGroupId = encodeRepositoryId(input.groupId);
  return requestWithFallback(
    client,
    [
      {
        method: "POST",
        path: `/oapi/v1/codeup/organizations/${input.organizationId}/groups/${encodedGroupId}/members`,
        query: {
          accessLevel: input.accessLevel,
          userId: input.userId,
          expiresAt: input.expiresAt,
        },
      },
      {
        method: "POST",
        path: `/groups/${encodedGroupId}/members`,
        query: {
          organizationId: input.organizationId,
          accessLevel: input.accessLevel,
          userId: input.userId,
          expiresAt: input.expiresAt,
        },
      },
    ],
    `Failed to add members to group ${input.groupId}`
  );
}

export async function createRepositoryMember(client: YunxiaoApiClient, input: {
  organizationId: string;
  repositoryId: string;
  accessLevel: number;
  userId: string;
  expiresAt?: string;
}): Promise<unknown> {
  const encodedRepoId = encodeRepositoryId(input.repositoryId);
  return requestWithFallback(
    client,
    [
      {
        method: "POST",
        path: `/oapi/v1/codeup/organizations/${input.organizationId}/repositories/${encodedRepoId}/members`,
        query: {
          accessLevel: input.accessLevel,
          userId: input.userId,
          expiresAt: input.expiresAt,
        },
      },
      {
        method: "POST",
        path: `/repository/${encodedRepoId}/members`,
        query: {
          organizationId: input.organizationId,
          accessLevel: input.accessLevel,
          userId: input.userId,
          expiresAt: input.expiresAt,
        },
      },
    ],
    `Failed to add members to repository ${input.repositoryId}`
  );
}

export async function updateGroupMember(client: YunxiaoApiClient, input: {
  organizationId: string;
  groupId: string;
  userId: string;
  accessLevel: number;
  expiresAt?: string;
}): Promise<unknown> {
  const encodedGroupId = encodeRepositoryId(input.groupId);
  const encodedUserId = encodeURIComponent(input.userId);
  return requestWithFallback(
    client,
    [
      {
        method: "PUT",
        path: `/oapi/v1/codeup/organizations/${input.organizationId}/groups/${encodedGroupId}/members/${encodedUserId}`,
        query: {
          accessLevel: input.accessLevel,
          expiresAt: input.expiresAt,
        },
      },
      {
        method: "PUT",
        path: `/groups/${encodedGroupId}/members/${encodedUserId}`,
        query: {
          organizationId: input.organizationId,
          accessLevel: input.accessLevel,
          expiresAt: input.expiresAt,
        },
      },
    ],
    `Failed to update member ${input.userId} in group ${input.groupId}`
  );
}

export async function updateRepositoryMember(client: YunxiaoApiClient, input: {
  organizationId: string;
  repositoryId: string;
  userId: string;
  accessLevel: number;
  expiresAt?: string;
}): Promise<unknown> {
  const encodedRepoId = encodeRepositoryId(input.repositoryId);
  const encodedUserId = encodeURIComponent(input.userId);
  return requestWithFallback(
    client,
    [
      {
        method: "PUT",
        path: `/oapi/v1/codeup/organizations/${input.organizationId}/repositories/${encodedRepoId}/members/${encodedUserId}`,
        query: {
          accessLevel: input.accessLevel,
          expiresAt: input.expiresAt,
        },
      },
      {
        method: "PUT",
        path: `/repository/${encodedRepoId}/members/${encodedUserId}`,
        query: {
          organizationId: input.organizationId,
          accessLevel: input.accessLevel,
          expiresAt: input.expiresAt,
        },
      },
    ],
    `Failed to update member ${input.userId} in repository ${input.repositoryId}`
  );
}

export async function deleteGroupMember(client: YunxiaoApiClient, input: {
  organizationId: string;
  groupId: string;
  userId: string;
}): Promise<unknown> {
  const encodedGroupId = encodeRepositoryId(input.groupId);
  const encodedUserId = encodeURIComponent(input.userId);
  return requestWithFallback(
    client,
    [
      {
        method: "DELETE",
        path: `/oapi/v1/codeup/organizations/${input.organizationId}/groups/${encodedGroupId}/members/${encodedUserId}`,
      },
      {
        method: "DELETE",
        path: `/groups/${encodedGroupId}/members/${encodedUserId}`,
        query: {
          organizationId: input.organizationId,
        },
      },
    ],
    `Failed to delete member ${input.userId} from group ${input.groupId}`
  );
}

export async function deleteRepositoryMember(client: YunxiaoApiClient, input: {
  organizationId: string;
  repositoryId: string;
  userId: string;
}): Promise<unknown> {
  const encodedRepoId = encodeRepositoryId(input.repositoryId);
  const encodedUserId = encodeURIComponent(input.userId);
  return requestWithFallback(
    client,
    [
      {
        method: "DELETE",
        path: `/oapi/v1/codeup/organizations/${input.organizationId}/repositories/${encodedRepoId}/members/${encodedUserId}`,
      },
      {
        method: "DELETE",
        path: `/repository/${encodedRepoId}/members/${encodedUserId}`,
        query: {
          organizationId: input.organizationId,
        },
      },
    ],
    `Failed to delete member ${input.userId} from repository ${input.repositoryId}`
  );
}

export async function getMemberHttpsCloneUsername(client: YunxiaoApiClient, input: {
  organizationId: string;
  userId: string;
}): Promise<unknown> {
  const encodedUserId = encodeURIComponent(input.userId);
  return requestWithFallback(
    client,
    [
      {
        method: "GET",
        path: `/oapi/v1/codeup/organizations/${input.organizationId}/users/${encodedUserId}/httpsCloneUsername`,
      },
      {
        method: "GET",
        path: `/users/${encodedUserId}/httpsCloneUsername`,
        query: {
          organizationId: input.organizationId,
        },
      },
    ],
    `Failed to get https clone username for user ${input.userId}`
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
      });
    } catch (error) {
      lastError = error;
    }
  }

  const suffix = lastError instanceof Error ? ` Last error: ${lastError.message}` : "";
  throw new CliError(`${failureMessage}.${suffix}`);
}
