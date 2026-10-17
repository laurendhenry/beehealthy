import { Pressable, StyleSheet, Text, View } from "react-native";

import { colors, radii } from "../../constants/app-theme";
import type { FoodSwap } from "../../types/swaps";

type Props = {
  swap: FoodSwap;
  saved: boolean;
  onSave: () => void;
  onDismiss: () => void;
  onRemove: () => void;
};

export function SwapCard({
  swap,
  saved,
  onSave,
  onDismiss,
  onRemove,
}: Props) {
  return (
    <View style={styles.card}>
      <Text style={styles.label}>YOUR ITEM</Text>
      <Text style={styles.itemName}>{swap.originalItem}</Text>

      <Text style={styles.arrow}>↓</Text>

      <View style={styles.alternative}>
        <Text style={styles.label}>TRY INSTEAD</Text>
        <Text style={styles.itemName}>{swap.suggestedItem}</Text>
      </View>

      <View style={styles.explanation}>
        <Text style={styles.explanationTitle}>Why it fits</Text>
        <Text style={styles.body}>{swap.similarity}</Text>
      </View>

      <View style={styles.explanation}>
        <Text style={styles.explanationTitle}>Why consider it</Text>
        <Text style={styles.body}>{swap.benefit}</Text>
      </View>

      {saved ? (
        <View style={styles.actions}>
          <Text style={styles.savedLabel}>✓ Saved</Text>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Remove ${swap.suggestedItem} from saved`}
            onPress={onRemove}
            style={styles.textButton}
          >
            <Text style={styles.textButtonLabel}>Remove</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Save swap to ${swap.suggestedItem}`}
            onPress={onSave}
            style={({ pressed }) => [
              styles.saveButton,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.saveButtonLabel}>Save swap</Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Dismiss swap for ${swap.originalItem}`}
            onPress={onDismiss}
            style={styles.textButton}
          >
            <Text style={styles.textButtonLabel}>Dismiss</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 20,
    borderRadius: radii.card,
    backgroundColor: colors.surface,
  },
  label: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: "600",
    letterSpacing: 1,
  },
  itemName: {
    marginTop: 6,
    color: colors.text,
    fontSize: 18,
    fontWeight: "600",
    lineHeight: 25,
  },
  arrow: {
    marginVertical: 8,
    marginLeft: 8,
    color: colors.primary,
    fontSize: 24,
  },
  alternative: {
    padding: 16,
    borderRadius: 16,
    backgroundColor: colors.paleGreen,
  },
  explanation: {
    marginTop: 16,
    gap: 4,
  },
  explanationTitle: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: "700",
  },
  body: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 21,
  },
  actions: {
    marginTop: 20,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 16,
  },
  saveButton: {
    minHeight: 46,
    paddingHorizontal: 24,
    justifyContent: "center",
    borderRadius: radii.button,
    backgroundColor: colors.primary,
  },
  saveButtonLabel: {
    color: colors.surface,
    fontSize: 14,
    fontWeight: "600",
  },
  textButton: {
    minHeight: 46,
    paddingHorizontal: 8,
    justifyContent: "center",
  },
  textButtonLabel: {
    color: colors.muted,
    fontSize: 13,
  },
  savedLabel: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: "600",
  },
  pressed: {
    opacity: 0.75,
  },
});