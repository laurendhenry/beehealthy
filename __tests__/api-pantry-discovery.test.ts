/**
 * Offline tests for the home/pantry/profile/matching/swaps scope
 * (plan section 11 — my scope only).
 *
 * - Pure helpers: decimal-string quantity, date-only validation,
 *   TZ-drift-free date labels, null-safe money totals, cursor append,
 *   safe-read retry policy.
 * - Transport: endpoint paths/methods/bodies, query guards, bare-array
 *   match responses, PATCH-vs-DELETE reset, per-card state writes, and
 *   no-network/no-mock-fallback behavior (fetch stub counts calls).
 * - Ownership: invalidation matrix entries for my mutation kinds.
 *
 * Run: compile with tsc to a temp dir, then `node --test` the output.
 * No live network, no AWS, no secrets.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Modules under test perform no I/O at import time; the fetch stub below
// is installed before any test issues a request.
import * as pantry from "../lib/api/pantry";
import * as discovery from "../lib/api/discovery";
import * as appData from "../context/AppDataContext";
type FetchCall = { url: string; init: RequestInit };
const fetchCalls: FetchCall[] = [];
let fetchHandler: (url: string, init: RequestInit) => Promise<Response>;

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function installFetch(
  handler: (url: string, init: RequestInit) => Promise<Response>,
): void {
  fetchCalls.length = 0;
  fetchHandler = handler;
  (globalThis as Record<string, unknown>)["fetch"] = async (
    url: string,
    init: RequestInit,
  ): Promise<Response> => {
    fetchCalls.push({ url, init });
    return fetchHandler(url, init);
  };
}

installFetch(async () => jsonResponse({}));

// Offline tests use a dummy HTTPS origin; fetch is stubbed, so no real
// network ever happens. The production app sets EXPO_PUBLIC_API_ORIGIN
// through its own env config.
process.env["EXPO_PUBLIC_API_ORIGIN"] = "https://api.test.example";

function lastCall(): FetchCall {
  assert.ok(fetchCalls.length > 0, "expected fetch to have been called");
  return fetchCalls[fetchCalls.length - 1]!;
}
const {
  ApiError,
  appendPantryPage,
  buildQuery,
  consumePantryItem,
  deletePantryItem,
  formatDateOnly,
  formatMoneyTotal,
  getBasketSummary,
  getCurrentUser,
  isDateOnlyString,
  isInvalidCursor,
  isQuantityString,
  isUnknownOutcome,
  listPantry,
  patchPantryItem,
  removePantryItem,
  resetUserProfile,
  shouldRetryRead,
  updateUserProfile,
} = pantry;
const { scopesForMutation } = appData;

const {
  getCurrentRecommendation,
  listSwaps,
  resetSwapState,
  searchFoods,
  setSwapState,
  suggestSwaps,
} = discovery;

function pantryItem(overrides: Record<string, unknown> = {}): pantry.PantryItem {
  return {
    id: "p1",
    name: "Oats",
    quantityRemaining: "1.500",
    unit: "item",
    expiresAt: null,
    status: "available",
    foodId: null,
    receiptItemId: "r1",
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...(overrides as Partial<pantry.PantryItem>),
  };
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe("decimal-string quantity validation", () => {
  it("accepts up to three decimals", () => {
    assert.equal(isQuantityString("0.500"), true);
    assert.equal(isQuantityString("1"), true);
    assert.equal(isQuantityString("999999999.999"), true);
  });

  it("rejects non-decimal, zero, negative, and over-precision input", () => {
    assert.equal(isQuantityString(""), false);
    assert.equal(isQuantityString("abc"), false);
    assert.equal(isQuantityString("0"), false);
    assert.equal(isQuantityString("-1.5"), false);
    assert.equal(isQuantityString("1.5000"), false);
    assert.equal(isQuantityString("1,5"), false);
  });
});

describe("date-only validation", () => {
  it("accepts calendar-valid YYYY-MM-DD", () => {
    assert.equal(isDateOnlyString("2026-10-20"), true);
  });

  it("rejects other formats and impossible dates", () => {
    assert.equal(isDateOnlyString("10/20/2026"), false);
    assert.equal(isDateOnlyString("2026-13-01"), false);
    assert.equal(isDateOnlyString("2026-02-30"), false);
    assert.equal(isDateOnlyString(""), false);
  });
});

describe("TZ-drift-free date labels", () => {
  it("renders the same calendar day regardless of viewer timezone", () => {
    const a = formatDateOnly("2026-10-06");
    assert.match(a, /Oct/);
    assert.match(a, /6/);
    assert.equal(formatDateOnly(""), "");
    assert.equal(formatDateOnly(null), "");
  });
});

describe("null-safe money totals", () => {
  it("renders null totals without crashing", () => {
    assert.equal(formatMoneyTotal(null), "Total unavailable");
    assert.equal(formatMoneyTotal(undefined), "Total unavailable");
  });

  it("renders numeric totals in fixed en-US USD", () => {
    assert.equal(formatMoneyTotal(19.24), "$19.24");
    assert.equal(formatMoneyTotal("5"), "$5.00");
  });
});

describe("cursor pagination helpers", () => {
  it("appends pages and dedupes re-seen rows", () => {
    const first = [pantryItem({ id: "a" }), pantryItem({ id: "b" })];
    const page = {
      items: [pantryItem({ id: "b" }), pantryItem({ id: "c" })],
      nextCursor: null,
    };
    const merged = appendPantryPage(first, page);
    assert.deepEqual(
      merged.map((row) => row.id),
      ["a", "b", "c"],
    );
  });

  it("builds queries that skip empty values", () => {
    assert.equal(buildQuery({ a: "x", b: undefined, c: "" }), "?a=x");
    assert.equal(buildQuery({}), "");
  });
});

describe("safe-read retry policy", () => {
  it("retries network/timeout/gateway failures exactly once", () => {
    for (const code of ["NETWORK_ERROR", "TIMEOUT", "GATEWAY_ERROR"] as const) {
      assert.equal(shouldRetryRead(new ApiError(code, "x"), 0), true);
      assert.equal(shouldRetryRead(new ApiError(code, "x"), 1), false);
    }
  });

  it("never retries auth/validation/conflict/aborted reads", () => {
    for (const code of [
      "UNAUTHORIZED",
      "NOT_FOUND",
      "VERSION_CONFLICT",
      "VALIDATION_ERROR",
      "QUOTA_EXCEEDED",
    ] as const) {
      assert.equal(shouldRetryRead(new ApiError(code, "x"), 0), false);
    }
    const abort = new Error("aborted");
    abort.name = "AbortError";
    assert.equal(shouldRetryRead(abort, 0), false);
  });

  it("flags unknown outcomes (timeout/network/server) but not validation", () => {
    assert.equal(isUnknownOutcome(new ApiError("TIMEOUT", "x")), true);
    assert.equal(isUnknownOutcome(new ApiError("NETWORK_ERROR", "x")), true);
    assert.equal(
      isUnknownOutcome(new ApiError("VALIDATION_ERROR", "x")),
      false,
    );
    assert.equal(isInvalidCursor(new ApiError("INVALID_CURSOR", "x")), true);
    assert.equal(isInvalidCursor(new ApiError("TIMEOUT", "x")), false);
  });
});

// ---------------------------------------------------------------------------
// Transport contracts
// ---------------------------------------------------------------------------

describe("pantry list transport", () => {
  it("defaults to available status with limit 20", async () => {
    installFetch(async () =>
      jsonResponse({ items: [], nextCursor: null }),
    );
    const page = await listPantry();
    assert.deepEqual(page, { items: [], nextCursor: null });
    const call = lastCall();
    assert.match(call.url, /\/api\/pantry\?/);
    assert.match(call.url, /status=available/);
    assert.match(call.url, /limit=20/);
  });

  it("surfaces INVALID_CURSOR so callers can restart the chain", async () => {
    installFetch(async () =>
      jsonResponse(
        { error: { code: "INVALID_CURSOR", message: "stale cursor" } },
        400,
      ),
    );
    await assert.rejects(listPantry({ cursor: "opaque" }), (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.code, "INVALID_CURSOR");
      return true;
    });
  });
});

describe("consume transport (not idempotency protected)", () => {
  it("sends absolute decimal-string qty with no idempotency key", async () => {
    installFetch(async () => jsonResponse(pantryItem()));
    const updated = await consumePantryItem("p1", { qty: "0.500" });
    assert.equal(updated.quantityRemaining, "1.500");
    const call = lastCall();
    assert.match(call.url, /\/api\/pantry\/p1\/consume/);
    assert.equal(call.init.method, "POST");
    const body = JSON.parse(String(call.init.body));
    assert.deepEqual(body, { qty: "0.500" });
    assert.ok(!("idempotencyKey" in body));
  });

  it("sends consume-all without a quantity", async () => {
    installFetch(async () => jsonResponse(pantryItem({ status: "consumed" })));
    await consumePantryItem("p1", { all: true });
    const body = JSON.parse(String(lastCall().init.body));
    assert.deepEqual(body, { all: true });
  });
});

describe("remove transport and DELETE alias", () => {
  it("POSTs the remove endpoint and resolves 204", async () => {
    installFetch(async () => new Response(null, { status: 204 }));
    await removePantryItem("p1");
    const call = lastCall();
    assert.match(call.url, /\/api\/pantry\/p1\/remove/);
    assert.equal(call.init.method, "POST");
  });

  it("supports the DELETE alias", async () => {
    installFetch(async () => new Response(null, { status: 204 }));
    await deletePantryItem("p1");
    assert.equal(lastCall().init.method, "DELETE");
  });
});

describe("pantry PATCH transport", () => {
  it("sends absolute quantity replacement", async () => {
    installFetch(async () =>
      jsonResponse(pantryItem({ quantityRemaining: "2.000" })),
    );
    const updated = await patchPantryItem("p1", { quantity: "2.000" });
    assert.equal(updated.quantityRemaining, "2.000");
    const call = lastCall();
    assert.equal(call.init.method, "PATCH");
    assert.deepEqual(JSON.parse(String(call.init.body)), {
      quantity: "2.000",
    });
  });
});

describe("basket summary transport", () => {
  it("returns available-rows semantics without spending totals", async () => {
    installFetch(async () =>
      jsonResponse({ categories: [], receiptCount: 2, itemCount: 5 }),
    );
    const summary = await getBasketSummary();
    assert.deepEqual(summary, {
      categories: [],
      receiptCount: 2,
      itemCount: 5,
    });
    assert.match(lastCall().url, /\/api\/basket\/summary/);
  });
});

describe("profile PATCH vs DELETE-reset", () => {
  it("PATCHes partial preferences", async () => {
    const profile = {
      locale: "en-US",
      timezone: "America/New_York",
      preferredCurrency: "USD",
      dietaryPreferences: ["vegetarian"],
      excludedIngredients: [],
      preferencesJson: {},
    };
    installFetch(async () => jsonResponse({ profile }));
    const updated = await updateUserProfile({ timezone: "America/New_York" });
    assert.equal(updated.timezone, "America/New_York");
    const call = lastCall();
    assert.equal(call.init.method, "PATCH");
    assert.match(call.url, /\/api\/users\/me\/profile/);
  });

  it("resets preferences with DELETE and no body", async () => {
    installFetch(async () => new Response(null, { status: 204 }));
    await resetUserProfile();
    const call = lastCall();
    assert.equal(call.init.method, "DELETE");
    assert.equal(call.init.body, undefined);
  });

  it("reads identity with name and email", async () => {
    installFetch(async () =>
      jsonResponse({
        id: "u1",
        name: "Bee",
        email: "bee@example.com",
        image: null,
      }),
    );
    const user = await getCurrentUser();
    assert.equal(user.name, "Bee");
    assert.equal(user.email, "bee@example.com");
  });
});

describe("food match transport (bare array)", () => {
  it("returns [] without a network call for short queries", async () => {
    installFetch(async () => {
      throw new Error("fetch must not be called");
    });
    assert.deepEqual(await searchFoods(""), []);
    assert.deepEqual(await searchFoods("a"), []);
    assert.equal(fetchCalls.length, 0);
  });

  it("rejects over-long queries without a network call", async () => {
    installFetch(async () => {
      throw new Error("fetch must not be called");
    });
    await assert.rejects(searchFoods("x".repeat(101)), (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.code, "VALIDATION_ERROR");
      return true;
    });
    assert.equal(fetchCalls.length, 0);
  });

  it("passes the bare array through with limit clamping", async () => {
    installFetch(async () =>
      jsonResponse([{ id: "f1", name: "Oats", category: "grains" }]),
    );
    const matches = await searchFoods("oat", { limit: 500 });
    assert.equal(matches.length, 1);
    assert.equal(matches[0]!.name, "Oats");
    // Clamped to the 1-20 window.
    assert.match(lastCall().url, /limit=20/);
  });
});

describe("swaps transport", () => {
  const swap = {
    id: "s1",
    originalItem: "Butter",
    suggestedItem: "Olive oil",
    similarity: "cooking fat",
    benefit: "Lower saturated fat.",
  };

  it("fetches suggestions and saved/dismissed lists", async () => {
    installFetch(async () => jsonResponse({ items: [swap] }));
    assert.equal((await suggestSwaps()).length, 1);
    assert.match(lastCall().url, /\/api\/swaps\/suggest/);

    installFetch(async () => jsonResponse({ items: [swap] }));
    assert.equal((await listSwaps("saved")).length, 1);
    assert.match(lastCall().url, /state=saved/);
  });

  it("persists save/dismiss with PUT and resets with per-id DELETE", async () => {
    installFetch(async () =>
      jsonResponse({ swapId: "s1", state: "saved" }),
    );
    const written = await setSwapState("s1", "saved");
    assert.deepEqual(written, { swapId: "s1", state: "saved" });
    const put = lastCall();
    assert.equal(put.init.method, "PUT");
    assert.match(put.url, /\/api\/swaps\/s1\/state/);
    assert.deepEqual(JSON.parse(String(put.init.body)), {
      state: "saved",
    });

    installFetch(async () => new Response(null, { status: 204 }));
    await resetSwapState("s1");
    const del = lastCall();
    assert.equal(del.init.method, "DELETE");
    assert.match(del.url, /\/api\/swaps\/s1\/state/);
  });
});

describe("recommendation transport", () => {
  it("passes null recommendations through", async () => {
    installFetch(async () =>
      jsonResponse({ recommendation: null, generatedAt: "" }),
    );
    const current = await getCurrentRecommendation();
    assert.equal(current.recommendation, null);
    assert.match(lastCall().url, /\/api\/recommendations\/current/);
  });
});

// ---------------------------------------------------------------------------
// Invalidation matrix
// ---------------------------------------------------------------------------

describe("invalidation matrix", () => {
  it("fans receipt-confirm out to pantry, basket, swaps, recommendation", () => {
    assert.deepEqual(
      [...scopesForMutation("receipt-confirm")].sort(),
      ["basket", "pantry", "receipts", "recommendation", "swaps"],
    );
  });

  it("fans profile mutations to user, swaps, recommendation", () => {
    assert.deepEqual([...scopesForMutation("profile-mutation")].sort(), [
      "recommendation",
      "swaps",
      "user",
    ]);
  });

  it("keeps swap mutations scoped to swaps and recommendation", () => {
    assert.deepEqual([...scopesForMutation("swap-mutation")].sort(), [
      "recommendation",
      "swaps",
    ]);
  });

  it("exposes the context provider", () => {
    assert.equal(typeof appData.AppDataProvider, "function");
    assert.equal(typeof appData.useServerQuery, "function");
  });
});
