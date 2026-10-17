import { Text, View } from "react-native";
import type {
  BasketCategory,
  BasketSummaryData,
} from "../../data/mock-home";
import { styles } from "./home.styles";

type Props = {
  categories: BasketCategory[];
  summary: BasketSummaryData;
};

export function BasketSummary({ categories, summary }: Props) {
  const maxCount = Math.max(
    1,
    ...categories.map((category) => category.count)
  );

  return (
    <>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>
          What’s in your basket
        </Text>

        <Text style={styles.sectionMeta}>
          Last {summary.receiptCount} receipts
        </Text>
      </View>

      <View style={styles.basketCard}>
        {categories.map((category) => (
          <View key={category.id} style={styles.categoryRow}>
            <Text style={styles.categoryLabel}>
              {category.label}
            </Text>

            <View
              style={styles.progressTrack}
              accessible
              accessibilityLabel={
                `${category.label}: ${category.count} purchased items`
              }
            >
              <View
                style={[
                  styles.progressFill,
                  { width: `${(category.count / maxCount) * 100}%` },
                ]}
              />
            </View>

            <Text style={styles.categoryCount}>
              {category.count}
            </Text>
          </View>
        ))}

        <Text style={styles.basketFootnote}>
          {summary.itemCount} purchased items · grouped by matched food
          type
        </Text>
      </View>
    </>
  );
}