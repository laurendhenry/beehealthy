/**
 * Pure receipt workflow logic: money/quantity/date validation mirroring
 * `backend/lambda/contracts.ts`, draft serialization, idempotent confirmation
 * planning and parse/status monitoring steps.
 *
 * Everything here is side-effect free so it can be unit tested offline and
 * reused by the provider, the review screen and the APIs.
 */

import type {
  ReceiptConfirmBody,
  ReceiptErrorStage,
  ReceiptForm,
  ReceiptFormItem,
  ReceiptResource,
  ReceiptStageError,
  ReceiptStatus,
  ReceiptValidationIssue,
  ReceiptValidationResult,
  ReceiptWriteBody,
  ReceiptWriteItem,
} from "../types/receipt";

// ---------------------------------------------------------------------------
// Contract constants (keep in sync with backend/lambda/contracts.ts)
// ---------------------------------------------------------------------------

export const MONEY_PATTERN = /^\d+(\.\d{1,2})?$/;
export const QUANTITY_PATTERN = /^\d+(\.\d{1,3})?$/;
export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const MAX_MONEY_LENGTH = 13;
export const MAX_MONEY_CENTS = 2147483647n;
export const MAX_QUANTITY = 999_999_999.999;
export const MAX_RECEIPT_ITEMS = 200;
export const MAX_TEXT_LENGTH = 300;
export const IDEMPOTENCY_KEY_PATTERN = /^[\x21-\x7e]{1,200}$/;
export const MAX_WARNINGS = 20;

const MONEY_INVALID = "Enter an amount like 19.24 (up to 2 decimals).";
const QUANTITY_INVALID = "Enter a quantity greater than 0 (up to 3 decimals).";
const DATE_INVALID = "Enter a valid date (YYYY-MM-DD).";

// ---------------------------------------------------------------------------
// Money / quantity / date helpers
// ---------------------------------------------------------------------------

/**
 * Parse a money string into cents exactly like the backend (BigInt based).
 * Returns null when the string is not a valid contract amount.
 */
export function parseMoneyToCents(value: string): bigint | null {
  if (value.length === 0 || value.length > MAX_MONEY_LENGTH) {
    return null;
  }
  if (!MONEY_PATTERN.test(value)) {
    return null;
  }
  const [whole, fraction = ""] = value.split(".");
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  return cents <= MAX_MONEY_CENTS ? cents : null;
}

/** `2147483647n` → `"21474836.47"`. */
export function formatCents(cents: bigint): string {
  const negative = cents < 0n;
  const absolute = negative ? -cents : cents;
  const whole = absolute / 100n;
  const fraction = (absolute % 100n).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${whole.toString()}.${fraction}`;
}

/** Trim, validate and re-format to 2 decimals (`"19.2 "` → `"19.20"`). */
export function normalizeMoney(value: string): string | null {
  const cents = parseMoneyToCents(value.trim());
  return cents === null ? null : formatCents(cents);
}

/** Quantity check mirroring the backend (`Number(s)` bounds, not exact decimals). */
export function isValidQuantity(value: string): boolean {
  const trimmed = value.trim();
  if (!QUANTITY_PATTERN.test(trimmed)) {
    return false;
  }
  const numeric = Number(trimmed);
  return Number.isFinite(numeric) && numeric > 0 && numeric <= MAX_QUANTITY;
}

/** Calendar date check mirroring the backend's UTC round-trip. */
export function isValidDateOnly(value: string): boolean {
  const trimmed = value.trim();
  if (!DATE_PATTERN.test(trimmed)) {
    return false;
  }
  const date = new Date(`${trimmed}T00:00:00Z`);
  return (
    Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === trimmed
  );
}

/** Local (not UTC) date, so a late-evening receipt keeps today's date. */
export function todayDateOnly(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = `${now.getMonth() + 1}`.padStart(2, "0");
  const day = `${now.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function isValidStore(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length >= 1 && trimmed.length <= MAX_TEXT_LENGTH;
}

export function isValidItemName(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length >= 1 && trimmed.length <= MAX_TEXT_LENGTH;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate and normalize an editable form.
 *
 * `mismatch` reports `sum(lineTotal) !== total` — the backend records this as
 * a `TOTAL_MISMATCH` warning (tax/discount), never as a validation failure.
 */
export function validateReceiptForm(form: ReceiptForm): ReceiptValidationResult {
  const issues: ReceiptValidationIssue[] = [];

  if (!isValidStore(form.store)) {
    issues.push({
      path: "store",
      message: `Enter a store name (1–${MAX_TEXT_LENGTH} characters).`,
    });
  }
  if (!isValidDateOnly(form.date)) {
    issues.push({ path: "date", message: DATE_INVALID });
  }
  if (normalizeMoney(form.total) === null) {
    issues.push({ path: "total", message: MONEY_INVALID });
  }
  if (form.items.length < 1) {
    issues.push({ path: "items", message: "Add at least one item." });
  } else if (form.items.length > MAX_RECEIPT_ITEMS) {
    issues.push({
      path: "items",
      message: `A receipt can have at most ${MAX_RECEIPT_ITEMS} items.`,
    });
  }

  form.items.forEach((item, index) => {
    if (!isValidItemName(item.name)) {
      issues.push({
        path: `items.${index}.name`,
        message: `Enter an item name (1–${MAX_TEXT_LENGTH} characters).`,
      });
    }
    if (!isValidQuantity(item.quantity)) {
      issues.push({ path: `items.${index}.quantity`, message: QUANTITY_INVALID });
    }
    if (normalizeMoney(item.lineTotal) === null) {
      issues.push({
        path: `items.${index}.lineTotal`,
        message: MONEY_INVALID,
      });
    }
  });

  let totalCents: bigint | null = null;
  let lineTotalCents: bigint | null = null;
  if (issues.length === 0) {
    totalCents = parseMoneyToCents(form.total.trim());
    let sum = 0n;
    for (const item of form.items) {
      const cents = parseMoneyToCents(item.lineTotal.trim());
      if (cents === null) {
        sum = -1n;
        break;
      }
      sum += cents;
    }
    lineTotalCents = sum >= 0n ? sum : null;
  }

  return {
    valid: issues.length === 0,
    issues,
    totalCents,
    lineTotalCents,
    mismatch:
      totalCents !== null &&
      lineTotalCents !== null &&
      totalCents !== lineTotalCents,
  };
}

/** Map parsed server details (Zod issues) to form paths for inline display. */
export function normalizeValidationIssues(
  details: ReceiptErrorDetail[],
): ReceiptValidationIssue[] {
  const issues: ReceiptValidationIssue[] = [];
  for (const detail of details) {
    if (!detail.message) {
      continue;
    }
    const path = Array.isArray(detail.path)
      ? detail.path.map((part) => `${part}`).join(".")
      : (detail.path ?? "");
    issues.push({ path, message: detail.message });
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Form ⇄ resource conversion (never transport matchStatus)
// ---------------------------------------------------------------------------

function normalizeItem(item: ReceiptFormItem): ReceiptFormItem {
  return {
    ...item,
    name: item.name.trim(),
    quantity: item.quantity.trim(),
    lineTotal: normalizeMoney(item.lineTotal) ?? item.lineTotal.trim(),
  };
}

/** Serialize a (valid) form into the backend write shape. */
export function buildReceiptWrite(form: ReceiptForm): ReceiptWriteBody {
  return {
    store: form.store.trim(),
    date: form.date.trim(),
    total: normalizeMoney(form.total) ?? form.total.trim(),
    currency: "USD",
    items: form.items.map((raw): ReceiptWriteItem => {
      const item = normalizeItem(raw);
      const write: ReceiptWriteItem = {
        name: item.name,
        quantity: item.quantity,
        lineTotal: item.lineTotal,
        foodId: item.foodId ?? null,
      };
      // Only persisted rows may carry an id; rows added in the UI omit it.
      if (item.id !== null) {
        write.id = item.id;
      }
      return write;
    }),
  };
}

/** Confirmation body. Version/item ids are only sent for persisted receipts. */
export function buildReceiptConfirmBody(input: {
  form: ReceiptForm;
  receiptId?: string | null;
  expectedVersion?: number | null;
}): ReceiptConfirmBody {
  const write = buildReceiptWrite(input.form);
  if (!input.receiptId) {
    return write;
  }
  return {
    ...write,
    receiptId: input.receiptId,
    ...(typeof input.expectedVersion === "number"
      ? { expectedVersion: input.expectedVersion }
      : {}),
  };
}

export function formItemFromResource(
  item: ReceiptResource["draft"]["items"][number],
): ReceiptFormItem {
  return {
    key: `item-${item.id}`,
    id: item.id,
    name: item.name,
    quantity: item.quantity,
    lineTotal: item.lineTotal,
    foodId: item.foodId,
    matchStatus: item.matchStatus,
  };
}

export function formFromResource(resource: ReceiptResource): ReceiptForm {
  return {
    store: resource.draft.store,
    date: resource.draft.date,
    total: resource.draft.total,
    currency: "USD",
    items: resource.draft.items.map(formItemFromResource),
  };
}

/**
 * Rebuild the editable form from a frozen manual confirmation body. Used only
 * to show/recover an exact retry after an app restart; the body itself remains
 * the source of truth for the replay, so editing is disabled while frozen.
 */
export function formFromConfirmBody(body: ReceiptConfirmBody): ReceiptForm {
  return {
    store: body.store,
    date: body.date,
    total: body.total,
    currency: "USD",
    items: body.items.map((item, index): ReceiptFormItem => ({
      key: item.id ? `item-${item.id}` : `pending-${index}`,
      id: item.id ?? null,
      name: item.name,
      quantity: item.quantity,
      lineTotal: item.lineTotal,
      foodId: item.foodId,
      matchStatus: item.foodId ? "matched" : "check",
    })),
  };
}

/**
 * Reconcile a journaled manual confirmation with a server receipt opened from
 * history. Only an already-confirmed resource whose user-authored fields match
 * the frozen body may clear the journal. Item ids / display match state are
 * server-side details and intentionally ignored.
 */
export function confirmBodyMatchesResource(
  body: ReceiptConfirmBody,
  resource: ReceiptResource,
): boolean {
  if (resource.status !== "confirmed") {
    return false;
  }
  if (
    body.store !== resource.draft.store ||
    body.date !== resource.draft.date ||
    body.total !== resource.draft.total ||
    body.currency !== resource.currency ||
    body.items.length !== resource.draft.items.length
  ) {
    return false;
  }
  return body.items.every((item, index) => {
    const serverItem = resource.draft.items[index];
    return (
      serverItem !== undefined &&
      item.name === serverItem.name &&
      item.quantity === serverItem.quantity &&
      item.lineTotal === serverItem.lineTotal &&
      item.foodId === serverItem.foodId
    );
  });
}

/**
 * Rename a row. Any name edit invalidates the product match (the parsed
 * `foodId` described the old name); quantities/prices keep it.
 */
export function renameReceiptItem(
  item: ReceiptFormItem,
  name: string,
): ReceiptFormItem {
  if (name === item.name) {
    return item;
  }
  return {
    ...item,
    name,
    foodId: null,
    matchStatus: "check",
  };
}

/** Attach a real backend food match (discovery `FoodMatch.id`). */
export function selectReceiptItemFoodMatch(
  item: ReceiptFormItem,
  match: { id: string },
): ReceiptFormItem {
  return { ...item, foodId: match.id, matchStatus: "matched" };
}

let localItemCounter = 0;

export function resetLocalItemCounter(): void {
  localItemCounter = 0;
}

/** Stable local key for rows the user adds (never sent to the API). */
export function createLocalItemKey(): string {
  localItemCounter += 1;
  return `local-${Date.now().toString(36)}-${localItemCounter}`;
}

export function createEmptyFormItem(name = "", quantity = "1"): ReceiptFormItem {
  return {
    key: createLocalItemKey(),
    id: null,
    name,
    quantity,
    lineTotal: "",
    foodId: null,
    matchStatus: "check",
  };
}

// ---------------------------------------------------------------------------
// Example data (available in every build; still saved through the real API)
// ---------------------------------------------------------------------------

/** Clearly-example receipt. No fixed future date; defaults to today. */
export function createExampleForm(date: string = todayDateOnly()): ReceiptForm {
  const rows: [string, string][] = [
    ["Oat milk 64oz", "4.49"],
    ["Bananas", "1.29"],
    ["Sourdough loaf", "4.99"],
    ["Free range eggs", "5.49"],
    ["Cheddar block", "2.49"],
    ["Honeycrisp apple", "0.49"],
  ];
  return {
    store: "Maple Market (example)",
    date,
    total: "19.24",
    currency: "USD",
    items: rows.map(([name, lineTotal]) => ({
      key: createLocalItemKey(),
      id: null,
      name,
      quantity: "1",
      lineTotal,
      foodId: null,
      matchStatus: "check",
    })),
  };
}

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

let keyCounter = 0;

function randomToken(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") {
    return cryptoApi.randomUUID();
  }
  keyCounter += 1;
  const random = Math.random().toString(36).slice(2, 12);
  return `${Date.now().toString(36)}-${keyCounter.toString(36)}-${random}`;
}

/** Printable-ASCII idempotency key accepted by the backend (1..200 chars). */
export function createIdempotencyKey(prefix: string): string {
  const safePrefix = prefix.replace(/[^\x21-\x7e]/g, "");
  const key = `${safePrefix}-${randomToken()}`
    .replace(/\s+/g, "-")
    .slice(0, 200);
  return IDEMPOTENCY_KEY_PATTERN.test(key)
    ? key
    : `key-${randomToken()}`.slice(0, 200);
}

/** Stable fingerprint of the exact confirmation payload. */
export function fingerprintConfirmBody(body: ReceiptConfirmBody): string {
  return JSON.stringify(body);
}

export type ConfirmOperation = {
  key: string;
  body: ReceiptConfirmBody;
  fingerprint: string;
};

/**
 * Build (or reuse) the frozen confirmation operation.
 *
 * - `submit` starts a new operation whenever the payload differs from the
 *   previous frozen one; identical duplicates are not expected here.
 * - `retry` reuses the frozen key + exact body (including the original
 *   `expectedVersion`) only when the payload fingerprint is unchanged.
 */
export function planConfirmOperation(input: {
  previous: ConfirmOperation | null;
  form: ReceiptForm;
  receiptId?: string | null;
  expectedVersion?: number | null;
  mode: "submit" | "retry";
  createKey?: (prefix: string) => string;
}): ConfirmOperation {
  const body = buildReceiptConfirmBody({
    form: input.form,
    receiptId: input.receiptId,
    expectedVersion: input.expectedVersion,
  });
  const fingerprint = fingerprintConfirmBody(body);
  if (input.mode === "retry" && input.previous?.fingerprint === fingerprint) {
    return input.previous;
  }
  return {
    key: (input.createKey ?? createIdempotencyKey)("confirm"),
    body,
    fingerprint,
  };
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * True when a mutation may have reached the server (network/timeout/gateway),
 * so it must be retried with the exact same idempotency key rather than a new
 * one. Caller cancellation (`ABORTED`) is not an unknown outcome: the request
 * was deliberately superseded and a newer operation owns the state.
 */
export function isUnknownOutcome(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const code = (error as { code?: unknown }).code;
  if (code === "ABORTED") {
    return false;
  }
  const status = (error as { status?: unknown }).status;
  if (code === "NETWORK_ERROR") {
    return true;
  }
  if (typeof status !== "number") {
    return false;
  }
  return status === 0 || status === 408 || (status >= 500 && status <= 599);
}

/**
 * A 4xx response (except 408 Request Timeout) means the server rejected the
 * request, so an unknown-outcome retry can safely be dropped. 408 and 5xx are
 * ambiguous because a gateway may have forwarded the mutation.
 */
export function isDeterministicClientError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  if ((error as { code?: unknown }).code === "ABORTED") {
    return false;
  }
  const status = (error as { status?: unknown }).status;
  return (
    typeof status === "number" &&
    status >= 400 &&
    status <= 499 &&
    status !== 408
  );
}

export function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

export function errorRequestId(error: unknown): string | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }
  const requestId = (error as { requestId?: unknown }).requestId;
  return typeof requestId === "string" ? requestId : undefined;
}

/** One entry of the backend's `details` array (Zod issue shape). */
export type ReceiptErrorDetail = {
  path?: string | (string | number)[];
  message?: string;
};

/** Parse the error envelope's `details` without leaking `unknown` outward. */
export function parseErrorDetails(error: unknown): ReceiptErrorDetail[] {
  if (!error || typeof error !== "object") {
    return [];
  }
  const raw = (error as { details?: unknown }).details;
  if (!Array.isArray(raw)) {
    return [];
  }
  const details: ReceiptErrorDetail[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const record = entry as { path?: unknown; message?: unknown };
    const detail: ReceiptErrorDetail = {};
    if (typeof record.path === "string") {
      detail.path = record.path;
    } else if (Array.isArray(record.path)) {
      detail.path = record.path.filter(
        (part): part is string | number =>
          typeof part === "string" || typeof part === "number",
      );
    }
    if (typeof record.message === "string") {
      detail.message = record.message;
    }
    details.push(detail);
  }
  return details;
}

export function errorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.length > 0) {
      return message;
    }
  }
  return fallback;
}

/** Convert any thrown value into the structured error screens render. */
export function toStageError(input: {
  stage: ReceiptErrorStage;
  error: unknown;
  fallback: string;
}): ReceiptStageError {
  const issues = normalizeValidationIssues(parseErrorDetails(input.error));
  const stageError: ReceiptStageError = {
    stage: input.stage,
    message: errorMessage(input.error, input.fallback),
    unknownOutcome: isUnknownOutcome(input.error),
  };
  const code = errorCode(input.error);
  if (code) {
    stageError.code = code;
  }
  const requestId = errorRequestId(input.error);
  if (requestId) {
    stageError.requestId = requestId;
  }
  if (issues.length > 0) {
    stageError.issues = issues;
  }
  return stageError;
}

/** Copy for the `TOTAL_MISMATCH` warning — tax/discount is legitimate. */
export function warningCopy(warning: string): string {
  switch (warning) {
    case "TOTAL_MISMATCH":
      return "The item total does not match the receipt total. This can be tax or a discount — adjust the items or total so they match, or keep them as printed.";
    default:
      return warning.replace(/_/g, " ").toLowerCase();
  }
}

// ---------------------------------------------------------------------------
// Parse / status monitoring
// ---------------------------------------------------------------------------

export const MONITOR_MAX_ATTEMPTS = 12;
export const MONITOR_WINDOW_MS = 45_000;
/** Backend recovers a processing receipt as `PROCESSING_STALE` after 90s. */
export const PROCESSING_STALE_MS = 90_000;

export type MonitorStep =
  | { kind: "refreshFull"; delayMs: 0 }
  | { kind: "continue"; delayMs: number }
  | { kind: "stop"; delayMs: 0; reason: "terminal" | "timeout" };

/**
 * Decide what the status loop does next. Ready/confirmed loads the full
 * resource; terminal statuses stop; processing waits (honoring retryAfterMs);
 * bounded attempts/window hand control back to the manual refresh button.
 */
export function planMonitorStep(input: {
  attempt: number;
  elapsedMs: number;
  status: ReceiptStatus;
  retryAfterMs?: number | null;
  random?: number;
}): MonitorStep {
  if (input.status === "ready" || input.status === "confirmed") {
    return { kind: "refreshFull", delayMs: 0 };
  }
  if (input.status !== "processing") {
    return { kind: "stop", delayMs: 0, reason: "terminal" };
  }
  if (
    input.attempt >= MONITOR_MAX_ATTEMPTS ||
    input.elapsedMs >= MONITOR_WINDOW_MS
  ) {
    return { kind: "stop", delayMs: 0, reason: "timeout" };
  }
  const backoff = [1000, 2000, 4000, 8000, 10_000][
    Math.min(input.attempt, 4)
  ];
  const base =
    typeof input.retryAfterMs === "number" && input.retryAfterMs > 0
      ? input.retryAfterMs
      : backoff;
  const clamp = Math.min(Math.max(base, 500), 15_000);
  const jitter = 1 + Math.max(0, Math.min(1, input.random ?? 0)) * 0.2;
  return { kind: "continue", delayMs: Math.round(clamp * jitter) };
}

/** Receipt statuses after which nothing more happens automatically. */
export function isTerminalStatus(status: ReceiptStatus): boolean {
  return (
    status === "ready" ||
    status === "confirmed" ||
    status === "failed" ||
    status === "deleted"
  );
}
