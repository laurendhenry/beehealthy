import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ApiError, type TransportDeps } from "../lib/api/client";
import {
  allocateReceiptUpload, confirmReceipt, deleteReceipt, getReceipt,
  getReceiptImage, getReceiptStatus, listReceipts, patchReceipt, requestReceiptParse,
} from "../lib/api/receipts";
import type { ReceiptConfirmBody, ReceiptResource } from "../types/receipt";

const BASE = "https://api.example.test/api";
const ID = "eac82dd9-6529-4d29-9f17-b6ba2f168846";
const ITEM_ID = "dfbaae15-80c7-4ae7-8e01-d0c49732d939";
const draft = {
  store: "Sample market", date: "2026-10-19", total: "2.50",
  items: [{ id: ITEM_ID, name: "Beans", quantity: "1.000", lineTotal: "2.50", foodId: null, matchStatus: "check" as const }],
};
const resource: ReceiptResource = {
  id: ID, status: "ready", version: 3, currency: "USD", draft, warnings: [], error: null,
};
const manual: ReceiptConfirmBody = {
  store: draft.store, date: draft.date, total: draft.total, currency: "USD",
  items: [{ name: "Beans", quantity: "1.000", lineTotal: "2.50", foodId: null }],
};

type Call = { url: string; init: RequestInit };
function transport(payload: unknown, status = 200): { calls: Call[]; deps: TransportDeps } {
  const calls: Call[] = [];
  return {
    calls,
    deps: {
      baseUrl: BASE, platform: "native", cookieProvider: async () => "session=account-a",
      fetchImpl: (async (url: string | URL | Request, init: RequestInit) => {
        calls.push({ url: String(url), init });
        return new Response(status === 204 ? null : JSON.stringify(payload), {
          status, headers: { "content-type": "application/json", "x-request-id": "receipt-test" },
        });
      }) as typeof fetch,
    },
  };
}

function body(call: Call): unknown { return JSON.parse(String(call.init.body)); }

describe("receipt API: live wire contracts", () => {
  it("allocates uploads with metadata, account cookie and a stable idempotency key", async () => {
    const payload = { receiptId: ID, upload: {
      url: "https://storage.example.test/signed", headers: { "Content-Type": "image/jpeg", "x-amz-tagging": "receipt=true" },
      expiresAt: "2026-10-19T12:15:00Z", maxBytes: 10_000_000,
    } };
    const t = transport(payload, 201);
    assert.deepEqual(await allocateReceiptUpload({ contentType: "image/jpeg", sizeBytes: 100 }, "upload-key", { deps: t.deps }), payload);
    assert.equal(t.calls[0].url, `${BASE}/receipts/upload`);
    assert.equal(t.calls[0].init.method, "POST");
    assert.deepEqual(body(t.calls[0]), { contentType: "image/jpeg", sizeBytes: 100 });
    const headers = t.calls[0].init.headers as Record<string, string>;
    assert.equal(headers["Idempotency-Key"], "upload-key");
    assert.equal(headers.Cookie, "session=account-a");
  });

  it("sends the required empty JSON parse body and accepts a bare 202 processing resource", async () => {
    const processing = { ...resource, status: "processing" };
    const t = transport(processing, 202);
    assert.equal((await requestReceiptParse(ID, { deps: t.deps })).status, "processing");
    assert.equal(t.calls[0].url, `${BASE}/receipts/${ID}/parse`);
    assert.equal(t.calls[0].init.method, "POST");
    assert.deepEqual(body(t.calls[0]), {});
  });

  it("creates manual/example receipts on the server with exact retry payloads", async () => {
    const t = transport({ ...resource, status: "confirmed" }, 201);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const saved = await confirmReceipt(manual, "manual-confirm-key", { deps: t.deps });
      assert.equal(saved.id, ID);
      assert.equal(saved.status, "confirmed");
    }
    assert.equal(t.calls[0].url, `${BASE}/receipts`);
    assert.deepEqual(body(t.calls[0]), manual);
    assert.equal(t.calls[0].init.body, t.calls[1].init.body);
    assert.equal((t.calls[1].init.headers as Record<string, string>)["Idempotency-Key"], "manual-confirm-key");
    assert.equal("receiptId" in (body(t.calls[0]) as object), false);
  });

  it("preserves backend item IDs and expected versions for persisted corrections and confirmation", async () => {
    const t = transport(resource);
    const { matchStatus: _matchStatus, ...item } = draft.items[0];
    const savedDraft = { ...manual, items: [item], expectedVersion: 3 };
    await patchReceipt(ID, savedDraft, { deps: t.deps });
    await confirmReceipt({ ...savedDraft, receiptId: ID }, "existing-confirm", { deps: t.deps });
    assert.equal(t.calls[0].init.method, "PATCH");
    assert.equal(t.calls[0].url, `${BASE}/receipts/${ID}`);
    assert.deepEqual(body(t.calls[0]), savedDraft);
    assert.equal((body(t.calls[1]) as { receiptId: string }).receiptId, ID);
    assert.equal((body(t.calls[1]) as { expectedVersion: number }).expectedVersion, 3);
  });

  it("surfaces backend version conflicts instead of synthesizing a successful receipt", async () => {
    const t = transport({ error: { code: "VERSION_CONFLICT", message: "Refresh before editing", requestId: "conflict-id" } }, 409);
    await assert.rejects(confirmReceipt({ ...manual, receiptId: ID, expectedVersion: 2 }, "stale", { deps: t.deps }),
      (error: unknown) => error instanceof ApiError && error.code === "VERSION_CONFLICT" && error.status === 409 && error.requestId === "conflict-id");
  });

  it("uses account-backed detail, status, image and cursor-paginated history endpoints", async () => {
    const detail = transport(resource);
    assert.equal((await getReceipt(ID, { deps: detail.deps })).id, ID);
    assert.equal(detail.calls[0].url, `${BASE}/receipts/${ID}`);
    const status = transport({ id: ID, status: "processing", version: 2, error: null, retryAfterMs: 2000 });
    assert.equal((await getReceiptStatus(ID, { deps: status.deps })).retryAfterMs, 2000);
    assert.equal(status.calls[0].url, `${BASE}/receipts/${ID}/status`);
    const image = transport({ url: "https://storage.example.test/image", expiresAt: "2026-10-19T12:15:00Z" });
    await getReceiptImage(ID, { deps: image.deps });
    assert.equal(image.calls[0].url, `${BASE}/receipts/${ID}/image`);
    const history = transport({ items: [{ id: ID, version: 3, store: draft.store, date: draft.date, dateLabel: draft.date, itemCount: 1, total: 2.5, currency: "USD", status: "confirmed" }], nextCursor: "next-page" });
    const page = await listReceipts({ limit: 20, cursor: "a+b/=", status: "confirmed" }, { deps: history.deps });
    assert.equal(page.nextCursor, "next-page");
    const query = new URL(history.calls[0].url);
    assert.equal(query.searchParams.get("cursor"), "a+b/=");
    assert.equal(query.searchParams.get("limit"), "20");
    assert.equal(query.searchParams.get("status"), "confirmed");
  });

  it("deletes with an expectedVersion body and accepts the backend's empty 204", async () => {
    const t = transport(undefined, 204);
    assert.equal(await deleteReceipt(ID, 3, { deps: t.deps }), undefined);
    assert.equal(t.calls[0].init.method, "DELETE");
    assert.deepEqual(body(t.calls[0]), { expectedVersion: 3 });
  });

  it("rejects malformed successful responses rather than claiming local success", async () => {
    const t = transport({ status: "confirmed" });
    await assert.rejects(confirmReceipt(manual, "invalid", { deps: t.deps }),
      (error: unknown) => error instanceof ApiError && error.code === "INVALID_RESPONSE");
  });
});
