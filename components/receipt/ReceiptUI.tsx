import type { ReactNode } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { colors } from "../../constants/app-theme";

export function ReceiptPage({ children }: { children: ReactNode }) {
  return (
    <SafeAreaView
      style={ui.page}
      edges={["top", "left", "right"]}
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={ui.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export function ReceiptCard({ children }: { children: ReactNode }) {
  return <View style={ui.card}>{children}</View>;
}

type ButtonProps = {
  title: string;
  onPress: () => void;
  secondary?: boolean;
  disabled?: boolean;
};

export function ReceiptButton({
  title,
  onPress,
  secondary = false,
  disabled = false,
}: ButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        ui.button,
        secondary && ui.secondaryButton,
        (pressed || disabled) && { opacity: 0.5 },
      ]}
    >
      <Text
        style={[
          ui.buttonText,
          secondary && { color: colors.primary },
        ]}
      >
        {title}
      </Text>
    </Pressable>
  );
}

type FieldProps = TextInputProps & {
  label: string;
};

export function ReceiptField({ label, style, ...props }: FieldProps) {
  return (
    <View style={ui.field}>
      <Text style={ui.label}>{label}</Text>
      <TextInput
        {...props}
        accessibilityLabel={props.accessibilityLabel ?? label}
        placeholderTextColor={colors.muted}
        style={[ui.input, style]}
      />
    </View>
  );
}

export const ui = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: 24,
    paddingBottom: 40,
    gap: 16,
  },
  brand: {
    color: colors.primary,
    fontSize: 17,
  },
  heading: {
    color: colors.text,
    fontSize: 30,
    fontWeight: "700",
    letterSpacing: -0.6,
  },
  subtitle: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19,
  },
  title: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "700",
  },
  text: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 19,
  },
  muted: {
    color: colors.muted,
    fontSize: 11,
    lineHeight: 17,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 24,
    padding: 16,
    gap: 12,
  },
  button: {
    minHeight: 48,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 25,
    backgroundColor: colors.primary,
    justifyContent: "center",
    alignItems: "center",
  },
  secondaryButton: {
    backgroundColor: colors.paleGreen,
  },
  buttonText: {
    color: colors.surface,
    fontSize: 14,
    fontWeight: "600",
  },
  field: {
    flex: 1,
    gap: 6,
  },
  label: {
    color: colors.muted,
    fontSize: 12,
  },
  input: {
    minHeight: 46,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.text,
    backgroundColor: colors.background,
    fontSize: 14,
  },
  link: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: "600",
    paddingVertical: 8,
  },
  badge: {
    backgroundColor: colors.paleGreen,
    borderRadius: 12,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  badgeText: {
    color: colors.primary,
    fontSize: 10,
    fontWeight: "600",
  },
});