import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_RECEIPT_IMAGE_BYTES,
  ReceiptImageError,
  assertImageMatchesBytes,
  assertMeasuredImageSize,
  buildSignedPutHeaders,
  detectImageContentType,
  isUploadTicketExpired,
} from "../lib/receipt-image-core";
import {
  assertSignedUploadUrl,
  uploadPreparedImage,
} from "../lib/receipt-image.web";
import type { PreparedReceiptImage } from "../lib/receipt-image-core";
import type { UploadTicket } from "../types/receipt";

const originalFetch = globalThis.fetch;

function stubFetch(implementation: typeof fetch) {
  globalThis.fetch = implementation;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

function ticket(url = "https://storage.example.test/receipt?signature=abc"): UploadTicket {
  return {
    receiptId: "receipt-1",
    upload: {
      url,
      headers: {
        "Content-Type": "image/jpeg",
        "x-amz-tagging": "retention=original-90d",
      },
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      maxBytes: MAX_RECEIPT_IMAGE_BYTES,
    },
  };
}

function image(body: Blob): PreparedReceiptImage {
  return {
    uri: "blob:local-preview",
    contentType: "image/jpeg",
    sizeBytes: body.size,
    width: 1,
    height: 1,
    body,
  };
}

test("image sniffing accepts only JPEG/PNG magic bytes", () => {
  assert.equal(detectImageContentType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), "image/jpeg");
  assert.equal(
    detectImageContentType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    "image/png",
  );
  assert.equal(detectImageContentType(new Uint8Array([0x00, 0x01, 0x02])), null);
  assert.equal(detectImageContentType(new Uint8Array([0x52, 0x49, 0x46, 0x46])), null);
});

test("measured image size is checked before allocation", () => {
  assert.throws(() => assertMeasuredImageSize(0), (error) => {
    assert.ok(error instanceof ReceiptImageError);
    assert.equal(error.code, "IMAGE_EMPTY");
    return true;
  });
  assert.throws(() => assertMeasuredImageSize(MAX_RECEIPT_IMAGE_BYTES + 1), (error) => {
    assert.ok(error instanceof ReceiptImageError);
    assert.equal(error.code, "IMAGE_TOO_LARGE");
    return true;
  });
  assert.doesNotThrow(() => assertMeasuredImageSize(MAX_RECEIPT_IMAGE_BYTES));

  assert.throws(
    () => assertImageMatchesBytes("image/jpeg", new Uint8Array([0x89, 0x50, 0x4e, 0x47])),
    (error) => error instanceof ReceiptImageError && error.code === "UNSUPPORTED_IMAGE",
  );
  assert.equal(
    assertImageMatchesBytes("image/jpeg", new Uint8Array([0xff, 0xd8, 0xff])),
    "image/jpeg",
  );
});

test("signed PUT headers are copied exactly, with no auth headers invented", () => {
  const source = ticket();
  const headers = buildSignedPutHeaders(source);
  assert.deepEqual(headers, source.upload.headers);
  assert.notEqual(headers, source.upload.headers);

  const keys = Object.keys(headers).map((key) => key.toLowerCase());
  assert.deepEqual(keys.sort(), ["content-type", "x-amz-tagging"]);
  assert.equal(keys.includes("authorization"), false);
  assert.equal(keys.includes("cookie"), false);
  assert.equal(keys.includes("idempotency-key"), false);

  assert.equal(isUploadTicketExpired(source), false);
  assert.equal(
    isUploadTicketExpired({
      ...source,
      upload: { ...source.upload, expiresAt: new Date(Date.now() + 2_000).toISOString() },
    }),
    true,
  );
});

test("unknown upload expiry forces a new signed ticket", () => {
  const source = ticket();
  source.upload.expiresAt = "invalid-expiry";
  assert.equal(isUploadTicketExpired(source), true);
});

test("raw upload sends the exact bytes and copies storage headers without cookies", async () => {
  const body = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x11])], {
    type: "image/jpeg",
  });
  const prepared = image(body);
  const allocation = ticket();
  const calls: { url: string; init?: RequestInit }[] = [];

  const restore = stubFetch(async (input, init) => {
    calls.push({ url: String(input), init });
    return new Response(null, { status: 200 });
  });

  try {
    await uploadPreparedImage(prepared, allocation);
  } finally {
    restore();
  }

  assert.equal(calls.length, 1);
  const [call] = calls;
  assert.equal(call!.url, allocation.upload.url);
  assert.equal(call!.init?.method, "PUT");
  assert.equal(call!.init?.body, body);
  assert.equal(call!.init?.credentials, "omit");
  assert.deepEqual(call!.init?.headers, allocation.upload.headers);
  const sentHeaders = JSON.stringify(call!.init?.headers).toLowerCase();
  assert.equal(sentHeaders.includes("authorization"), false);
  assert.equal(sentHeaders.includes("cookie"), false);
  assert.equal(sentHeaders.includes("idempotency-key"), false);
});

test("upload failures surface as upload errors; size changes stop before network", async () => {
  const body = new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: "image/jpeg" });
  const allocated = ticket();
  const calls: string[] = [];
  const restore = stubFetch(async (input) => {
    calls.push(String(input));
    return new Response(null, { status: 403 });
  });

  try {
    await assert.rejects(uploadPreparedImage(image(body), allocated), (error) => {
      assert.ok(error instanceof ReceiptImageError);
      assert.equal(error.code, "UPLOAD_FAILED");
      assert.equal(error.status, 403);
      return true;
    });

    await assert.rejects(
      uploadPreparedImage({ ...image(body), sizeBytes: body.size + 1 }, allocated),
      (error) => error instanceof ReceiptImageError && error.code === "IMAGE_CHANGED",
    );
  } finally {
    restore();
  }

  assert.equal(calls.length, 1);
});

test("signed upload URLs must be http(s) without embedded credentials", async () => {
  assert.doesNotThrow(() => assertSignedUploadUrl("https://storage.example.test/key"));
  assert.doesNotThrow(() => assertSignedUploadUrl("http://localhost:9000/key"));
  assert.throws(
    () => assertSignedUploadUrl("javascript:alert(1)"),
    (error) => error instanceof ReceiptImageError && error.code === "UPLOAD_FAILED",
  );
  assert.throws(
    () => assertSignedUploadUrl("https://user:secret@storage.example.test/key"),
    (error) => error instanceof ReceiptImageError && error.code === "UPLOAD_FAILED",
  );

  const body = new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: "image/jpeg" });
  let called = false;
  const restore = stubFetch(async () => {
    called = true;
    return new Response(null, { status: 200 });
  });
  try {
    await assert.rejects(
      uploadPreparedImage(
        image(body),
        ticket("https://user:secret@storage.example.test/receipt"),
      ),
      (error) => error instanceof ReceiptImageError && error.code === "UPLOAD_FAILED",
    );
  } finally {
    restore();
  }
  assert.equal(called, false);
});
