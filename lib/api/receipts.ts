/**
 * Receipt API client.
 *
 * Every function forwards to the canonical transport in `lib/api/client.ts`
 * (cookies via the configured transport, auth required) and accepts optional
 * `deps` so the contract can be tested offline. Response bodies are parsed at
 * the boundary — screens never see `unknown`.
 */

import { ApiError, apiRequest, type TransportDeps } from "./client";
import type {
  ReceiptConfirmBody,
  ReceiptImageTicket,
  ReceiptListSummary,
  ReceiptPage,
  ReceiptPatchBody,
  ReceiptResource,
  ReceiptStatus,
  ReceiptStatusSnapshot,
  UploadTicket,
} from "../../types/receipt";

const UPLOAD_TIMEOUT_MS = 30_000;
const PARSE_TIMEOUT_MS = 45_000;
const CONFIRM_TIMEOUT_MS = 30_000;

const RECEIPT_STATUSES: readonly ReceiptStatus[] = [
  "uploading",
  "processing",
  "ready",
  "confirmed",
  "failed",
  "deleted",
];

export type ReceiptRequestOptions = {
  signal?: AbortSignal | null;
  deps?: TransportDeps;
};

function invalidResponse(message: string): ApiError {
  return new ApiError({
    status: 0,
    code: "INVALID_RESPONSE",
    message,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw invalidResponse(`The server returned an invalid ${label}.`);
  }
  return value;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw invalidResponse(`The server returned an invalid ${label}.`);
  }
  return value;
}

function requireNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw invalidResponse(`The server returned an invalid ${label}.`);
  }
  return value;
}

function parseStatus(value: unknown, label: string): ReceiptStatus {
  if (
    typeof value !== "string" ||
    !RECEIPT_STATUSES.includes(value as ReceiptStatus)
  ) {
    throw invalidResponse(`The server returned an invalid ${label}.`);
  }
  return value as ReceiptStatus;
}

function parseErrorField(value: unknown): { code: string } | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (isRecord(value) && typeof value.code === "string") {
    return { code: value.code };
  }
  return null;
}

/** Parse and validate a `ReceiptResource`. */
export function parseReceiptResource(raw: unknown): ReceiptResource {
  const record = requireRecord(raw, "receipt");
  const draft = requireRecord(record.draft, "receipt draft");
  const items = Array.isArray(draft.items) ? draft.items : null;
  if (!items) {
    throw invalidResponse("The server returned an invalid receipt draft.");
  }
  const warnings = Array.isArray(record.warnings)
    ? record.warnings.filter((warning): warning is string => typeof warning === "string")
    : [];
  return {
    id: requireString(record.id, "receipt id"),
    status: parseStatus(record.status, "receipt status"),
    version: requireNumber(record.version, "receipt version"),
    currency: "USD",
    draft: {
      store: requireString(draft.store, "store"),
      date: requireString(draft.date, "receipt date"),
      total: requireString(draft.total, "receipt total"),
      items: items.map((item) => {
        const row = requireRecord(item, "receipt item");
        const matchStatus = row.matchStatus === "matched" ? "matched" : "check";
        return {
          id: requireString(row.id, "receipt item id"),
          name: requireString(row.name, "receipt item name"),
          quantity: requireString(row.quantity, "receipt item quantity"),
          lineTotal: requireString(row.lineTotal, "receipt item total"),
          foodId: typeof row.foodId === "string" ? row.foodId : null,
          matchStatus,
        };
      }),
    },
    warnings,
    error: parseErrorField(record.error),
  };
}

export function parseReceiptStatus(raw: unknown): ReceiptStatusSnapshot {
  const record = requireRecord(raw, "receipt status");
  const snapshot: ReceiptStatusSnapshot = {
    id: requireString(record.id, "receipt id"),
    status: parseStatus(record.status, "receipt status"),
    version: requireNumber(record.version, "receipt version"),
    error: parseErrorField(record.error),
  };
  if (typeof record.retryAfterMs === "number") {
    snapshot.retryAfterMs = record.retryAfterMs;
  }
  return snapshot;
}

export function parseUploadTicket(raw: unknown): UploadTicket {
  const record = requireRecord(raw, "upload ticket");
  const upload = requireRecord(record.upload, "upload target");
  const headers: Record<string, string> = {};
  if (isRecord(upload.headers)) {
    for (const [key, value] of Object.entries(upload.headers)) {
      if (typeof value === "string") {
        headers[key] = value;
      }
    }
  }
  return {
    receiptId: requireString(record.receiptId, "receipt id"),
    upload: {
      url: requireString(upload.url, "upload URL"),
      headers,
      expiresAt: requireString(upload.expiresAt, "upload expiry"),
      maxBytes: requireNumber(upload.maxBytes, "upload limit"),
    },
  };
}

export function parseReceiptImageTicket(raw: unknown): ReceiptImageTicket {
  const record = requireRecord(raw, "receipt image");
  return {
    url: requireString(record.url, "image URL"),
    expiresAt: requireString(record.expiresAt, "image expiry"),
  };
}

function parseReceiptSummary(raw: unknown): ReceiptListSummary {
  const record = requireRecord(raw, "receipt summary");
  return {
    id: requireString(record.id, "receipt id"),
    version: requireNumber(record.version, "receipt version"),
    store: requireString(record.store, "store"),
    date: requireString(record.date, "receipt date"),
    dateLabel: requireString(record.dateLabel, "date label"),
    itemCount: requireNumber(record.itemCount, "item count"),
    total: typeof record.total === "number" ? record.total : null,
    currency: typeof record.currency === "string" ? record.currency : "USD",
    status: parseStatus(record.status, "receipt status"),
  };
}

export function parseReceiptPage(raw: unknown): ReceiptPage {
  const record = requireRecord(raw, "receipt page");
  const items = Array.isArray(record.items) ? record.items : null;
  if (!items) {
    throw invalidResponse("The server returned an invalid receipt list.");
  }
  return {
    items: items.map(parseReceiptSummary),
    nextCursor:
      typeof record.nextCursor === "string" ? record.nextCursor : null,
  };
}

function receiptPath(id: string, suffix = ""): string {
  return `/receipts/${encodeURIComponent(id)}${suffix}`;
}

/**
 * Allocate a receipt + signed upload URL.
 *
 * Retrying must reuse the same `idempotencyKey` and identical metadata; the
 * backend replays the same receipt/URL for that key.
 */
export async function allocateReceiptUpload(
  input: { contentType: string; sizeBytes: number },
  idempotencyKey: string,
  options: ReceiptRequestOptions = {},
): Promise<UploadTicket> {
  const raw = await apiRequest<unknown>("/receipts/upload", {
    method: "POST",
    body: input,
    headers: { "Idempotency-Key": idempotencyKey },
    signal: options.signal,
    timeoutMs: UPLOAD_TIMEOUT_MS,
  }, options.deps);
  return parseUploadTicket(raw);
}

/**
 * Start parsing (synchronous Textract on the server). Returns the resource
 * when parsing completed (`ready`) and a `processing` resource on 202.
 */
export async function requestReceiptParse(
  receiptId: string,
  options: ReceiptRequestOptions = {},
): Promise<ReceiptResource> {
  const raw = await apiRequest<unknown>(receiptPath(receiptId, "/parse"), {
    method: "POST",
    // The route validates a strict `{}` body; an empty body is rejected.
    body: {},
    signal: options.signal,
    timeoutMs: PARSE_TIMEOUT_MS,
  }, options.deps);
  return parseReceiptResource(raw);
}

export async function getReceiptStatus(
  receiptId: string,
  options: ReceiptRequestOptions = {},
): Promise<ReceiptStatusSnapshot> {
  const raw = await apiRequest<unknown>(receiptPath(receiptId, "/status"), {
    method: "GET",
    signal: options.signal,
    timeoutMs: 15_000,
  }, options.deps);
  return parseReceiptStatus(raw);
}

export async function getReceipt(
  receiptId: string,
  options: ReceiptRequestOptions = {},
): Promise<ReceiptResource> {
  const raw = await apiRequest<unknown>(receiptPath(receiptId), {
    method: "GET",
    signal: options.signal,
    timeoutMs: 15_000,
  }, options.deps);
  return parseReceiptResource(raw);
}

export async function getReceiptImage(
  receiptId: string,
  options: ReceiptRequestOptions = {},
): Promise<ReceiptImageTicket> {
  const raw = await apiRequest<unknown>(receiptPath(receiptId, "/image"), {
    method: "GET",
    signal: options.signal,
    timeoutMs: 15_000,
  }, options.deps);
  return parseReceiptImageTicket(raw);
}

/**
 * Confirm an existing receipt, or create a confirmed manual receipt.
 *
 * The caller owns the frozen idempotency key/body (see
 * `planConfirmOperation`); this function only performs the request.
 */
export async function confirmReceipt(
  body: ReceiptConfirmBody,
  idempotencyKey: string,
  options: ReceiptRequestOptions = {},
): Promise<ReceiptResource> {
  const raw = await apiRequest<unknown>("/receipts", {
    method: "POST",
    body,
    headers: { "Idempotency-Key": idempotencyKey },
    signal: options.signal,
    timeoutMs: CONFIRM_TIMEOUT_MS,
  }, options.deps);
  return parseReceiptResource(raw);
}

/** Patch a ready receipt (complete merged draft required by the server). */
export async function patchReceipt(
  receiptId: string,
  body: ReceiptPatchBody,
  options: ReceiptRequestOptions = {},
): Promise<ReceiptResource> {
  const raw = await apiRequest<unknown>(receiptPath(receiptId), {
    method: "PATCH",
    body,
    signal: options.signal,
    timeoutMs: 20_000,
  }, options.deps);
  return parseReceiptResource(raw);
}

export async function deleteReceipt(
  receiptId: string,
  expectedVersion: number,
  options: ReceiptRequestOptions = {},
): Promise<void> {
  await apiRequest<unknown>(receiptPath(receiptId), {
    method: "DELETE",
    body: { expectedVersion },
    signal: options.signal,
    timeoutMs: 15_000,
  }, options.deps);
}

export async function listReceipts(
  input: {
    limit?: number;
    cursor?: string | null;
    status?: ReceiptStatus;
  } = {},
  options: ReceiptRequestOptions = {},
): Promise<ReceiptPage> {
  const query = new URLSearchParams();
  if (typeof input.limit === "number") {
    query.set("limit", `${input.limit}`);
  }
  if (input.cursor) {
    query.set("cursor", input.cursor);
  }
  if (input.status) {
    query.set("status", input.status);
  }
  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  const raw = await apiRequest<unknown>(`/receipts${suffix}`, {
    method: "GET",
    signal: options.signal,
    timeoutMs: 15_000,
  }, options.deps);
  return parseReceiptPage(raw);
}
