import { StyleSheet, Text, View } from "react-native";
import { Lucide } from "@react-native-vector-icons/lucide";

import { colors } from "../../constants/app-theme";
import type { ItemReviewChip } from "../../lib/receipt-workflow";

const CHECK_BACKGROUND = "#F2E8D8";
const CHECK_TEXT = "#7A5A24";

/** Compact match status: ✓ food · ? food · Unmatched · Not food. */
export function ItemChip({ chip }: { chip: ItemReviewChip }) {
  const tone = TONES[chip.kind];
  return (
    <View style={[styles.chip, { backgroundColor: tone.background }]}>
      <Lucide name={tone.icon} size={12} color={tone.text} />
      <Text style={[styles.label, { color: tone.text }]} numberOfLines={1}>
        {chip.label}
      </Text>
    </View>
  );
}

const TONES = {
  matched: { icon: "check", background: colors.paleGreen, text: colors.primary },
  confirm: { icon: "circle-help", background: CHECK_BACKGROUND, text: CHECK_TEXT },
  unmatched: { icon: "circle-alert", background: CHECK_BACKGROUND, text: CHECK_TEXT },
  nonFood: { icon: "ban", background: colors.track, text: colors.muted },
} as const;

const styles = StyleSheet.create({
  chip: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 4,
    maxWidth: "100%",
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  label: {
    flexShrink: 1,
    fontSize: 11,
    fontWeight: "600",
  },
});
