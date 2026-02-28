import { YunxiaoApiClient } from "./client.js";
import { CliError } from "../errors.js";

export async function listPipelines(client: YunxiaoApiClient, input: {
  organizationId: string;
  pipelineName?: string;
  statusList?: string;
  page?: number;
  perPage?: number;
}): Promise<unknown> {
  return client.get(`/oapi/v1/flow/organizations/${input.organizationId}/pipelines`, {
    pipelineName: input.pipelineName,
    statusList: input.statusList,
    page: input.page,
    perPage: input.perPage,
  });
}

export async function getPipeline(client: YunxiaoApiClient, input: {
  organizationId: string;
  pipelineId: string;
}): Promise<unknown> {
  return client.get(`/oapi/v1/flow/organizations/${input.organizationId}/pipelines/${input.pipelineId}`);
}

export async function setPipelineEnabled(client: YunxiaoApiClient, input: {
  organizationId: string;
  pipelineId: string;
  enabled: boolean;
}): Promise<unknown> {
  const action = input.enabled ? "enable" : "disable";
  const candidates: Array<{ method: "PUT" | "POST"; path: string; body?: unknown }> = [
    {
      method: "PUT",
      path: `/oapi/v1/flow/organizations/${input.organizationId}/pipelines/${input.pipelineId}/${action}`,
    },
    {
      method: "POST",
      path: `/oapi/v1/flow/organizations/${input.organizationId}/pipelines/${input.pipelineId}/${action}`,
    },
    {
      method: "PUT",
      path: `/oapi/v1/flow/organizations/pipelines/${input.pipelineId}/${action}`,
    },
    {
      method: "POST",
      path: `/oapi/v1/flow/organizations/pipelines/${input.pipelineId}/${action}`,
    },
    {
      method: "PUT",
      path: `/oapi/v1/flow/organizations/${input.organizationId}/pipelines/${input.pipelineId}/switch`,
      body: { enabled: input.enabled },
    },
    {
      method: "PUT",
      path: `/oapi/v1/flow/organizations/${input.organizationId}/pipelines/${input.pipelineId}/trigger`,
      body: { enabled: input.enabled, isTrigger: input.enabled },
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
  throw new CliError(`Failed to ${action} workflow ${input.pipelineId}.${suffix}`);
}

export async function listPipelineRuns(client: YunxiaoApiClient, input: {
  organizationId: string;
  pipelineId: string;
  page?: number;
  perPage?: number;
  status?: string;
}): Promise<unknown> {
  return client.get(`/oapi/v1/flow/organizations/${input.organizationId}/pipelines/${input.pipelineId}/runs`, {
    page: input.page,
    perPage: input.perPage,
    status: input.status,
  });
}

export async function getPipelineRun(client: YunxiaoApiClient, input: {
  organizationId: string;
  pipelineId: string;
  runId: string;
}): Promise<unknown> {
  return client.get(`/oapi/v1/flow/organizations/${input.organizationId}/pipelines/${input.pipelineId}/runs/${input.runId}`);
}

export async function stopPipelineRun(client: YunxiaoApiClient, input: {
  organizationId: string;
  pipelineId: string;
  runId: string;
}): Promise<unknown> {
  const candidates = [
    `/oapi/v1/flow/organizations/${input.organizationId}/pipelines/${input.pipelineId}/runs/${input.runId}/stop`,
    `/oapi/v1/flow/organizations/${input.organizationId}/pipelines/${input.pipelineId}/pipelineRuns/${input.runId}/stop`,
    `/oapi/v1/flow/organizations/pipelines/${input.pipelineId}/runs/${input.runId}`,
  ];

  let lastError: unknown;
  for (const path of candidates) {
    try {
      return await client.request(path, {
        method: "PUT",
      });
    } catch (error) {
      lastError = error;
    }
  }

  const suffix = lastError instanceof Error ? ` Last error: ${lastError.message}` : "";
  throw new CliError(`Failed to cancel run ${input.runId}.${suffix}`);
}

export async function retryPipelineJobRun(client: YunxiaoApiClient, input: {
  organizationId: string;
  pipelineId: string;
  runId: string;
  jobId: string;
}): Promise<unknown> {
  const candidates = [
    `/oapi/v1/flow/organizations/${input.organizationId}/pipelines/${input.pipelineId}/pipelineRuns/${input.runId}/jobs/${input.jobId}/retry`,
    `/oapi/v1/flow/organizations/${input.organizationId}/pipelines/${input.pipelineId}/pipelineRuns/${input.runId}/jobs/${input.jobId}`,
    `/oapi/v1/flow/organizations/pipelines/${input.pipelineId}/pipelineRuns/${input.runId}/jobs/${input.jobId}/retry`,
  ];

  let lastError: unknown;
  for (const path of candidates) {
    try {
      return await client.request(path, {
        method: "PUT",
      });
    } catch (error) {
      lastError = error;
    }
  }

  const suffix = lastError instanceof Error ? ` Last error: ${lastError.message}` : "";
  throw new CliError(`Failed to retry job ${input.jobId} of run ${input.runId}.${suffix}`);
}

export async function getPipelineJobRunLog(client: YunxiaoApiClient, input: {
  organizationId: string;
  pipelineId: string;
  runId: string;
  jobId: string;
}): Promise<unknown> {
  const candidates = [
    `/oapi/v1/flow/organizations/${input.organizationId}/pipelines/${input.pipelineId}/runs/${input.runId}/job/${input.jobId}/log`,
    `/oapi/v1/flow/organizations/${input.organizationId}/pipelines/${input.pipelineId}/pipelineRuns/${input.runId}/jobs/${input.jobId}/logs`,
    `/oapi/v1/flow/organizations/pipelines/${input.pipelineId}/runs/${input.runId}/job/${input.jobId}/log`,
    `/oapi/v1/flow/organizations/pipelines/${input.pipelineId}/pipelineRuns/${input.runId}/jobs/${input.jobId}/logs`,
  ];

  let lastError: unknown;
  for (const path of candidates) {
    try {
      return await client.request(path, {
        method: "GET",
      });
    } catch (error) {
      lastError = error;
    }
  }

  const suffix = lastError instanceof Error ? ` Last error: ${lastError.message}` : "";
  throw new CliError(`Failed to get logs for job ${input.jobId} of run ${input.runId}.${suffix}`);
}

export async function getPipelineArtifactUrl(client: YunxiaoApiClient, input: {
  organizationId: string;
  pipelineId: string;
  runId: string;
  fileName?: string;
  filePath?: string;
}): Promise<unknown> {
  const query = {
    fileName: input.fileName,
    filePath: input.filePath,
  };
  const body = {
    pipelineId: input.pipelineId,
    pipelineRunId: input.runId,
    fileName: input.fileName,
    filePath: input.filePath,
  };

  const candidates: Array<{ method: "GET" | "POST"; path: string; query?: Record<string, unknown>; body?: unknown }> = [
    {
      method: "GET",
      path: `/oapi/v1/flow/organizations/${input.organizationId}/pipelines/${input.pipelineId}/runs/${input.runId}/artifacts/url`,
      query,
    },
    {
      method: "GET",
      path: `/oapi/v1/flow/organizations/${input.organizationId}/pipelines/${input.pipelineId}/runs/${input.runId}/artifactUrl`,
      query,
    },
    {
      method: "POST",
      path: `/oapi/v1/flow/organizations/${input.organizationId}/pipelines/${input.pipelineId}/runs/${input.runId}/artifacts/getUrl`,
      query,
      body,
    },
    {
      method: "POST",
      path: `/oapi/v1/flow/organizations/${input.organizationId}/pipeline/getArtifactDownloadUrl`,
      query,
      body,
    },
    {
      method: "POST",
      path: `/oapi/v1/flow/organization/${input.organizationId}/pipeline/getArtifactDownloadUrl`,
      query,
      body,
    },
    {
      method: "POST",
      path: `/oapi/v1/organization/${input.organizationId}/pipeline/getArtifactDownloadUrl`,
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
  throw new CliError(`Failed to resolve artifact download URL for run ${input.runId}.${suffix}`);
}

export async function createPipelineRun(client: YunxiaoApiClient, input: {
  organizationId: string;
  pipelineId: string;
  params?: unknown;
  description?: string;
  branches?: string[];
}): Promise<unknown> {
  if (input.params !== undefined) {
    return client.post(`/oapi/v1/flow/organizations/${input.organizationId}/pipelines/${input.pipelineId}/runs`, {
      params: input.params,
    });
  }

  const paramsObject: Record<string, unknown> = {};
  if (input.branches?.length) {
    paramsObject.branchModeBranchs = input.branches;
  }

  if (input.description) {
    const lowered = input.description.toLowerCase();
    if ((lowered.includes("create release") || lowered.includes("创建release")) && paramsObject.needCreateBranch === undefined) {
      paramsObject.needCreateBranch = true;
    }
  }

  const body = Object.keys(paramsObject).length > 0 ? { params: JSON.stringify(paramsObject) } : {};
  return client.post(`/oapi/v1/flow/organizations/${input.organizationId}/pipelines/${input.pipelineId}/runs`, body);
}
