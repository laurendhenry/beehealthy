/**
 * Pantry screen: available pantry rows with cursor pagination, per-row
 * consume (all or decimal-string quantity), edit (absolute-quantity PATCH),
 * and remove. Pull-to-refresh resets the cursor chain.
 *
 * Quantity input/output stays a decimal string (up to 3 decimals) — never
 * grams/servings/intake inference. Unknown-timeout outcomes reconcile via
 * refetch without auto-replaying the mutation.
 */

import { useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  usePantry,
  type PantryRowState,
} from "../hooks/usePantry";
import { colors, radii } from "../constants/app-theme";

export default function PantryScreen() {
  const pantry = usePantry();
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [consumeQty, setConsumeQty] = useState<Record<string, string>>({});
  const [editQty, setEditQty] = useState("");
  const [editExpiresAt, setEditExpiresAt] = useState("");

  const startEditing = (row: PantryRowState) => {
    setEditingId(row.item.id);
    setEditQty(row.item.quantityRemaining);
    setEditExpiresAt(row.item.expiresAt ?? "");
  };

  const saveEdit = async (row: PantryRowState) => {
    const patch = {
      ...(editQty !== row.item.quantityRemaining
        ? { quantity: editQty.trim() }
        : {}),
      ...(editExpiresAt.trim() !== (row.item.expiresAt ?? "")
        ? {
            expires_at:
              editExpiresAt.trim() === "" ? null : editExpiresAt.trim(),
          }
        : {}),
    };
    if (Object.keys(patch).length === 0) {
      setEditingId(null);
      return;
    }
    const ok = await pantry.saveEdits(row.item.id, patch);
    if (ok) setEditingId(null);
  };

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/(tabs)");
    }
  };

  return (
    <SafeAreaView
      style={styles.safeArea}
      edges={["top", "left", "right"]}
      testID="pantry-screen"
    >
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <FlatList
          keyboardShouldPersistTaps="handled"
          data={pantry.rows}
          keyExtractor={(row) => row.item.id}
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl
              refreshing={pantry.refreshing}
              onRefresh={pantry.refresh}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
          onEndReached={pantry.loadMore}
          onEndReachedThreshold={0.5}
          ListHeaderComponent={
            <View style={styles.header}>
              <View style={styles.topRow}>
                <View style={styles.brandRow}>
                  <View style={styles.brandMark}>
                    <Text style={styles.brandIcon}>♧</Text>
                  </View>
                  <Text style={styles.brandName}>sprout</Text>
                </View>
                <Pressable
                  onPress={handleBack}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel="Go back"
                >
                  <Text style={styles.backLink}>‹ Back</Text>
                </Pressable>
              </View>

              <Text style={styles.heading} accessibilityRole="header">
                Pantry
              </Text>
              <Text style={styles.subtitle}>
                What you have on hand, kept in sync.
              </Text>

              {pantry.error ? (
                <View style={styles.banner}>
                  <View style={styles.bannerTextWrap}>
                    <Text style={styles.bannerTitle}>Couldn&apos;t load pantry</Text>
                    <Text style={styles.error} role="alert">
                      {pantry.error}
                    </Text>
                  </View>
                  <Pressable
                    style={({ pressed }) => [
                      styles.smallButton,
                      pressed && styles.pressed,
                    ]}
                    onPress={pantry.retry}
                    accessibilityRole="button"
                    accessibilityLabel="Retry loading pantry"
                  >
                    <Text style={styles.smallButtonText}>Retry</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          }
          ListEmptyComponent={
            pantry.error ? null : pantry.loading ? (
              <View style={styles.loadingCard}>
                <ActivityIndicator
                  testID="pantry-loading"
                  color={colors.primary}
                />
                <Text style={styles.loadingText}>Loading your pantry…</Text>
              </View>
            ) : (
              <View style={styles.emptyCard}>
                <View style={styles.emptyMark}>
                  <Text style={styles.emptyIcon}>▤</Text>
                </View>
                <Text style={styles.emptyTitle}>Your pantry is empty.</Text>
                <Text style={styles.emptyBody}>
                  Items you confirm from receipts will show up here.
                </Text>
              </View>
            )
          }
          ListFooterComponent={
            pantry.loadingMore ? (
              <View style={styles.footer}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={styles.footerText}>Loading more…</Text>
              </View>
            ) : null
          }
          renderItem={({ item: row }) => {
            const isEditing = editingId === row.item.id;
            return (
              <View
                style={[styles.card, row.pending && styles.cardPending]}
                testID={`pantry-row-${row.item.id}`}
              >
                <View style={styles.cardTop}>
                  <View style={styles.itemMark}>
                    <Text style={styles.itemMarkText}>
                      {row.item.name.slice(0, 1).toUpperCase()}
                    </Text>
                  </View>
                  <View style={styles.itemInfo}>
                    <Text style={styles.name}>{row.item.name}</Text>
                    <View style={styles.metaRow}>
                      <View style={styles.qtyBadge}>
                        <Text style={styles.qtyBadgeText}>
                          Qty: {row.item.quantityRemaining}
                        </Text>
                      </View>
                      {row.item.expiresAt ? (
                        <Text style={styles.meta}>
                          Use by {row.item.expiresAt}
                        </Text>
                      ) : (
                        <Text style={styles.meta}>No use-by date</Text>
                      )}
                    </View>
                  </View>
                  {row.pending ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : null}
                </View>

                {row.error ? (
                  <View style={styles.rowErrorBanner}>
                    <Text style={styles.rowError} role="alert">
                      {row.error}
                    </Text>
                  </View>
                ) : null}

                {isEditing ? (
                  <View style={styles.editSection}>
                    <Text style={styles.label}>
                      Quantity (absolute, e.g. 1.500)
                    </Text>
                    <TextInput
                      style={styles.input}
                      value={editQty}
                      onChangeText={setEditQty}
                      keyboardType="decimal-pad"
                      editable={!row.pending}
                      placeholder="1.500"
                      placeholderTextColor={colors.muted}
                      selectionColor={colors.primary}
                      testID={`pantry-edit-qty-${row.item.id}`}
                    />
                    <Text style={styles.label}>
                      Use-by date (YYYY-MM-DD, blank clears)
                    </Text>
                    <TextInput
                      style={styles.input}
                      value={editExpiresAt}
                      onChangeText={setEditExpiresAt}
                      placeholder="YYYY-MM-DD"
                      placeholderTextColor={colors.muted}
                      selectionColor={colors.primary}
                      editable={!row.pending}
                      testID={`pantry-edit-expiry-${row.item.id}`}
                    />
                    <View style={styles.actionRow}>
                      <Pressable
                        style={({ pressed }) => [
                          styles.button,
                          styles.primaryButton,
                          row.pending && styles.disabled,
                          pressed && styles.pressed,
                        ]}
                        disabled={row.pending}
                        onPress={() => void saveEdit(row)}
                        accessibilityRole="button"
                        accessibilityLabel={`Save changes to ${row.item.name}`}
                      >
                        <Text style={styles.buttonText}>Save</Text>
                      </Pressable>
                      <Pressable
                        style={({ pressed }) => [
                          styles.button,
                          styles.secondary,
                          pressed && styles.pressed,
                        ]}
                        onPress={() => setEditingId(null)}
                        accessibilityRole="button"
                        accessibilityLabel="Cancel editing"
                      >
                        <Text style={[styles.buttonText, styles.secondaryText]}>
                          Cancel
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                ) : (
                  <View>
                    <View style={styles.consumeRow}>
                      <TextInput
                        style={[styles.input, styles.qtyInput]}
                        value={consumeQty[row.item.id] ?? ""}
                        onChangeText={(value) =>
                          setConsumeQty((current) => ({
                            ...current,
                            [row.item.id]: value,
                          }))
                        }
                        placeholder="0.500"
                        placeholderTextColor={colors.muted}
                        selectionColor={colors.primary}
                        keyboardType="decimal-pad"
                        editable={!row.pending}
                        testID={`pantry-consume-qty-${row.item.id}`}
                        accessibilityLabel={`Quantity to use up from ${row.item.name}`}
                      />
                      <Pressable
                        style={({ pressed }) => [
                          styles.button,
                          styles.primaryButton,
                          row.pending && styles.disabled,
                          pressed && styles.pressed,
                        ]}
                        disabled={row.pending}
                        onPress={() =>
                          void pantry.consumeQuantity(
                            row.item.id,
                            (consumeQty[row.item.id] ?? "").trim(),
                          )
                        }
                        accessibilityRole="button"
                        accessibilityLabel={`Use up quantity of ${row.item.name}`}
                      >
                        <Text style={styles.buttonText}>Use qty</Text>
                      </Pressable>
                    </View>
                    <View style={styles.actionRow}>
                      <Pressable
                        style={({ pressed }) => [
                          styles.button,
                          styles.secondary,
                          row.pending && styles.disabled,
                          pressed && styles.pressed,
                        ]}
                        disabled={row.pending}
                        onPress={() => void pantry.consumeAll(row.item.id)}
                        accessibilityRole="button"
                        accessibilityLabel={`Use up all of ${row.item.name}`}
                      >
                        <Text style={[styles.buttonText, styles.secondaryText]}>
                          Use all
                        </Text>
                      </Pressable>
                      <Pressable
                        style={({ pressed }) => [
                          styles.button,
                          styles.secondary,
                          row.pending && styles.disabled,
                          pressed && styles.pressed,
                        ]}
                        disabled={row.pending}
                        onPress={() => startEditing(row)}
                        accessibilityRole="button"
                        accessibilityLabel={`Edit ${row.item.name}`}
                      >
                        <Text style={[styles.buttonText, styles.secondaryText]}>
                          Edit
                        </Text>
                      </Pressable>
                      <Pressable
                        style={({ pressed }) => [
                          styles.button,
                          styles.danger,
                          row.pending && styles.disabled,
                          pressed && styles.pressed,
                        ]}
                        disabled={row.pending}
                        onPress={() => void pantry.remove(row.item.id)}
                        accessibilityRole="button"
                        accessibilityLabel={`Remove ${row.item.name}`}
                      >
                        <Text style={[styles.buttonText, styles.dangerText]}>
                          Remove
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                )}
              </View>
            );
          }}
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  flex: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 32,
  },
  header: {
    marginBottom: 18,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 24,
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  brandMark: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.paleGreen,
  },
  brandIcon: {
    fontSize: 19,
    lineHeight: 23,
    color: colors.primary,
  },
  brandName: {
    fontSize: 16,
    color: colors.primary,
    letterSpacing: -0.2,
  },
  backLink: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.primary,
  },
  heading: {
    fontSize: 32,
    lineHeight: 38,
    fontWeight: "700",
    letterSpacing: -0.7,
    color: colors.text,
  },
  subtitle: {
    marginTop: 6,
    fontSize: 14,
    lineHeight: 21,
    color: colors.muted,
  },
  banner: {
    marginTop: 16,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 18,
    backgroundColor: "#F7E8E3",
  },
  bannerTextWrap: {
    flex: 1,
    gap: 3,
  },
  bannerTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: "#8C3B2E",
  },
  error: {
    fontSize: 12,
    lineHeight: 18,
    color: "#8C3B2E",
  },
  smallButton: {
    minHeight: 48,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 24,
    backgroundColor: colors.surface,
  },
  smallButtonText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#8C3B2E",
  },
  card: {
    marginBottom: 12,
    padding: 18,
    borderRadius: radii.card,
    backgroundColor: colors.surface,
  },
  cardPending: {
    opacity: 0.78,
  },
  cardTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  itemMark: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.paleGreen,
  },
  itemMarkText: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.primary,
  },
  itemInfo: {
    flex: 1,
    gap: 6,
  },
  name: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: "600",
    color: colors.text,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
  },
  qtyBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    backgroundColor: colors.paleGreen,
  },
  qtyBadgeText: {
    fontSize: 11,
    fontWeight: "600",
    color: colors.primary,
  },
  meta: {
    fontSize: 12,
    lineHeight: 18,
    color: colors.muted,
  },
  rowErrorBanner: {
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: "#F7E8E3",
  },
  rowError: {
    fontSize: 12,
    lineHeight: 18,
    color: "#8C3B2E",
  },
  editSection: {
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: 6,
  },
  label: {
    marginTop: 4,
    fontSize: 10,
    fontWeight: "600",
    letterSpacing: 0.4,
    textTransform: "uppercase",
    color: colors.muted,
  },
  input: {
    minHeight: 46,
    paddingHorizontal: 13,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    backgroundColor: colors.background,
    color: colors.text,
    fontSize: 14,
  },
  qtyInput: {
    flex: 1,
  },
  consumeRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 14,
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 12,
  },
  button: {
    minHeight: 48,
    paddingHorizontal: 15,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 24,
  },
  primaryButton: {
    backgroundColor: colors.primary,
  },
  secondary: {
    backgroundColor: colors.paleGreen,
  },
  danger: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: "#E4C7BE",
  },
  buttonText: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.surface,
  },
  secondaryText: {
    color: colors.primary,
  },
  dangerText: {
    color: "#8C3B2E",
  },
  pressed: {
    opacity: 0.82,
  },
  disabled: {
    opacity: 0.45,
  },
  loadingCard: {
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    padding: 32,
    borderRadius: radii.card,
    backgroundColor: colors.surface,
  },
  loadingText: {
    fontSize: 13,
    color: colors.muted,
  },
  emptyCard: {
    alignItems: "center",
    paddingHorizontal: 24,
    paddingVertical: 32,
    borderRadius: radii.card,
    backgroundColor: colors.surface,
  },
  emptyMark: {
    width: 56,
    height: 56,
    marginBottom: 14,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 28,
    backgroundColor: colors.paleGreen,
  },
  emptyIcon: {
    fontSize: 24,
    lineHeight: 28,
    color: colors.primary,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: colors.text,
    textAlign: "center",
  },
  emptyBody: {
    marginTop: 6,
    fontSize: 13,
    lineHeight: 20,
    color: colors.muted,
    textAlign: "center",
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 16,
  },
  footerText: {
    fontSize: 12,
    color: colors.muted,
  },
});
