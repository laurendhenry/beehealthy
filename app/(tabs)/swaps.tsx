/**
 * Swaps tab: suggested / saved / dismissed lists with per-card
 * save/dismiss/restore and rollback. No bulk restore — dismissed cards are
 * restored individually.
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

import { useSwaps } from "../../hooks/useSwaps";
import { SwapCard } from "../../components/swaps/SwapCard";
import { colors, radii } from "../../constants/app-theme";
import type { SwapTab } from "../../types/swaps";

const TABS: { id: SwapTab; label: string }[] = [
  { id: "suggested", label: "Suggested" },
  { id: "saved", label: "Saved" },
  { id: "dismissed", label: "Dismissed" },
];

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

  const list =
    tab === "suggested"
      ? swaps.suggested
      : tab === "saved"
        ? swaps.saved
        : swaps.dismissed;

  const counts: Record<SwapTab, number> = {
    suggested: swaps.suggested.length,
    saved: swaps.saved.length,
    dismissed: swaps.dismissed.length,
  };

  const emptyCopy = EMPTY_COPY[tab];

  return (
    <SafeAreaView
      style={styles.page}
      edges={["top", "left", "right"]}
      testID="swaps-screen"
    >
      <FlatList
        data={list}
        keyExtractor={(card) => card.swap.id}
        extraData={tab}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={swaps.loading}
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
                    onPress={() => setTab(entry.id)}
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
          </View>
        }
        ListEmptyComponent={
          swaps.loading ? (
            <View style={styles.loadingCard} testID="swaps-loading">
              <ActivityIndicator color={colors.primary} />
              <Text style={styles.loadingLabel}>Finding swaps…</Text>
            </View>
          ) : swaps.error ? null : (
            // Error cards render above regardless of data; this only avoids a
            // misleading “all caught up” placeholder when the load failed.
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>{emptyCopy.title}</Text>

              <Text style={styles.emptyDescription}>
                {emptyCopy.description}
              </Text>
            </View>
          )
        }
        renderItem={({ item: card }) => (
          <SwapCard
            swap={card.swap}
            variant={tab}
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
        )}
        ListFooterComponent={
          <Text style={styles.footer}>
            Saved and dismissed swaps stay with your account. Restore a dismissed
            swap to see it in Suggested again.
          </Text>
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
    padding: 24,
    paddingTop: 16,
    paddingBottom: 32,
    gap: 20,
  },
  header: {
    gap: 20,
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
    color: colors.muted,
    fontSize: 11,
    lineHeight: 17,
    textAlign: "center",
  },
});
