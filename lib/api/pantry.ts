/**
 * Pantry + basket + current-user transport.
 *
 * Ownership: home/pantry/profile scope (plan sections 4, 6, 7, 8, 10-M4).
 * Self-contained transport on purpose: the shared foundation modules
 * (`lib/config.ts`, `lib/auth-client.ts`, `lib/api/client.ts`,
 * `lib/api/users.ts`) are owned by Agent A and may not exist yet, so this
 * module implements the plan-specified transport inline (origin handling,
 * credentials, timeouts, 204/non-JSON/error normalization) and exposes
 * `configureApi()` as the wiring point Agent A will connect. No mock data,
 * no mock fallback: every production path performs a real request and
 * surfaces failures to the caller.
 *
 * Endpoint contracts (all paths relative to `/api`, per plan section 4):
 * - GET    /pantry                limit/cursor/optional status (default available)
 * - PATCH  /pantry/:id            absolute quantity and/or expires_at (response uses expiresAt)
 * - POST   /pantry/:id/consume    {"qty":"0.500"} or {"all":true}; NOT idempotency protected
 * - POST   /pantry/:id/remove     204, no body
 * - DELETE /pantry/:id/remove     204 alias of the above
 * - GET    /basket/summary        optional date-only from/to
 * - GET    /users/me              {id,name,email,image,profile}
 * - PATCH  /users/me/profile      partial update, preserves omitted fields
 * - DELETE /users/me/profile      204 preference reset, not account deletion
 *
 * NOTE (ownership): the three user/profile functions below live here only
 * until Agent A's `lib/api/users.ts` lands; that module may re-export them
 * from here. The profile screen and home data consume them via this module.
 */

// ---------------------------------------------------------------------------
// Error model
// ---------------------------------------------------------------------------

export type ApiErrorCode =
  | "CONFIGURATION_ERROR"
  | "NETWORK_ERROR"
  | "TIMEOUT"
  | "UNAUTHORIZED"
  | "NOT_FOUND"
  | "VERSION_CONFLICT"
  | "INVALID_CURSOR"
  | "VALIDATION_ERROR"
  | "CONFLICT"
  | "QUOTA_EXCEEDED"
  | "GATEWAY_ERROR"
  | "UNKNOWN_ERROR";

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number | null;
  readonly requestId: string | null;
  readonly details: unknown;

  constructor(
    code: ApiErrorCode,
    message: string,
    options?: { status?: number | null; requestId?: string | null; details?: unknown },
  ) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = options?.status ?? null;
    this.requestId = options?.requestId ?? null;
    this.details = options?.details ?? undefined;
  }
}

/** True when the failure means the mutation outcome on the server is unknown. */
export function isUnknownOutcome(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.code === "TIMEOUT" || error.code === "NETWORK_ERROR")
  );
}

export function isInvalidCursor(error: unknown): boolean {
  return error instanceof ApiError && error.code === "INVALID_CURSOR";
}

// ---------------------------------------------------------------------------
// Configuration / wiring
// ---------------------------------------------------------------------------

export type CookieProvider = () => Promise<string | null>;

let cookieProvider: CookieProvider | null = null;
let originOverride: string | null = null;

/**
 * Wiring point for Agent A's auth foundation. When provided, the returned
 * cookie header is attached to native (non-web) requests. Web always relies
 * on browser-managed cookies (`credentials: "include"`) and never sets a
 * Cookie header manually.
 *
 * Assumed Agent A signature: `authClient.getCookie(): Promise<string | null>`
 * backed by SecureStore on native. Until wired, native requests are sent
 * without a manual cookie header and the server answers 401 if no session
 * cookie is present — surfaced, never mocked.
 */
export function configureApi(options: {
  getCookieHeader?: CookieProvider | null;
  origin?: string | null;
}): void {
  if (options.getCookieHeader !== undefined) {
    cookieProvider = options.getCookieHeader;
  }
  if (options.origin !== undefined) {
    originOverride = options.origin;
  }
}

/**
 * Normalize and validate the public API origin. Accepts a bare origin only
 * (scheme + host + optional port). Rejects paths, queries, and missing
 * configuration; rejects non-HTTPS origins except loopback/local hosts.
 * Throws ApiError(CONFIGURATION_ERROR) — callers render a configuration
 * error, never a production fallback.
 */
export function normalizeOrigin(raw: string | undefined | null): string {
  const value = (originOverride ?? raw ?? "").trim();
  if (!value) {
    throw new ApiError(
      "CONFIGURATION_ERROR",
      "The API origin is not configured. Set EXPO_PUBLIC_API_ORIGIN to the authorized backend origin.",
    );
  }
  const withoutSlash = value.replace(/\/+$/, "");
  let parsed: URL;
  try {
    parsed = new URL(withoutSlash);
  } catch {
    throw new ApiError(
      "CONFIGURATION_ERROR",
      "The API origin is not a valid URL.",
    );
  }
  if (parsed.pathname !== "/" && parsed.pathname !== "") {
    throw new ApiError(
      "CONFIGURATION_ERROR",
      "The API origin must not contain a path. Use a bare origin such as https://api.example.test.",
    );
  }
  if (parsed.search !== "" || parsed.hash !== "") {
    throw new ApiError(
      "CONFIGURATION_ERROR",
      "The API origin must not contain a query string or fragment.",
    );
  }
  const host = parsed.hostname.toLowerCase();
  const isLocal =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host.endsWith(".local");
  if (parsed.protocol !== "https:" && !isLocal) {
    throw new ApiError(
      "CONFIGURATION_ERROR",
      "Production API origins must use HTTPS.",
    );
  }
  return `${parsed.protocol}//${parsed.host}`;
}

export function getApiOrigin(): string {
  const raw =
    typeof process !== "undefined"
      ? process.env?.EXPO_PUBLIC_API_ORIGIN
      : undefined;
  return normalizeOrigin(raw ?? null);
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

export type ApiRequestOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  signal?: AbortSignal | null;
  /** Per-endpoint timeout in ms. Defaults to 15s. */
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 15000;

function statusToCode(status: number, serverCode?: string): ApiErrorCode {
  if (serverCode === "INVALID_CURSOR") return "INVALID_CURSOR";
  if (status === 401) return "UNAUTHORIZED";
  if (status === 404) return "NOT_FOUND";
  if (status === 409) return "VERSION_CONFLICT";
  if (status === 422) return "VALIDATION_ERROR";
  if (status === 429) return "QUOTA_EXCEEDED";
  return "UNKNOWN_ERROR";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Core JSON transport. Handles 204 without JSON parsing, non-JSON gateway
 * failures, AbortSignal + timeouts, and preserves status/error code/
 * validation details/request ID. Never logs cookies or payloads.
 */
export async function apiRequest<T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  const origin = getApiOrigin();
  const method = options.method ?? "GET";
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const controller = new AbortController();
  const onAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers: Record<string, string> = {};
    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
    }
    // Native only: attach the session cookie when a provider is wired.
    // Web uses browser-managed cookies; never set Cookie manually there.
    const isWeb =
      typeof window !== "undefined" &&
      typeof window.document !== "undefined";
    if (!isWeb && cookieProvider) {
      try {
        const cookie = await cookieProvider();
        if (cookie) headers["Cookie"] = cookie;
      } catch {
        // Cookie retrieval failure degrades to an unauthenticated request;
        // the server 401 path handles it. Never fabricate a session.
      }
    }

    let response: Response;
    try {
      response = await fetch(`${origin}/api${path}`, {
        method,
        headers,
        credentials: isWeb ? "include" : "omit",
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted && !options.signal?.aborted) {
        throw new ApiError(
          "TIMEOUT",
          `The request timed out after ${timeoutMs} ms. The outcome is unknown — reconcile before retrying.`,
        );
      }
      if (error instanceof Error && error.name === "AbortError") {
        throw error;
      }
      throw new ApiError(
        "NETWORK_ERROR",
        "The network request failed. Previously loaded data is still shown where available.",
      );
    }

    const requestId = response.headers?.get?.("X-Request-Id") ?? null;
    if (response.status === 204) {
      return undefined as T;
    }
    const contentType = response.headers?.get?.("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      const text = await response.text().catch(() => "");
      void text;
      throw new ApiError(
        "GATEWAY_ERROR",
        "The server returned an unexpected response. Please try again.",
        { status: response.status, requestId },
      );
    }
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const nested = isRecord(payload) ? payload["error"] : null;
      const serverCode =
        (isRecord(nested) && typeof nested["code"] === "string"
          ? (nested["code"] as string)
          : undefined) ??
        (isRecord(payload) && typeof payload["code"] === "string"
          ? (payload["code"] as string)
          : undefined);
      const message =
        (isRecord(nested) && typeof nested["message"] === "string"
          ? (nested["message"] as string)
          : undefined) ??
        "The request failed. Please try again.";
      const details = isRecord(nested) ? nested["details"] : undefined;
      throw new ApiError(statusToCode(response.status, serverCode), message, {
        status: response.status,
        requestId:
          (isRecord(nested) && typeof nested["requestId"] === "string"
            ? (nested["requestId"] as string)
            : null) ?? requestId,
        details,
      });
    }
    return payload as T;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
  }
}

/** Encode a flat query object, skipping undefined/null/empty values. */
export function buildQuery(
  params: Record<string, string | number | undefined | null>,
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

// ---------------------------------------------------------------------------
// Wire DTOs (frontend copies of the plan section 4 / backend contracts)
// ---------------------------------------------------------------------------

export type PantryStatus = "available" | "consumed" | "removed" | "expired";

export type PantryItem = {
  id: string;
  name: string;
  /** Decimal-string quantity, up to three decimals, e.g. "1.500". */
  quantityRemaining: string;
  /** Currently always "item"; never infer grams/servings/intake. */
  unit: string;
  expiresAt: string | null;
  status: PantryStatus;
  foodId: string | null;
  receiptItemId: string;
  createdAt: string;
  updatedAt: string;
};

export type PantryPage = {
  items: PantryItem[];
  nextCursor: string | null;
};

export type BasketCategory = {
  id: string;
  label: string;
  count: number;
};

/**
 * Honest basket semantics: counts AVAILABLE pantry rows joined to eligible
 * confirmed receipts — not purchased quantities, portions, or history.
 */
export type BasketSummary = {
  categories: BasketCategory[];
  receiptCount: number;
  itemCount: number;
};

export type UserProfile = {
  locale: "en-US";
  timezone: string;
  preferredCurrency: "USD";
  dietaryPreferences: string[];
  excludedIngredients: string[];
  preferencesJson: Record<string, unknown>;
};

export type CurrentUser = {
  id: string;
  name: string;
  email: string;
  image: string | null;
  profile: UserProfile;
};

function assertRecord(value: unknown, what: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new ApiError("GATEWAY_ERROR", `Unexpected ${what} response shape.`);
  }
  return value;
}

function assertPantryItem(value: unknown): PantryItem {
  const row = assertRecord(value, "pantry");
  if (
    typeof row["id"] !== "string" ||
    typeof row["name"] !== "string" ||
    typeof row["quantityRemaining"] !== "string" ||
    typeof row["status"] !== "string"
  ) {
    throw new ApiError("GATEWAY_ERROR", "Unexpected pantry item shape.");
  }
  return value as PantryItem;
}

function assertBasketSummary(value: unknown): BasketSummary {
  const row = assertRecord(value, "basket summary");
  if (
    !Array.isArray(row["categories"]) ||
    typeof row["receiptCount"] !== "number" ||
    typeof row["itemCount"] !== "number"
  ) {
    throw new ApiError("GATEWAY_ERROR", "Unexpected basket summary shape.");
  }
  return value as BasketSummary;
}

function assertCurrentUser(value: unknown): CurrentUser {
  const row = assertRecord(value, "user");
  if (
    typeof row["id"] !== "string" ||
    typeof row["name"] !== "string" ||
    typeof row["email"] !== "string"
  ) {
    throw new ApiError("GATEWAY_ERROR", "Unexpected user response shape.");
  }
  return value as CurrentUser;
}

function assertProfile(value: unknown): UserProfile {
  const row = assertRecord(value, "profile");
  if (!isRecord(row["profile"])) {
    throw new ApiError("GATEWAY_ERROR", "Unexpected profile response shape.");
  }
  return row["profile"] as UserProfile;
}

// ---------------------------------------------------------------------------
// Pantry / basket endpoints
// ---------------------------------------------------------------------------

export async function listPantry(
  options: {
    limit?: number;
    cursor?: string | null;
    status?: PantryStatus;
    signal?: AbortSignal | null;
  } = {},
): Promise<PantryPage> {
  const query = buildQuery({
    limit: options.limit ?? 20,
    cursor: options.cursor ?? undefined,
    status: options.status ?? "available",
  });
  const raw = await apiRequest<{ items: unknown; nextCursor?: unknown }>(
    `/pantry${query}`,
    { signal: options.signal ?? null },
  );
  const page = assertRecord(raw, "pantry list");
  const items = Array.isArray(page["items"]) ? page["items"] : [];
  return {
    items: items.map(assertPantryItem),
    nextCursor:
      typeof page["nextCursor"] === "string" ? page["nextCursor"] : null,
  };
}

export type PantryPatchInput = {
  /** Absolute replacement quantity (decimal string). Not a delta. */
  quantity?: string;
  /** Absolute expiry date (date-only) or null to clear. */
  expires_at?: string | null;
};

export async function patchPantryItem(
  id: string,
  patch: PantryPatchInput,
  signal?: AbortSignal | null,
): Promise<PantryItem> {
  const raw = await apiRequest<unknown>(`/pantry/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: patch,
    signal: signal ?? null,
  });
  return assertPantryItem(raw);
}

export async function consumePantryItem(
  id: string,
  input: { qty: string } | { all: true },
  signal?: AbortSignal | null,
): Promise<PantryItem> {
  // Partial consume is NOT idempotency protected: callers must reconcile
  // (refetch) on unknown outcomes and never auto-replay this call.
  const raw = await apiRequest<unknown>(
    `/pantry/${encodeURIComponent(id)}/consume`,
    { method: "POST", body: input, signal: signal ?? null },
  );
  return assertPantryItem(raw);
}

/** 204 remove. DELETE alias kept for contract parity. */
export async function removePantryItem(
  id: string,
  signal?: AbortSignal | null,
): Promise<void> {
  await apiRequest<void>(`/pantry/${encodeURIComponent(id)}/remove`, {
    method: "POST",
    signal: signal ?? null,
  });
}

export async function deletePantryItem(
  id: string,
  signal?: AbortSignal | null,
): Promise<void> {
  await apiRequest<void>(`/pantry/${encodeURIComponent(id)}/remove`, {
    method: "DELETE",
    signal: signal ?? null,
  });
}

export async function getBasketSummary(
  options: { from?: string; to?: string; signal?: AbortSignal | null } = {},
): Promise<BasketSummary> {
  const query = buildQuery({ from: options.from, to: options.to });
  const raw = await apiRequest<unknown>(`/basket/summary${query}`, {
    signal: options.signal ?? null,
  });
  return assertBasketSummary(raw);
}

// ---------------------------------------------------------------------------
// Current user / profile endpoints (see ownership note at top)
// ---------------------------------------------------------------------------

export async function getCurrentUser(
  signal?: AbortSignal | null,
): Promise<CurrentUser> {
  const raw = await apiRequest<unknown>("/users/me", {
    signal: signal ?? null,
  });
  return assertCurrentUser(raw);
}

export type ProfilePatchInput = Partial<
  Pick<
    UserProfile,
    | "timezone"
    | "dietaryPreferences"
    | "excludedIngredients"
    | "preferencesJson"
  >
>;

export async function updateUserProfile(
  patch: ProfilePatchInput,
  signal?: AbortSignal | null,
): Promise<UserProfile> {
  const raw = await apiRequest<unknown>("/users/me/profile", {
    method: "PATCH",
    body: patch,
    signal: signal ?? null,
  });
  return assertProfile(raw);
}

/** Preference reset — not account deletion. Resolves on 204. */
export async function resetUserProfile(
  signal?: AbortSignal | null,
): Promise<void> {
  await apiRequest<void>("/users/me/profile", {
    method: "DELETE",
    signal: signal ?? null,
  });
}

// ---------------------------------------------------------------------------
// Pure display / validation helpers (unit-tested, no I/O)
// ---------------------------------------------------------------------------

const QUANTITY_PATTERN = /^\d+(\.\d{1,3})?$/;

export function isQuantityString(value: string): boolean {
  if (!QUANTITY_PATTERN.test(value)) return false;
  const n = Number(value);
  return n > 0 && n <= 999_999_999.999;
}

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isDateOnlyString(value: string): boolean {
  if (!DATE_ONLY_PATTERN.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * Format a date-only "YYYY-MM-DD" string as "Oct 6" WITHOUT constructing a
 * local-timezone Date (avoids timezone drift). Returns the raw input when
 * it is not a valid date-only string.
 */
export function formatDateOnly(value: string | null | undefined): string {
  if (!value || !isDateOnlyString(value)) return value ?? "";
  const [, month, day] = value.split("-").map(Number);
  return `${MONTHS[(month ?? 1) - 1]} ${day}`;
}

/**
 * Format a receipt-list total (number|null per plan) as "$19.24".
 * Null totals render honestly as "Total unavailable" — never $0.00.
 */
export function formatMoneyTotal(total: number | string | null | undefined): string {
  if (total === null || total === undefined) return "Total unavailable";
  const n = typeof total === "string" ? Number(total) : total;
  if (!Number.isFinite(n)) return "Total unavailable";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(n);
}

/** Display a decimal-string quantity without trailing zeros: "1.500" -> "1.5". */
export function formatQuantityDisplay(value: string): string {
  if (!value.includes(".")) return value;
  const trimmed = value.replace(/0+$/, "").replace(/\.$/, "");
  return trimmed === "" ? "0" : trimmed;
}

/**
 * Append a cursor page, replacing items whose id already exists (server
 * state may have changed between pages) and honouring cursor resets.
 */
export function appendPantryPage(
  current: PantryItem[],
  page: PantryPage,
): PantryItem[] {
  const seen = new Set(page.items.map((item) => item.id));
  return [...current.filter((item) => !seen.has(item.id)), ...page.items];
}

/** Retry policy for safe reads: retry once on network/timeout, never on
 *  auth/validation/conflict or user-aborted requests. */
export function shouldRetryRead(error: unknown, attempt: number): boolean {
  if (attempt >= 1) return false;
  return (
    error instanceof ApiError &&
    (error.code === "NETWORK_ERROR" ||
      error.code === "TIMEOUT" ||
      error.code === "GATEWAY_ERROR")
  );
}
