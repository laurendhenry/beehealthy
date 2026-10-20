import { useState } from "react";
import { router } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { Alert, Image, Pressable, StyleSheet, Text, View } from "react-native";
import { Lucide } from "@react-native-vector-icons/lucide";

import { colors } from "../../constants/app-theme";
import { useReceipt } from "../../context/ReceiptContext";
import { ReceiptButton, ReceiptCard, ReceiptPage, ui } from "../../components/receipt/ReceiptUI";

export default function ScanScreen() {
  const { imageUri, draft, confirmedReceipt, selectImage, loadExample, resetReceipt } =
    useReceipt();

  const [busy, setBusy] = useState(false);

  async function chooseImage(useCamera: boolean) {
    setBusy(true);

    try {
      if (useCamera) {
        const permission = await ImagePicker.requestCameraPermissionsAsync();

        if (!permission.granted) {
          Alert.alert(
            "Camera access needed",
            "Allow camera access in your device settings, or import a photo.",
          );
          return;
        }
      }

      const options: ImagePicker.ImagePickerOptions = {
        mediaTypes: ["images"],
        allowsEditing: false,
        quality: 0.8,
      };

      const result = useCamera
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync(options);

      if (!result.canceled && result.assets[0]) {
        selectImage(result.assets[0].uri);
      }
    } catch {
      Alert.alert("Could not open image picker", "Please try again or use the example receipt.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ReceiptPage>
      <Text style={ui.brand}>♧ sprout</Text>

      <View>
        <Text style={ui.heading}>Scan your receipt</Text>
        <Text style={ui.subtitle}>Your grocery run, without all the typing.</Text>
      </View>

      <View style={styles.imageArea}>
        {imageUri ? (
          <Image
            source={{ uri: imageUri }}
            style={StyleSheet.absoluteFillObject}
            resizeMode="contain"
            accessibilityLabel="Selected receipt"
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
            {imageUri ? "Check that every item is readable" : "Keep every item inside the frame"}
          </Text>
        </View>
      </View>

      <View style={styles.captureRow}>
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() => chooseImage(false)}
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
          disabled={busy}
          onPress={() => chooseImage(true)}
          style={({ pressed }) => [styles.shutterRing, (pressed || busy) && { opacity: 0.5 }]}
        >
          <View style={styles.shutter} />
        </Pressable>

        <View style={styles.sideControl}>
          <Text style={styles.controlLabel}>
            <Lucide name="switch-camera" size={25} color={colors.primary} />
          </Text>
          <Text style={styles.controlLabel}>Photo mode</Text>
        </View>
      </View>

      <ReceiptButton
        secondary
        title={draft ? "Reload example data" : "Load example receipt"}
        onPress={loadExample}
      />

      <Text style={ui.muted}>
        Frontend demo: photos are not processed yet. Example data is unrelated to the selected
        image.
      </Text>

      <ReceiptCard>
        <View style={ui.row}>
          <Text style={ui.title}>Parsed preview</Text>
          <Text style={ui.muted}>
            {draft ? `Example · ${draft.items.length} items` : "No items yet"}
          </Text>
        </View>

        <Text style={ui.muted}>Review matches before confirming your receipt.</Text>

        {draft ? (
          <>
            {draft.items.slice(0, 3).map((item) => (
              <View key={item.id} style={ui.row}>
                <Text style={[ui.text, { flex: 1 }]}>{item.name}</Text>

                <Text style={ui.muted}>Qty {item.quantity}</Text>

                <View style={[ui.badge, item.matchStatus === "check" && styles.checkBadge]}>
                  <Text style={ui.badgeText}>
                    {item.matchStatus === "matched" ? "Matched" : "Check item"}
                  </Text>
                </View>
              </View>
            ))}

            {draft.items.length > 3 && (
              <Text style={ui.muted}>+ {draft.items.length - 3} more items to review</Text>
            )}
          </>
        ) : (
          <Text style={ui.text}>
            Your parsed items will appear here after processing. Load the example to test the review
            flow.
          </Text>
        )}
      </ReceiptCard>

      <View style={ui.row}>
        <Text style={[ui.text, { color: colors.primary, flex: 1 }]}>
          {draft ? `Review ${draft.items.length} items` : "Ready when you are"}
        </Text>

        <ReceiptButton
          title="Review receipt"
          disabled={!draft}
          onPress={() => router.push("/review_receipt")}
        />
      </View>

      {confirmedReceipt && (
        <ReceiptCard>
          <Text style={ui.title}>Receipt confirmed</Text>
          <Text style={ui.text}>
            {confirmedReceipt.store} · {confirmedReceipt.items.length} items
          </Text>
          <Text style={ui.muted}>
            Stored in this app session only. Not uploaded to the backend.
          </Text>
        </ReceiptCard>
      )}

      {(imageUri || draft) && (
        <ReceiptButton
          title="Start a new receipt"
          secondary
          onPress={() =>
            Alert.alert(
              "Start a new receipt?",
              "This clears the current photo and receipt from this demo.",
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
      )}
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
});
