import { useState } from "react";
import { Text } from "react-native";
import { router } from "expo-router";

import { useReceipt } from "../../context/ReceiptContext";
import { ReceiptButton, ReceiptCard, ui } from "./ReceiptUI";

/** Explicit escape hatch for unreadable retry metadata, never a local success. */
export function PendingConfirmRecovery() {
  const { pendingConfirmStatus, discardPendingConfirmation, isBusy } = useReceipt();
  const [acknowledging, setAcknowledging] = useState(false);
  const [clearing, setClearing] = useState(false);

  if (pendingConfirmStatus === "none") return null;

  return (
    <ReceiptCard>
      <Text style={ui.title}>Check your previous save</Text>
      <Text style={ui.text}>
        A previous confirmation may already have reached the backend. Check receipt history before
        starting again. If retry confirmation is available, use it to safely retry the same save.
      </Text>
      <ReceiptButton
        title="Check receipt history"
        secondary
        onPress={() => router.push("/receipts")}
      />
      {!acknowledging ? (
        <ReceiptButton
          title="Cannot recover this confirmation?"
          secondary
          disabled={isBusy || clearing}
          onPress={() => setAcknowledging(true)}
        />
      ) : (
        <>
          <Text style={ui.text}>
            Clearing only removes this device’s pending retry record. It does not delete or undo
            anything on the backend. Saving the same receipt again could create a duplicate. Continue
            only after checking your history.
          </Text>
          <ReceiptButton
            title={clearing ? "Clearing retry record…" : "I checked history — clear pending retry"}
            disabled={isBusy || clearing}
            onPress={() => {
              setClearing(true);
              void discardPendingConfirmation().finally(() => setClearing(false));
            }}
          />
          <ReceiptButton
            title="Keep pending retry"
            secondary
            disabled={clearing}
            onPress={() => setAcknowledging(false)}
          />
        </>
      )}
    </ReceiptCard>
  );
}
