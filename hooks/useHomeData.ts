/**
 * Home-screen data: latest confirmed receipt + basket summary +
 * current recommendation, loaded independently per card.
 *
 * Ownership: home scope (plan sections 6, 7, 8, 10-M4).
 * - Latest receipt reads Agent B's receipts route (`GET /receipts`,
 *   status=confirmed, limit=1) as a plain server read; review/confirm
 *   workflow stays in Agent B's receipt context — this hook never writes.
 * - Null totals/recommendations tolerated; per-card failure isolation:
 *   one failed source never blanks the others.
 * - No mock fallback: failures surface per card with retry.
 */

import { useCallback, useMemo } from "react";
import { useFocusEffect } from "expo-router";

import { useAppData, useServerQuery } from "../context/AppDataContext";
import {
  ApiError,
  apiRequest,
  formatDateOnly,
  formatMoneyTotal,
  getBasketSummary,
  type BasketSummary,
} from "../lib/api/pantry";
import {
  getCurrentRecommendation,
  type CurrentRecommendation,
} from "../lib/api/discovery";

// ---------------------------------------------------------------------------
// Latest-receipt read (Agent B owns the route; this is a read-only view)
// ---------------------------------------------------------------------------

export type LatestReceipt = {
  id: string;
  store: string;
  date: string;
  /** Pre-formatted, TZ-drift-free label, e.g. "Oct 6". */
  dateLabel: string;
  /** Null-safe display, e.g. "$19.24" or "Total unavailable". */
  totalText: string;
  itemCount: number;
  status: string;
};

type ReceiptListItem = {
  id?: unknown;
  store?: unknown;
  date?: unknown;
  total?: unknown;
  items?: unknown;
  itemCount?: unknown;
  status?: unknown;
};

function toLatestReceipt(raw: unknown): LatestReceipt | null {
  if (typeof raw !== "object" || raw === null) return null;
  const row = raw as ReceiptListItem;
  if (typeof row.id !== "string") return null;
  const store = typeof row.store === "string" && row.store ? row.store : "Receipt";
  const date = typeof row.date === "string" ? row.date : "";
  const draftItems = Array.isArray(row.items) ? row.items : null;
  const itemCount =
    typeof row.itemCount === "number"
      ? row.itemCount
      : draftItems
        ? draftItems.length
        : 0;
  return {
    id: row.id,
    store,
    date,
    dateLabel: date ? formatDateOnly(date) : "",
    totalText: formatMoneyTotal(
      (row.total as number | string | null | undefined) ?? null,
    ),
    itemCount,
    status: typeof row.status === "string" ? row.status : "confirmed",
  };
}

async function fetchLatestReceipt(signal: AbortSignal): Promise<LatestReceipt | null> {
  const raw = await apiRequest<{ items?: unknown }>(
    "/receipts?status=confirmed&limit=1",
    { signal },
  );
  if (typeof raw !== "object" || raw === null || !Array.isArray(raw.items)) {
    throw new ApiError("GATEWAY_ERROR", "Unexpected receipts response shape.");
  }
  if (raw.items.length === 0) return null;
  return toLatestReceipt(raw.items[0]);
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export type HomeCardError = {
  message: string;
  retry: () => void;
};

export type HomeData = {
  latestReceipt: LatestReceipt | null;
  latestLoading: boolean;
  latestError: HomeCardError | null;
  basket: BasketSummary | null;
  basketLoading: boolean;
  basketError: HomeCardError | null;
  recommendation: CurrentRecommendation["recommendation"];
  recommendationLoading: boolean;
  recommendationError: HomeCardError | null;
  /** True when the account has no confirmed-receipt history yet. */
  isFirstScan: boolean;
  /** Pull-to-refresh / foreground entry point: reloads every card. */
  refreshAll: () => void;
  lastSuccessAt: number | null;
};

export function useHomeData(): HomeData {
  const { userId } = useAppData();
  const enabled = userId !== null;

  const latest = useServerQuery<LatestReceipt | null>({
    scopes: ["receipts"],
    enabled,
    load: fetchLatestReceipt,
  });
  const basket = useServerQuery<BasketSummary>({
    scopes: ["basket"],
    enabled,
    load: (signal) => getBasketSummary({ signal }),
  });
  const recommendation = useServerQuery<CurrentRecommendation>({
    scopes: ["recommendation"],
    enabled,
    load: getCurrentRecommendation,
  });

  // Revalidate on screen focus (covers foreground + tab switches).
  useFocusEffect(
    useCallback(() => {
      if (!enabled) return;
      latest.refresh();
      basket.refresh();
      recommendation.refresh();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [enabled]),
  );

  const refreshAll = useCallback(() => {
    latest.refresh();
    basket.refresh();
    recommendation.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return useMemo<HomeData>(() => {
    const toCardError = (
      error: ApiError | Error | null,
      retry: () => void,
    ): HomeCardError | null =>
      error
        ? {
            message:
              error instanceof ApiError
                ? error.message
                : "Something went wrong loading this section.",
            retry,
          }
        : null;
    const basketData = basket.data;
    const hasHistory =
      latest.data !== null || (basketData !== null && basketData.receiptCount > 0);
    return {
      latestReceipt: latest.data ?? null,
      latestLoading: latest.status === "loading" || latest.status === "idle",
      latestError: toCardError(latest.error, latest.refresh),
      basket: basketData,
      basketLoading: basket.status === "loading" || basket.status === "idle",
      basketError: toCardError(basket.error, basket.refresh),
      recommendation: recommendation.data?.recommendation ?? null,
      recommendationLoading:
        recommendation.status === "loading" || recommendation.status === "idle",
      recommendationError: toCardError(
        recommendation.error,
        recommendation.refresh,
      ),
      isFirstScan:
        enabled &&
        latest.status === "success" &&
        basket.status === "success" &&
        !hasHistory,
      refreshAll,
      lastSuccessAt: Math.max(
        latest.lastSuccessAt ?? 0,
        basket.lastSuccessAt ?? 0,
        recommendation.lastSuccessAt ?? 0,
      ),
    };
  }, [latest, basket, recommendation, enabled, refreshAll]);
}
