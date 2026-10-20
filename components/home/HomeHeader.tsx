import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";

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

        <View style={styles.headerActions}>
          <Text style={styles.date}>{dateLabel}</Text>

          {/* Keep account preferences reachable from the dashboard. */}
          <Pressable
            accessibilityRole="link"
            accessibilityLabel="Profile, account preferences"
            hitSlop={12}
            onPress={() => router.push("/profile")}
            style={({ pressed }) => [
              styles.profileLink,
              pressed && styles.profileLinkPressed,
            ]}
            testID="home-profile-link"
          >
            <Text style={styles.profileLinkText}>Profile</Text>
          </Pressable>
        </View>
      </View>

      <Text style={styles.heading}>A fresh perspective.</Text>

      <Text style={styles.subtitle}>
        Little grocery choices. A healthier routine.
      </Text>
    </>
  );
}
