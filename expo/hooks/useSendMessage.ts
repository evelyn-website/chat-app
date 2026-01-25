import { useState, useCallback } from "react";
import { useWebSocket } from "../components/context/WebSocketContext";
import { useGlobalStore } from "../components/context/GlobalStoreContext";
import * as encryptionService from "@/services/encryptionService";
import { MessageType, RecipientDevicePublicKey } from "@/types/types";
import { v4 } from "uuid";
import { useMessageStore } from "@/components/context/MessageStoreContext";
import { OptimisticMessageItem } from "@/components/ChatBox/types";
interface UseSendMessageReturn {
  sendMessage: (
    plaintext: string,
    groupId: string,
    recipientUserIds: string[]
  ) => Promise<void>;
  isSending: boolean;
  sendError: string | null;
}

export const useSendMessage = (): UseSendMessageReturn => {
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const { sendMessage: sendPacketOverSocket } = useWebSocket();
  const { user: currentUser, getDeviceKeysForUser } = useGlobalStore();
  const { addOptimisticDisplayable, removeOptimisticDisplayable, getNextClientSeq } = useMessageStore();

  const sendMessage = useCallback(
    async (
      plaintext: string,
      group_id: string,
      recipientUserIds: string[]
    ): Promise<void> => {
      setIsSending(true);
      setSendError(null);

      if (!currentUser) {
        const errorMsg = "User not authenticated. Cannot send message.";
        console.error(errorMsg);
        setSendError(errorMsg);
        setIsSending(false);
        return;
      }

      const id = v4();
      const timestamp = new Date().toISOString();
      const clientSeq = getNextClientSeq();

      const optimisticItem: OptimisticMessageItem = {
        type: "message_text",
        id,
        groupId: group_id,
        user: { id: currentUser.id, username: currentUser.username },
        content: plaintext,
        align: "right",
        timestamp,
        clientSeq,
        client_timestamp: timestamp,
      };
      addOptimisticDisplayable(optimisticItem);

      try {
        const recipientDevicePublicKeys: RecipientDevicePublicKey[] = [];

        const deviceKeyPromises = recipientUserIds.map((userId) =>
          getDeviceKeysForUser(userId).then((keys) => ({ userId, keys }))
        );

        const results = await Promise.allSettled(deviceKeyPromises);

        for (const result of results) {
          if (result.status === "fulfilled") {
            const { userId, keys } = result.value;
            if (keys && keys.length > 0) {
              recipientDevicePublicKeys.push(...keys);
            } else {
              console.warn(
                `No device keys found for recipient user ${userId}. They may not receive the message.`
              );
            }
          } else {
            console.error(
              `Failed to retrieve device keys for a user: ${result.reason}`
            );
          }
        }

        if (recipientDevicePublicKeys.length === 0) {
          const errorMsg =
            "No valid recipient device keys found. Message cannot be encrypted for anyone.";
          console.error(errorMsg);
          setSendError(errorMsg);
          return;
        }

        const rawMessagePayload =
          await encryptionService.encryptAndPrepareMessageForSending(
            id,
            plaintext,
            group_id,
            recipientDevicePublicKeys,
            MessageType.TEXT
          );

        if (!rawMessagePayload) {
          throw new Error("Failed to encrypt the message payload.");
        }
        sendPacketOverSocket(rawMessagePayload);
      } catch (error: any) {
        console.error("Error in sendMessage process:", error);
        removeOptimisticDisplayable(group_id, id);
        setSendError(
          error.message || "An unexpected error occurred while sending."
        );
      } finally {
        setIsSending(false);
      }
    },
    [
      currentUser,
      getDeviceKeysForUser,
      sendPacketOverSocket,
      addOptimisticDisplayable,
      removeOptimisticDisplayable,
      getNextClientSeq,
    ]
  );

  return {
    sendMessage,
    isSending,
    sendError,
  };
};
