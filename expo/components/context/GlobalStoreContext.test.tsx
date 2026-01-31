import React from 'react';
import { renderHook, act } from '@testing-library/react-native';
import { GlobalStoreProvider, useGlobalStore } from './GlobalStoreContext';
import { Store } from '@/store/Store';
import http from '@/util/custom-axios';
import * as encryptionService from '@/services/encryptionService';
import { User } from '@/types/types';

// Mock dependencies
jest.mock('@/store/Store');
jest.mock('@/util/custom-axios');
jest.mock('@/services/encryptionService');

describe('GlobalStoreContext', () => {
  let mockStore: jest.Mocked<Store>;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock store instance
    mockStore = {
      close: jest.fn(),
      performSerialTransaction: jest.fn(),
      saveMessages: jest.fn(),
      loadMessages: jest.fn(),
      saveGroups: jest.fn(),
      loadGroups: jest.fn(),
      saveUsers: jest.fn(),
      loadUsers: jest.fn(),
      markGroupRead: jest.fn(),
      clearMessages: jest.fn(),
      clearGroups: jest.fn(),
      clearUsers: jest.fn(),
      resetDatabase: jest.fn(),
    } as any;

    (Store as jest.MockedClass<typeof Store>).mockImplementation(() => mockStore);

    // Mock base64ToUint8Array
    (encryptionService.base64ToUint8Array as jest.Mock).mockImplementation((str: string) => {
      return new Uint8Array(Buffer.from(str, 'base64'));
    });
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <GlobalStoreProvider>{children}</GlobalStoreProvider>
  );

  describe('Provider Initialization', () => {
    it('should create store on mount', () => {
      renderHook(() => useGlobalStore(), { wrapper });

      expect(Store).toHaveBeenCalledTimes(1);
    });

    it('should close store on unmount', () => {
      const { unmount } = renderHook(() => useGlobalStore(), { wrapper });

      unmount();

      expect(mockStore.close).toHaveBeenCalled();
    });

    it('should provide context to children', () => {
      const { result } = renderHook(() => useGlobalStore(), { wrapper });

      expect(result.current).toBeDefined();
    });
  });

  describe('Initial State', () => {
    it('should have undefined user initially', () => {
      const { result } = renderHook(() => useGlobalStore(), { wrapper });

      expect(result.current.user).toBeUndefined();
    });

    it('should have undefined deviceId initially', () => {
      const { result } = renderHook(() => useGlobalStore(), { wrapper });

      expect(result.current.deviceId).toBeUndefined();
    });

    it('should have groupsRefreshKey of 0 initially', () => {
      const { result } = renderHook(() => useGlobalStore(), { wrapper });

      expect(result.current.groupsRefreshKey).toBe(0);
    });

    it('should have usersRefreshKey of 0 initially', () => {
      const { result } = renderHook(() => useGlobalStore(), { wrapper });

      expect(result.current.usersRefreshKey).toBe(0);
    });

    it('should have empty relevantDeviceKeys initially', () => {
      const { result } = renderHook(() => useGlobalStore(), { wrapper });

      expect(result.current.relevantDeviceKeys).toEqual({});
    });

    it('should have deviceKeysLoading false initially', () => {
      const { result } = renderHook(() => useGlobalStore(), { wrapper });

      expect(result.current.deviceKeysLoading).toBe(false);
    });

    it('should have deviceKeysError null initially', () => {
      const { result } = renderHook(() => useGlobalStore(), { wrapper });

      expect(result.current.deviceKeysError).toBeNull();
    });
  });

  describe('setUser', () => {
    it('should set user', () => {
      const { result } = renderHook(() => useGlobalStore(), { wrapper });

      const mockUser: User = {
        id: 'user-123',
        username: 'testuser',
        email: 'test@example.com',
      };

      act(() => {
        result.current.setUser(mockUser);
      });

      expect(result.current.user).toEqual(mockUser);
    });

    it('should set user to undefined', () => {
      const { result } = renderHook(() => useGlobalStore(), { wrapper });

      const mockUser: User = {
        id: 'user-123',
        username: 'testuser',
        email: 'test@example.com',
      };

      act(() => {
        result.current.setUser(mockUser);
      });

      expect(result.current.user).toEqual(mockUser);

      act(() => {
        result.current.setUser(undefined);
      });

      expect(result.current.user).toBeUndefined();
    });
  });

  describe('setDeviceId', () => {
    it('should set device ID', () => {
      const { result } = renderHook(() => useGlobalStore(), { wrapper });

      act(() => {
        result.current.setDeviceId('device-456');
      });

      expect(result.current.deviceId).toBe('device-456');
    });

    it('should set device ID to undefined', () => {
      const { result } = renderHook(() => useGlobalStore(), { wrapper });

      act(() => {
        result.current.setDeviceId('device-456');
      });

      expect(result.current.deviceId).toBe('device-456');

      act(() => {
        result.current.setDeviceId(undefined);
      });

      expect(result.current.deviceId).toBeUndefined();
    });
  });

  describe('refreshGroups', () => {
    it('should increment groupsRefreshKey', () => {
      const { result } = renderHook(() => useGlobalStore(), { wrapper });

      const initialKey = result.current.groupsRefreshKey;

      act(() => {
        result.current.refreshGroups();
      });

      expect(result.current.groupsRefreshKey).toBe(initialKey + 1);
    });

    it('should increment groupsRefreshKey multiple times', () => {
      const { result } = renderHook(() => useGlobalStore(), { wrapper });

      act(() => {
        result.current.refreshGroups();
        result.current.refreshGroups();
        result.current.refreshGroups();
      });

      expect(result.current.groupsRefreshKey).toBe(3);
    });
  });

  describe('refreshUsers', () => {
    it('should increment usersRefreshKey', () => {
      const { result } = renderHook(() => useGlobalStore(), { wrapper });

      const initialKey = result.current.usersRefreshKey;

      act(() => {
        result.current.refreshUsers();
      });

      expect(result.current.usersRefreshKey).toBe(initialKey + 1);
    });

    it('should increment usersRefreshKey multiple times', () => {
      const { result } = renderHook(() => useGlobalStore(), { wrapper });

      act(() => {
        result.current.refreshUsers();
        result.current.refreshUsers();
      });

      expect(result.current.usersRefreshKey).toBe(2);
    });
  });

  describe('loadRelevantDeviceKeys', () => {
    const mockUser: User = {
      id: 'user-123',
      username: 'testuser',
      email: 'test@example.com',
    };

    const mockServerResponse = [
      {
        user_id: 'user-123',
        device_keys: [
          {
            device_identifier: 'device-1',
            public_key: Buffer.from(new Uint8Array(32).fill(1)).toString('base64'),
          },
          {
            device_identifier: 'device-2',
            public_key: Buffer.from(new Uint8Array(32).fill(2)).toString('base64'),
          },
        ],
      },
      {
        user_id: 'user-456',
        device_keys: [
          {
            device_identifier: 'device-3',
            public_key: Buffer.from(new Uint8Array(32).fill(3)).toString('base64'),
          },
        ],
      },
    ];

    it('should skip loading if user is not authenticated', async () => {
      const { result } = renderHook(() => useGlobalStore(), { wrapper });

      await act(async () => {
        await result.current.loadRelevantDeviceKeys();
      });

      expect(http.get).not.toHaveBeenCalled();
      expect(result.current.deviceKeysLoading).toBe(false);
    });

    it('should set loading state before fetching', async () => {
      const { result } = renderHook(() => useGlobalStore(), { wrapper });

      (http.get as jest.Mock).mockImplementation(() => new Promise(() => {})); // Never resolves

      act(() => {
        result.current.setUser(mockUser);
      });

      act(() => {
        result.current.loadRelevantDeviceKeys();
      });

      // Loading should be true immediately
      expect(result.current.deviceKeysLoading).toBe(true);
      expect(result.current.deviceKeysError).toBeNull();
    });

    it('should fetch device keys from API', async () => {
      const { result } = renderHook(() => useGlobalStore(), { wrapper });

      (http.get as jest.Mock).mockResolvedValueOnce({ data: mockServerResponse });

      act(() => {
        result.current.setUser(mockUser);
      });

      await act(async () => {
        await result.current.loadRelevantDeviceKeys();
      });

      expect(http.get).toHaveBeenCalledWith(
        expect.stringContaining('/api/users/device-keys')
      );
    });

    it('should decode Base64 public keys', async () => {
      const { result } = renderHook(() => useGlobalStore(), { wrapper });

      (http.get as jest.Mock).mockResolvedValueOnce({ data: mockServerResponse });

      act(() => {
        result.current.setUser(mockUser);
      });

      await act(async () => {
        await result.current.loadRelevantDeviceKeys();
      });

      expect(encryptionService.base64ToUint8Array).toHaveBeenCalledTimes(3);
      expect(encryptionService.base64ToUint8Array).toHaveBeenCalledWith(
        mockServerResponse[0].device_keys[0].public_key
      );
    });

    it('should store device keys by user ID', async () => {
      const { result } = renderHook(() => useGlobalStore(), { wrapper });

      (http.get as jest.Mock).mockResolvedValueOnce({ data: mockServerResponse });

      act(() => {
        result.current.setUser(mockUser);
      });

      await act(async () => {
        await result.current.loadRelevantDeviceKeys();
      });

      expect(result.current.relevantDeviceKeys).toHaveProperty('user-123');
      expect(result.current.relevantDeviceKeys).toHaveProperty('user-456');
      expect(result.current.relevantDeviceKeys['user-123']).toHaveLength(2);
      expect(result.current.relevantDeviceKeys['user-456']).toHaveLength(1);
    });

    it('should store correct device IDs', async () => {
      const { result } = renderHook(() => useGlobalStore(), { wrapper });

      (http.get as jest.Mock).mockResolvedValueOnce({ data: mockServerResponse });

      act(() => {
        result.current.setUser(mockUser);
      });

      await act(async () => {
        await result.current.loadRelevantDeviceKeys();
      });

      expect(result.current.relevantDeviceKeys['user-123'][0].deviceId).toBe('device-1');
      expect(result.current.relevantDeviceKeys['user-123'][1].deviceId).toBe('device-2');
      expect(result.current.relevantDeviceKeys['user-456'][0].deviceId).toBe('device-3');
    });

    it('should store public keys as Uint8Array', async () => {
      const { result } = renderHook(() => useGlobalStore(), { wrapper });

      (http.get as jest.Mock).mockResolvedValueOnce({ data: mockServerResponse });

      act(() => {
        result.current.setUser(mockUser);
      });

      await act(async () => {
        await result.current.loadRelevantDeviceKeys();
      });

      expect(result.current.relevantDeviceKeys['user-123'][0].publicKey).toBeInstanceOf(
        Uint8Array
      );
      expect(result.current.relevantDeviceKeys['user-456'][0].publicKey).toBeInstanceOf(
        Uint8Array
      );
    });

    it('should set loading to false on success', async () => {
      const { result } = renderHook(() => useGlobalStore(), { wrapper });

      (http.get as jest.Mock).mockResolvedValueOnce({ data: mockServerResponse });

      act(() => {
        result.current.setUser(mockUser);
      });

      await act(async () => {
        await result.current.loadRelevantDeviceKeys();
      });

      expect(result.current.deviceKeysLoading).toBe(false);
      expect(result.current.deviceKeysError).toBeNull();
    });

    it('should handle fetch errors', async () => {
      const { result } = renderHook(() => useGlobalStore(), { wrapper });

      (http.get as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

      act(() => {
        result.current.setUser(mockUser);
      });

      await act(async () => {
        await result.current.loadRelevantDeviceKeys();
      });

      expect(result.current.deviceKeysLoading).toBe(false);
      expect(result.current.deviceKeysError).toBe('Failed to load device keys.');
    });

    it('should handle canceled requests gracefully', async () => {
      const { result } = renderHook(() => useGlobalStore(), { wrapper });

      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { CanceledError } = require('axios');
      (http.get as jest.Mock).mockRejectedValueOnce(new CanceledError());

      act(() => {
        result.current.setUser(mockUser);
      });

      await act(async () => {
        await result.current.loadRelevantDeviceKeys();
      });

      // CanceledError resets loading state without setting error
      expect(result.current.deviceKeysLoading).toBe(false);
      expect(result.current.deviceKeysError).toBeNull();
    });
  });

  describe('getDeviceKeysForUser', () => {
    const mockUser: User = {
      id: 'user-123',
      username: 'testuser',
      email: 'test@example.com',
    };

    it('should return device keys for user after loading', async () => {
      const { result } = renderHook(() => useGlobalStore(), { wrapper });

      const mockServerResponse = [
        {
          user_id: 'user-123',
          device_keys: [
            {
              device_identifier: 'device-1',
              public_key: Buffer.from(new Uint8Array(32).fill(1)).toString('base64'),
            },
            {
              device_identifier: 'device-2',
              public_key: Buffer.from(new Uint8Array(32).fill(2)).toString('base64'),
            },
          ],
        },
      ];

      (http.get as jest.Mock).mockResolvedValueOnce({ data: mockServerResponse });

      act(() => {
        result.current.setUser(mockUser);
      });

      // Load device keys from API
      await act(async () => {
        await result.current.loadRelevantDeviceKeys();
      });

      // Now retrieve them
      const keys = await result.current.getDeviceKeysForUser('user-123');

      expect(keys).toBeDefined();
      expect(keys).toHaveLength(2);
      expect(keys![0].deviceId).toBe('device-1');
      expect(keys![1].deviceId).toBe('device-2');
    });

    it('should return undefined for unknown user', async () => {
      const { result } = renderHook(() => useGlobalStore(), { wrapper });

      const keys = await result.current.getDeviceKeysForUser('unknown-user');

      expect(keys).toBeUndefined();
    });

    it('should return empty array if user has no device keys', async () => {
      const { result } = renderHook(() => useGlobalStore(), { wrapper });

      const mockServerResponse = [
        {
          user_id: 'user-123',
          device_keys: [],
        },
      ];

      (http.get as jest.Mock).mockResolvedValueOnce({ data: mockServerResponse });

      act(() => {
        result.current.setUser(mockUser);
      });

      // Load device keys from API
      await act(async () => {
        await result.current.loadRelevantDeviceKeys();
      });

      const keys = await result.current.getDeviceKeysForUser('user-123');

      expect(keys).toEqual([]);
    });
  });

  describe('useGlobalStore hook', () => {
    it('should throw error if used outside provider', () => {
      // Suppress console.error for this test
      const spy = jest.spyOn(console, 'error').mockImplementation(() => {});

      expect(() => {
        renderHook(() => useGlobalStore());
      }).toThrow('useGlobalStore must be used within a GlobalStoreProvider');

      spy.mockRestore();
    });
  });

  describe('Store instance', () => {
    it('should provide store instance', () => {
      const { result } = renderHook(() => useGlobalStore(), { wrapper });

      expect(result.current.store).toBe(mockStore);
    });

    it('should create single store instance', () => {
      const { result, rerender } = renderHook(() => useGlobalStore(), { wrapper });

      const firstStore = result.current.store;

      rerender();

      const secondStore = result.current.store;

      expect(firstStore).toBe(secondStore);
      expect(Store).toHaveBeenCalledTimes(1);
    });
  });
});
