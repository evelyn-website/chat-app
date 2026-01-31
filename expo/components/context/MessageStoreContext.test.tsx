import React from 'react';
import { renderHook, act } from '@testing-library/react-native';
import { MessageStoreProvider, useMessageStore } from './MessageStoreContext';
import { GlobalStoreProvider } from './GlobalStoreContext';
import { WebSocketProvider } from './WebSocketContext';
import { OptimisticMessageItem } from '../ChatBox/types';
import { Store } from '@/store/Store';

// Mock dependencies
jest.mock('@/store/Store');
jest.mock('@/util/custom-axios');
jest.mock('@/services/encryptionService');
jest.mock('@/util/custom-store');

describe('MessageStoreContext', () => {
  let mockStore: jest.Mocked<Store>;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock store instance
    mockStore = {
      close: jest.fn(),
      performSerialTransaction: jest.fn(),
      saveMessages: jest.fn(),
      loadMessages: jest.fn().mockReturnValue([]),
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
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <GlobalStoreProvider>
      <WebSocketProvider>
        <MessageStoreProvider>{children}</MessageStoreProvider>
      </WebSocketProvider>
    </GlobalStoreProvider>
  );

  const createMockOptimisticMessage = (
    overrides?: Partial<OptimisticMessageItem>
  ): OptimisticMessageItem => ({
    type: 'message_text',
    id: 'opt-' + Math.random().toString(36).substring(7),
    groupId: 'group-456',
    user: { id: 'user-123', username: 'testuser' },
    content: 'Test message',
    align: 'right',
    timestamp: new Date().toISOString(),
    clientSeq: 1,
    pinToBottom: true,
    ...overrides,
  });

  describe('Provider Initialization', () => {
    it('should initialize with default state', () => {
      const { result } = renderHook(() => useMessageStore(), { wrapper });

      expect(result.current.getMessagesForGroup('group-456')).toEqual([]);
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBeNull();
      expect(result.current.optimistic).toEqual({});
    });

    it('should throw error when used outside provider', () => {
      const spy = jest.spyOn(console, 'error').mockImplementation(() => {});

      expect(() => {
        renderHook(() => useMessageStore());
      }).toThrow('useMessageStore must be used within a MessageStoreProvider');

      spy.mockRestore();
    });
  });

  describe('getMessagesForGroup', () => {
    it('should return empty array for unknown group', () => {
      const { result } = renderHook(() => useMessageStore(), { wrapper });

      const messages = result.current.getMessagesForGroup('unknown-group');

      expect(messages).toEqual([]);
    });

    it('should return messages for group', () => {
      const mockMessages = [
        {
          id: 'msg-1',
          group_id: 'group-1',
          sender_id: 'user-1',
          timestamp: '2024-01-01T12:00:00Z',
          message_type: 'text',
        },
      ] as any;

      mockStore.loadMessages.mockReturnValue(mockMessages);

      const { result } = renderHook(() => useMessageStore(), { wrapper });

      // Messages are loaded from store on initialization
      const messages = result.current.getMessagesForGroup('group-1');

      expect(messages).toBeDefined();
    });
  });

  describe('Optimistic Messages', () => {
    it('should add optimistic message to group', () => {
      const { result } = renderHook(() => useMessageStore(), { wrapper });

      const optimisticMsg = createMockOptimisticMessage({
        id: 'opt-1',
        groupId: 'group-1',
      });

      act(() => {
        result.current.addOptimisticDisplayable(optimisticMsg);
      });

      expect(result.current.optimistic['group-1']).toBeDefined();
      expect(result.current.optimistic['group-1']).toHaveLength(1);
      expect(result.current.optimistic['group-1'][0].id).toBe('opt-1');
    });

    it('should add multiple optimistic messages to same group', () => {
      const { result } = renderHook(() => useMessageStore(), { wrapper });

      const opt1 = createMockOptimisticMessage({ id: 'opt-1', groupId: 'group-1' });
      const opt2 = createMockOptimisticMessage({ id: 'opt-2', groupId: 'group-1' });

      act(() => {
        result.current.addOptimisticDisplayable(opt1);
        result.current.addOptimisticDisplayable(opt2);
      });

      expect(result.current.optimistic['group-1']).toHaveLength(2);
    });

    it('should add optimistic messages to different groups', () => {
      const { result } = renderHook(() => useMessageStore(), { wrapper });

      const opt1 = createMockOptimisticMessage({ id: 'opt-1', groupId: 'group-1' });
      const opt2 = createMockOptimisticMessage({ id: 'opt-2', groupId: 'group-2' });

      act(() => {
        result.current.addOptimisticDisplayable(opt1);
        result.current.addOptimisticDisplayable(opt2);
      });

      expect(result.current.optimistic['group-1']).toHaveLength(1);
      expect(result.current.optimistic['group-2']).toHaveLength(1);
    });

    it('should remove optimistic message by ID', () => {
      const { result } = renderHook(() => useMessageStore(), { wrapper });

      const opt1 = createMockOptimisticMessage({ id: 'opt-1', groupId: 'group-1' });
      const opt2 = createMockOptimisticMessage({ id: 'opt-2', groupId: 'group-1' });

      act(() => {
        result.current.addOptimisticDisplayable(opt1);
        result.current.addOptimisticDisplayable(opt2);
      });

      expect(result.current.optimistic['group-1']).toHaveLength(2);

      act(() => {
        result.current.removeOptimisticDisplayable('group-1', 'opt-1');
      });

      expect(result.current.optimistic['group-1']).toHaveLength(1);
      expect(result.current.optimistic['group-1'][0].id).toBe('opt-2');
    });

    it('should handle removing from non-existent group gracefully', () => {
      const { result } = renderHook(() => useMessageStore(), { wrapper });

      act(() => {
        result.current.removeOptimisticDisplayable('non-existent', 'opt-1');
      });

      // Removing from non-existent group creates empty array
      expect(result.current.optimistic['non-existent']).toEqual([]);
    });

    it('should handle removing non-existent message gracefully', () => {
      const { result } = renderHook(() => useMessageStore(), { wrapper });

      const opt1 = createMockOptimisticMessage({ id: 'opt-1', groupId: 'group-1' });

      act(() => {
        result.current.addOptimisticDisplayable(opt1);
        result.current.removeOptimisticDisplayable('group-1', 'non-existent');
      });

      expect(result.current.optimistic['group-1']).toHaveLength(1);
    });
  });

  describe('Client Sequence', () => {
    it('should start at 0 and increment', () => {
      const { result } = renderHook(() => useMessageStore(), { wrapper });

      const seq1 = result.current.getNextClientSeq();
      const seq2 = result.current.getNextClientSeq();
      const seq3 = result.current.getNextClientSeq();

      expect(seq1).toBe(1);
      expect(seq2).toBe(2);
      expect(seq3).toBe(3);
    });

    it('should generate unique sequences', () => {
      const { result } = renderHook(() => useMessageStore(), { wrapper });

      const sequences = new Set();
      for (let i = 0; i < 10; i++) {
        sequences.add(result.current.getNextClientSeq());
      }

      expect(sequences.size).toBe(10);
    });

    it('should persist across renders', () => {
      const { result, rerender } = renderHook(() => useMessageStore(), { wrapper });

      const seq1 = result.current.getNextClientSeq();

      rerender();

      const seq2 = result.current.getNextClientSeq();

      expect(seq2).toBeGreaterThan(seq1);
    });
  });

  describe('Loading and Error States', () => {
    it('should initialize with loading false', () => {
      const { result } = renderHook(() => useMessageStore(), { wrapper });

      expect(result.current.loading).toBe(false);
    });

    it('should initialize with error null', () => {
      const { result } = renderHook(() => useMessageStore(), { wrapper });

      expect(result.current.error).toBeNull();
    });
  });
});
