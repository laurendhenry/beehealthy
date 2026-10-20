import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AppState, type AppStateStatus } from "react-native";

import {
  refreshSession,
  signInWithEmail,
  signOut as clientSignOut,
  signUpWithEmail,
} from "../lib/auth-client";
import { isAccountSwitch, isSessionExpired, toAuthSession, type AuthSession } from "../types/api";

export { isAccountSwitch, isSessionExpired };

/**
 * Session-lifecycle-only auth context.
 *
 * Responsibilities: bootstrap (before route guards render protected content),
 * revalidation on foreground/expiry, sign-in/sign-up/sign-out, and clearing
 * account-scoped state on logout/account-switch via `onSessionInvalidated`
 * subscribers. Data fetching lives in API modules + app-data hooks (Agent C),
 * never here. Stale cached sessions are never trusted without revalidation.
 */

export type AuthStatus = "loading" | "authenticated" | "unauthenticated";

export interface AuthContextValue {
  status: AuthStatus;
  /** True once the initial bootstrap attempt has resolved. */
  bootstrapped: boolean;
  session: AuthSession | null;
  userId: string | null;
  /** Last bootstrap/revalidation failure (network vs invalid session). */
  error: string | null;
  /** Revalidate against `GET /api/auth/get-session`. */
  revalidate: () => Promise<boolean>;
  signIn: (args: { email: string; password: string }) => Promise<{ error: string | null }>;
  signUp: (args: {
    name: string;
    email: string;
    password: string;
  }) => Promise<{ error: string | null }>;
  /** Stops polling, signs out, clears session + notifies account-state owners. */
  signOut: () => Promise<{ error: string | null }>;
  /**
   * Subscribe to logout/account-switch so account-scoped providers can clear
   * cached data. Returns an unsubscribe function.
   */
  onSessionInvalidated: (listener: () => void) => () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);


/**
 * Stale cached sessions are never trusted: bootstrap always revalidates via
 * `GET /api/auth/get-session`. This hook exists so the bootstrap effect has a
 * named step (and a place to document that invariant).
 */
function readCachedSession(): AuthSession | null {
  return null;
}
/** Runtime shape check: only accept well-formed session payloads. */
/** `toAuthSession` lives in `../types/api` (pure + unit-tested): it accepts
 * better-auth's revived `Date` timestamps as well as ISO strings. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [bootstrapped, setBootstrapped] = useState(false);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const listenersRef = useRef(new Set<() => void>());
  const sessionRef = useRef<AuthSession | null>(null);
  const inFlightRef = useRef<Promise<boolean> | null>(null);

  const notifyInvalidated = useCallback(() => {
    for (const listener of listenersRef.current) {
      try {
        listener();
      } catch {
        // Listener failures must not break logout.
      }
    }
  }, []);

  const applySession = useCallback(
    (next: AuthSession | null) => {
      const prev = sessionRef.current;
      sessionRef.current = next;
      setSession(next);
      setStatus(next ? "authenticated" : "unauthenticated");
      if (isAccountSwitch(prev, next)) {
        // Logout or account switch: drop prior-user state everywhere.
        notifyInvalidated();
      }
    },
    [notifyInvalidated],
  );

  const revalidate = useCallback(async (): Promise<boolean> => {
    if (inFlightRef.current) return inFlightRef.current;
    const run = (async () => {
      try {
        const result = await refreshSession();
        if (result.error) {
          // Network/offline failure: keep showing previous state; surface error.
          applySession(sessionRef.current);
          setError(result.error.message ?? "Could not reach the server.");
          return sessionRef.current != null && !isSessionExpired(sessionRef.current);
        }
        const data = toAuthSession(result.data);
        if (!data) {
          applySession(null);
          setError(null);
          return false;
        }
        if (isSessionExpired(data)) {
          applySession(null);
          setError(null);
          return false;
        }
        applySession(data);
        setError(null);
        return true;
      } catch (err) {
        // Distinguish network failure (keep state) from invalid session.
        setError(err instanceof Error ? err.message : "Could not reach the server.");
        return sessionRef.current != null && !isSessionExpired(sessionRef.current);
      } finally {
        setBootstrapped(true);
        inFlightRef.current = null;
      }
    })();
    inFlightRef.current = run;
    return run;
  }, [applySession]);

  // Bootstrap before route guards expose protected content.
  useEffect(() => {
    readCachedSession();
    void revalidate();
  }, [revalidate]);

  // Revalidate on foreground + when an expired session would otherwise linger.
  useEffect(() => {
    const onChange = (state: AppStateStatus) => {
      if (state === "active") void revalidate();
    };
    const sub = AppState.addEventListener("change", onChange);
    return () => sub.remove();
  }, [revalidate]);

  useEffect(() => {
    if (!session) return;
    const expires = Date.parse(session.session.expiresAt);
    if (Number.isNaN(expires)) return;
    const delay = Math.max(0, expires - Date.now());
    const timer = setTimeout(() => void revalidate(), delay + 1000);
    return () => clearTimeout(timer);
  }, [session, revalidate]);

  const signIn: AuthContextValue["signIn"] = useCallback(
    async (args) => {
      const result = await signInWithEmail(args);
      if (result.error) return result;
      await revalidate();
      return { error: null };
    },
    [revalidate],
  );

  const signUp: AuthContextValue["signUp"] = useCallback(
    async (args) => {
      const result = await signUpWithEmail(args);
      if (result.error) return result;
      await revalidate();
      return { error: null };
    },
    [revalidate],
  );

  const signOut: AuthContextValue["signOut"] = useCallback(async () => {
    // Stop protected consumers first: clear session + account state locally,
    // then attempt server revocation (offline failure must not restore state).
    const hadSession = sessionRef.current != null;
    applySession(null);
    if (hadSession) notifyInvalidated();
    setBootstrapped(true);
    setError(null);
    const result = await clientSignOut();
    // Local state stays cleared even when server revocation fails offline.
    await revalidate().catch(() => false);
    if (sessionRef.current) applySession(null);
    return result;
  }, [applySession, notifyInvalidated, revalidate]);

  const onSessionInvalidated = useCallback((listener: () => void) => {
    listenersRef.current.add(listener);
    return () => {
      listenersRef.current.delete(listener);
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      bootstrapped,
      session,
      userId: session?.user.id ?? null,
      error,
      revalidate,
      signIn,
      signUp,
      signOut,
      onSessionInvalidated,
    }),
    [
      status,
      bootstrapped,
      session,
      error,
      revalidate,
      signIn,
      signUp,
      signOut,
      onSessionInvalidated,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
