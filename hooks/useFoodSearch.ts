/**
 * Search-as-you-type over `/foods/search`: debounced, aborts superseded
 * requests and ignores stale responses. `submit()` (return key) searches the
 * current text immediately instead of waiting for the debounce.
 */

import { useCallback, useEffect, useState } from "react";

import { searchFoodOptions } from "../lib/api/discovery";
import {
  FOOD_SEARCH_DEBOUNCE_MS,
  foodSearchView,
  searchableTerm,
  type SettledFoodSearch,
} from "../lib/food-search";
import { useDebouncedValue } from "./useDebouncedValue";

const RESULT_LIMIT = 15;

export function useFoodSearch(query: string) {
  const debounced = useDebouncedValue(query, FOOD_SEARCH_DEBOUNCE_MS);
  const [submitted, setSubmitted] = useState<string | null>(null);
  const [settled, setSettled] = useState<SettledFoodSearch | null>(null);
  const [attempt, setAttempt] = useState(0);

  // A submitted term wins until the text changes again.
  const current = searchableTerm(query);
  const term =
    submitted !== null && submitted === current ? submitted : searchableTerm(debounced);

  useEffect(() => {
    if (!term) {
      return;
    }
    const controller = new AbortController();
    searchFoodOptions(term, { limit: RESULT_LIMIT, signal: controller.signal }).then(
      (results) => {
        if (!controller.signal.aborted) {
          setSettled({ term, results, error: null });
        }
      },
      () => {
        if (!controller.signal.aborted) {
          setSettled({
            term,
            results: [],
            error: "Food search is unavailable right now. Try again.",
          });
        }
      },
    );
    return () => controller.abort();
  }, [term, attempt]);

  const submit = useCallback(() => setSubmitted(searchableTerm(query)), [query]);
  const retry = useCallback(() => {
    setSettled(null);
    setAttempt((value) => value + 1);
  }, []);

  return { term, ...foodSearchView(term, settled), submit, retry };
}
