/**
 * One swap suggestion card. Rendered in suggested / saved / dismissed lists.
 *
 * Copy rules (plan sections 6, 8 — hard constraints):
 * - Never promise compatibility or allergen safety. Suggested cards may note
 *   the stated benefit only; saved cards show the swap pair with no
 *   compatibility/allergen claims at all.
 * - No medical or allergen-safety claims anywhere in this component.
 */

import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

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
  return (
    <View style={styles.card} testID={`swap-card-${swap.id}`}>
      <Text style={styles.original}>{swap.originalItem}</Text>
      <Text style={styles.arrow} accessible={false}>
        {"→"} {swap.suggestedItem}
      </Text>
      {variant === "suggested" && swap.benefit ? (
        <Text style={styles.benefit}>{swap.benefit}</Text>
      ) : null}
      {variant === "suggested" && swap.similarity ? (
        <Text style={styles.meta}>{swap.similarity}</Text>
      ) : null}
      {error ? (
        <Text style={styles.error} role="alert">
          {error}
        </Text>
      ) : null}
      <View style={styles.row}>
        {pending ? <ActivityIndicator size="small" /> : null}
        {variant === "suggested" && onSave ? (
          <Pressable
            style={[styles.button, pending && styles.disabled]}
            disabled={pending}
            onPress={onSave}
            accessibilityRole="button"
            accessibilityLabel={`Save swap to ${swap.suggestedItem}`}
          >
            <Text style={styles.buttonText}>Save</Text>
          </Pressable>
        ) : null}
        {variant === "suggested" && onDismiss ? (
          <Pressable
            style={[styles.button, styles.secondary, pending && styles.disabled]}
            disabled={pending}
            onPress={onDismiss}
            accessibilityRole="button"
            accessibilityLabel={`Dismiss swap to ${swap.suggestedItem}`}
          >
            <Text style={[styles.buttonText, styles.secondaryText]}>Dismiss</Text>
          </Pressable>
        ) : null}
        {variant !== "suggested" && onRestore ? (
          <Pressable
            style={[styles.button, pending && styles.disabled]}
            disabled={pending}
            onPress={onRestore}
            accessibilityRole="button"
            accessibilityLabel={
              variant === "dismissed"
                ? `Restore swap to ${swap.suggestedItem}`
                : `Move swap to ${swap.suggestedItem} back to suggestions`
            }
          >
            <Text style={styles.buttonText}>
              {variant === "dismissed" ? "Restore" : "Move to suggestions"}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e2e2e2",
    padding: 14,
    marginBottom: 12,
    backgroundColor: "#fff",
  },
  original: {
    fontSize: 14,
    color: "#666",
    textDecorationLine: "line-through",
  },
  arrow: {
    fontSize: 17,
    fontWeight: "600",
    marginTop: 2,
  },
  benefit: {
    fontSize: 14,
    marginTop: 6,
  },
  meta: {
    fontSize: 12,
    color: "#888",
    marginTop: 4,
  },
  error: {
    fontSize: 13,
    color: "#b3261e",
    marginTop: 8,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 10,
  },
  button: {
    backgroundColor: "#1a73e8",
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  secondary: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: "#1a73e8",
  },
  buttonText: {
    color: "#fff",
    fontWeight: "600",
  },
  secondaryText: {
    color: "#1a73e8",
  },
  disabled: {
    opacity: 0.5,
  },
});
