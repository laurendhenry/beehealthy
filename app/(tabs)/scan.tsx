import { useCallback, useState } from "react";
import { router, useFocusEffect } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { ActivityIndicator, Alert, Image, StyleSheet, Text, View } from "react-native";
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
import { CameraCapture } from "../../components/scan/CameraCapture";
import type { PickedReceiptAsset } from "../../lib/receipt-image";
import { scanViewState } from "../../lib/receipt-workflow";
import type { ReceiptPhase } from "../../types/receipt";

/** Upload pipeline steps shown while a photo is being processed. */
const STEPS: { label: string; phases: ReceiptPhase[] }[] = [
  { label: "Preparing photo", phases: ["normalizing", "allocating"] },
  { label: "Uploading securely", phases: ["uploading"] },
  { label: "Reading items", phases: ["parsing", "monitoring"] },
];

const OTHER_WORK_COPY: Partial<Record<ReceiptPhase, string>> = {
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
    error,
    isBusy,
    hasActiveWork,
    startFromPickerAsset,
    resetReceipt,
    retryUpload,
    retryParse,
  } = useReceipt();

  const [picking, setPicking] = useState(false);
  const view = scanViewState({ phase, hasForm: form !== null });

  // A confirmed receipt is finished work: coming back to Scan starts fresh.
  useFocusEffect(
    useCallback(() => {
      if (phase === "confirmed") {
        void resetReceipt();
      }
    }, [phase, resetReceipt]),
  );

  const previewUri = imageUri ?? imageUrl;
  const canRetryUpload =
    view === "failed" &&
    imageUri !== null &&
    (error?.stage === "allocating" || error?.stage === "uploading");
  const canRetryParse =
    view === "failed" && receiptId !== null && !canRetryUpload && error?.stage !== "confirming";
  const needsCheck = form?.items.filter((item) => item.matchStatus === "check").length ?? 0;

  function openReview() {
    if (receiptId) {
      router.push({ pathname: "/review_receipt", params: { receiptId } });
      return;
    }
    router.push("/review_receipt");
  }

  function start(asset: PickedReceiptAsset) {
    if (hasActiveWork) {
      Alert.alert(
        "Replace current receipt?",
        "This replaces the photo and parsed items on this screen. Anything already saved to your account stays in history.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Replace",
            style: "destructive",
            onPress: () => void startFromPickerAsset(asset, { replace: true }),
          },
        ],
      );
      return;
    }
    void startFromPickerAsset(asset);
  }

  async function importPhoto() {
    if (picking || isBusy) {
      return;
    }
    setPicking(true);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: false,
        quality: 0.7,
        preferredAssetRepresentationMode:
          ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
      });
      // Cancelling the picker is a normal choice: keep the current state.
      const asset = result.canceled ? undefined : result.assets[0];
      if (asset) {
        start(asset);
      }
    } catch {
      Alert.alert("Could not open your photos", "Please try again.");
    } finally {
      setPicking(false);
    }
  }

  function retake() {
    const clear = () => void resetReceipt();
    if (view === "ready") {
      Alert.alert(
        "Retake photo?",
        "This clears the parsed items from this screen. The receipt stays in your history as an unconfirmed draft.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Retake", style: "destructive", onPress: clear },
        ],
      );
      return;
    }
    clear();
  }

  return (
    <ReceiptPage>
      <View>
        <Text style={ui.heading}>Scan your receipt</Text>
        <Text style={ui.subtitle}>Your grocery run, without all the typing.</Text>
      </View>

      <PendingConfirmRecovery />

      {view === "capture" ? (
        <CameraCapture
          disabled={picking || isBusy}
          onCapture={start}
          onImport={() => void importPhoto()}
        />
      ) : (
        <PhotoPreview uri={previewUri} />
      )}

      {view === "working" ? (
        <ReceiptCard>
          {OTHER_WORK_COPY[phase] ? (
            <View style={styles.stepRow}>
              <ActivityIndicator color={colors.primary} />
              <Text style={ui.title}>{OTHER_WORK_COPY[phase]}</Text>
            </View>
          ) : (
            <ProgressSteps phase={phase} />
          )}
          <Text style={ui.muted}>
            You can leave this screen — the receipt keeps processing in your account.
          </Text>
        </ReceiptCard>
      ) : null}

      {view === "ready" && form ? (
        <ReceiptCard>
          <View style={styles.stepRow}>
            <Lucide name="circle-check" size={22} color={colors.primary} />
            <Text style={[ui.title, styles.flex]}>
              Read {form.items.length} {form.items.length === 1 ? "item" : "items"}
              {needsCheck > 0
                ? `, ${needsCheck} ${needsCheck === 1 ? "needs" : "need"} a check`
                : ""}
            </Text>
          </View>
          <Text style={ui.muted}>
            Review the store, total and food matches before saving to your pantry.
          </Text>
          <View style={styles.actions}>
            <ReceiptButton title="Review receipt" onPress={openReview} />
            <ReceiptButton title="Retake" secondary onPress={retake} />
          </View>
        </ReceiptCard>
      ) : null}

      {view === "failed" ? (
        <ReceiptCard>
          <View style={styles.stepRow}>
            <Lucide name="circle-alert" size={22} color={colors.text} />
            <Text style={ui.title}>Something needs attention</Text>
          </View>
          {error ? <Text style={ui.text}>{error.message}</Text> : null}
          {error?.issues?.length ? (
            <Text style={ui.muted}>{error.issues.map((issue) => issue.message).join(" ")}</Text>
          ) : null}
          {error?.code ? <Text style={ui.muted}>Reference: {error.code}</Text> : null}
          <View style={styles.actions}>
            {canRetryUpload ? (
              <ReceiptButton title="Retry upload" onPress={() => void retryUpload()} />
            ) : null}
            {canRetryParse ? (
              <ReceiptButton title="Retry reading" onPress={() => void retryParse()} />
            ) : null}
            {form ? <ReceiptButton title="Review receipt" secondary onPress={openReview} /> : null}
            <ReceiptButton title="Retake" secondary disabled={isBusy} onPress={retake} />
          </View>
        </ReceiptCard>
      ) : null}
    </ReceiptPage>
  );
}

function PhotoPreview({ uri }: { uri: string | null }) {
  return (
    <View style={styles.preview}>
      {uri ? (
        <Image
          source={{ uri }}
          style={StyleSheet.absoluteFill}
          resizeMode="contain"
          accessibilityLabel="Receipt photo"
        />
      ) : (
        <Lucide name="receipt-text" size={48} color={colors.muted} />
      )}
    </View>
  );
}

function ProgressSteps({ phase }: { phase: ReceiptPhase }) {
  const current = STEPS.findIndex((step) => step.phases.includes(phase));
  return (
    <View style={styles.steps} accessibilityLabel={STEPS[current]?.label}>
      {STEPS.map((step, index) => {
        const done = index < current;
        const active = index === current;
        return (
          <View key={step.label} style={styles.stepRow}>
            {active ? (
              <ActivityIndicator color={colors.primary} />
            ) : (
              <Lucide
                name={done ? "circle-check" : "circle"}
                size={20}
                color={done ? colors.primary : colors.muted}
              />
            )}
            <Text style={[ui.text, !done && !active && styles.pending]}>
              {step.label}
              {active && phase === "monitoring" ? " — still working…" : ""}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  preview: {
    height: 300,
    borderRadius: 24,
    overflow: "hidden",
    backgroundColor: "#CBD1D5",
    alignItems: "center",
    justifyContent: "center",
  },
  steps: {
    gap: 10,
  },
  stepRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  flex: {
    flex: 1,
  },
  pending: {
    color: colors.muted,
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
});
