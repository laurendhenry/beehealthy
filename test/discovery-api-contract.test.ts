import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

// Offline: fetch is stubbed below and the origin is a dummy HTTPS host.
process.env.EXPO_PUBLIC_API_ORIGIN = "https://api.test.example";

import { ApiError } from "../lib/api/pantry";
import {
  getSwapSuggestions,
  resolveFood,
  searchFoodOptions,
  suggestSwaps,
} from "../lib/api/discovery";

type Call = { url: string; init: RequestInit };
const calls: Call[] = [];
let respond: () => Response = () => json({});

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  calls.length = 0;
  (globalThis as { fetch: typeof fetch }).fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return respond();
  }) as typeof fetch;
});

describe("food search and resolve", () => {
  it("searches catalog and reference options, dropping malformed rows", async () => {
    respond = () =>
      json([
        { id: "f1", referenceId: null, name: "Oats", category: "grains", score: 0.8 },
        { id: null, referenceId: "fd_rolledOats1", name: "Rolled Oats", category: "grains" },
        { id: null, referenceId: null, name: "No identity" },
        { name: 42 },
      ]);
    const options = await searchFoodOptions(" oat ", { limit: 50 });
    assert.deepEqual(options, [
      { id: "f1", referenceId: null, name: "Oats", category: "grains", score: 0.8 },
      { id: null, referenceId: "fd_rolledOats1", name: "Rolled Oats", category: "grains" },
    ]);
    const url = new URL(calls[0].url);
    assert.equal(url.pathname, "/api/foods/search");
    assert.equal(url.searchParams.get("q"), "oat");
    assert.equal(url.searchParams.get("limit"), "20");
  });

  it("never calls the network for queries under two characters", async () => {
    assert.deepEqual(await searchFoodOptions("a"), []);
    assert.equal(calls.length, 0);
  });

  it("resolves a reference record into a catalog food", async () => {
    respond = () => json({ id: "f9", name: "Oats, rolled", category: "grains" });
    assert.deepEqual(await resolveFood("fd_rolledOats1"), {
      id: "f9",
      name: "Oats, rolled",
      category: "grains",
    });
    assert.equal(new URL(calls[0].url).pathname, "/api/foods/resolve");
    assert.equal(calls[0].init.method, "POST");
    assert.deepEqual(JSON.parse(String(calls[0].init.body)), { referenceId: "fd_rolledOats1" });
  });

  it("rejects a malformed resolve response", async () => {
    respond = () => json({ name: "No id" });
    await assert.rejects(resolveFood("fd_rolledOats1"), (error: unknown) => error instanceof ApiError);
  });
});

describe("swap suggestions", () => {
  const swap = {
    id: "s1",
    originalItem: "Butter",
    suggestedItem: "Olive oil",
    similarity: "cooking fat",
    benefit: "Less saturated fat.",
  };

  it("reports whether generation is still pending", async () => {
    respond = () => json({ items: [], generating: true });
    assert.deepEqual(await getSwapSuggestions(), { items: [], generating: true });
    respond = () => json({ items: [swap] });
    const older = await getSwapSuggestions();
    assert.equal(older.generating, false);
    assert.equal((await suggestSwaps()).length, 1);
  });
});
