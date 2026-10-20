/**
 * Latest-receipt home card. Pure presentational: real data only, null-safe
 * totals, per-card failure isolation with inline retry.
 */

import { Pressable, StyleSheet, Text, View } from "react-native";

import type { HomeCardError, LatestReceipt } from "../../hooks/useHomeData";

type LatestReceiptCardProps = {
  receipt: LatestReceipt | null;
  loading: boolean;
  error: HomeCardError | null;
  isFirstScan: boolean;
  onScanPress: () => void;
};

export function LatestReceiptCard({
  receipt,
  loading,
  error,
  isFirstScan,
  onScanPress,
}: LatestReceiptCardProps) {
  return (
    <View style={styles.card} testID="home-latest-receipt">
      <Text style={styles.heading}>Latest receipt</Text>
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
            accessibilityLabel="Retry loading latest receipt"
          >
            <Text style={styles.buttonText}>Retry</Text>
          </Pressable>
        </View>
      ) : receipt ? (
        <View>
          <Text style={styles.store}>{receipt.store}</Text>
          <Text style={styles.meta}>
            {receipt.dateLabel}
            {receipt.dateLabel ? " · " : ""}
            {receipt.itemCount} {receipt.itemCount === 1 ? "item" : "items"}
          </Text>
          <Text style={styles.total}>{receipt.totalText}</Text>
        </View>
      ) : isFirstScan ? (
        <View>
          <Text style={styles.muted}>
            Scan your first receipt to see it here.
          </Text>
          <Pressable
            style={styles.button}
            onPress={onScanPress}
            accessibilityRole="button"
            accessibilityLabel="Scan your first receipt"
          >
            <Text style={styles.buttonText}>Scan receipt</Text>
          </Pressable>
        </View>
      ) : (
        <Text style={styles.muted}>No confirmed receipts yet.</Text>
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
  store: {
    fontSize: 17,
    fontWeight: "600",
    marginTop: 6,
  },
  meta: {
    fontSize: 13,
    color: "#666",
    marginTop: 2,
  },
  total: {
    fontSize: 22,
    fontWeight: "700",
    marginTop: 6,
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
});
