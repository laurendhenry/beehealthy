import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { ApiError, apiRequest, buildApiRequest, configureTransport } from "../lib/api/client";

const BASE = "https://api.example.test/api";

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("transport: native vs web credentials", () => {
  it("native attaches the awaited cookie and uses credentials omit", async () => {
    const resolved = await buildApiRequest(
      "/users/me",
      { method: "GET" },
      { platform: "native", baseUrl: BASE, cookieProvider: async () => "better-auth.session_token=abc" },
    );
    assert.equal(resolved.url, `${BASE}/users/me`);
    assert.equal(resolved.headers["Cookie"], "better-auth.session_token=abc");
    assert.equal(resolved.credentials, "omit");
  });

  it("uses the configured native cookie provider without per-call wiring", async () => {
    let cookie = "better-auth.session_token=first";
    configureTransport({ cookieProvider: async () => cookie });
    try {
      const deps = { platform: "native" as const, baseUrl: BASE };
      const first = await buildApiRequest("/users/me", {}, deps);
      assert.equal(first.headers.Cookie, cookie);
      cookie = "better-auth.session_token=renewed";
      const renewed = await buildApiRequest("/users/me", {}, deps);
      assert.equal(renewed.headers.Cookie, cookie);
      const storage = await buildApiRequest("/upload", { authMode: "none" }, deps);
      assert.equal(storage.headers.Cookie, undefined);
    } finally {
      configureTransport({ cookieProvider: undefined });
    }
  });
  it("native omits the Cookie header when no cookie is stored", async () => {
    const resolved = await buildApiRequest(
      "/users/me",
      {},
      { platform: "native", baseUrl: BASE, cookieProvider: async () => null },
    );
    assert.ok(!("Cookie" in resolved.headers));
    assert.equal(resolved.credentials, "omit");
  });

  it("web uses browser cookies and never sends Cookie manually", async () => {
    const resolved = await buildApiRequest(
      "/users/me",
      { headers: { Cookie: "smuggled=yes", "Idempotency-Key": "k" } },
      { platform: "web", baseUrl: BASE, cookieProvider: async () => "must-not-be-used" },
    );
    assert.ok(!("Cookie" in resolved.headers));
    assert.equal(resolved.headers["Idempotency-Key"], "k");
    assert.equal(resolved.credentials, "include");
  });

  it("presigned storage requests (authMode none) send no auth or idempotency headers", async () => {
    const resolved = await buildApiRequest(
      "/upload",
      { method: "PUT", headers: { "Idempotency-Key": "k" }, authMode: "none" },
      {
        platform: "native",
        baseUrl: "https://bucket.example.test",
        cookieProvider: async () => "better-auth.session_token=abc",
      },
    );
    assert.ok(!("Cookie" in resolved.headers));
    assert.equal(resolved.headers["Idempotency-Key"], "k");
    assert.equal(resolved.credentials, "omit");
  });

  it("rejects paths that do not start with /", async () => {
    await assert.rejects(
      buildApiRequest("users/me", {}, { platform: "web", baseUrl: BASE }),
      ApiError,
    );
  });
});

describe("transport: response normalization", () => {
  it("resolves undefined on 204 with no JSON parsing", async () => {
    const result = await apiRequest<void>(
      "/users/me/profile",
      { method: "DELETE" },
      {
        platform: "web",
        baseUrl: BASE,
        fetchImpl: (async () => new Response(null, { status: 204 })) as typeof fetch,
      },
    );
    assert.equal(result, undefined);
  });

  it("returns parsed JSON on success", async () => {
    const result = await apiRequest<{ ok: boolean }>(
      "/users/me",
      {},
      {
        platform: "web",
        baseUrl: BASE,
        fetchImpl: (async () => jsonResponse(200, { ok: true })) as typeof fetch,
      },
    );
    assert.deepEqual(result, { ok: true });
  });

  it("preserves status, code, details, and requestId on application errors", async () => {
    const fetchImpl = (async () =>
      jsonResponse(
        422,
        { error: { code: "VALIDATION_ERROR", message: "Bad total", details: [{ path: "total" }] } },
        { "x-request-id": "req-123" },
      )) as typeof fetch;
    try {
      await apiRequest("/receipts", { method: "POST", body: {} }, { platform: "web", baseUrl: BASE, fetchImpl });
      assert.fail("should have thrown");
    } catch (error) {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 422);
      assert.equal(error.code, "VALIDATION_ERROR");
      assert.deepEqual(error.details, [{ path: "total" }]);
      assert.equal(error.requestId, "req-123");
      assert.ok(!error.isUnauthenticated);
    }
  });

  it("maps 401 to UNAUTHENTICATED and flags isUnauthenticated", async () => {
    const fetchImpl = (async () =>
      jsonResponse(401, { error: { code: "UNAUTHENTICATED", message: "No session" } })) as typeof fetch;
    try {
      await apiRequest("/users/me", {}, { platform: "web", baseUrl: BASE, fetchImpl });
      assert.fail("should have thrown");
    } catch (error) {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 401);
      assert.ok(error.isUnauthenticated);
    }
  });

  it("wraps non-JSON gateway failures with status + request id (no crash)", async () => {
    const fetchImpl = (async () =>
      new Response("<html>Bad Gateway</html>", {
        status: 502,
        headers: { "content-type": "text/html", "x-request-id": "gw-9" },
      })) as typeof fetch;
    try {
      await apiRequest("/users/me", {}, { platform: "web", baseUrl: BASE, fetchImpl });
      assert.fail("should have thrown");
    } catch (error) {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 502);
      assert.equal(error.requestId, "gw-9");
    }
  });

  it("maps fetch failures to NETWORK_ERROR (offline)", async () => {
    const fetchImpl = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    try {
      await apiRequest("/users/me", {}, { platform: "web", baseUrl: BASE, fetchImpl });
      assert.fail("should have thrown");
    } catch (error) {
      assert.ok(error instanceof ApiError);
      assert.equal(error.code, "NETWORK_ERROR");
      assert.equal(error.status, 0);
    }
  });

  it("propagates AbortSignal cancellation without retrying", async () => {
    const controller = new AbortController();
    const seen: string[] = [];
    const fetchImpl = ((url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        seen.push(String(url));
        // Mirror real fetch: an already-aborted signal rejects immediately.
        if (init?.signal?.aborted) {
          reject(new DOMException("Aborted", "AbortError"));
          return;
        }
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      })) as unknown as typeof fetch;
    const pending = apiRequest("/receipts/1/status", { signal: controller.signal }, {
      platform: "web",
      baseUrl: BASE,
      fetchImpl,
    });
    controller.abort();
    await assert.rejects(pending, ApiError);
    assert.equal(seen.length, 1);
  });

  it("never logs cookies, passwords, or signed material on failure", async () => {
    const secret = "session-cookie-secret-xyz";
    const logged: string[] = [];
    const origLog = console.log;
    const origError = console.error;
    const origWarn = console.warn;
    console.log = (...args: unknown[]) => void logged.push(args.map(String).join(" "));
    console.error = (...args: unknown[]) => void logged.push(args.map(String).join(" "));
    console.warn = (...args: unknown[]) => void logged.push(args.map(String).join(" "));
    try {
      const fetchImpl = (async () => {
        throw new TypeError("fetch failed");
      }) as typeof fetch;
      await assert.rejects(
        apiRequest(
          "/users/me",
          { method: "POST", body: { password: secret } },
          {
            platform: "native",
            baseUrl: BASE,
            cookieProvider: async () => secret,
            fetchImpl,
          },
        ),
      );
    } finally {
      console.log = origLog;
      console.error = origError;
      console.warn = origWarn;
    }
    assert.ok(!logged.some((line) => line.includes(secret)), "secret must not be logged");
  });
});
