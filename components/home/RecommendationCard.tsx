/**
 * Current-recommendation home card. Pure presentational: null-safe, with
 * per-card failure isolation and inline retry. No health, medical, or
 * allergen-safety claims — renders the server copy verbatim.
 */

import { Pressable, StyleSheet, Text, View } from "react-native";

import type { CurrentRecommendation } from "../../lib/api/discovery";
import type { HomeCardError } from "../../hooks/useHomeData";

type RecommendationCardProps = {
  recommendation: CurrentRecommendation["recommendation"];
  loading: boolean;
  error: HomeCardError | null;
};

export function RecommendationCard({
  recommendation,
  loading,
  error,
}: RecommendationCardProps) {
  return (
    <View style={styles.card} testID="home-recommendation">
      <Text style={styles.heading}>Recommended for you</Text>
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
            accessibilityLabel="Retry loading recommendation"
          >
            <Text style={styles.buttonText}>Retry</Text>
          </Pressable>
        </View>
      ) : recommendation ? (
        <View>
          <Text style={styles.title}>{recommendation.title}</Text>
          <Text style={styles.body}>{recommendation.description}</Text>
          {recommendation.detail ? (
            <Text style={styles.detail}>{recommendation.detail}</Text>
          ) : null}
        </View>
      ) : (
        <Text style={styles.muted}>
          No recommendation right now — check back after your next receipt.
        </Text>
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
  title: {
    fontSize: 17,
    fontWeight: "600",
    marginTop: 6,
  },
  body: {
    fontSize: 14,
    marginTop: 4,
  },
  detail: {
    fontSize: 13,
    color: "#666",
    marginTop: 4,
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
