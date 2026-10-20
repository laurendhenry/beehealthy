import { Platform } from "react-native";

import { createAuthClient } from "better-auth/react";
import { expoClient } from "@better-auth/expo/client";
import * as SecureStore from "expo-secure-store";

import { getApiOrigin } from "./config";

/**
 * Better Auth client (better-auth 1.7.10 + @better-auth/expo).
 *
 * - `baseURL` is the origin only (e.g. `https://api.example.test`);
 *   `basePath: "/api/auth"` targets the real session routes
 *   (`POST /api/auth/sign-up/email`, `POST /api/auth/sign-in/email`,
 *   `GET /api/auth/get-session`, `POST /api/auth/sign-out`).
 *   The test stub `/auth/session` is NOT a real endpoint — always use
 *   `/api/auth/get-session` (via `authClient.getSession()`).
 * - Native persists cookies via SecureStore under the `beehealthy` prefix
 *   with scheme `beehealthy` (must match `app.json` + `AUTH_TRUSTED_ORIGINS`).
 * - No bearer authentication: the backend has no bearer plugin; sessions come
 *   from cookies only.
 *
 * Platform safety: SecureStore is only referenced on native. The module must
 * remain importable under web/static rendering, where cookie retrieval is
 * never invoked (browser cookies are managed by the browser).
 */

function isWeb(): boolean {
  try {
    return Platform.OS === "web";
  } catch {
    return typeof window !== "undefined";
  }
}

/** Lazily resolve the origin so missing config throws only when auth is used. */
export function getAuthClientBaseURL(): string {
  return getApiOrigin();
}

/**
 * Import-safe base URL. Module scope must never throw: static web rendering
 * imports this module without a configured origin. When unconfigured we
 * create the client against a reserved `.invalid` sentinel (never resolves)
 * and every wrapper below validates via `getAuthClientBaseURL()` first, so
 * the user sees a clear configuration error instead of a crash or a
 * production fallback.
 */
function safeBaseURL(): string {
  try {
    return getApiOrigin();
  } catch {
    return "https://missing-api-origin.invalid";
  }
}

/** Throw a clear ConfigError when `EXPO_PUBLIC_API_ORIGIN` is not configured. */
function ensureConfigured(): void {
  getAuthClientBaseURL();
}

export const authClient = createAuthClient({
  baseURL: safeBaseURL(),
  basePath: "/api/auth",
  plugins: [
    expoClient({
      scheme: "beehealthy",
      storagePrefix: "beehealthy",
      storage: SecureStore,
    }),
  ],
});

export type AuthClient = typeof authClient;

/**
 * Stored session cookie for native `Cookie`-header transport.
 * - Native: awaits `authClient.getCookie()`; returns `null` when absent.
 * - Web: always `null` — never invoke SecureStore cookie retrieval and never
 *   set `Cookie` manually; transport uses `credentials: "include"`.
 */
export async function getAuthCookie(): Promise<string | null> {
  if (isWeb()) return null;
  try {
    const cookie = await authClient.getCookie();
    return cookie || null;
  } catch {
    return null;
  }
}

/** Email/password sign-up (requires name/email/password). */
export async function signUpWithEmail(args: {
  name: string;
  email: string;
  password: string;
}): Promise<{ error: string | null }> {
  ensureConfigured();
  const result = await authClient.signUp.email({
    name: args.name,
    email: args.email,
    password: args.password,
  });
  return { error: result.error ? (result.error.message ?? "Sign-up failed") : null };
}

/** Email/password sign-in. */
export async function signInWithEmail(args: {
  email: string;
  password: string;
}): Promise<{ error: string | null }> {
  ensureConfigured();
  const result = await authClient.signIn.email({
    email: args.email,
    password: args.password,
  });
  return { error: result.error ? (result.error.message ?? "Sign-in failed") : null };
}

/** Refresh the current session from `GET /api/auth/get-session`. */
export async function refreshSession() {
  ensureConfigured();
  return authClient.getSession();
}

/** Sign out (server revocation best-effort; caller clears local state regardless). */
export async function signOut(): Promise<{ error: string | null }> {
  ensureConfigured();
  try {
    const result = await authClient.signOut();
    return { error: result.error ? (result.error.message ?? "Sign-out failed") : null };
  } catch {
    // Server revocation failed (often offline); local state stays cleared.
    return { error: "Sign-out failed" };
  }
}
