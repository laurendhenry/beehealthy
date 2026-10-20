/**
 * Receipt history: persisted summaries with cursor pagination, server-side
 * status filters, pull-to-refresh, and non-blocking pagination errors.
 *
 * Every row opens the read-only detail screen; ready/failed rows also expose a
 * direct "Review" action so recovery is one tap from history. Confirmed rows
 * are already reflected in the pantry and stay read-only.
 */

import { useCallback, useState } from "react";
import { router } from "expo-router";
import { FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  ActionButton,
  FilterChips,
  InlineNotice,
  LoadingState,
  ReceiptStatusBadge,
  ScreenHeader,
  receiptStyles as s,
} from "../../components/receipts/ReceiptsUI";
import { colors } from "../../constants/app-theme";
import { useReceiptHistory } from "../../hooks/useReceiptHistory";
import { formatDateOnly, formatMoneyTotal } from "../../lib/api/pantry";
import {
  RECEIPT_HISTORY_FILTERS,
  RECEIPT_HISTORY_FILTER_LABELS,
  isReviewableStatus,
  receiptDetailHref,
  receiptStatusMeta,
  reviewReceiptHref,
  type ReceiptHistoryFilter,
  type ReceiptSummary,
} from "../../lib/api/receipt-history";

function ReceiptRow({
  receipt,
  onOpen,
  onReview,
}: {
  receipt: ReceiptSummary;
  onOpen: () => void;
  onReview: () => void;
}) {
  const meta = receiptStatusMeta(receipt.status);
  const date = receipt.date ? formatDateOnly(receipt.date) : "Date unavailable";
  const count = `${receipt.itemCount} ${
    receipt.itemCount === 1 ? "item" : "items"
  }`;
  const total = formatMoneyTotal(receipt.total);
  const reviewable = isReviewableStatus(receipt.status);

  return (
    <View style={s.rowCard}>
      <Pressable
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={`Open ${receipt.store} receipt from ${date}. ${count}. ${total}. ${meta.label}.`}
        accessibilityHint="Shows receipt details"
        testID={`receipt-row-${receipt.id}`}
        style={({ pressed }) => [s.rowMain, pressed && s.rowPressed]}
      >
        <View style={s.rowTop}>
          <Text style={s.storeName} numberOfLines={1}>
            {receipt.store}
          </Text>
          <Text style={s.total}>{total}</Text>
        </View>
        <Text style={s.meta}>
          {date} · {count}
        </Text>
        <ReceiptStatusBadge status={receipt.status} />
      </Pressable>

      {reviewable ? (
        <Pressable
          onPress={onReview}
          accessibilityRole="button"
          accessibilityLabel={`Review ${receipt.store} receipt`}
          hitSlop={6}
          testID={`receipt-review-${receipt.id}`}
          style={({ pressed }) => [s.reviewButton, pressed && s.pressed]}
        >
          <Text style={s.reviewButtonText}>Review</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export default function ReceiptsScreen() {
  const [filter, setFilter] = useState<ReceiptHistoryFilter>("all");
  const history = useReceiptHistory(filter);

  const goBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/(tabs)");
    }
  }, []);

  const openDetail = useCallback((receipt: ReceiptSummary) => {
    router.push(receiptDetailHref(receipt.id));
  }, []);

  const openReview = useCallback((receipt: ReceiptSummary) => {
    router.push(reviewReceiptHref(receipt.id));
  }, []);

  const emptyState = history.loading ? (
    <LoadingState label="Loading your receipts…" />
  ) : history.error ? (
    <View style={s.emptyCard} testID="receipts-error">
      <Text style={s.emptyTitle}>Couldn’t load receipts</Text>
      <Text style={s.emptyText}>{history.error}</Text>
      <ActionButton
        label="Try again"
        onPress={history.retry}
        testID="receipts-retry"
      />
    </View>
  ) : (
    <View style={s.emptyCard} testID="receipts-empty">
      <Text style={s.emptyEmoji}>🧾</Text>
      <Text style={s.emptyTitle}>
        {filter === "all"
          ? "No receipts yet"
          : `No ${RECEIPT_HISTORY_FILTER_LABELS[filter].toLowerCase()} receipts`}
      </Text>
      <Text style={s.emptyText}>
        {filter === "all"
          ? "Scan a receipt to start your history. You can review it before anything reaches your pantry."
          : "Try a different filter, or scan a new receipt."}
      </Text>
      <ActionButton
        label="Scan receipt"
        onPress={() => router.push("/scan")}
        testID="receipts-empty-scan"
      />
    </View>
  );

  const footer = history.loadingMore ? (
    <LoadingState label="Loading more receipts…" />
  ) : history.moreError ? (
    <InlineNotice
      message={history.moreError}
      actionLabel="Retry"
      onAction={history.retryMore}
      testID="receipts-more-error"
    />
  ) : !history.hasMore && history.items.length > 0 ? (
    <Text style={s.footerNote}>
      You’ve reached the start of your receipt history.
    </Text>
  ) : null;

  return (
    <SafeAreaView style={s.safeArea} edges={["top", "left", "right"]}>
      <ScreenHeader
        title="Receipts"
        subtitle="Confirmed runs, plus anything still in review."
        onBack={goBack}
      />

      <FlatList
        data={history.items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={s.listContent}
        ItemSeparatorComponent={() => <View style={s.separator} />}
        ListHeaderComponent={
          <View>
            <FilterChips
              options={RECEIPT_HISTORY_FILTERS}
              labels={RECEIPT_HISTORY_FILTER_LABELS}
              value={filter}
              onChange={setFilter}
            />
            {history.notice ? (
              <InlineNotice
                kind="info"
                message={history.notice}
                actionLabel="Dismiss"
                onAction={history.clearNotice}
                testID="receipts-notice"
              />
            ) : null}
          </View>
        }
        renderItem={({ item }) => (
          <ReceiptRow
            receipt={item}
            onOpen={() => openDetail(item)}
            onReview={() => openReview(item)}
          />
        )}
        ListEmptyComponent={emptyState}
        ListFooterComponent={footer}
        refreshControl={
          <RefreshControl
            refreshing={history.refreshing}
            onRefresh={history.refresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
        onEndReached={() => history.loadMore()}
        onEndReachedThreshold={0.4}
        showsVerticalScrollIndicator={false}
        testID="receipts-list"
      />
    </SafeAreaView>
  );
}
