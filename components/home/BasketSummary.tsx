/**
 * Basket-summary home card. Honest semantics: counts reflect currently
 * available pantry rows only — never confirmed spending.
 */

import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { Link } from "expo-router";

import { colors } from "../../constants/app-theme";
import type { HomeCardError } from "../../hooks/useHomeData";
import type { BasketSummary as BasketSummaryData } from "../../lib/api/pantry";
import { styles } from "./home.styles";

type BasketSummaryProps = {
  basket: BasketSummaryData | null;
  loading: boolean;
  error: HomeCardError | null;
};

/** Keep the card short; the pantry screen shows the full breakdown. */
const MAX_VISIBLE_CATEGORIES = 5;

export function BasketSummary({ basket, loading, error }: BasketSummaryProps) {
  const categories =
    basket?.categories.slice(0, MAX_VISIBLE_CATEGORIES) ?? [];
  const maxCount = Math.max(
    1,
    ...categories.map((category) => category.count),
  );
  const receiptCount = basket?.receiptCount ?? 0;
  const itemCount = basket?.itemCount ?? 0;

  return (
    <>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>What’s in your basket</Text>

        <Text style={styles.sectionMeta}>
          {receiptCount > 0
            ? `Last ${receiptCount} ${receiptCount === 1 ? "receipt" : "receipts"}`
            : "Available now"}
        </Text>
      </View>

      <View style={styles.basketCard} testID="home-basket-summary">
        {loading ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={styles.loadingText}>Loading your basket…</Text>
          </View>
        ) : error ? (
          <View>
            <Text style={styles.errorText} role="alert">
              {error.message}
            </Text>
            <Pressable
              style={({ pressed }) => [
                styles.inlineButton,
                pressed && styles.inlineButtonPressed,
              ]}
              onPress={error.retry}
              accessibilityRole="button"
              accessibilityLabel="Retry loading basket summary"
            >
              <Text style={styles.inlineButtonText}>Retry</Text>
            </Pressable>
          </View>
        ) : categories.length === 0 ? (
          <>
            <Text style={styles.basketFootnote}>
              Nothing in your basket yet. Scan a receipt and the food you keep
              shows up here.
            </Text>

            <Link href="/pantry" asChild>
              <Pressable
                style={styles.pantryLink}
                accessibilityRole="button"
                accessibilityLabel="View pantry"
              >
                <Text style={styles.pantryLinkText}>Open pantry →</Text>
              </Pressable>
            </Link>
          </>
        ) : (
          <>
            {categories.map((category) => (
              <View key={category.id} style={styles.categoryRow}>
                <Text style={styles.categoryLabel}>{category.label}</Text>

                <View
                  style={styles.progressTrack}
                  accessible
                  accessibilityLabel={`${category.label}: ${category.count} available items`}
                >
                  <View
                    style={[
                      styles.progressFill,
                      { width: `${(category.count / maxCount) * 100}%` },
                    ]}
                  />
                </View>

                <Text style={styles.categoryCount}>{category.count}</Text>
              </View>
            ))}

            <Text style={styles.basketFootnote}>
              {itemCount} {itemCount === 1 ? "item" : "items"} available ·
              grouped by food type
            </Text>

            <Link href="/pantry" asChild>
              <Pressable
                style={styles.pantryLink}
                accessibilityRole="button"
                accessibilityLabel="View pantry"
              >
                <Text style={styles.pantryLinkText}>Open pantry →</Text>
              </Pressable>
            </Link>
          </>
        )}
      </View>
    </>
  );
}
