/**
 * Swaps tab: suggested / saved / dismissed lists with per-card
 * save/dismiss/restore and rollback. No bulk restore — dismissed cards are
 * restored individually.
 */

import { useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { useSwaps } from "../../hooks/useSwaps";
import { SwapCard } from "../../components/swaps/SwapCard";
import type { SwapTab } from "../../types/swaps";

const TABS: { id: SwapTab; label: string }[] = [
  { id: "suggested", label: "Suggested" },
  { id: "saved", label: "Saved" },
  { id: "dismissed", label: "Dismissed" },
];

export default function SwapsScreen() {
  const swaps = useSwaps();
  const [tab, setTab] = useState<SwapTab>("suggested");

  const list =
    tab === "suggested"
      ? swaps.suggested
      : tab === "saved"
        ? swaps.saved
        : swaps.dismissed;

  return (
    <View style={styles.container} testID="swaps-screen">
      <Text style={styles.heading}>Swaps</Text>
      <View style={styles.tabs} accessibilityRole="tablist">
        {TABS.map((entry) => (
          <Pressable
            key={entry.id}
            style={[styles.tab, tab === entry.id && styles.tabActive]}
            onPress={() => setTab(entry.id)}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === entry.id }}
            accessibilityLabel={`${entry.label} swaps`}
          >
            <Text
              style={[styles.tabText, tab === entry.id && styles.tabTextActive]}
            >
              {entry.label}
            </Text>
          </Pressable>
        ))}
      </View>
      {swaps.error ? (
        <View style={styles.banner}>
          <Text style={styles.error} role="alert">
            {swaps.error}
          </Text>
          <Pressable
            style={styles.button}
            onPress={swaps.retry}
            accessibilityRole="button"
            accessibilityLabel="Retry loading swaps"
          >
            <Text style={styles.buttonText}>Retry</Text>
          </Pressable>
        </View>
      ) : null}
      <FlatList
        data={list}
        keyExtractor={(card) => card.swap.id}
        refreshing={swaps.loading}
        onRefresh={swaps.refresh}
        ListEmptyComponent={
          swaps.loading ? (
            <ActivityIndicator testID="swaps-loading" />
          ) : (
            <Text style={styles.muted}>
              {tab === "suggested"
                ? "No suggestions right now."
                : tab === "saved"
                  ? "No saved swaps yet."
                  : "No dismissed swaps."}
            </Text>
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
                    onRestore: () =>
                      void (tab === "dismissed"
                        ? swaps.restore(card.swap.id)
                        : swaps.unsave(card.swap.id)),
                  }
            }
          />
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f6f6f6",
    padding: 16,
  },
  heading: {
    fontSize: 22,
    fontWeight: "700",
    marginBottom: 12,
  },
  tabs: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 12,
  },
  tab: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#1a73e8",
    paddingVertical: 6,
    paddingHorizontal: 14,
  },
  tabActive: {
    backgroundColor: "#1a73e8",
  },
  tabText: {
    color: "#1a73e8",
    fontWeight: "600",
  },
  tabTextActive: {
    color: "#fff",
  },
  banner: {
    marginBottom: 12,
  },
  error: {
    fontSize: 14,
    color: "#b3261e",
  },
  muted: {
    fontSize: 14,
    color: "#666",
    marginTop: 12,
    textAlign: "center",
  },
  button: {
    backgroundColor: "#1a73e8",
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
    marginTop: 8,
    alignSelf: "flex-start",
  },
  buttonText: {
    color: "#fff",
    fontWeight: "600",
  },
});
