import test from "node:test";
import assert from "node:assert/strict";

import {
  conversions,
  resetExpoNativeStub,
  setStubConversion,
  setStubFile,
} from "./support/expo-native-stub.mjs";
import { prepareReceiptImage } from "../lib/receipt-image.native";

const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 1, 2, 3];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0];
// ISO-BMFF `ftypheic` box, as iOS library originals are.
const HEIC = [0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63];

test.beforeEach(() => resetExpoNativeStub());

test("reads the head synchronously and keeps JPEG and PNG files as-is", async () => {
  setStubFile("file:///camera.jpg", JPEG);
  setStubFile("file:///shot.png", PNG);
  const jpeg = await prepareReceiptImage({
    uri: "file:///camera.jpg",
    width: 3024,
    height: 4032,
  });
  assert.equal(jpeg.contentType, "image/jpeg");
  assert.equal(jpeg.sizeBytes, JPEG.length);
  assert.equal(jpeg.uri, "file:///camera.jpg");
  assert.equal(jpeg.width, 3024);
  const png = await prepareReceiptImage({ uri: "file:///shot.png" });
  assert.equal(png.contentType, "image/png");
  assert.equal(conversions.length, 0);
});

test("converts HEIC originals to JPEG and measures the converted file", async () => {
  setStubFile("file:///library.heic", HEIC);
  setStubFile("file:///converted.jpg", JPEG);
  setStubConversion({ uri: "file:///converted.jpg", width: 1000, height: 1500 });
  const image = await prepareReceiptImage({ uri: "file:///library.heic" });
  assert.equal(conversions.length, 1);
  assert.equal(conversions[0].uri, "file:///library.heic");
  assert.deepEqual(image, {
    uri: "file:///converted.jpg",
    contentType: "image/jpeg",
    sizeBytes: JPEG.length,
    width: 1000,
    height: 1500,
    body: image.body,
  });
});

test("reports an unreadable photo when the file is missing or conversion fails", async () => {
  await assert.rejects(prepareReceiptImage({ uri: "file:///missing.jpg" }), {
    code: "IMAGE_UNREADABLE",
  });
  setStubFile("file:///library.heic", HEIC);
  await assert.rejects(prepareReceiptImage({ uri: "file:///library.heic" }), {
    code: "IMAGE_UNREADABLE",
  });
});
