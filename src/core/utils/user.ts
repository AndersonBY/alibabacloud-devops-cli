import { YunxiaoApiClient } from "../api/client.js";

export async function resolveUserSelector(client: YunxiaoApiClient, selector?: string): Promise<string | undefined> {
  if (!selector) {
    return undefined;
  }

  const normalized = selector.trim();
  if (!normalized) {
    return undefined;
  }

  if (normalized.toLowerCase() !== "self") {
    return normalized;
  }

  return getCurrentUserId(client);
}

export async function resolveUserSelectors(client: YunxiaoApiClient, selectors?: string): Promise<string[] | undefined> {
  if (!selectors) {
    return undefined;
  }

  const parts = selectors
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  if (parts.length === 0) {
    return undefined;
  }

  let currentUserId: string | undefined;
  const result: string[] = [];

  for (const part of parts) {
    if (part.toLowerCase() !== "self") {
      result.push(part);
      continue;
    }

    if (!currentUserId) {
      currentUserId = await getCurrentUserId(client);
    }

    if (currentUserId) {
      result.push(currentUserId);
    }
  }

  return result.length ? result : undefined;
}

async function getCurrentUserId(client: YunxiaoApiClient): Promise<string | undefined> {
  const response = await client.get("/oapi/v1/platform/user");
  if (!response || typeof response !== "object" || Array.isArray(response)) {
    return undefined;
  }

  const id = (response as Record<string, unknown>).id;
  if (typeof id === "string" && id.trim()) {
    return id;
  }

  if (typeof id === "number") {
    return String(Math.round(id));
  }

  return undefined;
}
