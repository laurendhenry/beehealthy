/**
 * Swaps-screen data: suggested / saved / dismissed from the server, with
 * persisted per-card save/dismiss/restore and optimistic rollback.
 *
 * Ownership: matching/swaps scope (plan sections 6, 7, 8, 10-M5).
 * - All three lists are server reads; actions persist via PUT/DELETE state.
 * - Optimistic updates roll back per card on failure; pending + error are
 *   tracked per card id.
 * - Dismissed restore is individual (DELETE per id); no bulk endpoint exists,
 *   so no bulk restore is offered.
 * - Saved cards never promise continued compatibility or allergen safety.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";

import { useAppData } from "../context/AppDataContext";
import {
  ApiError,
  isUnknownOutcome,
} from "../lib/api/pantry";
import {
  listSwaps,
  resetSwapState,
  setSwapState,
  suggestSwaps,
  type SwapState,
  type SwapSuggestion,
} from "../lib/api/discovery";

export type SwapCardState = {
  swap: SwapSuggestion;
  pending: boolean;
  error: string | null;
};

export type UseSwapsResult = {
  suggested: SwapCardState[];
  saved: SwapCardState[];
  dismissed: SwapCardState[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
  retry: () => void;
  save: (id: string) => Promise<void>;
  dismiss: (id: string) => Promise<void>;
  /** Restore one dismissed swap to suggested (individual reset only). */
  restore: (id: string) => Promise<void>;
  /** Remove one saved swap back to suggested. */
  unsave: (id: string) => Promise<void>;
};

type Lists = {
  suggested: SwapSuggestion[];
  saved: SwapSuggestion[];
  dismissed: SwapSuggestion[];
};

const EMPTY: Lists = { suggested: [], saved: [], dismissed: [] };

export function useSwaps(): UseSwapsResult {
  const { userId, scopeVersions, invalidateFor } = useAppData();
  const swapsVersion = scopeVersions.swaps;

  const [lists, setLists] = useState<Lists>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingIds, setPendingIds] = useState<Record<string, boolean>>({});
  const [cardErrors, setCardErrors] = useState<Record<string, string | null>>({});

  const runIdRef = useRef(0);
  const userIdRef = useRef(userId);
  userIdRef.current = userId;

  useEffect(() => {
    setLists(EMPTY);
    setError(null);
    setPendingIds({});
    setCardErrors({});
  }, [userId]);

  const load = useCallback(async () => {
    if (userIdRef.current === null) return;
    const runId = ++runIdRef.current;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    try {
      const [suggested, saved, dismissed] = await Promise.all([
        suggestSwaps({ signal: controller.signal }),
        listSwaps("saved", controller.signal),
        listSwaps("dismissed", controller.signal),
      ]);
      if (runIdRef.current !== runId) return;
      setLists({ suggested, saved, dismissed });
    } catch (err) {
      if (runIdRef.current !== runId) return;
      if (err instanceof Error && err.name === "AbortError") return;
      setError(
        err instanceof ApiError
          ? err.message
          : "Couldn't load suggestions. Try again.",
      );
    } finally {
      if (runIdRef.current === runId) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (userId === null) return;
    void load();
  }, [userId, swapsVersion, load]);

  useFocusEffect(
    useCallback(() => {
      if (userId !== null) void load();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [userId]),
  );

  const refresh = useCallback(() => {
    void load();
  }, [load]);

  const setCardPending = useCallback((id: string, pending: boolean) => {
    setPendingIds((current) => ({ ...current, [id]: pending }));
  }, []);

  const setCardError = useCallback((id: string, message: string | null) => {
    setCardErrors((current) => ({ ...current, [id]: message }));
  }, []);

  const moveCard = useCallback(
    (id: string, from: keyof Lists, to: keyof Lists | null) => {
      setLists((current) => {
        const card = current[from].find((swap) => swap.id === id);
        if (!card) return current;
        const next = {
          suggested: current.suggested.filter((swap) => swap.id !== id),
          saved: current.saved.filter((swap) => swap.id !== id),
          dismissed: current.dismissed.filter((swap) => swap.id !== id),
        };
        if (to) next[to] = [...next[to], card];
        return next;
      });
    },
    [],
  );

  /**
   * Persist a state change with optimistic placement and per-card rollback.
   * On unknown outcomes the card is put back and lists refetch to reconcile.
   */
  const persistState = useCallback(
    async (
      id: string,
      from: keyof Lists,
      optimisticTo: keyof Lists | null,
      persist: (signal: AbortSignal) => Promise<unknown>,
      nextState: SwapState | null,
    ): Promise<void> => {
      setCardPending(id, true);
      setCardError(id, null);
      // Snapshot for rollback.
      let snapshot: Lists = EMPTY;
      setLists((current) => {
        snapshot = current;
        return current;
      });
      moveCard(id, from, optimisticTo);
      const controller = new AbortController();
      try {
        await persist(controller.signal);
        invalidateFor("swap-mutation");
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          setLists(snapshot);
          return;
        }
        // Roll the card back; reconcile lists on unknown outcomes.
        setLists(snapshot);
        if (isUnknownOutcome(err)) {
          setCardError(id, "Couldn't confirm that change — reloaded to check.");
          void load();
        } else {
          setCardError(
            id,
            err instanceof ApiError
              ? err.message
              : "That change didn't stick. Try again.",
          );
        }
        void nextState;
      } finally {
        setCardPending(id, false);
      }
    },
    [invalidateFor, load, moveCard, setCardError, setCardPending],
  );

  const save = useCallback(
    (id: string) =>
      persistState(id, "suggested", "saved", (signal) =>
        setSwapState(id, "saved", signal),
      "saved"),
    [persistState],
  );

  const dismiss = useCallback(
    (id: string) =>
      persistState(id, "suggested", "dismissed", (signal) =>
        setSwapState(id, "dismissed", signal),
      "dismissed"),
    [persistState],
  );

  const restore = useCallback(
    (id: string) =>
      persistState(id, "dismissed", "suggested", (signal) =>
        resetSwapState(id, signal),
      null),
    [persistState],
  );

  const unsave = useCallback(
    (id: string) =>
      persistState(id, "saved", "suggested", (signal) =>
        resetSwapState(id, signal),
      null),
    [persistState],
  );

  const withState = useCallback(
    (items: SwapSuggestion[]): SwapCardState[] =>
      items.map((swap) => ({
        swap,
        pending: pendingIds[swap.id] === true,
        error: cardErrors[swap.id] ?? null,
      })),
    [pendingIds, cardErrors],
  );

  return useMemo<UseSwapsResult>(
    () => ({
      suggested: withState(lists.suggested),
      saved: withState(lists.saved),
      dismissed: withState(lists.dismissed),
      loading: loading && lists.suggested.length === 0 && lists.saved.length === 0,
      error:
        lists.suggested.length === 0 &&
        lists.saved.length === 0 &&
        lists.dismissed.length === 0
          ? error
          : null,
      refresh,
      retry: refresh,
      save,
      dismiss,
      restore,
      unsave,
    }),
    [
      withState,
      lists,
      loading,
      error,
      refresh,
      save,
      dismiss,
      restore,
      unsave,
    ],
  );
}
