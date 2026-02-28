import { YunxiaoApiClient } from "./client.js";

export async function listSprints(client: YunxiaoApiClient, input: {
  organizationId: string;
  projectId: string;
  status?: string[];
  page?: number;
  perPage?: number;
}): Promise<unknown> {
  return client.get(
    `/oapi/v1/projex/organizations/${input.organizationId}/projects/${input.projectId}/sprints`,
    {
      status: input.status?.join(","),
      page: input.page,
      perPage: input.perPage,
    }
  );
}

export async function getSprintInfo(client: YunxiaoApiClient, input: {
  organizationId: string;
  projectId: string;
  sprintId: string;
}): Promise<unknown> {
  return client.get(
    `/oapi/v1/projex/organizations/${input.organizationId}/projects/${input.projectId}/sprints/${input.sprintId}`
  );
}

export async function createSprint(client: YunxiaoApiClient, input: {
  organizationId: string;
  projectId: string;
  name: string;
  owners: string[];
  startDate?: string;
  endDate?: string;
  description?: string;
  capacityHours?: number;
  operatorId?: string;
}): Promise<unknown> {
  return client.post(
    `/oapi/v1/projex/organizations/${input.organizationId}/projects/${input.projectId}/sprints`,
    {
      name: input.name,
      owners: input.owners,
      startDate: input.startDate,
      endDate: input.endDate,
      description: input.description,
      capacityHours: input.capacityHours,
      operatorId: input.operatorId,
    }
  );
}

export async function updateSprint(client: YunxiaoApiClient, input: {
  organizationId: string;
  projectId: string;
  sprintId: string;
  name: string;
  owners?: string[];
  startDate?: string;
  endDate?: string;
  description?: string;
  capacityHours?: number;
  operatorId?: string;
}): Promise<unknown> {
  return client.request(
    `/oapi/v1/projex/organizations/${input.organizationId}/projects/${input.projectId}/sprints/${input.sprintId}`,
    {
      method: "PUT",
      body: {
        name: input.name,
        owners: input.owners,
        startDate: input.startDate,
        endDate: input.endDate,
        description: input.description,
        capacityHours: input.capacityHours,
        operatorId: input.operatorId,
      },
    }
  );
}
