import { Stack } from "expo-router";

import { colors } from "../../constants/app-theme";

/**
 * Receipts group: a nested stack so history → detail keeps the tab bar out of
 * view and back gestures return to the list. The root stack registers this
 * group inside `Stack.Protected` (authenticated only).
 */
export default function ReceiptsLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="[id]" />
    </Stack>
  );
}
