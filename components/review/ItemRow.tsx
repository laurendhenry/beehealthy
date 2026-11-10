import { Pressable, StyleSheet, Text, View } from "react-native";
import { Lucide } from "@react-native-vector-icons/lucide";

import { colors } from "../../constants/app-theme";
import { itemReviewChip } from "../../lib/receipt-workflow";
import type { ReceiptFormItem } from "../../types/receipt";
import { ui } from "../receipt/ReceiptUI";
import { ItemChip } from "./ItemChip";

/** One compact receipt line: text, quantity × price and its match chip. */
export function ItemRow({
  item,
  onPress,
}: {
  item: ReceiptFormItem;
  onPress: () => void;
}) {
  const chip = itemReviewChip(item);
  const name = item.name.trim() || "New item";
  const status =
    chip.kind === "confirm" ? `suggested ${chip.label}, confirm or change` : chip.label;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${status}`}
      accessibilityHint="Opens this item for editing"
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={styles.main}>
        <View style={ui.row}>
          <Text style={[ui.text, styles.name]} numberOfLines={2}>
            {name}
          </Text>
          <Text style={ui.text}>{item.lineTotal ? `$${item.lineTotal}` : "—"}</Text>
        </View>
        <View style={styles.meta}>
          <ItemChip chip={chip} />
          {chip.kind === "confirm" ? <Text style={styles.hint}>Confirm or change</Text> : null}
          {item.quantity && item.quantity !== "1" ? (
            <Text style={ui.muted}>Qty {item.quantity}</Text>
          ) : null}
        </View>
      </View>
      <Lucide name="chevron-right" size={18} color={colors.muted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  pressed: {
    opacity: 0.6,
  },
  main: {
    flex: 1,
    gap: 6,
  },
  name: {
    flex: 1,
    fontWeight: "600",
  },
  meta: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
  },
  hint: {
    color: "#7A5A24",
    fontSize: 11,
  },
});
