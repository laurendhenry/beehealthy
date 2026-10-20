import { useState } from "react";
import { router } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { Alert, Image, Pressable, StyleSheet, Text, View } from "react-native";
import { Lucide } from "@react-native-vector-icons/lucide";

import { colors } from "../../constants/app-theme";
import { useReceipt } from "../../context/ReceiptContext";
import {
  ReceiptButton,
  ReceiptCard,
  ReceiptPage,
  ui,
} from "../../components/receipt/ReceiptUI";
import { PendingConfirmRecovery } from "../../components/receipt/PendingConfirmRecovery";

const PROGRESS_COPY: Partial<Record<string, string>> = {
  normalizing: "Preparing your photo…",
  allocating: "Starting a secure upload…",
  uploading: "Uploading your photo…",
  parsing: "Reading your receipt…",
  monitoring: "Still reading your receipt…",
  loading: "Loading your receipt…",
  confirming: "Saving your receipt…",
};

export default function ScanScreen() {
  const {
    phase,
    imageUri,
    imageUrl,
    receiptId,
    form,
    confirmedReceipt,
    error,
    isExample,
    isBusy,
    hasActiveWork,
    startFromPickerAsset,
    loadExample,
    resetReceipt,
    retryUpload,
    retryParse,
  } = useReceipt();

  const [picking, setPicking] = useState(false);
  const previewUri = imageUri ?? imageUrl;
  const progress = PROGRESS_COPY[phase];
  const canRetryUpload =
    phase === "failed" && imageUri !== null && (error?.stage === "allocating" || error?.stage === "uploading");
  const canRetryParse =
    phase === "failed" && receiptId !== null && !canRetryUpload && error?.stage !== "confirming";

  function openReview() {
    if (receiptId) {
      router.push({ pathname: "/review_receipt", params: { receiptId } });
      return;
    }
    router.push("/review_receipt");
  }

  function confirmReplace(message: string, action: () => void) {
    Alert.alert("Replace current receipt?", message, [
      { text: "Cancel", style: "cancel" },
      { text: "Replace", style: "destructive", onPress: action },
    ]);
  }

  async function pickImage(useCamera: boolean) {
    if (picking || isBusy) {
      return;
    }
    setPicking(true);

    try {
      if (useCamera) {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          Alert.alert(
            "Camera access needed",
            "Allow camera access in your device settings, or import a photo instead.",
            [
              { text: "Not now", style: "cancel" },
              { text: "Import photo", onPress: () => void pickImage(false) },
            ],
          );
          return;
        }
      }

      const options: ImagePicker.ImagePickerOptions = {
        mediaTypes: ["images"],
        allowsEditing: false,
        quality: 0.7,
        preferredAssetRepresentationMode:
          ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
      };

      const result = useCamera
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync(options);

      // Cancelling the picker is a normal choice, not a failure: keep whatever
      // photo/draft the receipt already has.
      const asset = result.canceled ? undefined : result.assets[0];
      if (!asset) {
        return;
      }

      if (hasActiveWork) {
        confirmReplace(
          "This replaces the photo and parsed items on this screen. Anything already saved to your account stays in history.",
          () => {
            void startFromPickerAsset(asset, { replace: true });
          },
        );
        return;
      }

      await startFromPickerAsset(asset);
    } catch {
      Alert.alert("Could not open image picker", "Please try again.");
    } finally {
      setPicking(false);
    }
  }

  function loadExampleReceipt() {
    if (hasActiveWork) {
      confirmReplace(
        "This replaces the current photo and parsed items with example data. You can still review and save the example to your account.",
        loadExample,
      );
      return;
    }
    loadExample();
  }

  const exampleCopy = isExample
    ? "Example data — no photo was uploaded. Saving still goes through the real backend, so it will appear in your receipt history and update your pantry."
    : null;

  return (
    <ReceiptPage>
      <Text style={ui.brand}>♧ sprout</Text>

      <View>
        <Text style={ui.heading}>Scan your receipt</Text>
        <Text style={ui.subtitle}>Your grocery run, without all the typing.</Text>
      </View>

      <PendingConfirmRecovery />

      <View style={styles.imageArea}>
        {previewUri ? (
          <Image
            source={{ uri: previewUri }}
            style={StyleSheet.absoluteFillObject}
            resizeMode="contain"
            accessibilityLabel="Receipt photo"
          />
        ) : (
          <View style={styles.placeholder}>
            <Text style={styles.receiptIcon}>
              <Lucide name="receipt-text" size={48} color={colors.muted} />
            </Text>
            <Text style={ui.subtitle}>Take or import a receipt photo</Text>
          </View>
        )}

        <View pointerEvents="none" style={styles.frame} />

        <View style={styles.imageHint}>
          <Text style={styles.imageHintText}>
            {previewUri
              ? progress ?? "Check that every item is readable"
              : "Keep every item inside the frame"}
          </Text>
        </View>
      </View>

      <View style={styles.captureRow}>
        <Pressable
          accessibilityRole="button"
          disabled={picking || isBusy}
          onPress={() => pickImage(false)}
          style={styles.sideControl}
        >
          <Text style={styles.controlIcon}>
            <Lucide name="image-plus" size={25} color={colors.primary} />
          </Text>
          <Text style={styles.controlLabel}>Import photo</Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Take receipt photo"
          disabled={picking || isBusy}
          onPress={() => pickImage(true)}
          style={({ pressed }) => [
            styles.shutterRing,
            (pressed || picking || isBusy) && { opacity: 0.5 },
          ]}
        >
          <View style={styles.shutter} />
        </Pressable>

        <View style={styles.sideControl}>
          <Text style={styles.controlLabel}>
            <Lucide name="switch-camera" size={25} color={colors.primary} />
          </Text>
          <Text style={styles.controlLabel}>{isBusy ? "Working" : "Photo mode"}</Text>
        </View>
      </View>

      <ReceiptButton
        secondary
        title={form ? "Reload example data" : "Load example receipt"}
        disabled={picking || isBusy}
        onPress={loadExampleReceipt}
      />

      {exampleCopy ? <Text style={ui.muted}>{exampleCopy}</Text> : null}

      {progress ? (
        <ReceiptCard>
          <View style={ui.row}>
            <Text style={ui.title}>{progress}</Text>
          </View>
          <Text style={ui.muted}>
            Keep this screen open while the backend processes the photo. You can leave — this receipt
            stays in your account.
          </Text>
        </ReceiptCard>
      ) : null}

      {error ? (
        <ReceiptCard>
          <Text style={ui.title}>Something needs attention</Text>
          <Text style={ui.text}>{error.message}</Text>
          {error.issues?.length ? (
            <Text style={ui.muted}>
              {error.issues.map((issue) => issue.message).join(" ")}
            </Text>
          ) : null}
          {error.code ? <Text style={ui.muted}>Reference: {error.code}</Text> : null}
          <View style={styles.retryRow}>
            {canRetryUpload ? (
              <ReceiptButton title="Retry upload" onPress={() => void retryUpload()} />
            ) : null}
            {canRetryParse ? (
              <ReceiptButton title="Retry reading" secondary onPress={() => void retryParse()} />
            ) : null}
          </View>
        </ReceiptCard>
      ) : null}

      <ReceiptCard>
        <View style={ui.row}>
          <Text style={ui.title}>Parsed preview</Text>
          <Text style={ui.muted}>
            {form
              ? `${isExample ? "Example · " : ""}${form.items.length} items`
              : "No items yet"}
          </Text>
        </View>

        <Text style={ui.muted}>Review the store, total and food matches before saving.</Text>

        {form ? (
          <>
            {form.items.slice(0, 3).map((item) => (
              <View key={item.key} style={ui.row}>
                <Text style={[ui.text, { flex: 1 }]}>{item.name || "New item"}</Text>

                <Text style={ui.muted}>Qty {item.quantity}</Text>

                <View style={[ui.badge, item.matchStatus === "check" && styles.checkBadge]}>
                  <Text style={ui.badgeText}>
                    {item.matchStatus === "matched" ? "Matched" : "Check item"}
                  </Text>
                </View>
              </View>
            ))}

            {form.items.length > 3 && (
              <Text style={ui.muted}>+ {form.items.length - 3} more items to review</Text>
            )}
          </>
        ) : (
          <Text style={ui.text}>
            Your parsed items will appear here after the backend reads your photo. You can also load
            the example receipt to try the review flow.
          </Text>
        )}
      </ReceiptCard>

      <View style={ui.row}>
        <Text style={[ui.text, { color: colors.primary, flex: 1 }]}>
          {form ? `Review ${form.items.length} items` : "Ready when you are"}
        </Text>

        <ReceiptButton
          title="Review receipt"
          disabled={!form || isBusy || phase === "confirmed"}
          onPress={openReview}
        />
      </View>

      {confirmedReceipt ? (
        <ReceiptCard>
          <Text style={ui.title}>Receipt confirmed</Text>
          <Text style={ui.text}>
            {confirmedReceipt.draft.store} · {confirmedReceipt.draft.items.length} items · $
            {confirmedReceipt.draft.total}
          </Text>
          <Text style={ui.muted}>
            {isExample
              ? "Example receipt saved to your account through the backend. No photo was uploaded."
              : "Saved to your account. Your pantry was updated from these items."}
          </Text>
          <ReceiptButton
            title="View confirmed receipt"
            secondary
            onPress={() =>
              router.push({
                pathname: "/review_receipt",
                params: { receiptId: confirmedReceipt.id },
              })
            }
          />
        </ReceiptCard>
      ) : null}

      {hasActiveWork ? (
        <ReceiptButton
          title="Start a new receipt"
          secondary
          onPress={() =>
            Alert.alert(
              "Start a new receipt?",
              "This clears the current photo and parsed items from this screen. Anything already saved to your account stays in history.",
              [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Clear",
                  style: "destructive",
                  onPress: resetReceipt,
                },
              ],
            )
          }
        />
      ) : null}
    </ReceiptPage>
  );
}

const styles = StyleSheet.create({
  imageArea: {
    height: 275,
    borderRadius: 24,
    overflow: "hidden",
    backgroundColor: "#CBD1D5",
    justifyContent: "center",
    alignItems: "center",
  },
  placeholder: {
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 24,
  },
  receiptIcon: {
    fontSize: 80,
    color: colors.surface,
  },
  frame: {
    position: "absolute",
    top: 15,
    bottom: 15,
    left: 42,
    right: 42,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: "#FFFFFFCC",
  },
  imageHint: {
    position: "absolute",
    bottom: 10,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: colors.text,
  },
  imageHintText: {
    fontSize: 10,
    color: colors.surface,
  },
  captureRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
  },
  sideControl: {
    width: 90,
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
  },
  controlIcon: {
    fontSize: 25,
    color: colors.primary,
  },
  controlLabel: {
    fontSize: 12,
    color: colors.primary,
  },
  shutterRing: {
    width: 66,
    height: 66,
    padding: 3,
    borderWidth: 2,
    borderRadius: 33,
    borderColor: colors.primary,
  },
  shutter: {
    flex: 1,
    borderRadius: 30,
    backgroundColor: colors.primary,
  },
  checkBadge: {
    backgroundColor: "#F2E8D8",
  },
  retryRow: {
    flexDirection: "row",
    gap: 12,
    flexWrap: "wrap",
  },
});
