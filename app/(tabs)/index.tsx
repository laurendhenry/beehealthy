/**
 * Home tab: latest receipt + basket summary + current recommendation,
 * each loaded independently with per-card failure isolation.
 *
 * Data comes from useHomeData (real server reads only — no mocks).
 * Pull-to-refresh reloads every card. Card states (loading / error / empty)
 * stay inside the original dashboard layout.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { router } from "expo-router";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { BasketSummary } from "../../components/home/BasketSummary";
import { HomeHeader } from "../../components/home/HomeHeader";
import { LatestReceiptCard } from "../../components/home/LatestReceiptCard";
import { RecommendationCard } from "../../components/home/RecommendationCard";
import { styles } from "../../components/home/home.styles";
import { colors } from "../../constants/app-theme";
import { useHomeData } from "../../hooks/useHomeData";

export default function HomeScreen() {
  const home = useHomeData();
  const [refreshing, setRefreshing] = useState(false);
  const { lastSuccessAt, refreshAll } = home;
  const refreshedFromRef = useRef<number | null>(lastSuccessAt);

  const handleRefresh = useCallback(() => {
    refreshedFromRef.current = lastSuccessAt;
    setRefreshing(true);
    refreshAll();
  }, [lastSuccessAt, refreshAll]);

  // Server queries keep their stale status while refetching, so settle the
  // indicator on the first fresh success/error instead of snapping shut, and
  // fall back to a timeout so it can never hang.
  useEffect(() => {
    if (!refreshing) return;

    const settled =
      (home.lastSuccessAt ?? 0) > (refreshedFromRef.current ?? 0) ||
      Boolean(home.latestError || home.basketError || home.recommendationError);

    if (settled) {
      setRefreshing(false);
      return;
    }

    const timer = setTimeout(() => setRefreshing(false), 4000);
    return () => clearTimeout(timer);
  }, [
    refreshing,
    home.lastSuccessAt,
    home.latestError,
    home.basketError,
    home.recommendationError,
  ]);

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
        testID="home-screen"
      >
        <HomeHeader />

        <LatestReceiptCard
          receipt={home.latestReceipt}
          loading={home.latestLoading}
          error={home.latestError}
          isFirstScan={home.isFirstScan}
          onScanPress={() => router.push("/scan")}
        />

        <View style={styles.actionRow}>
          <Text style={styles.actionLabel}>Scan receipt</Text>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Scan a receipt"
            testID="home-scan-link"
            onPress={() => router.push("/scan")}
            style={({ pressed }) => [
              styles.primaryButton,
              pressed && styles.primaryButtonPressed,
            ]}
          >
            <Text style={styles.primaryButtonText}>Scan receipt</Text>
          </Pressable>
        </View>

        <BasketSummary
          basket={home.basket}
          loading={home.basketLoading}
          error={home.basketError}
        />

        <RecommendationCard
          recommendation={home.recommendation}
          loading={home.recommendationLoading}
          error={home.recommendationError}
          onPress={() => router.push("/swaps")}
        />

        <Text style={styles.disclaimer}>
          Estimates from purchases, not food eaten. These patterns don’t
          diagnose nutrient deficiencies.
        </Text>

        {home.lastSuccessAt ? (
          <Text style={styles.syncNote}>
            {`Updated ${new Date(home.lastSuccessAt).toLocaleTimeString("en-US", {
              hour: "numeric",
              minute: "2-digit",
            })}`}
          </Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
