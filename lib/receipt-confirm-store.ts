/**
 * Durable retry metadata for a manual receipt confirmation.
 *
 * A manual confirmation creates a receipt, so the exact idempotency key and
 * request body must survive an app restart. Only that retry metadata is stored
 * here — never a locally invented receipt or a "confirmed" view. Recovery
 * always resumes as an unconfirmed retry; only the server can confirm it.
 *
 * The helper is storage-injected and free of React Native/Expo imports so the
 * encoding and owner-scoping rules can be unit tested offline.
 */

import type { ReceiptConfirmBody } from "../types/receipt";
import {
  IDEMPOTENCY_KEY_PATTERN,
  MAX_RECEIPT_ITEMS,
  fingerprintConfirmBody,
  type ConfirmOperation,
} from "./receipt-workflow";

export const PENDING_CONFIRM_SCHEMA_VERSION = 1;

/**
 * Confirmation idempotency keys have no expiry in the backend contract: the key
 * is stored on the receipt row and the unique `(user_id, idempotency_key)` index
 * keeps it there. Replaying the exact key + body therefore returns the same
 * confirmed receipt at any age; if that receipt was soft-deleted, the replay
 * deterministically conflicts instead of creating a duplicate. Do not add a
 * client-side replay window here — it would only deadlock a safe retry.
 */

const STORAGE_PREFIX = "beehealthy.receipts.pending-confirm.v1";
/** SecureStore keys accept only these characters (no ":" or "%"). */
const STORAGE_KEY_PATTERN = /^[A-Za-z0-9._-]+$/;

export type PendingConfirmStorage = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};

export type PendingConfirmRecord = {
  schemaVersion: 1;
  ownerId: string;
  operation: ConfirmOperation;
  savedAt: string;
};

export type PendingConfirmRecovery = {
  operation: ConfirmOperation;
  savedAt: string;
  ageMs: number;
};
export type PendingConfirmLoad =
  | { status: "none" }
  | { status: "record"; recovery: PendingConfirmRecovery }
  /** Storage could not be read, or held data that cannot be trusted. Submit must stay blocked. */
  | { status: "unavailable" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** FNV-1a: stable, dependency-free owner discriminator for the storage key. */
function ownerHash(ownerId: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < ownerId.length; index += 1) {
    hash ^= ownerId.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

function safeOwnerFragment(ownerId: string): string {
  const sanitized = ownerId
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .slice(0, 80);
  return sanitized.length > 0 ? sanitized : "user";
}

/**
 * Per-user storage key. The record also carries the owner id, so a hash
 * collision can never restore another user's retry.
 */
export function pendingConfirmStorageKey(ownerId: string): string {
  const key = `${STORAGE_PREFIX}.${safeOwnerFragment(ownerId)}.${ownerHash(ownerId)}`;
  return STORAGE_KEY_PATTERN.test(key) ? key : STORAGE_PREFIX;
}

function isManualBody(value: unknown): value is ReceiptConfirmBody {
  if (!isRecord(value)) {
    return false;
  }
  // Manual confirmations mint a new receipt; a persisted operation that
  // targets an existing receipt must be reconciled by reopening that id.
  if ("receiptId" in value || "expectedVersion" in value) {
    return false;
  }
  if (
    typeof value.store !== "string" ||
    value.store.length === 0 ||
    typeof value.date !== "string" ||
    value.date.length === 0 ||
    typeof value.total !== "string" ||
    value.total.length === 0 ||
    value.currency !== "USD"
  ) {
    return false;
  }
  if (
    !Array.isArray(value.items) ||
    value.items.length < 1 ||
    value.items.length > MAX_RECEIPT_ITEMS
  ) {
    return false;
  }
  return value.items.every((item) => {
    if (!isRecord(item)) {
      return false;
    }
    if (item.id !== undefined && (typeof item.id !== "string" || item.id.length === 0)) {
      return false;
    }
    if (
      typeof item.name !== "string" ||
      item.name.length === 0 ||
      typeof item.quantity !== "string" ||
      item.quantity.length === 0 ||
      typeof item.lineTotal !== "string" ||
      item.lineTotal.length === 0
    ) {
      return false;
    }
    return (
      "foodId" in item &&
      (item.foodId === null || typeof item.foodId === "string")
    );
  });
}

export function encodePendingConfirm(
  ownerId: string,
  operation: ConfirmOperation,
  savedAt: string = new Date().toISOString(),
): string {
  const record: PendingConfirmRecord = {
    schemaVersion: PENDING_CONFIRM_SCHEMA_VERSION,
    ownerId,
    operation: {
      key: operation.key,
      body: operation.body,
      fingerprint: operation.fingerprint,
    },
    savedAt,
  };
  return JSON.stringify(record);
}

/**
 * Strict boundary parse. Returns null for malformed, tampered, mismatched-owner
 * or non-manual records. Callers treat a null result for an existing value as
 * unavailable: it may hide an exact retry, so it is never shown as confirmed
 * and never replaced by a fresh key.
 */
export function decodePendingConfirm(
  raw: string | null,
  ownerId: string,
  nowMs: number = Date.now(),
): PendingConfirmRecovery | null {
  if (!raw) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  if (!isRecord(parsed)) {
    return null;
  }
  if (
    parsed.schemaVersion !== PENDING_CONFIRM_SCHEMA_VERSION ||
    parsed.ownerId !== ownerId ||
    typeof parsed.savedAt !== "string"
  ) {
    return null;
  }
  const savedAtMs = Date.parse(parsed.savedAt);
  if (!Number.isFinite(savedAtMs)) {
    return null;
  }
  const rawOperation = parsed.operation;
  if (!isRecord(rawOperation)) {
    return null;
  }
  const key = rawOperation.key;
  const fingerprint = rawOperation.fingerprint;
  const body = rawOperation.body;
  if (
    typeof key !== "string" ||
    !IDEMPOTENCY_KEY_PATTERN.test(key) ||
    typeof fingerprint !== "string" ||
    !isManualBody(body) ||
    fingerprint !== fingerprintConfirmBody(body)
  ) {
    return null;
  }
  // A device clock moved backwards can make an old record look fresh. Clamp
  // future timestamps to age zero rather than rejecting a legitimate retry.
  const ageMs = Math.max(0, nowMs - savedAtMs);
  return {
    operation: { key, body, fingerprint },
    savedAt: parsed.savedAt,
    ageMs,
  };
}

export async function loadPendingConfirm(
  storage: PendingConfirmStorage,
  ownerId: string,
  nowMs: number = Date.now(),
): Promise<PendingConfirmLoad> {
  let raw: string | null;
  try {
    raw = await storage.getItem(pendingConfirmStorageKey(ownerId));
  } catch {
    // A read failure cannot be distinguished from "no journal". Treating it
    // as no journal would permit a fresh key and risk a duplicate receipt.
    return { status: "unavailable" };
  }
  if (raw === null) {
    return { status: "none" };
  }
  const recovery = decodePendingConfirm(raw, ownerId, nowMs);
  if (!recovery) {
    // Corrupt or tampered data may be hiding an exact retry. Block fresh
    // submits until a matching server-confirmed receipt can clear it; never
    // silently mint a new key.
    return { status: "unavailable" };
  }
  return { status: "record", recovery };
}

/** Returns false when the retry metadata could not be made durable. */
export async function savePendingConfirm(
  storage: PendingConfirmStorage,
  ownerId: string,
  operation: ConfirmOperation,
  savedAt: string = new Date().toISOString(),
): Promise<boolean> {
  if (
    "receiptId" in operation.body ||
    "expectedVersion" in operation.body ||
    !IDEMPOTENCY_KEY_PATTERN.test(operation.key) ||
    operation.fingerprint !== fingerprintConfirmBody(operation.body) ||
    !Number.isFinite(Date.parse(savedAt))
  ) {
    return false;
  }
  try {
    await storage.setItem(
      pendingConfirmStorageKey(ownerId),
      encodePendingConfirm(ownerId, operation, savedAt),
    );
    return true;
  } catch {
    return false;
  }
}

export async function clearPendingConfirm(
  storage: PendingConfirmStorage,
  ownerId: string,
): Promise<boolean> {
  try {
    await storage.removeItem(pendingConfirmStorageKey(ownerId));
    return true;
  } catch {
    // The caller must decide whether it can continue. A record that survives
    // cleanup can only replay the same idempotency key; it can never fabricate
    // success, but it can block a fresh confirmation after a restart.
    return false;
  }
}
