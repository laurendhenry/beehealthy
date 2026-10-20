import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ApiError } from "../lib/api/client";
import { ApiErrorCodes } from "../types/api";
import {
  canDeleteReceipt,
  classifyDeleteFailure,
  errorCode,
  imageNeedsRefresh,
  isReadOnlyReceipt,
  isReceiptGoneError,
  isReviewableStatus,
  mergeReceiptSummaries,
  parseReceiptIdParam,
  parseReceiptImage,
  parseReceiptPage,
  parseReceiptResource,
  parseReceiptStatusProbe,
  receiptDeleteWarning,
  receiptDetailHref,
  receiptErrorMessage,
  receiptPrimaryAction,
  receiptStatusMeta,
  receiptsListPath,
  reviewReceiptHref,
  type ReceiptSummary,
} from "../lib/api/receipt-history";

function summary(overrides: Partial<ReceiptSummary> = {}): ReceiptSummary {
  return {
    id: "receipt-1",
    version: 1,
    store: "Market",
    date: "2026-10-19",
    dateLabel: "Oct 19",
    itemCount: 2,
    total: 12.5,
    currency: "USD",
    status: "confirmed",
    ...overrides,
  };
}

describe("receipt history parsing", () => {
  it("accepts a null total instead of inventing $0.00 and keeps an opaque cursor", () => {
    const page = parseReceiptPage({
      items: [
        {
          id: "receipt-1",
          version: 3,
          store: "Corner market",
          date: "2026-10-19",
          dateLabel: "Oct 19",
          itemCount: 4,
          total: null,
          currency: "USD",
          status: "ready",
        },
      ],
      nextCursor: "opaque+/cursor=",
    });

    assert.equal(page.items.length, 1);
    assert.equal(page.items[0].total, null);
    assert.equal(page.items[0].status, "ready");
    assert.equal(page.nextCursor, "opaque+/cursor=");
  });

  it("rejects malformed rows instead of dropping them or inventing a status", () => {
    const invalid = (error: unknown) =>
      errorCode(error) === "INVALID_RESPONSE";

    assert.throws(
      () => parseReceiptPage({ items: [{ ...summary(), status: "unknown" }] }),
      invalid,
    );
    assert.throws(() => parseReceiptPage({ items: [null] }), invalid);

    const missingVersion: Record<string, unknown> = { ...summary() };
    delete missingVersion.version;
    assert.throws(
      () => parseReceiptPage({ items: [missingVersion] }),
      invalid,
    );
    assert.throws(
      () => parseReceiptPage({ items: [{ ...summary(), version: 0 }] }),
      invalid,
    );

    const missingStatus: Record<string, unknown> = { ...summary() };
    delete missingStatus.status;
    assert.throws(() => parseReceiptPage({ items: [missingStatus] }), invalid);
  });

  it("rejects a page with no items array as INVALID_RESPONSE", () => {
    assert.throws(
      () => parseReceiptPage({ nextCursor: null }),
      (error: unknown) => errorCode(error) === "INVALID_RESPONSE",
    );
  });

  it("requires status and version on a persisted receipt", () => {
    const resource = {
      id: "receipt-1",
      status: "ready",
      version: 3,
      currency: "USD",
      draft: { store: "", date: "", total: "", items: [] },
      warnings: [],
      error: null,
    };

    assert.equal(parseReceiptResource(resource).version, 3);

    const missingVersion: Record<string, unknown> = { ...resource };
    delete missingVersion.version;
    assert.throws(
      () => parseReceiptResource(missingVersion),
      (error: unknown) => errorCode(error) === "INVALID_RESPONSE",
    );
    assert.throws(
      () => parseReceiptResource({ ...resource, status: "unknown" }),
      (error: unknown) => errorCode(error) === "INVALID_RESPONSE",
    );
  });

  it("requires a valid status/version on probes and a url/expiry on images", () => {
    const invalid = (error: unknown) =>
      errorCode(error) === "INVALID_RESPONSE";

    assert.equal(
      parseReceiptStatusProbe({
        id: "receipt-1",
        status: "processing",
        version: 2,
        error: null,
      }).version,
      2,
    );
    assert.throws(
      () =>
        parseReceiptStatusProbe({
          id: "receipt-1",
          status: "confirmed",
          error: null,
        }),
      invalid,
    );
    assert.throws(
      () =>
        parseReceiptStatusProbe({
          id: "receipt-1",
          status: "bogus",
          version: 1,
          error: null,
        }),
      invalid,
    );

    assert.deepEqual(
      parseReceiptImage({ url: "https://img.test/a", expiresAt: "2026-10-19" }),
      { url: "https://img.test/a", expiresAt: "2026-10-19" },
    );
    assert.throws(() => parseReceiptImage({ expiresAt: "2026-10-19" }), invalid);
    assert.throws(
      () => parseReceiptImage({ url: "", expiresAt: "2026-10-19" }),
      invalid,
    );
  });
});

describe("receipt pagination merge", () => {
  it("appends new ids in server order and replaces stale rows in place", () => {
    const current = [summary({ id: "a", version: 1 }), summary({ id: "b" })];
    const merged = mergeReceiptSummaries(current, [
      summary({ id: "b", version: 2, status: "ready" }),
      summary({ id: "c" }),
      summary({ id: "a", version: 2 }),
    ]);

    assert.deepEqual(
      merged.map((item) => `${item.id}:${item.version}`),
      ["a:2", "b:2", "c:1"],
    );
    assert.equal(merged[1].status, "ready");
  });
});

describe("receipt delete failure classification", () => {
  it("treats 404/410 after a lost 204 as already deleted, and only 409 as conflict", () => {
    const gone = new ApiError({
      status: 404,
      code: ApiErrorCodes.NotFound,
      message: "gone",
    });
    const goneLegacy = new ApiError({
      status: 410,
      code: "GONE",
      message: "gone",
    });
    const conflict = new ApiError({
      status: 409,
      code: ApiErrorCodes.VersionConflict,
      message: "conflict",
    });
    const failed = new ApiError({
      status: 500,
      code: "INTERNAL",
      message: "boom",
    });

    assert.equal(classifyDeleteFailure(gone), "already-deleted");
    assert.equal(classifyDeleteFailure(goneLegacy), "already-deleted");
    assert.equal(classifyDeleteFailure(conflict), "conflict");
    assert.equal(classifyDeleteFailure(failed), "error");
    assert.equal(classifyDeleteFailure(new TypeError("network")), "error");
    assert.equal(isReceiptGoneError(gone), true);
    assert.equal(isReceiptGoneError(conflict), false);
  });
});

describe("receipt status presentation", () => {
  it("maps workflow states to review, monitoring, or read-only affordances", () => {
    assert.equal(receiptPrimaryAction("ready"), "review");
    assert.equal(receiptPrimaryAction("failed"), "review");
    assert.equal(receiptPrimaryAction("processing"), "monitor");
    assert.equal(receiptPrimaryAction("confirmed"), null);
    assert.equal(receiptPrimaryAction("uploading"), null);

    assert.equal(isReviewableStatus("ready"), true);
    assert.equal(isReviewableStatus("processing"), false);
    assert.equal(isReadOnlyReceipt("confirmed"), true);
    assert.equal(isReadOnlyReceipt("ready"), false);
  });

  it("exposes friendly status copy for every workflow state", () => {
    assert.match(receiptStatusMeta("ready").detail, /Nothing is added to your pantry/i);
    assert.match(receiptStatusMeta("confirmed").detail, /read-only/i);
    assert.match(receiptStatusMeta("uploading").detail, /never finished/i);
    assert.match(receiptStatusMeta("deleted").detail, /no longer available/i);
  });

  it("allows deletion except for deleted receipts and warns about pantry removal only when confirmed", () => {
    assert.equal(canDeleteReceipt("confirmed"), true);
    assert.equal(canDeleteReceipt("deleted"), false);
    assert.match(receiptDeleteWarning("confirmed"), /removes its items from your pantry/i);
    assert.doesNotMatch(receiptDeleteWarning("failed"), /pantry/i);
  });
});

describe("receipt routes", () => {
  it("builds encoded list, detail, and review links", () => {
    assert.equal(receiptsListPath(), "/receipts?limit=20");
    assert.equal(
      receiptsListPath({ filter: "confirmed", cursor: "a/b+c=", limit: 5 }),
      "/receipts?limit=5&status=confirmed&cursor=a%2Fb%2Bc%3D",
    );
    assert.equal(
      receiptDetailHref("id with space"),
      "/receipts/id%20with%20space",
    );
    assert.equal(
      reviewReceiptHref("id with space"),
      "/review_receipt?receiptId=id%20with%20space",
    );
  });

  it("normalizes dynamic route ids and rejects empty values", () => {
    assert.equal(parseReceiptIdParam("receipt-1"), "receipt-1");
    assert.equal(parseReceiptIdParam(["receipt-1", "extra"]), "receipt-1");
    assert.equal(parseReceiptIdParam(undefined), null);
    assert.equal(parseReceiptIdParam(""), null);
  });
});

describe("receipt error copy", () => {
  const clientError = (status: number, code: string) =>
    new ApiError({ status, code, message: "raw server message" });

  it("explains deleted or foreign receipts without leaking transport details", () => {
    assert.equal(
      receiptErrorMessage(clientError(404, "NOT_FOUND"), "detail"),
      "This receipt is no longer available.",
    );
    assert.equal(
      receiptErrorMessage(clientError(409, "VERSION_CONFLICT"), "delete"),
      "This receipt changed since it was loaded. Review the latest details, then try again.",
    );
    assert.equal(
      receiptErrorMessage(clientError(422, "INVALID_CURSOR"), "list"),
      "This list changed while you were browsing. Pull to refresh.",
    );
    assert.equal(
      receiptErrorMessage(clientError(0, "NETWORK_ERROR"), "list"),
      "Couldn’t reach BeeHealthy. Check your connection and try again.",
    );
  });

  it("uses image-specific copy for missing images", () => {
    assert.equal(
      receiptErrorMessage(clientError(404, "NOT_FOUND"), "image"),
      "No original image is available for this receipt.",
    );
    assert.equal(
      receiptErrorMessage(clientError(409, "IMAGE_NOT_PARSED"), "image"),
      "The original image isn’t available for this receipt.",
    );
  });

  it("falls back to a readable message for unknown failures", () => {
    assert.equal(
      receiptErrorMessage(new Error("Unexpected payload"), "detail"),
      "Unexpected payload",
    );
    assert.equal(
      receiptErrorMessage({}, "detail"),
      "Something went wrong loading this receipt.",
    );
  });
});

describe("presigned image refresh", () => {
  it("refreshes shortly before expiry and treats invalid timestamps as stale", () => {
    const now = Date.parse("2026-10-19T12:00:00Z");
    assert.equal(
      imageNeedsRefresh({ url: "https://image", expiresAt: "2026-10-19T12:04:00Z" }, now),
      false,
    );
    assert.equal(
      imageNeedsRefresh({ url: "https://image", expiresAt: "2026-10-19T12:00:10Z" }, now),
      true,
    );
    assert.equal(
      imageNeedsRefresh({ url: "https://image", expiresAt: "not-a-date" }, now),
      true,
    );
    assert.equal(imageNeedsRefresh(null, now), false);
  });
});
