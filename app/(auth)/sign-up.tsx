import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Link } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuth } from "../../context/AuthContext";
import { colors, radii } from "../../constants/app-theme";

const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;

/**
 * Email/password sign-up (name/email/password). Server validation is
 * authoritative; the client only mirrors the documented 8–128 password
 * bounds for early feedback. No social login: not a backend capability.
 */
export default function SignUpScreen() {
  const { signUp } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const passwordTooShort =
    password.length > 0 && password.length < MIN_PASSWORD_LENGTH;
  const passwordTooLong = password.length > MAX_PASSWORD_LENGTH;
  const canSubmit =
    !pending &&
    name.trim().length > 0 &&
    email.trim().length > 0 &&
    password.length >= MIN_PASSWORD_LENGTH &&
    !passwordTooLong;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setPending(true);
    setError(null);
    try {
      const result = await signUp({
        name: name.trim(),
        email: email.trim(),
        password,
      });
      if (result.error) setError(result.error);
      // On success the root layout's guards route away from (auth).
    } finally {
      setPending(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.brandRow}>
            <View style={styles.brandMark}>
              <Text style={styles.brandIcon}>♧</Text>
            </View>
            <Text style={styles.brandName}>sprout</Text>
          </View>

          <View style={styles.hero}>
            <Text style={styles.heading} accessibilityRole="header">
              Create your account
            </Text>
            <Text style={styles.subtitle}>
              Track receipts, pantry, and swaps.
            </Text>
          </View>

          <View style={styles.card}>
            <View style={styles.field}>
              <Text nativeID="sign-up-name-label" style={styles.label}>
                Name
              </Text>
              <TextInput
                style={styles.input}
                value={name}
                onChangeText={setName}
                placeholder="Jane Appleseed"
                placeholderTextColor={colors.muted}
                selectionColor={colors.primary}
                autoCapitalize="words"
                autoCorrect={false}
                textContentType="name"
                aria-labelledby="sign-up-name-label"
                editable={!pending}
                returnKeyType="next"
              />
            </View>

            <View style={styles.field}>
              <Text nativeID="sign-up-email-label" style={styles.label}>
                Email
              </Text>
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                placeholderTextColor={colors.muted}
                selectionColor={colors.primary}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                textContentType="emailAddress"
                aria-labelledby="sign-up-email-label"
                editable={!pending}
                returnKeyType="next"
              />
            </View>

            <View style={styles.field}>
              <Text nativeID="sign-up-password-label" style={styles.label}>
                Password
              </Text>
              <TextInput
                style={styles.input}
                value={password}
                onChangeText={setPassword}
                placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
                placeholderTextColor={colors.muted}
                selectionColor={colors.primary}
                secureTextEntry
                textContentType="newPassword"
                aria-labelledby="sign-up-password-label"
                editable={!pending}
                returnKeyType="go"
                onSubmitEditing={handleSubmit}
              />
              {passwordTooShort ? (
                <Text style={styles.hint}>
                  Password must be at least {MIN_PASSWORD_LENGTH} characters.
                </Text>
              ) : null}
              {passwordTooLong ? (
                <Text style={styles.hint}>
                  Password must be at most {MAX_PASSWORD_LENGTH} characters.
                </Text>
              ) : null}
            </View>

            {error ? (
              <View style={styles.errorBanner}>
                <Text
                  style={styles.errorText}
                  role="alert"
                  accessibilityLiveRegion="polite"
                >
                  {error}
                </Text>
              </View>
            ) : null}

            <Pressable
              style={({ pressed }) => [
                styles.button,
                !canSubmit && styles.buttonDisabled,
                pressed && canSubmit && styles.buttonPressed,
              ]}
              onPress={handleSubmit}
              disabled={!canSubmit}
              accessibilityRole="button"
              accessibilityState={{ disabled: !canSubmit, busy: pending }}
            >
              {pending ? (
                <ActivityIndicator color={colors.surface} />
              ) : (
                <Text style={styles.buttonText}>Create account</Text>
              )}
            </Pressable>
          </View>

          <Link href="/(auth)/sign-in" asChild>
            <Pressable disabled={pending} accessibilityRole="link" hitSlop={8}>
              <Text style={styles.link}>
                Already have an account? Sign in
              </Text>
            </Pressable>
          </Link>
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
  content: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: 24,
    paddingVertical: 32,
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 24,
  },
  brandMark: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.paleGreen,
  },
  brandIcon: {
    fontSize: 22,
    lineHeight: 26,
    color: colors.primary,
  },
  brandName: {
    fontSize: 17,
    color: colors.primary,
    letterSpacing: -0.2,
  },
  hero: {
    marginBottom: 20,
  },
  heading: {
    fontSize: 32,
    lineHeight: 39,
    fontWeight: "700",
    letterSpacing: -0.8,
    color: colors.text,
  },
  subtitle: {
    marginTop: 6,
    fontSize: 14,
    lineHeight: 21,
    color: colors.muted,
  },
  card: {
    padding: 20,
    gap: 16,
    borderRadius: radii.card,
    backgroundColor: colors.surface,
  },
  field: {
    gap: 6,
  },
  label: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.4,
    textTransform: "uppercase",
    color: colors.muted,
  },
  input: {
    minHeight: 50,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    backgroundColor: colors.background,
    color: colors.text,
    fontSize: 15,
  },
  hint: {
    fontSize: 12,
    lineHeight: 18,
    color: colors.muted,
  },
  errorBanner: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 16,
    backgroundColor: "#F7E8E3",
  },
  errorText: {
    color: "#8C3B2E",
    fontSize: 13,
    lineHeight: 19,
  },
  button: {
    minHeight: 52,
    paddingHorizontal: 20,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.button,
    backgroundColor: colors.primary,
  },
  buttonPressed: {
    backgroundColor: colors.primaryPressed,
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  buttonText: {
    color: colors.surface,
    fontSize: 15,
    fontWeight: "600",
  },
  link: {
    paddingVertical: 8,
    marginTop: 20,
    textAlign: "center",
    color: colors.primary,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "600",
  },
});
