export type MessageUser = {
  id: string;
  username: string;
};

export type User = {
  id: string;
  username: string;
  email: string;
  created_at: string;
  updated_at: string;
  group_admin_map?: GroupAdminMap;
};

export interface RecipientDevicePublicKey {
  deviceId: string;
  publicKey: Uint8Array;
}

export type GroupAdminMap = Map<string, boolean>;

export type GroupUser = User & { admin: boolean; invited_at?: string };

export type Group = {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  admin: boolean;
  start_time: string | null;
  end_time: string | null;
  group_users: GroupUser[];
  description?: string | null;
  location?: string | null;
  image_url?: string | null;
  blurhash?: string | null;
  last_read_timestamp?: string | null;
  last_message_timestamp?: string | null;
};

export interface CreateGroupParams {
  id: string;
  name: string;
  start_time: string;
  end_time: string;
  description?: string | null;
  location?: string | null;
  image_url?: string | null;
  blurhash?: string | null;
}

export type UpdateGroupParams = {
  name?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  description?: string | null;
  location?: string | null;
  image_url?: string | null;
  blurhash?: string | null;
};

export type UserGroup = {
  id: string;
  user_id: string;
  group_id: string;
  admin: boolean;
  created_at: string;
  updated_at: string;
};

export type ClearImage = {
  imageURL: string | null;
  blurhash: string | null;
};

// --- Message Related Types ---

/**
 * Represents an encrypted message as stored on the client device and ready for decryption.
 * This is the format for SQLite storage.
 */
export interface DbMessage {
  id: string;
  sender_id: string;
  group_id: string;
  timestamp: string;
  client_seq: number | null;
  client_timestamp: string | null;
  ciphertext: Uint8Array;
  message_type: MessageType;
  msg_nonce: Uint8Array;
  sender_ephemeral_public_key: Uint8Array;
  sym_key_encryption_nonce: Uint8Array;
  sealed_symmetric_key: Uint8Array;
}

/**
 * Represents the E2EE message packet sent over WebSocket to the server.
 * All binary data is Base64 encoded for JSON serialization.
 */

export type MessageType = "text" | "image" | "control";

export type RawMessage = {
  id: string;
  group_id: string;
  sender_id: string;
  timestamp: string;
  ciphertext: string; // The encrypted message content (Base64 encoded)
  messageType: MessageType;
  msgNonce: string; // Nonce used for encrypting the message content (Base64 encoded)
  envelopes: Array<{
    deviceId: string; // Recipient's device identifier
    ephPubKey: string; // Sender's ephemeral public key for this box (Base64 encoded)
    keyNonce: string; // Nonce for this box (Base64 encoded)
    sealedKey: string; // The symKey sealed for this recipient (Base64 encoded)
  }>;
};

export type ImageMessageContent = {
  objectKey: string;
  mimeType: string;
  decryptionKey: string; // Base64 encoded
  nonce: string; // Base64 encoded
  width?: number;
  height?: number;
  size?: number;
  blurhash?: string;
  localUri?: string;
};

interface BaseUiMessage {
  id: string;
  group_id: string;
  timestamp: string;
  user: MessageUser;
}

export interface TextUiMessage extends BaseUiMessage {
  type: "text";
  content: string; // Plaintext
}

export interface ImageUiMessage extends BaseUiMessage {
  type: "image";
  content: ImageMessageContent;
  localUri?: string;
  status: "downloading" | "decrypting" | "ready" | "error";
}

export type UiMessage = TextUiMessage | ImageUiMessage;

export type DateOptions = {
  startTime: Date | null;
  endTime: Date | null;
};

export type PickerImageResult = {
  url: string;
  base64: string;
};
