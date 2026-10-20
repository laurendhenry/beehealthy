/**
 * Home tab: latest receipt + basket summary + current recommendation,
 * each loaded independently with per-card failure isolation.
 *
 * Data comes from useHomeData (real server reads only — no mocks).
 * Pull-to-refresh reloads every card. Receipt review/confirm flow is owned
 * by Agent B's receipt context; this screen only links to it.
 */

import { RefreshControl, ScrollView, StyleSheet } from "react-native";
import { Link, useRouter } from "expo-router";

import { useHomeData } from "../../hooks/useHomeData";
import { LatestReceiptCard } from "../../components/home/LatestReceiptCard";
import { BasketSummary } from "../../components/home/BasketSummary";
import { RecommendationCard } from "../../components/home/RecommendationCard";

export default function HomeScreen() {
  const router = useRouter();
  const home = useHomeData();

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={
            home.latestLoading || home.basketLoading || home.recommendationLoading
          }
          onRefresh={home.refreshAll}
        />
      }
      testID="home-screen"
    >
      <LatestReceiptCard
        receipt={home.latestReceipt}
        loading={home.latestLoading}
        error={home.latestError}
        isFirstScan={home.isFirstScan}
        onScanPress={() => router.push("/review_receipt" as never)}
      />
      <BasketSummary
        basket={home.basket}
        loading={home.basketLoading}
        error={home.basketError}
      />
      <RecommendationCard
        recommendation={home.recommendation}
        loading={home.recommendationLoading}
        error={home.recommendationError}
      />
      {/* Keep the scan-tabs link discoverable; href type follows expo-router
          generated routes once scan/review screens exist. */}
      <Link href={"/review_receipt" as never} testID="home-scan-link">
        Scan a receipt
      </Link>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f6f6f6",
  },
  content: {
    padding: 16,
    paddingBottom: 32,
  },
});
