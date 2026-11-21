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
import { getSwapExplanation, parseSwapStats } from "./swap-stats";

export type SwapCardActions = {
  onSave?: () => void;
  onDismiss?: () => void;
  /** Restore a dismissed (or saved) card back to suggestions. */
  onRestore?: () => void;
};

type SwapCardProps = {
  swap: SwapSuggestion;
  variant: SwapVariant;
  relatedCount?: number;
  onShowRelated?: () => void;
  pending?: boolean;
  error?: string | null;
  actions?: SwapCardActions;
};

export function SwapCard({
  swap,
  variant,
  relatedCount = 0,
  onShowRelated,
  pending = false,
  error = null,
  actions = {},
}: SwapCardProps) {
  const { onSave, onDismiss, onRestore } = actions;
  const suggested = variant === "suggested";
  const stats = parseSwapStats(swap.benefit, swap.similarity);
  const explanation = getSwapExplanation(swap);

  return (
    <View style={styles.card} testID={`swap-card-${swap.id}`}>
      <View style={styles.swapRow}>
        <View style={styles.itemColumn}>
          <Text style={styles.label}>YOURS</Text>
          <Text style={styles.originalName}>
            {swap.originalItem}
          </Text>
        </View>
        <Text style={styles.arrow} accessible={false}>
          →
        </Text>
        <View style={[styles.itemColumn, styles.alternative]}>
          <Text style={styles.label}>TRY INSTEAD</Text>
          <Text style={styles.itemName}>
            {swap.suggestedItem}
          </Text>
        </View>
      </View>

      {suggested && (stats.length > 0 || swap.benefit) ? (
        <View style={styles.reasonSection}>
          <Text style={styles.sectionTitle}>Why consider it</Text>
          {stats.length ? (
            <View style={styles.statsSection}>
              <View style={styles.divider} />
              {stats.map((stat) => {
                const direction = stat.toValue > stat.fromValue ? "↑" : "↓";
                return (
                  <View key={stat.label} style={styles.statRow}>
                    <Text numberOfLines={1} style={styles.statLabel}>
                      {stat.label}
                    </Text>
                    <Text style={styles.statOldValue}>{stat.from}</Text>
                    <Text style={styles.statArrow} accessible={false}>
                      →
                    </Text>
                    <Text
                      numberOfLines={1}
                      style={[
                        styles.statNewValue,
                        stat.improvement && styles.statImproved,
                      ]}
                    >
                      {stat.to}
                    </Text>
                    <Text
                      style={[
                        styles.statDirection,
                        stat.improvement && styles.statImproved,
                      ]}
                      accessible={false}
                    >
                      {direction}
                    </Text>
                  </View>
                );
              })}
            </View>
          ) : (
            <Text style={styles.body}>{swap.benefit}</Text>
          )}
        </View>
      ) : null}

      {suggested && explanation ? (
        <View style={styles.reasonSection}>
          <Text style={styles.sectionTitle}>Why it fits</Text>
          <Text style={styles.body}>{explanation}</Text>
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

      <Text style={styles.caption}>Per 100g · OpenNutrition</Text>

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

      {suggested && relatedCount > 0 && onShowRelated ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`See ${relatedCount} more swaps for ${swap.originalItem}`}
          onPress={onShowRelated}
          style={({ pressed }) => [
            styles.relatedButton,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.relatedButtonLabel}>
            See {relatedCount} more for {swap.originalItem} →
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: "100%",
    maxWidth: 480,
    padding: 20,
    borderRadius: radii.card,
    backgroundColor: colors.surface,
  },
  swapRow: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: 8,
  },
  itemColumn: {
    flex: 1,
    minWidth: 0,
    justifyContent: "center",
    paddingVertical: 12,
    paddingHorizontal: 10,
  },
  label: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: "600",
    letterSpacing: 1,
  },
  originalName: {
    marginTop: 6,
    color: colors.muted,
    fontSize: 16,
    fontWeight: "600",
    lineHeight: 22,
  },
  itemName: {
    marginTop: 6,
    color: colors.text,
    fontSize: 16,
    fontWeight: "600",
    lineHeight: 22,
  },
  arrow: {
    alignSelf: "center",
    color: colors.primary,
    fontSize: 18,
  },
  alternative: {
    padding: 12,
    borderRadius: 14,
    backgroundColor: colors.paleGreen,
  },
  reasonSection: {
    marginTop: 16,
    gap: 6,
  },
  relatedButton: {
    alignSelf: "flex-start",
    minHeight: 40,
    marginTop: 10,
    justifyContent: "center",
  },
  relatedButtonLabel: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: "700",
  },
  sectionTitle: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: "700",
  },
  body: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 21,
  },
  statsSection: {
    marginTop: 2,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginBottom: 10,
    backgroundColor: colors.border,
  },
  statRow: {
    minHeight: 30,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  statLabel: {
    flex: 1,
    minWidth: 0,
    color: colors.text,
    fontSize: 12,
    textTransform: "capitalize",
  },
  statOldValue: {
    color: colors.muted,
    fontSize: 12,
  },
  statArrow: {
    color: colors.muted,
    fontSize: 12,
  },
  statNewValue: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "700",
  },
  statDirection: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
  },
  statImproved: {
    color: colors.primary,
  },
  caption: {
    marginTop: 12,
    color: colors.muted,
    fontSize: 10,
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
    marginTop: 14,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
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
