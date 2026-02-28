import { YunxiaoApiClient } from "./client.js";
import { createRepositoryTag, deleteRepositoryTag, listRepositoryTags } from "./repo.js";
import { CliError } from "../errors.js";

export async function listReleases(client: YunxiaoApiClient, input: {
  organizationId: string;
  repositoryId: string;
  page?: number;
  perPage?: number;
  search?: string;
}): Promise<Record<string, unknown>[]> {
  const response = await listRepositoryTags(client, {
    organizationId: input.organizationId,
    repositoryId: input.repositoryId,
    page: input.page,
    perPage: input.perPage,
    search: input.search,
  });
  return extractTagRecords(response).map((tag) => normalizeRelease(tag));
}

export async function getRelease(client: YunxiaoApiClient, input: {
  organizationId: string;
  repositoryId: string;
  tag: string;
}): Promise<Record<string, unknown>> {
  const response = await listRepositoryTags(client, {
    organizationId: input.organizationId,
    repositoryId: input.repositoryId,
    search: input.tag,
    perPage: 100,
  });
  const tags = extractTagRecords(response);
  const matched = tags.find((tag) => readString(tag, ["name", "tagName", "tag"]) === input.tag);
  if (!matched) {
    throw new CliError(`Release not found for tag: ${input.tag}`);
  }
  return normalizeRelease(matched);
}

export async function createRelease(client: YunxiaoApiClient, input: {
  organizationId: string;
  repositoryId: string;
  tag: string;
  ref: string;
  message?: string;
}): Promise<Record<string, unknown>> {
  const response = await createRepositoryTag(client, {
    organizationId: input.organizationId,
    repositoryId: input.repositoryId,
    tag: input.tag,
    ref: input.ref,
    message: input.message,
  });
  if (!isRecord(response)) {
    throw new CliError("Unexpected release create response.");
  }
  return normalizeRelease(response);
}

export async function deleteRelease(client: YunxiaoApiClient, input: {
  organizationId: string;
  repositoryId: string;
  tag: string;
}): Promise<unknown> {
  return deleteRepositoryTag(client, {
    organizationId: input.organizationId,
    repositoryId: input.repositoryId,
    tag: input.tag,
  });
}

function normalizeRelease(tag: Record<string, unknown>): Record<string, unknown> {
  const tagName = readString(tag, ["name", "tagName", "tag"]);
  const message = readString(tag, ["message", "description", "notes"]);
  const release = isRecord(tag.release) ? tag.release : undefined;
  const releaseTitle = release ? readString(release, ["title", "name"]) : undefined;
  const releaseNotes = release ? readString(release, ["description", "body", "notes"]) : undefined;

  const commit = isRecord(tag.commit) ? tag.commit : undefined;
  const commitSha = commit ? readString(commit, ["id", "sha"]) : undefined;
  const commitDate = commit ? readString(commit, ["committedDate", "authoredDate"]) : undefined;

  return {
    tagName,
    title: releaseTitle ?? tagName ?? null,
    notes: releaseNotes ?? message ?? null,
    createdAt: readString(tag, ["createdAt", "updatedAt"]) ?? commitDate ?? null,
    commitSha: commitSha ?? null,
    source: "tag",
    release: release ?? null,
  };
}

function extractTagRecords(response: unknown): Record<string, unknown>[] {
  if (Array.isArray(response)) {
    return response.filter(isRecord);
  }

  if (!isRecord(response)) {
    return [];
  }

  for (const key of ["data", "items", "result", "records"]) {
    const value = response[key];
    if (Array.isArray(value)) {
      return value.filter(isRecord);
    }
  }

  return [];
}

function readString(value: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const current = value[key];
    if (typeof current === "string") {
      const normalized = current.trim();
      if (normalized) {
        return normalized;
      }
    }
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
