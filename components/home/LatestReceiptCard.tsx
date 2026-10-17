import { Text, View } from "react-native";
import type { ReceiptSummary } from "../../data/mock-home";
import { styles } from "./home.styles";

type Props = {
  receipt: ReceiptSummary;
};

export function LatestReceiptCard({ receipt }: Props) {
  return (
    <View style={styles.receiptCard}>
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

        <Text style={styles.storeName}>{receipt.store}</Text>

        <Text style={styles.receiptMeta}>
          {receipt.dateLabel} · {receipt.itemCount} items · $
          {receipt.total.toFixed(2)}
        </Text>

        <View style={styles.statusBadge}>
          <Text style={styles.statusText}>{receipt.status}</Text>
        </View>
      </View>
    </View>
  );
}