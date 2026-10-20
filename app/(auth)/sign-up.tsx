import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Link } from "expo-router";

import { useAuth } from "../../context/AuthContext";
import { colors } from "../../constants/app-theme";

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

  const passwordTooShort = password.length > 0 && password.length < MIN_PASSWORD_LENGTH;
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
    <View style={styles.container}>
      <Text style={styles.title} accessibilityRole="header">
        Create your account
      </Text>
      <Text style={styles.subtitle}>Track receipts, pantry, and swaps.</Text>

      <Text nativeID="sign-up-name-label" style={styles.label}>
        Name
      </Text>
      <TextInput
        style={styles.input}
        value={name}
        onChangeText={setName}
        placeholder="Jane Appleseed"
        placeholderTextColor="#8A8A8A"
        autoCapitalize="words"
        autoCorrect={false}
        textContentType="name"
        aria-labelledby="sign-up-name-label"
        editable={!pending}
        returnKeyType="next"
      />

      <Text nativeID="sign-up-email-label" style={styles.label}>
        Email
      </Text>
      <TextInput
        style={styles.input}
        value={email}
        onChangeText={setEmail}
        placeholder="you@example.com"
        placeholderTextColor="#8A8A8A"
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        textContentType="emailAddress"
        aria-labelledby="sign-up-email-label"
        editable={!pending}
        returnKeyType="next"
      />

      <Text nativeID="sign-up-password-label" style={styles.label}>
        Password
      </Text>
      <TextInput
        style={styles.input}
        value={password}
        onChangeText={setPassword}
        placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
        placeholderTextColor="#8A8A8A"
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

      {error ? (
        <Text style={styles.error} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}

      <Pressable
        style={[styles.button, !canSubmit && styles.buttonDisabled]}
        onPress={handleSubmit}
        disabled={!canSubmit}
        accessibilityRole="button"
        accessibilityState={{ disabled: !canSubmit, busy: pending }}
      >
        {pending ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <Text style={styles.buttonText}>Create account</Text>
        )}
      </Pressable>

      <Link href="/(auth)/sign-in" asChild>
        <Pressable disabled={pending} accessibilityRole="link">
          <Text style={styles.link}>Already have an account? Sign in</Text>
        </Pressable>
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    justifyContent: "center",
    backgroundColor: colors.background,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    color: "#5A5A5A",
    marginBottom: 24,
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 6,
    marginTop: 12,
  },
  input: {
    borderWidth: 1,
    borderColor: "#D0D0D0",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    backgroundColor: "#FFFFFF",
  },
  hint: {
    color: "#5A5A5A",
    marginTop: 6,
    fontSize: 13,
  },
  error: {
    color: "#B00020",
    marginTop: 12,
    fontSize: 14,
  },
  button: {
    marginTop: 20,
    backgroundColor: "#1B7A3D",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
  },
  link: {
    marginTop: 16,
    textAlign: "center",
    color: "#1B7A3D",
    fontSize: 15,
    fontWeight: "600",
  },
});
