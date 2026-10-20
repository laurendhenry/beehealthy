/**
 * Account-scoped app-data provider + shared server-query hook.
 *
 * Ownership: home/pantry/profile/matching/swaps scope (plan section 7).
 * - Auth session itself stays in Agent A's AuthContext; this provider only
 *   tracks the active user id for scoping/clearing account data.
 * - Receipt transient asset/dirty-form workflow stays in Agent B's receipt
 *   context; this provider never holds dirty forms — refetches only replace
 *   last-success server snapshots.
 * - No TanStack Query dependency (per-agent report instead): a small
 *   purpose-built query hook with abort-stale, user scoping, safe-read
 *   retry, and the plan's invalidation matrix.
 */

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

import { ApiError, shouldRetryRead } from "../lib/api/pantry";

// ---------------------------------------------------------------------------
// Invalidation matrix (plan section 7)
// ---------------------------------------------------------------------------

export type DataScope =
  | "user"
  | "receipts"
  | "pantry"
  | "basket"
  | "swaps"
  | "recommendation";

/**
 * Which scopes go stale after each mutation. Screens subscribe to scopes;
 * version bumps trigger their refetch. Logout/account change resets all.
 */
export const INVALIDATION_MATRIX: Record<string, readonly DataScope[]> = {
  "upload/parse": ["receipts"],
  "receipt-patch": ["receipts", "recommendation"],
  "receipt-confirm": ["receipts", "pantry", "basket", "swaps", "recommendation"],
  "receipt-delete": ["receipts", "pantry", "basket", "swaps", "recommendation"],
  "pantry-mutation": ["pantry", "basket", "swaps", "recommendation"],
  "profile-mutation": ["user", "swaps", "recommendation"],
  "swap-mutation": ["swaps", "recommendation"],
};

export type MutationKind = keyof typeof INVALIDATION_MATRIX;

export function scopesForMutation(kind: MutationKind): readonly DataScope[] {
  return INVALIDATION_MATRIX[kind];
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

type AppDataContextValue = {
  /** Active account id, or null before bootstrap/logout. */
  userId: string | null;
  /** Monotonic version per scope; bumped on invalidation. */
  scopeVersions: Record<DataScope, number>;
  setUserId: (userId: string | null) => void;
  invalidate: (...scopes: DataScope[]) => void;
  invalidateFor: (kind: MutationKind) => void;
  resetAll: () => void;
};

const AppDataContext = createContext<AppDataContextValue | null>(null);

const EMPTY_VERSIONS: Record<DataScope, number> = {
  user: 0,
  receipts: 0,
  pantry: 0,
  basket: 0,
  swaps: 0,
  recommendation: 0,
};

export function AppDataProvider({ children }: { children: ReactNode }) {
  const [userId, setUserIdState] = useState<string | null>(null);
  const [scopeVersions, setScopeVersions] =
    useState<Record<DataScope, number>>(EMPTY_VERSIONS);

  const invalidate = useCallback((...scopes: DataScope[]) => {
    if (scopes.length === 0) return;
    setScopeVersions((current) => {
      const next = { ...current };
      for (const scope of scopes) next[scope] += 1;
      return next;
    });
  }, []);

  const invalidateFor = useCallback(
    (kind: MutationKind) => {
      invalidate(...scopesForMutation(kind));
    },
    [invalidate],
  );

  const setUserId = useCallback(
    (next: string | null) => {
      // Account switch or logout: clear identity AND bump every scope so no
      // prior-user content can reappear from a stale snapshot.
      setUserIdState((current) => {
        if (current !== next) {
          setScopeVersions((versions) => {
            const bumped = { ...versions };
            (Object.keys(bumped) as DataScope[]).forEach((scope) => {
              bumped[scope] += 1;
            });
            return bumped;
          });
        }
        return next;
      });
    },
    [],
  );

  const resetAll = useCallback(() => {
    setUserIdState(null);
    setScopeVersions(EMPTY_VERSIONS);
  }, []);

  const value = useMemo<AppDataContextValue>(
    () => ({ userId, scopeVersions, setUserId, invalidate, invalidateFor, resetAll }),
    [userId, scopeVersions, setUserId, invalidate, invalidateFor, resetAll],
  );

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
}

export function useAppData(): AppDataContextValue {
  const context = useContext(AppDataContext);
  if (!context) {
    throw new Error("useAppData must be used within AppDataProvider.");
  }
  return context;
}

// ---------------------------------------------------------------------------
// Shared server-query hook (pure-React; focus/foreground triggers live in
// the individual hooks so this file stays free of router/native imports)
// ---------------------------------------------------------------------------

export type QueryStatus = "idle" | "loading" | "success" | "error";

export type ServerQueryOptions<T> = {
  /** Scopes whose invalidation refetches this query. */
  scopes: readonly DataScope[];
  /** Server read. Receives an AbortSignal; must not touch dirty forms. */
  load: (signal: AbortSignal) => Promise<T>;
  /** Skip the initial load (e.g. waiting for bootstrap). */
  enabled?: boolean;
  /** Retry safe reads once on network/timeout/gateway failures. Default true. */
  retryReads?: boolean;
};

export type ServerQueryResult<T> = {
  status: QueryStatus;
  data: T | null;
  error: ApiError | Error | null;
  lastSuccessAt: number | null;
  refresh: () => void;
};

/**
 * User-scoped query with abort-stale semantics:
 * - each run gets its own AbortController; stale runs are aborted and their
 *   late results ignored (run id guard);
 * - results are ignored after userId changes or unmount;
 * - only last-success snapshots are kept; dirty forms live elsewhere and
 *   are never overwritten here;
 * - safe-read retry (once) applies to GET-style failures only — never to
 *   401/404/409/422, and never to aborted runs.
 */
export function useServerQuery<T>(
  options: ServerQueryOptions<T>,
): ServerQueryResult<T> {
  const { scopes, enabled = true, retryReads = true } = options;
  const loadRef = useRef(options.load);
  loadRef.current = options.load;

  const { userId, scopeVersions } = useAppData();
  const scopeKey = scopes.map((scope) => scopeVersions[scope]).join(":");

  const [status, setStatus] = useState<QueryStatus>("idle");
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [lastSuccessAt, setLastSuccessAt] = useState<number | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  const runIdRef = useRef(0);
  const userIdRef = useRef(userId);
  userIdRef.current = userId;

  // Changing accounts clears the snapshot immediately; the effect below
  // reloads for the new account. Never show prior-user data.
  const activeUserId = userId;
  useEffect(() => {
    setData(null);
    setError(null);
    setStatus("idle");
    setLastSuccessAt(null);
  }, [activeUserId]);

  useEffect(() => {
    if (!enabled || activeUserId === null) return;
    const runId = ++runIdRef.current;
    const controller = new AbortController();
    let cancelled = false;

    setStatus((previous) => (previous === "success" ? previous : "loading"));
    if (data === null) setStatus("loading");

    const run = async () => {
      let attempt = 0;
      for (;;) {
        try {
          const value = await loadRef.current(controller.signal);
          if (cancelled || runIdRef.current !== runId) return;
          if (userIdRef.current !== activeUserId) return;
          setData(value);
          setError(null);
          setStatus("success");
          setLastSuccessAt(Date.now());
          return;
        } catch (err) {
          if (cancelled || runIdRef.current !== runId) return;
          if (userIdRef.current !== activeUserId) return;
          if (
            (err instanceof Error && err.name === "AbortError") ||
            controller.signal.aborted
          ) {
            return;
          }
          const retry = retryReads && shouldRetryRead(err, attempt);
          if (retry) {
            attempt += 1;
            continue;
          }
          setError(err instanceof Error ? err : new Error("Request failed."));
          setStatus("error");
          return;
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
      controller.abort();
    };
    // scopeKey intentionally carries invalidation versions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, activeUserId, scopeKey, refreshTick]);

  const refresh = useCallback(() => {
    setRefreshTick((tick) => tick + 1);
  }, []);

  return useMemo(
    () => ({ status, data, error, lastSuccessAt, refresh }),
    [status, data, error, lastSuccessAt, refresh],
  );
}
