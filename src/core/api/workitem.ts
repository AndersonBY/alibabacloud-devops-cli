import { YunxiaoApiClient } from "./client.js";
import { resolveUserSelectors } from "../utils/user.js";
import { CliError } from "../errors.js";

type Condition = {
  className: string;
  fieldIdentifier: string;
  format: string;
  operator: string;
  toValue: string | null;
  value: string[];
};

export async function getWorkItem(client: YunxiaoApiClient, input: {
  organizationId: string;
  workItemId: string;
}): Promise<unknown> {
  return client.get(`/oapi/v1/projex/organizations/${input.organizationId}/workitems/${input.workItemId}`);
}

export async function searchWorkItems(client: YunxiaoApiClient, input: {
  organizationId: string;
  category: string;
  spaceId: string;
  subject?: string;
  status?: string;
  creator?: string;
  assignedTo?: string;
  tag?: string;
  workitemType?: string;
  priority?: string;
  orderBy?: string;
  sort?: string;
  page?: number;
  perPage?: number;
  conditions?: string;
}): Promise<unknown> {
  let conditions = input.conditions;

  if (!conditions) {
    const creatorValues = await resolveUserSelectors(client, input.creator);
    const assignedValues = await resolveUserSelectors(client, input.assignedTo);

    conditions = buildWorkitemConditions({
      subject: input.subject,
      status: input.status,
      creator: creatorValues,
      assignedTo: assignedValues,
      tag: input.tag,
      workitemType: input.workitemType,
      priority: input.priority,
    });
  }

  return client.post(`/oapi/v1/projex/organizations/${input.organizationId}/workitems:search`, {
    category: input.category,
    spaceId: input.spaceId,
    conditions,
    orderBy: input.orderBy,
    sort: input.sort,
    page: input.page,
    perPage: input.perPage,
  });
}

export async function createWorkItem(client: YunxiaoApiClient, input: {
  organizationId: string;
  assignedTo: string;
  spaceId: string;
  subject: string;
  workitemTypeId: string;
  description?: string;
  labels?: string[];
  participants?: string[];
  trackers?: string[];
  verifier?: string;
  sprint?: string;
  parentId?: string;
  customFieldValues?: Record<string, unknown>;
}): Promise<unknown> {
  return client.post(`/oapi/v1/projex/organizations/${input.organizationId}/workitems`, {
    assignedTo: input.assignedTo,
    spaceId: input.spaceId,
    subject: input.subject,
    workitemTypeId: input.workitemTypeId,
    description: input.description,
    labels: input.labels,
    participants: input.participants,
    trackers: input.trackers,
    verifier: input.verifier,
    sprint: input.sprint,
    parentId: input.parentId,
    customFieldValues: input.customFieldValues,
  });
}

export async function updateWorkItem(client: YunxiaoApiClient, input: {
  organizationId: string;
  workItemId: string;
  subject?: string;
  description?: string;
  status?: string;
  assignedTo?: string;
  spaceId?: string;
  priority?: string;
  labels?: string[];
  participants?: string[];
  trackers?: string[];
  verifier?: string;
  sprint?: string;
  customFieldValues?: Record<string, unknown>;
}): Promise<unknown> {
  const body: Record<string, unknown> = {};

  if (input.subject !== undefined) {
    body.subject = input.subject;
  }
  if (input.description !== undefined) {
    body.description = input.description;
  }
  if (input.status !== undefined) {
    body.status = input.status;
  }
  if (input.assignedTo !== undefined) {
    body.assignedTo = input.assignedTo;
  }
  if (input.spaceId !== undefined) {
    body.spaceId = input.spaceId;
    body.spaceIdentifier = input.spaceId;
  }
  if (input.priority !== undefined) {
    body.priority = input.priority;
  }
  if (input.labels !== undefined) {
    body.labels = input.labels;
  }
  if (input.participants !== undefined) {
    body.participants = input.participants;
  }
  if (input.trackers !== undefined) {
    body.trackers = input.trackers;
  }
  if (input.verifier !== undefined) {
    body.verifier = input.verifier;
  }
  if (input.sprint !== undefined) {
    body.sprint = input.sprint;
  }

  if (input.customFieldValues) {
    for (const [key, value] of Object.entries(input.customFieldValues)) {
      body[key] = value;
    }
  }

  return client.request(`/oapi/v1/projex/organizations/${input.organizationId}/workitems/${input.workItemId}`, {
    method: "PUT",
    body,
  });
}

export async function listProjectWorkItemTypes(client: YunxiaoApiClient, input: {
  organizationId: string;
  projectId: string;
  category?: string;
}): Promise<unknown[]> {
  const response = await client.get(`/oapi/v1/projex/organizations/${input.organizationId}/projects/${input.projectId}/workitemTypes`, {
    category: input.category,
  });

  if (Array.isArray(response)) {
    return response;
  }

  if (response && typeof response === "object" && Array.isArray((response as Record<string, unknown>).result)) {
    return (response as Record<string, unknown>).result as unknown[];
  }

  return [];
}

export async function listWorkItemTypeFields(client: YunxiaoApiClient, input: {
  organizationId: string;
  projectId: string;
  workItemTypeId: string;
}): Promise<unknown[]> {
  const response = await client.get(
    `/oapi/v1/projex/organizations/${input.organizationId}/projects/${input.projectId}/workitemTypes/${input.workItemTypeId}/fields`
  );

  if (Array.isArray(response)) {
    return response;
  }

  if (response && typeof response === "object" && Array.isArray((response as Record<string, unknown>).result)) {
    return (response as Record<string, unknown>).result as unknown[];
  }

  return [];
}

export async function getWorkItemTypeWorkflow(client: YunxiaoApiClient, input: {
  organizationId: string;
  projectId: string;
  workItemTypeId: string;
}): Promise<Record<string, unknown> | undefined> {
  const response = await client.get(
    `/oapi/v1/projex/organizations/${input.organizationId}/projects/${input.projectId}/workitemTypes/${input.workItemTypeId}/workflows`
  );

  if (response && typeof response === "object" && !Array.isArray(response)) {
    return response as Record<string, unknown>;
  }

  if (Array.isArray(response) && response.length > 0) {
    const first = response[0];
    if (first && typeof first === "object" && !Array.isArray(first)) {
      return first as Record<string, unknown>;
    }
  }

  return undefined;
}

export async function listWorkItemComments(client: YunxiaoApiClient, input: {
  organizationId: string;
  workItemId: string;
  page?: number;
  perPage?: number;
}): Promise<unknown> {
  return client.get(`/oapi/v1/projex/organizations/${input.organizationId}/workitems/${input.workItemId}/comments`, {
    page: input.page,
    perPage: input.perPage,
  });
}

export async function listWorkItemActivities(client: YunxiaoApiClient, input: {
  organizationId: string;
  workItemId: string;
}): Promise<unknown> {
  return client.get(`/oapi/v1/projex/organizations/${input.organizationId}/workitems/${input.workItemId}/activities`);
}

export async function createWorkItemComment(client: YunxiaoApiClient, input: {
  organizationId: string;
  workItemId: string;
  content: string;
}): Promise<unknown> {
  return client.post(`/oapi/v1/projex/organizations/${input.organizationId}/workitems/${input.workItemId}/comments`, {
    content: input.content,
  });
}

export async function updateWorkItemComment(client: YunxiaoApiClient, input: {
  organizationId: string;
  workItemId: string;
  commentId: string;
  content: string;
  formatType?: "MARKDOWN" | "RICHTEXT";
}): Promise<unknown> {
  const formatType = input.formatType ?? "RICHTEXT";
  const candidates: Array<{ method: "PUT" | "PATCH" | "POST"; path: string; body: Record<string, unknown> }> = [
    {
      method: "PUT",
      path: `/oapi/v1/projex/organizations/${input.organizationId}/workitems/${input.workItemId}/comments/${input.commentId}`,
      body: {
        content: input.content,
        formatType,
      },
    },
    {
      method: "PATCH",
      path: `/oapi/v1/projex/organizations/${input.organizationId}/workitems/${input.workItemId}/comments/${input.commentId}`,
      body: {
        content: input.content,
        formatType,
      },
    },
    {
      method: "PUT",
      path: `/oapi/v1/projex/organizations/${input.organizationId}/workitems/comments/${input.commentId}`,
      body: {
        content: input.content,
        formatType,
        workitemIdentifier: input.workItemId,
      },
    },
    {
      method: "PATCH",
      path: `/oapi/v1/projex/organizations/${input.organizationId}/workitems/comments/${input.commentId}`,
      body: {
        content: input.content,
        formatType,
        workitemIdentifier: input.workItemId,
      },
    },
    {
      method: "POST",
      path: `/organization/${input.organizationId}/workitems/commentUpdate`,
      body: {
        commentId: input.commentId,
        content: input.content,
        formatType,
        workitemIdentifier: input.workItemId,
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
    }
  }

  const suffix = lastError instanceof Error ? ` Last error: ${lastError.message}` : "";
  if (isGatewayCompatibilityError(lastError)) {
    throw new CliError(
      `Failed to update workitem comment ${input.commentId}. Current tenant gateway does not expose comment edit API for PAT/openapi access.${suffix}`
    );
  }
  throw new CliError(`Failed to update workitem comment ${input.commentId}.${suffix}`);
}

export async function deleteWorkItemComment(client: YunxiaoApiClient, input: {
  organizationId: string;
  workItemId: string;
  commentId: string;
}): Promise<unknown> {
  const candidates: Array<{ method: "DELETE" | "POST"; path: string; body?: Record<string, unknown> }> = [
    {
      method: "DELETE",
      path: `/oapi/v1/projex/organizations/${input.organizationId}/workitems/${input.workItemId}/comments/${input.commentId}`,
    },
    {
      method: "POST",
      path: `/organization/${input.organizationId}/workitems/deleteComent`,
      body: {
        identifier: input.workItemId,
        commentId: input.commentId,
      },
    },
    {
      method: "POST",
      path: `/organization/${input.organizationId}/workitems/deleteComment`,
      body: {
        identifier: input.workItemId,
        commentId: input.commentId,
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
    }
  }

  const suffix = lastError instanceof Error ? ` Last error: ${lastError.message}` : "";
  if (isGatewayCompatibilityError(lastError)) {
    throw new CliError(
      `Failed to delete workitem comment ${input.commentId}. Current tenant gateway does not expose comment delete API for PAT/openapi access.${suffix}`
    );
  }
  throw new CliError(`Failed to delete workitem comment ${input.commentId}.${suffix}`);
}

export async function deleteWorkItem(client: YunxiaoApiClient, input: {
  organizationId: string;
  workItemId: string;
}): Promise<unknown> {
  const candidates: Array<{
    method: "DELETE" | "POST";
    path: string;
    query?: Record<string, unknown>;
    body?: Record<string, unknown>;
  }> = [
    {
      method: "DELETE",
      path: `/oapi/v1/projex/organizations/${input.organizationId}/workitems/${input.workItemId}`,
    },
    {
      method: "DELETE",
      path: `/organization/${input.organizationId}/workitem/delete`,
      query: {
        identifier: input.workItemId,
      },
    },
    {
      method: "POST",
      path: `/organization/${input.organizationId}/workitem/delete`,
      body: {
        identifier: input.workItemId,
      },
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
  throw new CliError(`Failed to delete workitem ${input.workItemId}.${suffix}`);
}

export async function updateWorkItemFields(client: YunxiaoApiClient, input: {
  organizationId: string;
  workItemId: string;
  fields: Array<{
    fieldIdentifier: string;
    fieldValue: string;
  }>;
}): Promise<unknown> {
  const normalized = input.fields.filter((item) => item.fieldIdentifier && item.fieldValue !== undefined);
  if (!normalized.length) {
    throw new CliError("No workitem fields provided for update.");
  }

  const candidates: Array<{ path: string; body: Record<string, unknown> }> = [
    {
      path: `/organization/${input.organizationId}/workitems/updateWorkitemField`,
      body: {
        workitemIdentifier: input.workItemId,
        updateWorkitemPropertyRequest: normalized.map((item) => ({
          fieldIdentifier: item.fieldIdentifier,
          fieldValue: item.fieldValue,
        })),
      },
    },
    {
      path: `/oapi/v1/projex/organizations/${input.organizationId}/workitems/${input.workItemId}/fields`,
      body: {
        fields: normalized,
      },
    },
  ];

  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      return await client.request(candidate.path, {
        method: "POST",
        body: candidate.body,
      });
    } catch (error) {
      lastError = error;
    }
  }

  const suffix = lastError instanceof Error ? ` Last error: ${lastError.message}` : "";
  throw new CliError(`Failed to update workitem fields for ${input.workItemId}.${suffix}`);
}

function buildWorkitemConditions(input: {
  subject?: string;
  status?: string;
  creator?: string[];
  assignedTo?: string[];
  tag?: string;
  workitemType?: string;
  priority?: string;
}): string | undefined {
  const filterConditions: Condition[] = [];

  if (input.subject) {
    filterConditions.push({
      className: "string",
      fieldIdentifier: "subject",
      format: "input",
      operator: "CONTAINS",
      toValue: null,
      value: [input.subject],
    });
  }

  const statusValues = input.status ? toList(input.status) : [];
  if (statusValues.length) {
    filterConditions.push({
      className: "status",
      fieldIdentifier: "status",
      format: "list",
      operator: "CONTAINS",
      toValue: null,
      value: statusValues,
    });
  }

  if (input.creator?.length) {
    filterConditions.push({
      className: "user",
      fieldIdentifier: "creator",
      format: "list",
      operator: "CONTAINS",
      toValue: null,
      value: input.creator,
    });
  }

  if (input.assignedTo?.length) {
    filterConditions.push({
      className: "user",
      fieldIdentifier: "assignedTo",
      format: "list",
      operator: "CONTAINS",
      toValue: null,
      value: input.assignedTo,
    });
  }

  const tags = input.tag ? toList(input.tag) : [];
  if (tags.length) {
    filterConditions.push({
      className: "label",
      fieldIdentifier: "label",
      format: "list",
      operator: "CONTAINS",
      toValue: null,
      value: tags,
    });
  }

  const workitemTypes = input.workitemType ? toList(input.workitemType) : [];
  if (workitemTypes.length) {
    filterConditions.push({
      className: "workitemType",
      fieldIdentifier: "workitemType",
      format: "list",
      operator: "CONTAINS",
      toValue: null,
      value: workitemTypes,
    });
  }

  const priorities = input.priority ? toList(input.priority) : [];
  if (priorities.length) {
    filterConditions.push({
      className: "priority",
      fieldIdentifier: "priority",
      format: "list",
      operator: "CONTAINS",
      toValue: null,
      value: priorities,
    });
  }

  if (filterConditions.length === 0) {
    return undefined;
  }

  return JSON.stringify({
    conditionGroups: [filterConditions],
  });
}

function isGatewayCompatibilityError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message;
  return (
    message.includes("returned HTML document unexpectedly") ||
    message.startsWith("Yunxiao API 404:")
  );
}

function toList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
