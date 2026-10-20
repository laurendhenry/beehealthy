import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_MONEY_CENTS,
  buildReceiptConfirmBody,
  buildReceiptWrite,
  createExampleForm,
  confirmBodyMatchesResource,
  formFromConfirmBody,
  isDeterministicClientError,
  formatCents,
  isUnknownOutcome,
  normalizeMoney,
  parseMoneyToCents,
  planConfirmOperation,
  planMonitorStep,
  renameReceiptItem,
  selectReceiptItemFoodMatch,
  todayDateOnly,
  validateReceiptForm,
  type ConfirmOperation,
} from "../lib/receipt-workflow";
import type {
  ReceiptForm,
  ReceiptFormItem,
  ReceiptResource,
} from "../types/receipt";
const FOOD_ID = "3f0d9c1e-6a4b-4e2f-9d61-1b2c3d4e5f60";
const ITEM_ID = "7a1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d";

function item(overrides: Partial<ReceiptFormItem> = {}): ReceiptFormItem {
  return {
    key: "item-1",
    id: null,
    name: "Oat milk",
    quantity: "1",
    lineTotal: "4.49",
    foodId: null,
    matchStatus: "check",
    ...overrides,
  };
}

function form(overrides: Partial<ReceiptForm> = {}): ReceiptForm {
  return {
    store: "Maple Market",
    date: "2026-03-01",
    total: "4.49",
    currency: "USD",
    items: [item()],
    ...overrides,
  };
}

test("money normalization matches the backend cents contract", () => {
  assert.equal(normalizeMoney(" 1.2 "), "1.20");
  assert.equal(normalizeMoney("0"), "0.00");
  assert.equal(normalizeMoney("1.234"), null);
  assert.equal(normalizeMoney("-1.00"), null);
  assert.equal(parseMoneyToCents("19.24"), 1924n);
  assert.equal(parseMoneyToCents("0.29"), 29n);
  assert.equal(parseMoneyToCents("21474836.47"), MAX_MONEY_CENTS);
  assert.equal(parseMoneyToCents("21474836.48"), null);
  assert.equal(formatCents(1924n), "19.24");
  assert.equal(formatCents(0n), "0.00");
});

test("validation uses integer cents and reports each invalid field", () => {
  const mismatch = validateReceiptForm(
    form({ total: "0.30", items: [item({ lineTotal: "0.10" })] }),
  );
  assert.equal(mismatch.valid, true);
  assert.equal(mismatch.mismatch, true);
  assert.equal(mismatch.lineTotalCents, 10n);
  assert.equal(mismatch.totalCents, 30n);

  const invalid = validateReceiptForm(
    form({
      store: "   ",
      date: "2026-02-30",
      total: "12.345",
      items: [item({ name: " ", quantity: "0", lineTotal: "1.00" })],
    }),
  );
  assert.equal(invalid.valid, false);
  const paths = invalid.issues.map((issue) => issue.path);
  assert.ok(paths.includes("store"));
  assert.ok(paths.includes("date"));
  assert.ok(paths.includes("total"));
  assert.ok(paths.includes("items.0.name"));
  assert.ok(paths.includes("items.0.quantity"));
});

test("write bodies normalize text/money and never send UI-only fields", () => {
  const write = buildReceiptWrite(
    form({
      store: "  Maple Market  ",
      items: [
        item({
          id: ITEM_ID,
          name: "  Oat milk  ",
          lineTotal: "1.2",
          foodId: FOOD_ID,
          matchStatus: "matched",
        }),
      ],
    }),
  );

  assert.equal(write.store, "Maple Market");
  assert.deepEqual(write.items, [
    { id: ITEM_ID, name: "Oat milk", quantity: "1", lineTotal: "1.20", foodId: FOOD_ID },
  ]);
  assert.equal("matchStatus" in write.items[0]! ? true : false, false);
  assert.equal("key" in write.items[0]! ? true : false, false);
});

test("food matches are real ids, preserved when unchanged and cleared on rename", () => {
  const matched = selectReceiptItemFoodMatch(item(), { id: FOOD_ID });
  assert.equal(matched.foodId, FOOD_ID);
  assert.equal(matched.matchStatus, "matched");

  const unchanged = renameReceiptItem(matched, "Oat milk");
  assert.equal(unchanged, matched);

  const renamed = renameReceiptItem(matched, "Oat milk 64oz");
  assert.equal(renamed.foodId, null);
  assert.equal(renamed.matchStatus, "check");

  const written = buildReceiptWrite(form({ items: [matched] }));
  assert.equal(written.items[0]!.foodId, FOOD_ID);
});

test("confirm bodies include receipt id/version only for existing receipts", () => {
  const manual = buildReceiptConfirmBody({ form: form() });
  assert.equal("receiptId" in manual ? true : false, false);
  assert.equal("expectedVersion" in manual ? true : false, false);
  assert.equal("id" in manual.items[0]! ? true : false, false);

  const existing = buildReceiptConfirmBody({
    form: form({ items: [item({ id: ITEM_ID })] }),
    receiptId: "receipt-1",
    expectedVersion: 3,
  });
  assert.equal(existing.receiptId, "receipt-1");
  assert.equal(existing.expectedVersion, 3);
  assert.equal(existing.items[0]!.id, ITEM_ID);
});

test("confirmation retries reuse the frozen key, payload and expected version", () => {
  let keySequence = 0;
  const createKey = (prefix: string) => `${prefix}-fixed-key-${++keySequence}`;
  const firstForm = form();
  const operation: ConfirmOperation = planConfirmOperation({
    previous: null,
    form: firstForm,
    mode: "submit",
    createKey,
  });
  assert.equal(operation.key, "confirm-fixed-key-1");

  const retry = planConfirmOperation({
    previous: operation,
    form: firstForm,
    mode: "retry",
    createKey: () => "confirm-should-not-be-used",
  });
  assert.equal(retry.key, operation.key);
  assert.deepEqual(retry.body, operation.body);
  assert.equal(retry.fingerprint, operation.fingerprint);

  const changed = planConfirmOperation({
    previous: operation,
    form: form({ total: "9.99" }),
    mode: "retry",
    createKey,
  });
  assert.equal(changed.key, "confirm-fixed-key-2");
  assert.notEqual(changed.fingerprint, operation.fingerprint);

  const versioned = planConfirmOperation({
    previous: null,
    form: form({ items: [item({ id: ITEM_ID })] }),
    receiptId: "receipt-1",
    expectedVersion: 2,
    mode: "submit",
    createKey,
  });
  const versionRetry = planConfirmOperation({
    previous: versioned,
    form: form({ items: [item({ id: ITEM_ID })] }),
    receiptId: "receipt-1",
    expectedVersion: 2,
    mode: "retry",
    createKey: () => "confirm-new",
  });
  assert.equal(versionRetry.key, versioned.key);
  assert.equal(versionRetry.body.expectedVersion, 2);
});

test("unknown outcomes keep the exact key across transport and gateway failures", () => {
  assert.equal(isUnknownOutcome({ code: "NETWORK_ERROR", status: 0 }), true);
  assert.equal(isUnknownOutcome({ code: "NETWORK_ERROR", status: 409 }), true);
  assert.equal(isUnknownOutcome({ code: "TIMEOUT", status: 408 }), true);
  assert.equal(isUnknownOutcome({ code: "INTERNAL", status: 500 }), true);
  assert.equal(isUnknownOutcome({ code: "UNAVAILABLE", status: 503 }), true);
  assert.equal(isUnknownOutcome({ code: "ABORTED", status: 0 }), false);
  assert.equal(isUnknownOutcome({ code: "VERSION_CONFLICT", status: 409 }), false);
  assert.equal(isUnknownOutcome({ code: "VALIDATION_ERROR", status: 400 }), false);
  assert.equal(isUnknownOutcome(null), false);

  assert.equal(isDeterministicClientError({ status: 400 }), true);
  assert.equal(isDeterministicClientError({ status: 409 }), true);
  assert.equal(isDeterministicClientError({ status: 408 }), false);
  assert.equal(isDeterministicClientError({ status: 500 }), false);
  assert.equal(isDeterministicClientError({ code: "ABORTED", status: 0 }), false);
  assert.equal(isDeterministicClientError({ code: "NETWORK_ERROR" }), false);
});

test("monitor plan honors retryAfterMs, terminal statuses and bounds", () => {
  assert.deepEqual(
    planMonitorStep({ attempt: 0, elapsedMs: 0, status: "ready" }),
    { kind: "refreshFull", delayMs: 0 },
  );
  assert.deepEqual(
    planMonitorStep({ attempt: 1, elapsedMs: 0, status: "failed" }),
    { kind: "stop", delayMs: 0, reason: "terminal" },
  );
  assert.deepEqual(
    planMonitorStep({ attempt: 1, elapsedMs: 0, status: "uploading" }),
    { kind: "stop", delayMs: 0, reason: "terminal" },
  );

  const immediate = planMonitorStep({
    attempt: 0,
    elapsedMs: 0,
    status: "processing",
    random: 0,
  });
  assert.equal(immediate.kind, "continue");
  if (immediate.kind === "continue") {
    assert.equal(immediate.delayMs, 1000);
  }

  const directed = planMonitorStep({
    attempt: 2,
    elapsedMs: 10_000,
    status: "processing",
    retryAfterMs: 6000,
    random: 0,
  });
  assert.equal(directed.kind, "continue");
  if (directed.kind === "continue") {
    assert.equal(directed.delayMs, 6000);
  }

  const bounded = planMonitorStep({
    attempt: 12,
    elapsedMs: 20_000,
    status: "processing",
  });
  assert.deepEqual(bounded, { kind: "stop", delayMs: 0, reason: "timeout" });
});

test("example data is real editable input, never a fabricated match or future date", () => {
  const example = createExampleForm("2026-03-01");
  assert.equal(example.date, "2026-03-01");
  assert.equal(example.total, "19.24");
  assert.equal(example.items.length, 6);
  for (const row of example.items) {
    assert.equal(row.id, null);
    assert.equal(row.foodId, null);
    assert.equal(row.matchStatus, "check");
  }
  const check = validateReceiptForm(example);
  assert.equal(check.valid, true);
  assert.equal(check.mismatch, false);

  const today = todayDateOnly(new Date(2026, 2, 1, 23, 30));
  assert.equal(today, "2026-03-01");
});


test("frozen manual confirm bodies restore editable forms and reconcile only exact confirmed receipts", () => {
  const operation = planConfirmOperation({
    previous: null,
    form: form(),
    mode: "submit",
    createKey: () => "confirm-restore-key",
  });
  const restored = formFromConfirmBody(operation.body);
  assert.equal(restored.store, "Maple Market");
  assert.equal(restored.items.length, 1);
  assert.equal(restored.items[0]?.name, "Oat milk");
  assert.equal(restored.items[0]?.matchStatus, "check");
  assert.equal(
    buildReceiptConfirmBody({ form: restored }).items[0]?.name,
    operation.body.items[0]?.name,
  );

  const confirmed: ReceiptResource = {
    id: "receipt-1",
    status: "confirmed",
    version: 3,
    currency: "USD",
    draft: {
      store: "Maple Market",
      date: "2026-03-01",
      total: "4.49",
      items: [
        {
          id: "server-item-1",
          name: "Oat milk",
          quantity: "1",
          lineTotal: "4.49",
          foodId: null,
          matchStatus: "check",
        },
      ],
    },
    warnings: [],
    error: null,
  };
  assert.equal(confirmBodyMatchesResource(operation.body, confirmed), true);
  assert.equal(
    confirmBodyMatchesResource(operation.body, { ...confirmed, status: "ready" }),
    false,
  );
  assert.equal(
    confirmBodyMatchesResource(operation.body, {
      ...confirmed,
      draft: {
        ...confirmed.draft,
        items: [{ ...confirmed.draft.items[0], name: "Different" }],
      },
    }),
    false,
  );
});
