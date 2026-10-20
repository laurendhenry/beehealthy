/**
 * Frontend wire DTOs for the BeeHealthy API (relative to `/api`).
 *
 * These are intentionally local, hand-maintained types backed by contract
 * fixtures — NOT imports of backend runtime modules. Metro must never bundle
 * backend code (`backend/*` must not be imported here).
 *
 * Money is decimal-string money (e.g. `"12.50"`); quantity is decimal-string
 * (e.g. `"0.500"`). Dates are date-only `YYYY-MM-DD` strings.
 */

/** Application error envelope: `{ error: { code, message, requestId, details? } }`. */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    requestId?: string;
    details?: unknown;
  };
}

/** Common error codes surfaced by the API. */
export const ApiErrorCodes = {
  Unauthenticated: "UNAUTHENTICATED",
  ValidationError: "VALIDATION_ERROR",
  VersionConflict: "VERSION_CONFLICT",
  ImmutableReceipt: "IMMUTABLE_RECEIPT",
  ImageNotParsed: "IMAGE_NOT_PARSED",
  IdempotencyConflict: "IDEMPOTENCY_CONFLICT",
  ProcessingFailed: "PROCESSING_FAILED",
  StorageUnavailable: "STORAGE_UNAVAILABLE",
  NotFound: "NOT_FOUND",
  InvalidCursor: "INVALID_CURSOR",
  NetworkError: "NETWORK_ERROR",
  ConfigError: "CONFIG_ERROR",
  Unknown: "UNKNOWN",
} as const;

export type ApiErrorCode = (typeof ApiErrorCodes)[keyof typeof ApiErrorCodes] | string;

/** User profile preferences (partially editable). */
export interface UserProfile {
  timezone: string;
  dietaryPreferences: string[];
  excludedIngredients: string[];
  /** Opaque extra preferences; never rendered as a raw editor. */
  preferencesJson: Record<string, unknown>;
}

/** `GET /users/me` response. */
export interface UserMeResponse {
  id: string;
  name: string;
  email: string;
  image: string | null;
  profile: UserProfile;
}

/** `PUT /users/me/profile` request: full replacement (omitted fields default). */
export interface ReplaceProfileRequest {
  timezone?: string;
  dietaryPreferences?: string[];
  excludedIngredients?: string[];
  preferencesJson?: Record<string, unknown>;
}

/** `PATCH /users/me/profile` request: partial update, omitted fields preserved. */
export type UpdateProfileRequest = ReplaceProfileRequest;

/** `PUT`/`PATCH /users/me/profile` response. */
export interface UserProfileResponse {
  profile: UserProfile;
}

/** Better Auth session shape returned by `GET /api/auth/get-session`. */
export interface AuthSession {
  user: {
    id: string;
    name: string;
    email: string;
    image?: string | null;
  };
  session: {
    id: string;
    /** ISO timestamp; client must respect expiry. */
    expiresAt: string;
  };
}

/**
 * True when the session's `expiresAt` is past (with 30s clock-skew margin),
 * malformed, or absent. Pure and runtime-safe so offline tests can import it
 * without React Native. The auth provider revalidates on foreground and via
 * an expiry timer instead of trusting stale sessions.
 */
export function isSessionExpired(session: AuthSession | null, now = Date.now()): boolean {
  if (!session) return true;
  const raw = session.session.expiresAt as unknown;
  const expires = raw instanceof Date ? raw.getTime() : Date.parse(raw as string);
  if (Number.isNaN(expires)) return true;
  return expires - 30_000 <= now;
}

/**
 * Normalize a wire timestamp to an ISO string.
 *
 * better-auth's client JSON parser revives ISO-8601 strings into `Date`
 * objects before our code ever sees the payload, so `expiresAt` arrives as
 * a `Date` on native (raw DevTools bodies still show strings — that is the
 * pre-parse text). Accept both; reject anything else.
 */
export function toISODateString(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  return null;
}

/**
 * Runtime shape check: only accept well-formed session payloads.
 *
 * Tolerates better-auth's date revival (`expiresAt` as `Date`) by
 * normalizing back to an ISO string so downstream code keeps working
 * with `AuthSession`'s `expiresAt: string` contract.
 */
export function toAuthSession(value: unknown): AuthSession | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const user = record["user"];
  const session = record["session"];
  if (!user || typeof user !== "object" || !session || typeof session !== "object") {
    return null;
  }
  const userRecord = user as Record<string, unknown>;
  const sessionRecord = session as Record<string, unknown>;
  const expiresAt = toISODateString(sessionRecord["expiresAt"]);
  if (
    typeof userRecord["id"] !== "string" ||
    typeof userRecord["name"] !== "string" ||
    typeof userRecord["email"] !== "string" ||
    typeof sessionRecord["id"] !== "string" ||
    expiresAt === null
  ) {
    return null;
  }
  return {
    user: {
      id: userRecord["id"],
      name: userRecord["name"],
      email: userRecord["email"],
      image:
        typeof userRecord["image"] === "string" ? userRecord["image"] : null,
    },
    session: {
      id: sessionRecord["id"],
      expiresAt,
    },
  };
}

/**
 * True when account-scoped state must be cleared: there was a previous
 * account and the identity changed (logout or switch). First login
 * (`null` → session) returns false — no prior-user state exists to clear.
 * The auth provider notifies `onSessionInvalidated` subscribers on true so
 * a prior user's data never reappears.
 */
export function isAccountSwitch(
  prev: AuthSession | null,
  next: AuthSession | null,
): boolean {
  const prevId = prev?.user.id ?? null;
  if (prevId === null) return false;
  return prevId !== (next?.user.id ?? null);
}
/** Receipt lifecycle status. */
export type ReceiptStatus =
  | "uploading"
  | "processing"
  | "ready"
  | "confirmed"
  | "failed"
  | "deleted";

export type ReceiptItemMatchStatus = "matched" | "check";

/** Full receipt resource (subset of fields the UI needs for review/detail). */
export interface ReceiptResource {
  id: string;
  status: ReceiptStatus;
  version: number;
  currency: "USD";
  draft: {
    store: string;
    date: string;
    total: string;
    items: {
      id: string;
      name: string;
      quantity: string;
      lineTotal: string;
      foodId: string | null;
      matchStatus: ReceiptItemMatchStatus;
    }[];
  };
  warnings: string[];
  error: { code: string } | null;
}

/** Cursor-paginated list envelope. */
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}
