import { YunxiaoApiClient } from "./client.js";

export async function listVersions(client: YunxiaoApiClient, input: {
  organizationId: string;
  projectId: string;
  status?: string[];
  page?: number;
  perPage?: number;
}): Promise<unknown> {
  return client.get(`/oapi/v1/projex/organizations/${input.organizationId}/projects/${input.projectId}/versions`, {
    status: input.status?.join(","),
    page: input.page,
    perPage: input.perPage,
  });
}

export async function createVersion(client: YunxiaoApiClient, input: {
  organizationId: string;
  projectId: string;
  name: string;
  owners: string[];
  startDate?: string;
  publishDate?: string;
  operatorId?: string;
}): Promise<unknown> {
  return client.post(`/oapi/v1/projex/organizations/${input.organizationId}/projects/${input.projectId}/versions`, {
    name: input.name,
    owners: input.owners,
    startDate: input.startDate,
    publishDate: input.publishDate,
    operatorId: input.operatorId,
  });
}

export async function updateVersion(client: YunxiaoApiClient, input: {
  organizationId: string;
  projectId: string;
  versionId: string;
  name: string;
  owners?: string[];
  startDate?: string;
  publishDate?: string;
  operatorId?: string;
}): Promise<unknown> {
  return client.request(
    `/oapi/v1/projex/organizations/${input.organizationId}/projects/${input.projectId}/versions/${input.versionId}`,
    {
      method: "PUT",
      body: {
        name: input.name,
        owners: input.owners,
        startDate: input.startDate,
        publishDate: input.publishDate,
        operatorId: input.operatorId,
      },
    }
  );
}

export async function deleteVersion(client: YunxiaoApiClient, input: {
  organizationId: string;
  projectId: string;
  versionId: string;
  operatorId?: string;
}): Promise<unknown> {
  return client.request(
    `/oapi/v1/projex/organizations/${input.organizationId}/projects/${input.projectId}/versions/${input.versionId}`,
    {
      method: "DELETE",
      body: input.operatorId ? { operatorId: input.operatorId } : undefined,
    }
  );
}
