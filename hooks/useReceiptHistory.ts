/**
 * Receipt history list: cursor pagination, pull-to-refresh, focused revalidate.
 *
 * - Resets to page 1 when the filter changes, the account changes, or the
 *   `receipts` scope is invalidated (confirm/delete elsewhere).
 * - An INVALID_CURSOR page (a deletion shifted the list) clears the cursor and
 *   offers a refresh instead of decoding/guessing the cursor.
 * - Keeps last-success rows visible when a refresh fails; only a cold load
 *   takes over the screen with an error state.
 * - Abort-stale: every request has a controller and a monotonic run id.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";

import { useAppData } from "../context/AppDataContext";
import { errorCode, getReceiptHistory, mergeReceiptSummaries, receiptErrorMessage, type ReceiptHistoryFilter, type ReceiptSummary } from "../lib/api/receipt-history";

const PAGE_SIZE = 20;

type HistoryStatus = "idle" | "loading" | "ready" | "error";
type LoadMode = "initial" | "refresh" | "silent";

export type ReceiptHistory = {
  items: ReceiptSummary[];
  /** `idle`/`loading` only before the first page arrives. */
  loading: boolean;
  status: HistoryStatus;
  /** Cold-load error copy; null once rows are visible. */
  error: string | null;
  /** Refreshing while rows stay visible. */
  refreshing: boolean;
  loadingMore: boolean;
  /** Non-blocking error at the bottom of the list (load-more/cursor). */
  moreError: string | null;
  hasMore: boolean;
  /** Non-blocking notice after a stale refresh failure. */
  notice: string | null;
  refresh: () => void;
  retry: () => void;
  loadMore: () => void;
  retryMore: () => void;
  clearNotice: () => void;
};

function isAbort(error: unknown, signal: AbortSignal): boolean {
  return (
    signal.aborted ||
    (error instanceof Error && error.name === "AbortError")
  );
}

export function useReceiptHistory(filter: ReceiptHistoryFilter): ReceiptHistory {
  const { userId, scopeVersions } = useAppData();
  const receiptsVersion = scopeVersions.receipts;
  const enabled = userId !== null;

  const [items, setItems] = useState<ReceiptSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<HistoryStatus>("idle");
  const [error, setError] = useState<unknown>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const runIdRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const moreControllerRef = useRef<AbortController | null>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const cursorRef = useRef(nextCursor);
  cursorRef.current = nextCursor;
  const filterRef = useRef(filter);
  filterRef.current = filter;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const loadingMoreRef = useRef(false);
  const focusSeenRef = useRef(false);

  const loadFirst = useCallback(async (mode: LoadMode) => {
    if (!enabledRef.current) return;

    const runId = ++runIdRef.current;
    controllerRef.current?.abort();
    moreControllerRef.current?.abort();
    moreControllerRef.current = null;
    loadingMoreRef.current = false;
    setLoadingMore(false);
    setMoreError(null);

    const controller = new AbortController();
    controllerRef.current = controller;

    if (mode !== "silent") {
      setError(null);
      setNotice(null);
    }
    if (mode === "initial") {
      setStatus((previous) => (previous === "ready" ? previous : "loading"));
    }
    if (mode === "refresh") setRefreshing(true);

    try {
      const page = await getReceiptHistory({
        filter: filterRef.current,
        cursor: null,
        limit: PAGE_SIZE,
        signal: controller.signal,
      });
      if (runIdRef.current !== runId) return;
      setItems(page.items);
      setNextCursor(page.nextCursor);
      setError(null);
      setStatus("ready");
    } catch (err) {
      if (runIdRef.current !== runId) return;
      if (isAbort(err, controller.signal)) return;
      if (errorCode(err) === "INVALID_CURSOR") {
        // The opaque cursor no longer matches the server list; page 1 is always
        // safe to request again on the next refresh.
        setNextCursor(null);
      }

      if (mode === "silent") return;
      if (itemsRef.current.length > 0) {
        setNotice(receiptErrorMessage(err, "list"));
        setStatus("ready");
        return;
      }
      setError(err);
      setStatus("error");
    } finally {
      if (runIdRef.current === runId) setRefreshing(false);
    }
  }, []);

  // Reset + reload on account, scope, or filter change. The cleanup aborts
  // stale requests even when the effect never reaches `loadFirst`.
  useEffect(() => {
    if (!enabled) {
      runIdRef.current += 1;
      controllerRef.current?.abort();
      moreControllerRef.current?.abort();
      setItems([]);
      setNextCursor(null);
      setError(null);
      setNotice(null);
      setMoreError(null);
      setStatus("idle");
      setRefreshing(false);
      setLoadingMore(false);
      return;
    }

    setItems([]);
    setNextCursor(null);
    setError(null);
    setNotice(null);
    setMoreError(null);
    setStatus("loading");
    void loadFirst("initial");

    return () => {
      runIdRef.current += 1;
      controllerRef.current?.abort();
      moreControllerRef.current?.abort();
    };
  }, [enabled, userId, receiptsVersion, filter, loadFirst]);

  // Revalidate on focus after the first visit (return from detail/review).
  useFocusEffect(
    useCallback(() => {
      if (!enabled) return;
      if (!focusSeenRef.current) {
        focusSeenRef.current = true;
        return;
      }
      void loadFirst("silent");
    }, [enabled, loadFirst]),
  );

  const loadMore = useCallback(async () => {
    const cursor = cursorRef.current;
    if (!cursor || loadingMoreRef.current || !enabledRef.current) return;

    loadingMoreRef.current = true;
    setLoadingMore(true);
    setMoreError(null);
    moreControllerRef.current?.abort();
    const controller = new AbortController();
    moreControllerRef.current = controller;

    try {
      const page = await getReceiptHistory({
        filter: filterRef.current,
        cursor,
        limit: PAGE_SIZE,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setItems((current) => mergeReceiptSummaries(current, page.items));
      setNextCursor(page.nextCursor);
    } catch (err) {
      if (controller.signal.aborted) return;
      if (errorCode(err) === "INVALID_CURSOR") {
        // The list changed underneath the cursor. Drop it; a refresh rebuilds
        // from page 1 (the backend cursor is an opaque last-id token).
        setNextCursor(null);
      }
      setMoreError(err);
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, []);

  const refresh = useCallback(() => {
    void loadFirst("refresh");
  }, [loadFirst]);

  const retry = useCallback(() => {
    setStatus("loading");
    void loadFirst("initial");
  }, [loadFirst]);

  const retryMore = useCallback(() => {
    if (cursorRef.current) {
      void loadMore();
    } else {
      refresh();
    }
  }, [loadMore, refresh]);

  const clearNotice = useCallback(() => setNotice(null), []);

  return useMemo(
    () => ({
      items,
      loading: status === "idle" || status === "loading",
      status,
      error: status === "error" ? receiptErrorMessage(error, "list") : null,
      refreshing,
      loadingMore,
      moreError: moreError ? receiptErrorMessage(moreError, "list") : null,
      hasMore: nextCursor !== null,
      notice,
      refresh,
      retry,
      loadMore,
      retryMore,
      clearNotice,
    }),
    [
      items,
      status,
      error,
      refreshing,
      loadingMore,
      moreError,
      nextCursor,
      notice,
      refresh,
      retry,
      loadMore,
      retryMore,
      clearNotice,
    ],
  );
}
