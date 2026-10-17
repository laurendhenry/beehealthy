export type ReceiptSummary = {
  store: string;
  dateLabel: string;
  itemCount: number;
  total: number;
  status: string;
};

export type BasketCategory = {
  id: string;
  label: string;
  count: number;
};

export type BasketSummaryData = {
  receiptCount: number;
  itemCount: number;
};

export type Recommendation = {
  title: string;
  description: string;
  detail: string;
};

export type HomeData = {
  latestReceipt: ReceiptSummary;
  basketCategories: BasketCategory[];
  basketSummary: BasketSummaryData;
  recommendation: Recommendation;
};

export const mockHomeData: HomeData = {
  latestReceipt: {
    store: "Maple Market",
    dateLabel: "Oct 6",
    itemCount: 6,
    total: 19.24,
    status: "Added to pantry",
  },

  basketCategories: [
    { id: "produce", label: "Fruit & vegetables", count: 6 },
    { id: "grains", label: "Grains", count: 8 },
    { id: "protein", label: "Protein foods", count: 4 },
    { id: "dairy", label: "Dairy", count: 4 },
    { id: "other", label: "Other", count: 2 },
  ],

  basketSummary: {
    receiptCount: 4,
    itemCount: 24,
  },

  recommendation: {
    title: "Make room for more vegetables",
    description: "Try adding broccoli to your next grocery run.",
    detail:
      "Sweetened cereal appears on 3 of 4 receipts. Explore a breakfast alternative.",
  },
};