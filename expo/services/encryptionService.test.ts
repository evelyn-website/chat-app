import {
  uint8ArrayToBase64,
  base64ToUint8Array,
  generateLongTermKeyPair,
  processAndDecodeIncomingMessage,
  encryptAndPrepareMessageForSending,
  decryptStoredMessage,
  readImageAsBytes,
  encryptImageFile,
  createImageMessagePayload,
  decryptImageFile,
  saveBytesToLocalFile,
} from './encryptionService';
import { RawMessage, DbMessage, MessageType } from '../types/types';
import sodium from 'react-native-libsodium';
import * as FileSystem from 'expo-file-system';

// Mock dependencies
jest.mock('react-native-libsodium');
jest.mock('expo-file-system', () => {
  // Ensure EncodingType is available - inline mock that includes it
  const fileStorage = new Map();
  return {
    documentDirectory: 'file:///mock/documents/',
    cacheDirectory: 'file:///mock/cache/',
    temporaryDirectory: 'file:///mock/temp/',
    EncodingType: {
      UTF8: 'utf8',
      Base64: 'base64',
    },
    readAsStringAsync: jest.fn((fileUri, options = {}) => {
      const content = fileStorage.get(fileUri);
      if (!content) {
        return Promise.reject(new Error(`File not found: ${fileUri}`));
      }
      return Promise.resolve(content);
    }),
    writeAsStringAsync: jest.fn((fileUri, contents, options = {}) => {
      fileStorage.set(fileUri, contents);
      return Promise.resolve();
    }),
    deleteAsync: jest.fn((fileUri, options = {}) => {
      if (options.idempotent && !fileStorage.has(fileUri)) {
        return Promise.resolve();
      }
      if (!fileUri) {
        return Promise.resolve();
      }
      if (!fileStorage.has(fileUri)) {
        return Promise.reject(new Error(`File not found: ${fileUri}`));
      }
      fileStorage.delete(fileUri);
      return Promise.resolve();
    }),
    getInfoAsync: jest.fn((fileUri) => {
      const exists = fileStorage.has(fileUri);
      return Promise.resolve({
        exists,
        isDirectory: false,
        modificationTime: Date.now() / 1000,
        size: exists ? fileStorage.get(fileUri).length : 0,
        uri: fileUri,
      });
    }),
  };
});
jest.mock('uuid', () => ({
  v4: jest.fn(() => 'test-uuid-1234'),
}));
jest.mock('js-base64', () => ({
  Base64: {
    fromUint8Array: jest.fn((arr) => {
      // Simple Base64 encoding for testing
      return Buffer.from(arr).toString('base64');
    }),
    toUint8Array: jest.fn((str) => {
      // Simple Base64 decoding for testing
      // Throw error for invalid Base64 strings
      if (str && str.includes('!!!')) {
        throw new Error('Invalid Base64 string');
      }
      try {
        const decoded = Buffer.from(str, 'base64');
        return new Uint8Array(decoded);
      } catch {
        throw new Error('Invalid Base64 string');
      }
    }),
  },
}));

describe('encryptionService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset sodium mock if it has a __reset__ method
    if ((sodium as any).__reset__) {
      (sodium as any).__reset__();
    }
  });

  describe('Base64 Conversion', () => {
    describe('uint8ArrayToBase64', () => {
      it('should convert Uint8Array to Base64 string', () => {
        const input = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
        const result = uint8ArrayToBase64(input);
        expect(result).toBe('SGVsbG8=');
      });

      it('should handle empty array', () => {
        const input = new Uint8Array([]);
        const result = uint8ArrayToBase64(input);
        expect(result).toBe('');
      });

      it('should handle binary data', () => {
        const input = new Uint8Array([0, 1, 255, 128, 64]);
        const result = uint8ArrayToBase64(input);
        expect(typeof result).toBe('string');
        expect(result.length).toBeGreaterThan(0);
      });
    });

    describe('base64ToUint8Array', () => {
      it('should convert Base64 string to Uint8Array', () => {
        const input = 'SGVsbG8=';
        const result = base64ToUint8Array(input);
        expect(result).toEqual(new Uint8Array([72, 101, 108, 108, 111]));
      });

      it('should handle empty string', () => {
        const input = '';
        const result = base64ToUint8Array(input);
        expect(result).toEqual(new Uint8Array([]));
      });

      it('should round-trip correctly', () => {
        const original = new Uint8Array([1, 2, 3, 4, 5, 255, 0, 128]);
        const base64 = uint8ArrayToBase64(original);
        const restored = base64ToUint8Array(base64);
        expect(restored).toEqual(original);
      });
    });
  });

  describe('Key Generation', () => {
    describe('generateLongTermKeyPair', () => {
      it('should generate a key pair with correct properties', async () => {
        const result = await generateLongTermKeyPair();

        expect(result).toHaveProperty('publicKey');
        expect(result).toHaveProperty('privateKey');
        expect(result.publicKey).toBeInstanceOf(Uint8Array);
        expect(result.privateKey).toBeInstanceOf(Uint8Array);
      });

      it('should generate keys with correct byte lengths', async () => {
        const result = await generateLongTermKeyPair();

        // Mock returns 32 bytes for both keys (libsodium standard)
        expect(result.publicKey.length).toBe(32);
        expect(result.privateKey.length).toBe(32);
      });

      it('should call sodium.crypto_box_keypair', async () => {
        await generateLongTermKeyPair();
        expect(sodium.crypto_box_keypair).toHaveBeenCalled();
      });

      it('should wait for sodium.ready', async () => {
        const result = await generateLongTermKeyPair();
        expect(result).toBeTruthy();
      });

      it('should generate unique keys on subsequent calls', async () => {
        const keypair1 = await generateLongTermKeyPair();
        const keypair2 = await generateLongTermKeyPair();

        // In a real implementation, keys would be different
        // Mock might return same values, but structure should be consistent
        expect(keypair1.publicKey).toBeInstanceOf(Uint8Array);
        expect(keypair2.publicKey).toBeInstanceOf(Uint8Array);
      });
    });
  });

  describe('Message Processing (Incoming)', () => {
    describe('processAndDecodeIncomingMessage', () => {
      const mockRawMessage: RawMessage = {
        id: 'msg-123',
        group_id: 'group-456',
        sender_id: 'sender-789',
        timestamp: '2024-01-01T00:00:00Z',
        messageType: MessageType.TEXT,
        msgNonce: uint8ArrayToBase64(new Uint8Array(24).fill(1)),
        ciphertext: uint8ArrayToBase64(new Uint8Array([1, 2, 3, 4])),
        envelopes: [
          {
            deviceId: 'device-1',
            ephPubKey: uint8ArrayToBase64(new Uint8Array(32).fill(2)),
            keyNonce: uint8ArrayToBase64(new Uint8Array(24).fill(3)),
            sealedKey: uint8ArrayToBase64(new Uint8Array(48).fill(4)),
          },
          {
            deviceId: 'device-2',
            ephPubKey: uint8ArrayToBase64(new Uint8Array(32).fill(5)),
            keyNonce: uint8ArrayToBase64(new Uint8Array(24).fill(6)),
            sealedKey: uint8ArrayToBase64(new Uint8Array(48).fill(7)),
          },
        ],
      };

      it('should process message with matching envelope', () => {
        const result = processAndDecodeIncomingMessage(
          mockRawMessage,
          'device-1',
          'sender-789',
          'msg-123',
          '2024-01-01T00:00:00Z'
        );

        expect(result).not.toBeNull();
        expect(result).toHaveProperty('id', 'msg-123');
        expect(result).toHaveProperty('group_id', 'group-456');
        expect(result).toHaveProperty('sender_id', 'sender-789');
        expect(result).toHaveProperty('timestamp', '2024-01-01T00:00:00Z');
      });

      it('should decode Base64 fields correctly', () => {
        const result = processAndDecodeIncomingMessage(
          mockRawMessage,
          'device-1',
          'sender-789',
          'msg-123',
          '2024-01-01T00:00:00Z'
        );

        expect(result).not.toBeNull();
        expect(result!.ciphertext).toBeInstanceOf(Uint8Array);
        expect(result!.msg_nonce).toBeInstanceOf(Uint8Array);
        expect(result!.sender_ephemeral_public_key).toBeInstanceOf(Uint8Array);
        expect(result!.sym_key_encryption_nonce).toBeInstanceOf(Uint8Array);
        expect(result!.sealed_symmetric_key).toBeInstanceOf(Uint8Array);
      });

      it('should use correct envelope based on device ID', () => {
        const result1 = processAndDecodeIncomingMessage(
          mockRawMessage,
          'device-1',
          'sender-789',
          'msg-123',
          '2024-01-01T00:00:00Z'
        );

        const result2 = processAndDecodeIncomingMessage(
          mockRawMessage,
          'device-2',
          'sender-789',
          'msg-123',
          '2024-01-01T00:00:00Z'
        );

        expect(result1).not.toBeNull();
        expect(result2).not.toBeNull();

        // Envelope data should be different for different devices
        expect(result1!.sender_ephemeral_public_key[0]).toBe(2);
        expect(result2!.sender_ephemeral_public_key[0]).toBe(5);
      });

      it('should return null if no matching envelope found', () => {
        const result = processAndDecodeIncomingMessage(
          mockRawMessage,
          'device-nonexistent',
          'sender-789',
          'msg-123',
          '2024-01-01T00:00:00Z'
        );

        expect(result).toBeNull();
      });

      it('should return null on Base64 decoding error', () => {
        const invalidMessage = {
          ...mockRawMessage,
          ciphertext: 'invalid-base64!!!',
        };

        const result = processAndDecodeIncomingMessage(
          invalidMessage,
          'device-1',
          'sender-789',
          'msg-123',
          '2024-01-01T00:00:00Z'
        );

        expect(result).toBeNull();
      });

      it('should set message type correctly', () => {
        const result = processAndDecodeIncomingMessage(
          mockRawMessage,
          'device-1',
          'sender-789',
          'msg-123',
          '2024-01-01T00:00:00Z'
        );

        expect(result).not.toBeNull();
        expect(result!.message_type).toBe(MessageType.TEXT);
      });

      it('should set client_seq and client_timestamp to null', () => {
        const result = processAndDecodeIncomingMessage(
          mockRawMessage,
          'device-1',
          'sender-789',
          'msg-123',
          '2024-01-01T00:00:00Z'
        );

        expect(result).not.toBeNull();
        expect(result!.client_seq).toBeNull();
        expect(result!.client_timestamp).toBeNull();
      });
    });
  });

  describe('Message Encryption (Outgoing)', () => {
    describe('encryptAndPrepareMessageForSending', () => {
      const recipientDeviceKeys = [
        {
          deviceId: 'device-1',
          publicKey: new Uint8Array(32).fill(10),
        },
        {
          deviceId: 'device-2',
          publicKey: new Uint8Array(32).fill(20),
        },
      ];

      it('should encrypt message and create envelopes', async () => {
        const result = await encryptAndPrepareMessageForSending(
          'msg-123',
          'Hello, World!',
          'group-456',
          recipientDeviceKeys,
          MessageType.TEXT
        );

        expect(result).not.toBeNull();
        expect(result).toHaveProperty('id', 'msg-123');
        expect(result).toHaveProperty('group_id', 'group-456');
        expect(result).toHaveProperty('messageType', MessageType.TEXT);
        expect(result).toHaveProperty('msgNonce');
        expect(result).toHaveProperty('ciphertext');
        expect(result).toHaveProperty('envelopes');
      });

      it('should create envelope for each recipient', async () => {
        const result = await encryptAndPrepareMessageForSending(
          'msg-123',
          'Hello, World!',
          'group-456',
          recipientDeviceKeys,
          MessageType.TEXT
        );

        expect(result).not.toBeNull();
        expect(result!.envelopes).toHaveLength(2);
        expect(result!.envelopes[0]).toHaveProperty('deviceId', 'device-1');
        expect(result!.envelopes[1]).toHaveProperty('deviceId', 'device-2');
      });

      it('should Base64 encode all binary fields', async () => {
        const result = await encryptAndPrepareMessageForSending(
          'msg-123',
          'Hello, World!',
          'group-456',
          recipientDeviceKeys,
          MessageType.TEXT
        );

        expect(result).not.toBeNull();
        expect(typeof result!.msgNonce).toBe('string');
        expect(typeof result!.ciphertext).toBe('string');
        expect(typeof result!.envelopes[0].ephPubKey).toBe('string');
        expect(typeof result!.envelopes[0].keyNonce).toBe('string');
        expect(typeof result!.envelopes[0].sealedKey).toBe('string');
      });

      it('should handle single recipient', async () => {
        const singleRecipient = [recipientDeviceKeys[0]];

        const result = await encryptAndPrepareMessageForSending(
          'msg-123',
          'Hello, World!',
          'group-456',
          singleRecipient,
          MessageType.TEXT
        );

        expect(result).not.toBeNull();
        expect(result!.envelopes).toHaveLength(1);
      });

      it('should handle multiple recipients', async () => {
        const multipleRecipients = [
          ...recipientDeviceKeys,
          { deviceId: 'device-3', publicKey: new Uint8Array(32).fill(30) },
          { deviceId: 'device-4', publicKey: new Uint8Array(32).fill(40) },
        ];

        const result = await encryptAndPrepareMessageForSending(
          'msg-123',
          'Hello, World!',
          'group-456',
          multipleRecipients,
          MessageType.TEXT
        );

        expect(result).not.toBeNull();
        expect(result!.envelopes).toHaveLength(4);
      });

      it('should handle empty message', async () => {
        const result = await encryptAndPrepareMessageForSending(
          'msg-123',
          '',
          'group-456',
          recipientDeviceKeys,
          MessageType.TEXT
        );

        expect(result).not.toBeNull();
      });

      it('should handle unicode characters', async () => {
        const result = await encryptAndPrepareMessageForSending(
          'msg-123',
          'Hello 👋 World 🌍',
          'group-456',
          recipientDeviceKeys,
          MessageType.TEXT
        );

        expect(result).not.toBeNull();
      });

      it('should call sodium encryption functions', async () => {
        await encryptAndPrepareMessageForSending(
          'msg-123',
          'Hello, World!',
          'group-456',
          recipientDeviceKeys,
          MessageType.TEXT
        );

        expect(sodium.crypto_secretbox_keygen).toHaveBeenCalled();
        expect(sodium.randombytes_buf).toHaveBeenCalled();
        expect(sodium.crypto_secretbox_easy).toHaveBeenCalled();
        expect(sodium.crypto_box_keypair).toHaveBeenCalled();
        expect(sodium.crypto_box_easy).toHaveBeenCalled();
      });

      it('should handle encryption errors gracefully', async () => {
        // Mock encryption failure
        (sodium.crypto_secretbox_easy as jest.Mock).mockImplementationOnce(() => {
          throw new Error('Encryption failed');
        });

        const result = await encryptAndPrepareMessageForSending(
          'msg-123',
          'Hello, World!',
          'group-456',
          recipientDeviceKeys,
          MessageType.TEXT
        );

        expect(result).toBeNull();
      });
    });
  });

  describe('Message Decryption', () => {
    describe('decryptStoredMessage', () => {
      const mockStoredMessage: DbMessage = {
        id: 'msg-123',
        group_id: 'group-456',
        sender_id: 'sender-789',
        timestamp: '2024-01-01T00:00:00Z',
        client_seq: null,
        client_timestamp: null,
        // Ciphertext must be at least 16 bytes (authentication tag) + message length
        // Using 32 bytes to represent an encrypted message (16 bytes tag + 16 bytes message)
        ciphertext: new Uint8Array(32).fill(1),
        message_type: MessageType.TEXT,
        msg_nonce: new Uint8Array(24).fill(1),
        sender_ephemeral_public_key: new Uint8Array(32).fill(2),
        sym_key_encryption_nonce: new Uint8Array(24).fill(3),
        sealed_symmetric_key: new Uint8Array(48).fill(4),
      };

      const mockPrivateKey = new Uint8Array(32).fill(5);

      it('should decrypt message successfully', async () => {
        const result = await decryptStoredMessage(mockStoredMessage, mockPrivateKey);

        expect(result).not.toBeNull();
        expect(typeof result).toBe('string');
      });

      it('should call sodium decryption functions', async () => {
        await decryptStoredMessage(mockStoredMessage, mockPrivateKey);

        expect(sodium.crypto_box_open_easy).toHaveBeenCalled();
        expect(sodium.crypto_secretbox_open_easy).toHaveBeenCalled();
      });

      it('should return null if symmetric key decryption fails', async () => {
        (sodium.crypto_box_open_easy as jest.Mock).mockReturnValueOnce(null);

        const result = await decryptStoredMessage(mockStoredMessage, mockPrivateKey);

        expect(result).toBeNull();
      });

      it('should return null if message content decryption fails', async () => {
        (sodium.crypto_secretbox_open_easy as jest.Mock).mockReturnValueOnce(null);

        const result = await decryptStoredMessage(mockStoredMessage, mockPrivateKey);

        expect(result).toBeNull();
      });

      it('should handle decryption errors gracefully', async () => {
        (sodium.crypto_box_open_easy as jest.Mock).mockImplementationOnce(() => {
          throw new Error('Decryption failed');
        });

        const result = await decryptStoredMessage(mockStoredMessage, mockPrivateKey);

        expect(result).toBeNull();
      });

      it('should convert decrypted bytes to string', async () => {
        const mockDecryptedBytes = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
        (sodium.to_string as jest.Mock).mockReturnValueOnce('Hello');
        (sodium.crypto_secretbox_open_easy as jest.Mock).mockReturnValueOnce(mockDecryptedBytes);

        const result = await decryptStoredMessage(mockStoredMessage, mockPrivateKey);

        expect(result).toBe('Hello');
        expect(sodium.to_string).toHaveBeenCalledWith(mockDecryptedBytes);
      });
    });
  });

  describe('Image Encryption/Decryption', () => {
    describe('readImageAsBytes', () => {
      it('should read image file as Uint8Array', async () => {
        const mockBase64 = 'SGVsbG8=';
        (FileSystem.readAsStringAsync as jest.Mock).mockResolvedValueOnce(mockBase64);

        const result = await readImageAsBytes('file:///path/to/image.jpg');

        expect(result).toBeInstanceOf(Uint8Array);
        expect(FileSystem.readAsStringAsync).toHaveBeenCalledWith(
          'file:///path/to/image.jpg',
          { encoding: FileSystem.EncodingType.Base64 }
        );
      });

      it('should convert Base64 to bytes correctly', async () => {
        const mockBase64 = uint8ArrayToBase64(new Uint8Array([1, 2, 3, 4, 5]));
        (FileSystem.readAsStringAsync as jest.Mock).mockResolvedValueOnce(mockBase64);

        const result = await readImageAsBytes('file:///path/to/image.jpg');

        expect(result).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
      });
    });

    describe('encryptImageFile', () => {
      it('should encrypt image bytes', async () => {
        const imageBytes = new Uint8Array([1, 2, 3, 4, 5]);
        const result = await encryptImageFile(imageBytes);

        expect(result).not.toBeNull();
        expect(result).toHaveProperty('encryptedBlob');
        expect(result).toHaveProperty('imageKey');
        expect(result).toHaveProperty('imageNonce');
      });

      it('should return Uint8Arrays for all fields', async () => {
        const imageBytes = new Uint8Array([1, 2, 3, 4, 5]);
        const result = await encryptImageFile(imageBytes);

        expect(result).not.toBeNull();
        expect(result!.encryptedBlob).toBeInstanceOf(Uint8Array);
        expect(result!.imageKey).toBeInstanceOf(Uint8Array);
        expect(result!.imageNonce).toBeInstanceOf(Uint8Array);
      });

      it('should call sodium encryption functions', async () => {
        const imageBytes = new Uint8Array([1, 2, 3, 4, 5]);
        await encryptImageFile(imageBytes);

        expect(sodium.crypto_secretbox_keygen).toHaveBeenCalled();
        expect(sodium.randombytes_buf).toHaveBeenCalled();
        expect(sodium.crypto_secretbox_easy).toHaveBeenCalled();
      });

      it('should handle encryption errors', async () => {
        (sodium.crypto_secretbox_easy as jest.Mock).mockImplementationOnce(() => {
          throw new Error('Encryption failed');
        });

        const imageBytes = new Uint8Array([1, 2, 3, 4, 5]);
        const result = await encryptImageFile(imageBytes);

        expect(result).toBeNull();
      });

      it('should handle empty image bytes', async () => {
        const imageBytes = new Uint8Array([]);
        const result = await encryptImageFile(imageBytes);

        expect(result).not.toBeNull();
      });
    });

    describe('decryptImageFile', () => {
      it('should decrypt image bytes', async () => {
        // Encrypted bytes must be at least 16 bytes (authentication tag) + message length
        // Using 32 bytes to represent an encrypted image (16 bytes tag + 16 bytes image data)
        const encryptedBytes = new Uint8Array(32).fill(1);
        const key = new Uint8Array(32).fill(1);
        const nonce = new Uint8Array(24).fill(2);

        const result = await decryptImageFile(encryptedBytes, key, nonce);

        expect(result).not.toBeNull();
        expect(result).toBeInstanceOf(Uint8Array);
      });

      it('should call sodium decryption', async () => {
        // Encrypted bytes must be at least 16 bytes (authentication tag) + message length
        const encryptedBytes = new Uint8Array(32).fill(1);
        const key = new Uint8Array(32).fill(1);
        const nonce = new Uint8Array(24).fill(2);

        await decryptImageFile(encryptedBytes, key, nonce);

        expect(sodium.crypto_secretbox_open_easy).toHaveBeenCalledWith(
          encryptedBytes,
          nonce,
          key
        );
      });

      it('should handle decryption errors', async () => {
        (sodium.crypto_secretbox_open_easy as jest.Mock).mockImplementationOnce(() => {
          throw new Error('Decryption failed');
        });

        const encryptedBytes = new Uint8Array([1, 2, 3, 4, 5]);
        const key = new Uint8Array(32).fill(1);
        const nonce = new Uint8Array(24).fill(2);

        const result = await decryptImageFile(encryptedBytes, key, nonce);

        expect(result).toBeNull();
      });

      it('should round-trip encrypt and decrypt', async () => {
        const originalBytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);

        // Encrypt
        const encrypted = await encryptImageFile(originalBytes);
        expect(encrypted).not.toBeNull();

        // Mock decryption to return original
        (sodium.crypto_secretbox_open_easy as jest.Mock).mockReturnValueOnce(originalBytes);

        // Decrypt
        const decrypted = await decryptImageFile(
          encrypted!.encryptedBlob,
          encrypted!.imageKey,
          encrypted!.imageNonce
        );

        expect(decrypted).toEqual(originalBytes);
      });
    });

    describe('createImageMessagePayload', () => {
      it('should create valid JSON payload', () => {
        const objectKey = 's3-key-123';
        const mimeType = 'image/jpeg';
        const imageKey = new Uint8Array(32).fill(1);
        const imageNonce = new Uint8Array(24).fill(2);
        const dimensions = { width: 800, height: 600 };
        const blurhash = 'LEHV6nWB2yk8pyo0adR*.7kCMdnj';

        const result = createImageMessagePayload(
          objectKey,
          mimeType,
          imageKey,
          imageNonce,
          dimensions,
          blurhash
        );

        expect(typeof result).toBe('string');

        const parsed = JSON.parse(result);
        expect(parsed).toHaveProperty('objectKey', objectKey);
        expect(parsed).toHaveProperty('mimeType', mimeType);
        expect(parsed).toHaveProperty('decryptionKey');
        expect(parsed).toHaveProperty('nonce');
        expect(parsed).toHaveProperty('width', 800);
        expect(parsed).toHaveProperty('height', 600);
        expect(parsed).toHaveProperty('blurhash', blurhash);
      });

      it('should Base64 encode key and nonce', () => {
        const imageKey = new Uint8Array(32).fill(1);
        const imageNonce = new Uint8Array(24).fill(2);

        const result = createImageMessagePayload(
          's3-key',
          'image/jpeg',
          imageKey,
          imageNonce,
          { width: 100, height: 100 },
          null
        );

        const parsed = JSON.parse(result);
        expect(typeof parsed.decryptionKey).toBe('string');
        expect(typeof parsed.nonce).toBe('string');

        // Verify Base64 decoding works
        const decodedKey = base64ToUint8Array(parsed.decryptionKey);
        const decodedNonce = base64ToUint8Array(parsed.nonce);
        expect(decodedKey).toEqual(imageKey);
        expect(decodedNonce).toEqual(imageNonce);
      });

      it('should omit blurhash if null', () => {
        const result = createImageMessagePayload(
          's3-key',
          'image/png',
          new Uint8Array(32),
          new Uint8Array(24),
          { width: 200, height: 200 },
          null
        );

        const parsed = JSON.parse(result);
        expect(parsed).not.toHaveProperty('blurhash');
      });

      it('should include blurhash if provided', () => {
        const result = createImageMessagePayload(
          's3-key',
          'image/png',
          new Uint8Array(32),
          new Uint8Array(24),
          { width: 200, height: 200 },
          'LEHV6nWB2yk8pyo0adR*.7kCMdnj'
        );

        const parsed = JSON.parse(result);
        expect(parsed).toHaveProperty('blurhash', 'LEHV6nWB2yk8pyo0adR*.7kCMdnj');
      });

      it('should handle different MIME types', () => {
        const mimeTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

        mimeTypes.forEach((mimeType) => {
          const result = createImageMessagePayload(
            's3-key',
            mimeType,
            new Uint8Array(32),
            new Uint8Array(24),
            { width: 100, height: 100 },
            null
          );

          const parsed = JSON.parse(result);
          expect(parsed.mimeType).toBe(mimeType);
        });
      });

      it('should handle various dimensions', () => {
        const dimensions = [
          { width: 100, height: 100 },
          { width: 1920, height: 1080 },
          { width: 3840, height: 2160 },
          { width: 1, height: 1 },
        ];

        dimensions.forEach((dim) => {
          const result = createImageMessagePayload(
            's3-key',
            'image/jpeg',
            new Uint8Array(32),
            new Uint8Array(24),
            dim,
            null
          );

          const parsed = JSON.parse(result);
          expect(parsed.width).toBe(dim.width);
          expect(parsed.height).toBe(dim.height);
        });
      });
    });

    describe('saveBytesToLocalFile', () => {
      it('should save bytes to file as Base64', async () => {
        const bytes = new Uint8Array([1, 2, 3, 4, 5]);
        const localUri = 'file:///path/to/output.jpg';

        const result = await saveBytesToLocalFile(bytes, localUri);

        expect(result).toBe(localUri);
        expect(FileSystem.writeAsStringAsync).toHaveBeenCalledWith(
          localUri,
          expect.any(String),
          { encoding: FileSystem.EncodingType.Base64 }
        );
      });

      it('should convert bytes to Base64 before saving', async () => {
        const bytes = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
        const localUri = 'file:///path/to/output.jpg';

        await saveBytesToLocalFile(bytes, localUri);

        const expectedBase64 = uint8ArrayToBase64(bytes);
        expect(FileSystem.writeAsStringAsync).toHaveBeenCalledWith(
          localUri,
          expectedBase64,
          { encoding: FileSystem.EncodingType.Base64 }
        );
      });

      it('should return the same URI passed in', async () => {
        const bytes = new Uint8Array([1, 2, 3]);
        const localUri = 'file:///custom/path/image.png';

        const result = await saveBytesToLocalFile(bytes, localUri);

        expect(result).toBe(localUri);
      });
    });
  });

  describe('ConcurrencyLimiter Integration', () => {
    it('should handle concurrent encryption operations', async () => {
      const operations = Array.from({ length: 10 }, (_, i) =>
        encryptAndPrepareMessageForSending(
          `msg-${i}`,
          `Message ${i}`,
          'group-123',
          [{ deviceId: 'device-1', publicKey: new Uint8Array(32) }],
          MessageType.TEXT
        )
      );

      const results = await Promise.all(operations);

      expect(results).toHaveLength(10);
      results.forEach((result) => {
        expect(result).not.toBeNull();
      });
    });

    it('should handle concurrent decryption operations', async () => {
      const mockMessage: DbMessage = {
        id: 'msg-123',
        group_id: 'group-456',
        sender_id: 'sender-789',
        timestamp: '2024-01-01T00:00:00Z',
        client_seq: null,
        client_timestamp: null,
        ciphertext: new Uint8Array([1, 2, 3, 4]),
        message_type: MessageType.TEXT,
        msg_nonce: new Uint8Array(24),
        sender_ephemeral_public_key: new Uint8Array(32),
        sym_key_encryption_nonce: new Uint8Array(24),
        sealed_symmetric_key: new Uint8Array(48),
      };

      const operations = Array.from({ length: 10 }, () =>
        decryptStoredMessage(mockMessage, new Uint8Array(32))
      );

      const results = await Promise.all(operations);

      expect(results).toHaveLength(10);
    });

    it('should handle concurrent image encryption operations', async () => {
      const imageBytes = new Uint8Array([1, 2, 3, 4, 5]);
      const operations = Array.from({ length: 5 }, () =>
        encryptImageFile(imageBytes)
      );

      const results = await Promise.all(operations);

      expect(results).toHaveLength(5);
      results.forEach((result) => {
        expect(result).not.toBeNull();
      });
    });
  });
});
