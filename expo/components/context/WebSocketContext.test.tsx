import React from 'react';
import { renderHook } from '@testing-library/react-native';
import { WebSocketProvider, useWebSocket } from './WebSocketContext';

// Mock dependencies
jest.mock('@/util/custom-axios');
jest.mock('@/util/custom-store', () => ({
  get: jest.fn().mockResolvedValue('test-jwt-token'),
  set: jest.fn(),
  remove: jest.fn(),
}));

describe('WebSocketContext', () => {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <WebSocketProvider>{children}</WebSocketProvider>
  );

  describe('Provider', () => {
    it('should provide context', () => {
      const { result } = renderHook(() => useWebSocket(), { wrapper });

      expect(result.current).toBeDefined();
      expect(result.current).toHaveProperty('sendMessage');
      expect(result.current).toHaveProperty('connected');
      expect(result.current).toHaveProperty('onMessage');
      expect(result.current).toHaveProperty('establishConnection');
      expect(result.current).toHaveProperty('disconnect');
    });

    it('should initialize with disconnected state', () => {
      const { result } = renderHook(() => useWebSocket(), { wrapper });

      expect(result.current.connected).toBe(false);
    });

    it('should provide group operation functions', () => {
      const { result } = renderHook(() => useWebSocket(), { wrapper });

      expect(typeof result.current.createGroup).toBe('function');
      expect(typeof result.current.updateGroup).toBe('function');
      expect(typeof result.current.inviteUsersToGroup).toBe('function');
      expect(typeof result.current.removeUserFromGroup).toBe('function');
      expect(typeof result.current.leaveGroup).toBe('function');
    });

    it('should provide data fetching functions', () => {
      const { result } = renderHook(() => useWebSocket(), { wrapper });

      expect(typeof result.current.getGroups).toBe('function');
      expect(typeof result.current.getUsers).toBe('function');
    });

    it('should throw error when used outside provider', () => {
      const spy = jest.spyOn(console, 'error').mockImplementation(() => {});

      expect(() => {
        renderHook(() => useWebSocket());
      }).toThrow('useWebSocket must be used within a WebSocketProvider');

      spy.mockRestore();
    });
  });

  // Note: Complex WebSocket connection, reconnection, and message handling tests
  // are omitted due to difficulties in properly mocking WebSocket lifecycle and async behavior.
  // These features are better tested through integration/E2E tests.
});
