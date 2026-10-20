/**
 * Receipt wire + form types.
 *
 * Wire DTOs mirror the backend contract in `backend/lambda/contracts.ts`
 * (money and quantity are decimal strings; dates are date-only). The editable
 * form model is deliberately separate from the server resource so dirty edits
 * survive refresh/conflict reconciliation.
 */

import type {
  ReceiptItemMatchStatus,
  ReceiptResource,
  ReceiptStatus,
} from "./api";

export type { ReceiptItemMatchStatus, ReceiptResource, ReceiptStatus };

export type ReceiptResourceItem = ReceiptResource["draft"]["items"][number];
export type ReceiptResourceDraft = ReceiptResource["draft"];

/** Upload image types accepted by `POST /receipts/upload`. */
export type ReceiptImageContentType = "image/jpeg" | "image/png";

/** `POST /receipts/upload` response. The storage key is opaque; never parse it. */
export type UploadTicket = {
  receiptId: string;
  upload: {
    url: string;
    headers: Record<string, string>;
    expiresAt: string;
    maxBytes: number;
  };
};

/** `GET /receipts/:id/status` response. */
export type ReceiptStatusSnapshot = {
  id: string;
  status: ReceiptStatus;
  version: number;
  error: { code: string } | null;
  /** Present while processing; honor it instead of a fixed interval. */
  retryAfterMs?: number;
};

/** `GET /receipts/:id/image` response (short-lived signed URL). */
export type ReceiptImageTicket = {
  url: string;
  expiresAt: string;
};

/** `GET /receipts` row. `total` is a JSON number or null. */
export type ReceiptListSummary = {
  id: string;
  version: number;
  store: string;
  date: string;
  dateLabel: string;
  itemCount: number;
  total: number | null;
  currency: string;
  status: ReceiptStatus;
};

export type ReceiptPage = {
  items: ReceiptListSummary[];
  nextCursor: string | null;
};

// ---------------------------------------------------------------------------
// Writes (request bodies — never include matchStatus)
// ---------------------------------------------------------------------------

export type ReceiptWriteItem = {
  /** Only for rows that came from this persisted receipt (server UUID). */
  id?: string;
  name: string;
  quantity: string;
  lineTotal: string;
  /** `null` explicitly clears a previous product match. */
  foodId: string | null;
};

export type ReceiptWriteBody = {
  store: string;
  date: string;
  total: string;
  currency: "USD";
  items: ReceiptWriteItem[];
};

export type ReceiptConfirmBody = ReceiptWriteBody & {
  receiptId?: string;
  expectedVersion?: number;
};

export type ReceiptPatchBody = Partial<ReceiptWriteBody> & {
  expectedVersion: number;
};

// ---------------------------------------------------------------------------
// Editable form model
// ---------------------------------------------------------------------------

/**
 * One editable row. `key` is a stable local identity for React keys and
 * updates; `id` is the server item id (null for rows the user added).
 */
export type ReceiptFormItem = {
  key: string;
  id: string | null;
  name: string;
  quantity: string;
  lineTotal: string;
  foodId: string | null;
  matchStatus: ReceiptItemMatchStatus;
};

export type ReceiptForm = {
  store: string;
  date: string;
  total: string;
  currency: "USD";
  items: ReceiptFormItem[];
};

// ---------------------------------------------------------------------------
// Workflow state
// ---------------------------------------------------------------------------

/**
 * `loading` = reopening a persisted receipt by id. Everything else mirrors the
 * plan's phases; `failed` keeps the last form/draft so edits are never lost.
 */
export type ReceiptPhase =
  | "idle"
  | "loading"
  | "normalizing"
  | "allocating"
  | "uploading"
  | "parsing"
  | "monitoring"
  | "ready"
  | "confirming"
  | "confirmed"
  | "failed";

export type ReceiptErrorStage =
  | "loading"
  | "normalizing"
  | "allocating"
  | "uploading"
  | "parsing"
  | "confirming"
  | "saving";

/** Structured stage error; screens render `message`, never a raw body. */
export type ReceiptStageError = {
  stage: ReceiptErrorStage;
  message: string;
  code?: string;
  requestId?: string;
  /** Transport failure where the server may have applied the mutation. */
  unknownOutcome: boolean;
  /** The server draft/version changed; dirty edits are preserved. */
  conflict?: boolean;
  /** Field-level issues with form paths (`items.0.name`, `store`, …). */
  issues?: { path: string; message: string }[];
};

/** Result of a confirmation attempt. Only `confirmed` is a success. */
export type ReceiptConfirmOutcome =
  | { status: "confirmed"; receiptId: string; resource: ReceiptResource }
  | { status: "validation"; error: ReceiptStageError }
  | { status: "conflict"; error: ReceiptStageError }
  | { status: "unknown"; error: ReceiptStageError }
  | { status: "error"; error: ReceiptStageError };

/** Normalized local photo metadata (measured, signature-checked). */
export type NormalizedReceiptImage = {
  uri: string;
  contentType: ReceiptImageContentType;
  sizeBytes: number;
  width: number;
  height: number;
};

/** Stable allocation identity: same key + identical metadata on retry. */
export type ReceiptAllocation = {
  key: string;
  contentType: ReceiptImageContentType;
  sizeBytes: number;
};

/** One client-side validation issue, addressed to a form path. */
export type ReceiptValidationIssue = {
  path: string;
  message: string;
};

/** Result of validating an editable form (see lib/receipt-workflow.ts). */
export type ReceiptValidationResult = {
  valid: boolean;
  issues: ReceiptValidationIssue[];
  totalCents: bigint | null;
  lineTotalCents: bigint | null;
  /** `sum(lineTotal) !== total` — backend records TOTAL_MISMATCH, not an error. */
  mismatch: boolean;
};

/** Result of `saveDraft` (PATCH of a persisted ready receipt). */
export type ReceiptSaveOutcome =
  | { status: "saved"; resource: ReceiptResource }
  | { status: "noop" }
  | {
      status: "validation" | "conflict" | "unknown" | "error";
      error: ReceiptStageError;
    };

/**
 * Legacy local-only aliases kept for callers that still speak the pre-backend
 * draft shape. New code should use `ReceiptForm` / `ReceiptFormItem`, which add
 * the stable local `key` and the backend `foodId`.
 *
 * @deprecated use `ReceiptFormItem`
 */
export type ReceiptItem = {
  key?: string;
  id: string;
  name: string;
  quantity: string;
  lineTotal: string;
  foodId?: string | null;
  matchStatus: ReceiptItemMatchStatus;
};

/** @deprecated use `ReceiptForm` */
export type ReceiptDraft = {
  store: string;
  date: string;
  total: string;
  items: ReceiptItem[];
};
