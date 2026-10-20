/**
 * Receipt image preparation/upload — platform dispatch module.
 *
 * Metro resolves `receipt-image.native.ts` on iOS/Android and
 * `receipt-image.web.ts` on web. TypeScript resolves this file, so it carries
 * the shared signatures and re-exports the pure helpers; the stubs exist only
 * to satisfy typing on platforms that have no implementation.
 */

import type { UploadTicket } from "../types/receipt";
import type { PickedReceiptAsset, PreparedReceiptImage } from "./receipt-image-core";

export * from "./receipt-image-core";

export async function prepareReceiptImage(
  _asset: PickedReceiptAsset,
): Promise<PreparedReceiptImage> {
  throw new Error("Receipt image preparation is not available on this platform.");
}

export async function uploadPreparedImage(
  _image: PreparedReceiptImage,
  _ticket: UploadTicket,
  _signal?: AbortSignal | null,
): Promise<void> {
  throw new Error("Receipt image upload is not available on this platform.");
}
