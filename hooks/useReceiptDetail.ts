/**
 * Single persisted receipt: detail load, bounded processing monitor, original
 * image URL, and version-aware deletion.
 *
 * Recovery contract:
 * - `processing` receipts are probed via `GET /receipts/:id/status`, honoring
 *   the server's `retryAfterMs` (bounded to 1–10s) for at most 8 attempts.
 * - When monitoring stops (attempt budget or transport failure) the screen
 *   shows honest copy and a manual "Check status" action; nothing silently
 *   pretends to be live.
 * - A successful probe reloads the full resource and invalidates downstream
 *   scopes (confirm → pantry/basket/swaps; parse completion → receipts).
 * - Deleting uses the loaded `version`; a VERSION_CONFLICT/404 reconciles the
 *   resource before the user can retry.
 * - No dirty forms live here: confirm/edit stay in the receipt workflow.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";

import { useAppData } from "../context/AppDataContext";
import {
  ApiErrorCodes,
  type ReceiptResource,
} from "../types/api";
import {
  deleteReceipt,
  classifyDeleteFailure,
  errorCode,
  errorStatus,
  getReceipt,
  getReceiptImage,
  getReceiptStatus,
  isReceiptGoneError,
  imageNeedsRefresh,
  receiptErrorMessage,
  type ReceiptImage,
} from "../lib/api/receipt-history";

const POLL_ATTEMPTS = 8;
const DEFAULT_POLL_MS = 2_000;
const RETRY_AFTER_FAILURE_MS = 3_000;

const ABORTED_CODE = "ABORTED";

function isAbortedError(error: unknown): boolean {
  return errorCode(error) === ABORTED_CODE;
}
type DetailStatus = "idle" | "loading" | "ready" | "error";
type LoadMode = "initial" | "refresh" | "silent";

export type ReceiptDetail = {
  resource: ReceiptResource | null;
  loading: boolean;
  status: DetailStatus;
  /** Cold-load error copy. */
  error: string | null;
  /** True when the persisted receipt is gone (deleted/foreign/unknown id). */
  notFound: boolean;
  /** Non-blocking refresh failure while the last snapshot stays visible. */
  notice: string | null;
  refreshing: boolean;
  /** True while the bounded processing monitor is actively scheduling. */
  monitoring: boolean;
  /** True when automatic probes stopped and only manual checks remain. */
  monitorStopped: boolean;
  monitorNotice: string | null;
  image: ReceiptImage | null;
  imageLoading: boolean;
  imageError: string | null;
  /** True only when retrying could help (not a missing/never-parsed image). */
  imageRetryable: boolean;
  deleting: boolean;
  deleteError: string | null;
  refresh: () => void;
  retry: () => void;
  checkStatus: () => void;
  refreshImage: () => void;
  remove: () => Promise<boolean>;
  clearDeleteError: () => void;
  clearNotice: () => void;
};

export function useReceiptDetail(options: {
  receiptId: string;
  enabled?: boolean;
}): ReceiptDetail {
  const { receiptId, enabled = true } = options;
  const active = enabled && receiptId.length > 0;
  const { invalidateFor, userId, scopeVersions } = useAppData();
  const receiptsScope = scopeVersions.receipts;

  // Identity of everything rendered below. A change (account, receipts scope,
  // or receipt id) masks the previous snapshot synchronously — before any
  // effect cleanup runs — so a prior account's receipt/image can never flash.
  const identity = useMemo(
    () => JSON.stringify([userId, receiptsScope, receiptId, active]),
    [userId, receiptsScope, receiptId, active],
  );

  const [boundIdentity, setBoundIdentity] = useState(identity);
  const [resourceState, setResourceState] = useState<ReceiptResource | null>(
    null,
  );
  const [status, setStatus] = useState<DetailStatus>("idle");
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [monitorStopped, setMonitorStopped] = useState(false);
  const [monitorError, setMonitorError] = useState<unknown>(null);
  const [pollTick, setPollTick] = useState(0);
  const [focused, setFocused] = useState(true);

  const [imageState, setImageState] = useState<ReceiptImage | null>(null);
  const [imageLoading, setImageLoading] = useState(false);
  const [imageError, setImageError] = useState<unknown>(null);
  const [imageTick, setImageTick] = useState(0);

  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<unknown>(null);

  const masked = boundIdentity !== identity;
  const resource = masked ? null : resourceState;
  const image = masked ? null : imageState;

  const idRef = useRef(receiptId);
  idRef.current = receiptId;
  const enabledRef = useRef(active);
  enabledRef.current = active;
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const resourceRef = useRef(resource);
  resourceRef.current = resource;
  const imageRef = useRef(image);
  imageRef.current = image;
  const deletingRef = useRef(false);
  const focusSeenRef = useRef(false);
  const requestRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const pollControllerRef = useRef<AbortController | null>(null);
  const imageControllerRef = useRef<AbortController | null>(null);
  const deleteControllerRef = useRef<AbortController | null>(null);
  const deleteRunRef = useRef(0);
  // Set after a 409 so the next delete reconciles first; a stale version can
  // never be resubmitted.
  const needsReconcileRef = useRef(false);
  const attemptsRef = useRef(0);
  const retryMsRef = useRef(DEFAULT_POLL_MS);
  const load = useCallback(
    async (mode: LoadMode): Promise<boolean> => {
      const id = idRef.current;
      const captured = identityRef.current;
      if (!enabledRef.current || !id) return false;

      const runId = ++requestRef.current;
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;

      const ownsResult = () =>
        requestRef.current === runId &&
        identityRef.current === captured &&
        idRef.current === id &&
        !controller.signal.aborted;

      if (mode !== "silent") setError(null);
      if (mode === "initial") {
        setStatus((previous) => (previous === "ready" ? previous : "loading"));
      }
      if (mode === "refresh") setRefreshing(true);

      try {
        const fresh = await getReceipt(id, controller.signal);
        if (!ownsResult()) return false;
        const previous = resourceRef.current;
        setBoundIdentity(captured);
        setResourceState(fresh);
        setStatus("ready");
        setError(null);
        setNotice(null);
        setMonitorStopped(false);
        setMonitorError(null);
        needsReconcileRef.current = false;
        attemptsRef.current = 0;
        retryMsRef.current = DEFAULT_POLL_MS;

        if (
          previous &&
          previous.status === "processing" &&
          fresh.status !== "processing"
        ) {
          invalidateFor(
            fresh.status === "confirmed" ? "receipt-confirm" : "upload/parse",
          );
        }
        return true;
      } catch (err) {
        if (!ownsResult() || isAbortedError(err)) return false;

        setBoundIdentity(captured);
        if (mode === "silent") {
          if (isReceiptGoneError(err)) {
            // A refresh that learns the receipt is gone must drop the stale
            // snapshot instead of leaving deleted data on screen.
            setResourceState(null);
            setImageState(null);
            setError(err);
            setStatus("error");
            setNotice(null);
            return false;
          }
          if (resourceRef.current) {
            setNotice(receiptErrorMessage(err, "detail"));
            setStatus("ready");
            return false;
          }
          setError(err);
          setStatus("error");
          return false;
        }
        if (resourceRef.current) {
          setNotice(receiptErrorMessage(err, "detail"));
          setStatus("ready");
          return false;
        }
        setError(err);
        setStatus("error");
        return false;
      } finally {
        if (requestRef.current === runId && identityRef.current === captured) {
          setRefreshing(false);
        }
      }
    },
    [invalidateFor],
  );

  // Cold load / identity change (account, receipts scope, or id). Abort every
  // in-flight request and drop data captured for the previous identity.
  useEffect(() => {
    requestRef.current += 1;
    controllerRef.current?.abort();
    pollControllerRef.current?.abort();
    imageControllerRef.current?.abort();
    deleteControllerRef.current?.abort();
    controllerRef.current = null;
    pollControllerRef.current = null;
    imageControllerRef.current = null;
    deleteControllerRef.current = null;
    deleteRunRef.current += 1;
    deletingRef.current = false;
    needsReconcileRef.current = false;

    setBoundIdentity(identity);
    setResourceState(null);
    setImageState(null);
    setStatus(active ? "loading" : "idle");
    setError(null);
    setNotice(null);
    setRefreshing(false);
    setImageError(null);
    setImageLoading(false);
    setDeleteError(null);
    setDeleting(false);
    setMonitorStopped(false);
    setMonitorError(null);
    attemptsRef.current = 0;
    retryMsRef.current = DEFAULT_POLL_MS;

    if (!active) return;

    void load("initial");

    return () => {
      requestRef.current += 1;
      controllerRef.current?.abort();
      pollControllerRef.current?.abort();
      imageControllerRef.current?.abort();
      deleteControllerRef.current?.abort();
    };
  }, [active, identity, load]);

  // Refresh on return from review; pause polling while the screen is blurred.
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      if (!active) return;

      if (!focusSeenRef.current) {
        focusSeenRef.current = true;
      } else {
        void load("silent");
      }

      if (imageNeedsRefresh(imageRef.current)) {
        setImageTick((tick) => tick + 1);
      }

      return () => setFocused(false);
    }, [active, load]),
  );

  const pollOnce = useCallback(async () => {
    const id = idRef.current;
    const captured = identityRef.current;
    const loadGeneration = requestRef.current;
    if (!id || !enabledRef.current) return;

    pollControllerRef.current?.abort();
    const controller = new AbortController();
    pollControllerRef.current = controller;

    const ownsResult = () =>
      identityRef.current === captured &&
      idRef.current === id &&
      requestRef.current === loadGeneration &&
      !controller.signal.aborted;
    try {
      const probe = await getReceiptStatus(id, controller.signal);
      if (!ownsResult()) return;
      // A foreground load may have moved the receipt off `processing` while
      // this probe was in flight; never schedule work from a stale snapshot.
      if (resourceRef.current?.id !== id) return;
      if (resourceRef.current.status !== "processing") return;

      attemptsRef.current += 1;
      retryMsRef.current = probe.retryAfterMs ?? DEFAULT_POLL_MS;

      if (probe.status === "processing") {
        if (attemptsRef.current >= POLL_ATTEMPTS) {
          setMonitorStopped(true);
        } else {
          setPollTick((tick) => tick + 1);
        }
        return;
      }

      const fresh = await getReceipt(id, controller.signal);
      if (!ownsResult()) return;
      if (resourceRef.current?.id !== id) return;

      setBoundIdentity(captured);
      setResourceState(fresh);
      setStatus("ready");
      setError(null);
      setMonitorStopped(false);
      setMonitorError(null);
      attemptsRef.current = 0;
      setPollTick((tick) => tick + 1);
      invalidateFor(
        fresh.status === "confirmed" ? "receipt-confirm" : "upload/parse",
      );
    } catch (err) {
      if (!ownsResult() || isAbortedError(err)) return;
      if (resourceRef.current?.id !== id && resourceRef.current !== null) return;

      if (isReceiptGoneError(err)) {
        setResourceState(null);
        setImageState(null);
        setError(err);
        setStatus("error");
        setMonitorStopped(true);
        setPollTick((tick) => tick + 1);
        return;
      }

      attemptsRef.current += 1;
      setMonitorError(err);
      if (attemptsRef.current >= POLL_ATTEMPTS) {
        setMonitorStopped(true);
      } else {
        retryMsRef.current = RETRY_AFTER_FAILURE_MS;
        setPollTick((tick) => tick + 1);
      }
    }
  }, [invalidateFor]);

  // Bounded processing monitor. Stops on blur, terminal status, or budget.
  useEffect(() => {
    const current = resource;
    if (!active || !focused || !current || current.status !== "processing") {
      return;
    }
    if (attemptsRef.current >= POLL_ATTEMPTS) {
      setMonitorStopped(true);
      return;
    }

    const timer = setTimeout(() => {
      void pollOnce();
    }, retryMsRef.current);
    return () => clearTimeout(timer);
  }, [active, focused, resource, pollTick, pollOnce]);

  // Original image: presigned URL refreshed when the resource or focus age
  // requires it. Missing/never-parsed images are non-fatal.
  useEffect(() => {
    const current = resource;
    if (!active || !current) return;

    const captured = identityRef.current;
    let cancelled = false;
    const controller = new AbortController();
    imageControllerRef.current?.abort();
    imageControllerRef.current = controller;
    setImageLoading(true);
    setImageError(null);

    const ownsResult = () =>
      !cancelled &&
      !controller.signal.aborted &&
      identityRef.current === captured &&
      idRef.current === current.id;

    getReceiptImage(current.id, controller.signal)
      .then((next) => {
        if (!ownsResult()) return;
        setBoundIdentity(captured);
        setImageState(next);
        setImageError(null);
      })
      .catch((err: unknown) => {
        if (!ownsResult() || isAbortedError(err)) return;
        setImageState(null);
        setImageError(err);
      })
      .finally(() => {
        if (ownsResult()) setImageLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
      if (imageControllerRef.current === controller) {
        imageControllerRef.current = null;
      }
    };
  }, [active, resource, imageTick]);

  const refresh = useCallback(() => {
    void load("refresh");
    // A manual refresh also restarts the monitor budget.
    attemptsRef.current = 0;
    setMonitorStopped(false);
    setMonitorError(null);
  }, [load]);

  const retry = useCallback(() => {
    setStatus("loading");
    setError(null);
    void load("initial");
  }, [load]);

  const checkStatus = useCallback(() => {
    attemptsRef.current = 0;
    setMonitorStopped(false);
    setMonitorError(null);
    void load("refresh");
  }, [load]);

  const refreshImage = useCallback(() => {
    setImageTick((tick) => tick + 1);
  }, []);

  const clearNotice = useCallback(() => setNotice(null), []);
  const clearDeleteError = useCallback(() => setDeleteError(null), []);

  const remove = useCallback(async () => {
    if (deletingRef.current) return false;
    const captured = identityRef.current;
    const id = idRef.current;

    // After a conflict, reconcile before attempting again. If that fails the
    // flag stays set, so a stale version can never be resubmitted.
    if (needsReconcileRef.current) {
      const reconciled = await load("silent");
      if (!reconciled || identityRef.current !== captured) return false;
      needsReconcileRef.current = false;
    }

    const current = resourceRef.current;
    if (!current || current.id !== id || identityRef.current !== captured) {
      return false;
    }

    const runId = ++deleteRunRef.current;
    const controller = new AbortController();
    deleteControllerRef.current?.abort();
    deleteControllerRef.current = controller;
    deletingRef.current = true;
    setDeleting(true);
    setDeleteError(null);

    const ownsResult = () =>
      deleteRunRef.current === runId &&
      identityRef.current === captured &&
      idRef.current === id &&
      !controller.signal.aborted;


    // A successful DELETE supersedes every read started before it, so a late
    // list/detail/image response can never resurrect the deleted snapshot.
    const cancelInFlightReads = () => {
      requestRef.current += 1;
      controllerRef.current?.abort();
      pollControllerRef.current?.abort();
      imageControllerRef.current?.abort();
      controllerRef.current = null;
      pollControllerRef.current = null;
      imageControllerRef.current = null;
    };
    try {
      await deleteReceipt(current.id, current.version, controller.signal);
      if (!ownsResult()) return false;
      cancelInFlightReads();
      setResourceState(null);
      setImageState(null);
      invalidateFor("receipt-delete");
      return true;
    } catch (err) {
      if (!ownsResult() || isAbortedError(err)) return false;

      const failure = classifyDeleteFailure(err);

      // A 404/410 means the receipt is already gone — including a retried
      // DELETE whose first 204 was lost. Treat it as the success it is.
      if (failure === "already-deleted") {
        cancelInFlightReads();
        setResourceState(null);
        setImageState(null);
        invalidateFor("receipt-delete");
        return true;
      }

      if (failure === "conflict") {
        setDeleteError(err);
        needsReconcileRef.current = true;
        const reconciled = await load("silent");
        if (reconciled) needsReconcileRef.current = false;
        return false;
      }

      setDeleteError(err);
      return false;
    } finally {
      if (deleteRunRef.current === runId && identityRef.current === captured) {
        deletingRef.current = false;
        setDeleting(false);
        if (deleteControllerRef.current === controller) {
          deleteControllerRef.current = null;
        }
      }
    }
  }, [invalidateFor, load]);

  const monitorNotice = useMemo(() => {
    if (!monitorStopped) return null;
    const base =
      "We stopped checking automatically. Tap Check status to keep monitoring this receipt.";
    return monitorError
      ? `${receiptErrorMessage(monitorError, "status")} ${base}`
      : base;
  }, [monitorStopped, monitorError]);

  const effectiveStatus: DetailStatus = masked
    ? active
      ? "loading"
      : "idle"
    : status;
  const effectiveError = masked ? null : error;
  const effectiveNotice = masked ? null : notice;
  const effectiveRefreshing = masked ? false : refreshing;
  const effectiveMonitorStopped = masked ? false : monitorStopped;
  const effectiveMonitorNotice = masked ? null : monitorNotice;
  const effectiveImageLoading = masked ? false : imageLoading;
  const effectiveImageError = masked ? null : imageError;
  const effectiveDeleting = masked ? false : deleting;
  const effectiveDeleteError = masked ? null : deleteError;

  return useMemo(
    () => ({
      resource,
      loading: effectiveStatus === "idle" || effectiveStatus === "loading",
      status: effectiveStatus,
      error:
        effectiveStatus === "error"
          ? receiptErrorMessage(effectiveError, "detail")
          : null,
      notFound:
        effectiveStatus === "error" && isReceiptGoneError(effectiveError),
      notice: effectiveNotice,
      refreshing: effectiveRefreshing,
      monitoring:
        !masked &&
        focused &&
        resource?.status === "processing" &&
        !effectiveMonitorStopped &&
        attemptsRef.current < POLL_ATTEMPTS,
      monitorStopped: effectiveMonitorStopped,
      monitorNotice: effectiveMonitorNotice,
      image,
      imageLoading: effectiveImageLoading,
      imageError: effectiveImageError
        ? receiptErrorMessage(effectiveImageError, "image")
        : null,
      imageRetryable:
        effectiveImageError !== null &&
        errorCode(effectiveImageError) !== ApiErrorCodes.NotFound &&
        errorCode(effectiveImageError) !== ApiErrorCodes.ImageNotParsed &&
        errorStatus(effectiveImageError) !== 404 &&
        errorStatus(effectiveImageError) !== 409,
      deleting: effectiveDeleting,
      deleteError: effectiveDeleteError
        ? receiptErrorMessage(effectiveDeleteError, "delete")
        : null,
      refresh,
      retry,
      checkStatus,
      refreshImage,
      remove,
      clearDeleteError,
      clearNotice,
    }),
    [
      resource,
      effectiveStatus,
      effectiveError,
      effectiveNotice,
      effectiveRefreshing,
      focused,
      masked,
      effectiveMonitorStopped,
      effectiveMonitorNotice,
      image,
      effectiveImageLoading,
      effectiveImageError,
      effectiveDeleting,
      effectiveDeleteError,
      refresh,
      retry,
      checkStatus,
      refreshImage,
      remove,
      clearDeleteError,
      clearNotice,
    ],
  );
}
