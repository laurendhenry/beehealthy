/**
 * Swaps tab: suggested / saved / dismissed lists with per-card
 * save/dismiss/restore and rollback.
 *
 * Data, optimistic updates, and rollback come from useSwaps (real server
 * reads only — no mocks). This file owns presentation only. Cards render
 * through a virtualized FlatList so long saved/dismissed lists are not all
 * mounted at once; the themed header, tabs, states, and footer live in the
 * list's header/empty/footer slots.
 */

import { useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useSwaps, type SwapCardState } from "../../hooks/useSwaps";
import { SwapCard } from "../../components/swaps/SwapCard";
import { organizeSuggestedSwaps } from "../../components/swaps/swap-list";
import { colors, radii } from "../../constants/app-theme";
import type { SwapTab } from "../../types/swaps";

const TABS: { id: SwapTab; label: string }[] = [
  { id: "suggested", label: "Suggested" },
  { id: "saved", label: "Saved" },
  { id: "dismissed", label: "Dismissed" },
];

const GENERATING_COPY = {
  title: "Finding healthier swaps for your latest groceries…",
  description:
    "This usually takes a few minutes after you save a receipt. We’ll check again automatically while you’re here.",
};

const NO_SWAPS_COPY = {
  title: "No swaps yet.",
  description:
    "Swaps come from foods in your pantry. Save a receipt with matched foods and ideas appear here once they’re ready.",
};

const EMPTY_COPY: Record<SwapTab, { title: string; description: string }> = {
  suggested: {
    title: "You’re all caught up.",
    description:
      "Save a swap to keep it for your next grocery run, or restore one from Dismissed.",
  },
  saved: {
    title: "Your ideas, saved here.",
    description:
      "Save a suggestion to keep it for your next grocery run.",
  },
  dismissed: {
    title: "Nothing set aside.",
    description:
      "Dismissed swaps wait here. Restore one to see it in Suggested again.",
  },
};

export default function SwapsScreen() {
  const swaps = useSwaps();
  const [tab, setTab] = useState<SwapTab>("suggested");
  const [selectedFood, setSelectedFood] = useState<string | null>(null);

  const list =
    tab === "suggested"
      ? swaps.suggested
      : tab === "saved"
        ? swaps.saved
        : swaps.dismissed;
  const suggestionSections = organizeSuggestedSwaps(
    swaps.suggested.map((card) => card.swap),
  );
  const relatedCards =
    selectedFood === null
      ? []
      : swaps.suggested.filter(
          (card) => card.swap.originalItem === selectedFood,
        );
  const visibleList =
    tab === "suggested" && selectedFood !== null ? relatedCards : list;

  const counts: Record<SwapTab, number> = {
    suggested: swaps.suggested.length,
    saved: swaps.saved.length,
    dismissed: swaps.dismissed.length,
  };

  let emptyCopy = EMPTY_COPY[tab];
  if (tab === "suggested" && swaps.generating) {
    emptyCopy = GENERATING_COPY;
  } else if (tab === "suggested" && swaps.saved.length + swaps.dismissed.length === 0) {
    emptyCopy = NO_SWAPS_COPY;
  }

  const showRelatedSwaps = (originalItem: string) => {
    setSelectedFood(originalItem);
  };

  const renderSwapCard = (card: SwapCardState) => {
    const related =
      suggestionSections.byOriginalItem.get(card.swap.originalItem) ?? [];
    const relatedCount =
      tab === "suggested" && selectedFood === null
        ? Math.max(0, related.length - 1)
        : 0;
    return (
      <View style={styles.cardContainer}>
        <SwapCard
          swap={card.swap}
          variant={tab}
          relatedCount={relatedCount}
          onShowRelated={() => showRelatedSwaps(card.swap.originalItem)}
          pending={card.pending}
          error={card.error}
          actions={
            tab === "suggested"
              ? {
                  onSave: () => void swaps.save(card.swap.id),
                  onDismiss: () => void swaps.dismiss(card.swap.id),
                }
              : {
                  onRestore: () => {
                    if (tab === "dismissed") {
                      void swaps.restore(card.swap.id);
                    } else {
                      void swaps.unsave(card.swap.id);
                    }
                  },
                }
          }
        />
      </View>
    );
  };

  return (
    <SafeAreaView
      style={styles.page}
      edges={["top", "left", "right"]}
      testID="swaps-screen"
    >
      <FlatList
        data={visibleList}
        keyExtractor={(card) => card.swap.id}
        extraData={`${tab}:${selectedFood ?? ""}`}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={swaps.refreshing}
            onRefresh={swaps.refresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.brand}>♧ sprout</Text>

            <View>
              <Text style={styles.heading}>Small swaps.</Text>
              <Text style={styles.subtitle}>
                Fresh ideas for your next grocery run.
              </Text>
            </View>

            <View style={styles.tabs} accessibilityRole="tablist">
              {TABS.map((entry) => {
                const selected = tab === entry.id;
                const label = `${entry.label} (${counts[entry.id]})`;

                return (
                  <Pressable
                    key={entry.id}
                    accessibilityRole="tab"
                    accessibilityState={{ selected }}
                    accessibilityLabel={`${entry.label} swaps (${counts[entry.id]})`}
                    onPress={() => {
                      setTab(entry.id);
                      setSelectedFood(null);
                    }}
                    style={[styles.tab, selected && styles.activeTab]}
                  >
                    <Text
                      numberOfLines={1}
                      style={[
                        styles.tabLabel,
                        selected && styles.activeTabLabel,
                      ]}
                    >
                      {label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.notice}>
              <Text style={styles.note}>
                From items in your pantry · Comparisons are general, not verified
                product matches.
              </Text>
            </View>

            {swaps.error ? (
              <View style={styles.errorCard}>
                <Text style={styles.errorTitle}>Couldn’t load swaps</Text>

                <Text style={styles.errorBody} role="alert">
                  {swaps.error}
                </Text>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Retry loading swaps"
                  onPress={swaps.retry}
                  style={({ pressed }) => [
                    styles.retryButton,
                    pressed && styles.retryButtonPressed,
                  ]}
                >
                  <Text style={styles.retryButtonLabel}>Try again</Text>
                </Pressable>
              </View>
            ) : null}

            {tab === "suggested" && selectedFood !== null ? (
              <View style={styles.relatedHeader}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Back to suggested swaps"
                  onPress={() => setSelectedFood(null)}
                  style={({ pressed }) => [
                    styles.backToSuggested,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={styles.backToSuggestedLabel}>‹ All swaps</Text>
                </Pressable>
                <Text style={styles.relatedHeading}>
                  More swaps for {selectedFood}
                </Text>
                <Text style={styles.relatedDescription}>
                  Compare other suggestions for this pantry food.
                </Text>
              </View>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          swaps.loading ? (
            <View style={styles.loadingCard} testID="swaps-loading">
              <ActivityIndicator color={colors.primary} />
              <Text style={styles.loadingLabel}>Finding swaps…</Text>
            </View>
          ) : swaps.error ? undefined : tab === "suggested" &&
            selectedFood !== null ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>
                No more swaps for {selectedFood}.
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Back to suggested swaps"
                onPress={() => setSelectedFood(null)}
                style={({ pressed }) => [
                  styles.backToSuggested,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.backToSuggestedLabel}>
                  Back to suggested swaps
                </Text>
              </Pressable>
            </View>
          ) : (
            // Error cards render above regardless of data; this only avoids a
            // misleading “all caught up” placeholder when the load failed.
            <View style={styles.emptyState}>
              {tab === "suggested" && swaps.generating ? (
                <ActivityIndicator color={colors.primary} />
              ) : null}
              <Text style={styles.emptyTitle}>{emptyCopy.title}</Text>

              <Text style={styles.emptyDescription}>
                {emptyCopy.description}
              </Text>
            </View>
          )
        }
        renderItem={({ item: card }) => renderSwapCard(card)}
        ListFooterComponent={
          tab === "suggested" ? undefined : (
            <Text style={styles.footer}>
              Saved and dismissed swaps stay with your account. Restore a dismissed
              swap to see it in Suggested again.
            </Text>
          )
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    alignItems: "stretch",
    padding: 24,
    paddingTop: 16,
    paddingBottom: 32,
    gap: 20,
  },
  header: {
    width: "100%",
    maxWidth: 480,
    alignSelf: "center",
    gap: 20,
  },
  pressed: {
    opacity: 0.75,
  },
  relatedHeader: {
    width: "100%",
    maxWidth: 480,
    alignSelf: "center",
    gap: 8,
  },
  backToSuggested: {
    alignSelf: "flex-start",
    minHeight: 40,
    justifyContent: "center",
  },
  backToSuggestedLabel: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: "700",
  },
  relatedHeading: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "700",
  },
  relatedDescription: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19,
  },
  cardContainer: {
    width: "100%",
    maxWidth: 480,
    alignSelf: "center",
  },
  brand: {
    color: colors.primary,
    fontSize: 17,
  },
  heading: {
    color: colors.text,
    fontSize: 32,
    fontWeight: "700",
    letterSpacing: -0.7,
  },
  subtitle: {
    marginTop: 6,
    color: colors.muted,
    fontSize: 14,
    lineHeight: 21,
  },
  tabs: {
    flexDirection: "row",
    padding: 4,
    borderRadius: 24,
    backgroundColor: colors.paleGreen,
  },
  tab: {
    flex: 1,
    minHeight: 44,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 4,
    borderRadius: 20,
  },
  activeTab: {
    backgroundColor: colors.primary,
  },
  tabLabel: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: "600",
  },
  activeTabLabel: {
    color: colors.surface,
  },
  notice: {
    paddingHorizontal: 4,
  },
  note: {
    color: colors.muted,
    fontSize: 11,
    lineHeight: 17,
  },
  errorCard: {
    width: "100%",
    maxWidth: 480,
    alignSelf: "center",
    padding: 20,
    borderRadius: radii.card,
    backgroundColor: colors.surface,
    alignItems: "flex-start",
    gap: 8,
  },
  errorTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "700",
  },
  errorBody: {
    color: "#B3261E",
    fontSize: 13,
    lineHeight: 19,
  },
  retryButton: {
    minHeight: 44,
    marginTop: 4,
    paddingHorizontal: 20,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.button,
    backgroundColor: colors.primary,
  },
  retryButtonPressed: {
    backgroundColor: colors.primaryPressed,
  },
  retryButtonLabel: {
    color: colors.surface,
    fontSize: 14,
    fontWeight: "600",
  },
  loadingCard: {
    width: "100%",
    maxWidth: 480,
    alignSelf: "center",
    paddingHorizontal: 24,
    paddingVertical: 36,
    borderRadius: radii.card,
    backgroundColor: colors.surface,
    alignItems: "center",
    gap: 12,
  },
  loadingLabel: {
    color: colors.muted,
    fontSize: 13,
  },
  emptyState: {
    width: "100%",
    maxWidth: 480,
    alignSelf: "center",
    paddingHorizontal: 24,
    paddingVertical: 36,
    borderRadius: radii.card,
    backgroundColor: colors.surface,
    alignItems: "center",
    gap: 10,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "600",
    textAlign: "center",
  },
  emptyDescription: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 21,
    textAlign: "center",
  },
  footer: {
    width: "100%",
    maxWidth: 480,
    alignSelf: "center",
    color: colors.muted,
    fontSize: 11,
    lineHeight: 17,
    textAlign: "center",
  },
});
