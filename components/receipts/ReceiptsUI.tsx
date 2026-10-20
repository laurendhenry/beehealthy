/**
 * Shared chrome for persisted receipt history/detail screens.
 *
 * Presentational only: no data fetching, no router imports. Screens own
 * navigation and pass handlers; this module keeps the two receipt screens
 * visually consistent with the home/pantry cards.
 */

import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { colors, radii } from "../../constants/app-theme";
import type { ReceiptStatus } from "../../types/api";
import {
  receiptStatusMeta,
  type ReceiptStatusTone,
} from "../../lib/api/receipt-history";

const TONES: Record<ReceiptStatusTone, { background: string; text: string }> = {
  positive: { background: colors.paleGreen, text: colors.primary },
  attention: { background: "#F7EDD8", text: "#8A5A17" },
  pending: { background: "#E9EEF1", text: "#4B5F6B" },
  critical: { background: "#FBEAE6", text: "#9C3B2E" },
  neutral: { background: colors.track, text: colors.muted },
};

export function ReceiptStatusBadge({ status }: { status: ReceiptStatus }) {
  const meta = receiptStatusMeta(status);
  const tone = TONES[meta.tone];
  return (
    <View
      style={[receiptStyles.badge, { backgroundColor: tone.background }]}
      accessibilityLabel={`Status: ${meta.label}`}
    >
      <Text style={[receiptStyles.badgeText, { color: tone.text }]}>
        {meta.label}
      </Text>
    </View>
  );
}

export function ScreenHeader({
  title,
  subtitle,
  onBack,
}: {
  title: string;
  subtitle?: string;
  onBack: () => void;
}) {
  return (
    <View style={receiptStyles.header}>
      <View style={receiptStyles.headerRow}>
        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={8}
          style={({ pressed }) => [
            receiptStyles.backButton,
            pressed && receiptStyles.backButtonPressed,
          ]}
        >
          <Text style={receiptStyles.backGlyph}>‹</Text>
        </Pressable>
        <Text style={receiptStyles.headerTitle} numberOfLines={1}>
          {title}
        </Text>
      </View>
      {subtitle ? <Text style={receiptStyles.headerSubtitle}>{subtitle}</Text> : null}
    </View>
  );
}

export function InlineNotice({
  message,
  kind = "error",
  actionLabel,
  onAction,
  testID,
}: {
  message: string;
  kind?: "error" | "info";
  actionLabel?: string;
  onAction?: () => void;
  testID?: string;
}) {
  const isError = kind === "error";
  return (
    <View
      style={[
        receiptStyles.notice,
        isError ? receiptStyles.noticeError : receiptStyles.noticeInfo,
      ]}
      testID={testID}
    >
      <Text
        style={receiptStyles.noticeText}
        role={isError ? "alert" : undefined}
      >
        {message}
      </Text>
      {actionLabel && onAction ? (
        <Pressable
          onPress={onAction}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          hitSlop={8}
          style={({ pressed }) => [
            receiptStyles.noticeButton,
            pressed && receiptStyles.pressed,
          ]}
        >
          <Text style={receiptStyles.noticeButtonText}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function ActionButton({
  label,
  onPress,
  variant = "primary",
  disabled = false,
  loading = false,
  testID,
}: {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "danger";
  disabled?: boolean;
  loading?: boolean;
  testID?: string;
}) {
  const blocked = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={blocked}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: blocked, busy: loading }}
      testID={testID}
      style={({ pressed }) => [
        receiptStyles.actionButton,
        variant === "primary" && receiptStyles.actionPrimary,
        variant === "secondary" && receiptStyles.actionSecondary,
        variant === "danger" && receiptStyles.actionDanger,
        pressed && !blocked && receiptStyles.pressed,
        blocked && receiptStyles.disabled,
      ]}
    >
      {loading ? (
        <ActivityIndicator
          size="small"
          color={variant === "primary" ? colors.surface : colors.primary}
        />
      ) : (
        <Text
          style={[
            receiptStyles.actionText,
            variant === "primary" && receiptStyles.actionPrimaryText,
            variant === "secondary" && receiptStyles.actionSecondaryText,
            variant === "danger" && receiptStyles.actionDangerText,
          ]}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

export function FilterChips<T extends string>({
  options,
  labels,
  value,
  onChange,
}: {
  options: readonly T[];
  labels: Record<T, string>;
  value: T;
  onChange: (next: T) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={receiptStyles.chipsContent}
      accessibilityRole="tablist"
    >
      {options.map((option) => {
        const active = option === value;
        return (
          <Pressable
            key={option}
            onPress={() => onChange(option)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`Show ${labels[option]} receipts`}
            testID={`receipts-filter-${option}`}
            style={({ pressed }) => [
              receiptStyles.chip,
              active && receiptStyles.chipActive,
              pressed && receiptStyles.pressed,
            ]}
          >
            <Text
              style={[
                receiptStyles.chipText,
                active && receiptStyles.chipTextActive,
              ]}
            >
              {labels[option]}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

export function LoadingState({ label }: { label: string }) {
  return (
    <View style={receiptStyles.loading} accessibilityRole="progressbar">
      <ActivityIndicator size="small" color={colors.primary} />
      <Text style={receiptStyles.loadingText}>{label}</Text>
    </View>
  );
}

export const receiptStyles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  screen: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 6,
    paddingBottom: 10,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  backButtonPressed: {
    backgroundColor: colors.track,
  },
  backGlyph: {
    fontSize: 24,
    lineHeight: 26,
    marginTop: -2,
    color: colors.text,
  },
  headerTitle: {
    flex: 1,
    fontSize: 22,
    fontWeight: "800",
    color: colors.text,
    letterSpacing: -0.3,
  },
  headerSubtitle: {
    marginTop: 8,
    marginLeft: 52,
    fontSize: 12,
    lineHeight: 17,
    color: colors.muted,
  },
  content: {
    paddingHorizontal: 20,
    paddingBottom: 36,
  },
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 36,
    flexGrow: 1,
  },
  chipsContent: {
    gap: 8,
    paddingVertical: 6,
    paddingRight: 8,
  },
  chip: {
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: 18,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  chipText: {
    fontSize: 11,
    fontWeight: "600",
    color: colors.muted,
  },
  chipTextActive: {
    color: colors.surface,
  },
  card: {
    marginTop: 10,
    padding: 16,
    borderRadius: radii.card,
    backgroundColor: colors.surface,
  },
  rowCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 15,
    borderRadius: 20,
    backgroundColor: colors.surface,
  },
  rowMain: {
    flex: 1,
  },
  rowTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    gap: 8,
  },
  rowPressed: {
    opacity: 0.65,
  },
  storeName: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.text,
  },
  meta: {
    marginTop: 4,
    fontSize: 12,
    lineHeight: 17,
    color: colors.muted,
  },
  total: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.text,
  },
  badge: {
    alignSelf: "flex-start",
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
  reviewButton: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 16,
    backgroundColor: colors.paleGreen,
  },
  reviewButtonText: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.primary,
  },
  pressed: {
    opacity: 0.7,
  },
  disabled: {
    opacity: 0.5,
  },
  notice: {
    marginTop: 10,
    padding: 12,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
  noticeError: {
    backgroundColor: "#FBEDEA",
    borderColor: "#EFCFC8",
  },
  noticeInfo: {
    backgroundColor: colors.paleGreen,
    borderColor: colors.border,
  },
  noticeText: {
    fontSize: 12,
    lineHeight: 18,
    color: colors.text,
  },
  noticeButton: {
    alignSelf: "flex-start",
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  noticeButtonText: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.primary,
  },
  actionButton: {
    minHeight: 46,
    paddingHorizontal: 18,
    paddingVertical: 13,
    borderRadius: radii.button,
    alignItems: "center",
    justifyContent: "center",
  },
  actionPrimary: {
    backgroundColor: colors.primary,
  },
  actionSecondary: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  actionDanger: {
    backgroundColor: "#FBEDEA",
    borderWidth: 1,
    borderColor: "#E6C3BC",
  },
  actionText: {
    fontSize: 14,
    fontWeight: "700",
  },
  actionPrimaryText: {
    color: colors.surface,
  },
  actionSecondaryText: {
    color: colors.text,
  },
  actionDangerText: {
    color: "#9C3B2E",
  },
  loading: {
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 40,
  },
  loadingText: {
    fontSize: 12,
    color: colors.muted,
  },
  emptyCard: {
    marginTop: 14,
    padding: 26,
    borderRadius: radii.card,
    backgroundColor: colors.surface,
    alignItems: "center",
    gap: 8,
  },
  emptyEmoji: {
    fontSize: 30,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.text,
  },
  emptyText: {
    fontSize: 12,
    lineHeight: 18,
    color: colors.muted,
    textAlign: "center",
  },
  sectionTitle: {
    marginTop: 18,
    marginBottom: 8,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.7,
    color: colors.muted,
    textTransform: "uppercase",
  },
  image: {
    marginTop: 12,
    width: "100%",
    height: 220,
    borderRadius: 16,
    backgroundColor: colors.track,
  },
  imagePlaceholder: {
    marginTop: 12,
    height: 120,
    borderRadius: 16,
    backgroundColor: colors.track,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  imagePlaceholderText: {
    fontSize: 11,
    color: colors.muted,
    textAlign: "center",
    paddingHorizontal: 16,
  },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  itemName: {
    flex: 1,
    fontSize: 13,
    color: colors.text,
  },
  itemQuantity: {
    width: 46,
    textAlign: "right",
    fontSize: 11,
    color: colors.muted,
  },
  itemTotal: {
    width: 66,
    textAlign: "right",
    fontSize: 13,
    fontWeight: "600",
    color: colors.text,
  },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: 12,
  },
  totalLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.muted,
  },
  totalValue: {
    fontSize: 17,
    fontWeight: "800",
    color: colors.text,
  },
  warningRow: {
    flexDirection: "row",
    gap: 8,
    paddingVertical: 4,
  },
  warningBullet: {
    fontSize: 12,
    color: "#8A5A17",
  },
  warningText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
    color: colors.text,
  },
  footerNote: {
    marginTop: 18,
    fontSize: 11,
    lineHeight: 16,
    color: colors.muted,
    textAlign: "center",
  },
  separator: {
    height: 10,
  },
});
