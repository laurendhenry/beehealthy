// Legacy preview data only; live swap screens use server DTOs from types/swaps.
type FoodSwap = {
  id: string;
  originalItem: string;
  suggestedItem: string;
  similarity: string;
  benefit: string;
};

export const mockSwaps: FoodSwap[] = [
  {
    id: "cereal",
    originalItem: "Sweetened cereal",
    suggestedItem: "Lower-added-sugar cereal",
    similarity: "Same quick breakfast format, served with milk.",
    benefit: "Choose an option with less added sugar.",
  },
  {
    id: "beans",
    originalItem: "Regular canned beans",
    suggestedItem: "No-salt-added canned beans",
    similarity: "Use in the same soups, bowls, and salads.",
    benefit: "Choose an option with less sodium.",
  },
  {
    id: "bread",
    originalItem: "White sandwich bread",
    suggestedItem: "Higher-fiber whole-grain bread",
    similarity: "Use for the same sandwiches and toast.",
    benefit: "Choose an option with more fiber.",
  },
];