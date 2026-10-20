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
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { useAppData } from "../context/AppDataContext";
import {
  ApiError,
  getCurrentUser,
  resetUserProfile,
  updateUserProfile,
  type CurrentUser,
  type UserProfile,
} from "../lib/api/pantry";

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

export default function ProfileScreen() {
  const { userId, invalidateFor } = useAppData();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

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
  }, [userId]);

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

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      testID="profile-screen"
    >
      <Text style={styles.heading}>Profile</Text>
      {loading ? (
        <ActivityIndicator testID="profile-loading" />
      ) : error ? (
        <Text style={styles.error} role="alert">
          {error}
        </Text>
      ) : user ? (
        <View>
          <Text style={styles.label}>Name</Text>
          <Text style={styles.readonly} testID="profile-name">
            {user.name}
          </Text>
          <Text style={styles.label}>Email</Text>
          <Text style={styles.readonly} testID="profile-email">
            {user.email}
          </Text>
          <Text style={styles.label}>Timezone</Text>
          <TextInput
            style={styles.input}
            value={timezone}
            onChangeText={setTimezone}
            placeholder="America/New_York"
            editable={!saving}
            testID="profile-timezone"
          />
          <Text style={styles.label}>
            Dietary preferences (comma-separated)
          </Text>
          <TextInput
            style={styles.input}
            value={dietary}
            onChangeText={setDietary}
            placeholder="vegetarian, gluten-free"
            editable={!saving}
            testID="profile-dietary"
          />
          <Text style={styles.label}>
            Excluded ingredients (comma-separated)
          </Text>
          <TextInput
            style={styles.input}
            value={excluded}
            onChangeText={setExcluded}
            placeholder="peanuts, shellfish"
            editable={!saving}
            testID="profile-excluded"
          />
          <Text style={styles.fixed}>
            Currency USD · Language English (US) — these stay fixed.
          </Text>
          {saveError ? (
            <Text style={styles.error} role="alert">
              {saveError}
            </Text>
          ) : null}
          {saved ? (
            <Text style={styles.saved} testID="profile-saved">
              Profile saved.
            </Text>
          ) : null}
          <View style={styles.row}>
            {saving ? <ActivityIndicator size="small" /> : null}
            <Pressable
              style={[styles.button, saving && styles.disabled]}
              disabled={saving}
              onPress={() => void save()}
              accessibilityRole="button"
              accessibilityLabel="Save profile"
            >
              <Text style={styles.buttonText}>Save</Text>
            </Pressable>
            <Pressable
              style={[styles.button, styles.danger, saving && styles.disabled]}
              disabled={saving}
              onPress={resetPreferences}
              accessibilityRole="button"
              accessibilityLabel="Reset preferences to defaults"
            >
              <Text style={styles.buttonText}>Reset preferences</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <Text style={styles.muted}>Sign in to view your profile.</Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f6f6f6",
  },
  content: {
    padding: 16,
    paddingBottom: 32,
  },
  heading: {
    fontSize: 22,
    fontWeight: "700",
    marginBottom: 12,
  },
  label: {
    fontSize: 13,
    fontWeight: "600",
    color: "#444",
    marginTop: 12,
  },
  readonly: {
    fontSize: 16,
    marginTop: 4,
  },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    padding: 10,
    marginTop: 4,
    backgroundColor: "#fff",
  },
  fixed: {
    fontSize: 12,
    color: "#888",
    marginTop: 12,
  },
  error: {
    fontSize: 14,
    color: "#b3261e",
    marginTop: 8,
  },
  saved: {
    fontSize: 14,
    color: "#1a7f37",
    marginTop: 8,
  },
  muted: {
    fontSize: 14,
    color: "#666",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 16,
  },
  button: {
    backgroundColor: "#1a73e8",
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  danger: {
    backgroundColor: "#b3261e",
  },
  buttonText: {
    color: "#fff",
    fontWeight: "600",
  },
  disabled: {
    opacity: 0.5,
  },
});
