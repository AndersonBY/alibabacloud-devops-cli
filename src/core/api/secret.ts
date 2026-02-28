import { CliError } from "../errors.js";
import { YunxiaoApiClient } from "./client.js";

export type FlowVariableGroupVariable = {
  name?: string;
  value?: string;
  isEncrypted?: boolean;
};

export type FlowVariableGroup = {
  id: number;
  name: string;
  description?: string;
  createTime?: number;
  updateTime?: number;
  variables: FlowVariableGroupVariable[];
};

export async function listFlowVariableGroups(client: YunxiaoApiClient, input: {
  organizationId: string;
  maxResults?: number;
  nextToken?: string;
}): Promise<FlowVariableGroup[]> {
  const response = await client.get(`/oapi/v1/flow/organizations/${input.organizationId}/variableGroups`, {
    maxResults: input.maxResults,
    nextToken: input.nextToken,
  });
  return normalizeFlowVariableGroups(response);
}

export async function getFlowVariableGroup(client: YunxiaoApiClient, input: {
  organizationId: string;
  id: number;
}): Promise<FlowVariableGroup> {
  const response = await client.get(`/oapi/v1/flow/organizations/${input.organizationId}/variableGroups/${input.id}`);
  const groups = normalizeFlowVariableGroups([response]);
  if (!groups[0]) {
    throw new CliError(`Variable group not found: ${input.id}`);
  }
  return groups[0];
}

export async function createFlowVariableGroup(client: YunxiaoApiClient, input: {
  organizationId: string;
  name: string;
  description?: string;
  variables: string;
}): Promise<number> {
  const response = await client.request(`/oapi/v1/flow/organizations/${input.organizationId}/variableGroups`, {
    method: "POST",
    bodyType: "form",
    body: {
      name: input.name,
      description: input.description,
      variables: input.variables,
    },
  });

  const id = typeof response === "number" ? response : Number(response);
  if (!Number.isFinite(id)) {
    throw new CliError("Unexpected create variable group response.");
  }
  return id;
}

export async function updateFlowVariableGroup(client: YunxiaoApiClient, input: {
  organizationId: string;
  id: number;
  name: string;
  description?: string;
  variables: string;
}): Promise<boolean> {
  const response = await client.request(`/oapi/v1/flow/organizations/${input.organizationId}/variableGroups/${input.id}`, {
    method: "PUT",
    bodyType: "form",
    body: {
      name: input.name,
      description: input.description,
      variables: input.variables,
    },
  });

  if (typeof response === "boolean") {
    return response;
  }
  if (typeof response === "string") {
    return response.toLowerCase() === "true";
  }
  return true;
}

export async function deleteFlowVariableGroup(client: YunxiaoApiClient, input: {
  organizationId: string;
  id: number;
}): Promise<boolean> {
  const response = await client.request(`/oapi/v1/flow/organizations/${input.organizationId}/variableGroups/${input.id}`, {
    method: "DELETE",
  });

  if (typeof response === "boolean") {
    return response;
  }
  if (typeof response === "string") {
    return response.toLowerCase() === "true";
  }
  return true;
}

function normalizeFlowVariableGroups(input: unknown): FlowVariableGroup[] {
  const rawGroups = extractGroupArray(input);
  return rawGroups
    .map((item) => normalizeFlowVariableGroup(item))
    .filter((item): item is FlowVariableGroup => item !== null);
}

function extractGroupArray(input: unknown): Record<string, unknown>[] {
  if (Array.isArray(input)) {
    return input.filter(isRecord);
  }

  if (!isRecord(input)) {
    return [];
  }

  const candidates = [input.variableGroups, input.records, input.result, input.items];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate.filter(isRecord);
    }
  }

  if (typeof input.id === "number" && typeof input.name === "string") {
    return [input];
  }

  return [];
}

function normalizeFlowVariableGroup(input: Record<string, unknown>): FlowVariableGroup | null {
  const id = typeof input.id === "number" ? input.id : Number(input.id);
  const name = typeof input.name === "string" ? input.name : "";
  if (!Number.isFinite(id) || !name) {
    return null;
  }

  const variables: FlowVariableGroupVariable[] = Array.isArray(input.variables)
    ? input.variables
        .filter(isRecord)
        .map((item) => ({
          name: typeof item.name === "string" ? item.name : undefined,
          value: typeof item.value === "string" ? item.value : undefined,
          isEncrypted: typeof item.isEncrypted === "boolean" ? item.isEncrypted : undefined,
        }))
    : [];

  return {
    id,
    name,
    description: typeof input.description === "string" ? input.description : undefined,
    createTime: typeof input.createTime === "number" ? input.createTime : undefined,
    updateTime: typeof input.updateTime === "number" ? input.updateTime : undefined,
    variables,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
