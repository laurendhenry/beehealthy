/**
 * Pure rules behind `useFoodSearch` (kept separate so they are testable
 * without a React renderer).
 */

import type { FoodOption } from "../types/api";

export const FOOD_SEARCH_MIN_CHARS = 2;
export const FOOD_SEARCH_MAX_CHARS = 100;
export const FOOD_SEARCH_DEBOUNCE_MS = 250;

export type FoodSearchStatus = "idle" | "loading" | "done" | "error";

/** A finished request, remembered with the term it answered. */
export type SettledFoodSearch = {
  term: string;
  results: FoodOption[];
  error: string | null;
};

/** The term actually searched: trimmed, or "" when too short to search. */
export function searchableTerm(query: string): string {
  const term = query.trim().slice(0, FOOD_SEARCH_MAX_CHARS);
  return term.length >= FOOD_SEARCH_MIN_CHARS ? term : "";
}

/**
 * The visible search state for `term`. A settled response only counts when it
 * answered this exact term, so a slow answer for an earlier term never shows.
 */
export function foodSearchView(
  term: string,
  settled: SettledFoodSearch | null,
): { status: FoodSearchStatus; results: FoodOption[]; error: string | null } {
  if (!term) {
    return { status: "idle", results: [], error: null };
  }
  if (!settled || settled.term !== term) {
    return { status: "loading", results: [], error: null };
  }
  return settled.error
    ? { status: "error", results: [], error: settled.error }
    : { status: "done", results: settled.results, error: null };
}

/** Stable identity for list keys and de-duplication. */
export function foodOptionKey(option: FoodOption): string {
  return option.id ? `food:${option.id}` : `usda:${option.fdcId}`;
}
