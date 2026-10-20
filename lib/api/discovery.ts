/**
 * Food matching + swaps + recommendations transport.
 *
 * Ownership: matching/swaps scope (plan sections 4, 6, 7, 8, 10-M5).
 * Transport lives in `./pantry` (plan section 4 transport rules shared
 * across my scope); this module adds discovery-specific contracts and the
 * client-side guards the plan requires.
 *
 * Endpoint contracts (all paths relative to `/api`, per plan section 4):
 * - GET    /foods/match            q (2-100 chars), limit 1-20; bare array
 * - GET    /swaps/suggest          optional limit 1-100; {items}
 * - GET    /swaps                  required state=saved|dismissed; {items}
 * - PUT    /swaps/:id/state        {state:"saved"|"dismissed"}; {swapId,state}
 * - DELETE /swaps/:id/state        204; reset state (individual only, no bulk)
 * - GET    /recommendations/current {recommendation|null, generatedAt}
 *
 * Presentation rules enforced here and downstream (never in production copy):
 * - Match `score` is a ranking signal, never a certainty claim.
 * - Saved/dismissed retrieval does not reapply preference filtering: never
 *   promise that saved cards remain compatible or allergen-safe.
 * - USDA catalog detail stays server-side; only id/name/category/score cross.
 */

import {
  ApiError,
  apiRequest,
  buildQuery,
  type ApiRequestOptions,
} from "./pantry";

// ---------------------------------------------------------------------------
// Wire DTOs
// ---------------------------------------------------------------------------

export type FoodMatch = {
  id: string;
  name: string;
  category: string;
  /** Ranking signal only (0-1-ish). Never present as certainty. */
  score: number;
  matchType: string;
};

export type SwapSuggestion = {
  id: string;
  originalItem: string;
  suggestedItem: string;
  similarity: string;
  benefit: string;
};

export type SwapState = "saved" | "dismissed";

export type CurrentRecommendation = {
  recommendation: {
    title: string;
    description: string;
    detail: string;
    swapId: string;
  } | null;
  generatedAt: string;
};

export type SwapTab = "suggested" | "saved" | "dismissed";

function assertFoodMatch(value: unknown): FoodMatch {
  if (
    typeof value !== "object" ||
    value === null ||
    typeof (value as Record<string, unknown>)["id"] !== "string" ||
    typeof (value as Record<string, unknown>)["name"] !== "string"
  ) {
    throw new ApiError("GATEWAY_ERROR", "Unexpected food match shape.");
  }
  const row = value as Record<string, unknown>;
  return {
    id: row["id"] as string,
    name: row["name"] as string,
    category: typeof row["category"] === "string" ? row["category"] : "other",
    score: typeof row["score"] === "number" ? row["score"] : 0,
    matchType: typeof row["matchType"] === "string" ? row["matchType"] : "query",
  };
}

function assertSwap(value: unknown): SwapSuggestion {
  if (
    typeof value !== "object" ||
    value === null ||
    typeof (value as Record<string, unknown>)["id"] !== "string" ||
    typeof (value as Record<string, unknown>)["originalItem"] !== "string" ||
    typeof (value as Record<string, unknown>)["suggestedItem"] !== "string"
  ) {
    throw new ApiError("GATEWAY_ERROR", "Unexpected swap shape.");
  }
  const row = value as Record<string, unknown>;
  return {
    id: row["id"] as string,
    originalItem: row["originalItem"] as string,
    suggestedItem: row["suggestedItem"] as string,
    similarity:
      typeof row["similarity"] === "string" ? row["similarity"] : "",
    benefit: typeof row["benefit"] === "string" ? row["benefit"] : "",
  };
}

function assertRecommendation(value: unknown): CurrentRecommendation {
  if (typeof value !== "object" || value === null) {
    throw new ApiError("GATEWAY_ERROR", "Unexpected recommendation shape.");
  }
  const row = value as Record<string, unknown>;
  const rec = row["recommendation"];
  if (rec !== null && typeof rec !== "object") {
    throw new ApiError("GATEWAY_ERROR", "Unexpected recommendation shape.");
  }
  if (rec !== null) {
    const r = rec as Record<string, unknown>;
    if (
      typeof r["title"] !== "string" ||
      typeof r["description"] !== "string" ||
      typeof r["detail"] !== "string" ||
      typeof r["swapId"] !== "string"
    ) {
      throw new ApiError("GATEWAY_ERROR", "Unexpected recommendation shape.");
    }
  }
  return {
    recommendation: rec as CurrentRecommendation["recommendation"],
    generatedAt:
      typeof row["generatedAt"] === "string" ? row["generatedAt"] : "",
  };
}

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

function clampLimit(value: number | undefined, min: number, max: number, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

/**
 * Search foods. Returns [] without a network call when the query is shorter
 * than 2 characters (plan: search only after two characters). Throws
 * ApiError(VALIDATION_ERROR) for over-long queries instead of sending them.
 * The bare-array response is returned as-is; score stays a ranking signal.
 */
export async function searchFoods(
  q: string,
  options: { limit?: number; signal?: AbortSignal | null } = {},
): Promise<FoodMatch[]> {
  const query = q.trim();
  if (query.length < 2) return [];
  if (query.length > 100) {
    throw new ApiError(
      "VALIDATION_ERROR",
      "Search needs 100 characters or fewer.",
    );
  }
  const limit = clampLimit(options.limit, 1, 20, 10);
  const raw = await apiRequest<unknown>(
    `/foods/match${buildQuery({ q: query, limit })}`,
    { signal: options.signal ?? null },
  );
  if (!Array.isArray(raw)) {
    throw new ApiError("GATEWAY_ERROR", "Unexpected food match shape.");
  }
  return raw.map(assertFoodMatch);
}

export async function suggestSwaps(
  options: { limit?: number; signal?: AbortSignal | null } = {},
): Promise<SwapSuggestion[]> {
  const limit = clampLimit(options.limit, 1, 100, 20);
  const raw = await apiRequest<{ items: unknown }>(
    `/swaps/suggest${buildQuery({ limit })}`,
    { signal: options.signal ?? null },
  );
  if (typeof raw !== "object" || raw === null || !Array.isArray(raw.items)) {
    throw new ApiError("GATEWAY_ERROR", "Unexpected swaps response shape.");
  }
  return raw.items.map(assertSwap);
}

export async function listSwaps(
  state: SwapState,
  signal?: AbortSignal | null,
): Promise<SwapSuggestion[]> {
  const raw = await apiRequest<{ items: unknown }>(
    `/swaps${buildQuery({ state })}`,
    { signal: signal ?? null },
  );
  if (typeof raw !== "object" || raw === null || !Array.isArray(raw.items)) {
    throw new ApiError("GATEWAY_ERROR", "Unexpected swaps response shape.");
  }
  return raw.items.map(assertSwap);
}

export async function setSwapState(
  id: string,
  state: SwapState,
  signal?: AbortSignal | null,
): Promise<{ swapId: string; state: SwapState }> {
  const raw = await apiRequest<{ swapId: string; state: SwapState }>(
    `/swaps/${encodeURIComponent(id)}/state`,
    { method: "PUT", body: { state }, signal: signal ?? null },
  );
  if (
    typeof raw !== "object" ||
    raw === null ||
    typeof raw.swapId !== "string" ||
    (raw.state !== "saved" && raw.state !== "dismissed")
  ) {
    throw new ApiError("GATEWAY_ERROR", "Unexpected swap state shape.");
  }
  return { swapId: raw.swapId, state: raw.state };
}

/** Reset one swap to suggested. No bulk endpoint exists — restore individually. */
export async function resetSwapState(
  id: string,
  signal?: AbortSignal | null,
): Promise<void> {
  await apiRequest<void>(`/swaps/${encodeURIComponent(id)}/state`, {
    method: "DELETE",
    signal: signal ?? null,
  });
}

export async function getCurrentRecommendation(
  signal?: AbortSignal | null,
): Promise<CurrentRecommendation> {
  const raw = await apiRequest<unknown>("/recommendations/current", {
    signal: signal ?? null,
  });
  return assertRecommendation(raw);
}

export type { ApiRequestOptions };
