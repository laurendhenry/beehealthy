/**
 * Account-scoped receipt workflow context.
 *
 * Owns the whole live receipt flow: picked image -> measured allocation ->
 * signed raw PUT -> backend parse -> editable review -> backend confirmation
 * (or backend PATCH for a persisted ready draft). Nothing here reports success
 * locally: the confirmed view only appears after the server returns a
 * `confirmed` receipt resource, and every request that can create/confirm a
 * receipt uses a stable idempotency key (confirmation) or an expected version
 * (patch/confirm).
 *
 * Screens should treat this context as a cache of server state plus the single
 * in-flight operation. A receipt opened from history is loaded by id through
 * `reopenReceipt`, independent of whatever flow happened in this session.
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
import { AppState, Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import { useAppData } from "./AppDataContext";
import { useAuth } from "./AuthContext";
import {
  allocateReceiptUpload,
  confirmReceipt,
  getReceipt,
  getReceiptImage,
  getReceiptStatus,
  patchReceipt,
  requestReceiptParse,
} from "../lib/api/receipts";
import {
  isUploadTicketExpired,
  prepareReceiptImage,
  uploadPreparedImage,
  type PickedReceiptAsset,
  type PreparedReceiptImage,
} from "../lib/receipt-image";
import {
  buildReceiptConfirmBody,
  buildReceiptWrite,
  createEmptyFormItem,
  createExampleForm,
  createIdempotencyKey,
  errorCode,
  confirmBodyMatchesResource,
  fingerprintConfirmBody,
  formFromResource,
  formFromConfirmBody,
  isDeterministicClientError,
  isUnknownOutcome,
  planConfirmOperation,
  planMonitorStep,
  renameReceiptItem,
  selectReceiptItemFoodMatch,
  toStageError,
  validateReceiptForm,
  type ConfirmOperation,
} from "../lib/receipt-workflow";
import type {
  NormalizedReceiptImage,
  ReceiptAllocation,
  ReceiptConfirmOutcome,
  ReceiptForm,
  ReceiptFormItem,
  ReceiptPhase,
  ReceiptResource,
  ReceiptSaveOutcome,
  ReceiptStageError,
  ReceiptStatusSnapshot,
  UploadTicket,
} from "../types/receipt";

import {
  clearPendingConfirm,
  loadPendingConfirm,
  savePendingConfirm,
  type PendingConfirmRecovery,
  type PendingConfirmStorage,
} from "../lib/receipt-confirm-store";
export type PendingConfirmStatus = "none" | "retryable" | "unavailable";
type ReceiptState = {
  ownerId: string | null;
  phase: ReceiptPhase;
  /** Local picked/normalized image metadata (kept for preview + retry). */
  image: NormalizedReceiptImage | null;
  /** Immediate local preview URI (works before any upload round trip). */
  imageUri: string | null;
  /** Signed, short-lived server image URL while fresh. */
  imageUrl: string | null;
  imageUrlExpiresAt: string | null;
  receiptId: string | null;
  version: number | null;
  resource: ReceiptResource | null;
  form: ReceiptForm | null;
  formDirty: boolean;
  /** Frozen upload allocation (key + exact measured metadata). */
  allocation: ReceiptAllocation | null;
  uploadTicket: UploadTicket | null;
  /** Frozen confirmation operation while its outcome is unknown. */
  confirmOperation: ConfirmOperation | null;
  /**
   * Durable manual-confirmation journal state. "retryable" means the exact
   * frozen request may be replayed indefinitely; "unavailable" means the
   * journal could not be read and must be explicitly discarded by the user.
   */
  pendingConfirmStatus: PendingConfirmStatus;
  error: ReceiptStageError | null;
  confirmedReceipt: ReceiptResource | null;
  isExample: boolean;
};

const INITIAL_STATE: ReceiptState = {
  ownerId: null,
  phase: "idle",
  image: null,
  imageUri: null,
  imageUrl: null,
  imageUrlExpiresAt: null,
  receiptId: null,
  version: null,
  resource: null,
  form: null,
  formDirty: false,
  allocation: null,
  uploadTicket: null,
  confirmOperation: null,
  pendingConfirmStatus: "none",
  error: null,
  confirmedReceipt: null,
  isExample: false,
};

export type ReopenReceiptResult = "loaded" | "needs-confirmation" | "failed";

export type ReceiptContextValue = {
  // State ------------------------------------------------------------------
  phase: ReceiptPhase;
  image: NormalizedReceiptImage | null;
  imageUri: string | null;
  imageUrl: string | null;
  imageUrlExpiresAt: string | null;
  receiptId: string | null;
  version: number | null;
  resource: ReceiptResource | null;
  form: ReceiptForm | null;
  formDirty: boolean;
  error: ReceiptStageError | null;
  confirmedReceipt: ReceiptResource | null;
  isExample: boolean;
  /** Durable manual-confirmation journal state, safe to mirror in recovery UI. */
  pendingConfirmStatus: PendingConfirmStatus;
  /** Derived flags -------------------------------------------------------- */
  isBusy: boolean;
  hasUnsavedWork: boolean;
  hasActiveWork: boolean;
  canEdit: boolean;
  canConfirm: boolean;
  canSaveDraft: boolean;
  confirmFrozen: boolean;
  validation: ReturnType<typeof validateReceiptForm> | null;
  // Actions ----------------------------------------------------------------
  startFromPickerAsset: (
    asset: PickedReceiptAsset,
    options?: { replace?: boolean },
  ) => Promise<boolean>;
  loadExample: () => void;
  resetReceipt: () => Promise<boolean>;
  discardPendingConfirmation: () => Promise<boolean>;
  updateForm: (patch: Partial<Pick<ReceiptForm, "store" | "date" | "total">>) => void;
  updateFormItem: (
    key: string,
    patch: Partial<Pick<ReceiptFormItem, "name" | "quantity" | "lineTotal">>,
  ) => void;
  addItem: () => void;
  removeItem: (key: string) => void;
  selectFoodMatch: (key: string, match: { id: string }) => void;
  clearFoodMatch: (key: string) => void;
  saveDraft: () => Promise<ReceiptSaveOutcome>;
  confirm: () => Promise<ReceiptConfirmOutcome>;
  retryUpload: () => Promise<boolean>;
  retryParse: () => Promise<boolean>;
  reopenReceipt: (
    receiptId: string,
    options?: { force?: boolean },
  ) => Promise<ReopenReceiptResult>;
  refreshStatus: () => Promise<void>;
  refreshImageUrl: () => Promise<void>;
  applyServerValues: () => void;
  clearError: () => void;
};

const ReceiptContext = createContext<ReceiptContextValue | null>(null);

function hasActiveWork(state: ReceiptState): boolean {
  return state.phase !== "idle" && state.phase !== "confirmed";
}

function phaseForResource(resource: ReceiptResource): ReceiptPhase {
  switch (resource.status) {
    case "ready":
      return "ready";
    case "confirmed":
      return "confirmed";
    case "processing":
      return "monitoring";
    default:
      return "failed";
  }
}

function resourceStageError(resource: ReceiptResource): ReceiptStageError | null {
  if (resource.status === "failed") {
    const code = resource.error?.code;
    return {
      stage: "parsing",
      message:
        code === "PROCESSING_STALE"
          ? "Reading this receipt stopped before it finished. Tap retry to try again."
          : code
            ? `We could not read this receipt (${code}).`
            : "We could not read this receipt.",
      ...(code ? { code } : {}),
      unknownOutcome: false,
    };
  }
  if (resource.status === "uploading") {
    return {
      stage: "loading",
      message:
        "This receipt's photo was never fully uploaded, so it cannot be reopened. Start a new receipt.",
      unknownOutcome: false,
    };
  }
  return null;
}

function failureError(
  stage: ReceiptStageError["stage"],
  message: string,
  code?: string,
): ReceiptStageError {
  return { stage, message, ...(code ? { code } : {}), unknownOutcome: false };
}

type WebStorageLike = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
};

function getWebStorage(): WebStorageLike | null {
  try {
    return (globalThis as { localStorage?: WebStorageLike }).localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * Native: SecureStore (owner-scoped key set by the store helper).
 * Web: localStorage is the only durable browser store available here.
 * If the platform store is unavailable, saving fails closed before submit.
 */
const pendingConfirmStorage: PendingConfirmStorage = {
  async getItem(key) {
    if (Platform.OS === "web") {
      return getWebStorage()?.getItem(key) ?? null;
    }
    return SecureStore.getItemAsync(key);
  },
  async setItem(key, value) {
    if (Platform.OS === "web") {
      const storage = getWebStorage();
      if (!storage) {
        throw new Error("Browser storage is unavailable.");
      }
      storage.setItem(key, value);
      return;
    }
    await SecureStore.setItemAsync(key, value);
  },
  async removeItem(key) {
    if (Platform.OS === "web") {
      const storage = getWebStorage();
      if (!storage) {
        throw new Error("Browser storage is unavailable.");
      }
      storage.removeItem(key);
      return;
    }
    await SecureStore.deleteItemAsync(key);
  },
};

function pendingRetryError(): ReceiptStageError {
  return {
    stage: "confirming",
    message:
      "A previous confirmation may already have reached the server. Retry it without changing any details — the same request cannot create a duplicate.",
    unknownOutcome: true,
  };
}

function pendingDiscardedNotice(): ReceiptStageError {
  return {
    stage: "confirming",
    message:
      "The pending retry record was removed from this device. That did not confirm, undo or delete anything on the server — check Receipt history before saving this receipt again.",
    unknownOutcome: true,
  };
}

function pendingUnavailableError(): ReceiptStageError {
  return failureError(
    "confirming",
    "Saved retry information could not be read safely. Nothing new was sent, but an earlier confirmation may have reached the server. Check Receipt history; then clear the pending retry before starting again.",
  );
}

function pendingGuardError(): ReceiptStageError {
  return {
    stage: "confirming",
    message:
      "A previous confirmation is still unresolved. Retry it or check Receipt history before starting or confirming another receipt.",
    unknownOutcome: true,
  };
}


function pendingBlockError(status: PendingConfirmStatus): ReceiptStageError | null {
  if (status === "retryable") {
    return pendingGuardError();
  }
  if (status === "unavailable") {
    return pendingUnavailableError();
  }
  return null;
}

export function ReceiptProvider({ children }: { children: ReactNode }) {
  const { userId, onSessionInvalidated } = useAuth();
  const { invalidateFor } = useAppData();

  const [state, setState] = useState<ReceiptState>(INITIAL_STATE);
  const stateRef = useRef<ReceiptState>(INITIAL_STATE);
  const ownerRef = useRef<string | null>(userId);
  const confirmingRef = useRef(false);
  const opRef = useRef<AbortController | null>(null);
  const monitorRef = useRef<{
    generation: number;
    timer: ReturnType<typeof setTimeout> | null;
    controller: AbortController | null;
  }>({
    generation: 0,
    timer: null,
    controller: null,
  });
  const pendingConfirmRef = useRef<ConfirmOperation | null>(null);
  const pendingSavedAtRef = useRef<string | null>(null);
  const pendingRestoreRef = useRef<{
    ownerId: string;
    token: object;
    promise: Promise<PendingConfirmRecovery | null>;
  } | null>(null);
  const pendingRestoreSettledRef = useRef(true);


  /** Apply a state patch synchronously to the ref, then to React state. */
  const update = useCallback(
    (
      patch:
        | Partial<ReceiptState>
        | ((previous: ReceiptState) => Partial<ReceiptState>),
    ) => {
      const previous = stateRef.current;
      const resolved = typeof patch === "function" ? patch(previous) : patch;
      const next = { ...previous, ...resolved };
      stateRef.current = next;
      setState(next);
    },
    [],
  );

  const abortActive = useCallback(() => {
    opRef.current?.abort();
    opRef.current = null;
  }, []);

  const newOperation = useCallback((): AbortController => {
    opRef.current?.abort();
    const controller = new AbortController();
    opRef.current = controller;
    return controller;
  }, []);

  const isCurrentOperation = useCallback((controller: AbortController) => {
    return opRef.current === controller && !controller.signal.aborted;
  }, []);

  const stopMonitor = useCallback(() => {
    monitorRef.current.generation += 1;
    monitorRef.current.controller?.abort();
    monitorRef.current.controller = null;
    if (monitorRef.current.timer !== null) {
      clearTimeout(monitorRef.current.timer);
      monitorRef.current.timer = null;
    }
  }, []);

  const resetFlow = useCallback(
    (owner: string | null) => {
      ownerRef.current = owner;
      abortActive();
      stopMonitor();
      pendingConfirmRef.current = null;
      pendingSavedAtRef.current = null;
      pendingRestoreRef.current = null;
      pendingRestoreSettledRef.current = true;
      update({ ...INITIAL_STATE, ownerId: owner });
    },
    [abortActive, stopMonitor, update],
  );

  /**
   * Load the durable manual-confirmation journal for `owner`. Every action that
   * could create/replace a receipt awaits this first, so an async restore can
   * never be raced by a fresh submit. A journal is only hydrated when the flow
   * is still idle; otherwise its status still blocks unrelated confirmations.
   */
  const restorePendingForOwner = useCallback(
    (owner: string): Promise<PendingConfirmRecovery | null> => {
      const existing = pendingRestoreRef.current;
      if (existing?.ownerId === owner) {
        return existing.promise;
      }
      pendingRestoreSettledRef.current = false;
      const token = {};
      const promise = (async (): Promise<PendingConfirmRecovery | null> => {
        const loaded = await loadPendingConfirm(pendingConfirmStorage, owner);
        if (ownerRef.current !== owner) {
          return null;
        }
        // resetFlow() clears pendingRestoreRef; a load that loses ownership of
        // that slot must never restore a stale journal into the new account.
        if (pendingRestoreRef.current?.token !== token) {
          return null;
        }
        const current = stateRef.current;
        const canHydrate =
          current.phase === "idle" &&
          current.form === null &&
          current.receiptId === null;
        if (loaded.status === "none") {
          return null;
        }
        if (loaded.status === "unavailable") {
          pendingConfirmRef.current = null;
          pendingSavedAtRef.current = null;
          const error = pendingUnavailableError();
          if (canHydrate) {
            update({
              ownerId: owner,
              phase: "failed",
              form: null,
              formDirty: false,
              confirmOperation: null,
              pendingConfirmStatus: "unavailable",
              error,
            });
          } else {
            update((previous) => ({
              pendingConfirmStatus: "unavailable",
              error: previous.error ?? error,
            }));
          }
          return null;
        }
        const recovery = loaded.recovery;
        pendingConfirmRef.current = recovery.operation;
        pendingSavedAtRef.current = recovery.savedAt;
        const error = pendingRetryError();
        if (canHydrate) {
          update({
            ownerId: owner,
            phase: "failed",
            form: formFromConfirmBody(recovery.operation.body),
            formDirty: true,
            confirmOperation: recovery.operation,
            pendingConfirmStatus: "retryable",
            error,
          });
        } else {
          update((previous) => ({
            pendingConfirmStatus: "retryable",
            error: previous.error ?? error,
          }));
        }
        return recovery;
      })();
      pendingRestoreRef.current = { ownerId: owner, token, promise };
      void promise.then(
        () => {
          if (pendingRestoreRef.current?.promise === promise) {
            pendingRestoreSettledRef.current = true;
          }
        },
        () => {
          if (pendingRestoreRef.current?.promise === promise) {
            pendingRestoreSettledRef.current = true;
          }
        },
      );
      return promise;
    },
    [update],
  );

  const applyResource = useCallback(
    (resource: ReceiptResource, options?: { resetImage?: boolean }) => {
      update((previous) => ({
        receiptId: resource.id,
        version: resource.version,
        resource,
        form: formFromResource(resource),
        formDirty: false,
        phase: phaseForResource(resource),
        error: resourceStageError(resource),
        confirmedReceipt: resource.status === "confirmed" ? resource : null,
        uploadTicket: null,
        allocation: null,
        image: null,
        imageUri: options?.resetImage ? null : previous.imageUri,
        imageUrl: options?.resetImage ? null : previous.imageUrl,
        imageUrlExpiresAt: options?.resetImage ? null : previous.imageUrlExpiresAt,
        confirmOperation: null,
      }));
    },
    [update],
  );

  const refreshImageUrl = useCallback(async () => {
    const current = stateRef.current;
    const receiptId = current.receiptId;
    if (!receiptId || !current.resource) {
      return;
    }
    const stillFresh =
      current.imageUrl !== null &&
      current.imageUrlExpiresAt !== null &&
      Date.parse(current.imageUrlExpiresAt) - Date.now() > 60_000;
    if (stillFresh) {
      return;
    }
    try {
      const ticket = await getReceiptImage(receiptId);
      if (stateRef.current.receiptId !== receiptId) {
        return;
      }
      update({ imageUrl: ticket.url, imageUrlExpiresAt: ticket.expiresAt });
    } catch (error) {
      // Manual receipts have no photo (404) and an unparsed image is not
      // pinned yet (409). Both are expected; never fail the screen over them.
      const status = (error as { status?: number }).status;
      const code = errorCode(error);
      if (status === 404 || status === 409 || code === "IMAGE_NOT_PARSED") {
        return;
      }
      // Transient image failures leave the local preview/history intact.
    }
  }, [update]);

  const monitorReceipt = useCallback(
    (receiptId: string) => {
      stopMonitor();
      const generation = monitorRef.current.generation;
      const controller = new AbortController();
      monitorRef.current.controller = controller;
      const startedAt = Date.now();
      let attempt = 0;

      const schedule = (delayMs: number) => {
        monitorRef.current.timer = setTimeout(() => {
          monitorRef.current.timer = null;
          void tick();
        }, delayMs);
      };

      const tick = async () => {
        if (generation !== monitorRef.current.generation) {
          return;
        }
        const owner = ownerRef.current;
        if (!owner || stateRef.current.receiptId !== receiptId) {
          return;
        }
        if (AppState.currentState !== "active") {
          schedule(3_000);
          return;
        }
        let snapshot: ReceiptStatusSnapshot;
        try {
          snapshot = await getReceiptStatus(receiptId, {
            signal: controller.signal,
          });
        } catch (error) {
          if (
            generation !== monitorRef.current.generation ||
            ownerRef.current !== owner ||
            stateRef.current.receiptId !== receiptId ||
            controller.signal.aborted
          ) {
            return;
          }
          attempt += 1;
          const step = planMonitorStep({
            attempt,
            elapsedMs: Date.now() - startedAt,
            status: "processing",
            random: Math.random(),
          });
          if (step.kind === "continue") {
            schedule(step.delayMs);
          } else {
            update({
              phase: "failed",
              error: {
                stage: "parsing",
                message: "We stopped checking parsing status. Tap retry reading to check again.",
                ...(errorCode(error) ? { code: errorCode(error) as string } : {}),
                unknownOutcome: true,
              },
            });
          }
          return;
        }
        if (generation !== monitorRef.current.generation) {
          return;
        }
        if (ownerRef.current !== owner || stateRef.current.receiptId !== receiptId) {
          return;
        }

        update((previous) => ({
          version: snapshot.version,
          resource:
            previous.resource && previous.resource.status !== snapshot.status
              ? { ...previous.resource, status: snapshot.status, version: snapshot.version }
              : previous.resource,
        }));

        const step = planMonitorStep({
          attempt,
          elapsedMs: Date.now() - startedAt,
          status: snapshot.status,
          retryAfterMs: snapshot.retryAfterMs,
          random: Math.random(),
        });

        if (step.kind === "continue") {
          attempt += 1;
          update({ phase: "monitoring", error: null });
          schedule(step.delayMs);
          return;
        }

        if (step.kind === "refreshFull") {
          try {
            const resource = await getReceipt(receiptId, {
              signal: controller.signal,
            });
            if (
              generation !== monitorRef.current.generation ||
              ownerRef.current !== owner ||
              stateRef.current.receiptId !== receiptId ||
              controller.signal.aborted
            ) {
              return;
            }
            applyResource(resource);
            void refreshImageUrl();
          } catch (error) {
            if (
              generation !== monitorRef.current.generation ||
              ownerRef.current !== owner ||
              stateRef.current.receiptId !== receiptId ||
              controller.signal.aborted
            ) {
              return;
            }
            update({
              phase: "failed",
              error: {
                stage: "parsing",
                message: "Parsing finished but we could not load the receipt. Tap retry reading.",
                ...(errorCode(error) ? { code: errorCode(error) as string } : {}),
                unknownOutcome: true,
              },
            });
          }
          return;
        }

        // step.kind === "stop"
        if (step.reason === "timeout") {
          update({
            phase: "failed",
            error: {
              stage: "parsing",
              message:
                "We stopped checking while this receipt was still reading. Tap retry reading to check again.",
              unknownOutcome: false,
            },
          });
          return;
        }
        if (snapshot.status === "failed") {
          update({
            phase: "failed",
            error: failureError(
              "parsing",
              snapshot.error?.code === "PROCESSING_STALE"
                ? "Reading this receipt stopped before it finished. Tap retry to try again."
                : snapshot.error?.code
                  ? `We could not read this receipt (${snapshot.error.code}).`
                  : "We could not read this receipt.",
              snapshot.error?.code,
            ),
          });
          return;
        }
        if (snapshot.status === "uploading") {
          update({
            phase: "failed",
            error: failureError(
              "parsing",
              "This receipt's photo never finished uploading. Tap retry reading to try again.",
            ),
          });
          return;
        }
        update({
          phase: "failed",
          error: failureError(
            "parsing",
            "This receipt is no longer available to read. Check Receipt history and start a new receipt.",
          ),
        });
      };

      void tick();
    },
    [applyResource, refreshImageUrl, stopMonitor, update],
  );

  const runParse = useCallback(
    async (
      receiptId: string,
      owner: string,
      controller: AbortController,
    ): Promise<boolean> => {
      update({ phase: "parsing", error: null });
      try {
        const resource = await requestReceiptParse(receiptId, {
          signal: controller.signal,
        });
        if (!isCurrentOperation(controller) || ownerRef.current !== owner) {
          return false;
        }
        if (resource.status === "processing") {
          update({ phase: "monitoring", error: null });
          applyResource(resource);
          monitorReceipt(receiptId);
          return true;
        }
        applyResource(resource);
        void refreshImageUrl();
        return resource.status !== "failed";
      } catch (error) {
        if (!isCurrentOperation(controller) || ownerRef.current !== owner) {
          return false;
        }
        if (isUnknownOutcome(error)) {
          // The parse may have started. Never auto-repeat it; monitor instead.
          update({ phase: "monitoring", error: null });
          monitorReceipt(receiptId);
          return true;
        }
        update({
          phase: "failed",
          error: toStageError({
            stage: "parsing",
            error,
            fallback: "We could not read that receipt. You can retry.",
          }),
        });
        return false;
      }
    },
    [applyResource, isCurrentOperation, monitorReceipt, refreshImageUrl, update],
  );

  const runUpload = useCallback(
    async (
      image: PreparedReceiptImage,
      allocation: ReceiptAllocation,
      owner: string,
      controller: AbortController,
    ): Promise<boolean> => {
      let receiptId = stateRef.current.receiptId;
      let ticket = stateRef.current.uploadTicket;

      if (!ticket || isUploadTicketExpired(ticket)) {
        update({ phase: "allocating", error: null });
        try {
          ticket = await allocateReceiptUpload(
            { contentType: allocation.contentType, sizeBytes: allocation.sizeBytes },
            allocation.key,
            { signal: controller.signal },
          );
        } catch (error) {
          if (!isCurrentOperation(controller) || ownerRef.current !== owner) {
            return false;
          }
          if (errorCode(error) === "IDEMPOTENCY_CONFLICT" && receiptId) {
            // The earlier allocation already became a receipt; reconcile it
            // instead of minting a new key (which would duplicate the upload).
            update({ phase: "monitoring", error: null });
            monitorReceipt(receiptId);
            return true;
          }
          update({
            phase: "failed",
            error: toStageError({
              stage: "allocating",
              error,
              fallback: "We could not start the upload. Try again.",
            }),
          });
          return false;
        }
        if (!isCurrentOperation(controller) || ownerRef.current !== owner) {
          return false;
        }
        receiptId = ticket.receiptId;
        update({ receiptId, uploadTicket: ticket, version: null, error: null });
      }

      update({ phase: "uploading", error: null });
      try {
        await uploadPreparedImage(image, ticket, controller.signal);
      } catch (error) {
        if (!isCurrentOperation(controller) || ownerRef.current !== owner) {
          return false;
        }
        update({
          phase: "failed",
          error: toStageError({
            stage: "uploading",
            error,
            fallback: "The photo did not upload. Try again.",
          }),
        });
        return false;
      }
      if (!isCurrentOperation(controller) || ownerRef.current !== owner) {
        return false;
      }
      if (!receiptId) {
        update({
          phase: "failed",
          error: failureError("uploading", "The upload lost its receipt id. Start again."),
        });
        return false;
      }
      return runParse(receiptId, owner, controller);
    },
    [isCurrentOperation, monitorReceipt, runParse, update],
  );

  const startFromPickerAsset = useCallback(
    async (
      asset: PickedReceiptAsset,
      options?: { replace?: boolean },
    ): Promise<boolean> => {
      const owner = ownerRef.current;
      if (!owner) {
        update({
          phase: "failed",
          error: failureError("normalizing", "Sign in to scan a receipt."),
        });
        return false;
      }
      if (stateRef.current.phase === "confirming") {
        return false;
      }
      await restorePendingForOwner(owner);
      if (ownerRef.current !== owner) {
        return false;
      }
      const current = stateRef.current;
      const pendingError = pendingBlockError(current.pendingConfirmStatus);
      if (pendingError || current.confirmOperation) {
        update({ error: pendingError ?? pendingGuardError() });
        return false;
      }
      if (hasActiveWork(current) && !options?.replace) {
        return false;
      }

      const controller = newOperation();
      stopMonitor();
      update({
        ...INITIAL_STATE,
        ownerId: owner,
        phase: "normalizing",
        imageUri: asset.uri,
      });

      let prepared: PreparedReceiptImage;
      try {
        prepared = await prepareReceiptImage(asset);
      } catch (error) {
        if (!isCurrentOperation(controller) || ownerRef.current !== owner) {
          return false;
        }
        update({
          phase: "failed",
          error: toStageError({
            stage: "normalizing",
            error,
            fallback: "That photo could not be read. Try a JPEG or PNG photo.",
          }),
        });
        return false;
      }
      if (!isCurrentOperation(controller) || ownerRef.current !== owner) {
        return false;
      }

      const allocation: ReceiptAllocation = {
        key: createIdempotencyKey("upload"),
        contentType: prepared.contentType,
        sizeBytes: prepared.sizeBytes,
      };
      update({
        image: prepared,
        imageUri: prepared.uri,
        allocation,
        phase: "allocating",
        error: null,
      });
      return runUpload(prepared, allocation, owner, controller);
    },
    [isCurrentOperation, newOperation, runUpload, stopMonitor, update],
  );

  const loadExample = useCallback(() => {
    const current = stateRef.current;
    const pendingError = pendingBlockError(current.pendingConfirmStatus);
    if (pendingError || current.confirmOperation) {
      update({ error: pendingError ?? pendingGuardError() });
      return;
    }
    if (!pendingRestoreSettledRef.current) {
      update({ error: pendingGuardError() });
      return;
    }
    abortActive();
    stopMonitor();
    const owner = ownerRef.current;
    update({
      ...INITIAL_STATE,
      ownerId: owner,
      phase: "ready",
      form: createExampleForm(),
      formDirty: true,
      isExample: true,
    });
  }, [abortActive, stopMonitor, update]);

  const resetReceipt = useCallback(async (): Promise<boolean> => {
    // Serialize reset against a confirmation. Otherwise a manual journal save
    // could complete after reset cleared the flow, leaving a never-sent key
    // orphaned on disk with nothing in memory to recover it.
    if (confirmingRef.current) {
      return false;
    }
    confirmingRef.current = true;
    try {
      const owner = ownerRef.current;
      if (owner) {
        await restorePendingForOwner(owner);
        if (ownerRef.current !== owner) {
          return false;
        }
      }
      const current = stateRef.current;
      const pendingStatus = current.pendingConfirmStatus;
      // A discarded journal is only safe when the server has already confirmed
      // this exact payload, or when the attempt was deterministically rejected
      // (for example a validation 4xx) and only local cleanup failed.
      const serverConfirmed =
        current.confirmedReceipt !== null &&
        pendingConfirmRef.current !== null &&
        confirmBodyMatchesResource(
          pendingConfirmRef.current.body,
          current.confirmedReceipt,
        );
      const canDiscardRejected =
        pendingStatus === "retryable" && current.confirmOperation === null;
      const canDiscardPending =
        pendingStatus !== "none" && (serverConfirmed || canDiscardRejected);

      if (pendingStatus !== "none" && !canDiscardPending) {
        update({
          error:
            pendingStatus === "unavailable"
              ? pendingUnavailableError()
              : pendingGuardError(),
        });
        return false;
      }
      if (canDiscardPending) {
        if (!owner) {
          update({
            error: failureError(
              "confirming",
              "The saved retry could not be discarded because this session is no longer signed in.",
            ),
          });
          return false;
        }
        const cleared = await clearPendingConfirm(pendingConfirmStorage, owner);
        if (ownerRef.current !== owner) {
          return false;
        }
        const after = stateRef.current;
        if (after.pendingConfirmStatus !== pendingStatus) {
          return false;
        }
        if (!cleared) {
          update({
            error: failureError(
              "confirming",
              "The saved retry could not be discarded. Check Receipt history or try again.",
            ),
          });
          return false;
        }
        if (after.confirmOperation && !serverConfirmed) {
          update({ error: pendingGuardError() });
          return false;
        }
      }
      if (stateRef.current.confirmOperation) {
        update({ error: pendingGuardError() });
        return false;
      }
      resetFlow(ownerRef.current);
      return true;
    } finally {
      confirmingRef.current = false;
    }
  }, [resetFlow, restorePendingForOwner, update]);

  /**
   * Explicit, user-confirmed escape hatch for a pending journal that cannot be
   * retried (corrupt/unreadable storage) or that the user has reconciled with
   * Receipt history. This only forgets the local retry record: it never
   * confirms, saves or deletes a server receipt.
   *
   * Returns true only after the storage removal succeeded. On failure the
   * frozen state is left untouched so the same exact retry remains recoverable.
   */
  const discardPendingConfirmation = useCallback(async (): Promise<boolean> => {
    if (confirmingRef.current) {
      return false;
    }
    confirmingRef.current = true;
    try {
      const owner = ownerRef.current;
      if (!owner) {
        return false;
      }
      await restorePendingForOwner(owner);
      if (ownerRef.current !== owner) {
        return false;
      }
      if (stateRef.current.pendingConfirmStatus === "none") {
        // Nothing durable is pending. Reporting success here would imply a
        // server change or a cleanup that did not happen.
        return false;
      }
      const cleared = await clearPendingConfirm(pendingConfirmStorage, owner);
      if (ownerRef.current !== owner) {
        return false;
      }
      if (!cleared) {
        update({
          error: failureError(
            "confirming",
            "The saved retry could not be removed from this device. Check Receipt history and try again; new confirmations stay blocked until it is cleared.",
          ),
        });
        return false;
      }

      pendingConfirmRef.current = null;
      pendingSavedAtRef.current = null;
      pendingRestoreRef.current = null;
      pendingRestoreSettledRef.current = true;
      update((previous) => {
        const keepsWork =
          previous.form !== null ||
          previous.receiptId !== null ||
          previous.resource !== null;
        if (!keepsWork) {
          return { ...INITIAL_STATE, ownerId: previous.ownerId };
        }
        const wasHydratedRetry =
          previous.receiptId === null &&
          previous.resource === null &&
          previous.phase === "failed";
        return {
          ...previous,
          pendingConfirmStatus: "none",
          confirmOperation: null,
          // A journal-restored form was parked in "failed" only so it could not
          // be edited or submitted. After the explicit discard the form is a
          // fresh manual draft again; existing server-backed work keeps its
          // real phase.
          ...(wasHydratedRetry ? { phase: "ready" as const } : {}),
          error: pendingDiscardedNotice(),
        };
      });
      return true;
    } finally {
      confirmingRef.current = false;
    }
  }, [restorePendingForOwner, update]);

  /**
   * Remove the durable manual journal. The caller only invokes this after a
   * server-confirmed result or a deterministic client rejection.
   */
  const clearPendingJournal = useCallback(
    async (owner: string, operation: ConfirmOperation | null): Promise<boolean> => {
      const manual =
        operation !== null
          ? operation.body.receiptId === undefined
          : pendingConfirmRef.current !== null;
      if (!manual) {
        pendingConfirmRef.current = null;
        pendingSavedAtRef.current = null;
        update({ pendingConfirmStatus: "none" });
        return true;
      }
      const cleared = await clearPendingConfirm(pendingConfirmStorage, owner);
      if (cleared) {
        pendingConfirmRef.current = null;
        pendingSavedAtRef.current = null;
        update({ pendingConfirmStatus: "none" });
      }
      return cleared;
    },
    [update],
  );

  const canEditNow = useCallback((snapshot: ReceiptState): boolean => {
    return (
      snapshot.form !== null &&
      snapshot.phase !== "confirming" &&
      snapshot.phase !== "confirmed" &&
      snapshot.confirmOperation === null &&
      snapshot.pendingConfirmStatus === "none" &&
      (snapshot.phase === "ready" || snapshot.phase === "failed")
    );
  }, []);
  const updateForm = useCallback(
    (patch: Partial<Pick<ReceiptForm, "store" | "date" | "total">>) => {
      const current = stateRef.current;
      if (!current.form || !canEditNow(current)) {
        return;
      }
      update({ form: { ...current.form, ...patch }, formDirty: true });
    },
    [canEditNow, update],
  );

  const updateFormItem = useCallback(
    (
      key: string,
      patch: Partial<Pick<ReceiptFormItem, "name" | "quantity" | "lineTotal">>,
    ) => {
      const current = stateRef.current;
      if (!current.form || !canEditNow(current)) {
        return;
      }
      update({
        form: {
          ...current.form,
          items: current.form.items.map((item) => {
            if (item.key !== key) {
              return item;
            }
            let next = item;
            if (typeof patch.name === "string" && patch.name !== item.name) {
              next = renameReceiptItem(next, patch.name);
            }
            if (typeof patch.quantity === "string") {
              next = { ...next, quantity: patch.quantity };
            }
            if (typeof patch.lineTotal === "string") {
              next = { ...next, lineTotal: patch.lineTotal };
            }
            return next;
          }),
        },
        formDirty: true,
      });
    },
    [canEditNow, update],
  );

  const addItem = useCallback(() => {
    const current = stateRef.current;
    if (!current.form || !canEditNow(current) || current.form.items.length >= 200) {
      return;
    }
    update({
      form: { ...current.form, items: [...current.form.items, createEmptyFormItem()] },
      formDirty: true,
    });
  }, [canEditNow, update]);

  const removeItem = useCallback(
    (key: string) => {
      const current = stateRef.current;
      if (!current.form || !canEditNow(current) || current.form.items.length <= 1) {
        return;
      }
      update({
        form: {
          ...current.form,
          items: current.form.items.filter((item) => item.key !== key),
        },
        formDirty: true,
      });
    },
    [canEditNow, update],
  );

  const selectFoodMatch = useCallback(
    (key: string, match: { id: string }) => {
      const current = stateRef.current;
      if (!current.form || !canEditNow(current)) {
        return;
      }
      update({
        form: {
          ...current.form,
          items: current.form.items.map((item) =>
            item.key === key ? selectReceiptItemFoodMatch(item, match) : item,
          ),
        },
        formDirty: true,
      });
    },
    [canEditNow, update],
  );
  const clearFoodMatch = useCallback(
    (key: string) => {
      const current = stateRef.current;
      if (!current.form || !canEditNow(current)) {
        return;
      }
      update({
        form: {
          ...current.form,
          items: current.form.items.map((item) =>
            item.key === key ? { ...item, foodId: null, matchStatus: "check" as const } : item,
          ),
        },
        formDirty: true,
      });
    },
    [canEditNow, update],
  );

  const saveDraft = useCallback(async (): Promise<ReceiptSaveOutcome> => {
    const restoreOwner = ownerRef.current;
    if (restoreOwner) {
      await restorePendingForOwner(restoreOwner);
      if (ownerRef.current !== restoreOwner) {
        return { status: "noop" };
      }
    }
    const current = stateRef.current;
    const pendingError = pendingBlockError(current.pendingConfirmStatus);
    if (pendingError) {
      update({ error: pendingError });
      return { status: "error", error: pendingError };
    }
    if (
      current.phase === "confirming" ||
      current.phase === "confirmed" ||
      current.confirmOperation
    ) {
      return { status: "noop" };
    }
    if (current.phase !== "ready") {
      return { status: "noop" };
    }
    if (!current.receiptId || current.version === null || !current.form) {
      return { status: "noop" };
    }
    if (current.resource && current.resource.id !== current.receiptId) {
      return {
        status: "error",
        error: failureError("saving", "This receipt changed. Reopen it before saving."),
      };
    }
    const validation = validateReceiptForm(current.form);
    if (!validation.valid) {
      const error: ReceiptStageError = {
        stage: "saving",
        message: "Fix the highlighted fields before saving.",
        unknownOutcome: false,
        issues: validation.issues,
      };
      update({ error });
      return { status: "validation", error };
    }
    if (current.resource && current.resource.status !== "ready") {
      return {
        status: "error",
        error: failureError(
          "saving",
          "Only a ready receipt can be saved. Confirm this receipt instead.",
        ),
      };
    }

    const owner = ownerRef.current;
    if (!owner) {
      return {
        status: "error",
        error: failureError("saving", "Sign in to save this receipt."),
      };
    }

    const controller = newOperation();
    const receiptId = current.receiptId;
    const expectedVersion = current.version;
    update({ error: null });
    try {
      const resource = await patchReceipt(
        receiptId,
        { ...buildReceiptWrite(current.form), expectedVersion },
        { signal: controller.signal },
      );
      if (
        !isCurrentOperation(controller) ||
        ownerRef.current !== owner ||
        stateRef.current.receiptId !== receiptId
      ) {
        return { status: "noop" };
      }
      applyResource(resource);
      invalidateFor("receipt-patch");
      return { status: "saved", resource };
    } catch (error) {
      if (!isCurrentOperation(controller) || ownerRef.current !== owner) {
        return { status: "noop" };
      }
      const stageError = toStageError({
        stage: "saving",
        error,
        fallback: "We could not save your changes.",
      });
      if (stageError.code === "VERSION_CONFLICT") {
        const conflict: ReceiptStageError = {
          ...stageError,
          conflict: true,
          message:
            "This receipt changed on the server. Your edits are still here — compare them and save again.",
        };
        update({ error: conflict, formDirty: true });
        try {
          const latest = await getReceipt(receiptId, {
            signal: controller.signal,
          });
          if (
            isCurrentOperation(controller) &&
            ownerRef.current === owner &&
            stateRef.current.receiptId === receiptId
          ) {
            update({ resource: latest, version: latest.version });
          }
        } catch {
          // Keep the conflict banner; a refresh can be retried from the UI.
        }
        return { status: "conflict", error: conflict };
      }
      update({ error: stageError });
      if (stageError.unknownOutcome) {
        return { status: "unknown", error: stageError };
      }
      if (
        stageError.code === "VALIDATION_ERROR" ||
        stageError.code === "FOREIGN_ITEM_ID" ||
        stageError.code === "DUPLICATE_ITEM_ID" ||
        stageError.code === "INVALID_FOOD_ID"
      ) {
        return { status: "validation", error: stageError };
      }
      return { status: "error", error: stageError };
    }
  }, [applyResource, invalidateFor, isCurrentOperation, newOperation, update]);

  const confirm = useCallback(async (): Promise<ReceiptConfirmOutcome> => {
    if (confirmingRef.current) {
      return {
        status: "error",
        error: failureError("confirming", "Confirmation is already in progress."),
      };
    }
    confirmingRef.current = true;
    try {
      const restoreOwner = ownerRef.current;
      if (restoreOwner) {
        await restorePendingForOwner(restoreOwner);
        if (ownerRef.current !== restoreOwner) {
          return {
            status: "error",
            error: failureError(
              "confirming",
              "Your account changed before confirmation finished.",
            ),
          };
        }
      }
      const current = stateRef.current;
      if (current.phase === "confirmed" && current.confirmedReceipt) {
        return {
          status: "confirmed",
          receiptId: current.confirmedReceipt.id,
          resource: current.confirmedReceipt,
        };
      }
      const owner = ownerRef.current;
      if (!owner) {
        return {
          status: "error",
          error: failureError("confirming", "Sign in to save this receipt."),
        };
      }
      if (current.pendingConfirmStatus === "unavailable") {
        const error = pendingUnavailableError();
        update({ phase: "failed", error, confirmOperation: null });
        return { status: "unknown", error };
      }
      if (current.phase !== "ready" && current.phase !== "failed") {
        return {
          status: "error",
          error: failureError("confirming", "This receipt is not ready to confirm yet."),
        };
      }
      const form = current.form;
      if (!form) {
        return {
          status: "error",
          error: failureError("confirming", "There is no receipt to save."),
        };
      }
      const validation = validateReceiptForm(form);
      if (!validation.valid) {
        const error: ReceiptStageError = {
          stage: "confirming",
          message: "Fix the highlighted fields before confirming.",
          unknownOutcome: false,
          issues: validation.issues,
        };
        update({ error });
        return { status: "validation", error };
      }
      const targetReceiptId = current.receiptId;
      if (
        targetReceiptId &&
        (current.version === null ||
          (current.resource && current.resource.id !== targetReceiptId) ||
          (current.resource &&
            !["ready", "failed", "confirmed"].includes(current.resource.status)))
      ) {
        return {
          status: "error",
          error: failureError(
            "confirming",
            "This receipt is not ready to confirm yet. Wait for parsing to finish.",
          ),
        };
      }
      if (!targetReceiptId && current.resource) {
        return {
          status: "error",
          error: failureError("confirming", "This receipt changed. Reopen it before confirming."),
        };
      }

      const frozen =
        current.confirmOperation ??
        (current.pendingConfirmStatus === "retryable"
          ? pendingConfirmRef.current
          : null);
      let operation: ConfirmOperation;
      if (frozen) {
        const fingerprint = fingerprintConfirmBody(
          planConfirmOperation({
            previous: null,
            form,
            receiptId: targetReceiptId ?? undefined,
            expectedVersion: current.version ?? undefined,
            mode: "submit",
          }).body,
        );
        if (fingerprint !== frozen.fingerprint) {
          return {
            status: "unknown",
            error: failureError(
              "confirming",
              "A previous confirmation may still have gone through. Reopen this receipt before changing it.",
            ),
          };
        }
        operation = frozen;
      } else {
        if (current.pendingConfirmStatus === "retryable") {
          const error = pendingGuardError();
          update({ error });
          return { status: "unknown", error };
        }
        operation = planConfirmOperation({
          previous: null,
          form,
          receiptId: targetReceiptId ?? undefined,
          expectedVersion: current.version ?? undefined,
          mode: "submit",
        });
      }

      const manual = operation.body.receiptId === undefined;
      const operationTarget = operation.body.receiptId ?? null;
      if (operationTarget !== targetReceiptId) {
        const error = failureError(
          "confirming",
          "This receipt changed before it could be confirmed. Reopen it and try again.",
        );
        update({ error });
        return { status: "error", error };
      }
      const previousSavedAt = pendingSavedAtRef.current;

      const controller = newOperation();
      stopMonitor();
      update({ phase: "confirming", error: null, confirmOperation: operation });

      if (manual) {
        const persistAt = previousSavedAt ?? new Date().toISOString();
        pendingConfirmRef.current = operation;
        pendingSavedAtRef.current = persistAt;
        update({ pendingConfirmStatus: "retryable" });
        const persisted = await savePendingConfirm(
          pendingConfirmStorage,
          owner,
          operation,
          persistAt,
        );
        if (
          !isCurrentOperation(controller) ||
          ownerRef.current !== owner ||
          stateRef.current.receiptId !== targetReceiptId
        ) {
          return {
            status: "error",
            error: failureError("confirming", "Confirmation was cancelled."),
          };
        }
        if (!persisted) {
          const error = failureError(
            "confirming",
            "Safe retry information could not be stored on this device, so nothing was sent. Try again when device storage is available.",
          );
          // A brand-new manual operation has never reached the server. Once its
          // journal cannot be saved, keeping it frozen would deadlock the flow,
          // so release it. An operation restored from an earlier journal may
          // already have been sent; preserve that exact retry instead.
          if (previousSavedAt === null) {
            pendingConfirmRef.current = null;
            pendingSavedAtRef.current = null;
            update({
              phase: "failed",
              error,
              confirmOperation: null,
              pendingConfirmStatus: "none",
            });
          } else {
            update({
              phase: "failed",
              error,
              confirmOperation: operation,
              pendingConfirmStatus: "retryable",
            });
          }
          return { status: "unknown", error };
        }
      }

      try {
        const resource = await confirmReceipt(operation.body, operation.key, {
          signal: controller.signal,
        });
        if (
          !isCurrentOperation(controller) ||
          ownerRef.current !== owner ||
          stateRef.current.receiptId !== targetReceiptId ||
          controller.signal.aborted
        ) {
          return {
            status: "error",
            error: failureError("confirming", "Confirmation was cancelled."),
          };
        }
        if (resource.status !== "confirmed") {
          const error: ReceiptStageError = {
            stage: "confirming",
            message: "The server did not confirm this receipt. Retry to check again.",
            unknownOutcome: true,
          };
          pendingConfirmRef.current = operation;
          update({
            phase: "failed",
            error,
            confirmOperation: operation,
            ...(manual ? { pendingConfirmStatus: "retryable" as const } : {}),
          });
          return { status: "unknown", error };
        }
        let journalCleared = true;
        if (manual) {
          journalCleared = await clearPendingJournal(owner, operation);
          if (
            !isCurrentOperation(controller) ||
            ownerRef.current !== owner ||
            stateRef.current.receiptId !== targetReceiptId
          ) {
            return {
              status: "error",
              error: failureError("confirming", "Confirmation was cancelled."),
            };
          }
        }
        applyResource(resource);
        update({
          pendingConfirmStatus: journalCleared ? "none" : "unavailable",
          ...(journalCleared
            ? {}
            : {
                error: failureError(
                  "confirming",
                  "The receipt was confirmed, but the saved retry could not be removed from this device. Start another receipt to retry cleanup.",
                ),
              }),
        });
        invalidateFor("receipt-confirm");
        return { status: "confirmed", receiptId: resource.id, resource };
      } catch (error) {
        if (
          !isCurrentOperation(controller) ||
          ownerRef.current !== owner ||
          stateRef.current.receiptId !== targetReceiptId ||
          errorCode(error) === "ABORTED"
        ) {
          return {
            status: "error",
            error: failureError("confirming", "Confirmation was cancelled."),
          };
        }
        const stageError = toStageError({
          stage: "confirming",
          error,
          fallback: "We could not save this receipt.",
        });
        if (stageError.code === "VERSION_CONFLICT") {
          const conflict: ReceiptStageError = {
            ...stageError,
            conflict: true,
            message:
              "This receipt changed on the server. Your edits were kept and were not applied.",
          };
          update({ phase: "failed", error: conflict, confirmOperation: null });
          await clearPendingJournal(owner, operation);
          if (
            !isCurrentOperation(controller) ||
            ownerRef.current !== owner ||
            stateRef.current.receiptId !== targetReceiptId
          ) {
            return { status: "conflict", error: conflict };
          }
          if (targetReceiptId) {
            try {
              const latest = await getReceipt(targetReceiptId, {
                signal: controller.signal,
              });
              if (
                !isCurrentOperation(controller) ||
                ownerRef.current !== owner ||
                stateRef.current.receiptId !== targetReceiptId
              ) {
                return { status: "conflict", error: conflict };
              }
              if (latest.status === "confirmed") {
                update({
                  phase: "confirmed",
                  confirmedReceipt: latest,
                  resource: latest,
                  version: latest.version,
                  error: {
                    ...conflict,
                    message:
                      "This receipt was already confirmed elsewhere. Your unsaved edits were not applied.",
                  },
                });
                invalidateFor("receipt-confirm");
                return { status: "conflict", error: conflict };
              }
              update({ resource: latest, version: latest.version });
            } catch {
              // Keep the conflict banner; the user can refresh.
            }
          }
          return { status: "conflict", error: conflict };
        }
        if (isUnknownOutcome(stageError) || isUnknownOutcome(error)) {
          const unknown: ReceiptStageError = {
            ...stageError,
            message:
              "We could not reach the server. The receipt may already be saved — tap retry to check, without changing any details.",
            unknownOutcome: true,
          };
          update({
            phase: "failed",
            error: unknown,
            confirmOperation: operation,
            ...(manual ? { pendingConfirmStatus: "retryable" as const } : {}),
          });
          return { status: "unknown", error: unknown };
        }
        if (!isDeterministicClientError(error)) {
          const unknown: ReceiptStageError = {
            ...stageError,
            message:
              "We could not determine whether the server saved this receipt — tap retry to check, without changing any details.",
            unknownOutcome: true,
          };
          update({
            phase: "failed",
            error: unknown,
            confirmOperation: operation,
            ...(manual ? { pendingConfirmStatus: "retryable" as const } : {}),
          });
          return { status: "unknown", error: unknown };
        }
        const cleared = await clearPendingJournal(owner, operation);
        if (
          !isCurrentOperation(controller) ||
          ownerRef.current !== owner ||
          stateRef.current.receiptId !== targetReceiptId
        ) {
          return { status: "error", error: stageError };
        }
        const deterministicError: ReceiptStageError =
          manual && !cleared
            ? {
                ...stageError,
                message:
                  "The server rejected this confirmation, but the saved retry could not be removed. Try again or check Receipt history.",
              }
            : stageError;
        update({
          phase: "failed",
          error: deterministicError,
          confirmOperation: null,
        });
        if (stageError.code === "VALIDATION_ERROR") {
          return { status: "validation", error: deterministicError };
        }
        return { status: "error", error: deterministicError };
      }
    } finally {
      confirmingRef.current = false;
    }
  }, [
    applyResource,
    clearPendingJournal,
    invalidateFor,
    isCurrentOperation,
    newOperation,
    restorePendingForOwner,
    stopMonitor,
    update,
  ]);
  const retryUpload = useCallback(async (): Promise<boolean> => {
    const restoreOwner = ownerRef.current;
    if (!restoreOwner) {
      return false;
    }
    await restorePendingForOwner(restoreOwner);
    if (ownerRef.current !== restoreOwner) {
      return false;
    }
    const current = stateRef.current;
    const pendingError = pendingBlockError(current.pendingConfirmStatus);
    if (pendingError || current.confirmOperation) {
      update({ error: pendingError ?? pendingGuardError() });
      return false;
    }
    if (!current.image || !current.allocation) {
      return false;
    }
    if (
      current.phase === "allocating" ||
      current.phase === "uploading" ||
      current.phase === "parsing" ||
      current.phase === "confirming"
    ) {
      return false;
    }
    const controller = newOperation();
    stopMonitor();
    return runUpload(current.image, current.allocation, restoreOwner, controller);
  }, [
    newOperation,
    restorePendingForOwner,
    runUpload,
    stopMonitor,
    update,
  ]);

  const retryParse = useCallback(async (): Promise<boolean> => {
    const restoreOwner = ownerRef.current;
    if (!restoreOwner) {
      return false;
    }
    await restorePendingForOwner(restoreOwner);
    if (ownerRef.current !== restoreOwner) {
      return false;
    }
    const current = stateRef.current;
    const pendingError = pendingBlockError(current.pendingConfirmStatus);
    if (pendingError || current.confirmOperation) {
      update({ error: pendingError ?? pendingGuardError() });
      return false;
    }
    if (!current.receiptId || current.phase !== "failed") {
      return false;
    }
    if (
      current.resource &&
      current.resource.id !== current.receiptId
    ) {
      return false;
    }
    const controller = newOperation();
    stopMonitor();
    return runParse(current.receiptId, restoreOwner, controller);
  }, [
    newOperation,
    restorePendingForOwner,
    runParse,
    stopMonitor,
    update,
  ]);

  const refreshStatus = useCallback(async () => {
    const current = stateRef.current;
    const receiptId = current.receiptId;
    if (!receiptId) {
      return;
    }
    if (
      current.phase === "confirming" ||
      current.confirmOperation ||
      current.pendingConfirmStatus !== "none"
    ) {
      return;
    }
    const owner = ownerRef.current;
    if (!owner) {
      return;
    }
    const controller = newOperation();
    stopMonitor();
    try {
      const snapshot = await getReceiptStatus(receiptId, {
        signal: controller.signal,
      });
      if (
        !isCurrentOperation(controller) ||
        ownerRef.current !== owner ||
        stateRef.current.receiptId !== receiptId
      ) {
        return;
      }
      update({ version: snapshot.version });
      if (snapshot.status === "processing") {
        update({ phase: "monitoring", error: null });
        monitorReceipt(receiptId);
        return;
      }
      if (snapshot.status === "failed") {
        update({
          phase: "failed",
          error: failureError(
            "parsing",
            snapshot.error?.code === "PROCESSING_STALE"
              ? "Reading this receipt stopped before it finished. Tap retry to try again."
              : "We could not read this receipt.",
            snapshot.error?.code,
          ),
        });
        return;
      }
      const resource = await getReceipt(receiptId, {
        signal: controller.signal,
      });
      if (
        !isCurrentOperation(controller) ||
        ownerRef.current !== owner ||
        stateRef.current.receiptId !== receiptId
      ) {
        return;
      }
      applyResource(resource);
      void refreshImageUrl();
    } catch (error) {
      if (
        !isCurrentOperation(controller) ||
        ownerRef.current !== owner ||
        stateRef.current.receiptId !== receiptId ||
        errorCode(error) === "ABORTED"
      ) {
        return;
      }
      update((previous) => ({
        error:
          previous.error ??
          toStageError({
            stage: "loading",
            error,
            fallback: "We could not refresh this receipt. Try again.",
          }),
      }));
    }
  }, [
    applyResource,
    isCurrentOperation,
    monitorReceipt,
    newOperation,
    refreshImageUrl,
    stopMonitor,
    update,
  ]);

  const reopenReceipt = useCallback(
    async (
      receiptId: string,
      options?: { force?: boolean },
    ): Promise<ReopenReceiptResult> => {
      const owner = ownerRef.current;
      if (!owner) {
        return "failed";
      }
      await restorePendingForOwner(owner);
      if (ownerRef.current !== owner) {
        return "failed";
      }
      const current = stateRef.current;
      const pendingStatus = current.pendingConfirmStatus;
      if (pendingStatus === "retryable") {
        // Reopening a history item is also the deliberate reconciliation path
        // for a frozen manual retry: the exact submitted body must match the
        // now-confirmed server receipt before the local journal is cleared.
        const pending = pendingConfirmRef.current;
        if (!pending) {
          update({ error: pendingGuardError() });
          return "failed";
        }
        const controller = newOperation();
        stopMonitor();
        try {
          const resource = await getReceipt(receiptId, {
            signal: controller.signal,
          });
          if (
            !isCurrentOperation(controller) ||
            ownerRef.current !== owner ||
            stateRef.current.pendingConfirmStatus !== "retryable" ||
            pendingConfirmRef.current?.key !== pending.key
          ) {
            return "failed";
          }
          if (
            resource.status === "confirmed" &&
            confirmBodyMatchesResource(pending.body, resource)
          ) {
            const cleared = await clearPendingConfirm(
              pendingConfirmStorage,
              owner,
            );
            if (
              !isCurrentOperation(controller) ||
              ownerRef.current !== owner
            ) {
              return "failed";
            }
            if (!cleared) {
              update({
                error: failureError(
                  "confirming",
                  "The server confirmed this receipt, but the saved retry could not be removed. Try again or check Receipt history.",
                ),
              });
              return "failed";
            }
            pendingConfirmRef.current = null;
            pendingSavedAtRef.current = null;
            pendingRestoreRef.current = null;
            pendingRestoreSettledRef.current = true;
            applyResource(resource, { resetImage: true });
            update({ pendingConfirmStatus: "none" });
            invalidateFor("receipt-confirm");
            void refreshImageUrl();
            return "loaded";
          }
          update({ error: pendingGuardError() });
          return "failed";
        } catch (error) {
          if (
            !isCurrentOperation(controller) ||
            ownerRef.current !== owner ||
            errorCode(error) === "ABORTED"
          ) {
            return "failed";
          }
          update({
            error: {
              ...pendingGuardError(),
              message:
                "The saved retry could not be checked against this receipt. Check Receipt history and try again.",
            },
          });
          return "failed";
        }
      }
      if (pendingStatus === "unavailable") {
        update({ error: pendingUnavailableError() });
        return "failed";
      }
      const sameReceipt =
        current.receiptId === receiptId && current.resource !== null;
      if (
        !sameReceipt &&
        current.formDirty &&
        current.receiptId !== receiptId &&
        !options?.force
      ) {
        return "needs-confirmation";
      }
      if (!sameReceipt && current.confirmOperation) {
        update({ error: pendingGuardError() });
        return "failed";
      }
      if (sameReceipt && current.confirmOperation) {
        return "loaded";
      }
      const controller = newOperation();
      stopMonitor();
      if (sameReceipt) {
        update({ phase: "loading", error: null, confirmOperation: null });
      } else {
        update({
          ...INITIAL_STATE,
          ownerId: owner,
          phase: "loading",
        });
      }
      try {
        const resource = await getReceipt(receiptId, { signal: controller.signal });
        if (!isCurrentOperation(controller) || ownerRef.current !== owner) {
          return "failed";
        }
        applyResource(resource, { resetImage: true });
        if (resource.status === "processing") {
          update({ phase: "monitoring", error: null });
          monitorReceipt(receiptId);
        }
        void refreshImageUrl();
        return "loaded";
      } catch (error) {
        if (
          !isCurrentOperation(controller) ||
          ownerRef.current !== owner ||
          errorCode(error) === "ABORTED"
        ) {
          return "failed";
        }
        update({
          phase: "failed",
          error: toStageError({
            stage: "loading",
            error,
            fallback: "We could not load that receipt.",
          }),
        });
        return "failed";
      }
    },
    [
      applyResource,
      invalidateFor,
      isCurrentOperation,
      monitorReceipt,
      newOperation,
      refreshImageUrl,
      restorePendingForOwner,
      stopMonitor,
      update,
    ],
  );

  const applyServerValues = useCallback(() => {
    const current = stateRef.current;
    const pendingError = pendingBlockError(current.pendingConfirmStatus);
    if (pendingError || current.confirmOperation) {
      update({ error: pendingError ?? pendingGuardError() });
      return;
    }
    if (!current.resource) {
      update({ error: null });
      return;
    }
    update({
      form: formFromResource(current.resource),
      formDirty: false,
      error: null,
      phase: phaseForResource(current.resource),
    });
  }, [update]);

  const clearError = useCallback(() => {
    update({ error: null });
  }, [update]);

  // Account scoping: switching or losing the account drops every byte of
  // receipt state so one user's draft/photo can never leak into another's.
  const previousOwnerRef = useRef<string | null>(userId);
  useEffect(() => {
    ownerRef.current = userId;
    if (previousOwnerRef.current !== userId) {
      previousOwnerRef.current = userId;
      resetFlow(userId);
    }
  }, [resetFlow, userId]);

  useEffect(() => {
    if (userId) {
      void restorePendingForOwner(userId);
    }
  }, [restorePendingForOwner, userId]);

  useEffect(() => {
    return onSessionInvalidated(() => {
      resetFlow(null);
    });
  }, [onSessionInvalidated, resetFlow]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next) => {
      if (next !== "active") {
        return;
      }
      const current = stateRef.current;
      if (current.phase === "monitoring") {
        void refreshStatus();
      } else if (current.receiptId && current.resource?.status === "ready") {
        void refreshImageUrl();
      }
    });
    return () => subscription.remove();
  }, [refreshImageUrl, refreshStatus]);

  useEffect(() => {
    return () => {
      abortActive();
      stopMonitor();
    };
  }, [abortActive, stopMonitor]);

  const validation = useMemo(
    () => (state.form ? validateReceiptForm(state.form) : null),
    [state.form],
  );

  const value = useMemo<ReceiptContextValue>(() => {
    const isBusy =
      state.phase === "normalizing" ||
      state.phase === "allocating" ||
      state.phase === "uploading" ||
      state.phase === "parsing" ||
      state.phase === "loading" ||
      state.phase === "confirming";
    const serverStatus = state.resource?.status ?? null;
    const targetMatches =
      state.receiptId === null
        ? state.resource === null
        : state.resource !== null &&
          state.resource.id === state.receiptId &&
          state.version !== null &&
          (serverStatus === "ready" || serverStatus === "failed");
    const frozenMatches =
      state.confirmOperation === null ||
      (state.form !== null &&
        fingerprintConfirmBody(
          buildReceiptConfirmBody({
            form: state.form,
            receiptId: state.receiptId ?? undefined,
            expectedVersion: state.version ?? undefined,
          }),
        ) === state.confirmOperation.fingerprint);
    const pendingAllows =
      state.pendingConfirmStatus === "none" ||
      (state.pendingConfirmStatus === "retryable" &&
        state.confirmOperation !== null);
    const canConfirm =
      state.form !== null &&
      validation?.valid === true &&
      (state.phase === "ready" || state.phase === "failed") &&
      targetMatches &&
      frozenMatches &&
      pendingAllows;
    const canSaveDraft =
      state.form !== null &&
      state.receiptId !== null &&
      state.version !== null &&
      state.resource?.id === state.receiptId &&
      serverStatus === "ready" &&
      state.phase === "ready" &&
      validation?.valid === true &&
      state.confirmOperation === null &&
      state.pendingConfirmStatus === "none";
    return {
      phase: state.phase,
      image: state.image,
      imageUri: state.imageUri,
      imageUrl: state.imageUrl,
      imageUrlExpiresAt: state.imageUrlExpiresAt,
      receiptId: state.receiptId,
      version: state.version,
      resource: state.resource,
      form: state.form,
      formDirty: state.formDirty,
      error: state.error,
      confirmedReceipt: state.confirmedReceipt,
      isExample: state.isExample,
      isBusy,
      hasUnsavedWork: state.formDirty || (state.form !== null && state.receiptId === null),
      hasActiveWork: hasActiveWork(state),
      canEdit: canEditNow(state),
      canConfirm,
      canSaveDraft,
      confirmFrozen: state.confirmOperation !== null,
      pendingConfirmStatus: state.pendingConfirmStatus,
      validation,
      startFromPickerAsset,
      loadExample,
      resetReceipt,
      discardPendingConfirmation,
      updateForm,
      updateFormItem,
      addItem,
      removeItem,
      selectFoodMatch,
      clearFoodMatch,
      saveDraft,
      confirm,
      retryUpload,
      retryParse,
      reopenReceipt,
      refreshStatus,
      refreshImageUrl,
      applyServerValues,
      clearError,
    };
  }, [
    addItem,
    applyServerValues,
    canEditNow,
    clearError,
    confirm,
    discardPendingConfirmation,
    loadExample,
    refreshImageUrl,
    refreshStatus,
    removeItem,
    reopenReceipt,
    resetReceipt,
    retryParse,
    retryUpload,
    saveDraft,
    selectFoodMatch,
    clearFoodMatch,
    startFromPickerAsset,
    state,
    updateForm,
    updateFormItem,
    validation,
  ]);

  return <ReceiptContext.Provider value={value}>{children}</ReceiptContext.Provider>;
}

export function useReceipt(): ReceiptContextValue {
  const context = useContext(ReceiptContext);
  if (!context) {
    throw new Error("useReceipt must be used within ReceiptProvider.");
  }
  return context;
}
