/**
 * Platform-independent receipt image helpers.
 *
 * The platform modules (`receipt-image.native.ts` / `receipt-image.web.ts`)
 * use these to guarantee the same invariants: measured size, real format
 * signature, exact signed-PUT headers and no invented content types.
 */

import type {
  ReceiptImageContentType,
  UploadTicket,
} from "../types/receipt";

/** Backend `Upload.sizeBytes` maximum. */
export const MAX_RECEIPT_IMAGE_BYTES = 10_000_000;
/** Refresh an allocation this long before its signed URL expires. */
export const UPLOAD_URL_REFRESH_MARGIN_MS = 10_000;

export type ReceiptImageErrorCode =
  | "IMAGE_UNREADABLE"
  | "IMAGE_EMPTY"
  | "IMAGE_TOO_LARGE"
  | "UNSUPPORTED_IMAGE"
  | "IMAGE_CHANGED"
  | "UPLOAD_FAILED";

export class ReceiptImageError extends Error {
  readonly code: ReceiptImageErrorCode;
  readonly status: number | null;

  constructor(
    code: ReceiptImageErrorCode,
    message: string,
    status: number | null = null,
  ) {
    super(message);
    this.name = "ReceiptImageError";
    this.code = code;
    this.status = status;
  }
}

/**
 * What the picker returned. `file` is the web `File`/`Blob`; native uses the
 * `uri`. Never trust `fileName`/`mimeType` as the format.
 */
export type PickedReceiptAsset = {
  uri: string;
  width?: number | null;
  height?: number | null;
  mimeType?: string | null;
  fileName?: string | null;
  fileSize?: number | null;
  file?: unknown;
};

/** Normalized photo ready for allocation + raw PUT. */
export type PreparedReceiptImage = {
  uri: string;
  contentType: ReceiptImageContentType;
  sizeBytes: number;
  width: number;
  height: number;
  /**
   * Upload body (web `Blob`, native `File`). Kept opaque here: it is never
   * serialized, and native re-reads the file by `uri` before uploading.
   */
  body?: unknown;
};

/** Detect JPEG/PNG from magic bytes (`FF D8 FF` / `89 50 4E 47 …`). */
export function detectImageContentType(
  bytes: Uint8Array,
): ReceiptImageContentType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  return null;
}

/** Reject unreadable/empty/oversized images before allocating a receipt. */
export function assertMeasuredImageSize(sizeBytes: number): void {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    throw new ReceiptImageError(
      "IMAGE_EMPTY",
      "That photo is empty or could not be read. Choose another photo.",
    );
  }
  if (sizeBytes > MAX_RECEIPT_IMAGE_BYTES) {
    throw new ReceiptImageError(
      "IMAGE_TOO_LARGE",
      "That photo is larger than 10 MB. Choose a smaller photo.",
    );
  }
}

/**
 * Validate actual bytes against an optional expected type. Renaming a HEIC
 * file to `.jpg` is not a conversion, so signature wins.
 */
export function assertImageMatchesBytes(
  expected: ReceiptImageContentType | null,
  bytes: Uint8Array,
): ReceiptImageContentType {
  const detected = detectImageContentType(bytes);
  if (!detected) {
    throw new ReceiptImageError(
      "UNSUPPORTED_IMAGE",
      "That file is not a JPEG or PNG photo. Choose a JPEG or PNG image.",
    );
  }
  if (expected !== null && expected !== detected) {
    throw new ReceiptImageError(
      "UNSUPPORTED_IMAGE",
      "That photo's contents do not match its file type. Choose another photo.",
    );
  }
  return detected;
}

/**
 * Headers for the signed storage PUT: exactly the headers the server returned
 * (Content-Type, tagging, …). Adding or overriding any of them breaks the
 * signature, so this deliberately does not merge anything.
 */
export function buildSignedPutHeaders(
  ticket: UploadTicket,
): Record<string, string> {
  return { ...ticket.upload.headers };
}

export function signedPutUrl(ticket: UploadTicket): string {
  return ticket.upload.url;
}

/** True when the signed URL is (about to be) expired and must be renewed. */
export function isUploadTicketExpired(
  ticket: UploadTicket,
  now: number = Date.now(),
): boolean {
  const expiresAt = Date.parse(ticket.upload.expiresAt);
  if (!Number.isFinite(expiresAt)) {
    return true;
  }
  return expiresAt - now <= UPLOAD_URL_REFRESH_MARGIN_MS;
}

/** `PUT` body and headers must stay consistent with the measured bytes. */
export function assertUploadMatchesAllocation(
  image: PreparedReceiptImage,
  ticket: UploadTicket,
): void {
  if (image.sizeBytes <= 0 || image.sizeBytes > ticket.upload.maxBytes) {
    throw new ReceiptImageError(
      "IMAGE_TOO_LARGE",
      "That photo no longer fits the upload limit. Choose another photo.",
    );
  }
}

export function isReceiptImageError(error: unknown): error is ReceiptImageError {
  return error instanceof ReceiptImageError;
}
