/**
 * In-memory stand-ins for the native Expo modules that
 * `lib/receipt-image.native.ts` uses. Tests seed files with `setStubFile` and
 * the HEIC conversion result with `setStubConversion`. Mirrors the SDK 58
 * shapes: `FileHandle.readBytes` is async, `readBytesSync` is sync.
 */
const files = new Map();
let conversion = null;
export const conversions = [];

export function resetExpoNativeStub() {
  files.clear();
  conversion = null;
  conversions.length = 0;
}
export function setStubFile(uri, bytes) {
  files.set(uri, Uint8Array.from(bytes));
}
export function setStubConversion(result) {
  conversion = result;
}

export class File {
  constructor(uri) {
    this.uri = uri;
  }
  get exists() {
    return files.has(this.uri);
  }
  get size() {
    return files.get(this.uri)?.length ?? 0;
  }
  open() {
    const bytes = files.get(this.uri);
    if (!bytes) {
      throw new Error("ENOENT");
    }
    return {
      readBytes: async (length) => bytes.slice(0, length),
      readBytesSync: (length) => bytes.slice(0, length),
      close: () => undefined,
    };
  }
}

export const SaveFormat = { JPEG: "jpeg", PNG: "png" };
export async function manipulateAsync(uri, actions, options) {
  conversions.push({ uri, actions, options });
  if (!conversion) {
    throw new Error("Conversion failed");
  }
  return conversion;
}

export async function fetch() {
  throw new Error("expo/fetch is not stubbed for this test");
}
