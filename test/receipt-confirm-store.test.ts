import test from "node:test";
import assert from "node:assert/strict";

import {
  clearPendingConfirm,
  decodePendingConfirm,
  encodePendingConfirm,
  loadPendingConfirm,
  pendingConfirmStorageKey,
  savePendingConfirm,
  type PendingConfirmStorage,
} from "../lib/receipt-confirm-store";
import {
  buildReceiptConfirmBody,
  fingerprintConfirmBody,
  type ConfirmOperation,
} from "../lib/receipt-workflow";
import type { ReceiptForm } from "../types/receipt";

const NOW = Date.parse("2026-03-01T12:00:00.000Z");
const OWNER = "user:with spaces/%";
const SAVED_AT = "2026-03-01T11:59:59.000Z";

function form(): ReceiptForm {
  return {
    store: "Maple Market",
    date: "2026-03-01",
    total: "4.49",
    currency: "USD",
    items: [
      {
        key: "item-1",
        id: null,
        name: "Oat milk",
        quantity: "1",
        lineTotal: "4.49",
        foodId: null,
        matchStatus: "check",
      },
    ],
  };
}

function manualOperation(key = "confirm-key-1"): ConfirmOperation {
  const body = buildReceiptConfirmBody({ form: form() });
  return { key, body, fingerprint: fingerprintConfirmBody(body) };
}

function nonManualOperation(): ConfirmOperation {
  const body = buildReceiptConfirmBody({
    form: form(),
    receiptId: "receipt-1",
    expectedVersion: 2,
  });
  return {
    key: "confirm-key-versioned",
    body,
    fingerprint: fingerprintConfirmBody(body),
  };
}

function memoryStorage(): {
  storage: PendingConfirmStorage;
  values: Map<string, string>;
} {
  const values = new Map<string, string>();
  return {
    values,
    storage: {
      getItem: async (key) => values.get(key) ?? null,
      setItem: async (key, value) => {
        values.set(key, value);
      },
      removeItem: async (key) => {
        values.delete(key);
      },
    },
  };
}

test("manual retry metadata round-trips with owner scope and a SecureStore-safe key", () => {
  const operation = manualOperation();
  const key = pendingConfirmStorageKey(OWNER);
  assert.match(key, /^[A-Za-z0-9._-]+$/);
  assert.notEqual(key, pendingConfirmStorageKey("someone-else"));

  const raw = encodePendingConfirm(OWNER, operation, SAVED_AT);
  const recovery = decodePendingConfirm(raw, OWNER, NOW);
  assert.ok(recovery);
  assert.deepEqual(recovery.operation, operation);
  assert.equal(recovery.savedAt, SAVED_AT);
  assert.equal(recovery.ageMs, 1000);

  assert.equal(decodePendingConfirm(raw, "someone-else", NOW), null);
});

test("decode rejects tampered bodies, bad keys, non-manual payloads and stale clocks", () => {
  const raw = encodePendingConfirm(OWNER, manualOperation(), SAVED_AT);
  const tampered = JSON.parse(raw) as {
    operation: { body: { total: string }; key: string };
    schemaVersion: number;
    savedAt: string;
  };

  tampered.operation.body.total = "9.99";
  assert.equal(decodePendingConfirm(JSON.stringify(tampered), OWNER, NOW), null);

  const badKey = JSON.parse(raw) as typeof tampered;
  badKey.operation.key = "bad key";
  assert.equal(decodePendingConfirm(JSON.stringify(badKey), OWNER, NOW), null);

  const badSchema = JSON.parse(raw) as typeof tampered;
  badSchema.schemaVersion = 2;
  assert.equal(decodePendingConfirm(JSON.stringify(badSchema), OWNER, NOW), null);

  const badDate = JSON.parse(raw) as typeof tampered;
  badDate.savedAt = "not-a-date";
  assert.equal(decodePendingConfirm(JSON.stringify(badDate), OWNER, NOW), null);

  const nonManual = encodePendingConfirm(OWNER, nonManualOperation(), SAVED_AT);
  assert.equal(decodePendingConfirm(nonManual, OWNER, NOW), null);

  const future = encodePendingConfirm(
    OWNER,
    manualOperation(),
    new Date(NOW + 60_000).toISOString(),
  );
  assert.equal(decodePendingConfirm(future, OWNER, NOW)?.ageMs, 0);
});

test("saved retries preserve their original timestamp and retain exact retries regardless of age", async () => {
  const { storage, values } = memoryStorage();
  const operation = manualOperation();
  assert.equal(await savePendingConfirm(storage, OWNER, operation, SAVED_AT), true);
  assert.equal(values.has(pendingConfirmStorageKey(OWNER)), true);

  const fresh = await loadPendingConfirm(storage, OWNER, NOW);
  assert.equal(fresh.status, "record");
  if (fresh.status === "record") {
    assert.equal(fresh.recovery.savedAt, SAVED_AT);
    assert.equal(fresh.recovery.ageMs, 1000);
  }

  const staleAt = new Date(NOW - 365 * 24 * 60 * 60 * 1000).toISOString();
  assert.equal(await savePendingConfirm(storage, OWNER, operation, staleAt), true);
  const stale = await loadPendingConfirm(storage, OWNER, NOW);
  assert.equal(stale.status, "record");
  if (stale.status === "record") {
    assert.equal(stale.recovery.savedAt, staleAt);
    assert.deepEqual(stale.recovery.operation, operation);
  }
});

test("load fails closed when storage cannot be read or the record is corrupt", async () => {
  const missing = memoryStorage();
  assert.deepEqual(await loadPendingConfirm(missing.storage, OWNER, NOW), {
    status: "none",
  });

  const brokenRead: PendingConfirmStorage = {
    getItem: async () => {
      throw new Error("secure store unavailable");
    },
    setItem: async () => {},
    removeItem: async () => {},
  };
  assert.deepEqual(await loadPendingConfirm(brokenRead, OWNER, NOW), {
    status: "unavailable",
  });

  const corrupt = memoryStorage();
  corrupt.values.set(pendingConfirmStorageKey(OWNER), "{not json");
  assert.deepEqual(await loadPendingConfirm(corrupt.storage, OWNER, NOW), {
    status: "unavailable",
  });

  const tampered = memoryStorage();
  const raw = encodePendingConfirm(OWNER, manualOperation(), SAVED_AT);
  const parsed = JSON.parse(raw) as {
    operation: { body: { store: string } };
  };
  parsed.operation.body.store = "Tampered Market";
  tampered.values.set(pendingConfirmStorageKey(OWNER), JSON.stringify(parsed));
  assert.deepEqual(await loadPendingConfirm(tampered.storage, OWNER, NOW), {
    status: "unavailable",
  });
});

test("save fails closed for non-manual, malformed or unwritable metadata", async () => {
  const { storage } = memoryStorage();
  assert.equal(await savePendingConfirm(storage, OWNER, nonManualOperation()), false);

  const badKey = manualOperation("not a valid key");
  assert.equal(await savePendingConfirm(storage, OWNER, badKey), false);

  const operation = manualOperation();
  const badFingerprint: ConfirmOperation = {
    ...operation,
    fingerprint: "0".repeat(64),
  };
  assert.equal(await savePendingConfirm(storage, OWNER, badFingerprint), false);
  assert.equal(
    await savePendingConfirm(storage, OWNER, operation, "not-a-date"),
    false,
  );

  const brokenWrite: PendingConfirmStorage = {
    getItem: async () => null,
    setItem: async () => {
      throw new Error("quota exceeded");
    },
    removeItem: async () => {},
  };
  assert.equal(await savePendingConfirm(brokenWrite, OWNER, operation), false);
});

test("clear reports storage removal failures instead of silently orphaning a retry", async () => {
  const { storage } = memoryStorage();
  assert.equal(await savePendingConfirm(storage, OWNER, manualOperation()), true);
  assert.equal(await clearPendingConfirm(storage, OWNER), true);
  assert.deepEqual(await loadPendingConfirm(storage, OWNER, NOW), { status: "none" });

  const brokenRemove: PendingConfirmStorage = {
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {
      throw new Error("secure store unavailable");
    },
  };
  assert.equal(await clearPendingConfirm(brokenRemove, OWNER), false);
});
