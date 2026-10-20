/**
 * Public runtime configuration for the BeeHealthy Expo frontend.
 *
 * Only `EXPO_PUBLIC_API_ORIGIN` is read here. It must contain an *origin only*
 * (scheme + host + optional port), e.g. `https://api.example.test`.
 *
 * Rules enforced by `parseApiOrigin`:
 * - Missing / empty configuration is an error (no production fallback).
 * - Embedded paths, queries, or fragments are rejected.
 * - Non-HTTPS origins are rejected except localhost development hosts.
 * - Trailing slashes are normalized away.
 *
 * Never put database/AWS credentials, USDA keys, auth secrets, or secret
 * ARNs in public (`EXPO_PUBLIC_*`) variables.
 */

export const API_PATH_PREFIX = "/api";
export const AUTH_PATH_PREFIX = "/api/auth";

export class ConfigError extends Error {
  readonly code = "CONFIG_ERROR";
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export interface ApiConfig {
  /** Normalized origin, e.g. `https://api.example.test` (no trailing slash). */
  origin: string;
  /** Application API root, e.g. `https://api.example.test/api`. */
  apiBaseUrl: string;
  /** Better Auth endpoint root, e.g. `https://api.example.test/api/auth`. */
  authBaseUrl: string;
}

/**
 * Pure, platform-safe origin parser. Accepts the raw env value so it can be
 * unit-tested without touching `process.env`.
 *
 * @param raw e.g. `https://api.example.test` (trailing slash tolerated).
 * @param allowInsecureHttp allow `http://` for non-local hosts (tests only).
 */
export function parseApiOrigin(raw: string | undefined, allowInsecureHttp = false): ApiConfig {
  const value = (raw ?? "").trim().replace(/\/+$/, "");
  if (!value) {
    throw new ConfigError(
      "Missing API origin. Set EXPO_PUBLIC_API_ORIGIN to your API origin (e.g. https://api.example.test).",
    );
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ConfigError(
      `Invalid EXPO_PUBLIC_API_ORIGIN ${JSON.stringify(value)}: must be an origin like https://api.example.test.`,
    );
  }
  if (url.username || url.password) {
    throw new ConfigError("Invalid EXPO_PUBLIC_API_ORIGIN: must not contain credentials.");
  }
  if (url.pathname !== "/" && url.pathname !== "") {
    throw new ConfigError(
      `Invalid EXPO_PUBLIC_API_ORIGIN ${JSON.stringify(value)}: must be an origin only (no path).`,
    );
  }
  if (url.search || url.hash) {
    throw new ConfigError(
      "Invalid EXPO_PUBLIC_API_ORIGIN: must be an origin only (no query or fragment).",
    );
  }
  const isLocal = LOCAL_HOSTS.has(url.hostname.toLowerCase());
  if (url.protocol !== "https:" && !(allowInsecureHttp || (url.protocol === "http:" && isLocal))) {
    throw new ConfigError(
      `Invalid EXPO_PUBLIC_API_ORIGIN ${JSON.stringify(value)}: production origins must use https.`,
    );
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new ConfigError(
      `Invalid EXPO_PUBLIC_API_ORIGIN ${JSON.stringify(value)}: scheme must be https (or http for localhost development).`,
    );
  }
  const origin = `${url.protocol}//${url.host}`;
  return {
    origin,
    apiBaseUrl: `${origin}${API_PATH_PREFIX}`,
    authBaseUrl: `${origin}${AUTH_PATH_PREFIX}`,
  };
}

/** Raw public env value (inlined by Metro from `EXPO_PUBLIC_API_ORIGIN`). */
export function readApiOriginEnv(): string | undefined {
  return process.env.EXPO_PUBLIC_API_ORIGIN;
}

/** Resolve and validate the current environment's API config. Throws ConfigError. */
export function getApiConfig(): ApiConfig {
  return parseApiOrigin(readApiOriginEnv());
}

/** Normalized origin, e.g. `https://api.example.test`. Throws ConfigError. */
export function getApiOrigin(): string {
  return getApiConfig().origin;
}

/** Application API root, e.g. `https://api.example.test/api`. Throws ConfigError. */
export function getApiBaseUrl(): string {
  return getApiConfig().apiBaseUrl;
}

/** Better Auth endpoint root, e.g. `https://api.example.test/api/auth`. Throws ConfigError. */
export function getAuthBaseUrl(): string {
  return getApiConfig().authBaseUrl;
}
