import { CliError } from "../errors.js";
import { YxConfig } from "../config/schema.js";

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

type RequestOptions = {
  method?: HttpMethod;
  query?: Record<string, unknown>;
  body?: unknown;
  bodyType?: "json" | "form";
};

const READ_RETRY_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 250;
const RETRY_MAX_DELAY_MS = 1500;

export class YunxiaoApiClient {
  constructor(private readonly config: YxConfig) {}

  async get(path: string, query?: Record<string, unknown>): Promise<unknown> {
    return this.request(path, { method: "GET", query });
  }

  async post(path: string, body?: unknown, query?: Record<string, unknown>): Promise<unknown> {
    return this.request(path, { method: "POST", body, query });
  }

  async request(path: string, options: RequestOptions = {}): Promise<unknown> {
    const token = this.config.auth.token ?? process.env.YUNXIAO_ACCESS_TOKEN;
    if (!token) {
      throw new CliError("Missing token. Run `yx auth login --token <TOKEN>` first.");
    }

    const url = buildUrl(this.config.api.baseUrl, path, options.query ?? {});
    const method = options.method ?? "GET";
    const bodyType = options.bodyType ?? "json";
    const serializedBody =
      options.body === undefined
        ? undefined
        : bodyType === "form"
          ? encodeFormBody(options.body)
          : JSON.stringify(options.body);
    const contentType = bodyType === "form" ? "application/x-www-form-urlencoded" : "application/json";
    const maxAttempts = method === "GET" ? READ_RETRY_ATTEMPTS : 1;
    let lastError: CliError | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.config.api.timeoutMs);

      try {
        const response = await fetch(url, {
          method,
          headers: {
            "Accept": "application/json",
            "Content-Type": contentType,
            "x-yunxiao-token": token,
            "User-Agent": "yx-cli/0.1.0",
          },
          body: serializedBody,
          signal: controller.signal,
        });

        const body = await parseResponseBody(response);
        if (typeof body === "string" && looksLikeHtmlDocument(body)) {
          throw new CliError(formatHtmlGatewayError(response.status));
        }
        if (!response.ok) {
          throw new CliError(buildHttpErrorMessage(response.status, response.statusText, body));
        }

        const businessError = extractBusinessError(body);
        if (businessError) {
          throw new CliError(`Yunxiao API business error: ${businessError}`);
        }
        return body;
      } catch (error) {
        const normalized = normalizeRequestError(error, this.config.api.timeoutMs);
        lastError = normalized;
        if (attempt < maxAttempts && isRetryableReadError(normalized)) {
          await delay(calculateRetryDelay(attempt));
          continue;
        }
        throw normalized;
      } finally {
        clearTimeout(timeout);
      }
    }

    throw lastError ?? new CliError("Request failed unexpectedly.");
  }
}

export function withApiClient<T>(config: YxConfig, action: (client: YunxiaoApiClient) => Promise<T>): Promise<T> {
  const client = new YunxiaoApiClient(config);
  return action(client);
}

export function encodeRepositoryId(repositoryId: string): string {
  if (!repositoryId.includes("/")) {
    return repositoryId;
  }

  const [group, ...rest] = repositoryId.split("/");
  const repoName = rest.join("/");
  if (!group || !repoName) {
    return repositoryId;
  }

  return `${group}%2F${encodeURIComponent(repoName).replace(/\+/g, "%20")}`;
}

function buildUrl(baseUrl: string, path: string, query: Record<string, unknown>): string {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(`${normalizedBase}${normalizedPath}`);

  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }
    url.searchParams.append(key, String(value));
  }

  return url.toString();
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return response.json();
  }
  return response.text();
}

function extractErrorMessage(body: unknown): string | undefined {
  if (typeof body === "string") {
    return body;
  }
  if (!body || typeof body !== "object") {
    return undefined;
  }

  const map = body as Record<string, unknown>;
  const candidates = ["message", "errorMessage", "error", "msg"];
  for (const key of candidates) {
    const value = map[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return undefined;
}

function extractBusinessError(body: unknown): string | undefined {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return undefined;
  }

  const map = body as Record<string, unknown>;
  const success = map.success;
  const status = map.status;
  const httpStatusCode = map.httpStatusCode;

  const hasFailureFlag = success === false || status === false;
  const hasHttpFailure = typeof httpStatusCode === "number" && httpStatusCode >= 400;

  if (!hasFailureFlag && !hasHttpFailure) {
    return undefined;
  }

  const message = extractErrorMessage(body);
  const code = typeof map.errorCode === "string" && map.errorCode.trim() ? map.errorCode.trim() : undefined;
  const parts = [code, message].filter((item): item is string => Boolean(item));
  if (parts.length) {
    return parts.join(": ");
  }

  return "Unknown business failure";
}

function looksLikeHtmlDocument(content: string): boolean {
  const trimmed = content.trimStart().toLowerCase();
  return trimmed.startsWith("<!doctype html") || trimmed.startsWith("<html");
}

function formatHtmlGatewayError(status?: number): string {
  const prefix = typeof status === "number" ? `Yunxiao API ${status}: ` : "";
  return `${prefix}Yunxiao API returned HTML document unexpectedly. Check endpoint/path compatibility.`;
}

function buildHttpErrorMessage(status: number, statusText: string, body: unknown): string {
  const baseMessage = (extractErrorMessage(body) ?? statusText) || "Request failed";
  const normalized = truncateOneLine(baseMessage, 240);
  let hint = "";

  if (status === 400) {
    hint = " Check request parameters/body.";
  } else if (status === 401 || status === 403) {
    hint = " Check token validity and resource permissions.";
  } else if (status === 404 || status === 405) {
    hint = " Endpoint may be unavailable in current gateway/tenant.";
  } else if (status >= 500) {
    hint = " Server-side error; retry later.";
  }

  return `Yunxiao API ${status}: ${normalized}${hint}`;
}

function truncateOneLine(input: string, maxLength: number): string {
  const oneLine = input.replace(/\s+/g, " ").trim();
  if (!oneLine) {
    return "Request failed";
  }
  if (oneLine.length <= maxLength) {
    return oneLine;
  }
  return `${oneLine.slice(0, maxLength)}...`;
}

function normalizeRequestError(error: unknown, timeoutMs: number): CliError {
  if (error instanceof CliError) {
    return error;
  }
  if (error instanceof Error && error.name === "AbortError") {
    return new CliError(`Request timeout after ${timeoutMs}ms`);
  }
  return new CliError(`Request failed: ${String(error)}`);
}

function isRetryableReadError(error: CliError): boolean {
  const message = error.message;
  return (
    /^Yunxiao API 5\d{2}:/.test(message) ||
    message.startsWith("Request timeout after") ||
    message.startsWith("Request failed:")
  );
}

function calculateRetryDelay(attempt: number): number {
  const exponential = RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
  return Math.min(RETRY_MAX_DELAY_MS, exponential);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function encodeFormBody(body: unknown): string {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new CliError("Form body must be an object.");
  }

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }
    params.append(key, String(value));
  }
  return params.toString();
}
