import { YunxiaoApiClient } from "./client.js";

export async function listTestPlans(client: YunxiaoApiClient, input: {
  organizationId: string;
}): Promise<unknown> {
  return client.post(`/oapi/v1/projex/organizations/${input.organizationId}/testPlan/list`, {});
}

export async function listTestCases(client: YunxiaoApiClient, input: {
  organizationId: string;
  testRepoId: string;
  page?: number;
  perPage?: number;
  orderBy?: string;
  sort?: string;
  directoryId?: string;
  conditions?: string;
}): Promise<unknown> {
  return client.post(`/oapi/v1/testhub/organizations/${input.organizationId}/testRepos/${input.testRepoId}/testcases:search`, {
    page: input.page,
    perPage: input.perPage,
    orderBy: input.orderBy,
    sort: input.sort,
    directoryId: input.directoryId,
    conditions: input.conditions,
  });
}

export async function getTestCase(client: YunxiaoApiClient, input: {
  organizationId: string;
  testRepoId: string;
  testcaseId: string;
}): Promise<unknown> {
  return client.get(`/oapi/v1/testhub/organizations/${input.organizationId}/testRepos/${input.testRepoId}/testcases/${input.testcaseId}`);
}

export async function listTestResults(client: YunxiaoApiClient, input: {
  organizationId: string;
  testPlanIdentifier: string;
  directoryIdentifier: string;
}): Promise<unknown> {
  try {
    return await client.post(`/oapi/v1/projex/organizations/${input.organizationId}/${input.testPlanIdentifier}/result/list/${input.directoryIdentifier}`, {});
  } catch {
    return client.post(`/oapi/v1/testhub/organizations/${input.organizationId}/${input.testPlanIdentifier}/result/list/${input.directoryIdentifier}`, {});
  }
}
