import { YunxiaoApiClient } from "./client.js";
import { CliError } from "../errors.js";

type Condition = {
  className: string;
  fieldIdentifier: string;
  format: string;
  operator: string;
  toValue: string | null;
  value: string[];
};

export async function getCurrentUser(client: YunxiaoApiClient): Promise<unknown> {
  return client.get("/oapi/v1/platform/user");
}

export async function listUserOrganizations(client: YunxiaoApiClient): Promise<unknown> {
  return client.get("/oapi/v1/platform/organizations");
}

export async function listOrganizationMembers(client: YunxiaoApiClient, input: {
  organizationId: string;
  page?: number;
  perPage?: number;
}): Promise<unknown> {
  return client.get(`/oapi/v1/platform/organizations/${input.organizationId}/members`, {
    page: input.page,
    perPage: input.perPage,
  });
}

export async function listProjectRoles(client: YunxiaoApiClient, input: {
  organizationId: string;
  projectId: string;
}): Promise<unknown> {
  return client.get(`/oapi/v1/projex/organizations/${input.organizationId}/projects/${input.projectId}/roles`);
}

export async function listAllProjectRoles(client: YunxiaoApiClient, input: {
  organizationId: string;
}): Promise<unknown> {
  return client.get(`/oapi/v1/projex/organizations/${input.organizationId}/roles`);
}

export async function createProjectRole(client: YunxiaoApiClient, input: {
  organizationId: string;
  projectId: string;
  roleIds: string[];
}): Promise<unknown> {
  return client.post(`/oapi/v1/projex/organizations/${input.organizationId}/projects/${input.projectId}/roles`, {
    roleIds: input.roleIds,
  });
}

export async function deleteProjectRole(client: YunxiaoApiClient, input: {
  organizationId: string;
  projectId: string;
  roleIds: string[];
}): Promise<unknown> {
  return client.request(`/oapi/v1/projex/organizations/${input.organizationId}/projects/${input.projectId}/roles`, {
    method: "DELETE",
    body: {
      roleIds: input.roleIds,
    },
  });
}

export async function listProjectMembers(client: YunxiaoApiClient, input: {
  organizationId: string;
  projectId: string;
  name?: string;
  roleId?: string;
}): Promise<unknown> {
  return client.get(`/oapi/v1/projex/organizations/${input.organizationId}/projects/${input.projectId}/members`, {
    name: input.name,
    roleId: input.roleId,
  });
}

export async function createProjectMember(client: YunxiaoApiClient, input: {
  organizationId: string;
  projectId: string;
  roleId: string;
  userIds: string[];
  operatorId?: string;
}): Promise<unknown> {
  return client.post(`/oapi/v1/projex/organizations/${input.organizationId}/projects/${input.projectId}/members`, {
    roleId: input.roleId,
    userIds: input.userIds,
    operatorId: input.operatorId,
  });
}

export async function deleteProjectMember(client: YunxiaoApiClient, input: {
  organizationId: string;
  projectId: string;
  roleIds: string[];
  userId: string;
  operatorId?: string;
}): Promise<unknown> {
  const roleId = input.roleIds[0];
  const candidates: Array<Record<string, unknown>> = [
    {
      roleIds: input.roleIds,
      userId: input.userId,
      operatorId: input.operatorId,
    },
    {
      roleId,
      userId: input.userId,
      operatorId: input.operatorId,
    },
    {
      roleIds: input.roleIds,
      userIds: [input.userId],
      operatorId: input.operatorId,
    },
    {
      roleId,
      userIds: [input.userId],
      operatorId: input.operatorId,
    },
  ];

  let preferredError: unknown;
  let lastError: unknown;
  for (const body of candidates) {
    try {
      return await client.request(
        `/oapi/v1/projex/organizations/${input.organizationId}/projects/${input.projectId}/members`,
        {
          method: "DELETE",
          body,
        }
      );
    } catch (error) {
      if (!isNotFoundError(error)) {
        preferredError = error;
      }
      lastError = error;
    }
  }

  const finalError = preferredError ?? lastError;
  const suffix = finalError instanceof Error ? ` Last error: ${finalError.message}` : "";
  throw new CliError(`Failed to remove project member ${input.userId}.${suffix}`);
}

export async function searchProjects(client: YunxiaoApiClient, input: {
  organizationId: string;
  name?: string;
  status?: string;
  extraConditions?: string;
  orderBy?: string;
  sort?: string;
  page?: number;
  perPage?: number;
}): Promise<unknown> {
  const conditions = buildProjectConditions({
    name: input.name,
    status: input.status,
  });

  return client.post(`/oapi/v1/projex/organizations/${input.organizationId}/projects:search`, {
    conditions,
    extraConditions: input.extraConditions,
    orderBy: input.orderBy,
    sort: input.sort,
    page: input.page,
    perPage: input.perPage,
  });
}

export function buildProjectExtraConditions(scenario: "manage" | "participate" | "favorite", userId: string): string {
  let fieldIdentifier: string;

  switch (scenario) {
    case "manage":
      fieldIdentifier = "project.admin";
      break;
    case "participate":
      fieldIdentifier = "users";
      break;
    case "favorite":
      fieldIdentifier = "collectMembers";
      break;
    default:
      fieldIdentifier = "users";
      break;
  }

  return JSON.stringify({
    conditionGroups: [
      [
        {
          className: "user",
          fieldIdentifier,
          format: "multiList",
          operator: "CONTAINS",
          value: [userId],
        },
      ],
    ],
  });
}

export async function listProjectTemplates(client: YunxiaoApiClient, input: {
  organizationId: string;
  category?: string;
}): Promise<unknown[]> {
  const candidates: Array<() => Promise<unknown>> = [
    () =>
      client.get(`/oapi/v1/projex/organizations/${input.organizationId}/projectTemplates`, {
        category: input.category,
      }),
    () =>
      client.get(`/oapi/v1/projex/organizations/${input.organizationId}/projects/templates`, {
        category: input.category,
      }),
    () =>
      client.post(`/oapi/v1/projex/organizations/${input.organizationId}/projectTemplates:search`, {
        category: input.category,
      }),
  ];

  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      const response = await candidate();
      if (Array.isArray(response)) {
        return response;
      }
      if (!response || typeof response !== "object") {
        return [];
      }

      const map = response as Record<string, unknown>;
      for (const key of ["items", "result", "data", "records", "templates"]) {
        const value = map[key];
        if (Array.isArray(value)) {
          return value;
        }
      }

      return [];
    } catch (error) {
      lastError = error;
    }
  }

  const suffix = lastError instanceof Error ? ` Last error: ${lastError.message}` : "";
  throw new CliError(`Failed to list project templates for org ${input.organizationId}.${suffix}`);
}

export async function createProject(client: YunxiaoApiClient, input: {
  organizationId: string;
  name: string;
  templateId: string;
  identifier?: string;
  description?: string;
  scope?: "private" | "public";
  customCode?: string;
}): Promise<unknown> {
  const pathCandidates = [
    `/oapi/v1/projex/organizations/${input.organizationId}/projects`,
    `/oapi/v1/projex/organizations/${input.organizationId}/projects:create`,
    `/oapi/v1/projex/organizations/${input.organizationId}/projects/create`,
  ];
  const customCode = normalizeProjectCustomCode(input.customCode ?? input.identifier ?? input.name);
  const baseBody = {
    name: input.name,
    description: input.description,
    identifier: input.identifier,
    customCode,
    scope: input.scope ?? "private",
  };
  const bodyCandidates: Array<Record<string, unknown>> = [
    {
      ...baseBody,
      templateId: input.templateId,
    },
    {
      ...baseBody,
      templateIdentifier: input.templateId,
    },
    {
      ...baseBody,
      templateId: input.templateId,
      templateIdentifier: input.templateId,
    },
  ];

  let preferredError: unknown;
  let lastError: unknown;
  for (const path of pathCandidates) {
    for (const body of bodyCandidates) {
      try {
        return await client.post(path, body);
      } catch (error) {
        if (!isNotFoundError(error)) {
          preferredError = error;
        }
        lastError = error;
      }
    }
  }

  const finalError = preferredError ?? lastError;
  const suffix = finalError instanceof Error ? ` Last error: ${finalError.message}` : "";
  throw new CliError(`Failed to create project ${input.name}.${suffix}`);
}

export async function deleteProject(client: YunxiaoApiClient, input: {
  organizationId: string;
  projectId: string;
  name: string;
}): Promise<unknown> {
  const candidates: Array<{
    method: "DELETE" | "POST";
    path: string;
    body?: Record<string, unknown>;
  }> = [
    {
      method: "DELETE",
      path: `/oapi/v1/projex/organizations/${input.organizationId}/projects/${input.projectId}`,
      body: {
        name: input.name,
      },
    },
    {
      method: "POST",
      path: `/oapi/v1/projex/organizations/${input.organizationId}/projects/${input.projectId}:delete`,
      body: {
        name: input.name,
      },
    },
    {
      method: "POST",
      path: `/oapi/v1/projex/organizations/${input.organizationId}/projects/${input.projectId}/delete`,
      body: {
        name: input.name,
      },
    },
  ];

  let preferredError: unknown;
  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      return await client.request(candidate.path, {
        method: candidate.method,
        body: candidate.body,
      });
    } catch (error) {
      if (!isNotFoundError(error)) {
        preferredError = error;
      }
      lastError = error;
    }
  }

  const finalError = preferredError ?? lastError;
  const suffix = finalError instanceof Error ? ` Last error: ${finalError.message}` : "";
  throw new CliError(`Failed to delete project ${input.projectId}.${suffix}`);
}

function buildProjectConditions(input: {
  name?: string;
  status?: string;
}): string | undefined {
  const filterConditions: Condition[] = [];

  if (input.name) {
    filterConditions.push({
      className: "string",
      fieldIdentifier: "name",
      format: "input",
      operator: "CONTAINS",
      toValue: null,
      value: [input.name],
    });
  }

  if (input.status) {
    const statuses = toList(input.status);
    if (statuses.length) {
      filterConditions.push({
        className: "status",
        fieldIdentifier: "status",
        format: "list",
        operator: "CONTAINS",
        toValue: null,
        value: statuses,
      });
    }
  }

  if (filterConditions.length === 0) {
    return undefined;
  }

  return JSON.stringify({
    conditionGroups: [filterConditions],
  });
}

function toList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeProjectCustomCode(value: string): string {
  const letters = value
    .toUpperCase()
    .replace(/[^A-Z]/g, "")
    .slice(0, 6);

  if (letters.length >= 4) {
    return letters;
  }

  return `${letters}YXAA`.slice(0, 4);
}

function isNotFoundError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return error.message.includes("API 404") || error.message.includes("Not Found");
}
