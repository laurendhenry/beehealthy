import type { SwapSuggestion } from "../../types/swaps";

export function organizeSuggestedSwaps(swaps: readonly SwapSuggestion[]) {
  const byOriginalItem = new Map<string, SwapSuggestion[]>();
  for (const swap of swaps) {
    const related = byOriginalItem.get(swap.originalItem) ?? [];
    related.push(swap);
    byOriginalItem.set(swap.originalItem, related);
  }

  return {
    featured: swaps[0] ?? null,
    more: swaps.slice(1),
    byOriginalItem,
  };
}
