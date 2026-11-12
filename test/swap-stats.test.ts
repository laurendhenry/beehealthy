import assert from "node:assert/strict";
import test from "node:test";

import { getSwapExplanation, parseSwapStats } from "../components/swaps/swap-stats";
import type { SwapSuggestion } from "../types/swaps";

test("parses nutrient comparisons and ranks the three largest relative changes", () => {
  const stats = parseSwapStats(
    "fiber: 0g → 8.8g; sugars: 32.1g → 8.82g; sodium: 400mg → 300mg; protein: 1g → 1.1g",
  );

  assert.equal(stats.length, 3);
  assert.equal(stats[0].label, "fiber");
  assert.deepEqual(
    { from: stats[0].from, to: stats[0].to, improvement: stats[0].improvement },
    { from: "0g", to: "8.8g", improvement: true },
  );
  assert.equal(stats.some((stat) => stat.label === "sugars"), true);
  assert.equal(stats.some((stat) => stat.label === "protein"), false);
});

test("keeps a short explanation and removes parsed comparison segments", () => {
  const swap: SwapSuggestion = {
    id: "swap-1",
    originalItem: "Sweetened yogurt",
    suggestedItem: "Plain yogurt",
    similarity: "Similar dairy option",
    benefit: "sugars: 32.1g → 8.82g per 100g (OpenNutrition); Less added sugar.",
  };

  assert.equal(getSwapExplanation(swap), "Similar dairy option");
  assert.equal(parseSwapStats(swap.benefit)[0].to, "8.82g");
});
