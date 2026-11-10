/**
 * Sheet for one receipt line: name/quantity/price and its food link.
 * Editing the name clears the food (the receipt text no longer proves it).
 */

import { useState } from "react";
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { Lucide } from "@react-native-vector-icons/lucide";

import { colors } from "../../constants/app-theme";
import { itemReviewChip } from "../../lib/receipt-workflow";
import type { FoodSummary } from "../../types/api";
import type { ReceiptFormItem } from "../../types/receipt";
import { ReceiptButton, ReceiptField, ui } from "../receipt/ReceiptUI";
import { FoodPicker } from "./FoodPicker";
import { ItemChip } from "./ItemChip";

type ItemEditorProps = {
  item: ReceiptFormItem | null;
  canEdit: boolean;
  canRemove: boolean;
  hasNext: boolean;
  onChange: (patch: Partial<Pick<ReceiptFormItem, "name" | "quantity" | "lineTotal">>) => void;
  onSelectFood: (food: FoodSummary) => void;
  /** Accept the suggested (mid-confidence) food as-is. */
  onConfirmFood: () => void;
  onClearFood: () => void;
  onRemove: () => void;
  onNext: () => void;
  onClose: () => void;
};

export function ItemEditor(props: ItemEditorProps) {
  return (
    <Modal
      visible={props.item !== null}
      animationType="slide"
      presentationStyle={Platform.OS === "ios" ? "pageSheet" : "fullScreen"}
      onRequestClose={props.onClose}
    >
      {props.item ? <EditorContent {...props} item={props.item} /> : null}
    </Modal>
  );
}

function EditorContent({
  item,
  canEdit,
  canRemove,
  hasNext,
  onChange,
  onSelectFood,
  onConfirmFood,
  onClearFood,
  onRemove,
  onNext,
  onClose,
}: ItemEditorProps & { item: ReceiptFormItem }) {
  const [picking, setPicking] = useState(false);
  const chip = itemReviewChip(item);
  const food = item.foodId ? item.food : null;

  let foodCopy = "No food linked. Pick one so this item counts toward your pantry insights.";
  if (chip.kind === "nonFood") {
    foodCopy =
      "This line doesn’t look like food, so it won’t count toward swaps. Remove it, or pick a food if it is one.";
  } else if (item.foodId && !food) {
    foodCopy = "A food is linked to this line.";
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.page} edges={["top", "bottom", "left", "right"]}>
        <View style={styles.header}>
          <Text style={[ui.title, styles.flex]}>{canEdit ? "Edit item" : "Item"}</Text>
          <Pressable accessibilityRole="button" onPress={onClose} hitSlop={10}>
            <Text style={ui.link}>Done</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <ReceiptField
            label="Receipt text"
            value={item.name}
            editable={canEdit}
            placeholder="Item name"
            onChangeText={(name) => onChange({ name })}
          />
          <View style={ui.row}>
            <ReceiptField
              label="Quantity"
              value={item.quantity}
              editable={canEdit}
              keyboardType="decimal-pad"
              onChangeText={(quantity) => onChange({ quantity })}
            />
            <ReceiptField
              label="Line total ($)"
              value={item.lineTotal}
              editable={canEdit}
              keyboardType="decimal-pad"
              onChangeText={(lineTotal) => onChange({ lineTotal })}
            />
          </View>

          <View style={styles.foodCard}>
            <View style={ui.row}>
              <Text style={ui.label}>Food</Text>
              <ItemChip chip={chip} />
            </View>
            {food ? (
              <View style={styles.food}>
                <Text style={ui.title}>{food.name}</Text>
                <Text style={ui.muted}>{capitalize(food.category)}</Text>
              </View>
            ) : (
              <Text style={ui.text}>{foodCopy}</Text>
            )}
            {chip.kind === "confirm" ? (
              <Text style={ui.muted}>We think this is the right food. Confirm it or pick another.</Text>
            ) : null}
            {canEdit ? (
              <View style={styles.actions}>
                {chip.kind === "confirm" ? (
                  <ReceiptButton title="Looks right" onPress={onConfirmFood} />
                ) : null}
                <ReceiptButton
                  title={item.foodId ? "Change food" : "Choose food"}
                  secondary={chip.kind === "confirm"}
                  onPress={() => setPicking(true)}
                />
                {item.foodId ? (
                  <Pressable accessibilityRole="button" onPress={onClearFood}>
                    <Text style={ui.link}>Clear</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}
            {canEdit && item.foodId ? (
              <Text style={ui.muted}>Changing the receipt text clears the linked food.</Text>
            ) : null}
          </View>

          {canEdit && canRemove ? (
            <Pressable accessibilityRole="button" onPress={onRemove} style={styles.remove}>
              <Lucide name="trash-2" size={16} color={colors.muted} />
              <Text style={[ui.link, styles.removeText]}>Remove this line</Text>
            </Pressable>
          ) : null}
        </ScrollView>

        {hasNext ? (
          <View style={styles.footer}>
            <ReceiptButton title="Next item to check" secondary onPress={onNext} />
          </View>
        ) : null}

        <FoodPicker
          visible={picking}
          itemName={item.name}
          initialQuery={item.review?.query || item.name}
          suggestions={item.review?.suggestions ?? []}
          currentFoodId={item.foodId}
          onSelect={(picked) => {
            onSelectFood(picked);
            setPicking(false);
          }}
          onClose={() => setPicking(false)}
        />
      </SafeAreaView>
    </SafeAreaProvider>
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
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
  },
  flex: {
    flex: 1,
  },
  content: {
    padding: 20,
    gap: 16,
  },
  foodCard: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: 16,
    gap: 10,
  },
  food: {
    gap: 2,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 12,
  },
  remove: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
  },
  removeText: {
    color: colors.muted,
  },
  footer: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
});
