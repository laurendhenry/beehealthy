import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { getMe, replaceProfile, resetProfile, updateProfile } from "../lib/api/users";
import type { TransportDeps } from "../lib/api/client";

const BASE = "https://api.example.test/api";

interface SeenRequest {
  url: string;
  init: RequestInit;
}

function stubFetch(handler: (url: string, init: RequestInit) => Response) {
  const seen: SeenRequest[] = [];
  const fetchImpl = (async (url: unknown, init?: RequestInit) => {
    seen.push({ url: String(url), init: init ?? {} });
    return handler(String(url), init ?? {});
  }) as typeof fetch;
  return { seen, fetchImpl };
}

function deps(fetchImpl: typeof fetch): TransportDeps {
  return { platform: "web", baseUrl: BASE, fetchImpl };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const PROFILE = {
  timezone: "UTC",
  dietaryPreferences: [],
  excludedIngredients: [],
  preferencesJson: {},
};

describe("users API: endpoint contracts", () => {
  it("GET /users/me/profile uses GET on the profile path", async () => {
    const { seen, fetchImpl } = stubFetch(() =>
      json({ id: "u1", name: "A", email: "a@test.dev", image: null, profile: PROFILE }),
    );
    const me = await getMe(deps(fetchImpl));
    assert.equal(me.id, "u1");
    assert.equal(seen.length, 1);
    assert.equal(seen[0].url, `${BASE}/users/me`);
    assert.equal(seen[0].init.method, "GET");
  });

  it("PUT /users/me/profile performs full replacement", async () => {
    const { seen, fetchImpl } = stubFetch(() => json({ profile: PROFILE }));
    const body = { timezone: "America/Chicago", dietaryPreferences: ["vegan"] };
    const result = await replaceProfile(body, deps(fetchImpl));
    assert.deepEqual(result.profile.timezone, "UTC");
    assert.equal(seen[0].url, `${BASE}/users/me/profile`);
    assert.equal(seen[0].init.method, "PUT");
    assert.deepEqual(JSON.parse(String(seen[0].init.body)), body);
  });

  it("PATCH /users/me/profile preserves omitted fields server-side", async () => {
    const { seen, fetchImpl } = stubFetch(() => json({ profile: PROFILE }));
    await updateProfile({ excludedIngredients: ["peanut"] }, deps(fetchImpl));
    assert.equal(seen[0].init.method, "PATCH");
    assert.deepEqual(JSON.parse(String(seen[0].init.body)), { excludedIngredients: ["peanut"] });
  });

  it("DELETE /users/me/profile resolves on 204 (preference reset, not deletion)", async () => {
    const { seen, fetchImpl } = stubFetch(() => new Response(null, { status: 204 }));
    await resetProfile(deps(fetchImpl));
    assert.equal(seen[0].url, `${BASE}/users/me/profile`);
    assert.equal(seen[0].init.method, "DELETE");
  });
});
