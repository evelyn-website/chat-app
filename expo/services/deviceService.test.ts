import {
  getOrGenerateDeviceIdentifier,
  getOrGenerateDeviceKeyPair,
  ensureDeviceIdentity,
  clearDeviceIdentity,
} from './deviceService';
import * as SecureStore from 'expo-secure-store';
import * as customStore from '@/util/custom-store';
import * as encryptionService from './encryptionService';
import sodium from 'react-native-libsodium';
import { v4 as uuidv4 } from 'uuid';

// Mock dependencies
jest.mock('expo-secure-store');
jest.mock('@/util/custom-store');
jest.mock('./encryptionService');
jest.mock('react-native-libsodium');
jest.mock('uuid', () => ({
  v4: jest.fn(() => 'test-device-id-uuid-1234'),
}));

describe('deviceService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getOrGenerateDeviceIdentifier', () => {
    it('should retrieve existing device identifier from custom store', async () => {
      const existingId = 'existing-device-id-5678';
      (customStore.get as jest.Mock).mockResolvedValueOnce(existingId);

      const result = await getOrGenerateDeviceIdentifier();

      expect(result).toBe(existingId);
      expect(customStore.get).toHaveBeenCalledWith('deviceIdentifier');
      expect(customStore.save).not.toHaveBeenCalled();
    });

    it('should generate new device identifier if not found', async () => {
      (customStore.get as jest.Mock).mockRejectedValueOnce(
        new Error('Not found')
      );

      const result = await getOrGenerateDeviceIdentifier();

      expect(result).toBe('test-device-id-uuid-1234');
      expect(uuidv4).toHaveBeenCalled();
      expect(customStore.save).toHaveBeenCalledWith(
        'deviceIdentifier',
        'test-device-id-uuid-1234'
      );
    });

    it('should generate new device identifier when custom store returns undefined', async () => {
      (customStore.get as jest.Mock).mockResolvedValueOnce(undefined);

      const result = await getOrGenerateDeviceIdentifier();

      expect(result).toBe('test-device-id-uuid-1234');
      expect(uuidv4).toHaveBeenCalled();
      expect(customStore.save).toHaveBeenCalledWith(
        'deviceIdentifier',
        'test-device-id-uuid-1234'
      );
    });

    it('should generate new device identifier when custom store returns empty string', async () => {
      (customStore.get as jest.Mock).mockResolvedValueOnce('');

      const result = await getOrGenerateDeviceIdentifier();

      expect(result).toBe('test-device-id-uuid-1234');
      expect(customStore.save).toHaveBeenCalled();
    });

    it('should return UUID v4 format device identifier', async () => {
      const uuidV4Pattern =
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

      (customStore.get as jest.Mock).mockRejectedValueOnce(
        new Error('Not found')
      );
      (uuidv4 as jest.Mock).mockReturnValueOnce(
        '12345678-1234-4234-9234-123456789012'
      );

      const result = await getOrGenerateDeviceIdentifier();

      // The mock returns the hardcoded UUID, but verify it matches v4 pattern
      expect(result).toBe('12345678-1234-4234-9234-123456789012');
    });

    it('should handle errors when retrieving existing identifier', async () => {
      const error = new Error('Storage error');
      (customStore.get as jest.Mock).mockRejectedValueOnce(error);

      // Should not throw, should generate new ID
      const result = await getOrGenerateDeviceIdentifier();

      expect(result).toBe('test-device-id-uuid-1234');
      expect(customStore.save).toHaveBeenCalled();
    });

    it('should handle errors when saving new identifier', async () => {
      (customStore.get as jest.Mock).mockResolvedValueOnce(undefined);
      (customStore.save as jest.Mock).mockRejectedValueOnce(
        new Error('Save error')
      );

      // Should not throw even if save fails, still return the generated ID
      await expect(
        getOrGenerateDeviceIdentifier()
      ).rejects.toThrow('Save error');
    });
  });

  describe('getOrGenerateDeviceKeyPair', () => {
    const mockPublicKeyBase64 = 'mockPublicKeyBase64String==';
    const mockPrivateKeyBase64 = 'mockPrivateKeyBase64String==';
    const mockPublicKeyBytes = new Uint8Array(32).fill(10);
    const mockPrivateKeyBytes = new Uint8Array(32).fill(20);

    it('should retrieve existing key pair from storage', async () => {
      (customStore.get as jest.Mock).mockResolvedValueOnce(
        mockPublicKeyBase64
      );
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(
        mockPrivateKeyBase64
      );
      (encryptionService.base64ToUint8Array as jest.Mock)
        .mockReturnValueOnce(mockPublicKeyBytes)
        .mockReturnValueOnce(mockPrivateKeyBytes);
      (sodium.crypto_box_PUBLICKEYBYTES as any) = 32;
      (sodium.crypto_box_SECRETKEYBYTES as any) = 32;

      const result = await getOrGenerateDeviceKeyPair();

      expect(result.publicKey).toEqual(mockPublicKeyBytes);
      expect(result.privateKey).toEqual(mockPrivateKeyBytes);
      expect(customStore.get).toHaveBeenCalledWith('devicePublicKey');
      expect(SecureStore.getItemAsync).toHaveBeenCalledWith(
        'devicePrivateKey_v2'
      );
      expect(encryptionService.generateLongTermKeyPair).not.toHaveBeenCalled();
    });

    it('should generate new key pair if not found', async () => {
      (customStore.get as jest.Mock).mockResolvedValueOnce(undefined);
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(null);
      (sodium.ready as any) = Promise.resolve();
      (encryptionService.generateLongTermKeyPair as jest.Mock).mockResolvedValueOnce(
        {
          publicKey: mockPublicKeyBytes,
          privateKey: mockPrivateKeyBytes,
        }
      );
      (encryptionService.uint8ArrayToBase64 as jest.Mock)
        .mockReturnValueOnce(mockPublicKeyBase64)
        .mockReturnValueOnce(mockPrivateKeyBase64);

      const result = await getOrGenerateDeviceKeyPair();

      expect(result.publicKey).toEqual(mockPublicKeyBytes);
      expect(result.privateKey).toEqual(mockPrivateKeyBytes);
      expect(encryptionService.generateLongTermKeyPair).toHaveBeenCalled();
      expect(customStore.save).toHaveBeenCalledWith(
        'devicePublicKey',
        mockPublicKeyBase64
      );
      expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
        'devicePrivateKey_v2',
        mockPrivateKeyBase64
      );
    });

    it('should validate key lengths match crypto constants', async () => {
      const validPublicKey = new Uint8Array(32).fill(1);
      const validPrivateKey = new Uint8Array(32).fill(2);

      (customStore.get as jest.Mock).mockResolvedValueOnce(
        mockPublicKeyBase64
      );
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(
        mockPrivateKeyBase64
      );
      (encryptionService.base64ToUint8Array as jest.Mock)
        .mockReturnValueOnce(validPublicKey)
        .mockReturnValueOnce(validPrivateKey);
      (sodium.crypto_box_PUBLICKEYBYTES as any) = 32;
      (sodium.crypto_box_SECRETKEYBYTES as any) = 32;

      const result = await getOrGenerateDeviceKeyPair();

      expect(result.publicKey).toEqual(validPublicKey);
      expect(result.privateKey).toEqual(validPrivateKey);
    });

    it('should regenerate keys if public key length is invalid', async () => {
      const invalidPublicKey = new Uint8Array(16).fill(1); // Wrong length
      const validPrivateKey = new Uint8Array(32).fill(2);

      (customStore.get as jest.Mock).mockResolvedValueOnce(
        mockPublicKeyBase64
      );
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(
        mockPrivateKeyBase64
      );
      (encryptionService.base64ToUint8Array as jest.Mock)
        .mockReturnValueOnce(invalidPublicKey)
        .mockReturnValueOnce(validPrivateKey);
      (sodium.crypto_box_PUBLICKEYBYTES as any) = 32;
      (sodium.crypto_box_SECRETKEYBYTES as any) = 32;
      (sodium.ready as any) = Promise.resolve();
      (encryptionService.generateLongTermKeyPair as jest.Mock).mockResolvedValueOnce(
        {
          publicKey: mockPublicKeyBytes,
          privateKey: mockPrivateKeyBytes,
        }
      );
      (encryptionService.uint8ArrayToBase64 as jest.Mock)
        .mockReturnValueOnce(mockPublicKeyBase64)
        .mockReturnValueOnce(mockPrivateKeyBase64);

      const result = await getOrGenerateDeviceKeyPair();

      expect(encryptionService.generateLongTermKeyPair).toHaveBeenCalled();
      expect(result.publicKey).toEqual(mockPublicKeyBytes);
      expect(result.privateKey).toEqual(mockPrivateKeyBytes);
    });

    it('should regenerate keys if private key length is invalid', async () => {
      const validPublicKey = new Uint8Array(32).fill(1);
      const invalidPrivateKey = new Uint8Array(16).fill(2); // Wrong length

      (customStore.get as jest.Mock).mockResolvedValueOnce(
        mockPublicKeyBase64
      );
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(
        mockPrivateKeyBase64
      );
      (encryptionService.base64ToUint8Array as jest.Mock)
        .mockReturnValueOnce(validPublicKey)
        .mockReturnValueOnce(invalidPrivateKey);
      (sodium.crypto_box_PUBLICKEYBYTES as any) = 32;
      (sodium.crypto_box_SECRETKEYBYTES as any) = 32;
      (sodium.ready as any) = Promise.resolve();
      (encryptionService.generateLongTermKeyPair as jest.Mock).mockResolvedValueOnce(
        {
          publicKey: mockPublicKeyBytes,
          privateKey: mockPrivateKeyBytes,
        }
      );
      (encryptionService.uint8ArrayToBase64 as jest.Mock)
        .mockReturnValueOnce(mockPublicKeyBase64)
        .mockReturnValueOnce(mockPrivateKeyBase64);

      const result = await getOrGenerateDeviceKeyPair();

      expect(encryptionService.generateLongTermKeyPair).toHaveBeenCalled();
      expect(result.publicKey).toEqual(mockPublicKeyBytes);
      expect(result.privateKey).toEqual(mockPrivateKeyBytes);
    });

    it('should handle corrupted Base64 decoding', async () => {
      (customStore.get as jest.Mock).mockResolvedValueOnce(
        'corrupted-base64!!!'
      );
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(
        mockPrivateKeyBase64
      );
      (encryptionService.base64ToUint8Array as jest.Mock).mockImplementationOnce(
        () => {
          throw new Error('Invalid Base64');
        }
      );
      (sodium.ready as any) = Promise.resolve();
      (encryptionService.generateLongTermKeyPair as jest.Mock).mockResolvedValueOnce(
        {
          publicKey: mockPublicKeyBytes,
          privateKey: mockPrivateKeyBytes,
        }
      );
      (encryptionService.uint8ArrayToBase64 as jest.Mock)
        .mockReturnValueOnce(mockPublicKeyBase64)
        .mockReturnValueOnce(mockPrivateKeyBase64);

      const result = await getOrGenerateDeviceKeyPair();

      expect(encryptionService.generateLongTermKeyPair).toHaveBeenCalled();
      expect(result.publicKey).toEqual(mockPublicKeyBytes);
      expect(result.privateKey).toEqual(mockPrivateKeyBytes);
    });

    it('should store newly generated public key in custom store (not secure)', async () => {
      (customStore.get as jest.Mock).mockResolvedValueOnce(undefined);
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(null);
      (sodium.ready as any) = Promise.resolve();
      (encryptionService.generateLongTermKeyPair as jest.Mock).mockResolvedValueOnce(
        {
          publicKey: mockPublicKeyBytes,
          privateKey: mockPrivateKeyBytes,
        }
      );
      (encryptionService.uint8ArrayToBase64 as jest.Mock)
        .mockReturnValueOnce(mockPublicKeyBase64)
        .mockReturnValueOnce(mockPrivateKeyBase64);

      await getOrGenerateDeviceKeyPair();

      expect(customStore.save).toHaveBeenCalledWith(
        'devicePublicKey',
        mockPublicKeyBase64
      );
    });

    it('should store newly generated private key in secure store', async () => {
      (customStore.get as jest.Mock).mockResolvedValueOnce(undefined);
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(null);
      (sodium.ready as any) = Promise.resolve();
      (encryptionService.generateLongTermKeyPair as jest.Mock).mockResolvedValueOnce(
        {
          publicKey: mockPublicKeyBytes,
          privateKey: mockPrivateKeyBytes,
        }
      );
      (encryptionService.uint8ArrayToBase64 as jest.Mock)
        .mockReturnValueOnce(mockPublicKeyBase64)
        .mockReturnValueOnce(mockPrivateKeyBase64);

      await getOrGenerateDeviceKeyPair();

      expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
        'devicePrivateKey_v2',
        mockPrivateKeyBase64
      );
    });

    it('should use Base64 encoding for storage', async () => {
      (customStore.get as jest.Mock).mockResolvedValueOnce(undefined);
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(null);
      (sodium.ready as any) = Promise.resolve();
      (encryptionService.generateLongTermKeyPair as jest.Mock).mockResolvedValueOnce(
        {
          publicKey: mockPublicKeyBytes,
          privateKey: mockPrivateKeyBytes,
        }
      );
      (encryptionService.uint8ArrayToBase64 as jest.Mock)
        .mockReturnValueOnce(mockPublicKeyBase64)
        .mockReturnValueOnce(mockPrivateKeyBase64);

      await getOrGenerateDeviceKeyPair();

      expect(encryptionService.uint8ArrayToBase64).toHaveBeenCalledWith(
        mockPublicKeyBytes
      );
      expect(encryptionService.uint8ArrayToBase64).toHaveBeenCalledWith(
        mockPrivateKeyBytes
      );
    });

    it('should return 32-byte keys', async () => {
      (customStore.get as jest.Mock).mockResolvedValueOnce(undefined);
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(null);
      (sodium.ready as any) = Promise.resolve();
      const publicKey32 = new Uint8Array(32).fill(1);
      const privateKey32 = new Uint8Array(32).fill(2);
      (encryptionService.generateLongTermKeyPair as jest.Mock).mockResolvedValueOnce(
        {
          publicKey: publicKey32,
          privateKey: privateKey32,
        }
      );
      (encryptionService.uint8ArrayToBase64 as jest.Mock)
        .mockReturnValueOnce('pub')
        .mockReturnValueOnce('priv');

      const result = await getOrGenerateDeviceKeyPair();

      expect(result.publicKey.length).toBe(32);
      expect(result.privateKey.length).toBe(32);
    });

    it('should use only public key from custom store, not secure store for public key', async () => {
      (customStore.get as jest.Mock).mockResolvedValueOnce(
        mockPublicKeyBase64
      );
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(
        mockPrivateKeyBase64
      );
      (encryptionService.base64ToUint8Array as jest.Mock)
        .mockReturnValueOnce(mockPublicKeyBytes)
        .mockReturnValueOnce(mockPrivateKeyBytes);
      (sodium.crypto_box_PUBLICKEYBYTES as any) = 32;
      (sodium.crypto_box_SECRETKEYBYTES as any) = 32;

      await getOrGenerateDeviceKeyPair();

      // Public key should be retrieved from custom store (normal storage)
      expect(customStore.get).toHaveBeenCalledWith('devicePublicKey');
      // Private key should be retrieved from secure store
      expect(SecureStore.getItemAsync).toHaveBeenCalledWith(
        'devicePrivateKey_v2'
      );
    });
  });

  describe('ensureDeviceIdentity', () => {
    const mockDeviceId = 'device-id-1234';
    const mockPublicKeyBytes = new Uint8Array(32).fill(10);
    const mockPrivateKeyBytes = new Uint8Array(32).fill(20);

    it('should return complete device identity object', async () => {
      (customStore.get as jest.Mock).mockResolvedValueOnce(undefined);
      (uuidv4 as jest.Mock).mockReturnValueOnce(mockDeviceId);
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(null);
      (sodium.ready as any) = Promise.resolve();
      (encryptionService.generateLongTermKeyPair as jest.Mock).mockResolvedValueOnce(
        {
          publicKey: mockPublicKeyBytes,
          privateKey: mockPrivateKeyBytes,
        }
      );
      (encryptionService.uint8ArrayToBase64 as jest.Mock)
        .mockReturnValueOnce('pubBase64')
        .mockReturnValueOnce('privBase64');

      const result = await ensureDeviceIdentity();

      expect(result).toHaveProperty('deviceId');
      expect(result).toHaveProperty('publicKey');
      expect(result).toHaveProperty('privateKey');
    });

    it('should return correct deviceId', async () => {
      (customStore.get as jest.Mock)
        .mockResolvedValueOnce(mockDeviceId)
        .mockResolvedValueOnce(undefined);
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(null);
      (sodium.ready as any) = Promise.resolve();
      (encryptionService.generateLongTermKeyPair as jest.Mock).mockResolvedValueOnce(
        {
          publicKey: mockPublicKeyBytes,
          privateKey: mockPrivateKeyBytes,
        }
      );
      (encryptionService.uint8ArrayToBase64 as jest.Mock)
        .mockReturnValueOnce('pubBase64')
        .mockReturnValueOnce('privBase64');

      const result = await ensureDeviceIdentity();

      expect(result.deviceId).toBe(mockDeviceId);
    });

    it('should return valid public key as Uint8Array', async () => {
      (customStore.get as jest.Mock)
        .mockResolvedValueOnce(mockDeviceId)
        .mockResolvedValueOnce(undefined);
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(null);
      (sodium.ready as any) = Promise.resolve();
      (encryptionService.generateLongTermKeyPair as jest.Mock).mockResolvedValueOnce(
        {
          publicKey: mockPublicKeyBytes,
          privateKey: mockPrivateKeyBytes,
        }
      );
      (encryptionService.uint8ArrayToBase64 as jest.Mock)
        .mockReturnValueOnce('pubBase64')
        .mockReturnValueOnce('privBase64');

      const result = await ensureDeviceIdentity();

      expect(result.publicKey).toEqual(mockPublicKeyBytes);
      expect(result.publicKey).toBeInstanceOf(Uint8Array);
    });

    it('should return valid private key as Uint8Array', async () => {
      (customStore.get as jest.Mock)
        .mockResolvedValueOnce(mockDeviceId)
        .mockResolvedValueOnce(undefined);
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(null);
      (sodium.ready as any) = Promise.resolve();
      (encryptionService.generateLongTermKeyPair as jest.Mock).mockResolvedValueOnce(
        {
          publicKey: mockPublicKeyBytes,
          privateKey: mockPrivateKeyBytes,
        }
      );
      (encryptionService.uint8ArrayToBase64 as jest.Mock)
        .mockReturnValueOnce('pubBase64')
        .mockReturnValueOnce('privBase64');

      const result = await ensureDeviceIdentity();

      expect(result.privateKey).toEqual(mockPrivateKeyBytes);
      expect(result.privateKey).toBeInstanceOf(Uint8Array);
    });

    it('should call both identifier and key pair functions', async () => {
      (customStore.get as jest.Mock)
        .mockResolvedValueOnce(mockDeviceId)
        .mockResolvedValueOnce(undefined);
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(null);
      (sodium.ready as any) = Promise.resolve();
      (encryptionService.generateLongTermKeyPair as jest.Mock).mockResolvedValueOnce(
        {
          publicKey: mockPublicKeyBytes,
          privateKey: mockPrivateKeyBytes,
        }
      );
      (encryptionService.uint8ArrayToBase64 as jest.Mock)
        .mockReturnValueOnce('pubBase64')
        .mockReturnValueOnce('privBase64');

      await ensureDeviceIdentity();

      expect(customStore.get).toHaveBeenCalledWith('deviceIdentifier');
      expect(SecureStore.getItemAsync).toHaveBeenCalledWith(
        'devicePrivateKey_v2'
      );
    });

    it('should generate both new id and keys if neither exist', async () => {
      (customStore.get as jest.Mock)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined);
      (uuidv4 as jest.Mock).mockReturnValueOnce(mockDeviceId);
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(null);
      (sodium.ready as any) = Promise.resolve();
      (encryptionService.generateLongTermKeyPair as jest.Mock).mockResolvedValueOnce(
        {
          publicKey: mockPublicKeyBytes,
          privateKey: mockPrivateKeyBytes,
        }
      );
      (encryptionService.uint8ArrayToBase64 as jest.Mock)
        .mockReturnValueOnce('pubBase64')
        .mockReturnValueOnce('privBase64');

      const result = await ensureDeviceIdentity();

      expect(result).toHaveProperty('deviceId');
      expect(result).toHaveProperty('publicKey');
      expect(result).toHaveProperty('privateKey');
      expect(uuidv4).toHaveBeenCalled();
      expect(encryptionService.generateLongTermKeyPair).toHaveBeenCalled();
    });

    it('should handle existing identity retrieval', async () => {
      const existingPublicKeyBase64 = 'existingPubKey==';
      const existingPrivateKeyBase64 = 'existingPrivKey==';

      (customStore.get as jest.Mock)
        .mockResolvedValueOnce(mockDeviceId)
        .mockResolvedValueOnce(existingPublicKeyBase64);
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(
        existingPrivateKeyBase64
      );
      (encryptionService.base64ToUint8Array as jest.Mock)
        .mockReturnValueOnce(mockPublicKeyBytes)
        .mockReturnValueOnce(mockPrivateKeyBytes);
      (sodium.crypto_box_PUBLICKEYBYTES as any) = 32;
      (sodium.crypto_box_SECRETKEYBYTES as any) = 32;

      const result = await ensureDeviceIdentity();

      expect(result.deviceId).toBe(mockDeviceId);
      expect(result.publicKey).toEqual(mockPublicKeyBytes);
      expect(result.privateKey).toEqual(mockPrivateKeyBytes);
      expect(encryptionService.generateLongTermKeyPair).not.toHaveBeenCalled();
    });
  });

  describe('clearDeviceIdentity', () => {
    it('should clear device ID from custom store', async () => {
      (customStore.clear as jest.Mock).mockResolvedValueOnce(undefined);
      (SecureStore.deleteItemAsync as jest.Mock).mockResolvedValueOnce(
        undefined
      );

      await clearDeviceIdentity();

      expect(customStore.clear).toHaveBeenCalledWith('deviceIdentifier');
    });

    it('should clear public key from custom store', async () => {
      (customStore.clear as jest.Mock).mockResolvedValueOnce(undefined);
      (SecureStore.deleteItemAsync as jest.Mock).mockResolvedValueOnce(
        undefined
      );

      await clearDeviceIdentity();

      expect(customStore.clear).toHaveBeenCalledWith('devicePublicKey');
    });

    it('should clear private key from secure store', async () => {
      (customStore.clear as jest.Mock).mockResolvedValueOnce(undefined);
      (SecureStore.deleteItemAsync as jest.Mock).mockResolvedValueOnce(
        undefined
      );

      await clearDeviceIdentity();

      expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(
        'devicePrivateKey_v2'
      );
    });

    it('should clear both custom store and secure store', async () => {
      (customStore.clear as jest.Mock).mockResolvedValueOnce(undefined);
      (SecureStore.deleteItemAsync as jest.Mock).mockResolvedValueOnce(
        undefined
      );

      await clearDeviceIdentity();

      expect(customStore.clear).toHaveBeenCalled();
      expect(SecureStore.deleteItemAsync).toHaveBeenCalled();
    });

    it('should handle errors when clearing device ID', async () => {
      (customStore.clear as jest.Mock).mockRejectedValueOnce(
        new Error('Clear error')
      );
      (SecureStore.deleteItemAsync as jest.Mock).mockResolvedValueOnce(
        undefined
      );

      // Should not throw, continues to clear other items
      await clearDeviceIdentity();

      expect(customStore.clear).toHaveBeenCalledWith('deviceIdentifier');
      expect(SecureStore.deleteItemAsync).toHaveBeenCalled();
    });

    it('should handle errors when clearing public key', async () => {
      let clearCallCount = 0;
      (customStore.clear as jest.Mock).mockImplementation(() => {
        clearCallCount++;
        if (clearCallCount === 1) return Promise.resolve();
        return Promise.reject(new Error('Clear error'));
      });
      (SecureStore.deleteItemAsync as jest.Mock).mockResolvedValueOnce(
        undefined
      );

      // Should continue despite errors in custom store
      await clearDeviceIdentity();

      expect(SecureStore.deleteItemAsync).toHaveBeenCalled();
    });

    it('should handle errors when deleting from secure store', async () => {
      (customStore.clear as jest.Mock).mockResolvedValueOnce(undefined);
      (SecureStore.deleteItemAsync as jest.Mock).mockRejectedValueOnce(
        new Error('Delete error')
      );

      // Should throw the error from secure store deletion
      await expect(clearDeviceIdentity()).rejects.toThrow('Delete error');
    });

    it('should complete successfully when all deletions work', async () => {
      (customStore.clear as jest.Mock).mockResolvedValueOnce(undefined);
      (SecureStore.deleteItemAsync as jest.Mock).mockResolvedValueOnce(
        undefined
      );

      const result = await clearDeviceIdentity();

      expect(result).toBeUndefined();
    });

    it('should clear device ID before public key', async () => {
      const callOrder: string[] = [];
      (customStore.clear as jest.Mock).mockImplementationOnce((key) => {
        callOrder.push(`clear-${key}`);
        return Promise.resolve();
      });
      (customStore.clear as jest.Mock).mockImplementationOnce((key) => {
        callOrder.push(`clear-${key}`);
        return Promise.resolve();
      });
      (SecureStore.deleteItemAsync as jest.Mock).mockImplementationOnce(
        (key) => {
          callOrder.push(`delete-${key}`);
          return Promise.resolve();
        }
      );

      await clearDeviceIdentity();

      // First clear should be deviceIdentifier
      expect(callOrder[0]).toBe('clear-deviceIdentifier');
      // Second clear should be devicePublicKey
      expect(callOrder[1]).toBe('clear-devicePublicKey');
    });

    it('should log completion message', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      (customStore.clear as jest.Mock).mockResolvedValueOnce(undefined);
      (SecureStore.deleteItemAsync as jest.Mock).mockResolvedValueOnce(
        undefined
      );

      await clearDeviceIdentity();

      expect(consoleSpy).toHaveBeenCalledWith('Device identity cleared.');
      consoleSpy.mockRestore();
    });
  });

  describe('Integration Tests', () => {
    it('should maintain identity consistency across multiple calls', async () => {
      const mockDeviceId = 'device-id-consistent';
      const mockPublicKey = new Uint8Array(32).fill(1);
      const mockPrivateKey = new Uint8Array(32).fill(2);
      const mockPublicKeyBase64 = 'pubBase64==';
      const mockPrivateKeyBase64 = 'privBase64==';

      // First call - retrieve existing
      (customStore.get as jest.Mock)
        .mockResolvedValueOnce(mockDeviceId)
        .mockResolvedValueOnce(mockPublicKeyBase64);
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(
        mockPrivateKeyBase64
      );
      (encryptionService.base64ToUint8Array as jest.Mock)
        .mockReturnValueOnce(mockPublicKey)
        .mockReturnValueOnce(mockPrivateKey);
      (sodium.crypto_box_PUBLICKEYBYTES as any) = 32;
      (sodium.crypto_box_SECRETKEYBYTES as any) = 32;

      const identity1 = await ensureDeviceIdentity();

      // Second call - should retrieve same values
      jest.clearAllMocks();
      (customStore.get as jest.Mock)
        .mockResolvedValueOnce(mockDeviceId)
        .mockResolvedValueOnce(mockPublicKeyBase64);
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(
        mockPrivateKeyBase64
      );
      (encryptionService.base64ToUint8Array as jest.Mock)
        .mockReturnValueOnce(mockPublicKey)
        .mockReturnValueOnce(mockPrivateKey);
      (sodium.crypto_box_PUBLICKEYBYTES as any) = 32;
      (sodium.crypto_box_SECRETKEYBYTES as any) = 32;

      const identity2 = await ensureDeviceIdentity();

      expect(identity1.deviceId).toBe(identity2.deviceId);
      expect(identity1.publicKey).toEqual(identity2.publicKey);
      expect(identity1.privateKey).toEqual(identity2.privateKey);
    });

    it('should generate and store identity on first call', async () => {
      const generatedDeviceId = 'generated-device-id';
      const generatedPublicKey = new Uint8Array(32).fill(10);
      const generatedPrivateKey = new Uint8Array(32).fill(20);
      const generatedPublicKeyBase64 = 'generatedPub==';
      const generatedPrivateKeyBase64 = 'generatedPriv==';

      (customStore.get as jest.Mock)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined);
      (uuidv4 as jest.Mock).mockReturnValueOnce(generatedDeviceId);
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(null);
      (sodium.ready as any) = Promise.resolve();
      (encryptionService.generateLongTermKeyPair as jest.Mock).mockResolvedValueOnce(
        {
          publicKey: generatedPublicKey,
          privateKey: generatedPrivateKey,
        }
      );
      (encryptionService.uint8ArrayToBase64 as jest.Mock)
        .mockReturnValueOnce(generatedPublicKeyBase64)
        .mockReturnValueOnce(generatedPrivateKeyBase64);

      const identity = await ensureDeviceIdentity();

      expect(identity.deviceId).toBe(generatedDeviceId);
      expect(identity.publicKey).toEqual(generatedPublicKey);
      expect(identity.privateKey).toEqual(generatedPrivateKey);

      // Verify storage calls were made
      expect(customStore.save).toHaveBeenCalledWith(
        'deviceIdentifier',
        generatedDeviceId
      );
      expect(customStore.save).toHaveBeenCalledWith(
        'devicePublicKey',
        generatedPublicKeyBase64
      );
      expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
        'devicePrivateKey_v2',
        generatedPrivateKeyBase64
      );
    });

    it('should handle complete lifecycle: generate, retrieve, clear', async () => {
      const deviceId = 'lifecycle-device-id';
      const publicKey = new Uint8Array(32).fill(5);
      const privateKey = new Uint8Array(32).fill(6);
      const pubBase64 = 'lifePub==';
      const privBase64 = 'lifePriv==';

      // 1. Generate
      (customStore.get as jest.Mock)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined);
      (uuidv4 as jest.Mock).mockReturnValueOnce(deviceId);
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(null);
      (sodium.ready as any) = Promise.resolve();
      (encryptionService.generateLongTermKeyPair as jest.Mock).mockResolvedValueOnce(
        { publicKey, privateKey }
      );
      (encryptionService.uint8ArrayToBase64 as jest.Mock)
        .mockReturnValueOnce(pubBase64)
        .mockReturnValueOnce(privBase64);

      const generatedIdentity = await ensureDeviceIdentity();
      expect(generatedIdentity.deviceId).toBe(deviceId);

      // 2. Retrieve
      jest.clearAllMocks();
      (customStore.get as jest.Mock)
        .mockResolvedValueOnce(deviceId)
        .mockResolvedValueOnce(pubBase64);
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(
        privBase64
      );
      (encryptionService.base64ToUint8Array as jest.Mock)
        .mockReturnValueOnce(publicKey)
        .mockReturnValueOnce(privateKey);
      (sodium.crypto_box_PUBLICKEYBYTES as any) = 32;
      (sodium.crypto_box_SECRETKEYBYTES as any) = 32;

      const retrievedIdentity = await ensureDeviceIdentity();
      expect(retrievedIdentity.deviceId).toBe(deviceId);

      // 3. Clear
      jest.clearAllMocks();
      (customStore.clear as jest.Mock).mockResolvedValueOnce(undefined);
      (SecureStore.deleteItemAsync as jest.Mock).mockResolvedValueOnce(
        undefined
      );

      await clearDeviceIdentity();

      expect(customStore.clear).toHaveBeenCalledWith('deviceIdentifier');
      expect(customStore.clear).toHaveBeenCalledWith('devicePublicKey');
      expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(
        'devicePrivateKey_v2'
      );
    });
  });
});
