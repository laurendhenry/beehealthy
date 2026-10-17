import { Text, View } from "react-native";
import { styles } from "./home.styles";

export function HomeHeader() {
  const dateLabel = new Date()
    .toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    })
    .toUpperCase();

  return (
    <>
      <View style={styles.topRow}>
        <View style={styles.brand}>
          <Text style={styles.brandIcon}>♧</Text>
          <Text style={styles.brandName}>sprout</Text>
        </View>

        <Text style={styles.date}>{dateLabel}</Text>
      </View>

      <Text style={styles.heading}>A fresh perspective.</Text>

      <Text style={styles.subtitle}>
        Little grocery choices. A healthier routine.
      </Text>
    </>
  );
}