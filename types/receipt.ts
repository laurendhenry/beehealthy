export type ReceiptItem = {
  id: string;
  name: string;
  quantity: string;

  // Total paid for this line, not the unit price.
  lineTotal: string;

  matchStatus: "matched" | "check";
};

export type ReceiptDraft = {
  store: string;
  date: string;
  total: string;
  items: ReceiptItem[];
};