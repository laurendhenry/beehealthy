import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { ConfigError, parseApiOrigin } from "../lib/config";

describe("config: EXPO_PUBLIC_API_ORIGIN contract", () => {
  it("accepts a plain https origin and derives /api + /api/auth", () => {
    const config = parseApiOrigin("https://api.example.test");
    assert.equal(config.origin, "https://api.example.test");
    assert.equal(config.apiBaseUrl, "https://api.example.test/api");
    assert.equal(config.authBaseUrl, "https://api.example.test/api/auth");
  });

  it("normalizes a trailing slash and preserves explicit ports", () => {
    const config = parseApiOrigin("https://api.example.test:8443/");
    assert.equal(config.origin, "https://api.example.test:8443");
    assert.equal(config.apiBaseUrl, "https://api.example.test:8443/api");
  });

  it("rejects missing configuration instead of falling back", () => {
    for (const raw of [undefined, "", "   "]) {
      assert.throws(() => parseApiOrigin(raw), ConfigError);
    }
  });

  it("rejects origins with paths, queries, fragments, or credentials", () => {
    for (const raw of [
      "https://api.example.test/api",
      "https://api.example.test?x=1",
      "https://api.example.test#frag",
      "https://user:pass@api.example.test",
      "not-a-url",
    ]) {
      assert.throws(() => parseApiOrigin(raw), ConfigError, raw);
    }
  });

  it("rejects non-HTTPS production origins", () => {
    assert.throws(() => parseApiOrigin("http://api.example.test"), ConfigError);
    assert.throws(() => parseApiOrigin("ftp://api.example.test"), ConfigError);
  });

  it("allows http only for localhost development hosts", () => {
    assert.equal(parseApiOrigin("http://localhost:3000").origin, "http://localhost:3000");
    assert.equal(parseApiOrigin("http://127.0.0.1:3000").origin, "http://127.0.0.1:3000");
    assert.throws(() => parseApiOrigin("http://192.168.1.10:3000"), ConfigError);
  });

  it("exposes error code CONFIG_ERROR for UI handling", () => {
    try {
      parseApiOrigin(undefined);
      assert.fail("should have thrown");
    } catch (error) {
      assert.ok(error instanceof ConfigError);
      assert.equal(error.code, "CONFIG_ERROR");
    }
  });
});
