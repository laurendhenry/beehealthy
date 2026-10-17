import { Pressable, Text, View } from "react-native";
import type { Recommendation } from "../../data/mock-home";
import { styles } from "./home.styles";

type Props = {
  recommendation: Recommendation;
  onPress: () => void;
};

export function RecommendationCard({
  recommendation,
  onPress,
}: Props) {
  return (
    <>
      <Text style={styles.recommendationHeading}>
        One small step
      </Text>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Explore food swap suggestions"
        onPress={onPress}
        style={({ pressed }) => [
          styles.recommendationCard,
          pressed && styles.pressedCard,
        ]}
      >
        <View style={styles.recommendationTop}>
          <Text style={styles.leafIcon}>♧</Text>

          <View style={styles.recommendationCopy}>
            <Text style={styles.recommendationTitle}>
              {recommendation.title}
            </Text>

            <Text style={styles.recommendationDescription}>
              {recommendation.description}
            </Text>
          </View>
        </View>

        <View style={styles.divider} />

        <Text style={styles.recommendationDetail}>
          {recommendation.detail}
        </Text>

        <Text style={styles.swapLink}>Explore food swaps →</Text>
      </Pressable>
    </>
  );
}