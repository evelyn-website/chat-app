import * as SecureStore from "expo-secure-store";
import { v4 as uuidv4 } from "uuid";
import * as encryptionService from "./encryptionService";
import * as customStore from "@/util/custom-store";
import sodium from "react-native-libsodium";

const SIGNING_PUBLIC_KEY_BYTES = 32;
const SIGNING_PRIVATE_KEY_BYTES = 64;

const DEVICE_ID_KEY = "deviceIdentifier";
const PUBLIC_KEY_KEY = "devicePublicKey";
const PRIVATE_KEY_SECURE_KEY = "devicePrivateKey_v2";
const SIGNING_PUBLIC_KEY_KEY = "deviceSigningPublicKey";
const SIGNING_PRIVATE_KEY_SECURE_KEY = "deviceSigningPrivateKey_v1";

interface DeviceIdentity {
  deviceId: string;
  publicKey: Uint8Array;
  privateKey: Uint8Array;
  signingPublicKey: Uint8Array;
  signingPrivateKey: Uint8Array;
}

export const getOrGenerateDeviceIdentifier = async (): Promise<string> => {
  let deviceId: string | undefined;
  try {
    deviceId = await customStore.get(DEVICE_ID_KEY);
  } catch {
    // Ignore
  }

  if (!deviceId) {
    deviceId = uuidv4();
    await customStore.save(DEVICE_ID_KEY, deviceId);
  }
  return deviceId;
};

export const getOrGenerateDeviceKeyPair = async (): Promise<{
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}> => {
  let storedPublicKeyBase64: string | undefined;
  try {
    storedPublicKeyBase64 = await customStore.get(PUBLIC_KEY_KEY);
  } catch {}
  const storedPrivateKeyBase64 = await SecureStore.getItemAsync(
    PRIVATE_KEY_SECURE_KEY,
  );

  if (storedPublicKeyBase64 && storedPrivateKeyBase64) {
    try {
      const publicKey = encryptionService.base64ToUint8Array(
        storedPublicKeyBase64,
      );
      const privateKey = encryptionService.base64ToUint8Array(
        storedPrivateKeyBase64,
      );

      if (
        publicKey.length === sodium.crypto_box_PUBLICKEYBYTES &&
        privateKey.length === sodium.crypto_box_SECRETKEYBYTES
      ) {
        return { publicKey, privateKey };
      } else {
        console.warn(
          "Stored device keys seem invalid (length mismatch). Regenerating.",
        );
      }
    } catch (e) {
      console.error("Error decoding stored device keys, regenerating:", e);
    }
  }

  // If keys are not found or invalid, generate new ones
  await sodium.ready;
  const { publicKey, privateKey } =
    await encryptionService.generateLongTermKeyPair();

  await customStore.save(
    PUBLIC_KEY_KEY,
    encryptionService.uint8ArrayToBase64(publicKey),
  );
  await SecureStore.setItemAsync(
    PRIVATE_KEY_SECURE_KEY,
    encryptionService.uint8ArrayToBase64(privateKey),
  );

  return { publicKey, privateKey };
};

export const ensureDeviceIdentity = async (): Promise<DeviceIdentity> => {
  const deviceId = await getOrGenerateDeviceIdentifier();
  const { publicKey, privateKey } = await getOrGenerateDeviceKeyPair();
  const { publicKey: signingPublicKey, privateKey: signingPrivateKey } =
    await getOrGenerateDeviceSigningKeyPair();
  return {
    deviceId,
    publicKey,
    privateKey,
    signingPublicKey,
    signingPrivateKey,
  };
};

export const getOrGenerateDeviceSigningKeyPair = async (): Promise<{
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}> => {
  let storedPublicKeyBase64: string | undefined;
  try {
    storedPublicKeyBase64 = await customStore.get(SIGNING_PUBLIC_KEY_KEY);
  } catch {
    // Ignore read errors and regenerate below.
  }
  const storedPrivateKeyBase64 = await SecureStore.getItemAsync(
    SIGNING_PRIVATE_KEY_SECURE_KEY,
  );

  if (storedPublicKeyBase64 && storedPrivateKeyBase64) {
    try {
      const publicKey = encryptionService.base64ToUint8Array(
        storedPublicKeyBase64,
      );
      const privateKey = encryptionService.base64ToUint8Array(
        storedPrivateKeyBase64,
      );
      if (
        publicKey.length === SIGNING_PUBLIC_KEY_BYTES &&
        privateKey.length === SIGNING_PRIVATE_KEY_BYTES
      ) {
        return { publicKey, privateKey };
      }
      console.warn(
        "Stored signing keys seem invalid (length mismatch). Regenerating.",
      );
    } catch (e) {
      console.error("Error decoding stored signing keys, regenerating:", e);
    }
  }

  await sodium.ready;
  const { publicKey, privateKey } = sodium.crypto_sign_keypair();
  await customStore.save(
    SIGNING_PUBLIC_KEY_KEY,
    encryptionService.uint8ArrayToBase64(publicKey),
  );
  await SecureStore.setItemAsync(
    SIGNING_PRIVATE_KEY_SECURE_KEY,
    encryptionService.uint8ArrayToBase64(privateKey),
  );
  return { publicKey, privateKey };
};

export const clearDeviceIdentity = async (): Promise<void> => {
  try {
    await customStore.clear(DEVICE_ID_KEY);
  } catch {
    // Ignore
  }
  try {
    await customStore.clear(PUBLIC_KEY_KEY);
  } catch {
    // Ignore
  }
  try {
    await customStore.clear(SIGNING_PUBLIC_KEY_KEY);
  } catch {
    // Ignore
  }
  await SecureStore.deleteItemAsync(PRIVATE_KEY_SECURE_KEY);
  await SecureStore.deleteItemAsync(SIGNING_PRIVATE_KEY_SECURE_KEY);
  console.log("Device identity cleared.");
};
