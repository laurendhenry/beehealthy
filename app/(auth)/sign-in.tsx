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

/**
 * Email/password sign-in. No forgot-password UI: password reset email
 * delivery is not a supported backend capability.
 */
export default function SignInScreen() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = !pending && email.trim().length > 0 && password.length > 0;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setPending(true);
    setError(null);
    try {
      const result = await signIn({ email: email.trim(), password });
      if (result.error) setError(result.error);
      // On success the root layout's guards route away from (auth).
    } finally {
      setPending(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title} accessibilityRole="header">
        Welcome back
      </Text>
      <Text style={styles.subtitle}>Sign in to your BeeHealthy account.</Text>

      <Text nativeID="sign-in-email-label" style={styles.label}>
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
        aria-labelledby="sign-in-email-label"
        editable={!pending}
        returnKeyType="next"
      />

      <Text nativeID="sign-in-password-label" style={styles.label}>
        Password
      </Text>
      <TextInput
        style={styles.input}
        value={password}
        onChangeText={setPassword}
        placeholder="Your password"
        placeholderTextColor="#8A8A8A"
        secureTextEntry
        textContentType="password"
        aria-labelledby="sign-in-password-label"
        editable={!pending}
        returnKeyType="go"
        onSubmitEditing={handleSubmit}
      />

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
          <Text style={styles.buttonText}>Sign in</Text>
        )}
      </Pressable>

      <Link href="/(auth)/sign-up" asChild>
        <Pressable disabled={pending} accessibilityRole="link">
          <Text style={styles.link}>No account yet? Create one</Text>
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
