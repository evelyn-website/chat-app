import { useState, useCallback } from "react";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system";

import { useWebSocket } from "@/components/context/WebSocketContext";
import { useGlobalStore } from "@/components/context/GlobalStoreContext";
import http from "@/util/custom-axios";
import {
  encryptAndPrepareMessageForSending,
  encryptImageFile,
  createImageMessagePayload,
  // readImageAsBytes,
  base64ToUint8Array,
  uint8ArrayToBase64,
} from "@/services/encryptionService";
import { ImageMessageContent, RecipientDevicePublicKey } from "@/types/types";
import { processImage } from "@/services/imageService";
import { useMessageStore } from "@/components/context/MessageStoreContext";
import { OptimisticMessageItem } from "@/components/ChatBox/types";
import { v4 } from "uuid";

interface UseSendImageReturn {
  sendImage: (
    imageAsset: ImagePicker.ImagePickerAsset,
    groupId: string,
    recipientUserIds: string[]
  ) => Promise<void>;
  isSendingImage: boolean;
  imageSendError: string | null;
}

const baseURL = `${process.env.EXPO_PUBLIC_HOST}/images`;

export const useSendImage = (): UseSendImageReturn => {
  const [isSendingImage, setIsSendingImage] = useState(false);
  const [imageSendError, setImageSendError] = useState<string | null>(null);
  const { addOptimisticDisplayable, getNextClientSeq } = useMessageStore();

  const { sendMessage: sendPacketOverSocket } = useWebSocket();
  const { user: currentUser, getDeviceKeysForUser } = useGlobalStore();

  const sendImage = useCallback(
    async (
      imageAsset: ImagePicker.ImagePickerAsset,
      groupId: string,
      recipientUserIds: string[]
    ): Promise<void> => {
      setIsSendingImage(true);
      setImageSendError(null);
      // Keep for potential future use; avoid unused var warnings
      // let normalizedImageUri: string | undefined;

      if (!currentUser) {
        const errorMsg = "User not authenticated. Cannot send image.";
        setImageSendError(errorMsg);
        setIsSendingImage(false);
        return;
      }

      try {
        const processedData = await processImage(imageAsset.uri);
        // normalizedImageUri = processedData.normalized.uri;

        const { normalized, blurhash } = processedData;

        const id = v4();
        const timestamp = new Date().toISOString();
        const clientSeq = getNextClientSeq();

        const localUri = normalized.uri;
        const placeholderContent: ImageMessageContent = {
          objectKey: localUri,
          mimeType: imageAsset.mimeType ?? "image/jpeg",
          decryptionKey: "",
          nonce: "",
          width: imageAsset.width!,
          height: imageAsset.height!,
          blurhash: blurhash ?? undefined,
          localUri: localUri,
        };

        const optimisticItem: OptimisticMessageItem = {
          type: "message_image",
          id,
          groupId: groupId,
          user: { id: currentUser.id, username: currentUser.username },
          content: placeholderContent,
          align: "right",
          timestamp,
          clientSeq,
          client_timestamp: timestamp,
          pinToBottom: true, // Keep at bottom while uploading
        };
        addOptimisticDisplayable(optimisticItem);

        const imageBytes = base64ToUint8Array(normalized.base64);

        const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
        if (imageBytes.length > MAX_FILE_SIZE_BYTES) {
          throw new Error(
            `Image is too large after compression. Max size is 5 MB.`
          );
        }

        const recipientDevicePublicKeys = (
          await Promise.allSettled(
            recipientUserIds.map((userId) => getDeviceKeysForUser(userId))
          )
        )
          .map((result) =>
            result.status === "fulfilled" ? result.value : null
          )
          .flat()
          .filter(Boolean) as RecipientDevicePublicKey[];

        if (recipientDevicePublicKeys.length === 0) {
          throw new Error("No valid recipient device keys found.");
        }

        const encryptionResult = await encryptImageFile(imageBytes);
        if (!encryptionResult) {
          throw new Error("Failed to encrypt the image file.");
        }
        const { encryptedBlob, imageKey, imageNonce } = encryptionResult;

        if (encryptedBlob.length > MAX_FILE_SIZE_BYTES) {
          throw new Error(
            `Encrypted image is too large to upload (size: ${encryptedBlob.length} bytes).`
          );
        }

        const presignResponse = await http.post(`${baseURL}/presign-upload`, {
          filename: imageAsset.uri.split("/").pop() || "upload.jpg",
          groupId: groupId,
          size: encryptedBlob.length,
        });
        const { uploadUrl, objectKey } = presignResponse.data;

        // Write encrypted blob to temporary file
        const cacheDir = FileSystem.cacheDirectory;
        if (!cacheDir) {
          throw new Error("File system cache directory unavailable on this platform.");
        }
        const tempUri = `${cacheDir}temp_upload_${Date.now()}.bin`;
        await FileSystem.writeAsStringAsync(
          tempUri,
          uint8ArrayToBase64(encryptedBlob),
          {
            encoding: FileSystem.EncodingType.Base64,
          }
        );

        try {
          // Upload using FileSystem.uploadAsync - the standard approach for binary uploads in Expo
          const uploadResponse = await FileSystem.uploadAsync(uploadUrl, tempUri, {
            httpMethod: "PUT",
            headers: { "Content-Type": "application/octet-stream" },
          });

          if (uploadResponse.status < 200 || uploadResponse.status >= 300) {
            throw new Error(`S3 Upload Failed: ${uploadResponse.body}`);
          }
        } finally {
          // Always clean up temporary file
          await FileSystem.deleteAsync(tempUri, { idempotent: true });
        }

        const plaintextPayload = createImageMessagePayload(
          objectKey,
          imageAsset.mimeType ?? "image/jpeg",
          imageKey,
          imageNonce,
          { width: imageAsset.width, height: imageAsset.height },
          blurhash
        );

        const rawMessagePayload = await encryptAndPrepareMessageForSending(
          id,
          plaintextPayload,
          groupId,
          recipientDevicePublicKeys,
          "image"
        );
        if (!rawMessagePayload) {
          throw new Error("Failed to encrypt the final image message payload.");
        }

        sendPacketOverSocket(rawMessagePayload);
      } catch (error: any) {
        console.error("Error in sendImage process:", error);
        setImageSendError(
          error.message || "An unexpected error occurred while sending image."
        );
      } finally {
        setIsSendingImage(false);
      }
    },
    [
      currentUser,
      getDeviceKeysForUser,
      sendPacketOverSocket,
      addOptimisticDisplayable,
      getNextClientSeq,
    ]
  );

  return {
    sendImage,
    isSendingImage,
    imageSendError,
  };
};
