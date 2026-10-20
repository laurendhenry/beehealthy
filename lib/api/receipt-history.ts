/**
 * Receipt history / detail / recovery reads.
 *
 * Ownership: history + detail screens (read-only persisted receipts). The
 * review/confirm workflow and upload pipeline live in `lib/api/receipts.ts`
 * and `ReceiptContext` — this module only exposes:
 *   GET    /receipts                cursor-paginated summaries
 *   GET    /receipts/:id            full persisted resource
 *   GET    /receipts/:id/status     bounded processing monitor
 *   GET    /receipts/:id/image      short-lived original-image URL
 *   DELETE /receipts/:id            version-aware deletion
 *
 * Every read validates the wire shape at the boundary and returns/throws the
 * transport `ApiError`, so screens can distinguish NOT_FOUND, INVALID_CURSOR,
 * VERSION_CONFLICT, IMAGE_NOT_PARSED, NETWORK_ERROR, etc.
 *
 * Pure helpers (status copy, pagination merge, error copy, route params) are
 * exported for offline tests; no Expo/React imports live here.
 */

import {
  ApiErrorCodes,
  type Page,
  type ReceiptResource,
  type ReceiptStatus,
} from "../../types/api";
import { ApiError } from "./client";
import type {
  ReceiptImageTicket,
  ReceiptListSummary,
  ReceiptStatusSnapshot,
} from "../../types/receipt";
import {
  deleteReceipt as deletePersistedReceipt,
  getReceipt as getPersistedReceipt,
  getReceiptImage as getPersistedReceiptImage,
  getReceiptStatus as getPersistedReceiptStatus,
  listReceipts,
  parseReceiptImageTicket,
  parseReceiptPage as parseStrictReceiptPage,
  parseReceiptResource as parseStrictReceiptResource,
  parseReceiptStatus as parseStrictReceiptStatus,
} from "./receipts";

// ---------------------------------------------------------------------------
// Wire DTOs
// ---------------------------------------------------------------------------

export const RECEIPT_STATUS_VALUES: readonly ReceiptStatus[] = [
  "uploading",
  "processing",
  "ready",
  "confirmed",
  "failed",
  "deleted",
];

/** Server list row (`GET /receipts`). `total` is a number or null. */
export type ReceiptSummary = ReceiptListSummary;

export type ReceiptStatusProbe = ReceiptStatusSnapshot;

export type ReceiptImage = ReceiptImageTicket;

export type ReceiptHistoryFilter =
  | "all"
  | "uploading"
  | "processing"
  | "ready"
  | "confirmed"
  | "failed";

export const RECEIPT_HISTORY_FILTERS: readonly ReceiptHistoryFilter[] = [
  "all",
  "uploading",
  "processing",
  "ready",
  "confirmed",
  "failed",
];

export const RECEIPT_HISTORY_FILTER_LABELS: Record<ReceiptHistoryFilter, string> =
  {
    all: "All",
    uploading: "Uploading",
    processing: "Processing",
    ready: "Ready",
    confirmed: "Confirmed",
    failed: "Failed",
  };

const DEFAULT_PAGE_SIZE = 20;
const MIN_RETRY_MS = 1_000;
const MAX_RETRY_MS = 10_000;

// ---------------------------------------------------------------------------
// Small guards
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

export function isReceiptStatus(value: unknown): value is ReceiptStatus {
  return (
    typeof value === "string" &&
    (RECEIPT_STATUS_VALUES as readonly string[]).includes(value)
  );
}

/** Dynamic-route params may arrive as `string | string[]`. */
export function parseReceiptIdParam(value: unknown): string | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  return isNonEmptyString(candidate) ? candidate : null;
}

export function errorCode(error: unknown): string | null {
  if (!isRecord(error)) return null;
  return typeof error.code === "string" ? error.code : null;
}

export function errorStatus(error: unknown): number | null {
  if (!isRecord(error)) return null;
  return typeof error.status === "number" ? error.status : null;
}

/**
 * Strict status probe with the monitor's retry contract applied. Shape errors
 * come from the canonical parser as INVALID_RESPONSE (never a fabricated
 * snapshot), and an unusable `retryAfterMs` is dropped rather than trusted.
 */
function boundStatusProbe(probe: ReceiptStatusProbe): ReceiptStatusProbe {
  const retryAfterMs = probe.retryAfterMs;
  if (retryAfterMs === undefined) return probe;
  if (!Number.isFinite(retryAfterMs)) {
    return {
      id: probe.id,
      status: probe.status,
      version: probe.version,
      error: probe.error,
    };
  }
  return {
    ...probe,
    retryAfterMs: Math.min(MAX_RETRY_MS, Math.max(MIN_RETRY_MS, retryAfterMs)),
  };
}

/** Outcome of a failed DELETE, including the idempotent-retry case. */
export type ReceiptDeleteFailure = "already-deleted" | "conflict" | "error";

/**
 * A 404/410 means the receipt is gone. That includes a retried DELETE whose
 * first 204 response was lost: treating it as success is correct and safe.
 */
export function isReceiptGoneError(error: unknown): boolean {
  return (
    errorCode(error) === ApiErrorCodes.NotFound ||
    errorStatus(error) === 404 ||
    errorStatus(error) === 410
  );
}

/** Classify a failed DELETE so the UI never reports a false success. */
export function classifyDeleteFailure(error: unknown): ReceiptDeleteFailure {
  if (isReceiptGoneError(error)) return "already-deleted";
  if (
    errorCode(error) === ApiErrorCodes.VersionConflict ||
    errorStatus(error) === 409
  ) {
    return "conflict";
  }
  return "error";
}

function invalidShape(message: string): ApiError {
  return new ApiError({ status: 0, code: "INVALID_RESPONSE", message });
}

function requirePositiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw invalidShape(`The server returned an invalid ${label}.`);
  }
  return value;
}

export function parseReceiptResource(value: unknown): ReceiptResource {
  const resource = parseStrictReceiptResource(value);
  if (!resource.id.trim()) {
    throw invalidShape("The server returned an invalid receipt id.");
  }
  return {
    ...resource,
    version: requirePositiveInteger(resource.version, "receipt version"),
  };
}

export function parseReceiptPage(value: unknown): Page<ReceiptSummary> {
  const page = parseStrictReceiptPage(value);
  return {
    ...page,
    items: page.items.map((item) => ({
      ...item,
      version: requirePositiveInteger(item.version, "receipt version"),
    })),
  };
}

export function parseReceiptStatusProbe(value: unknown): ReceiptStatusProbe {
  const probe = parseStrictReceiptStatus(value);
  if (!probe.id.trim()) {
    throw invalidShape("The server returned an invalid receipt id.");
  }
  return boundStatusProbe({
    ...probe,
    version: requirePositiveInteger(probe.version, "receipt version"),
  });
}

export function parseReceiptImage(value: unknown): ReceiptImage {
  const image = parseReceiptImageTicket(value);
  if (!image.url.trim() || !image.expiresAt.trim()) {
    throw invalidShape("The server returned an invalid receipt image.");
  }
  return image;
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

export function receiptsListPath(options: {
  filter?: ReceiptHistoryFilter;
  cursor?: string | null;
  limit?: number;
} = {}): string {
  const { filter = "all", cursor = null, limit = DEFAULT_PAGE_SIZE } = options;
  const bounded = Math.min(100, Math.max(1, Math.round(limit)));
  const params = new URLSearchParams({ limit: String(bounded) });
  if (filter !== "all") params.set("status", filter);
  if (cursor) params.set("cursor", cursor);
  return `/receipts?${params.toString()}`;
}

export function receiptDetailPath(id: string): string {
  return `/receipts/${encodeURIComponent(id)}`;
}

export function receiptStatusPath(id: string): string {
  return `/receipts/${encodeURIComponent(id)}/status`;
}

export function receiptImagePath(id: string): string {
  return `/receipts/${encodeURIComponent(id)}/image`;
}

/** History row tap target (Expo Router path). */
export function receiptDetailHref(id: string): `/receipts/${string}` {
  return `/receipts/${encodeURIComponent(id)}`;
}

/**
 * Review-screen contract agreed with the receipt workflow owner: the screen
 * reads `receiptId`, reloads that persisted resource when it does not already
 * hold it, and resumes review for ready/failed/processing receipts.
 */
export function reviewReceiptHref(id: string): `/review_receipt?receiptId=${string}` {
  return `/review_receipt?receiptId=${encodeURIComponent(id)}`;
}

// ---------------------------------------------------------------------------
// Transport reads
// ---------------------------------------------------------------------------

export async function getReceiptHistory(options: {
  filter?: ReceiptHistoryFilter;
  cursor?: string | null;
  limit?: number;
  signal?: AbortSignal | null;
} = {}): Promise<Page<ReceiptSummary>> {
  const filter = options.filter ?? "all";
  const limit = Math.min(
    100,
    Math.max(1, Math.round(options.limit ?? DEFAULT_PAGE_SIZE)),
  );
  return listReceipts(
    {
      limit,
      cursor: options.cursor ?? null,
      status: filter === "all" ? undefined : filter,
    },
    { signal: options.signal },
  );
}

export async function getReceipt(
  id: string,
  signal?: AbortSignal | null,
): Promise<ReceiptResource> {
  return parseReceiptResource(await getPersistedReceipt(id, { signal }));
}

export async function getReceiptStatus(
  id: string,
  signal?: AbortSignal | null,
): Promise<ReceiptStatusProbe> {
  return parseReceiptStatusProbe(await getPersistedReceiptStatus(id, { signal }));
}

export async function getReceiptImage(
  id: string,
  signal?: AbortSignal | null,
): Promise<ReceiptImage> {
  return parseReceiptImage(await getPersistedReceiptImage(id, { signal }));
}

/**
 * Version-aware delete. The backend removes the receipt version-pinned image
 * and (once confirmed) its pantry contribution; the UI must warn about that.
 */
export async function deleteReceipt(
  id: string,
  expectedVersion: number,
  signal?: AbortSignal | null,
): Promise<void> {
  await deletePersistedReceipt(id, expectedVersion, { signal });
}

// ---------------------------------------------------------------------------
// Pagination merge
// ---------------------------------------------------------------------------

/**
 * Append a page to the in-memory list while de-duplicating ids. A repeated id
 * (new version after review/confirm elsewhere) replaces the stale row in
 * place, preserving server order.
 */
export function mergeReceiptSummaries(
  current: readonly ReceiptSummary[],
  incoming: readonly ReceiptSummary[],
): ReceiptSummary[] {
  const next = [...current];
  const indexById = new Map<string, number>();
  next.forEach((item, index) => indexById.set(item.id, index));

  for (const item of incoming) {
    const existing = indexById.get(item.id);
    if (existing === undefined) {
      indexById.set(item.id, next.length);
      next.push(item);
    } else {
      next[existing] = item;
    }
  }
  return next;
}

// ---------------------------------------------------------------------------
// Presentation helpers (pure)
// ---------------------------------------------------------------------------

export type ReceiptStatusTone =
  | "positive"
  | "attention"
  | "pending"
  | "critical"
  | "neutral";

export type ReceiptStatusMeta = {
  label: string;
  tone: ReceiptStatusTone;
  /** One-sentence explanation shown on detail / review prompts. */
  detail: string;
};

const STATUS_META: Record<ReceiptStatus, ReceiptStatusMeta> = {
  uploading: {
    label: "Uploading",
    tone: "pending",
    detail:
      "This upload never finished. Its line items were not captured, but you can still delete the receipt.",
  },
  processing: {
    label: "Processing",
    tone: "pending",
    detail:
      "We’re reading the receipt image. This usually takes a few seconds.",
  },
  ready: {
    label: "Ready to review",
    tone: "attention",
    detail:
      "Parsed and waiting for your review. Nothing is added to your pantry until you confirm it.",
  },
  confirmed: {
    label: "Confirmed",
    tone: "positive",
    detail:
      "Confirmed receipts are read-only. Their items are already reflected in your pantry.",
  },
  failed: {
    label: "Needs attention",
    tone: "critical",
    detail:
      "Processing stopped before this receipt was ready. Reopen the review to fix it, or scan the receipt again.",
  },
  deleted: {
    label: "Deleted",
    tone: "neutral",
    detail: "This receipt is no longer available.",
  },
};

export function receiptStatusMeta(status: ReceiptStatus): ReceiptStatusMeta {
  return STATUS_META[status] ?? STATUS_META.deleted;
}

export function isReviewableStatus(status: ReceiptStatus): boolean {
  return status === "ready" || status === "failed";
}

/** Confirmed receipts are immutable; only deletion remains available. */
export function isReadOnlyReceipt(status: ReceiptStatus): boolean {
  return status === "confirmed";
}

export function canDeleteReceipt(status: ReceiptStatus): boolean {
  return status !== "deleted";
}

export function receiptDeleteWarning(status: ReceiptStatus): string {
  if (status === "confirmed") {
    return "This permanently deletes the receipt and removes its items from your pantry. This can’t be undone.";
  }
  return "This permanently deletes the receipt. This can’t be undone.";
}

export type ReceiptPrimaryAction = "review" | "monitor" | null;

export function receiptPrimaryAction(
  status: ReceiptStatus,
): ReceiptPrimaryAction {
  if (isReviewableStatus(status)) return "review";
  if (status === "processing") return "monitor";
  return null;
}

export type ReceiptErrorContext =
  | "list"
  | "detail"
  | "status"
  | "image"
  | "delete";

const CONTEXT_FALLBACK: Record<ReceiptErrorContext, string> = {
  list: "Something went wrong loading your receipts.",
  detail: "Something went wrong loading this receipt.",
  status: "We couldn’t check the receipt status.",
  image: "The original image couldn’t be loaded.",
  delete: "Something went wrong deleting this receipt.",
};

/**
 * Friendly, non-leaking copy for every expected receipt failure. Unknown
 * errors keep their own message (shape errors are intentionally readable).
 */
export function receiptErrorMessage(
  error: unknown,
  context: ReceiptErrorContext = "detail",
): string {
  if (error instanceof Error && error.name === "AbortError") {
    return "Request cancelled.";
  }

  const code = errorCode(error);
  const status = errorStatus(error);

  switch (code) {
    case ApiErrorCodes.NotFound:
      return context === "image" ? "No original image is available for this receipt." : "This receipt is no longer available.";
    case ApiErrorCodes.InvalidCursor:
      return "This list changed while you were browsing. Pull to refresh.";
    case ApiErrorCodes.VersionConflict:
      return "This receipt changed since it was loaded. Review the latest details, then try again.";
    case ApiErrorCodes.ImageNotParsed:
      return "The original image isn’t available for this receipt.";
    case ApiErrorCodes.StorageUnavailable:
      return "The original image is temporarily unavailable. Try again in a moment.";
    case ApiErrorCodes.NetworkError:
      return "Couldn’t reach BeeHealthy. Check your connection and try again.";
    case ApiErrorCodes.Unauthenticated:
      return "Your session expired. Please sign in again.";
    case ApiErrorCodes.ProcessingFailed:
      return "We couldn’t process this receipt. Reopen the review to fix it or scan again.";
    case ApiErrorCodes.ImmutableReceipt:
      return "Confirmed receipts are read-only.";
    default:
      break;
  }

  if (status === 401) return "Your session expired. Please sign in again.";
  if (status === 404) {
    return context === "image" ? "No original image is available for this receipt." : "This receipt is no longer available.";
  }
  if (status === 410) {
    return "This receipt is no longer available.";
  }
  if (status === 503) {
    return "This receipt’s image is temporarily unavailable. Try again in a moment.";
  }
  if (status !== null && status >= 500) {
    return "BeeHealthy is having trouble right now. Try again in a moment.";
  }

  if (error instanceof Error && error.message) return error.message;
  return CONTEXT_FALLBACK[context];
}

/** Presigned URLs last ~5 minutes; refresh slightly early. */
export function imageNeedsRefresh(
  image: ReceiptImage | null,
  now = Date.now(),
): boolean {
  if (!image) return false;
  const expiry = Date.parse(image.expiresAt);
  if (Number.isNaN(expiry)) return true;
  return expiry - 30_000 <= now;
}
