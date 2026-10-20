/**
 * Profile screen: read-only identity (name/email) plus editable timezone,
 * dietary preferences, and excluded ingredients. PATCH vs DELETE-reset on
 * preferences with confirmation. No preferencesJson editor. Currency and
 * locale stay fixed at USD / en-US.
 */

import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAppData } from "../context/AppDataContext";
import {
  ApiError,
  getCurrentUser,
  resetUserProfile,
  updateUserProfile,
  type CurrentUser,
  type UserProfile,
} from "../lib/api/pantry";
import { colors, radii } from "../constants/app-theme";

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

export default function ProfileScreen() {
  const { userId, invalidateFor } = useAppData();
  const router = useRouter();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const [timezone, setTimezone] = useState("");
  const [dietary, setDietary] = useState("");
  const [excluded, setExcluded] = useState("");

  const applyProfile = (profile: UserProfile) => {
    setTimezone(profile.timezone);
    setDietary(profile.dietaryPreferences.join(", "));
    setExcluded(profile.excludedIngredients.join(", "));
  };

  useEffect(() => {
    if (userId === null) {
      setUser(null);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    getCurrentUser(controller.signal)
      .then((current) => {
        if (controller.signal.aborted) return;
        setUser(current);
        applyProfile(current.profile);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        if (err instanceof Error && err.name === "AbortError") return;
        setError(
          err instanceof ApiError
            ? err.message
            : "Couldn't load your profile. Try again.",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [userId, reloadKey]);

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    const controller = new AbortController();
    try {
      const updated = await updateUserProfile(
        {
          timezone: timezone.trim(),
          dietaryPreferences: splitList(dietary),
          excludedIngredients: splitList(excluded),
        },
        controller.signal,
      );
      applyProfile(updated);
      setSaved(true);
      invalidateFor("profile-mutation");
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      setSaveError(
        err instanceof ApiError
          ? err.message
          : "Couldn't save your profile. Try again.",
      );
    } finally {
      setSaving(false);
    }
  };

  const resetPreferences = () => {
    Alert.alert(
      "Reset preferences?",
      "This clears your timezone, dietary preferences, and excluded ingredients back to defaults. Your name and email stay the same.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Reset",
          style: "destructive",
          onPress: () => {
            setSaving(true);
            setSaveError(null);
            setSaved(false);
            const controller = new AbortController();
            resetUserProfile(controller.signal)
              .then(() => getCurrentUser(controller.signal))
              .then((current) => {
                if (controller.signal.aborted) return;
                setUser(current);
                applyProfile(current.profile);
                invalidateFor("profile-mutation");
              })
              .catch((err: unknown) => {
                if (controller.signal.aborted) return;
                if (err instanceof Error && err.name === "AbortError") return;
                setSaveError(
                  err instanceof ApiError
                    ? err.message
                    : "Couldn't reset preferences. Try again.",
                );
              })
              .finally(() => {
                if (!controller.signal.aborted) setSaving(false);
              });
          },
        },
      ],
    );
  };

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/(tabs)");
    }
  };

  const initial = user?.name.trim().slice(0, 1).toUpperCase() || "?";

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          style={styles.container}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          testID="profile-screen"
        >
          <View style={styles.topRow}>
            <View style={styles.brandRow}>
              <View style={styles.brandMark}>
                <Text style={styles.brandIcon}>♧</Text>
              </View>
              <Text style={styles.brandName}>sprout</Text>
            </View>
            <Pressable
              onPress={handleBack}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Go back"
            >
              <Text style={styles.backLink}>‹ Back</Text>
            </Pressable>
          </View>

          <Text style={styles.heading} accessibilityRole="header">
            Profile
          </Text>
          <Text style={styles.subtitle}>
            Your details and food preferences.
          </Text>

          {loading ? (
            <View style={styles.stateCard}>
              <ActivityIndicator testID="profile-loading" color={colors.primary} />
              <Text style={styles.stateText}>Loading your profile…</Text>
            </View>
          ) : error ? (
            <View style={[styles.stateCard, styles.errorCard]}>
              <View style={styles.stateMark}>
                <Text style={styles.stateMarkText}>!</Text>
              </View>
              <Text style={styles.stateTitle}>Something went wrong</Text>
              <Text style={styles.stateError} role="alert">
                {error}
              </Text>
              <Pressable
                style={({ pressed }) => [
                  styles.button,
                  styles.primaryButton,
                  pressed && styles.pressed,
                ]}
                onPress={() => setReloadKey((current) => current + 1)}
                accessibilityRole="button"
                accessibilityLabel="Retry loading profile"
              >
                <Text style={styles.buttonText}>Try again</Text>
              </Pressable>
            </View>
          ) : user ? (
            <>
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <Text style={styles.cardTitle}>Account</Text>
                  <View style={styles.lockBadge}>
                    <Text style={styles.lockBadgeText}>Read only</Text>
                  </View>
                </View>

                <View style={styles.identityRow}>
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>{initial}</Text>
                  </View>
                  <View style={styles.identityText}>
                    <Text style={styles.label}>Name</Text>
                    <Text style={styles.name} testID="profile-name">
                      {user.name}
                    </Text>
                    <Text style={[styles.label, styles.emailLabel]}>Email</Text>
                    <Text style={styles.email} testID="profile-email">
                      {user.email}
                    </Text>
                  </View>
                </View>
              </View>

              <View style={styles.card}>
                <Text style={styles.cardTitle}>Preferences</Text>

                <View style={styles.field}>
                  <Text style={styles.label}>Timezone</Text>
                  <TextInput
                    style={styles.input}
                    value={timezone}
                    onChangeText={setTimezone}
                    placeholder="America/New_York"
                    placeholderTextColor={colors.muted}
                    selectionColor={colors.primary}
                    editable={!saving}
                    accessibilityLabel="Timezone"
                    testID="profile-timezone"
                  />
                </View>

                <View style={styles.field}>
                  <Text style={styles.label}>
                    Dietary preferences (comma-separated)
                  </Text>
                  <TextInput
                    style={styles.input}
                    value={dietary}
                    onChangeText={setDietary}
                    placeholder="vegetarian, gluten-free"
                    placeholderTextColor={colors.muted}
                    selectionColor={colors.primary}
                    editable={!saving}
                    accessibilityLabel="Dietary preferences, comma-separated"
                    testID="profile-dietary"
                  />
                </View>

                <View style={styles.field}>
                  <Text style={styles.label}>
                    Excluded ingredients (comma-separated)
                  </Text>
                  <TextInput
                    style={styles.input}
                    value={excluded}
                    onChangeText={setExcluded}
                    placeholder="peanuts, shellfish"
                    placeholderTextColor={colors.muted}
                    selectionColor={colors.primary}
                    editable={!saving}
                    accessibilityLabel="Excluded ingredients, comma-separated"
                    testID="profile-excluded"
                  />
                </View>

                <View style={styles.fixedNote}>
                  <Text style={styles.fixed}>
                    Currency USD · Language English (US) — these stay fixed.
                  </Text>
                </View>

                {saveError ? (
                  <View style={styles.saveErrorBanner}>
                    <Text style={styles.saveErrorText} role="alert">
                      {saveError}
                    </Text>
                  </View>
                ) : null}

                {saved ? (
                  <View style={styles.savedBanner}>
                    <Text style={styles.savedCheck}>✓</Text>
                    <Text style={styles.saved} testID="profile-saved">
                      Profile saved.
                    </Text>
                  </View>
                ) : null}

                <Pressable
                  style={({ pressed }) => [
                    styles.button,
                    styles.primaryButton,
                    saving && styles.disabled,
                    pressed && !saving && styles.pressed,
                  ]}
                  disabled={saving}
                  onPress={() => void save()}
                  accessibilityRole="button"
                  accessibilityLabel="Save profile"
                >
                  {saving ? (
                    <View style={styles.savingRow}>
                      <ActivityIndicator size="small" color={colors.surface} />
                      <Text style={styles.buttonText}>Saving…</Text>
                    </View>
                  ) : (
                    <Text style={styles.buttonText}>Save</Text>
                  )}
                </Pressable>

                <Pressable
                  style={({ pressed }) => [
                    styles.button,
                    styles.resetButton,
                    saving && styles.disabled,
                    pressed && !saving && styles.pressed,
                  ]}
                  disabled={saving}
                  onPress={resetPreferences}
                  accessibilityRole="button"
                  accessibilityLabel="Reset preferences to defaults"
                >
                  <Text style={styles.resetButtonText}>Reset preferences</Text>
                </Pressable>
              </View>
            </>
          ) : (
            <View style={styles.stateCard}>
              <View style={styles.stateMark}>
                <Text style={styles.stateMarkText}>♧</Text>
              </View>
              <Text style={styles.stateTitle}>Not signed in</Text>
              <Text style={styles.stateText}>Sign in to view your profile.</Text>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  flex: {
    flex: 1,
  },
  container: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 40,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 24,
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  brandMark: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.paleGreen,
  },
  brandIcon: {
    fontSize: 19,
    lineHeight: 23,
    color: colors.primary,
  },
  brandName: {
    fontSize: 16,
    color: colors.primary,
    letterSpacing: -0.2,
  },
  backLink: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.primary,
  },
  heading: {
    fontSize: 32,
    lineHeight: 38,
    fontWeight: "700",
    letterSpacing: -0.7,
    color: colors.text,
  },
  subtitle: {
    marginTop: 6,
    fontSize: 14,
    lineHeight: 21,
    color: colors.muted,
  },
  card: {
    marginTop: 16,
    padding: 20,
    gap: 14,
    borderRadius: radii.card,
    backgroundColor: colors.surface,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 8,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: "700",
    letterSpacing: -0.2,
    color: colors.text,
  },
  lockBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    backgroundColor: colors.paleGreen,
  },
  lockBadgeText: {
    fontSize: 10,
    fontWeight: "600",
    letterSpacing: 0.3,
    textTransform: "uppercase",
    color: colors.primary,
  },
  identityRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 14,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.paleGreen,
  },
  avatarText: {
    fontSize: 20,
    fontWeight: "700",
    color: colors.primary,
  },
  identityText: {
    flex: 1,
  },
  label: {
    fontSize: 10,
    fontWeight: "600",
    letterSpacing: 0.4,
    textTransform: "uppercase",
    color: colors.muted,
  },
  emailLabel: {
    marginTop: 10,
  },
  name: {
    marginTop: 3,
    fontSize: 18,
    lineHeight: 23,
    fontWeight: "600",
    color: colors.text,
  },
  email: {
    marginTop: 3,
    fontSize: 14,
    lineHeight: 20,
    color: colors.text,
  },
  field: {
    gap: 6,
  },
  input: {
    minHeight: 48,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    backgroundColor: colors.background,
    color: colors.text,
    fontSize: 14,
  },
  fixedNote: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 16,
    backgroundColor: colors.paleGreen,
  },
  fixed: {
    fontSize: 12,
    lineHeight: 18,
    color: colors.primary,
  },
  saveErrorBanner: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 16,
    backgroundColor: "#F7E8E3",
  },
  saveErrorText: {
    fontSize: 12,
    lineHeight: 18,
    color: "#8C3B2E",
  },
  savedBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 16,
    backgroundColor: colors.paleGreen,
  },
  savedCheck: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.primary,
  },
  saved: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.primary,
  },
  button: {
    minHeight: 50,
    paddingHorizontal: 20,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.button,
  },
  primaryButton: {
    backgroundColor: colors.primary,
  },
  resetButton: {
    borderWidth: 1,
    borderColor: "#E4C7BE",
    backgroundColor: "transparent",
  },
  resetButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#8C3B2E",
  },
  buttonText: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.surface,
  },
  savingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  pressed: {
    opacity: 0.82,
  },
  disabled: {
    opacity: 0.45,
  },
  stateCard: {
    marginTop: 16,
    alignItems: "center",
    paddingHorizontal: 24,
    paddingVertical: 32,
    borderRadius: radii.card,
    backgroundColor: colors.surface,
  },
  errorCard: {
    backgroundColor: "#FBF3F0",
  },
  stateMark: {
    width: 56,
    height: 56,
    marginBottom: 14,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 28,
    backgroundColor: colors.paleGreen,
  },
  stateMarkText: {
    fontSize: 22,
    lineHeight: 26,
    fontWeight: "700",
    color: colors.primary,
  },
  stateTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: colors.text,
    textAlign: "center",
  },
  stateText: {
    marginTop: 8,
    fontSize: 13,
    lineHeight: 20,
    color: colors.muted,
    textAlign: "center",
  },
  stateError: {
    marginTop: 8,
    marginBottom: 18,
    fontSize: 13,
    lineHeight: 20,
    color: "#8C3B2E",
    textAlign: "center",
  },
});
