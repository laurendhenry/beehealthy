/**
 * Live receipt camera for the Scan tab.
 *
 * The native camera session only runs while the tab is focused (`CameraView`
 * is unmounted otherwise), so switching tabs releases the camera. Permission
 * is requested in-app; when it is denied the person can still import a photo
 * from the library. Captures are handed to the receipt flow as picker-shaped
 * assets, so camera and library photos share the same preparation/upload.
 */

import { useRef, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useIsFocused } from "expo-router";
import { Lucide } from "@react-native-vector-icons/lucide";

import { colors } from "../../constants/app-theme";
import type { PickedReceiptAsset } from "../../lib/receipt-image";
import { ReceiptButton, ReceiptCard, ui } from "../receipt/ReceiptUI";

/** JPEG quality for captures: sharp enough for OCR, well under the 10 MB cap. */
const CAPTURE_QUALITY = 0.8;

type CameraCaptureProps = {
  disabled: boolean;
  onCapture: (asset: PickedReceiptAsset) => void;
  onImport: () => void;
};

export function CameraCapture({ disabled, onCapture, onImport }: CameraCaptureProps) {
  const isFocused = useIsFocused();
  const [permission, requestPermission] = useCameraPermissions();

  if (Platform.OS === "web") {
    return <ImportOnly onImport={onImport} disabled={disabled} />;
  }
  if (!permission) {
    return (
      <View style={[styles.cameraArea, styles.centered]}>
        <ActivityIndicator color={colors.surface} />
      </View>
    );
  }
  if (!permission.granted) {
    return (
      <ReceiptCard>
        <Text style={ui.title}>Camera access</Text>
        <Text style={ui.text}>
          Allow camera access to photograph receipts here, or import a photo you already took.
        </Text>
        <View style={styles.permissionActions}>
          {permission.canAskAgain ? (
            <ReceiptButton title="Allow camera" onPress={() => void requestPermission()} />
          ) : (
            <ReceiptButton title="Open Settings" onPress={() => void Linking.openSettings()} />
          )}
          <ReceiptButton title="Import photo" secondary disabled={disabled} onPress={onImport} />
        </View>
      </ReceiptCard>
    );
  }
  return isFocused ? (
    <LiveCamera disabled={disabled} onCapture={onCapture} onImport={onImport} />
  ) : (
    <View style={styles.cameraArea} />
  );
}

/** Mounted only while the camera should run; remounting resets readiness. */
function LiveCamera({ disabled, onCapture, onImport }: CameraCaptureProps) {
  const cameraRef = useRef<CameraView>(null);
  const [ready, setReady] = useState(false);
  const [torch, setTorch] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function capture() {
    const camera = cameraRef.current;
    if (!camera || !ready || capturing || disabled) {
      return;
    }
    setCapturing(true);
    setProblem(null);
    try {
      const photo = await camera.takePictureAsync({ quality: CAPTURE_QUALITY });
      onCapture({
        uri: photo.uri,
        width: photo.width,
        height: photo.height,
        mimeType: photo.format === "png" ? "image/png" : "image/jpeg",
      });
    } catch {
      setProblem("The photo could not be taken. Try again or import a photo.");
    } finally {
      setCapturing(false);
    }
  }

  const shutterDisabled = !ready || capturing || disabled;

  return (
    <View style={styles.wrapper}>
      <View style={styles.cameraArea}>
        <CameraView
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          facing="back"
          mode="picture"
          enableTorch={torch}
          onCameraReady={() => setReady(true)}
          onMountError={() =>
            setProblem("The camera could not start. You can import a photo instead.")
          }
        />
        <View pointerEvents="none" style={styles.frame} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={torch ? "Turn light off" : "Turn light on"}
          accessibilityState={{ selected: torch }}
          onPress={() => setTorch((on) => !on)}
          style={[styles.torch, torch && styles.torchOn]}
          hitSlop={8}
        >
          <Lucide name={torch ? "flashlight" : "flashlight-off"} size={20} color={torch ? colors.text : colors.surface} />
        </Pressable>
        <View pointerEvents="none" style={styles.hint}>
          <Text style={styles.hintText}>
            {ready ? "Fit the whole receipt inside the frame" : "Starting camera…"}
          </Text>
        </View>
      </View>

      {problem ? <Text style={ui.muted}>{problem}</Text> : null}

      <View style={styles.controls}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Import photo from library"
          disabled={disabled || capturing}
          onPress={onImport}
          style={({ pressed }) => [styles.sideControl, (pressed || disabled) && styles.dimmed]}
        >
          <Lucide name="image-plus" size={25} color={colors.primary} />
          <Text style={styles.controlLabel}>Import</Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Take receipt photo"
          accessibilityState={{ disabled: shutterDisabled, busy: capturing }}
          disabled={shutterDisabled}
          onPress={() => void capture()}
          style={({ pressed }) => [styles.shutterRing, (pressed || shutterDisabled) && styles.dimmed]}
        >
          <View style={styles.shutter}>
            {capturing ? <ActivityIndicator color={colors.surface} /> : null}
          </View>
        </Pressable>

        <View style={styles.sideControl} />
      </View>
    </View>
  );
}

function ImportOnly({ disabled, onImport }: { disabled: boolean; onImport: () => void }) {
  return (
    <ReceiptCard>
      <View style={styles.importOnly}>
        <Lucide name="receipt-text" size={44} color={colors.muted} />
        <Text style={ui.text}>Choose a clear photo of your receipt.</Text>
        <ReceiptButton title="Import photo" disabled={disabled} onPress={onImport} />
      </View>
    </ReceiptCard>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    gap: 12,
  },
  cameraArea: {
    height: 440,
    borderRadius: 24,
    overflow: "hidden",
    backgroundColor: "#1F2721",
  },
  centered: {
    alignItems: "center",
    justifyContent: "center",
  },
  frame: {
    position: "absolute",
    top: 24,
    bottom: 56,
    left: 36,
    right: 36,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: "#FFFFFFCC",
  },
  torch: {
    position: "absolute",
    top: 14,
    right: 14,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#00000066",
  },
  torchOn: {
    backgroundColor: "#FFFFFFDD",
  },
  hint: {
    position: "absolute",
    bottom: 14,
    alignSelf: "center",
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: "#000000AA",
  },
  hintText: {
    fontSize: 12,
    color: colors.surface,
  },
  controls: {
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
  controlLabel: {
    fontSize: 12,
    color: colors.primary,
  },
  shutterRing: {
    width: 72,
    height: 72,
    padding: 4,
    borderWidth: 2,
    borderRadius: 36,
    borderColor: colors.primary,
  },
  shutter: {
    flex: 1,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary,
  },
  dimmed: {
    opacity: 0.5,
  },
  permissionActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  importOnly: {
    alignItems: "center",
    gap: 12,
  },
});
