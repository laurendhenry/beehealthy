import { useEffect, useRef, useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { Alert, Image, Pressable, StyleSheet, Text, View } from "react-native";

import { colors } from "../constants/app-theme";
import { useReceipt } from "../context/ReceiptContext";
import { searchFoods, type FoodMatch } from "../lib/api/discovery";
import { formatCents, warningCopy } from "../lib/receipt-workflow";
import {
  ReceiptButton,
  ReceiptCard,
  ReceiptField,
  ReceiptPage,
  ui,
} from "../components/receipt/ReceiptUI";
import { PendingConfirmRecovery } from "../components/receipt/PendingConfirmRecovery";

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
    isExample,
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
  const [matchForKey, setMatchForKey] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<FoodMatch[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const requestedRef = useRef<string | null>(null);
  const searchSeq = useRef(0);

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

  // Signed image URLs are short lived: refresh when the screen opens.
  useEffect(() => {
    void refreshImageUrl();
  }, [receiptId, refreshImageUrl]);

  const isConfirmed = confirmedReceipt !== null && phase === "confirmed";
  const previewUri = imageUri ?? imageUrl;
  const signedImageFailed = previewUri === null && receiptId !== null && !isConfirmed;
  const serverDraft = resource?.draft ?? confirmedReceipt?.draft ?? null;
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

  async function runSearch() {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setSearchError("Type at least two characters to search foods.");
      return;
    }
    const sequence = ++searchSeq.current;
    setSearching(true);
    setSearchError(null);
    try {
      const matches = await searchFoods(trimmed, { limit: 8 });
      if (searchSeq.current === sequence) {
        setResults(matches);
        if (matches.length === 0) {
          setSearchError("No matching foods found. You can keep the item unmatched.");
        }
      }
    } catch {
      if (searchSeq.current === sequence) {
        setResults([]);
        setSearchError("Food search is unavailable right now. You can keep the item unmatched.");
      }
    } finally {
      if (searchSeq.current === sequence) {
        setSearching(false);
      }
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
        Alert.alert(
          "Changes saved",
          "Your edits are stored on the backend and will be here if you reopen this receipt.",
        );
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
    // No navigation here: the confirmed view below only renders after the
    // server returns a confirmed receipt.
    await confirm();
  }

  function removeItemWithConfirm(key: string) {
    Alert.alert("Remove item?", "You can add it again if needed.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: () => removeItem(key),
      },
    ]);
  }

  if (!form) {
    const loading = phase === "loading" || (routeReceiptId !== null && phase !== "failed");
    return (
      <ReceiptPage>
        <Pressable
          accessibilityRole="button"
          onPress={goBack}
          style={{ alignSelf: "flex-start" }}
        >
          <Text style={ui.link}>‹ Back</Text>
        </Pressable>

        <PendingConfirmRecovery />
        <Text style={ui.heading}>{loading ? "Loading receipt…" : "No receipt to review"}</Text>
        <Text style={ui.subtitle}>
          {loading
            ? "Fetching the saved receipt and a fresh image link from the backend."
            : "Scan a receipt or load the example first. Saved receipts stay available in history."}
        </Text>

        {error ? (
          <ReceiptCard>
            <Text style={ui.title}>Something needs attention</Text>
            <Text style={ui.text}>{error.message}</Text>
            {error.code ? <Text style={ui.muted}>Reference: {error.code}</Text> : null}
            {receiptId ? (
              <ReceiptButton title="Check again" secondary onPress={() => void refreshStatus()} />
            ) : null}
          </ReceiptCard>
        ) : null}

        {!loading ? (
          <ReceiptButton title="Go to Scan" onPress={() => router.replace("/scan")} />
        ) : null}
      </ReceiptPage>
    );
  }

  const issues = validation?.issues ?? [];

  return (
    <ReceiptPage>
      <Pressable
        accessibilityRole="button"
        onPress={goBack}
        style={{ alignSelf: "flex-start" }}
      >
        <Text style={ui.link}>‹ Back</Text>
      </Pressable>

      <View>
        <Text style={ui.heading}>{isConfirmed ? "Receipt confirmed" : "Review your receipt"}</Text>
        <Text style={ui.subtitle}>
          {isConfirmed
            ? "This receipt is stored on your account and is read-only."
            : "Correct anything that doesn’t look right, then save it to your account."}
        </Text>
      </View>

      {isExample && !isConfirmed ? (
        <Text style={ui.muted}>
          Example data, entered manually — no photo was uploaded. Nothing is saved until you confirm,
          and confirmation still goes through the real backend.
        </Text>
      ) : null}

      {error ? (
        <ReceiptCard>
          <Text style={ui.title}>Something needs attention</Text>
          <Text style={ui.text}>{error.message}</Text>
          {error.issues?.length ? (
            <Text style={ui.muted}>{error.issues.map((issue) => issue.message).join(" ")}</Text>
          ) : null}
          {error.code ? <Text style={ui.muted}>Reference: {error.code}</Text> : null}
          <View style={styles.actionRow}>
            {error.conflict ? (
              <ReceiptButton
                title="Use server values"
                secondary
                onPress={applyServerValues}
              />
            ) : null}
            {error.conflict ? (
              <ReceiptButton title="Keep my edits" secondary onPress={clearError} />
            ) : null}
            {!isConfirmed && receiptId && phase === "failed" && error.stage !== "confirming" ? (
              <ReceiptButton title="Retry reading" onPress={() => void retryParse()} />
            ) : null}
          </View>
        </ReceiptCard>
      ) : null}

      <PendingConfirmRecovery />
      {confirmFrozen ? (
        <ReceiptCard>
          <Text style={ui.title}>Confirmation not confirmed yet</Text>
          <Text style={ui.muted}>
            The last attempt could not reach the server, so it may already have gone through. Keep the
            details unchanged and retry — this reuses the same idempotency key instead of creating a
            duplicate.
          </Text>
        </ReceiptCard>
      ) : null}

      {previewUri ? (
        <ReceiptCard>
          <Text style={ui.title}>
            {imageUri ? "Original receipt" : "Receipt image"}
          </Text>
          <Image
            source={{ uri: previewUri }}
            style={{ width: "100%", height: 240 }}
            resizeMode="contain"
            accessibilityLabel="Receipt photo"
          />
          {imageUrl && !imageUri ? (
            <Text style={ui.muted}>Secure image link from the backend. It expires, but the receipt stays.</Text>
          ) : null}
        </ReceiptCard>
      ) : signedImageFailed ? (
        <ReceiptCard>
          <Text style={ui.title}>Receipt image</Text>
          <Text style={ui.muted}>
            The photo link is unavailable right now. Your receipt details below are loaded from the
            backend.
          </Text>
          <ReceiptButton title="Reload image" secondary onPress={() => void refreshImageUrl()} />
        </ReceiptCard>
      ) : null}

      {isConfirmed && confirmedReceipt ? (
        <ReceiptCard>
          <View style={ui.row}>
            <Text style={ui.title}>{confirmedReceipt.draft.store}</Text>
            <Text style={ui.muted}>{confirmedReceipt.draft.date}</Text>
          </View>
          <View style={ui.row}>
            <Text style={ui.text}>Receipt total</Text>
            <Text style={ui.title}>${confirmedReceipt.draft.total}</Text>
          </View>
          {confirmedReceipt.draft.items.map((item, index) => (
            <View key={item.id} style={ui.row}>
              <Text style={[ui.text, { flex: 1 }]}>
                {index + 1}. {item.name}
              </Text>
              <Text style={ui.muted}>Qty {item.quantity}</Text>
              <Text style={ui.text}>${item.lineTotal}</Text>
            </View>
          ))}
          {confirmedReceipt.warnings.map((warning) => (
            <Text key={warning} style={ui.muted}>
              {warningCopy(warning)}
            </Text>
          ))}
          <Text style={ui.muted}>
            {isExample
              ? "Example receipt saved to your account through the backend. No photo was uploaded."
              : "Saved to your account through the backend. Your pantry was updated from these items."}
          </Text>
          <Text style={ui.muted}>Receipt reference: {confirmedReceipt.id}</Text>
          <ReceiptButton
            title="Start another receipt"
            onPress={() => {
              void (async () => {
                if (await resetReceipt()) router.replace("/scan");
              })();
            }}
          />
        </ReceiptCard>
      ) : (
        <>
          {serverDraft && resource?.status === "ready" ? (
            <Text style={ui.muted}>
              {formDirty ? "Unsaved changes" : "Saved to your account"} · version {version ?? "—"}
            </Text>
          ) : (
            <Text style={ui.muted}>
              {receiptId
                ? "Not saved as a draft yet — confirm to store it on your account."
                : isExample
                  ? "Manual example — nothing is saved until you confirm."
                  : "This receipt is not saved until you confirm."}
            </Text>
          )}

          <ReceiptCard>
            <Text style={ui.title}>Receipt details</Text>

            <ReceiptField
              label="Store"
              value={form.store}
              editable={canEdit}
              placeholder="Store name"
              onChangeText={(store) => updateForm({ store })}
            />

            <ReceiptField
              label="Date · YYYY-MM-DD"
              placeholder="2026-10-06"
              value={form.date}
              editable={canEdit}
              autoCapitalize="none"
              onChangeText={(date) => updateForm({ date })}
            />

            <ReceiptField
              label="Receipt total ($)"
              value={form.total}
              editable={canEdit}
              keyboardType="decimal-pad"
              onChangeText={(total) => updateForm({ total })}
            />
          </ReceiptCard>

          <View style={ui.row}>
            <Text style={ui.title}>Items ({form.items.length})</Text>
            <Text style={ui.muted}>{canEdit ? "Edit before confirming" : "Read-only"}</Text>
          </View>

          {form.items.map((item, index) => (
            <ReceiptCard key={item.key}>
              <View style={ui.row}>
                <Text style={ui.title}>Item {index + 1}</Text>

                <View style={styles.itemActions}>
                  <View style={[ui.badge, item.matchStatus === "check" && styles.checkBadge]}>
                    <Text style={ui.badgeText}>
                      {item.foodId ? "Matched" : "Needs check"}
                    </Text>
                  </View>

                  {canEdit && form.items.length > 1 ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${item.name || "item"}`}
                      onPress={() => removeItemWithConfirm(item.key)}
                    >
                      <Text style={ui.link}>Remove</Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>

              {item.matchStatus === "check" && !item.foodId ? (
                <Text style={ui.muted}>
                  A parsed match is not available for this item. Link it to a food below or leave it
                  unmatched.
                </Text>
              ) : null}

              <ReceiptField
                label="Item name"
                value={item.name}
                editable={canEdit}
                placeholder="Enter item name"
                onChangeText={(name) => updateFormItem(item.key, { name })}
              />

              <View style={ui.row}>
                <ReceiptField
                  label="Quantity"
                  value={item.quantity}
                  editable={canEdit}
                  keyboardType="decimal-pad"
                  onChangeText={(quantity) => updateFormItem(item.key, { quantity })}
                />

                <ReceiptField
                  label="Line total ($)"
                  value={item.lineTotal}
                  editable={canEdit}
                  keyboardType="decimal-pad"
                  onChangeText={(lineTotal) => updateFormItem(item.key, { lineTotal })}
                />
              </View>

              {canEdit ? (
                matchForKey === item.key ? (
                  <View style={styles.matchPanel}>
                    <ReceiptField
                      label="Search foods"
                      value={query}
                      autoCapitalize="none"
                      placeholder="e.g. oat milk"
                      onChangeText={setQuery}
                    />
                    <View style={styles.actionRow}>
                      <ReceiptButton
                        title={searching ? "Searching…" : "Search"}
                        secondary
                        disabled={searching}
                        onPress={() => void runSearch()}
                      />
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => {
                          setMatchForKey(null);
                          setSearchError(null);
                        }}
                      >
                        <Text style={ui.link}>Cancel</Text>
                      </Pressable>
                    </View>
                    {searchError ? <Text style={ui.muted}>{searchError}</Text> : null}
                    {results.map((match) => (
                      <Pressable
                        key={match.id}
                        accessibilityRole="button"
                        onPress={() => {
                          selectFoodMatch(item.key, { id: match.id });
                          setMatchForKey(null);
                          setSearchError(null);
                        }}
                        style={styles.resultRow}
                      >
                        <Text style={ui.text}>{match.name}</Text>
                        <Text style={ui.muted}>{match.category}</Text>
                      </Pressable>
                    ))}
                  </View>
                ) : (
                  <View style={styles.actionRow}>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => {
                        setMatchForKey(item.key);
                        setQuery(item.name);
                        setResults([]);
                        setSearchError(null);
                      }}
                    >
                      <Text style={ui.link}>
                        {item.foodId ? "Change food match" : "Match to a food"}
                      </Text>
                    </Pressable>
                    {item.foodId ? (
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => clearFoodMatch(item.key)}
                      >
                        <Text style={ui.link}>Clear match</Text>
                      </Pressable>
                    ) : null}
                  </View>
                )
              ) : null}

              {item.foodId ? (
                <Text style={ui.muted}>
                  Linked to a backend food id. Editing the item name clears this match.
                </Text>
              ) : null}
            </ReceiptCard>
          ))}

          {canEdit ? (
            <ReceiptButton
              title="+ Add missing item"
              secondary
              disabled={form.items.length >= 200}
              onPress={addItem}
            />
          ) : null}

          {resource?.warnings.length ? (
            <ReceiptCard>
              <Text style={ui.title}>Backend warnings</Text>
              {resource.warnings.map((warning) => (
                <Text key={warning} style={ui.muted}>
                  {warningCopy(warning)}
                </Text>
              ))}
            </ReceiptCard>
          ) : null}

          <ReceiptCard>
            <View style={ui.row}>
              <Text style={ui.text}>Entered item totals</Text>
              <Text style={ui.title}>${itemsTotal ?? "—"}</Text>
            </View>

            <Text style={ui.muted}>
              Line total means the full amount paid for that row. Receipt totals may also include
              taxes, discounts, or fees; those are never reconciled automatically.
            </Text>
            {validation?.mismatch ? (
              <Text style={ui.muted}>{warningCopy("TOTAL_MISMATCH")}</Text>
            ) : null}
          </ReceiptCard>

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

          <View style={styles.actionRow}>
            {receiptId && resource?.status === "ready" ? (
              <ReceiptButton
                title={saving ? "Saving…" : "Save changes"}
                secondary
                disabled={!canSaveDraft || !formDirty || saving || phase === "confirming"}
                onPress={() => void handleSave()}
              />
            ) : null}
            <ReceiptButton
              title={
                phase === "confirming"
                  ? "Saving receipt…"
                  : confirmFrozen
                    ? "Retry confirmation"
                    : receiptId
                      ? "Confirm & save to account"
                      : "Save receipt to account"
              }
              disabled={!canConfirm || saving || phase === "confirming"}
              onPress={() => void handleConfirm()}
            />
          </View>

          <Text
            style={[ui.muted, { textAlign: "center", color: colors.primary }]}
          >
            {receiptId
              ? "Confirmation checks the receipt version on the server. If it changed elsewhere, your edits stay here and the conflict is shown above."
              : "Confirmation creates the saved receipt on the backend and updates your pantry."}
          </Text>
        </>
      )}
    </ReceiptPage>
  );
}

const styles = StyleSheet.create({
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
  },
  itemActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  checkBadge: {
    backgroundColor: "#F2E8D8",
  },
  matchPanel: {
    gap: 8,
  },
  resultRow: {
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    gap: 2,
  },
});
