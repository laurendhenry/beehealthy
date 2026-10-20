/**
 * Pantry + basket + current-user API module.
 *
 * Ownership: home/pantry/profile scope (plan sections 4, 6, 7, 8, 10-M4).
 *
 * Transport is the canonical `lib/api/client.ts` transport: origin/config
 * validation, native-vs-web cookie rules, timeouts, 204/non-JSON parsing, and
 * request-id/error normalization all live there. This module keeps only the
 * app-facing error taxonomy, wire DTO validation, endpoint contracts, and
 * pure display/validation helpers. There is no mock data and no fallback:
 * every production path performs a real request and surfaces failures to the
 * caller.
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

import { ConfigError, parseApiOrigin, readApiOriginEnv } from "../config";
import {
  ApiError as TransportApiError,
  apiRequest as transportApiRequest,
  configureTransport,
  type ApiRequestOptions as TransportApiRequestOptions,
} from "./client";

// ---------------------------------------------------------------------------
// Error model (app-facing taxonomy consumed by hooks/screens)
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
// Configuration / wiring compatibility
// ---------------------------------------------------------------------------

export type CookieProvider = () => Promise<string | null>;

/**
 * @deprecated Wire the canonical transport instead:
 * `configureTransport({ cookieProvider: getAuthCookie })` from `./client`.
 * Kept as a thin compatibility shim; the API origin is configured once via
 * `EXPO_PUBLIC_API_ORIGIN` in `lib/config.ts` and is not overridable here.
 */
export function configureApi(options: {
  getCookieHeader?: CookieProvider | null;
}): void {
  if (options.getCookieHeader !== undefined) {
    configureTransport({ cookieProvider: options.getCookieHeader ?? undefined });
  }
}

/**
 * @deprecated Origin parsing lives in `lib/config.ts` (`parseApiOrigin`).
 * Kept for compatibility and still surfaces the app-facing configuration
 * error, never a production fallback.
 */
export function normalizeOrigin(raw: string | undefined | null): string {
  try {
    return parseApiOrigin(raw ?? undefined).origin;
  } catch (error) {
    if (error instanceof ConfigError) {
      throw new ApiError("CONFIGURATION_ERROR", error.message);
    }
    throw error;
  }
}

/** @deprecated Use `getApiOrigin` from `lib/config.ts`. */
export function getApiOrigin(): string {
  return normalizeOrigin(readApiOriginEnv());
}

// ---------------------------------------------------------------------------
// Transport adapter: canonical client + app error taxonomy
// ---------------------------------------------------------------------------

/** Options accepted by the canonical transport (headers/authMode included). */
export type ApiRequestOptions = TransportApiRequestOptions;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function abortError(): Error {
  const error = new Error("The request was aborted.");
  error.name = "AbortError";
  return error;
}

/**
 * Map canonical transport codes onto the taxonomy hooks already branch on.
 * The transport owns HTTP parsing/normalization; this is a thin, lossless
 * translation of the fields callers render or retry on.
 */
function toApiErrorCode(error: TransportApiError): ApiErrorCode {
  // Server envelopes carry INVALID_CURSOR on 400; callers restart the chain.
  if (error.code === "INVALID_CURSOR") return "INVALID_CURSOR";
  // Canonical transport flags 401 as UNAUTHENTICATED; keep the app's
  // UNAUTHORIZED taxonomy so protected-fetch guards keep matching.
  if (error.status === 401 || error.code === "UNAUTHENTICATED") {
    return "UNAUTHORIZED";
  }
  switch (error.status) {
    case 404:
      return "NOT_FOUND";
    case 409:
      return "VERSION_CONFLICT";
    case 422:
      return "VALIDATION_ERROR";
    case 429:
      return "QUOTA_EXCEEDED";
    default:
      break;
  }
  if (error.status === 0) {
    // The canonical transport reports timeouts as NETWORK_ERROR with a
    // "Request timed out" message (it aborts its internal controller, never
    // the caller's signal).
    return /timed out/i.test(error.message) ? "TIMEOUT" : "NETWORK_ERROR";
  }
  // Unparseable gateway responses stay retryable safe-read failures.
  if (error.status >= 500 && /non-json response/i.test(error.message)) {
    return "GATEWAY_ERROR";
  }
  return "UNKNOWN_ERROR";
}

function toAppApiError(error: TransportApiError): ApiError {
  return new ApiError(toApiErrorCode(error), error.message, {
    status: error.status,
    requestId: error.requestId ?? null,
    details: error.details,
  });
}

/**
 * Execute a request through the canonical transport, then translate its
 * `ApiError` into this module's long-standing app error taxonomy. Hooks rely
 * on `instanceof ApiError` and codes such as UNAUTHORIZED/INVALID_CURSOR.
 */
export async function apiRequest<T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  try {
    const payload = await transportApiRequest<T>(path, options);
    // The canonical transport returns `{ __nonJsonText }` for a 2xx response
    // that is not JSON. Preserve this module's historical behavior: a
    // successful status with an unparseable body is still a gateway failure.
    if (isRecord(payload) && "__nonJsonText" in payload) {
      throw new ApiError(
        "GATEWAY_ERROR",
        "The server returned an unexpected response. Please try again.",
      );
    }
    return payload;
  } catch (error) {
    // Preserve the cancellation contract callers already handle: ignore this
    // run instead of rendering a network error. (The canonical transport
    // represents an aborted fetch as NETWORK_ERROR.)
    if (options.signal?.aborted) throw abortError();
    if (error instanceof TransportApiError) throw toAppApiError(error);
    // Missing/invalid EXPO_PUBLIC_API_ORIGIN stays a configuration error.
    if (error instanceof ConfigError) {
      throw new ApiError("CONFIGURATION_ERROR", error.message);
    }
    throw error;
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
