import { YunxiaoApiClient, encodeRepositoryId } from "./client.js";
import { CliError } from "../errors.js";

type RequestCandidate = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  query?: Record<string, unknown>;
  body?: unknown;
};

export async function listRepositories(client: YunxiaoApiClient, input: {
  organizationId: string;
  page?: number;
  perPage?: number;
  orderBy?: string;
  sort?: string;
  search?: string;
  archived?: boolean;
}): Promise<unknown> {
  return client.get(`/oapi/v1/codeup/organizations/${input.organizationId}/repositories`, {
    page: input.page,
    perPage: input.perPage,
    orderBy: input.orderBy,
    sort: input.sort,
    search: input.search,
    archived: input.archived,
  });
}

export async function getRepository(client: YunxiaoApiClient, input: {
  organizationId: string;
  repositoryId: string;
}): Promise<unknown> {
  const encodedId = encodeRepositoryId(input.repositoryId);
  return client.get(`/oapi/v1/codeup/organizations/${input.organizationId}/repositories/${encodedId}`);
}

export async function createRepository(client: YunxiaoApiClient, input: {
  organizationId: string;
  name: string;
  path?: string;
  description?: string;
  visibilityLevel?: number;
  readmeType?: string;
  gitignoreType?: string;
  importDemoProject?: boolean;
}): Promise<unknown> {
  const baseBody = {
    name: input.name,
    path: input.path,
    description: input.description,
    visibilityLevel: input.visibilityLevel,
    readmeType: input.readmeType,
    gitignoreType: input.gitignoreType,
    importDemoProject: input.importDemoProject,
  };
  const query = {
    organizationId: input.organizationId,
  };

  const bodyVariants: Array<Record<string, unknown>> = [baseBody];
  if (typeof input.readmeType === "string" && input.readmeType.trim()) {
    bodyVariants.push({
      ...baseBody,
      readmeType: "default",
    });
    bodyVariants.push(
      Object.fromEntries(
        Object.entries(baseBody).filter(([key]) => key !== "readmeType")
      )
    );
  }

  let lastError: unknown;
  for (const body of bodyVariants) {
    const candidates: Array<{ path: string; query?: Record<string, unknown>; body?: unknown }> = [
      {
        path: `/oapi/v1/codeup/organizations/${input.organizationId}/repositories`,
        body,
      },
      {
        path: `/repository/create`,
        query,
        body,
      },
    ];

    for (const candidate of candidates) {
      try {
        return await client.request(candidate.path, {
          method: "POST",
          query: candidate.query,
          body: candidate.body,
        });
      } catch (error) {
        lastError = error;
      }
    }
  }

  const suffix = lastError instanceof Error ? ` Last error: ${lastError.message}` : "";
  throw new CliError(`Failed to create repository ${input.name}.${suffix}`);
}

export async function updateRepository(client: YunxiaoApiClient, input: {
  organizationId: string;
  repositoryId: string;
  name?: string;
  path?: string;
  description?: string;
  defaultBranch?: string;
  visibilityLevel?: number;
}): Promise<unknown> {
  const encodedId = encodeRepositoryId(input.repositoryId);
  const body = {
    name: input.name,
    path: input.path,
    description: input.description,
    defaultBranch: input.defaultBranch,
    visibilityLevel: input.visibilityLevel,
  };
  const query = {
    organizationId: input.organizationId,
  };

  const candidates: Array<{ method: "PUT" | "PATCH"; path: string; query?: Record<string, unknown>; body?: unknown }> = [
    {
      method: "PUT",
      path: `/oapi/v1/codeup/organizations/${input.organizationId}/repositories/${encodedId}`,
      body,
    },
    {
      method: "PATCH",
      path: `/oapi/v1/codeup/organizations/${input.organizationId}/repositories/${encodedId}`,
      body,
    },
    {
      method: "PUT",
      path: `/repository/${encodedId}`,
      query,
      body,
    },
  ];

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
  throw new CliError(`Failed to update repository ${input.repositoryId}.${suffix}`);
}

export async function deleteRepository(client: YunxiaoApiClient, input: {
  organizationId: string;
  repositoryId: string;
  reason?: string;
}): Promise<unknown> {
  const encodedId = encodeRepositoryId(input.repositoryId);
  const query = {
    organizationId: input.organizationId,
  };
  const body = {
    reason: input.reason,
  };

  const candidates: Array<{ method: "DELETE" | "POST"; path: string; query?: Record<string, unknown>; body?: unknown }> = [
    {
      method: "DELETE",
      path: `/oapi/v1/codeup/organizations/${input.organizationId}/repositories/${encodedId}`,
    },
    {
      method: "POST",
      path: `/oapi/v1/codeup/organizations/${input.organizationId}/repositories/${encodedId}/remove`,
      body,
    },
    {
      method: "POST",
      path: `/repository/${encodedId}/remove`,
      query,
      body,
    },
  ];

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
  throw new CliError(`Failed to delete repository ${input.repositoryId}.${suffix}`);
}

export async function listRepositoryBranches(client: YunxiaoApiClient, input: {
  organizationId: string;
  repositoryId: string;
  page?: number;
  perPage?: number;
  sort?: string;
  search?: string;
}): Promise<unknown> {
  const encodedRepoId = encodeRepositoryId(input.repositoryId);
  return requestWithFallback(
    client,
    [
      {
        method: "GET",
        path: `/oapi/v1/codeup/organizations/${input.organizationId}/repositories/${encodedRepoId}/branches`,
        query: {
          page: input.page,
          perPage: input.perPage,
          sort: input.sort,
          search: input.search,
        },
      },
      {
        method: "GET",
        path: `/repository/${encodedRepoId}/branches`,
        query: {
          organizationId: input.organizationId,
          page: input.page,
          pageSize: input.perPage,
          sort: input.sort,
          search: input.search,
        },
      },
    ],
    `Failed to list branches for repository ${input.repositoryId}`
  );
}

export async function createRepositoryBranch(client: YunxiaoApiClient, input: {
  organizationId: string;
  repositoryId: string;
  branch: string;
  ref?: string;
}): Promise<unknown> {
  const encodedRepoId = encodeRepositoryId(input.repositoryId);
  return requestWithFallback(
    client,
    [
      {
        method: "POST",
        path: `/repository/${encodedRepoId}/branches`,
        query: {
          organizationId: input.organizationId,
        },
        body: {
          branchName: input.branch,
          ref: input.ref,
        },
      },
      {
        method: "POST",
        path: `/oapi/v1/codeup/organizations/${input.organizationId}/repositories/${encodedRepoId}/branches`,
        body: {
          branch: input.branch,
          ref: input.ref,
        },
      },
      {
        method: "POST",
        path: `/oapi/v1/codeup/organizations/${input.organizationId}/repositories/${encodedRepoId}/branches`,
        query: {
          branch: input.branch,
          ref: input.ref,
        },
      },
    ],
    `Failed to create branch ${input.branch} in repository ${input.repositoryId}`
  );
}

export async function deleteRepositoryBranch(client: YunxiaoApiClient, input: {
  organizationId: string;
  repositoryId: string;
  branch: string;
}): Promise<unknown> {
  const encodedRepoId = encodeRepositoryId(input.repositoryId);
  const encodedBranch = encodeURIComponent(input.branch);
  return requestWithFallback(
    client,
    [
      {
        method: "DELETE",
        path: `/repository/${encodedRepoId}/branches/delete`,
        query: {
          organizationId: input.organizationId,
          branchName: input.branch,
        },
      },
      {
        method: "DELETE",
        path: `/oapi/v1/codeup/organizations/${input.organizationId}/repositories/${encodedRepoId}/branches/${encodedBranch}`,
      },
    ],
    `Failed to delete branch ${input.branch} from repository ${input.repositoryId}`
  );
}

export async function listRepositoryProtectedBranches(client: YunxiaoApiClient, input: {
  organizationId: string;
  repositoryId: string;
}): Promise<unknown> {
  const encodedRepoId = encodeRepositoryId(input.repositoryId);
  return requestWithFallback(
    client,
    [
      {
        method: "GET",
        path: `/oapi/v1/codeup/organizations/${input.organizationId}/repositories/${encodedRepoId}/protectedBranches`,
      },
      {
        method: "GET",
        path: `/repository/${encodedRepoId}/protect_branches`,
        query: {
          organizationId: input.organizationId,
        },
      },
      {
        method: "GET",
        path: `/oapi/v1/codeup/organizations/${input.organizationId}/repositories/${encodedRepoId}/protect_branches`,
      },
    ],
    `Failed to list protected branches for repository ${input.repositoryId}`
  );
}

export async function createRepositoryProtectedBranch(client: YunxiaoApiClient, input: {
  organizationId: string;
  repositoryId: string;
  branch: string;
  allowPushRoles?: number[];
  allowMergeRoles?: number[];
  allowPushUserIds?: string[];
  allowMergeUserIds?: string[];
  mergeRequestSetting?: Record<string, unknown>;
  testSetting?: Record<string, unknown>;
}): Promise<unknown> {
  const encodedRepoId = encodeRepositoryId(input.repositoryId);
  const body = {
    branch: input.branch,
    allowPushRoles: input.allowPushRoles,
    allowMergeRoles: input.allowMergeRoles,
    allowPushUserIds: input.allowPushUserIds,
    allowMergeUserIds: input.allowMergeUserIds,
    mergeRequestSetting: input.mergeRequestSetting,
    testSetting: input.testSetting,
  };

  return requestWithFallback(
    client,
    [
      {
        method: "POST",
        path: `/oapi/v1/codeup/organizations/${input.organizationId}/repositories/${encodedRepoId}/protectedBranches`,
        body,
      },
      {
        method: "POST",
        path: `/repository/${encodedRepoId}/protect_branches`,
        query: {
          organizationId: input.organizationId,
        },
        body,
      },
      {
        method: "POST",
        path: `/oapi/v1/codeup/organizations/${input.organizationId}/repositories/${encodedRepoId}/protect_branches`,
        body,
      },
    ],
    `Failed to create protected branch rule for ${input.branch} in repository ${input.repositoryId}`
  );
}

export async function deleteRepositoryProtectedBranch(client: YunxiaoApiClient, input: {
  organizationId: string;
  repositoryId: string;
  protectedBranchId: string;
}): Promise<unknown> {
  const encodedRepoId = encodeRepositoryId(input.repositoryId);
  const encodedProtectedBranchId = encodeURIComponent(input.protectedBranchId);
  return requestWithFallback(
    client,
    [
      {
        method: "DELETE",
        path: `/oapi/v1/codeup/organizations/${input.organizationId}/repositories/${encodedRepoId}/protectedBranches/${encodedProtectedBranchId}`,
      },
      {
        method: "DELETE",
        path: `/repository/${encodedRepoId}/protect_branches/${encodedProtectedBranchId}`,
        query: {
          organizationId: input.organizationId,
        },
      },
      {
        method: "DELETE",
        path: `/oapi/v1/codeup/organizations/${input.organizationId}/repositories/${encodedRepoId}/protect_branches/${encodedProtectedBranchId}`,
      },
    ],
    `Failed to delete protected branch rule ${input.protectedBranchId} from repository ${input.repositoryId}`
  );
}

export async function getRepositoryProtectedBranch(client: YunxiaoApiClient, input: {
  organizationId: string;
  repositoryId: string;
  protectedBranchId: string;
}): Promise<unknown> {
  const encodedRepoId = encodeRepositoryId(input.repositoryId);
  const encodedProtectedBranchId = encodeURIComponent(input.protectedBranchId);
  return requestWithFallback(
    client,
    [
      {
        method: "GET",
        path: `/oapi/v1/codeup/organizations/${input.organizationId}/repositories/${encodedRepoId}/protectedBranches/${encodedProtectedBranchId}`,
      },
      {
        method: "GET",
        path: `/repository/${encodedRepoId}/protect_branches/${encodedProtectedBranchId}`,
        query: {
          organizationId: input.organizationId,
        },
      },
      {
        method: "GET",
        path: `/oapi/v1/codeup/organizations/${input.organizationId}/repositories/${encodedRepoId}/protect_branches/${encodedProtectedBranchId}`,
      },
    ],
    `Failed to get protected branch rule ${input.protectedBranchId} in repository ${input.repositoryId}`
  );
}

export async function updateRepositoryProtectedBranch(client: YunxiaoApiClient, input: {
  organizationId: string;
  repositoryId: string;
  protectedBranchId: string;
  branch: string;
  allowPushRoles?: number[];
  allowMergeRoles?: number[];
  allowPushUserIds?: string[];
  allowMergeUserIds?: string[];
  mergeRequestSetting?: Record<string, unknown>;
  testSetting?: Record<string, unknown>;
}): Promise<unknown> {
  const encodedRepoId = encodeRepositoryId(input.repositoryId);
  const encodedProtectedBranchId = encodeURIComponent(input.protectedBranchId);
  const body = {
    branch: input.branch,
    allowPushRoles: input.allowPushRoles,
    allowMergeRoles: input.allowMergeRoles,
    allowPushUserIds: input.allowPushUserIds,
    allowMergeUserIds: input.allowMergeUserIds,
    mergeRequestSetting: input.mergeRequestSetting,
    testSetting: input.testSetting,
  };

  return requestWithFallback(
    client,
    [
      {
        method: "PUT",
        path: `/oapi/v1/codeup/organizations/${input.organizationId}/repositories/${encodedRepoId}/protectedBranches/${encodedProtectedBranchId}`,
        body,
      },
      {
        method: "PUT",
        path: `/repository/${encodedRepoId}/protect_branches/${encodedProtectedBranchId}`,
        query: {
          organizationId: input.organizationId,
        },
        body,
      },
      {
        method: "PUT",
        path: `/oapi/v1/codeup/organizations/${input.organizationId}/repositories/${encodedRepoId}/protect_branches/${encodedProtectedBranchId}`,
        body,
      },
      {
        method: "PATCH",
        path: `/oapi/v1/codeup/organizations/${input.organizationId}/repositories/${encodedRepoId}/protectedBranches/${encodedProtectedBranchId}`,
        body,
      },
    ],
    `Failed to update protected branch rule ${input.protectedBranchId} in repository ${input.repositoryId}`
  );
}

export async function listRepositoryTags(client: YunxiaoApiClient, input: {
  organizationId: string;
  repositoryId: string;
  page?: number;
  perPage?: number;
  sort?: string;
  search?: string;
}): Promise<unknown> {
  const encodedRepoId = encodeRepositoryId(input.repositoryId);
  return requestWithFallback(
    client,
    [
      {
        method: "GET",
        path: `/repository/${encodedRepoId}/tag/list`,
        query: {
          organizationId: input.organizationId,
          page: input.page,
          pageSize: input.perPage,
          sort: input.sort,
          search: input.search,
        },
      },
      {
        method: "GET",
        path: `/oapi/v1/codeup/organizations/${input.organizationId}/repositories/${encodedRepoId}/tags`,
        query: {
          page: input.page,
          perPage: input.perPage,
          sort: input.sort,
          search: input.search,
        },
      },
    ],
    `Failed to list tags for repository ${input.repositoryId}`
  );
}

export async function createRepositoryTag(client: YunxiaoApiClient, input: {
  organizationId: string;
  repositoryId: string;
  tag: string;
  ref: string;
  message?: string;
}): Promise<unknown> {
  const encodedRepoId = encodeRepositoryId(input.repositoryId);
  const body = {
    tagName: input.tag,
    ref: input.ref,
    message: input.message,
  };
  return requestWithFallback(
    client,
    [
      {
        method: "POST",
        path: `/repository/${encodedRepoId}/tags/create`,
        query: {
          organizationId: input.organizationId,
        },
        body,
      },
      {
        method: "POST",
        path: `/repository/${encodedRepoId}/tags/create`,
        query: {
          organizationId: input.organizationId,
          tagName: input.tag,
          ref: input.ref,
          message: input.message,
        },
      },
      {
        method: "POST",
        path: `/oapi/v1/codeup/organizations/${input.organizationId}/repositories/${encodedRepoId}/tags`,
        query: {
          tagName: input.tag,
          ref: input.ref,
          message: input.message,
        },
      },
      {
        method: "POST",
        path: `/oapi/v1/codeup/organizations/${input.organizationId}/repositories/${encodedRepoId}/tags`,
        body,
      },
    ],
    `Failed to create tag ${input.tag} in repository ${input.repositoryId}`
  );
}

export async function deleteRepositoryTag(client: YunxiaoApiClient, input: {
  organizationId: string;
  repositoryId: string;
  tag: string;
}): Promise<unknown> {
  const encodedRepoId = encodeRepositoryId(input.repositoryId);
  const encodedTagName = encodeURIComponent(input.tag);
  return requestWithFallback(
    client,
    [
      {
        method: "DELETE",
        path: `/repository/${encodedRepoId}/tags/delete`,
        query: {
          organizationId: input.organizationId,
          tagName: input.tag,
        },
      },
      {
        method: "DELETE",
        path: `/oapi/v1/codeup/organizations/${input.organizationId}/repositories/${encodedRepoId}/tags/${encodedTagName}`,
      },
    ],
    `Failed to delete tag ${input.tag} from repository ${input.repositoryId}`
  );
}

export async function listRepositoryLabels(client: YunxiaoApiClient, input: {
  organizationId: string;
  repositoryId: string;
  page?: number;
  perPage?: number;
  orderBy?: string;
  sort?: string;
  search?: string;
  withCounts?: boolean;
}): Promise<unknown> {
  const encodedRepoId = encodeRepositoryId(input.repositoryId);
  return requestWithFallback(
    client,
    [
      {
        method: "GET",
        path: `/oapi/v1/codeup/organizations/${input.organizationId}/repositories/${encodedRepoId}/labels`,
        query: {
          search: input.search,
          page: input.page,
          per_page: input.perPage,
          with_counts: input.withCounts,
          order_by: input.orderBy,
          sort: input.sort,
        },
      },
      {
        method: "GET",
        path: `/oapi/v1/codeup/organizations/${input.organizationId}/repositories/${encodedRepoId}/labels`,
        query: {
          page: input.page,
          perPage: input.perPage,
          orderBy: input.orderBy,
          sort: input.sort,
          search: input.search,
          withCounts: input.withCounts,
        },
      },
      {
        method: "GET",
        path: `/api/v4/projects/labels`,
        query: {
          organizationId: input.organizationId,
          repositoryIdentity: input.repositoryId,
          page: input.page,
          pageSize: input.perPage,
          orderBy: input.orderBy,
          sort: input.sort,
          search: input.search,
          withCounts: input.withCounts,
        },
      },
      {
        method: "GET",
        path: `/repository/${encodedRepoId}/labels`,
        query: {
          organizationId: input.organizationId,
          page: input.page,
          pageSize: input.perPage,
          orderBy: input.orderBy,
          sort: input.sort,
          search: input.search,
          withCounts: input.withCounts,
        },
      },
    ],
    `Failed to list labels for repository ${input.repositoryId}`
  );
}

export async function createRepositoryLabel(client: YunxiaoApiClient, input: {
  organizationId: string;
  repositoryId: string;
  name: string;
  color: string;
  description?: string;
}): Promise<unknown> {
  const encodedRepoId = encodeRepositoryId(input.repositoryId);
  const body = {
    name: input.name,
    color: input.color,
    description: input.description,
  };
  const officialBody = {
    label_name: input.name,
    label_color: input.color,
    label_description: input.description,
  };

  return requestWithFallback(
    client,
    [
      {
        method: "POST",
        path: `/oapi/v1/codeup/organizations/${input.organizationId}/repositories/${encodedRepoId}/labels`,
        body: officialBody,
      },
      {
        method: "POST",
        path: `/oapi/v1/codeup/organizations/${input.organizationId}/repositories/${encodedRepoId}/labels`,
        body,
      },
      {
        method: "POST",
        path: `/api/v4/projects/labels`,
        query: {
          organizationId: input.organizationId,
          repositoryIdentity: input.repositoryId,
        },
        body,
      },
      {
        method: "POST",
        path: `/repository/${encodedRepoId}/labels`,
        query: {
          organizationId: input.organizationId,
        },
        body,
      },
    ],
    `Failed to create label ${input.name} in repository ${input.repositoryId}`
  );
}

export async function updateRepositoryLabel(client: YunxiaoApiClient, input: {
  organizationId: string;
  repositoryId: string;
  labelId: string;
  name?: string;
  color?: string;
  description?: string;
}): Promise<unknown> {
  const encodedRepoId = encodeRepositoryId(input.repositoryId);
  const encodedLabelId = encodeURIComponent(input.labelId);
  const body = {
    name: input.name,
    color: input.color,
    description: input.description,
  };
  const officialBody = {
    label_name: input.name,
    label_color: input.color,
    label_description: input.description,
  };

  return requestWithFallback(
    client,
    [
      {
        method: "PUT",
        path: `/oapi/v1/codeup/organizations/${input.organizationId}/repositories/${encodedRepoId}/labels/${encodedLabelId}`,
        body: officialBody,
      },
      {
        method: "PUT",
        path: `/oapi/v1/codeup/organizations/${input.organizationId}/repositories/${encodedRepoId}/labels/${encodedLabelId}`,
        body,
      },
      {
        method: "PUT",
        path: `/api/v4/projects/labels/${encodedLabelId}`,
        query: {
          organizationId: input.organizationId,
          repositoryIdentity: input.repositoryId,
        },
        body,
      },
      {
        method: "PUT",
        path: `/repository/${encodedRepoId}/labels/${encodedLabelId}`,
        query: {
          organizationId: input.organizationId,
        },
        body,
      },
    ],
    `Failed to update label ${input.labelId} in repository ${input.repositoryId}`
  );
}

export async function deleteRepositoryLabel(client: YunxiaoApiClient, input: {
  organizationId: string;
  repositoryId: string;
  labelId: string;
}): Promise<unknown> {
  const encodedRepoId = encodeRepositoryId(input.repositoryId);
  const encodedLabelId = encodeURIComponent(input.labelId);
  return requestWithFallback(
    client,
    [
      {
        method: "DELETE",
        path: `/oapi/v1/codeup/organizations/${input.organizationId}/repositories/${encodedRepoId}/labels/${encodedLabelId}`,
      },
      {
        method: "DELETE",
        path: `/api/v4/projects/labels/${encodedLabelId}`,
        query: {
          organizationId: input.organizationId,
          repositoryIdentity: input.repositoryId,
        },
      },
      {
        method: "DELETE",
        path: `/repository/${encodedRepoId}/labels/${encodedLabelId}`,
        query: {
          organizationId: input.organizationId,
        },
      },
    ],
    `Failed to delete label ${input.labelId} in repository ${input.repositoryId}`
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
