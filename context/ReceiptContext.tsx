import {
  createContext,
  useContext,
  useState,
  type ReactNode,
} from "react";

import type { ReceiptDraft } from "../types/receipt";

type ReceiptContextValue = {
  imageUri: string | null;
  draft: ReceiptDraft | null;
  confirmedReceipt: ReceiptDraft | null;
  selectImage: (uri: string) => void;
  loadExample: () => void;
  updateDraft: (draft: ReceiptDraft) => void;
  confirmReceipt: () => void;
  resetReceipt: () => void;
};

const ReceiptContext = createContext<ReceiptContextValue | undefined>(
  undefined
);

function createExampleReceipt(): ReceiptDraft {
  return {
    store: "Maple Market",
    date: "2026-10-06",
    total: "19.24",
    items: [
      {
        id: "spinach",
        name: "Baby spinach",
        quantity: "1",
        lineTotal: "3.49",
        matchStatus: "matched",
      },
      {
        id: "chickpeas",
        name: "Chickpeas",
        quantity: "1",
        lineTotal: "1.29",
        matchStatus: "matched",
      },
      {
        id: "cereal",
        name: "Crunch cereal",
        quantity: "1",
        lineTotal: "4.99",
        matchStatus: "check",
      },
      {
        id: "rice",
        name: "Brown rice",
        quantity: "1",
        lineTotal: "3.49",
        matchStatus: "matched",
      },
      {
        id: "yogurt",
        name: "Plain yogurt",
        quantity: "1",
        lineTotal: "3.99",
        matchStatus: "matched",
      },
      {
        id: "bananas",
        name: "Bananas",
        quantity: "1",
        lineTotal: "1.99",
        matchStatus: "matched",
      },
    ],
  };
}

export function ReceiptProvider({ children }: { children: ReactNode }) {
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [draft, setDraft] = useState<ReceiptDraft | null>(null);
  const [confirmedReceipt, setConfirmedReceipt] =
    useState<ReceiptDraft | null>(null);

  function selectImage(uri: string) {
    setImageUri(uri);
    setDraft(null);
    setConfirmedReceipt(null);
  }

  function loadExample() {
    setDraft(createExampleReceipt());
    setConfirmedReceipt(null);
  }

  function updateDraft(nextDraft: ReceiptDraft) {
    setDraft(nextDraft);
    setConfirmedReceipt(null);
  }

  function confirmReceipt() {
    if (!draft) return;

    setConfirmedReceipt({
      ...draft,
      items: draft.items.map((item) => ({ ...item })),
    });
  }

  function resetReceipt() {
    setImageUri(null);
    setDraft(null);
    setConfirmedReceipt(null);
  }

  return (
    <ReceiptContext.Provider
      value={{
        imageUri,
        draft,
        confirmedReceipt,
        selectImage,
        loadExample,
        updateDraft,
        confirmReceipt,
        resetReceipt,
      }}
    >
      {children}
    </ReceiptContext.Provider>
  );
}

export function useReceipt() {
  const context = useContext(ReceiptContext);

  if (!context) {
    throw new Error("useReceipt must be used within ReceiptProvider.");
  }

  return context;
}