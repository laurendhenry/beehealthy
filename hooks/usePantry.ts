/**
 * Pantry-screen data: available-item cursor list with per-row consume /
 * remove / PATCH, plus unknown-outcome reconcile.
 *
 * Ownership: pantry scope (plan sections 6, 7, 8, 10-M4).
 * - Cursor pagination: reset on refresh, invalidation, filter change, and
 *   INVALID_CURSOR (cursors are opaque — never decoded).
 * - Partial consume is not idempotency protected: on timeout/network
 *   failure the outcome is unknown, so reconcile (refetch) WITHOUT
 *   auto-replaying the mutation.
 * - Per-row pending + per-row error; quantity PATCH is absolute replacement.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";

import { useAppData } from "../context/AppDataContext";
import {
  ApiError,
  appendPantryPage,
  consumePantryItem,
  isQuantityString,
  isUnknownOutcome,
  listPantry,
  patchPantryItem,
  removePantryItem,
  type PantryItem,
  type PantryPatchInput,
} from "../lib/api/pantry";

const PAGE_LIMIT = 20;

export type PantryRowState = {
  item: PantryItem;
  pending: boolean;
  error: string | null;
};

export type UsePantryResult = {
  rows: PantryRowState[];
  loading: boolean;
  loadingMore: boolean;
  refreshing: boolean;
  error: string | null;
  hasMore: boolean;
  /** Pull-to-refresh / manual retry: resets the cursor chain. */
  refresh: () => void;
  loadMore: () => void;
  consumeAll: (id: string) => Promise<void>;
  consumeQuantity: (id: string, qty: string) => Promise<boolean>;
  remove: (id: string) => Promise<void>;
  saveEdits: (id: string, patch: PantryPatchInput) => Promise<boolean>;
  retry: () => void;
};

export function usePantry(): UsePantryResult {
  const { userId, scopeVersions, invalidateFor } = useAppData();
  const pantryVersion = scopeVersions.pantry;

  const [items, setItems] = useState<PantryItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [pendingIds, setPendingIds] = useState<Record<string, boolean>>({});
  const [rowErrors, setRowErrors] = useState<Record<string, string | null>>({});

  const runIdRef = useRef(0);
  const userIdRef = useRef(userId);
  userIdRef.current = userId;

  // Account change clears every row immediately; reload follows.
  useEffect(() => {
    setItems([]);
    setCursor(null);
    setHasMore(true);
    setError(null);
    setPendingIds({});
    setRowErrors({});
  }, [userId]);

  const loadPage = useCallback(
    async (nextCursor: string | null, mode: "reset" | "append") => {
      if (userIdRef.current === null) return;
      const runId = ++runIdRef.current;
      const controller = new AbortController();
      if (mode === "reset") {
        setLoading(true);
        setError(null);
      } else {
        setLoadingMore(true);
      }
      try {
        const page = await listPantry({
          limit: PAGE_LIMIT,
          cursor: nextCursor,
          status: "available",
          signal: controller.signal,
        });
        if (runIdRef.current !== runId) return;
        // Cursor chains reset on invalidation while a fetch is in flight.
        setItems((current) =>
          mode === "reset" ? page.items : appendPantryPage(current, page),
        );
        setCursor(page.nextCursor);
        setHasMore(page.nextCursor !== null);
        setError(null);
      } catch (err) {
        if (runIdRef.current !== runId) return;
        if (err instanceof Error && err.name === "AbortError") return;
        if (err instanceof ApiError && err.code === "INVALID_CURSOR") {
          // Opaque cursor rejected: restart the chain once from the head.
          if (mode === "append") {
            void loadPage(null, "reset");
            return;
          }
        }
        setError(
          err instanceof ApiError
            ? err.message
            : "Couldn't load your pantry. Pull to refresh and try again.",
        );
      } finally {
        if (runIdRef.current === runId) {
          setLoading(false);
          setLoadingMore(false);
          setRefreshing(false);
        }
      }
    },
    [],
  );

  // Initial load + invalidation refetch (pantry/basket-adjacent writes bump
  // the pantry scope through invalidateFor("pantry-mutation")).
  useEffect(() => {
    if (userId === null) return;
    void loadPage(null, "reset");
  }, [userId, pantryVersion, loadPage]);

  useFocusEffect(
    useCallback(() => {
      if (userId !== null) void loadPage(null, "reset");
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [userId]),
  );

  const refresh = useCallback(() => {
    setRefreshing(true);
    void loadPage(null, "reset");
  }, [loadPage]);

  const loadMore = useCallback(() => {
    if (loading || loadingMore || !hasMore) return;
    void loadPage(cursor, "append");
  }, [loading, loadingMore, hasMore, cursor, loadPage]);

  const setRowPending = useCallback((id: string, pending: boolean) => {
    setPendingIds((current) => ({ ...current, [id]: pending }));
  }, []);

  const setRowError = useCallback((id: string, message: string | null) => {
    setRowErrors((current) => ({ ...current, [id]: message }));
  }, []);

  /** Reconcile after an unknown outcome: refetch, never auto-replay. */
  const reconcile = useCallback(() => {
    void loadPage(null, "reset");
  }, [loadPage]);

  const runRowMutation = useCallback(
    async (id: string, mutate: (signal: AbortSignal) => Promise<PantryItem | void>) => {
      setRowPending(id, true);
      setRowError(id, null);
      const controller = new AbortController();
      try {
        const updated = await mutate(controller.signal);
        if (updated && typeof updated === "object" && "id" in updated) {
          const item = updated as PantryItem;
          setItems((current) =>
            item.status === "available"
              ? current.map((row) => (row.id === item.id ? item : row))
              : current.filter((row) => row.id !== item.id),
          );
        } else {
          // 204 remove: drop the row locally; list stays consistent on refetch.
          setItems((current) => current.filter((row) => row.id !== id));
        }
        invalidateFor("pantry-mutation");
        return true;
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return false;
        if (isUnknownOutcome(err)) {
          // Outcome unknown: reconcile from the server, do NOT replay.
          setRowError(
            id,
            "Couldn't confirm that change — refreshed to check.",
          );
          reconcile();
          return false;
        }
        setRowError(
          id,
          err instanceof ApiError
            ? err.message
            : "That change didn't go through. Try again.",
        );
        return false;
      } finally {
        setRowPending(id, false);
      }
    },
    [invalidateFor, reconcile, setRowError, setRowPending],
  );

  const consumeAll = useCallback(
    async (id: string): Promise<void> => {
      await runRowMutation(id, (signal) =>
        consumePantryItem(id, { all: true }, signal),
      );
    },
    [runRowMutation],
  );

  const consumeQuantity = useCallback(
    async (id: string, qty: string): Promise<boolean> => {
      if (!isQuantityString(qty)) {
        setRowError(id, "Enter a quantity like 0.500 (up to 3 decimals).");
        return false;
      }
      return runRowMutation(id, (signal) =>
        consumePantryItem(id, { qty }, signal),
      );
    },
    [runRowMutation, setRowError],
  );

  const remove = useCallback(
    async (id: string): Promise<void> => {
      await runRowMutation(id, (signal) => removePantryItem(id, signal));
    },
    [runRowMutation],
  );

  const saveEdits = useCallback(
    async (id: string, patch: PantryPatchInput): Promise<boolean> => {
      if (patch.quantity !== undefined && !isQuantityString(patch.quantity)) {
        setRowError(id, "Enter a quantity like 1.500 (up to 3 decimals).");
        return false;
      }
      return runRowMutation(id, (signal) =>
        patchPantryItem(id, patch, signal),
      );
    },
    [runRowMutation, setRowError],
  );

  const rows = useMemo<PantryRowState[]>(
    () =>
      items.map((item) => ({
        item,
        pending: pendingIds[item.id] === true,
        error: rowErrors[item.id] ?? null,
      })),
    [items, pendingIds, rowErrors],
  );

  return {
    rows,
    loading: loading && items.length === 0,
    loadingMore,
    refreshing,
    error: items.length === 0 ? error : null,
    hasMore,
    refresh,
    loadMore,
    consumeAll,
    consumeQuantity,
    remove,
    saveEdits,
    retry: refresh,
  };
}
