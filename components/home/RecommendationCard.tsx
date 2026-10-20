/**
 * Current-recommendation home card. Pure presentational: null-safe, with
 * per-card failure isolation and inline retry. No health, medical, or
 * allergen-safety claims — renders the server copy verbatim.
 */

import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { colors } from "../../constants/app-theme";
import type { CurrentRecommendation } from "../../lib/api/discovery";
import type { HomeCardError } from "../../hooks/useHomeData";
import { styles } from "./home.styles";

type RecommendationCardProps = {
  recommendation: CurrentRecommendation["recommendation"];
  loading: boolean;
  error: HomeCardError | null;
  onPress?: () => void;
};

export function RecommendationCard({
  recommendation,
  loading,
  error,
  onPress,
}: RecommendationCardProps) {
  const showSwapLink = Boolean(recommendation) && !loading && !error;

  const body = loading ? (
    <View style={styles.loadingRow}>
      <ActivityIndicator size="small" color={colors.primary} />
      <Text style={styles.loadingText}>Finding a small step for you…</Text>
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
        accessibilityLabel="Retry loading recommendation"
      >
        <Text style={styles.inlineButtonText}>Retry</Text>
      </Pressable>
    </View>
  ) : recommendation ? (
    <>
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

      {recommendation.detail ? (
        <>
          <View style={styles.divider} />

          <Text style={styles.recommendationDetail}>
            {recommendation.detail}
          </Text>
        </>
      ) : null}

      <Text style={styles.swapLink}>Explore food swaps →</Text>
    </>
  ) : (
    <Text style={styles.recommendationDescription}>
      No recommendation right now — scan another receipt and check back.
    </Text>
  );

  return (
    <>
      <Text style={styles.recommendationHeading}>One small step</Text>

      {showSwapLink ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Explore food swap suggestions"
          testID="home-recommendation"
          onPress={onPress}
          style={({ pressed }) => [
            styles.recommendationCard,
            pressed && styles.pressedCard,
          ]}
        >
          {body}
        </Pressable>
      ) : (
        <View style={styles.recommendationCard} testID="home-recommendation">
          {body}
        </View>
      )}
    </>
  );
}
