import { router } from "expo-router";
import {
  Alert,
  Image,
  Pressable,
  Text,
  View,
} from "react-native";
import { useState } from "react";
import { colors } from "../constants/app-theme";
import { useReceipt } from "../context/ReceiptContext";
import type { ReceiptDraft, ReceiptItem } from "../types/receipt";
import {
  ReceiptButton,
  ReceiptCard,
  ReceiptField,
  ReceiptPage,
  ui,
} from "../components/receipt/ReceiptUI";

function isValidDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const parsed = new Date(`${value}T00:00:00Z`);

  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

function isMoney(value: string) {
  return /^\d+(\.\d{1,2})?$/.test(value.trim());
}

export default function ReviewReceiptScreen() {
  const {
    imageUri,
    draft,
    updateDraft,
    confirmReceipt,
  } = useReceipt();

  function goBack() {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/scan");
    }
  }
  const [validationError, setValidationError] = useState("");
  if (!draft) {
    return (
      <ReceiptPage>
        <Text style={ui.heading}>No receipt to review</Text>
        <Text style={ui.subtitle}>
          Select a receipt and load the example data first.
        </Text>
        <ReceiptButton
          title="Go to Scan"
          onPress={() => router.replace("/scan")}
        />
      </ReceiptPage>
    );
  }

  function changeReceipt(patch: Partial<ReceiptDraft>) {
    if (draft) updateDraft({ ...draft, ...patch });
  }

  function changeItem(id: string, patch: Partial<ReceiptItem>) {
    if (!draft) return;

    changeReceipt({
      items: draft.items.map((item) =>
        item.id === id ? { ...item, ...patch } : item
      ),
    });
  }

  function removeItem(id: string) {
    if (!draft) return;

    Alert.alert("Remove item?", "You can add it again if needed.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: () =>
          changeReceipt({
            items: draft.items.filter((item) => item.id !== id),
          }),
      },
    ]);
  }

  function addItem() {
    if (!draft) return;

    changeReceipt({
      items: [
        ...draft.items,
        {
          id: `manual-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          name: "",
          quantity: "1",
          lineTotal: "",
          matchStatus: "check",
        },
      ],
    });
  }

  function handleConfirm() {
  setValidationError("");

  if (!draft) {
    setValidationError("No receipt is available to confirm.");
    return;
  }

  if (!draft.store.trim()) {
    setValidationError("Enter the store name.");
    return;
  }

  if (!isValidDate(draft.date)) {
    setValidationError("Enter a valid date in YYYY-MM-DD format.");
    return;
  }

  if (!isMoney(draft.total)) {
    setValidationError(
      "Enter a valid receipt total, such as 19.24, without a dollar sign."
    );
    return;
  }

  if (draft.items.length === 0) {
    setValidationError("Add at least one receipt item.");
    return;
  }

  for (let index = 0; index < draft.items.length; index++) {
    const item = draft.items[index];
    const quantity = Number(item.quantity);

    if (!item.name.trim()) {
      setValidationError(`Enter a name for item ${index + 1}.`);
      return;
    }

    if (
      !/^\d+(\.\d+)?$/.test(item.quantity.trim()) ||
      !Number.isFinite(quantity) ||
      quantity <= 0
    ) {
      setValidationError(
        `Enter a quantity greater than zero for item ${index + 1}.`
      );
      return;
    }

    if (!isMoney(item.lineTotal)) {
      setValidationError(
        `Enter a valid line total for item ${index + 1}, without a dollar sign.`
      );
      return;
    }
  }

  confirmReceipt();
  router.replace("/scan");
}

  const itemsTotal = draft.items.reduce((sum, item) => {
    const amount = Number(item.lineTotal);
    return sum + (Number.isFinite(amount) ? amount : 0);
  }, 0);

  return (
    <ReceiptPage>
      <Pressable
        accessibilityRole="button"
        onPress={goBack}
        style={{ alignSelf: "flex-start" }}
      >
        <Text style={ui.link}>‹ Back</Text>
      </Pressable>

      <View>
        <Text style={ui.heading}>Review your receipt</Text>
        <Text style={ui.subtitle}>
          Correct anything that doesn’t look right.
        </Text>
      </View>

      <Text style={ui.muted}>
        Demo data · These fields were not extracted from your photo.
        Edits are kept while you navigate, but not after an app reload.
      </Text>

      {imageUri && (
        <ReceiptCard>
          <Text style={ui.title}>Original receipt</Text>
          <Image
            source={{ uri: imageUri }}
            style={{ width: "100%", height: 240 }}
            resizeMode="contain"
            accessibilityLabel="Original receipt for comparison"
          />
        </ReceiptCard>
      )}

      <ReceiptCard>
        <Text style={ui.title}>Receipt details</Text>

        <ReceiptField
          label="Store"
          value={draft.store}
          onChangeText={(store) => changeReceipt({ store })}
        />

        <ReceiptField
          label="Date · YYYY-MM-DD"
          placeholder="2026-10-06"
          value={draft.date}
          autoCapitalize="none"
          onChangeText={(date) => changeReceipt({ date })}
        />

        <ReceiptField
          label="Receipt total ($)"
          value={draft.total}
          keyboardType="decimal-pad"
          onChangeText={(total) => changeReceipt({ total })}
        />
      </ReceiptCard>

      <View style={ui.row}>
        <Text style={ui.title}>Items ({draft.items.length})</Text>
        <Text style={ui.muted}>Edit before confirming</Text>
      </View>

      {draft.items.map((item, index) => (
        <ReceiptCard key={item.id}>
          <View style={ui.row}>
            <Text style={ui.title}>Item {index + 1}</Text>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Remove ${item.name || "item"}`}
              onPress={() => removeItem(item.id)}
            >
              <Text style={ui.link}>Remove</Text>
            </Pressable>
          </View>

          {item.matchStatus === "check" && (
            <Text style={ui.muted}>
              Check this item carefully. A confirmed product match
              is not available.
            </Text>
          )}

          <ReceiptField
            label="Item name"
            value={item.name}
            placeholder="Enter item name"
            onChangeText={(name) =>
              changeItem(item.id, {
                name,
                matchStatus: "check",
              })
            }
          />

          <View style={ui.row}>
            <ReceiptField
              label="Quantity"
              value={item.quantity}
              keyboardType="decimal-pad"
              onChangeText={(quantity) =>
                changeItem(item.id, { quantity })
              }
            />

            <ReceiptField
              label="Line total ($)"
              value={item.lineTotal}
              keyboardType="decimal-pad"
              onChangeText={(lineTotal) =>
                changeItem(item.id, { lineTotal })
              }
            />
          </View>
        </ReceiptCard>
      ))}

      <ReceiptButton
        title="+ Add missing item"
        secondary
        onPress={addItem}
      />

      <ReceiptCard>
        <View style={ui.row}>
          <Text style={ui.text}>Entered item totals</Text>
          <Text style={ui.title}>${itemsTotal.toFixed(2)}</Text>
        </View>

        <Text style={ui.muted}>
          Line total means the full amount paid for that row.
          Receipt totals may also include taxes, discounts, or fees.
          This demo does not reconcile those automatically.
        </Text>
      </ReceiptCard>

      <ReceiptButton
        title="Confirm receipt"
        onPress={handleConfirm}
      />

      <Text
        style={[
          ui.muted,
          { textAlign: "center", color: colors.primary },
        ]}
      >
        Confirm that the details above match your receipt.
      </Text>
    </ReceiptPage>
  );
}