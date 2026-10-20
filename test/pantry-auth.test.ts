import { it } from "node:test";
import assert from "node:assert/strict";
import { configureTransport } from "../lib/api/client";
import { ApiError, apiRequest, getBasketSummary } from "../lib/api/pantry";
import { getCurrentRecommendation } from "../lib/api/discovery";

const ORIGIN = "https://api.example.test";

/** Point the canonical config at the test origin; returns a restore callback. */
function useTestOrigin(): () => void {
  const previous = process.env.EXPO_PUBLIC_API_ORIGIN;
  process.env.EXPO_PUBLIC_API_ORIGIN = ORIGIN;
  return () => {
    if (previous === undefined) delete process.env.EXPO_PUBLIC_API_ORIGIN;
    else process.env.EXPO_PUBLIC_API_ORIGIN = previous;
  };
}

it("native application requests await the current session cookie on every request", async () => {
  const restoreOrigin = useTestOrigin();
  const originalFetch = globalThis.fetch;
  const requests: RequestInit[] = [];
  let cookie: string | null = "__Secure-better-auth.session_token=first";
  configureTransport({
    cookieProvider: async () => {
      await Promise.resolve();
      return cookie;
    },
  });
  globalThis.fetch = async (_url, init) => {
    requests.push(init ?? {});
    return new Response(JSON.stringify({ categories: [], receiptCount: 0, itemCount: 0, recommendation: null }), { headers: { "content-type": "application/json" } });
  };
  try {
    await getBasketSummary();
    assert.equal(new Headers(requests[0].headers).get("Cookie"), cookie);
    assert.equal(requests[0].credentials, "omit");
    assert.equal(new Headers(requests[0].headers).has("Authorization"), false);

    cookie = "__Secure-better-auth.session_token=refreshed";
    await getCurrentRecommendation();
    assert.equal(new Headers(requests[1].headers).get("Cookie"), cookie);

    cookie = null;
    await getBasketSummary();
    assert.equal(new Headers(requests[2].headers).has("Cookie"), false);
  } finally {
    globalThis.fetch = originalFetch;
    configureTransport({ cookieProvider: undefined });
    restoreOrigin();
  }
});

it("maps a canonical 401 onto the app UNAUTHORIZED taxonomy with status and request id", async () => {
  const restoreOrigin = useTestOrigin();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        error: { code: "UNAUTHENTICATED", message: "No session", requestId: "req-1" },
      }),
      { status: 401, headers: { "content-type": "application/json" } },
    );
  try {
    await assert.rejects(getBasketSummary(), (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.code, "UNAUTHORIZED");
      assert.equal(error.status, 401);
      assert.equal(error.requestId, "req-1");
      return true;
    });
  } finally {
    globalThis.fetch = originalFetch;
    restoreOrigin();
  }
});

it("rejects with AbortError when the caller aborts, not a network failure", async () => {
  const restoreOrigin = useTestOrigin();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    const error = new Error("Aborted");
    error.name = "AbortError";
    throw error;
  };
  const controller = new AbortController();
  controller.abort();
  try {
    await assert.rejects(
      apiRequest("/pantry", { signal: controller.signal }),
      (error: unknown) => error instanceof Error && error.name === "AbortError",
    );
  } finally {
    globalThis.fetch = originalFetch;
    restoreOrigin();
  }
});

it("treats a 2xx non-JSON body as a gateway failure", async () => {
  const restoreOrigin = useTestOrigin();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response("<html>maintenance</html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    });
  try {
    await assert.rejects(
      apiRequest("/pantry"),
      (error: unknown) => error instanceof ApiError && error.code === "GATEWAY_ERROR",
    );
  } finally {
    globalThis.fetch = originalFetch;
    restoreOrigin();
  }
});
