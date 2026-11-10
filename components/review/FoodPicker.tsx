/**
 * Full-screen food picker for one receipt line.
 *
 * Opens prefilled with the server's suggested query and lists the matcher's
 * suggestions before the person types. Results come from `/foods/search`;
 * picking a USDA reference result first resolves (promotes) it into a catalog
 * food, so the receipt only ever links real catalog ids.
 */

import { useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { Lucide } from "@react-native-vector-icons/lucide";

import { colors } from "../../constants/app-theme";
import { useFoodSearch } from "../../hooks/useFoodSearch";
import { resolveFood } from "../../lib/api/discovery";
import { foodOptionKey } from "../../lib/food-search";
import type { FoodOption, FoodSummary } from "../../types/api";
import { ui } from "../receipt/ReceiptUI";

type FoodPickerProps = {
  visible: boolean;
  /** Receipt text, shown for context. */
  itemName: string;
  initialQuery: string;
  suggestions: FoodOption[];
  currentFoodId: string | null;
  onSelect: (food: FoodSummary) => void;
  onClose: () => void;
};

export function FoodPicker(props: FoodPickerProps) {
  return (
    <Modal
      visible={props.visible}
      animationType="slide"
      presentationStyle={Platform.OS === "ios" ? "pageSheet" : "fullScreen"}
      onRequestClose={props.onClose}
    >
      {/* Remount per opening so the query starts from the suggestion again. */}
      {props.visible ? <PickerContent {...props} /> : null}
    </Modal>
  );
}

function PickerContent({
  itemName,
  initialQuery,
  suggestions,
  currentFoodId,
  onSelect,
  onClose,
}: FoodPickerProps) {
  const [query, setQuery] = useState(initialQuery);
  const [resolving, setResolving] = useState<string | null>(null);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const search = useFoodSearch(query);
  const typed = query.trim() !== initialQuery.trim();

  // Before the person edits the query, the matcher's suggestions lead.
  const showSuggestions = !typed && suggestions.length > 0;
  const options = showSuggestions ? suggestions : search.results;

  async function pick(option: FoodOption) {
    if (resolving) {
      return;
    }
    setResolveError(null);
    if (option.id) {
      onSelect({ id: option.id, name: option.name, category: option.category ?? "other" });
      return;
    }
    if (option.fdcId === null) {
      return;
    }
    const key = foodOptionKey(option);
    setResolving(key);
    try {
      onSelect(await resolveFood(option.fdcId));
    } catch {
      setResolveError("That food could not be added right now. Try again or pick another.");
    } finally {
      setResolving(null);
    }
  }

  let listHeader: string | null = null;
  if (showSuggestions) {
    listHeader = "Suggested";
  } else if (search.status === "done" && options.length > 0) {
    listHeader = "Results";
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.page} edges={["top", "bottom", "left", "right"]}>
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={ui.title}>Choose a food</Text>
            <Text style={ui.muted} numberOfLines={1}>
              Receipt line: {itemName || "New item"}
            </Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} hitSlop={10}>
            <Lucide name="x" size={24} color={colors.text} />
          </Pressable>
        </View>

        <View style={styles.searchBox}>
          <Lucide name="search" size={18} color={colors.muted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={search.submit}
            placeholder="Search foods, e.g. oat milk"
            placeholderTextColor={colors.muted}
            autoFocus={suggestions.length === 0}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            accessibilityLabel="Search foods"
            style={styles.searchInput}
          />
          {search.status === "loading" && typed ? <ActivityIndicator color={colors.primary} /> : null}
          {query.length > 0 ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => setQuery("")} hitSlop={8}>
              <Lucide name="x" size={16} color={colors.muted} />
            </Pressable>
          ) : null}
        </View>

        {resolveError ? <Text style={[ui.muted, styles.notice]}>{resolveError}</Text> : null}

        <FlatList
          data={options}
          keyExtractor={foodOptionKey}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.list}
          ListHeaderComponent={listHeader ? <Text style={styles.section}>{listHeader}</Text> : undefined}
          ListEmptyComponent={
            <EmptyState
              status={search.status}
              error={search.error}
              term={search.term}
              onRetry={search.retry}
            />
          }
          renderItem={({ item }) => {
            const key = foodOptionKey(item);
            const selected = item.id !== null && item.id === currentFoodId;
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${item.name}${item.category ? `, ${item.category}` : ""}`}
                accessibilityState={{ selected, busy: resolving === key }}
                disabled={resolving !== null}
                onPress={() => void pick(item)}
                style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              >
                <View style={styles.rowText}>
                  <Text style={ui.text}>{item.name}</Text>
                  {item.category ? <Text style={ui.muted}>{capitalize(item.category)}</Text> : null}
                </View>
                {resolving === key ? (
                  <ActivityIndicator color={colors.primary} />
                ) : selected ? (
                  <Lucide name="check" size={18} color={colors.primary} />
                ) : (
                  <Lucide name="chevron-right" size={18} color={colors.muted} />
                )}
              </Pressable>
            );
          }}
        />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

function EmptyState({
  status,
  error,
  term,
  onRetry,
}: {
  status: "idle" | "loading" | "done" | "error";
  error: string | null;
  term: string;
  onRetry: () => void;
}) {
  if (status === "loading") {
    return (
      <View style={styles.empty}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  if (status === "error") {
    return (
      <View style={styles.empty}>
        <Text style={ui.text}>{error}</Text>
        <Pressable accessibilityRole="button" onPress={onRetry}>
          <Text style={ui.link}>Try again</Text>
        </Pressable>
      </View>
    );
  }
  if (status === "done") {
    return (
      <View style={styles.empty}>
        <Text style={ui.text}>No foods match “{term}”.</Text>
        <Text style={ui.muted}>Try a simpler name, like “yogurt” instead of a brand.</Text>
      </View>
    );
  }
  return (
    <View style={styles.empty}>
      <Text style={ui.muted}>Type at least two letters to search.</Text>
    </View>
  );
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
  },
  headerText: {
    flex: 1,
    gap: 2,
  },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 20,
    paddingHorizontal: 12,
    minHeight: 46,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.text,
  },
  notice: {
    marginHorizontal: 20,
    marginTop: 8,
  },
  list: {
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  section: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    marginBottom: 4,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  pressed: {
    opacity: 0.6,
  },
  empty: {
    alignItems: "center",
    gap: 8,
    paddingVertical: 32,
  },
});
