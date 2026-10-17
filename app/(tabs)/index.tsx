import { router } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { BasketSummary } from "../../components/home/BasketSummary";
import { HomeHeader } from "../../components/home/HomeHeader";
import { LatestReceiptCard } from "../../components/home/LatestReceiptCard";
import { RecommendationCard } from "../../components/home/RecommendationCard";
import { styles } from "../../components/home/home.styles";
import { mockHomeData } from "../../data/mock-home";

export default function HomeScreen() {
  // This is the current sample-data connection point.
  const data = mockHomeData;

  return (
    <SafeAreaView
      style={styles.safeArea}
      edges={["top", "left", "right"]}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <HomeHeader />

        <LatestReceiptCard receipt={data.latestReceipt} />

        <View style={styles.actionRow}>
          <Text style={styles.actionLabel}>Scan receipt</Text>

          <Pressable
            accessibilityRole="button"
            onPress={() => router.push("/scan")}
            style={({ pressed }) => [
              styles.primaryButton,
              pressed && styles.primaryButtonPressed,
            ]}
          >
            <Text style={styles.primaryButtonText}>
              Scan receipt
            </Text>
          </Pressable>
        </View>

        <BasketSummary
          categories={data.basketCategories}
          summary={data.basketSummary}
        />

        <RecommendationCard
          recommendation={data.recommendation}
          onPress={() => router.push("/swaps")}
        />

        <Text style={styles.disclaimer}>
          Estimates from purchases, not food eaten. These patterns don’t
          diagnose nutrient deficiencies.
        </Text>

        <Text style={styles.demoNote}>
          Demo preview · Receipt and recommendation data are samples.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}