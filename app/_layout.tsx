import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";

import { ReceiptProvider } from "../context/ReceiptContext";
import { colors } from "../constants/app-theme";

export default function RootLayout() {
  return (
    <ReceiptProvider>
      <StatusBar style="dark" />

      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: {
            backgroundColor: colors.background,
          },
        }}
      >
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="review-receipt" />
      </Stack>
    </ReceiptProvider>
  );
}