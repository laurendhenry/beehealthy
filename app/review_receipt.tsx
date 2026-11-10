import { useEffect, useRef, useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Lucide } from "@react-native-vector-icons/lucide";

import { colors } from "../constants/app-theme";
import { useReceipt } from "../context/ReceiptContext";
import { receiptDetailHref } from "../lib/api/receipt-history";
import {
  formatCents,
  itemNeedsCheck,
  nextItemNeedingCheck,
  warningCopy,
} from "../lib/receipt-workflow";
import {
  ReceiptButton,
  ReceiptCard,
  ReceiptField,
  ReceiptPage,
  ui,
} from "../components/receipt/ReceiptUI";
import { PendingConfirmRecovery } from "../components/receipt/PendingConfirmRecovery";
import { ItemEditor } from "../components/review/ItemEditor";
import { ItemRow } from "../components/review/ItemRow";

export default function ReviewReceiptScreen() {
  const params = useLocalSearchParams<{ receiptId?: string }>();
  const routeReceiptId =
    typeof params.receiptId === "string" && params.receiptId.length > 0
      ? params.receiptId
      : null;

  const {
    phase,
    imageUri,
    imageUrl,
    receiptId,
    version,
    resource,
    form,
    formDirty,
    error,
    confirmedReceipt,
    canEdit,
    canConfirm,
    canSaveDraft,
    confirmFrozen,
    validation,
    reopenReceipt,
    refreshImageUrl,
    refreshStatus,
    retryParse,
    saveDraft,
    confirm,
    updateForm,
    updateFormItem,
    addItem,
    removeItem,
    selectFoodMatch,
    clearFoodMatch,
    applyServerValues,
    clearError,
    resetReceipt,
  } = useReceipt();

  const [saving, setSaving] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [showPhoto, setShowPhoto] = useState(false);
  const requestedRef = useRef<string | null>(null);

  // Load the persisted receipt named by the route, independent of whatever
  // flow happens to be live in this session.
  useEffect(() => {
    if (!routeReceiptId || receiptId === routeReceiptId) {
      return;
    }
    if (requestedRef.current === routeReceiptId) {
      return;
    }
    requestedRef.current = routeReceiptId;
    void (async () => {
      const result = await reopenReceipt(routeReceiptId);
      if (result === "needs-confirmation") {
        Alert.alert(
          "Discard unsaved changes?",
          "Opening this receipt replaces unsaved edits on the current one. Saved receipts are not affected.",
          [
            {
              text: "Cancel",
              style: "cancel",
              onPress: () => router.back(),
            },
            {
              text: "Discard changes",
              style: "destructive",
              onPress: () => {
                void reopenReceipt(routeReceiptId, { force: true });
              },
            },
          ],
        );
      }
    })();
  }, [receiptId, reopenReceipt, routeReceiptId]);

  // A confirmed flow is finished once the person leaves this screen, so the
  // Scan tab never shows the saved receipt as a stale draft.
  const leaveRef = useRef({ phase, resetReceipt });
  useEffect(() => {
    leaveRef.current = { phase, resetReceipt };
  }, [phase, resetReceipt]);
  useEffect(
    () => () => {
      const latest = leaveRef.current;
      if (latest.phase === "confirmed") {
        void latest.resetReceipt();
      }
    },
    [],
  );

  // Signed image URLs are short lived: refresh when the screen opens.
  useEffect(() => {
    void refreshImageUrl();
  }, [receiptId, refreshImageUrl]);

  const isConfirmed = confirmedReceipt !== null && phase === "confirmed";
  const previewUri = imageUri ?? imageUrl;
  const signedImageFailed = previewUri === null && receiptId !== null && !isConfirmed;
  const itemsTotal =
    validation?.lineTotalCents !== null && validation?.lineTotalCents !== undefined
      ? formatCents(validation.lineTotalCents)
      : null;

  function goBack() {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/scan");
    }
  }

  async function handleSave() {
    setAttempted(true);
    if (!canSaveDraft || saving) {
      return;
    }
    setSaving(true);
    try {
      const outcome = await saveDraft();
      if (outcome.status === "saved") {
        Alert.alert("Changes saved", "Your edits are saved and will be here if you reopen this receipt.");
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleConfirm() {
    setAttempted(true);
    if (!canConfirm || phase === "confirming") {
      return;
    }
    // No navigation here: the confirmed view only renders after the server
    // returns a confirmed receipt.
    await confirm();
  }

  function removeWithConfirm(key: string) {
    Alert.alert("Remove this line?", "You can add it again if needed.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: () => {
          setEditingKey(null);
          removeItem(key);
        },
      },
    ]);
  }

  const errorCard = error ? (
    <ReceiptCard>
      <Text style={ui.title}>Something needs attention</Text>
      <Text style={ui.text}>{error.message}</Text>
      {error.issues?.length ? (
        <Text style={ui.muted}>{error.issues.map((issue) => issue.message).join(" ")}</Text>
      ) : null}
      {error.code ? <Text style={ui.muted}>Reference: {error.code}</Text> : null}
      <View style={styles.actionRow}>
        {error.conflict ? (
          <ReceiptButton title="Use server values" secondary onPress={applyServerValues} />
        ) : null}
        {error.conflict ? (
          <ReceiptButton title="Keep my edits" secondary onPress={clearError} />
        ) : null}
        {!isConfirmed && receiptId && phase === "failed" && error.stage !== "confirming" ? (
          <ReceiptButton title="Retry reading" onPress={() => void retryParse()} />
        ) : null}
        {!form && receiptId ? (
          <ReceiptButton title="Check again" secondary onPress={() => void refreshStatus()} />
        ) : null}
      </View>
    </ReceiptCard>
  ) : null;

  const backLink = (
    <Pressable accessibilityRole="button" onPress={goBack} style={styles.back}>
      <Text style={ui.link}>‹ Back</Text>
    </Pressable>
  );

  if (!form) {
    const loading = phase === "loading" || (routeReceiptId !== null && phase !== "failed");
    return (
      <ReceiptPage>
        {backLink}
        <PendingConfirmRecovery />
        <Text style={ui.heading}>{loading ? "Loading receipt…" : "No receipt to review"}</Text>
        <Text style={ui.subtitle}>
          {loading
            ? "Fetching your saved receipt."
            : "Scan a receipt first. Saved receipts stay available in history."}
        </Text>
        {errorCard}
        {!loading ? (
          <ReceiptButton title="Go to Scan" onPress={() => router.replace("/scan")} />
        ) : null}
      </ReceiptPage>
    );
  }

  if (isConfirmed && confirmedReceipt) {
    return (
      <ReceiptPage>
        {backLink}
        <View style={styles.successHeader}>
          <Lucide name="circle-check" size={40} color={colors.primary} />
          <Text style={ui.heading}>Receipt saved</Text>
          <Text style={ui.subtitle}>Your pantry was updated from these items.</Text>
        </View>
        <ReceiptCard>
          <View style={ui.row}>
            <Text style={ui.title}>{confirmedReceipt.draft.store}</Text>
            <Text style={ui.muted}>{confirmedReceipt.draft.date}</Text>
          </View>
          <View style={ui.row}>
            <Text style={ui.text}>
              {confirmedReceipt.draft.items.length}{" "}
              {confirmedReceipt.draft.items.length === 1 ? "item" : "items"}
            </Text>
            <Text style={ui.title}>${confirmedReceipt.draft.total}</Text>
          </View>
          {confirmedReceipt.warnings.map((warning) => (
            <Text key={warning} style={ui.muted}>
              {warningCopy(warning)}
            </Text>
          ))}
          <Text style={ui.muted}>
            Healthier swap ideas for these groceries appear in Swaps after a few minutes.
          </Text>
        </ReceiptCard>
        <View style={styles.actionRow}>
          <ReceiptButton
            title="View receipt"
            secondary
            onPress={() => {
              const id = confirmedReceipt.id;
              void (async () => {
                if (await resetReceipt()) router.dismissTo(receiptDetailHref(id));
              })();
            }}
          />
          <ReceiptButton
            title="Scan another"
            onPress={() => {
              void (async () => {
                if (await resetReceipt()) router.dismissTo("/scan");
              })();
            }}
          />
        </View>
      </ReceiptPage>
    );
  }

  const issues = validation?.issues ?? [];
  const toCheck = form.items.filter(itemNeedsCheck);
  const editingItem = form.items.find((item) => item.key === editingKey) ?? null;
  const nextToCheck = nextItemNeedingCheck(form.items, editingKey);
  const isReadyDraft = receiptId !== null && resource?.status === "ready";

  let saveNote = "Not saved until you confirm.";
  if (isReadyDraft) {
    saveNote = formDirty ? "Unsaved changes" : `Draft saved · version ${version ?? "—"}`;
  }

  return (
    <SafeAreaView style={ui.page} edges={["top", "left", "right", "bottom"]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={ui.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {backLink}

          <View>
            <Text style={ui.heading}>Review receipt</Text>
            <Text style={ui.subtitle}>{saveNote}</Text>
          </View>

          {errorCard}
          <PendingConfirmRecovery />
          {confirmFrozen ? (
            <ReceiptCard>
              <Text style={ui.title}>Confirmation not confirmed yet</Text>
              <Text style={ui.muted}>
                The last attempt could not reach the server, so it may already have gone through.
                Keep the details unchanged and retry — this reuses the same request instead of
                creating a duplicate.
              </Text>
            </ReceiptCard>
          ) : null}

          <ReceiptCard>
            <ReceiptField
              label="Store"
              value={form.store}
              editable={canEdit}
              placeholder="Store name"
              onChangeText={(store) => updateForm({ store })}
            />
            <View style={ui.row}>
              <ReceiptField
                label="Date · YYYY-MM-DD"
                placeholder="2026-10-06"
                value={form.date}
                editable={canEdit}
                autoCapitalize="none"
                onChangeText={(date) => updateForm({ date })}
              />
              <ReceiptField
                label="Total ($)"
                value={form.total}
                editable={canEdit}
                keyboardType="decimal-pad"
                onChangeText={(total) => updateForm({ total })}
              />
            </View>
            {previewUri ? (
              <Pressable accessibilityRole="button" onPress={() => setShowPhoto((shown) => !shown)}>
                <Text style={ui.link}>{showPhoto ? "Hide receipt photo" : "Show receipt photo"}</Text>
              </Pressable>
            ) : signedImageFailed ? (
              <Pressable accessibilityRole="button" onPress={() => void refreshImageUrl()}>
                <Text style={ui.link}>Reload receipt photo</Text>
              </Pressable>
            ) : null}
            {previewUri && showPhoto ? (
              <Image
                source={{ uri: previewUri }}
                style={styles.photo}
                resizeMode="contain"
                accessibilityLabel="Receipt photo"
              />
            ) : null}
          </ReceiptCard>

          {canEdit ? (
            toCheck.length > 0 ? (
              <View style={styles.summary}>
                <Lucide name="circle-help" size={20} color="#7A5A24" />
                <Text style={[ui.text, styles.flex]}>
                  {toCheck.length} {toCheck.length === 1 ? "item needs" : "items need"} a check
                </Text>
                <ReceiptButton
                  title="Review next"
                  onPress={() => setEditingKey(nextItemNeedingCheck(form.items, null)?.key ?? null)}
                />
              </View>
            ) : (
              <View style={[styles.summary, styles.summaryDone]}>
                <Lucide name="circle-check" size={20} color={colors.primary} />
                <Text style={[ui.text, styles.flex]}>All items look good</Text>
              </View>
            )
          ) : null}

          <ReceiptCard>
            <View style={ui.row}>
              <Text style={ui.title}>Items ({form.items.length})</Text>
              {canEdit ? <Text style={ui.muted}>Tap an item to edit</Text> : null}
            </View>
            <View>
              {form.items.map((item) => (
                <ItemRow key={item.key} item={item} onPress={() => setEditingKey(item.key)} />
              ))}
            </View>
            {canEdit ? (
              <Pressable
                accessibilityRole="button"
                disabled={form.items.length >= 200}
                onPress={addItem}
              >
                <Text style={ui.link}>+ Add missing item</Text>
              </Pressable>
            ) : null}
          </ReceiptCard>

          {resource?.warnings.length ? (
            <ReceiptCard>
              {resource.warnings.map((warning) => (
                <Text key={warning} style={ui.muted}>
                  {warningCopy(warning)}
                </Text>
              ))}
            </ReceiptCard>
          ) : null}

          {attempted && issues.length > 0 ? (
            <ReceiptCard>
              <Text style={ui.title}>Check these fields</Text>
              {issues.map((issue) => (
                <Text key={`${issue.path}:${issue.message}`} style={ui.muted}>
                  {issue.message}
                </Text>
              ))}
            </ReceiptCard>
          ) : null}
        </ScrollView>

        <View style={styles.bar}>
          {validation?.mismatch ? (
            <View style={styles.mismatch}>
              <Lucide name="triangle-alert" size={14} color="#7A5A24" />
              <Text style={[ui.muted, styles.flex]}>
                Items add up to ${itemsTotal ?? "—"}, receipt total is ${form.total || "—"}. Taxes,
                fees or discounts can explain the difference.
              </Text>
            </View>
          ) : null}
          <View style={styles.barActions}>
            {isReadyDraft ? (
              <ReceiptButton
                title={saving ? "Saving…" : "Save draft"}
                secondary
                disabled={!canSaveDraft || !formDirty || saving || phase === "confirming"}
                onPress={() => void handleSave()}
              />
            ) : null}
            <View style={styles.flex}>
              <ReceiptButton
                title={
                  phase === "confirming"
                    ? "Saving receipt…"
                    : confirmFrozen
                      ? "Retry confirmation"
                      : "Confirm & add to pantry"
                }
                disabled={!canConfirm || saving || phase === "confirming"}
                onPress={() => void handleConfirm()}
              />
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>

      <ItemEditor
        item={editingItem}
        canEdit={canEdit}
        canRemove={form.items.length > 1}
        hasNext={canEdit && nextToCheck !== null}
        onChange={(patch) => editingItem && updateFormItem(editingItem.key, patch)}
        onSelectFood={(food) => editingItem && selectFoodMatch(editingItem.key, food)}
        onConfirmFood={() =>
          editingItem?.foodId && selectFoodMatch(editingItem.key, { id: editingItem.foodId })
        }
        onClearFood={() => editingItem && clearFoodMatch(editingItem.key)}
        onRemove={() => editingItem && removeWithConfirm(editingItem.key)}
        onNext={() => setEditingKey(nextToCheck?.key ?? null)}
        onClose={() => setEditingKey(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  back: {
    alignSelf: "flex-start",
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
  },
  successHeader: {
    alignItems: "flex-start",
    gap: 8,
  },
  photo: {
    width: "100%",
    height: 320,
  },
  summary: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 20,
    paddingVertical: 10,
    paddingLeft: 16,
    paddingRight: 10,
    backgroundColor: "#F2E8D8",
  },
  summaryDone: {
    backgroundColor: colors.paleGreen,
    paddingVertical: 14,
  },
  bar: {
    gap: 8,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  mismatch: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
  },
  barActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
});
