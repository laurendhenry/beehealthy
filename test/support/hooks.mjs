import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * Offline test module hooks.
 * - Redirects `react-native` to a lightweight stub (Platform + AppState).
 * - Redirects the native Expo modules used by `receipt-image.native.ts`
 *   (`expo-file-system`, `expo-image-manipulator`, `expo/fetch`) to an
 *   in-memory stub driven by tests.
 * - Resolves extensionless relative imports to their `.ts` source so
 *   `node --test` can run TypeScript sources via type stripping.
 */
const stubUrl = new URL("./react-native-stub.mjs", import.meta.url).href;
const expoNativeStubUrl = new URL("./expo-native-stub.mjs", import.meta.url).href;
const EXPO_NATIVE_MODULES = new Set([
  "expo-file-system",
  "expo-image-manipulator",
  "expo/fetch",
]);

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "react-native") {
    return { url: stubUrl, shortCircuit: true };
  }
  if (EXPO_NATIVE_MODULES.has(specifier)) {
    return { url: expoNativeStubUrl, shortCircuit: true };
  }
  if (
    (specifier.startsWith("./") || specifier.startsWith("../")) &&
    context.parentURL?.endsWith(".ts")
  ) {
    const parentPath = fileURLToPath(context.parentURL);
    const base = new URL(specifier, pathToFileURL(parentPath));
    for (const candidate of [
      base.href,
      `${base.href}.ts`,
      `${base.href}.tsx`,
      `${base.href}/index.ts`,
    ]) {
      try {
        if (existsSync(fileURLToPath(candidate))) {
          return { url: candidate, shortCircuit: true };
        }
      } catch {
        // Try the next candidate.
      }
    }
  }
  return nextResolve(specifier, context);
}
