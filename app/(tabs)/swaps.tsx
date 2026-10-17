import { useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { SwapCard } from "../../components/swaps/SwapCard";
import { colors } from "../../constants/app-theme";
import { mockSwaps } from "../../data/mock-swaps";

type SwapTab = "suggested" | "saved";

export default function SwapsScreen() {
  const [activeTab, setActiveTab] = useState<SwapTab>("suggested");
  const [savedIds, setSavedIds] = useState<string[]>([]);
  const [dismissedIds, setDismissedIds] = useState<string[]>([]);

  // Replace this source with backend data when it is ready.
  const swaps = mockSwaps;

  const suggestedSwaps = swaps.filter(
    (swap) =>
      !savedIds.includes(swap.id) &&
      !dismissedIds.includes(swap.id)
  );

  const savedSwaps = swaps.filter((swap) =>
    savedIds.includes(swap.id)
  );

  const visibleSwaps =
    activeTab === "suggested" ? suggestedSwaps : savedSwaps;

  function saveSwap(id: string) {
    setSavedIds((current) =>
      current.includes(id) ? current : [...current, id]
    );
  }

  function dismissSwap(id: string) {
    setDismissedIds((current) =>
      current.includes(id) ? current : [...current, id]
    );
  }

  function removeSavedSwap(id: string) {
    setSavedIds((current) =>
      current.filter((savedId) => savedId !== id)
    );
  }

  return (
    <SafeAreaView
      style={styles.page}
      edges={["top", "left", "right"]}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.brand}>♧ sprout</Text>

        <View>
          <Text style={styles.heading}>Small swaps.</Text>
          <Text style={styles.subtitle}>
            Fresh ideas for your next grocery run.
          </Text>
        </View>

        <View style={styles.tabs}>
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{
              selected: activeTab === "suggested",
            }}
            onPress={() => setActiveTab("suggested")}
            style={[
              styles.tab,
              activeTab === "suggested" && styles.activeTab,
            ]}
          >
            <Text
              style={[
                styles.tabLabel,
                activeTab === "suggested" && styles.activeTabLabel,
              ]}
            >
              Suggested ({suggestedSwaps.length})
            </Text>
          </Pressable>

          <Pressable
            accessibilityRole="tab"
            accessibilityState={{
              selected: activeTab === "saved",
            }}
            onPress={() => setActiveTab("saved")}
            style={[
              styles.tab,
              activeTab === "saved" && styles.activeTab,
            ]}
          >
            <Text
              style={[
                styles.tabLabel,
                activeTab === "saved" && styles.activeTabLabel,
              ]}
            >
              Saved ({savedSwaps.length})
            </Text>
          </Pressable>
        </View>

        <View style={styles.demoNotice}>
          <Text style={styles.note}>
            Demo suggestions · Not generated from your receipt.
            Comparisons are general, not verified product matches.
          </Text>
        </View>

        {visibleSwaps.length > 0 ? (
          visibleSwaps.map((swap) => (
            <SwapCard
              key={swap.id}
              swap={swap}
              saved={activeTab === "saved"}
              onSave={() => saveSwap(swap.id)}
              onDismiss={() => dismissSwap(swap.id)}
              onRemove={() => removeSavedSwap(swap.id)}
            />
          ))
        ) : (
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>
              {activeTab === "saved"
                ? "Your ideas, saved here."
                : "You’re all caught up."}
            </Text>

            <Text style={styles.emptyDescription}>
              {activeTab === "saved"
                ? "Save a suggestion to keep it for your next grocery run."
                : "Check your saved swaps, or restore dismissed suggestions."}
            </Text>
          </View>
        )}

        {activeTab === "suggested" && dismissedIds.length > 0 && (
          <Pressable
            accessibilityRole="button"
            onPress={() => setDismissedIds([])}
            style={styles.restoreButton}
          >
            <Text style={styles.restoreLabel}>
              Restore dismissed suggestions
            </Text>
          </Pressable>
        )}

        <Text style={styles.footer}>
          Saved and dismissed choices stay in memory during this session.
          They reset when the app reloads.
        </Text>
      </ScrollView>
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
    borderRadius: 20,
  },
  activeTab: {
    backgroundColor: colors.primary,
  },
  tabLabel: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: "600",
  },
  activeTabLabel: {
    color: colors.surface,
  },
  demoNotice: {
    paddingHorizontal: 4,
  },
  note: {
    color: colors.muted,
    fontSize: 11,
    lineHeight: 17,
  },
  emptyState: {
    paddingHorizontal: 24,
    paddingVertical: 36,
    borderRadius: 24,
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
  restoreButton: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  restoreLabel: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: "600",
  },
  footer: {
    color: colors.muted,
    fontSize: 11,
    lineHeight: 17,
    textAlign: "center",
  },
});