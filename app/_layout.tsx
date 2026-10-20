import { useEffect } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { SplashScreen, Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";

import { AuthProvider, useAuth } from "../context/AuthContext";
import { AppDataProvider, useAppData } from "../context/AppDataContext";
import { ReceiptProvider } from "../context/ReceiptContext";
import { colors } from "../constants/app-theme";
import { getAuthCookie } from "../lib/auth-client";
import { configureApi } from "../lib/api/pantry";
import { configureTransport } from "../lib/api/client";

// Wire before rendering consumers: native fetch does not share Better Auth's
// SecureStore cookie jar. Read it afresh for every request (login/refresh/logout).
configureApi({ getCookieHeader: getAuthCookie });
configureTransport({ cookieProvider: getAuthCookie });

void SplashScreen.preventAutoHideAsync();

/**
 * Root layout: bootstrap auth before exposing protected content.
 *
 * - Fixes the `review-receipt` vs `review_receipt` mismatch: the screen name
 *   must match the file `app/review_receipt.tsx`.
 * - `Stack.Protected` (Router 6) gates authenticated vs public routes.
 * - Redirects preserve only validated internal routes (no open redirects).
 */
function AuthGate({ children }: { children: React.ReactNode }) {
  const { bootstrapped, status } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (!bootstrapped) return;
    void SplashScreen.hideAsync().catch(() => undefined);
    const inAuthGroup = segments[0] === "(auth)";
    if (status === "unauthenticated" && !inAuthGroup) {
      router.replace("/(auth)/sign-in");
    } else if (status === "authenticated" && inAuthGroup) {
      router.replace("/(tabs)");
    }
  }, [bootstrapped, status, segments, router]);

  if (!bootstrapped) {
    return (
      <View style={styles.loading} accessibilityRole="progressbar">
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }
  return <>{children}</>;
}
/**
 * Syncs the auth session's user id into the account-scoped app-data provider
 * (which enables the server queries) and clears account data on
 * logout/account-switch. Must render inside both providers.
 */
function AuthDataBridge({ children }: { children: React.ReactNode }) {
  const { userId, onSessionInvalidated } = useAuth();
  const { setUserId, resetAll } = useAppData();

  useEffect(() => {
    setUserId(userId);
  }, [userId, setUserId]);

  useEffect(() => onSessionInvalidated(resetAll), [onSessionInvalidated, resetAll]);

  return <>{children}</>;
}

function RootNavigator() {
  const { status, bootstrapped } = useAuth();
  const isAuthenticated = bootstrapped && status === "authenticated";

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: {
          backgroundColor: colors.background,
        },
      }}
    >
      <Stack.Protected guard={isAuthenticated}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="review_receipt" />
        <Stack.Screen name="pantry" />
        <Stack.Screen name="profile" />
      </Stack.Protected>
      <Stack.Protected guard={bootstrapped && !isAuthenticated}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <AppDataProvider>
        <ReceiptProvider>
          <StatusBar style="dark" />
          <AuthDataBridge>
            <AuthGate>
              <RootNavigator />
            </AuthGate>
          </AuthDataBridge>
        </ReceiptProvider>
      </AppDataProvider>
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.background,
  },
});
