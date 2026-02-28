import { YunxiaoApiClient, encodeRepositoryId } from "./client.js";
import { CliError } from "../errors.js";

export async function listChangeRequests(client: YunxiaoApiClient, input: {
  organizationId: string;
  projectIds?: string;
  authorIds?: string;
  reviewerIds?: string;
  state?: string;
  search?: string;
  page?: number;
  perPage?: number;
  orderBy?: string;
  sort?: string;
}): Promise<unknown> {
  return client.get(`/oapi/v1/codeup/organizations/${input.organizationId}/changeRequests`, {
    projectIds: input.projectIds,
    authorIds: input.authorIds,
    reviewerIds: input.reviewerIds,
    state: input.state,
    search: input.search,
    page: input.page,
    perPage: input.perPage,
    orderBy: input.orderBy,
    sort: input.sort,
  });
}

export async function getChangeRequest(client: YunxiaoApiClient, input: {
  organizationId: string;
  repositoryId: string;
  localId: string;
}): Promise<unknown> {
  const encodedId = encodeRepositoryId(input.repositoryId);
  return client.get(`/oapi/v1/codeup/organizations/${input.organizationId}/repositories/${encodedId}/changeRequests/${input.localId}`);
}

export async function createChangeRequest(client: YunxiaoApiClient, input: {
  organizationId: string;
  repositoryId: string;
  title: string;
  sourceBranch: string;
  targetBranch: string;
  description?: string;
  reviewerUserIds?: string[];
  workItemIds?: string[];
  triggerAIReviewRun?: boolean;
  sourceProjectId?: string;
  targetProjectId?: string;
  createFrom?: "WEB" | "COMMAND_LINE";
}): Promise<unknown> {
  const encodedId = encodeRepositoryId(input.repositoryId);

  let sourceProjectId = input.sourceProjectId;
  let targetProjectId = input.targetProjectId;

  if (!sourceProjectId || !targetProjectId) {
    const derived = await deriveProjectId(client, input.organizationId, encodedId);
    sourceProjectId = sourceProjectId ?? derived;
    targetProjectId = targetProjectId ?? derived;
  }

  if (!sourceProjectId || !targetProjectId) {
    throw new CliError("Could not resolve sourceProjectId/targetProjectId. Please pass --source-project-id and --target-project-id.");
  }

  return client.post(`/oapi/v1/codeup/organizations/${input.organizationId}/repositories/${encodedId}/changeRequests`, {
    title: input.title,
    sourceBranch: input.sourceBranch,
    targetBranch: input.targetBranch,
    description: input.description,
    sourceProjectId,
    targetProjectId,
    reviewerUserIds: input.reviewerUserIds,
    workItemIds: input.workItemIds,
    createFrom: input.createFrom ?? "WEB",
    triggerAIReviewRun: input.triggerAIReviewRun ?? false,
  });
}

export async function mergeChangeRequest(client: YunxiaoApiClient, input: {
  organizationId: string;
  repositoryId: string;
  localId: string;
  mergeMessage?: string;
  mergeType?: "ff-only" | "no-fast-forward" | "squash" | "rebase";
  removeSourceBranch?: boolean;
}): Promise<unknown> {
  const encodedId = encodeRepositoryId(input.repositoryId);
  return client.post(`/oapi/v1/codeup/organizations/${input.organizationId}/repositories/${encodedId}/changeRequests/${input.localId}/merge`, {
    mergeMessage: input.mergeMessage,
    mergeType: input.mergeType,
    removeSourceBranch: input.removeSourceBranch,
  });
}

export async function closeChangeRequest(client: YunxiaoApiClient, input: {
  organizationId: string;
  repositoryId: string;
  localId: string;
}): Promise<unknown> {
  const encodedId = encodeRepositoryId(input.repositoryId);
  return client.post(`/oapi/v1/codeup/organizations/${input.organizationId}/repositories/${encodedId}/changeRequests/${input.localId}/close`);
}

export async function reopenChangeRequest(client: YunxiaoApiClient, input: {
  organizationId: string;
  repositoryId: string;
  localId: string;
}): Promise<unknown> {
  const encodedId = encodeRepositoryId(input.repositoryId);
  return client.post(`/oapi/v1/codeup/organizations/${input.organizationId}/repositories/${encodedId}/changeRequests/${input.localId}/reopen`);
}

export async function updateChangeRequest(client: YunxiaoApiClient, input: {
  organizationId: string;
  repositoryId: string;
  localId: string;
  title?: string;
  description?: string;
  targetBranch?: string;
}): Promise<unknown> {
  const encodedId = encodeRepositoryId(input.repositoryId);
  const body: Record<string, unknown> = {};

  if (input.title !== undefined) {
    body.title = input.title;
  }
  if (input.description !== undefined) {
    body.description = input.description;
  }
  if (input.targetBranch !== undefined) {
    body.targetBranch = input.targetBranch;
  }

  const candidates: Array<{
    method: "PUT" | "PATCH";
    path: string;
    query?: Record<string, unknown>;
    body: Record<string, unknown>;
  }> = [
    {
      method: "PUT",
      path: `/api/v4/projects/${encodedId}/merge_requests/${input.localId}`,
      query: {
        organizationId: input.organizationId,
      },
      body,
    },
    {
      method: "PUT",
      path: `/oapi/v1/codeup/organizations/${input.organizationId}/repositories/${encodedId}/changeRequests/${input.localId}`,
      body,
    },
    {
      method: "PATCH",
      path: `/oapi/v1/codeup/organizations/${input.organizationId}/repositories/${encodedId}/changeRequests/${input.localId}`,
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
  throw new CliError(`Failed to update pull request ${input.localId}.${suffix}`);
}

export async function updateChangeRequestPersonnel(client: YunxiaoApiClient, input: {
  organizationId: string;
  repositoryId: string;
  localId: string;
  personType: string;
  userIds: string[];
}): Promise<unknown> {
  const encodedId = encodeRepositoryId(input.repositoryId);
  const body = {
    newUserIdList: input.userIds,
  };

  const candidates: Array<{
    method: "POST" | "PUT";
    path: string;
    query?: Record<string, unknown>;
    body: Record<string, unknown>;
  }> = [
    {
      method: "POST",
      path: `/api/v4/projects/${encodedId}/merge_requests/${input.localId}/person/${input.personType}`,
      query: {
        organizationId: input.organizationId,
      },
      body,
    },
    {
      method: "POST",
      path: `/oapi/v1/codeup/organizations/${input.organizationId}/repositories/${encodedId}/changeRequests/${input.localId}/person/${input.personType}`,
      body,
    },
    {
      method: "PUT",
      path: `/oapi/v1/codeup/organizations/${input.organizationId}/repositories/${encodedId}/changeRequests/${input.localId}/person/${input.personType}`,
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
  throw new CliError(`Failed to update pull request personnel for ${input.localId}.${suffix}`);
}

export async function listChangeRequestPatchSets(client: YunxiaoApiClient, input: {
  organizationId: string;
  repositoryId: string;
  localId: string;
}): Promise<unknown> {
  const encodedId = encodeRepositoryId(input.repositoryId);
  return client.get(`/oapi/v1/codeup/organizations/${input.organizationId}/repositories/${encodedId}/changeRequests/${input.localId}/diffs/patches`);
}

export async function createChangeRequestComment(client: YunxiaoApiClient, input: {
  organizationId: string;
  repositoryId: string;
  localId: string;
  content: string;
  draft?: boolean;
  resolved?: boolean;
  patchsetBizId?: string;
  commentType?: "GLOBAL_COMMENT" | "INLINE_COMMENT";
  filePath?: string;
  lineNumber?: number;
  fromPatchsetBizId?: string;
  toPatchsetBizId?: string;
  parentCommentBizId?: string;
}): Promise<unknown> {
  const encodedId = encodeRepositoryId(input.repositoryId);
  const commentType = input.commentType ?? "GLOBAL_COMMENT";
  const payload: Record<string, unknown> = {
    comment_type: commentType,
    content: input.content,
    draft: input.draft ?? false,
    resolved: input.resolved ?? false,
  };

  if (input.patchsetBizId) {
    payload.patchset_biz_id = input.patchsetBizId;
  }

  if (commentType === "INLINE_COMMENT") {
    payload.file_path = input.filePath;
    payload.line_number = input.lineNumber;
    payload.from_patchset_biz_id = input.fromPatchsetBizId;
    payload.to_patchset_biz_id = input.toPatchsetBizId;
  }

  if (input.parentCommentBizId) {
    payload.parent_comment_biz_id = input.parentCommentBizId;
  }

  return client.post(
    `/oapi/v1/codeup/organizations/${input.organizationId}/repositories/${encodedId}/changeRequests/${input.localId}/comments`,
    payload
  );
}

export async function updateChangeRequestComment(client: YunxiaoApiClient, input: {
  organizationId: string;
  repositoryId: string;
  localId: string;
  commentBizId: string;
  content: string;
}): Promise<unknown> {
  const encodedId = encodeRepositoryId(input.repositoryId);
  return client.request(
    `/oapi/v1/codeup/organizations/${input.organizationId}/repositories/${encodedId}/changeRequests/${input.localId}/comments/${input.commentBizId}`,
    {
      method: "PUT",
      body: {
        content: input.content,
      },
    }
  );
}

export async function deleteChangeRequestComment(client: YunxiaoApiClient, input: {
  organizationId: string;
  repositoryId: string;
  localId: string;
  commentBizId: string;
}): Promise<unknown> {
  const encodedId = encodeRepositoryId(input.repositoryId);
  return client.request(
    `/oapi/v1/codeup/organizations/${input.organizationId}/repositories/${encodedId}/changeRequests/${input.localId}/comments/${input.commentBizId}`,
    {
      method: "DELETE",
    }
  );
}

export async function updateChangeRequestCommentResolved(client: YunxiaoApiClient, input: {
  organizationId: string;
  repositoryId: string;
  localId: string;
  commentBizId: string;
  resolved: boolean;
}): Promise<unknown> {
  const encodedId = encodeRepositoryId(input.repositoryId);
  const actionPath = input.resolved ? "resolve" : "unresolve";
  const candidates: Array<{ method: "PUT" | "PATCH" | "POST"; path: string; body?: Record<string, unknown> }> = [
    {
      method: "PUT",
      path: `/oapi/v1/codeup/organizations/${input.organizationId}/repositories/${encodedId}/changeRequests/${input.localId}/comments/${input.commentBizId}`,
      body: {
        resolved: input.resolved,
      },
    },
    {
      method: "PATCH",
      path: `/oapi/v1/codeup/organizations/${input.organizationId}/repositories/${encodedId}/changeRequests/${input.localId}/comments/${input.commentBizId}`,
      body: {
        resolved: input.resolved,
      },
    },
    {
      method: "POST",
      path: `/oapi/v1/codeup/organizations/${input.organizationId}/repositories/${encodedId}/changeRequests/${input.localId}/comments/${input.commentBizId}/${actionPath}`,
    },
    {
      method: "POST",
      path: `/oapi/v1/codeup/organizations/${input.organizationId}/repositories/${encodedId}/changeRequests/${input.localId}/comments/${input.commentBizId}/resolved`,
      body: {
        resolved: input.resolved,
      },
    },
  ];

  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      return await client.request(candidate.path, {
        method: candidate.method,
        body: candidate.body,
      });
    } catch (error) {
      lastError = error;
      if (!isEndpointUnavailableError(error)) {
        throw error;
      }
    }
  }

  const suffix = lastError instanceof Error ? ` Last error: ${lastError.message}` : "";
  throw new CliError(
    `Failed to ${input.resolved ? "resolve" : "unresolve"} pull request comment ${input.commentBizId}.${suffix}`
  );
}

export async function markChangeRequestReady(client: YunxiaoApiClient, input: {
  organizationId: string;
  repositoryId: string;
  localId: string;
}): Promise<unknown> {
  const encodedId = encodeRepositoryId(input.repositoryId);
  const candidates: Array<{ method: "POST" | "PUT" | "PATCH"; path: string; body?: unknown }> = [
    {
      method: "POST",
      path: `/oapi/v1/codeup/organizations/${input.organizationId}/repositories/${encodedId}/changeRequests/${input.localId}/ready`,
    },
    {
      method: "PUT",
      path: `/oapi/v1/codeup/organizations/${input.organizationId}/repositories/${encodedId}/changeRequests/${input.localId}/ready`,
    },
    {
      method: "POST",
      path: `/oapi/v1/codeup/organizations/${input.organizationId}/repositories/${encodedId}/changeRequests/${input.localId}/markAsReady`,
    },
    {
      method: "POST",
      path: `/oapi/v1/codeup/organizations/${input.organizationId}/repositories/${encodedId}/changeRequests/${input.localId}/setReady`,
    },
    {
      method: "POST",
      path: `/oapi/v1/codeup/organizations/${input.organizationId}/repositories/${encodedId}/changeRequests/${input.localId}/readyForReview`,
    },
    {
      method: "PUT",
      path: `/oapi/v1/codeup/organizations/${input.organizationId}/repositories/${encodedId}/changeRequests/${input.localId}`,
      body: { status: "UNDER_REVIEW" },
    },
    {
      method: "PATCH",
      path: `/oapi/v1/codeup/organizations/${input.organizationId}/repositories/${encodedId}/changeRequests/${input.localId}`,
      body: { status: "UNDER_REVIEW" },
    },
  ];

  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      return await client.request(candidate.path, {
        method: candidate.method,
        body: candidate.body,
      });
    } catch (error) {
      lastError = error;
    }
  }

  const suffix = lastError instanceof Error ? ` Last error: ${lastError.message}` : "";
  throw new CliError(`Failed to mark pull request ${input.localId} as ready.${suffix}`);
}

export async function listChangeRequestComments(client: YunxiaoApiClient, input: {
  organizationId: string;
  repositoryId: string;
  localId: string;
  patchSetBizIds?: string[];
  commentType?: "GLOBAL_COMMENT" | "INLINE_COMMENT";
  state?: "OPENED" | "DRAFT";
  resolved?: boolean;
  filePath?: string;
}): Promise<unknown> {
  const encodedId = encodeRepositoryId(input.repositoryId);
  return client.post(
    `/oapi/v1/codeup/organizations/${input.organizationId}/repositories/${encodedId}/changeRequests/${input.localId}/comments/list`,
    {
      patchSetBizIds: input.patchSetBizIds ?? [],
      commentType: input.commentType ?? "GLOBAL_COMMENT",
      state: input.state ?? "OPENED",
      resolved: input.resolved ?? false,
      filePath: input.filePath,
    }
  );
}

export async function getMergeRequestChangeTree(client: YunxiaoApiClient, input: {
  organizationId: string;
  repositoryIdentity: string;
  localId: string;
  fromPatchSetBizId?: string;
  toPatchSetBizId?: string;
}): Promise<unknown> {
  if (!input.fromPatchSetBizId || !input.toPatchSetBizId) {
    throw new CliError("Missing patchset range. Both fromPatchSetId and toPatchSetId are required.");
  }

  const encodedRepository = encodeRepositoryId(input.repositoryIdentity);
  const query = {
    fromPatchSetId: input.fromPatchSetBizId,
    toPatchSetId: input.toPatchSetBizId,
  };

  const candidates = [
    `/oapi/v1/codeup/organizations/${input.organizationId}/repositories/${encodedRepository}/changeRequests/${input.localId}/diffs/changeTree`,
    `/oapi/v1/codeup/organizations/${input.organizationId}/repositories/${encodedRepository}/changeRequests/${input.localId}/diffs/change_tree`,
  ];

  let lastError: unknown;
  for (const path of candidates) {
    try {
      return await client.request(path, {
        method: "GET",
        query,
      });
    } catch (error) {
      if (!isEndpointUnavailableError(error)) {
        throw error;
      }
      lastError = error;
    }
  }

  const suffix = lastError instanceof Error ? ` Last error: ${lastError.message}` : "";
  throw new CliError(`Failed to get diff tree for pull request ${input.localId}.${suffix}`);
}

export async function getRepositoryCompare(client: YunxiaoApiClient, input: {
  organizationId: string;
  repositoryIdentity: string;
  from: string;
  to: string;
  straight?: boolean;
}): Promise<unknown> {
  const encodedRepository = encodeRepositoryId(input.repositoryIdentity);
  return client.get(
    `/oapi/v1/codeup/organizations/${input.organizationId}/repositories/${encodedRepository}/compares`,
    {
      from: input.from,
      to: input.to,
      straight: input.straight ?? true,
    }
  );
}

function isEndpointUnavailableError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message;
  return (
    message.startsWith("Yunxiao API 404:") ||
    message.startsWith("Yunxiao API 405:") ||
    message.includes("returned HTML document unexpectedly")
  );
}

export async function reviewMergeRequest(client: YunxiaoApiClient, input: {
  organizationId: string;
  repositoryIdentity: string;
  localId: string;
  reviewOpinion: string;
  reviewComment?: string;
  draftCommentIds?: string[];
}): Promise<unknown> {
  const encodedRepository = encodeRepositoryId(input.repositoryIdentity);
  const query = {
    organizationId: input.organizationId,
  };
  const body = {
    reviewOpinion: input.reviewOpinion,
    reviewComment: input.reviewComment,
    draftCommentIds: input.draftCommentIds,
  };

  const candidates: Array<{ path: string; method: "POST" | "PUT"; query?: Record<string, unknown>; body?: unknown }> = [
    {
      path: `/api/v4/projects/${encodedRepository}/merge_requests/${input.localId}/submit_review_opinion`,
      method: "POST",
      query,
      body,
    },
    {
      path: `/oapi/v1/codeup/organizations/${input.organizationId}/repositories/${encodedRepository}/changeRequests/${input.localId}/review`,
      method: "POST",
      body,
    },
    {
      path: `/oapi/v1/codeup/organizations/${input.organizationId}/repositories/${encodedRepository}/changeRequests/${input.localId}/submitReview`,
      method: "POST",
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
  throw new CliError(`Failed to submit review for pull request ${input.localId}.${suffix}`);
}

async function deriveProjectId(client: YunxiaoApiClient, organizationId: string, repositoryId: string): Promise<string | undefined> {
  if (/^\d+$/.test(repositoryId)) {
    return repositoryId;
  }

  const response = await client.get(`/oapi/v1/codeup/organizations/${organizationId}/repositories/${repositoryId}`);
  if (!response || typeof response !== "object") {
    return undefined;
  }

  const id = (response as Record<string, unknown>).id;
  if (typeof id === "number") {
    return String(Math.round(id));
  }
  if (typeof id === "string") {
    return id;
  }

  return undefined;
}
