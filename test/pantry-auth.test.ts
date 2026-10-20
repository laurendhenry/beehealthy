import { it } from "node:test";
import assert from "node:assert/strict";
import { configureApi, getBasketSummary } from "../lib/api/pantry";
import { getCurrentRecommendation } from "../lib/api/discovery";

it("native application requests await the current session cookie on every request", async () => {
  const originalFetch = globalThis.fetch;
  const requests: RequestInit[] = [];
  let cookie: string | null = "__Secure-better-auth.session_token=first";
  configureApi({
    origin: "https://api.example.test",
    getCookieHeader: async () => {
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
    configureApi({ origin: null, getCookieHeader: null });
  }
});
