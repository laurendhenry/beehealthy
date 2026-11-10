import test from "node:test";
import assert from "node:assert/strict";

import { foodOptionKey, foodSearchView, searchableTerm } from "../lib/food-search";

test("only searches trimmed terms of at least two characters", () => {
  assert.equal(searchableTerm(" a "), "");
  assert.equal(searchableTerm("  oat milk "), "oat milk");
  assert.equal(searchableTerm("x".repeat(150)).length, 100);
});

test("a response only shows for the exact term it answered", () => {
  const oats = [{ id: "f1", fdcId: null, name: "Oats", category: "grains" }];
  assert.deepEqual(foodSearchView("", null), { status: "idle", results: [], error: null });
  assert.equal(foodSearchView("oat", null).status, "loading");
  // A slow answer for an earlier term is stale.
  assert.equal(
    foodSearchView("oat milk", { term: "oat", results: oats, error: null }).status,
    "loading",
  );
  assert.deepEqual(foodSearchView("oat", { term: "oat", results: oats, error: null }), {
    status: "done",
    results: oats,
    error: null,
  });
  assert.equal(
    foodSearchView("oat", { term: "oat", results: [], error: "unavailable" }).status,
    "error",
  );
});

test("food option keys distinguish catalog and reference records", () => {
  assert.equal(foodOptionKey({ id: "f1", fdcId: null, name: "Oats", category: null }), "food:f1");
  assert.equal(foodOptionKey({ id: null, fdcId: 7, name: "Oats", category: null }), "usda:7");
});
