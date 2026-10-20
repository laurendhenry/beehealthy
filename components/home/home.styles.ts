import { StyleSheet } from "react-native";
import { colors, radii } from "../../constants/app-theme";

export const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 28,
  },
  topRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  brand: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  brandIcon: {
    fontSize: 25,
    color: colors.primary,
  },
  brandName: {
    fontSize: 17,
    color: colors.primary,
  },
  date: {
    fontSize: 10,
    color: colors.muted,
    letterSpacing: 0.3,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  /**
   * Discreet profile entry point: hairline pill in the original palette so
   * account preferences / sign-out stay one tap from the dashboard.
   */
  profileLink: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: radii.button,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  profileLinkPressed: {
    backgroundColor: colors.paleGreen,
  },
  profileLinkText: {
    fontSize: 10,
    fontWeight: "600",
    letterSpacing: 0.5,
    color: colors.primary,
  },
  heading: {
    fontSize: 30,
    fontWeight: "700",
    color: colors.text,
    letterSpacing: -0.7,
  },
  subtitle: {
    marginTop: 5,
    fontSize: 13,
    lineHeight: 19,
    color: colors.muted,
  },
  receiptCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    marginTop: 20,
    padding: 16,
    borderRadius: radii.card,
    backgroundColor: colors.surface,
  },
  receiptIllustration: {
    width: 80,
    height: 88,
    borderRadius: 15,
    backgroundColor: "#ECE6D5",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  groceryEmoji: {
    fontSize: 43,
    transform: [{ rotate: "-15deg" }],
  },
  groceryEmojiSmall: {
    position: "absolute",
    right: 3,
    top: 3,
    fontSize: 27,
  },
  receiptContent: {
    flex: 1,
    alignItems: "flex-start",
  },
  eyebrow: {
    fontSize: 9,
    fontWeight: "600",
    color: colors.muted,
    letterSpacing: 0.3,
  },
  storeName: {
    marginTop: 5,
    fontSize: 16,
    fontWeight: "700",
    color: colors.text,
  },
  receiptMeta: {
    marginTop: 5,
    fontSize: 12,
    lineHeight: 17,
    color: colors.muted,
  },
  statusBadge: {
    marginTop: 7,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    backgroundColor: colors.paleGreen,
  },
  statusText: {
    fontSize: 10,
    fontWeight: "600",
    color: colors.primary,
  },
  receiptPressable: {
    alignSelf: "stretch",
  },
  receiptDetailsHint: {
    marginTop: 8,
    fontSize: 11,
    fontWeight: "600",
    color: colors.primary,
  },
  pressedOpacity: {
    opacity: 0.65,
  },
  historyLink: {
    marginTop: 12,
  },
  historyLinkText: {
    fontSize: 11,
    fontWeight: "600",
    color: colors.primary,
  },
  actionRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    marginTop: 18,
    marginBottom: 20,
  },
  actionLabel: {
    flex: 1,
    fontSize: 15,
    fontWeight: "600",
    color: colors.primary,
  },
  primaryButton: {
    minHeight: 48,
    paddingHorizontal: 20,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.button,
    backgroundColor: colors.primary,
  },
  primaryButtonPressed: {
    backgroundColor: colors.primaryPressed,
  },
  primaryButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.surface,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.text,
  },
  sectionMeta: {
    fontSize: 11,
    color: colors.muted,
  },
  basketCard: {
    padding: 16,
    borderRadius: radii.card,
    backgroundColor: colors.surface,
  },
  categoryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 13,
  },
  categoryLabel: {
    flex: 1.35,
    fontSize: 12,
    color: colors.text,
  },
  progressTrack: {
    flex: 1,
    height: 6,
    borderRadius: 10,
    backgroundColor: colors.track,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 10,
    backgroundColor: colors.primary,
  },
  categoryCount: {
    width: 25,
    textAlign: "right",
    fontSize: 11,
    color: colors.muted,
  },
  basketFootnote: {
    marginTop: 2,
    fontSize: 11,
    lineHeight: 16,
    color: colors.muted,
  },
  recommendationHeading: {
    marginTop: 20,
    marginBottom: 10,
    fontSize: 18,
    fontWeight: "700",
    color: colors.text,
  },
  recommendationCard: {
    padding: 16,
    borderRadius: radii.card,
    backgroundColor: colors.paleGreen,
  },
  pressedCard: {
    opacity: 0.8,
  },
  recommendationTop: {
    flexDirection: "row",
    gap: 12,
  },
  leafIcon: {
    fontSize: 24,
    color: colors.primary,
  },
  recommendationCopy: {
    flex: 1,
  },
  recommendationTitle: {
    fontSize: 15,
    fontWeight: "700",
    lineHeight: 21,
    color: colors.text,
  },
  recommendationDescription: {
    marginTop: 4,
    fontSize: 12,
    lineHeight: 18,
    color: colors.text,
  },
  divider: {
    height: 1,
    marginVertical: 12,
    backgroundColor: colors.border,
  },
  recommendationDetail: {
    fontSize: 12,
    lineHeight: 18,
    color: colors.text,
  },
  swapLink: {
    marginTop: 12,
    fontSize: 12,
    fontWeight: "700",
    color: colors.primary,
  },
  disclaimer: {
    marginTop: 17,
    fontSize: 11,
    lineHeight: 16,
    color: colors.muted,
  },
  /**
   * Loading / error / empty affordances. Warm terracotta keeps failures
   * legible on both the white and pale-green cards without leaving the
   * earthy palette.
   */
  loadingRow: {
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  loadingText: {
    fontSize: 12,
    lineHeight: 18,
    color: colors.muted,
  },
  errorText: {
    marginTop: 6,
    fontSize: 12,
    lineHeight: 18,
    color: "#9C3B2E",
  },
  inlineButton: {
    marginTop: 10,
    alignSelf: "flex-start",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: colors.primary,
  },
  inlineButtonPressed: {
    backgroundColor: colors.primaryPressed,
  },
  inlineButtonText: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.surface,
  },
  pantryLink: {
    marginTop: 12,
    alignSelf: "flex-start",
  },
  pantryLinkText: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.primary,
  },
  syncNote: {
    marginTop: 12,
    fontSize: 10,
    lineHeight: 15,
    color: colors.muted,
  },
});