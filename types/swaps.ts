/**
 * Shared swap/food-discovery types for screens and components.
 *
 * Ownership: matching/swaps scope. Re-exports the server DTOs from
 * `lib/api/discovery` (single source of truth) plus the card-level view
 * state used by SwapCard. Saved cards carry no compatibility or allergen
 * promises — see SwapCard copy rules.
 */

export type {
  FoodMatch,
  SwapSuggestion,
  SwapState,
  SwapTab,
  CurrentRecommendation,
} from "../lib/api/discovery";

/** Which list a SwapCard is rendered in. */
export type SwapVariant = "suggested" | "saved" | "dismissed";
