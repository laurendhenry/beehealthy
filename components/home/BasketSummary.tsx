/**
 * Basket-summary home card. Honest semantics: counts and value reflect
 * currently available pantry rows only — never confirmed spending.
 */

import { Pressable, StyleSheet, Text, View } from "react-native";
import { Link } from "expo-router";

import type { HomeCardError } from "../../hooks/useHomeData";
import type { BasketSummary as BasketSummaryData } from "../../lib/api/pantry";

type BasketSummaryProps = {
  basket: BasketSummaryData | null;
  loading: boolean;
  error: HomeCardError | null;
};

export function BasketSummary({ basket, loading, error }: BasketSummaryProps) {
  return (
    <View style={styles.card} testID="home-basket-summary">
      <Text style={styles.heading}>Basket</Text>
      {loading ? (
        <Text style={styles.muted}>Loading…</Text>
      ) : error ? (
        <View>
          <Text style={styles.error} role="alert">
            {error.message}
          </Text>
          <Pressable
            style={styles.button}
            onPress={error.retry}
            accessibilityRole="button"
            accessibilityLabel="Retry loading basket summary"
          >
            <Text style={styles.buttonText}>Retry</Text>
          </Pressable>
        </View>
      ) : basket ? (
        <View>
          <Text style={styles.total}>
            {basket.itemCount} {basket.itemCount === 1 ? "item" : "items"}
          </Text>
          <Text style={styles.meta}>
            Available now
            {basket.receiptCount > 0
              ? ` · from ${basket.receiptCount} ${basket.receiptCount === 1 ? "receipt" : "receipts"}`
              : ""}
            {basket.categories.length > 0
              ? ` · ${basket.categories
                  .slice(0, 3)
                  .map((category) => category.label)
                  .join(", ")}`
              : ""}
          </Text>
          <Link href="/pantry" asChild>
            <Pressable
              style={styles.linkButton}
              accessibilityRole="button"
              accessibilityLabel="View pantry"
            >
              <Text style={styles.linkText}>View pantry</Text>
            </Pressable>
          </Link>
        </View>
      ) : (
        <Text style={styles.muted}>Your basket is empty.</Text>
      )}
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
  heading: {
    fontSize: 13,
    fontWeight: "600",
    color: "#666",
    textTransform: "uppercase",
  },
  total: {
    fontSize: 22,
    fontWeight: "700",
    marginTop: 6,
  },
  meta: {
    fontSize: 13,
    color: "#666",
    marginTop: 2,
  },
  muted: {
    fontSize: 14,
    color: "#666",
    marginTop: 6,
  },
  error: {
    fontSize: 14,
    color: "#b3261e",
    marginTop: 6,
  },
  button: {
    backgroundColor: "#1a73e8",
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 16,
    marginTop: 10,
    alignSelf: "flex-start",
  },
  buttonText: {
    color: "#fff",
    fontWeight: "600",
  },
  linkButton: {
    marginTop: 10,
    alignSelf: "flex-start",
  },
  linkText: {
    color: "#1a73e8",
    fontWeight: "600",
  },
});
