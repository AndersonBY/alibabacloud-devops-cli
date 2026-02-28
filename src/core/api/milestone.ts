import { YunxiaoApiClient } from "./client.js";
import { CliError } from "../errors.js";

export async function listMilestones(client: YunxiaoApiClient, input: {
  organizationId: string;
  projectId: string;
  status?: string[];
  page?: number;
  perPage?: number;
}): Promise<unknown> {
  return client.get(`/oapi/v1/projex/organizations/${input.organizationId}/projects/${input.projectId}/milestones`, {
    status: input.status?.join(","),
    page: input.page,
    perPage: input.perPage,
  });
}

export async function createMilestone(client: YunxiaoApiClient, input: {
  organizationId: string;
  projectId: string;
  subject: string;
  planEndDate: string;
  assignedTo: string;
  description?: string;
  operatorId?: string;
}): Promise<unknown> {
  return client.post(`/oapi/v1/projex/organizations/${input.organizationId}/projects/${input.projectId}/milestones`, {
    subject: input.subject,
    planEndDate: input.planEndDate,
    assignedTo: input.assignedTo,
    description: input.description,
    operatorId: input.operatorId,
  });
}

export async function updateMilestone(client: YunxiaoApiClient, input: {
  organizationId: string;
  projectId: string;
  milestoneId: string;
  subject?: string;
  planEndDate?: string;
  actualEndDate?: string;
  assignedTo?: string;
  description?: string;
  status?: string;
  operatorId?: string;
}): Promise<unknown> {
  return client.request(
    `/oapi/v1/projex/organizations/${input.organizationId}/projects/${input.projectId}/milestones/${input.milestoneId}`,
    {
      method: "PUT",
      body: {
        subject: input.subject,
        planEndDate: input.planEndDate,
        actualEndDate: input.actualEndDate,
        assignedTo: input.assignedTo,
        description: input.description,
        status: input.status,
        operatorId: input.operatorId,
      },
    }
  );
}

export async function deleteMilestone(client: YunxiaoApiClient, input: {
  organizationId: string;
  projectId: string;
  milestoneId: string;
  operatorId?: string;
}): Promise<{ method: string; result: unknown }> {
  const path = `/oapi/v1/projex/organizations/${input.organizationId}/projects/${input.projectId}/milestones/${input.milestoneId}`;
  const body = input.operatorId ? { operatorId: input.operatorId } : undefined;
  const candidates: Array<{ method: "DELETE" | "POST" | "PUT"; path: string; body?: unknown }> = [
    {
      method: "DELETE",
      path,
      body,
    },
    {
      method: "POST",
      path: `${path}/delete`,
      body,
    },
    {
      method: "PUT",
      path,
      body,
    },
  ];

  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      const result = await client.request(candidate.path, {
        method: candidate.method,
        body: candidate.body,
      });
      return {
        method: candidate.method,
        result,
      };
    } catch (error) {
      lastError = error;
      if (!isEndpointUnavailableError(error)) {
        throw error;
      }
    }
  }

  const suffix = lastError instanceof Error ? ` Last error: ${lastError.message}` : "";
  throw new CliError(`Failed to delete milestone ${input.milestoneId}.${suffix}`);
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
