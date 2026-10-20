/**
 * Pantry screen: available pantry rows with cursor pagination, per-row
 * consume (all or decimal-string quantity), edit (absolute-quantity PATCH),
 * and remove. Pull-to-refresh resets the cursor chain.
 *
 * Quantity input/output stays a decimal string (up to 3 decimals) — never
 * grams/servings/intake inference. Unknown-timeout outcomes reconcile via
 * refetch without auto-replaying the mutation.
 */

import { useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import {
  usePantry,
  type PantryRowState,
} from "../hooks/usePantry";

export default function PantryScreen() {
  const pantry = usePantry();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [consumeQty, setConsumeQty] = useState<Record<string, string>>({});
  const [editQty, setEditQty] = useState("");
  const [editExpiresAt, setEditExpiresAt] = useState("");

  const startEditing = (row: PantryRowState) => {
    setEditingId(row.item.id);
    setEditQty(row.item.quantityRemaining);
    setEditExpiresAt(row.item.expiresAt ?? "");
  };

  const saveEdit = async (row: PantryRowState) => {
    const patch = {
      ...(editQty !== row.item.quantityRemaining
        ? { quantity: editQty.trim() }
        : {}),
      ...(editExpiresAt.trim() !== (row.item.expiresAt ?? "")
        ? {
            expires_at:
              editExpiresAt.trim() === "" ? null : editExpiresAt.trim(),
          }
        : {}),
    };
    if (Object.keys(patch).length === 0) {
      setEditingId(null);
      return;
    }
    const ok = await pantry.saveEdits(row.item.id, patch);
    if (ok) setEditingId(null);
  };

  return (
    <View style={styles.container} testID="pantry-screen">
      <Text style={styles.heading}>Pantry</Text>
      {pantry.error ? (
        <View style={styles.banner}>
          <Text style={styles.error} role="alert">
            {pantry.error}
          </Text>
          <Pressable
            style={styles.button}
            onPress={pantry.retry}
            accessibilityRole="button"
            accessibilityLabel="Retry loading pantry"
          >
            <Text style={styles.buttonText}>Retry</Text>
          </Pressable>
        </View>
      ) : null}
      <FlatList
        data={pantry.rows}
        keyExtractor={(row) => row.item.id}
        refreshing={pantry.refreshing}
        onRefresh={pantry.refresh}
        onEndReached={pantry.loadMore}
        onEndReachedThreshold={0.5}
        ListEmptyComponent={
          pantry.loading ? (
            <ActivityIndicator testID="pantry-loading" />
          ) : (
            <Text style={styles.muted}>Your pantry is empty.</Text>
          )
        }
        ListFooterComponent={
          pantry.loadingMore ? <ActivityIndicator /> : null
        }
        renderItem={({ item: row }) => {
          const isEditing = editingId === row.item.id;
          return (
            <View style={styles.card} testID={`pantry-row-${row.item.id}`}>
              <Text style={styles.name}>{row.item.name}</Text>
              <Text style={styles.meta}>
                Qty: {row.item.quantityRemaining}
                {row.item.expiresAt ? ` · Use by ${row.item.expiresAt}` : ""}
              </Text>
              {row.error ? (
                <Text style={styles.rowError} role="alert">
                  {row.error}
                </Text>
              ) : null}
              {isEditing ? (
                <View>
                  <Text style={styles.label}>Quantity (absolute, e.g. 1.500)</Text>
                  <TextInput
                    style={styles.input}
                    value={editQty}
                    onChangeText={setEditQty}
                    keyboardType="decimal-pad"
                    editable={!row.pending}
                    testID={`pantry-edit-qty-${row.item.id}`}
                  />
                  <Text style={styles.label}>Use-by date (YYYY-MM-DD, blank clears)</Text>
                  <TextInput
                    style={styles.input}
                    value={editExpiresAt}
                    onChangeText={setEditExpiresAt}
                    placeholder="YYYY-MM-DD"
                    editable={!row.pending}
                    testID={`pantry-edit-expiry-${row.item.id}`}
                  />
                  <View style={styles.row}>
                    {row.pending ? <ActivityIndicator size="small" /> : null}
                    <Pressable
                      style={[styles.button, row.pending && styles.disabled]}
                      disabled={row.pending}
                      onPress={() => void saveEdit(row)}
                      accessibilityRole="button"
                      accessibilityLabel={`Save changes to ${row.item.name}`}
                    >
                      <Text style={styles.buttonText}>Save</Text>
                    </Pressable>
                    <Pressable
                      style={[styles.button, styles.secondary]}
                      onPress={() => setEditingId(null)}
                      accessibilityRole="button"
                      accessibilityLabel="Cancel editing"
                    >
                      <Text style={[styles.buttonText, styles.secondaryText]}>
                        Cancel
                      </Text>
                    </Pressable>
                  </View>
                </View>
              ) : (
                <View>
                  <View style={styles.row}>
                    <TextInput
                      style={[styles.input, styles.qtyInput]}
                      value={consumeQty[row.item.id] ?? ""}
                      onChangeText={(value) =>
                        setConsumeQty((current) => ({
                          ...current,
                          [row.item.id]: value,
                        }))
                      }
                      placeholder="0.500"
                      keyboardType="decimal-pad"
                      editable={!row.pending}
                      testID={`pantry-consume-qty-${row.item.id}`}
                      accessibilityLabel={`Quantity to use up from ${row.item.name}`}
                    />
                    <Pressable
                      style={[styles.button, row.pending && styles.disabled]}
                      disabled={row.pending}
                      onPress={() =>
                        void pantry.consumeQuantity(
                          row.item.id,
                          (consumeQty[row.item.id] ?? "").trim(),
                        )
                      }
                      accessibilityRole="button"
                      accessibilityLabel={`Use up quantity of ${row.item.name}`}
                    >
                      <Text style={styles.buttonText}>Use qty</Text>
                    </Pressable>
                  </View>
                  <View style={styles.row}>
                    {row.pending ? <ActivityIndicator size="small" /> : null}
                    <Pressable
                      style={[styles.button, row.pending && styles.disabled]}
                      disabled={row.pending}
                      onPress={() => void pantry.consumeAll(row.item.id)}
                      accessibilityRole="button"
                      accessibilityLabel={`Use up all of ${row.item.name}`}
                    >
                      <Text style={styles.buttonText}>Use all</Text>
                    </Pressable>
                    <Pressable
                      style={[
                        styles.button,
                        styles.secondary,
                        row.pending && styles.disabled,
                      ]}
                      disabled={row.pending}
                      onPress={() => startEditing(row)}
                      accessibilityRole="button"
                      accessibilityLabel={`Edit ${row.item.name}`}
                    >
                      <Text style={[styles.buttonText, styles.secondaryText]}>
                        Edit
                      </Text>
                    </Pressable>
                    <Pressable
                      style={[
                        styles.button,
                        styles.danger,
                        row.pending && styles.disabled,
                      ]}
                      disabled={row.pending}
                      onPress={() => void pantry.remove(row.item.id)}
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${row.item.name}`}
                    >
                      <Text style={styles.buttonText}>Remove</Text>
                    </Pressable>
                  </View>
                </View>
              )}
            </View>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f6f6f6",
    padding: 16,
  },
  heading: {
    fontSize: 22,
    fontWeight: "700",
    marginBottom: 12,
  },
  banner: {
    marginBottom: 12,
  },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e2e2e2",
    padding: 14,
    marginBottom: 12,
    backgroundColor: "#fff",
  },
  name: {
    fontSize: 16,
    fontWeight: "600",
  },
  meta: {
    fontSize: 13,
    color: "#666",
    marginTop: 2,
  },
  label: {
    fontSize: 12,
    color: "#666",
    marginTop: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    padding: 8,
    marginTop: 4,
    backgroundColor: "#fff",
  },
  qtyInput: {
    flex: 1,
  },
  rowError: {
    fontSize: 13,
    color: "#b3261e",
    marginTop: 6,
  },
  error: {
    fontSize: 14,
    color: "#b3261e",
  },
  muted: {
    fontSize: 14,
    color: "#666",
    marginTop: 12,
    textAlign: "center",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 10,
  },
  button: {
    backgroundColor: "#1a73e8",
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  secondary: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: "#1a73e8",
  },
  danger: {
    backgroundColor: "#b3261e",
  },
  buttonText: {
    color: "#fff",
    fontWeight: "600",
  },
  secondaryText: {
    color: "#1a73e8",
  },
  disabled: {
    opacity: 0.5,
  },
});
