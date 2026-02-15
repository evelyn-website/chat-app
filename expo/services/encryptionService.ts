import {
  RawMessage,
  DbMessage,
  MessageType,
  ImageMessageContent,
} from "../types/types";
import sodium from "react-native-libsodium";
import { Base64 } from "js-base64";
import * as FileSystem from "expo-file-system";

// --- Concurrency Control ---
class ConcurrencyLimiter {
  private activeOperations = 0;
  private maxConcurrent: number;
  private queue: (() => void)[] = [];
  private sodiumReadyPromise: Promise<void>;

  constructor(maxConcurrent: number = 3) {
    this.maxConcurrent = maxConcurrent;
    this.sodiumReadyPromise = (async () => {
      await sodium.ready;
    })();
  }

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    await this.sodiumReadyPromise;

    return new Promise((resolve, reject) => {
      const executeOperation = async () => {
        this.activeOperations++;
        try {
          const result = await operation();
          resolve(result);
        } catch (error) {
          reject(error);
        } finally {
          this.activeOperations--;
          this.processQueue();
        }
      };

      if (this.activeOperations < this.maxConcurrent) {
        executeOperation();
      } else {
        this.queue.push(executeOperation);
      }
    });
  }

  private processQueue() {
    if (this.queue.length > 0 && this.activeOperations < this.maxConcurrent) {
      const nextOperation = this.queue.shift();
      if (nextOperation) {
        nextOperation();
      }
    }
  }
}

// Global concurrency limiters for different operation types
const textDecryptionLimiter = new ConcurrencyLimiter(5); // Text is fast, allow more
const imageDecryptionLimiter = new ConcurrencyLimiter(3); // Slightly higher concurrency for images
const encryptionLimiter = new ConcurrencyLimiter(3); // For key generation and encryption

export const uint8ArrayToBase64 = (arr: Uint8Array): string => {
  return Base64.fromUint8Array(arr);
};

export const base64ToUint8Array = (str: string): Uint8Array => {
  return Base64.toUint8Array(str);
};

// --- Key Management ---

/**
 * Generates a new Curve25519 key pair for long-term identity.
 * These are used for the 'box' authenticated encryption.
 */
export const generateLongTermKeyPair = async (): Promise<{
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}> => {
  return encryptionLimiter.execute(async () => {
    const { publicKey, privateKey } = sodium.crypto_box_keypair();
    return { publicKey, privateKey };
  });
};

// --- Message Processing (Incoming Messages) ---

/**
 * Processes an incoming RawMessage (from WebSocket), finds the correct envelope for the
 * current device, decodes Base64 fields, and prepares a Message object for storage/decryption.
 *
 * @param rawMessage The incoming message packet with Base64 encoded fields.
 * @param currentDeviceId The ID of the current user's device.
 * @param senderId The ID of the user who sent the message.
 * @param messageId The unique ID for this message (e.g., server-assigned or client-generated).
 * @param timestamp The timestamp for the message.
 * @returns A Message object (with Uint8Array fields) ready for storage, or null if no envelope found.
 */
export const processAndDecodeIncomingMessage = (
  rawMessage: RawMessage,
  currentDeviceId: string,
  senderId: string,
  messageId: string,
  timestamp: string,
  senderUsername?: string
): DbMessage | null => {
  const envelope = rawMessage.envelopes.find(
    (env) => env.deviceId === currentDeviceId
  );

  if (!envelope) {
    // This is expected for historical messages or messages not intended for this device
    // Silently skip - not an error condition
    return null;
  }

  try {
    const clientMessage: DbMessage = {
      id: messageId,
      group_id: rawMessage.group_id,
      sender_id: senderId,
      sender_username: senderUsername,
      timestamp: timestamp,
      client_seq: null,
      client_timestamp: null,

      ciphertext: base64ToUint8Array(rawMessage.ciphertext),
      message_type: rawMessage.messageType,
      msg_nonce: base64ToUint8Array(rawMessage.msgNonce),

      sender_ephemeral_public_key: base64ToUint8Array(envelope.ephPubKey),
      sym_key_encryption_nonce: base64ToUint8Array(envelope.keyNonce),
      sealed_symmetric_key: base64ToUint8Array(envelope.sealedKey),
    };
    return clientMessage;
  } catch (error) {
    console.error("Error decoding Base64 fields from RawMessage:", error);
    return null;
  }
};

// --- Encryption (Outgoing Messages) ---

/**
 * Encrypts a plaintext message, creates envelopes for recipients, Base64 encodes
 * all binary data, and returns a RawMessage object ready for sending via WebSocket.
 *
 * @param plaintext The message content to encrypt.
 * @param groupId The ID of the group this message belongs to.
 * @param recipientDevicePublicKeys An array of objects, each containing a recipient's deviceId and their long-term publicKey (Uint8Array).
 * @param senderLongTermPrivateKey The sender's long-term private key (Uint8Array).
 * @returns A promise that resolves to the RawMessage object (with Base64 strings).
 */
export const encryptAndPrepareMessageForSending = async (
  messageId: string,
  plaintext: string,
  groupId: string,
  recipientDevicePublicKeys: { deviceId: string; publicKey: Uint8Array }[],
  messageType: MessageType
): Promise<RawMessage | null> => {
  return encryptionLimiter.execute(async () => {
    try {
      const symKey = sodium.crypto_secretbox_keygen();
      const msgNonceUint8Array = sodium.randombytes_buf(
        sodium.crypto_secretbox_NONCEBYTES
      );

      const plaintextUint8Array = new TextEncoder().encode(plaintext);

      const ciphertextUint8Array = sodium.crypto_secretbox_easy(
        plaintextUint8Array,
        msgNonceUint8Array,
        symKey
      );

      const senderEphemeralKeyPair = sodium.crypto_box_keypair();

      const envelopes = [];
      for (const recipient of recipientDevicePublicKeys) {
        const keyNonceUint8Array = sodium.randombytes_buf(
          sodium.crypto_box_NONCEBYTES
        );

        // Encrypt (box) the symmetric key for this recipient
        // Uses: symKey (message), keyNonce, recipient_pk, sender_ephemeral_sk
        const sealedSymmetricKeyForRecipient = sodium.crypto_box_easy(
          symKey,
          keyNonceUint8Array,
          recipient.publicKey,
          senderEphemeralKeyPair.privateKey // Sender's EPHEMERAL private key
        );

        envelopes.push({
          deviceId: recipient.deviceId,
          ephPubKey: uint8ArrayToBase64(senderEphemeralKeyPair.publicKey),
          keyNonce: uint8ArrayToBase64(keyNonceUint8Array),
          sealedKey: uint8ArrayToBase64(sealedSymmetricKeyForRecipient),
        });
      }

      const messageToSend = {
        id: messageId,
        group_id: groupId,
        messageType: messageType,
        msgNonce: uint8ArrayToBase64(msgNonceUint8Array),
        ciphertext: uint8ArrayToBase64(ciphertextUint8Array),
        envelopes: envelopes,
      };

      return messageToSend as RawMessage;
    } catch (error) {
      console.error("Error during message encryption and preparation:", error);
      return null;
    }
  });
};

// --- Decryption (For Displaying Messages) ---
export const decryptStoredMessage = async (
  storedMessage: DbMessage,
  deviceLongTermPrivateKey: Uint8Array
): Promise<string | null> => {
  return textDecryptionLimiter.execute(async () => {
    try {
      const symKey = sodium.crypto_box_open_easy(
        storedMessage.sealed_symmetric_key,
        storedMessage.sym_key_encryption_nonce,
        storedMessage.sender_ephemeral_public_key,
        deviceLongTermPrivateKey
      );

      if (!symKey) {
        console.error("Failed to decrypt symmetric key.");
        return null;
      }

      const plaintextUint8Array = sodium.crypto_secretbox_open_easy(
        storedMessage.ciphertext,
        storedMessage.msg_nonce,
        symKey
      );

      if (!plaintextUint8Array) {
        console.error("Failed to decrypt message content.");
        return null;
      }

      return sodium.to_string(plaintextUint8Array);
    } catch (error) {
      console.error("Error during message decryption:", error);
      return null;
    }
  });
};

// --- Image specific functions

export const readImageAsBytes = async (
  imageUri: string
): Promise<Uint8Array> => {
  const fileBase64 = await FileSystem.readAsStringAsync(imageUri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return base64ToUint8Array(fileBase64);
};

export const encryptImageFile = async (
  imageBytes: Uint8Array
): Promise<{
  encryptedBlob: Uint8Array;
  imageKey: Uint8Array;
  imageNonce: Uint8Array;
} | null> => {
  return encryptionLimiter.execute(async () => {
    try {
      const imageKey = sodium.crypto_secretbox_keygen();
      const imageNonce = sodium.randombytes_buf(
        sodium.crypto_secretbox_NONCEBYTES
      );
      const encryptedBlob = sodium.crypto_secretbox_easy(
        imageBytes,
        imageNonce,
        imageKey
      );
      return { encryptedBlob, imageKey, imageNonce };
    } catch (error) {
      console.error("Failed to encrypt image file:", error);
      return null;
    }
  });
};

export const createImageMessagePayload = (
  objectKey: string,
  mimeType: string,
  imageKey: Uint8Array,
  imageNonce: Uint8Array,
  dimensions: { width: number; height: number },
  blurhash: string | null
): string => {
  const imageMessageContent: ImageMessageContent = {
    objectKey: objectKey,
    mimeType: mimeType,
    decryptionKey: uint8ArrayToBase64(imageKey),
    nonce: uint8ArrayToBase64(imageNonce),
    width: dimensions.width,
    height: dimensions.height,
  };
  if (blurhash) {
    imageMessageContent.blurhash = blurhash;
  }

  return JSON.stringify(imageMessageContent);
};

export const decryptImageFile = async (
  encryptedImageBytes: Uint8Array,
  key: Uint8Array,
  nonce: Uint8Array
): Promise<Uint8Array | null> => {
  return imageDecryptionLimiter.execute(async () => {
    try {
      const decryptedBytes = sodium.crypto_secretbox_open_easy(
        encryptedImageBytes,
        nonce,
        key
      );
      return decryptedBytes;
    } catch (error) {
      console.error("Failed to decrypt image file:", error);
      return null;
    }
  });
};

/**
 * Saves a Uint8Array as a file to the local filesystem and returns the file URI.
 * The data is saved in Base64 format, which is required by FileSystem.writeAsStringAsync.
 * The returned URI can be directly used by React Native's Image component.
 * @param bytes The raw image data.
 * @param localUri The destination file path.
 * @returns The file URI string.
 */
export const saveBytesToLocalFile = async (
  bytes: Uint8Array,
  localUri: string
): Promise<string> => {
  const base64Data = uint8ArrayToBase64(bytes);
  await FileSystem.writeAsStringAsync(localUri, base64Data, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return localUri;
};
