/**
 * Latest-receipt home card. Pure presentational: real data only, null-safe
 * totals, per-card failure isolation with inline retry.
 */

import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { colors } from "../../constants/app-theme";
import type { HomeCardError, LatestReceipt } from "../../hooks/useHomeData";
import { styles } from "./home.styles";

type LatestReceiptCardProps = {
  receipt: LatestReceipt | null;
  loading: boolean;
  error: HomeCardError | null;
  isFirstScan: boolean;
  onScanPress: () => void;
  onReceiptPress: (receiptId: string) => void;
  onHistoryPress: () => void;
};

function statusLabel(status: string) {
  if (!status) return "Confirmed";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export function LatestReceiptCard({
  receipt,
  loading,
  error,
  isFirstScan,
  onScanPress,
  onReceiptPress,
  onHistoryPress,
}: LatestReceiptCardProps) {
  return (
    <View style={styles.receiptCard} testID="home-latest-receipt">
      <View
        style={styles.receiptIllustration}
        accessible
        accessibilityLabel="Grocery illustration"
      >
        <Text style={styles.groceryEmoji}>🥬</Text>
        <Text style={styles.groceryEmojiSmall}>🍌</Text>
      </View>

      <View style={styles.receiptContent}>
        <Text style={styles.eyebrow}>LATEST GROCERY RUN</Text>

        {loading ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={styles.loadingText}>Checking your receipts…</Text>
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
              accessibilityLabel="Retry loading latest receipt"
            >
              <Text style={styles.inlineButtonText}>Retry</Text>
            </Pressable>
          </View>
        ) : receipt ? (
          <Pressable
            onPress={() => onReceiptPress(receipt.id)}
            accessibilityRole="button"
            accessibilityLabel={`Open latest receipt from ${receipt.store}`}
            accessibilityHint="Opens receipt details"
            testID="home-latest-receipt-link"
            style={({ pressed }) => [
              styles.receiptPressable,
              pressed && styles.pressedOpacity,
            ]}
          >
            <Text style={styles.storeName}>{receipt.store}</Text>

            <Text style={styles.receiptMeta}>
              {receipt.dateLabel ? `${receipt.dateLabel} · ` : ""}
              {receipt.itemCount} {receipt.itemCount === 1 ? "item" : "items"}
              {` · ${receipt.totalText}`}
            </Text>

            <View style={styles.statusBadge}>
              <Text style={styles.statusText}>{statusLabel(receipt.status)}</Text>
            </View>

            <Text style={styles.receiptDetailsHint}>View details ›</Text>
          </Pressable>
        ) : (
          <View>
            <Text style={styles.receiptMeta}>
              {isFirstScan
                ? "Scan your first receipt to see it here."
                : "No confirmed receipts yet."}
            </Text>
            <Pressable
              style={({ pressed }) => [
                styles.inlineButton,
                pressed && styles.inlineButtonPressed,
              ]}
              onPress={onScanPress}
              accessibilityRole="button"
              accessibilityLabel="Scan a receipt"
            >
              <Text style={styles.inlineButtonText}>Scan receipt</Text>
            </Pressable>
          </View>
        )}
      </View>

        <Pressable
          onPress={onHistoryPress}
          accessibilityRole="button"
          accessibilityLabel="View receipt history"
          hitSlop={6}
          testID="home-receipt-history-link"
          style={({ pressed }) => [
            styles.historyLink,
            pressed && styles.pressedOpacity,
          ]}
        >
          <Text style={styles.historyLinkText}>View receipt history</Text>
        </Pressable>
    </View>
  );
}
