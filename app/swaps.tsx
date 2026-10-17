import { StyleSheet, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors } from "../constants/app-theme";

export default function SwapsScreen() {
  return (
    <SafeAreaView
      style={styles.container}
      edges={["top", "left", "right"]}
    >
      <Text style={styles.heading}>Small swaps.</Text>

      <Text style={styles.description}>
        Fresh ideas for your next grocery run.
      </Text>

      <Text style={styles.note}>
        Food swap cards and save/dismiss interactions will go here.
      </Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 20,
    backgroundColor: colors.background,
  },
  heading: {
    fontSize: 30,
    fontWeight: "700",
    color: colors.text,
  },
  description: {
    marginTop: 8,
    fontSize: 14,
    color: colors.muted,
  },
  note: {
    marginTop: 28,
    fontSize: 14,
    lineHeight: 22,
    color: colors.text,
  },
});