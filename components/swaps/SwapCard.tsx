/**
 * One swap suggestion card. Rendered in suggested / saved / dismissed lists.
 *
 * Copy rules (plan sections 6, 8 — hard constraints):
 * - Never promise compatibility or allergen safety. Suggested cards may note
 *   the stated benefit only; saved cards show the swap pair with no
 *   compatibility/allergen claims at all.
 * - No medical or allergen-safety claims anywhere in this component.
 */

import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { colors, radii } from "../../constants/app-theme";
import type { SwapSuggestion, SwapVariant } from "../../types/swaps";

export type SwapCardActions = {
  onSave?: () => void;
  onDismiss?: () => void;
  /** Restore a dismissed (or saved) card back to suggestions. */
  onRestore?: () => void;
};

type SwapCardProps = {
  swap: SwapSuggestion;
  variant: SwapVariant;
  pending?: boolean;
  error?: string | null;
  actions?: SwapCardActions;
};

export function SwapCard({
  swap,
  variant,
  pending = false,
  error = null,
  actions = {},
}: SwapCardProps) {
  const { onSave, onDismiss, onRestore } = actions;
  const suggested = variant === "suggested";

  return (
    <View style={styles.card} testID={`swap-card-${swap.id}`}>
      <Text style={styles.label}>YOUR ITEM</Text>
      <Text style={styles.itemName}>{swap.originalItem}</Text>

      <Text style={styles.arrow} accessible={false}>
        ↓
      </Text>

      <View style={styles.alternative}>
        <Text style={styles.label}>TRY INSTEAD</Text>
        <Text style={styles.itemName}>{swap.suggestedItem}</Text>
      </View>

      {suggested && swap.similarity ? (
        <View style={styles.explanation}>
          <Text style={styles.explanationTitle}>Why it fits</Text>
          <Text style={styles.body}>{swap.similarity}</Text>
        </View>
      ) : null}

      {suggested && swap.benefit ? (
        <View style={styles.explanation}>
          <Text style={styles.explanationTitle}>Why consider it</Text>
          <Text style={styles.body}>{swap.benefit}</Text>
        </View>
      ) : null}

      {error ? (
        <Text style={styles.error} role="alert">
          {error}
        </Text>
      ) : null}

      {pending ? (
        <View style={styles.pendingRow} testID={`swap-pending-${swap.id}`}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={styles.pendingLabel}>Updating…</Text>
        </View>
      ) : null}

      {suggested ? (
        <View style={styles.actions}>
          {onSave ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Save swap to ${swap.suggestedItem}`}
              accessibilityState={{ disabled: pending, busy: pending }}
              disabled={pending}
              onPress={onSave}
              style={({ pressed }) => [
                styles.saveButton,
                pressed && styles.pressed,
                pending && styles.disabled,
              ]}
            >
              <Text style={styles.saveButtonLabel}>Save swap</Text>
            </Pressable>
          ) : null}

          {onDismiss ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Dismiss swap for ${swap.originalItem}`}
              accessibilityState={{ disabled: pending, busy: pending }}
              disabled={pending}
              onPress={onDismiss}
              style={[styles.textButton, pending && styles.disabled]}
            >
              <Text style={styles.textButtonLabel}>Dismiss</Text>
            </Pressable>
          ) : null}
        </View>
      ) : variant === "saved" ? (
        <View style={styles.actions}>
          <Text style={styles.savedLabel}>✓ Saved</Text>

          {onRestore ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Remove ${swap.suggestedItem} from saved`}
              accessibilityState={{ disabled: pending, busy: pending }}
              disabled={pending}
              onPress={onRestore}
              style={[styles.textButton, pending && styles.disabled]}
            >
              <Text style={styles.textButtonLabel}>Remove</Text>
            </Pressable>
          ) : null}
        </View>
      ) : (
        <View style={styles.actions}>
          <Text style={styles.dismissedLabel}>Dismissed</Text>

          {onRestore ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Restore swap to ${swap.suggestedItem}`}
              accessibilityState={{ disabled: pending, busy: pending }}
              disabled={pending}
              onPress={onRestore}
              style={({ pressed }) => [
                styles.restoreButton,
                pressed && styles.pressed,
                pending && styles.disabled,
              ]}
            >
              <Text style={styles.restoreButtonLabel}>Restore</Text>
            </Pressable>
          ) : null}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 20,
    borderRadius: radii.card,
    backgroundColor: colors.surface,
  },
  label: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: "600",
    letterSpacing: 1,
  },
  itemName: {
    marginTop: 6,
    color: colors.text,
    fontSize: 18,
    fontWeight: "600",
    lineHeight: 25,
  },
  arrow: {
    marginVertical: 8,
    marginLeft: 8,
    color: colors.primary,
    fontSize: 24,
  },
  alternative: {
    padding: 16,
    borderRadius: 16,
    backgroundColor: colors.paleGreen,
  },
  explanation: {
    marginTop: 16,
    gap: 4,
  },
  explanationTitle: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: "700",
  },
  body: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 21,
  },
  error: {
    marginTop: 14,
    fontSize: 13,
    lineHeight: 19,
    color: "#B3261E",
  },
  pendingRow: {
    marginTop: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  pendingLabel: {
    fontSize: 12,
    color: colors.muted,
  },
  actions: {
    marginTop: 20,
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 16,
  },
  saveButton: {
    minHeight: 46,
    paddingHorizontal: 24,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: radii.button,
    backgroundColor: colors.primary,
  },
  saveButtonLabel: {
    color: colors.surface,
    fontSize: 14,
    fontWeight: "600",
  },
  textButton: {
    minHeight: 46,
    paddingHorizontal: 8,
    justifyContent: "center",
  },
  textButtonLabel: {
    color: colors.muted,
    fontSize: 13,
  },
  savedLabel: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: "600",
  },
  dismissedLabel: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: "600",
  },
  restoreButton: {
    minHeight: 46,
    paddingHorizontal: 8,
    justifyContent: "center",
  },
  restoreButtonLabel: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: "600",
  },
  pressed: {
    opacity: 0.75,
  },
  disabled: {
    opacity: 0.5,
  },
});
