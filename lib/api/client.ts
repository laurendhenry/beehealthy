import { Platform } from "react-native";

import { getApiBaseUrl } from "../config";

/**
 * Typed application API transport.
 *
 * Platform cookie rules (per integration plan):
 * - Native: await the Better Auth cookie via `cookieProvider` and send it as
 *   a `Cookie` header with `credentials: "omit"`.
 * - Web: never set `Cookie` manually and never call SecureStore; use
 *   `credentials: "include"` so the browser manages cookies.
 * - Presigned S3 requests use `authMode: "none"`: no cookies, no idempotency
 *   headers (separate unauthenticated storage requests).
 *
 * No bearer authentication is invented: the backend uses Better Auth session
 * cookies only. Nothing here logs cookies, passwords, or response bodies.
 */

export type ApiAuthMode = "app" | "none";

export interface ApiRequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** JSON-encodable body. Omit for GET/DELETE-without-body. */
  body?: unknown;
  /** Extra headers (e.g. `Idempotency-Key`). `Cookie` here is ignored on web. */
  headers?: Record<string, string>;
  /** AbortSignal passthrough for cancellation. */
  signal?: AbortSignal | null;
  /** Per-endpoint timeout in ms (default 15000; parse may pass longer). */
  timeoutMs?: number;
  /** `"none"` for presigned storage requests. Default `"app"`. */
  authMode?: ApiAuthMode;
}

export interface ResolvedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  credentials: RequestCredentials;
  body: string | undefined;
}

export interface TransportDeps {
  platform?: "web" | "native";
  baseUrl?: string;
  cookieProvider?: () => Promise<string | null>;
  fetchImpl?: typeof fetch;
}

let defaultCookieProvider: TransportDeps["cookieProvider"];

/** Configure native auth before rendering API consumers. Read cookies per request. */
export function configureTransport(options: Pick<TransportDeps, "cookieProvider">): void {
  defaultCookieProvider = options.cookieProvider;
}
/** Normalized application error preserving status/code/details/requestId. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId?: string;
  readonly details?: unknown;

  constructor(args: {
    status: number;
    code: string;
    message: string;
    requestId?: string;
    details?: unknown;
  }) {
    super(args.message);
    this.name = "ApiError";
    this.status = args.status;
    this.code = args.code;
    this.requestId = args.requestId;
    this.details = args.details;
  }

  get isUnauthenticated(): boolean {
    return this.status === 401 || this.code === "UNAUTHENTICATED";
  }
}

const DEFAULT_TIMEOUT_MS = 15000;
const REQUEST_ID_HEADERS = ["x-request-id", "x-amzn-requestid", "x-amz-request-id"];

function currentPlatform(deps?: TransportDeps): "web" | "native" {
  if (deps?.platform) return deps.platform;
  try {
    return Platform.OS === "web" ? "web" : "native";
  } catch {
    return "web";
  }
}

function readRequestId(headers: Headers): string | undefined {
  for (const name of REQUEST_ID_HEADERS) {
    const value = headers.get(name);
    if (value) return value;
  }
  return undefined;
}

/**
 * Pure request builder (no I/O): joins `baseUrl + path`, applies platform
 * cookie rules, and normalizes headers. Exported for offline contract tests.
 */
export async function buildApiRequest(
  path: string,
  options: ApiRequestOptions = {},
  deps: TransportDeps = {},
): Promise<ResolvedRequest> {
  if (!path.startsWith("/")) {
    throw new ApiError({
      status: 0,
      code: "UNKNOWN",
      message: `API path must start with "/": ${JSON.stringify(path)}`,
    });
  }
  const baseUrl = deps.baseUrl ?? getApiBaseUrl();
  const platform = currentPlatform(deps);
  const method = options.method ?? (options.body !== undefined ? "POST" : "GET");

  const headers: Record<string, string> = {};
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  for (const [key, value] of Object.entries(options.headers ?? {})) {
    const name = key.toLowerCase();
    if (name === "cookie" && (platform === "web" || options.authMode === "none")) continue;
    if (options.authMode === "none" && (name === "authorization" || name === "idempotency-key")) continue;
    headers[key] = value;
  }

  let credentials: RequestCredentials;
  if (options.authMode === "none") {
    credentials = "omit";
    delete headers["Cookie"];
  } else if (platform === "web") {
    // Browser-managed cookies; never set Cookie manually.
    credentials = "include";
  } else {
    credentials = "omit";
    const cookie = await (deps.cookieProvider ?? defaultCookieProvider)?.();
    if (cookie) headers["Cookie"] = cookie;
  }

  return {
    url: `${baseUrl}${path}`,
    method,
    headers,
    credentials,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  };
}

/** Parse a response: 204 → undefined; JSON when content-type allows; else text. */
async function parseBody(response: Response): Promise<unknown> {
  if (response.status === 204) return undefined;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("json")) {
    const text = await response.text().catch(() => "");
    return text ? { __nonJsonText: text } : undefined;
  }
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { __nonJsonText: text };
  }
}

function normalizeError(status: number, body: unknown, requestId?: string): ApiError {
  if (
    body &&
    typeof body === "object" &&
    "error" in body &&
    (body as { error: unknown }).error &&
    typeof (body as { error: unknown }).error === "object"
  ) {
    const envelope = (body as { error: { code?: unknown; message?: unknown; requestId?: unknown; details?: unknown } }).error;
    return new ApiError({
      status,
      code: typeof envelope.code === "string" ? envelope.code : "UNKNOWN",
      message: typeof envelope.message === "string" ? envelope.message : `Request failed with status ${status}`,
      requestId:
        typeof envelope.requestId === "string" ? envelope.requestId : requestId,
      details: envelope.details,
    });
  }
  if (body && typeof body === "object" && "__nonJsonText" in body) {
    return new ApiError({
      status,
      code: "UNKNOWN",
      message: `Request failed with status ${status} (non-JSON response)`,
      requestId,
    });
  }
  return new ApiError({
    status,
    code: status === 401 ? "UNAUTHENTICATED" : "UNKNOWN",
    message: `Request failed with status ${status}`,
    requestId,
  });
}

function combineSignals(
  signal: AbortSignal | null | undefined,
): { signal: AbortSignal; abort: () => void; cancel: () => void } {
  const controller = new AbortController();
  const onAbort = () => controller.abort(signal?.reason);
  if (signal) {
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener("abort", onAbort, { once: true });
  }
  return {
    signal: controller.signal,
    abort: () => controller.abort(),
    cancel: () => {
      signal?.removeEventListener("abort", onAbort);
    },
  };
}

/**
 * Execute a JSON application request against `${origin}/api${path}`.
 *
 * Returns `undefined` for 204 responses. Throws `ApiError` (with
 * status/code/requestId/details) for non-2xx, and `ApiError` with
 * `code: "NETWORK_ERROR"` when fetch itself fails. Never logs credentials.
 */
export async function apiRequest<T>(
  path: string,
  options: ApiRequestOptions = {},
  deps: TransportDeps = {},
): Promise<T> {
  const resolved = await buildApiRequest(path, options, deps);
  const fetchImpl = deps.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const { signal, abort, cancel } = combineSignals(options.signal);
  // Endpoint timeout: unlike a bare controller.abort(), this rejects even
  // when a fetch implementation ignores abort signals (offline tests stub
  // fetch, real runtimes settle via the aborted signal).
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      abort();
      reject(
        new ApiError({ status: 0, code: "NETWORK_ERROR", message: "Request timed out" }),
      );
    }, timeoutMs);
  });
  // Prevent an unhandled rejection when the fetch wins the race.
  timeoutPromise.catch(() => undefined);
  const abortedError = () => new ApiError({
    status: 0, code: "ABORTED", message: "Request cancelled",
  });
  let rejectAbort: (() => void) | undefined;
  const abortPromise = new Promise<never>((_, reject) => {
    rejectAbort = () => reject(abortedError());
    if (options.signal?.aborted) rejectAbort();
    else options.signal?.addEventListener("abort", rejectAbort, { once: true });
  });
  abortPromise.catch(() => undefined);
  let result: { response: Response; body: unknown };
  try {
    if (options.signal?.aborted) throw abortedError();
    result = await Promise.race([
      (async () => {
        const response = await fetchImpl(resolved.url, {
          method: resolved.method,
          headers: resolved.headers,
          credentials: resolved.credentials,
          body: resolved.body,
          signal,
        });
        return { response, body: await parseBody(response) };
      })(),
      timeoutPromise,
      abortPromise,
    ]);
  } catch (error) {
    cancel();
    if (options.signal?.aborted) throw abortedError();
    if (error instanceof ApiError) throw error;
    throw new ApiError({
      status: 0,
      code: "NETWORK_ERROR",
      message: error instanceof Error ? error.message : "Network request failed",
    });
  } finally {
    // Ensure the timeout timer is cleared even on success.
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    if (rejectAbort) options.signal?.removeEventListener("abort", rejectAbort);
    cancel();
  }
  if (options.signal?.aborted) throw abortedError();
  const { response, body } = result;
  const requestId = readRequestId(response.headers);
  if (!response.ok) {
    throw normalizeError(response.status, body, requestId);
  }
  return body as T;
}
