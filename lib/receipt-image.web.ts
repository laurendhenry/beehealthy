/**
 * Web receipt image preparation + raw signed upload.
 *
 * Browsers can hand back HEIC/other formats; anything that is not already a
 * real JPEG/PNG is decoded and re-encoded to JPEG (max 2400px) so the bytes
 * match the MIME type we allocate. Upload uses a raw `PUT` with exactly the
 * signed headers and `credentials: "omit"` (never cookies to storage).
 */

import type { UploadTicket } from "../types/receipt";
import {
  assertMeasuredImageSize,
  assertUploadMatchesAllocation,
  buildSignedPutHeaders,
  detectImageContentType,
  ReceiptImageError,
  type PickedReceiptAsset,
  type PreparedReceiptImage,
} from "./receipt-image-core";

export * from "./receipt-image-core";

const UPLOAD_TIMEOUT_MS = 60_000;
const MAX_DIMENSION = 2400;
const JPEG_QUALITY = 0.82;

function isBlob(value: unknown): value is Blob {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Blob).size === "number" &&
    typeof (value as Blob).slice === "function" &&
    typeof (value as Blob).arrayBuffer === "function"
  );
}

/**
 * Only local picker data may be read here (object URL, data URL or a local
 * path). Never fetch arbitrary http(s) URLs on behalf of the picker.
 */
function isAllowedLocalMediaUri(uri: string): boolean {
  return (
    uri.startsWith("blob:") ||
    uri.startsWith("data:image/") ||
    uri.startsWith("file:")
  );
}

/**
 * The signed URL comes from our allocation endpoint, but validate the scheme
 * anyway: storage PUTs must be http(s) and must not carry embedded credentials.
 */
export function assertSignedUploadUrl(value: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ReceiptImageError(
      "UPLOAD_FAILED",
      "The upload URL is invalid. Try again.",
    );
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new ReceiptImageError(
      "UPLOAD_FAILED",
      "The upload URL is invalid. Try again.",
    );
  }
  if (parsed.username || parsed.password) {
    throw new ReceiptImageError(
      "UPLOAD_FAILED",
      "The upload URL is invalid. Try again.",
    );
  }
}

async function readPickedBlob(asset: PickedReceiptAsset): Promise<Blob> {
  if (isBlob(asset.file)) {
    return asset.file;
  }
  if (!asset.uri) {
    throw new ReceiptImageError(
      "IMAGE_UNREADABLE",
      "That photo could not be read. Choose another photo.",
    );
  }
  const localUri = asset.uri;
  if (!isAllowedLocalMediaUri(localUri)) {
    throw new ReceiptImageError(
      "IMAGE_UNREADABLE",
      "That photo could not be read. Choose another photo.",
    );
  }
  try {
    const response = await fetch(localUri);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.blob();
  } catch {
    throw new ReceiptImageError(
      "IMAGE_UNREADABLE",
      "That photo could not be read. Choose another photo.",
    );
  }
}

async function decodeToBitmap(blob: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(blob);
    } catch {
      // Fall through to <img> decoding (e.g. older Safari).
    }
  }
  if (typeof document === "undefined") {
    throw new ReceiptImageError(
      "UNSUPPORTED_IMAGE",
      "That photo format is not supported in this browser. Choose a JPEG or PNG image.",
    );
  }
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(
        new ReceiptImageError(
          "UNSUPPORTED_IMAGE",
          "That photo format is not supported in this browser. Choose a JPEG or PNG image.",
        ),
      );
    };
    image.src = url;
  });
}

async function reencodeToJpeg(
  blob: Blob,
): Promise<{ blob: Blob; width: number; height: number }> {
  if (typeof document === "undefined") {
    throw new ReceiptImageError(
      "UNSUPPORTED_IMAGE",
      "That photo format is not supported here. Choose a JPEG or PNG image.",
    );
  }
  const bitmap = await decodeToBitmap(blob);
  const sourceWidth = "width" in bitmap ? bitmap.width : 0;
  const sourceHeight = "height" in bitmap ? bitmap.height : 0;
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    throw new ReceiptImageError(
      "UNSUPPORTED_IMAGE",
      "That photo could not be decoded. Choose another photo.",
    );
  }
  const scale = Math.min(1, MAX_DIMENSION / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new ReceiptImageError(
      "UNSUPPORTED_IMAGE",
      "That photo could not be processed in this browser. Choose another photo.",
    );
  }
  context.drawImage(bitmap as CanvasImageSource, 0, 0, width, height);

  const encoded = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY);
  });
  if (!encoded) {
    throw new ReceiptImageError(
      "UNSUPPORTED_IMAGE",
      "That photo could not be converted. Choose another photo.",
    );
  }
  return { blob: encoded, width, height };
}

export async function prepareReceiptImage(
  asset: PickedReceiptAsset,
): Promise<PreparedReceiptImage> {
  let blob = await readPickedBlob(asset);
  assertMeasuredImageSize(blob.size);

  let width = Math.max(0, Math.round(asset.width ?? 0));
  let height = Math.max(0, Math.round(asset.height ?? 0));
  let contentType = detectImageContentType(
    new Uint8Array(await blob.slice(0, 8).arrayBuffer()),
  );

  if (!contentType) {
    // A renamed HEIC is still HEIC: decode + re-encode to real JPEG bytes.
    const converted = await reencodeToJpeg(blob);
    blob = converted.blob;
    width = converted.width;
    height = converted.height;
    contentType = detectImageContentType(
      new Uint8Array(await blob.slice(0, 8).arrayBuffer()),
    );
    if (!contentType) {
      throw new ReceiptImageError(
        "UNSUPPORTED_IMAGE",
        "That photo could not be converted to JPEG. Choose another photo.",
      );
    }
    assertMeasuredImageSize(blob.size);
  }

  return {
    uri: asset.uri,
    contentType,
    sizeBytes: blob.size,
    width,
    height,
    body: blob,
  };
}

export async function uploadPreparedImage(
  image: PreparedReceiptImage,
  ticket: UploadTicket,
  signal?: AbortSignal | null,
): Promise<void> {
  assertUploadMatchesAllocation(image, ticket);

  const body = isBlob(image.body) ? image.body : null;
  if (!body) {
    throw new ReceiptImageError(
      "IMAGE_CHANGED",
      "That photo is no longer available. Choose it again.",
    );
  }
  if (body.size !== image.sizeBytes) {
    throw new ReceiptImageError(
      "IMAGE_CHANGED",
      "That photo changed after it was selected. Choose it again.",
    );
  }

  const signedUrl = ticket.upload.url;
  assertSignedUploadUrl(signedUrl);

  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal) {
    if (signal.aborted) {
      controller.abort();
    } else {
      signal.addEventListener("abort", abort, { once: true });
    }
  }
  const timer = setTimeout(abort, UPLOAD_TIMEOUT_MS);

  try {
    const response = await fetch(signedUrl, {
      method: "PUT",
      headers: buildSignedPutHeaders(ticket),
      body,
      // Storage is a different origin: never send cookies/credentials.
      credentials: "omit",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new ReceiptImageError(
        "UPLOAD_FAILED",
        `Photo upload failed (HTTP ${response.status}). Try again.`,
        response.status,
      );
    }
  } catch (error) {
    if (error instanceof ReceiptImageError) {
      throw error;
    }
    if (controller.signal.aborted) {
      throw new ReceiptImageError(
        "UPLOAD_FAILED",
        "Photo upload timed out. Check your connection and try again.",
      );
    }
    throw new ReceiptImageError(
      "UPLOAD_FAILED",
      "Photo upload failed. Check your connection and try again.",
    );
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}
