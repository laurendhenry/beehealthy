/**
 * Persisted receipt detail + recovery surface.
 *
 * - Read-only: confirmed receipts are immutable server-side and there are no
 *   edit affordances here.
 * - ready/failed: reopen the existing review flow through the `receiptId`
 *   query contract; history/detail never duplicate review mutations.
 * - processing: bounded status polling with honest pause + manual recovery.
 * - uploading: explained as an incomplete upload rather than an empty receipt.
 * - Delete: version-aware; warns that confirmed receipts also remove pantry
 *   items. Conflicts reconcile before offering another attempt.
 * - Image: original receipt when the backend exposes a presigned URL.
 */

import { useCallback } from "react";
import { router, useLocalSearchParams } from "expo-router";
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  ActionButton,
  InlineNotice,
  LoadingState,
  ReceiptStatusBadge,
  ScreenHeader,
  receiptStyles as s,
} from "../../components/receipts/ReceiptsUI";
import { colors } from "../../constants/app-theme";
import { useReceiptDetail } from "../../hooks/useReceiptDetail";
import {
  formatDateOnly,
  formatMoneyTotal,
  formatQuantityDisplay,
} from "../../lib/api/pantry";
import {
  canDeleteReceipt,
  isReadOnlyReceipt,
  isReviewableStatus,
  parseReceiptIdParam,
  receiptDeleteWarning,
  receiptStatusMeta,
  reviewReceiptHref,
} from "../../lib/api/receipt-history";

function backToReceipts() {
  if (router.canGoBack()) {
    router.back();
  } else {
    router.replace("/receipts");
  }
}

export default function ReceiptDetailScreen() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const receiptId = parseReceiptIdParam(params.id);
  const detail = useReceiptDetail({
    receiptId: receiptId ?? "",
    enabled: receiptId !== null,
  });

  const onDelete = useCallback(() => {
    const resource = detail.resource;
    if (!resource) return;

    Alert.alert("Delete receipt?", receiptDeleteWarning(resource.status), [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          void detail.remove().then((deleted) => {
            if (deleted) backToReceipts();
          });
        },
      },
    ]);
  }, [detail]);

  const resource = detail.resource;
  const meta = resource ? receiptStatusMeta(resource.status) : null;
  const total =
    resource && resource.draft.total.trim()
      ? formatMoneyTotal(resource.draft.total)
      : "Total unavailable";

  return (
    <SafeAreaView style={s.safeArea} edges={["top", "left", "right"]}>
      <ScreenHeader title="Receipt details" onBack={backToReceipts} />

      {!receiptId ? (
        <View style={s.content}>
          <View style={s.emptyCard} testID="receipt-invalid">
            <Text style={s.emptyTitle}>Receipt unavailable</Text>
            <Text style={s.emptyText}>
              This link is missing a receipt id. Open your history to pick a
              receipt.
            </Text>
            <ActionButton
              variant="secondary"
              label="Back to receipts"
              onPress={backToReceipts}
            />
          </View>
        </View>
      ) : detail.loading ? (
        <LoadingState label="Opening receipt…" />
      ) : detail.error || !resource ? (
        <View style={s.content}>
          <View style={s.emptyCard} testID="receipt-error">
            <Text style={s.emptyTitle}>
              {detail.notFound ? "Receipt not available" : "Couldn’t open receipt"}
            </Text>
            <Text style={s.emptyText}>
              {detail.error ??
                "This receipt could not be loaded. Try again in a moment."}
            </Text>
            {!detail.notFound ? (
              <ActionButton
                label="Try again"
                onPress={detail.retry}
                testID="receipt-retry"
              />
            ) : null}
            <ActionButton
              variant="secondary"
              label="Back to receipts"
              onPress={() => router.replace("/receipts")}
            />
          </View>
        </View>
      ) : (
        <ScrollView
          style={s.screen}
          contentContainerStyle={[s.content, local.scroll]}
          refreshControl={
            <RefreshControl
              refreshing={detail.refreshing}
              onRefresh={detail.refresh}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
          showsVerticalScrollIndicator={false}
          testID="receipt-detail"
        >
          <View style={s.card}>
            <View style={s.rowTop}>
              <Text style={s.storeName} numberOfLines={2}>
                {resource.draft.store.trim() || "Receipt"}
              </Text>
              <Text style={s.total}>{total}</Text>
            </View>
            <Text style={s.meta}>
              {resource.draft.date
                ? formatDateOnly(resource.draft.date)
                : "Date unavailable"}{" "}
              · {resource.draft.items.length}{" "}
              {resource.draft.items.length === 1 ? "item" : "items"}
            </Text>
            <ReceiptStatusBadge status={resource.status} />
            {meta ? <Text style={[s.meta, local.detailText]}>{meta.detail}</Text> : null}

            {resource.status === "processing" ? (
              <View style={local.monitorRow}>
                {detail.monitoring ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : null}
                <Text style={local.monitorText}>
                  {detail.monitoring
                    ? "Checking whether processing finished…"
                    : "Status checks are paused."}
                </Text>
                {!detail.monitoring ? (
                  <Pressable
                    onPress={detail.checkStatus}
                    accessibilityRole="button"
                    accessibilityLabel="Check receipt status"
                    hitSlop={8}
                  >
                    <Text style={s.noticeButtonText}>Check status</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}
          </View>

          {detail.notice ? (
            <InlineNotice
              kind="info"
              message={detail.notice}
              actionLabel="Dismiss"
              onAction={detail.clearNotice}
              testID="receipt-notice"
            />
          ) : null}

          {detail.monitorNotice ? (
            <InlineNotice
              kind="info"
              message={detail.monitorNotice}
              actionLabel="Check status"
              onAction={detail.checkStatus}
              testID="receipt-monitor-notice"
            />
          ) : null}

          <View style={local.actions}>
            {isReviewableStatus(resource.status) ? (
              <ActionButton
                label={
                  resource.status === "failed"
                    ? "Reopen review"
                    : "Review receipt"
                }
                onPress={() => router.push(reviewReceiptHref(resource.id))}
                testID="receipt-review"
              />
            ) : null}
            {resource.status === "processing" ? (
              <ActionButton
                variant="secondary"
                label="Open in review"
                onPress={() => router.push(reviewReceiptHref(resource.id))}
                testID="receipt-review-processing"
              />
            ) : null}
            {resource.status === "uploading" ? (
              <ActionButton
                variant="secondary"
                label="Scan a new receipt"
                onPress={() => router.push("/scan")}
                testID="receipt-scan-again"
              />
            ) : null}
            {isReadOnlyReceipt(resource.status) ? (
              <Text style={local.readOnlyNote}>
                Read-only · confirmed receipts can’t be edited. Edit your pantry
                to change these items.
              </Text>
            ) : null}
          </View>

          <Text style={s.sectionTitle}>Original receipt</Text>
          <View style={s.card}>
            {detail.imageLoading ? (
              <View style={s.imagePlaceholder}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={s.imagePlaceholderText}>Preparing image…</Text>
              </View>
            ) : detail.image ? (
              <Image
                source={{ uri: detail.image.url }}
                style={s.image}
                resizeMode="contain"
                accessibilityLabel="Original receipt image"
                testID="receipt-image"
              />
            ) : (
              <View style={s.imagePlaceholder}>
                <Text style={s.imagePlaceholderText}>
                  {detail.imageError ??
                    "No original image is stored for this receipt."}
                </Text>
                {detail.imageRetryable ? (
                  <ActionButton
                    variant="secondary"
                    label="Retry image"
                    onPress={detail.refreshImage}
                  />
                ) : null}
              </View>
            )}
          </View>

          <Text style={s.sectionTitle}>Line items</Text>
          <View style={s.card}>
            {resource.draft.items.length === 0 ? (
              <Text style={s.emptyText}>
                No line items were captured for this receipt.
              </Text>
            ) : (
              resource.draft.items.map((item) => (
                <View key={item.id} style={s.itemRow}>
                  <Text style={s.itemName} numberOfLines={2}>
                    {item.name.trim() || "Unnamed item"}
                  </Text>
                  <Text style={s.itemQuantity}>
                    ×{formatQuantityDisplay(item.quantity) || "1"}
                  </Text>
                  <Text style={s.itemTotal}>
                    {item.lineTotal.trim()
                      ? formatMoneyTotal(item.lineTotal)
                      : "—"}
                  </Text>
                </View>
              ))
            )}
            <View style={s.totalRow}>
              <Text style={s.totalLabel}>Receipt total</Text>
              <Text style={s.totalValue}>{total}</Text>
            </View>
          </View>

          {resource.warnings.length > 0 ? (
            <>
              <Text style={s.sectionTitle}>Review notes</Text>
              <View style={s.card}>
                {resource.warnings.map((warning, index) => (
                  <View key={`${index}-${warning}`} style={s.warningRow}>
                    <Text style={s.warningBullet}>•</Text>
                    <Text style={s.warningText}>{warning}</Text>
                  </View>
                ))}
              </View>
            </>
          ) : null}

          <View style={local.deleteSection}>
            {detail.deleteError ? (
              <InlineNotice
                message={detail.deleteError}
                actionLabel="Dismiss"
                onAction={detail.clearDeleteError}
                testID="receipt-delete-error"
              />
            ) : null}
            {canDeleteReceipt(resource.status) ? (
              <>
                <ActionButton
                  variant="danger"
                  label="Delete receipt"
                  loading={detail.deleting}
                  onPress={onDelete}
                  testID="receipt-delete"
                />
                {resource.status === "confirmed" ? (
                  <Text style={local.deleteHint}>
                    Deleting this confirmed receipt also removes its items from
                    your pantry.
                  </Text>
                ) : null}
              </>
            ) : null}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const local = StyleSheet.create({
  scroll: {
    paddingTop: 4,
    gap: 0,
  },
  detailText: {
    marginTop: 10,
  },
  monitorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 12,
  },
  monitorText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
    color: colors.muted,
  },
  actions: {
    marginTop: 14,
    gap: 10,
  },
  readOnlyNote: {
    fontSize: 11,
    lineHeight: 16,
    color: colors.muted,
    textAlign: "center",
    paddingHorizontal: 6,
  },
  deleteSection: {
    marginTop: 26,
    gap: 8,
  },
  deleteHint: {
    fontSize: 11,
    lineHeight: 16,
    color: colors.muted,
    textAlign: "center",
    paddingHorizontal: 6,
  },
});
