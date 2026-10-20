/**
 * Native (iOS/Android) receipt image preparation + raw signed upload.
 *
 * - normalizes HEIC/HEIF to JPEG when the picker returns original bytes
 * - measures and checks the actual upload file (expo-file-system `File`)
 * - PUTs the file itself as the body (no base64 or FormData)
 * - copies exactly the signed headers from the allocation (including
 *   `Content-Type` and `x-amz-tagging`) and nothing else
 */

import { File } from "expo-file-system";
import { fetch as expoFetch } from "expo/fetch";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";

import type { UploadTicket } from "../types/receipt";
import {
  assertImageMatchesBytes,
  assertMeasuredImageSize,
  assertUploadMatchesAllocation,
  buildSignedPutHeaders,
  ReceiptImageError,
  type PickedReceiptAsset,
  type PreparedReceiptImage,
} from "./receipt-image-core";

export * from "./receipt-image-core";

const UPLOAD_TIMEOUT_MS = 60_000;

function unreadable(): ReceiptImageError {
  return new ReceiptImageError(
    "IMAGE_UNREADABLE",
    "That photo could not be read. Choose another photo.",
  );
}

function openExistingFile(uri: string): File {
  try {
    const file = new File(uri);
    if (!file.exists) {
      throw unreadable();
    }
    return file;
  } catch (error) {
    if (error instanceof ReceiptImageError) {
      throw error;
    }
    throw unreadable();
  }
}

function readImageHead(file: File): Uint8Array {
  try {
    const handle = file.open();
    try {
      return handle.readBytes(8);
    } finally {
      handle.close();
    }
  } catch {
    throw unreadable();
  }
}

export async function prepareReceiptImage(
  asset: PickedReceiptAsset,
): Promise<PreparedReceiptImage> {
  let uri = asset.uri;
  let width = asset.width ?? 0;
  let height = asset.height ?? 0;
  let file = openExistingFile(uri);
  assertMeasuredImageSize(file.size);

  let contentType: "image/jpeg" | "image/png";
  try {
    // Trust the bytes, not a picker filename or a stale MIME label.
    contentType = assertImageMatchesBytes(null, readImageHead(file));
  } catch {
    // HEIC/HEIF library images must be encoded before requesting a JPEG
    // allocation. Measure and inspect the resulting file, not the original.
    try {
      const converted = await manipulateAsync(uri, [], {
        format: SaveFormat.JPEG,
        compress: 0.9,
      });
      uri = converted.uri;
      width = converted.width;
      height = converted.height;
      file = openExistingFile(uri);
      contentType = assertImageMatchesBytes("image/jpeg", readImageHead(file));
    } catch {
      throw unreadable();
    }
  }
  const sizeBytes = file.size;
  assertMeasuredImageSize(sizeBytes);
  return {
    uri, contentType, sizeBytes,
    width: Math.max(0, Math.round(width)),
    height: Math.max(0, Math.round(height)),
    body: file,
  };
}

export async function uploadPreparedImage(
  image: PreparedReceiptImage,
  ticket: UploadTicket,
  signal?: AbortSignal | null,
): Promise<void> {
  assertUploadMatchesAllocation(image, ticket);

  const file = openExistingFile(image.uri);
  if (file.size !== image.sizeBytes) {
    throw new ReceiptImageError(
      "IMAGE_CHANGED",
      "That photo changed after it was selected. Choose it again.",
    );
  }

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
    const response = await expoFetch(ticket.upload.url, {
      method: "PUT",
      headers: buildSignedPutHeaders(ticket),
      // The File is a Blob; expo/fetch sends it as raw bytes and lets the
      // request set Content-Length. Never wrap it in FormData.
      body: file,
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
