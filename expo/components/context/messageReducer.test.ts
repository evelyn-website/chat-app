import { messageReducer, initialState } from './MessageStoreContext';
import { DbMessage, MessageType } from '@/types/types';

describe('messageReducer', () => {
  // Helper to create test messages
  const createMockMessage = (overrides?: Partial<DbMessage>): DbMessage => ({
    id: 'msg-' + Math.random().toString(36).substring(7),
    sender_id: 'user-123',
    group_id: 'group-456',
    timestamp: new Date().toISOString(),
    client_seq: null,
    client_timestamp: null,
    ciphertext: new Uint8Array([1, 2, 3]),
    message_type: MessageType.TEXT,
    msg_nonce: new Uint8Array([4, 5, 6]),
    sender_ephemeral_public_key: new Uint8Array([7, 8, 9]),
    sym_key_encryption_nonce: new Uint8Array([10, 11, 12]),
    sealed_symmetric_key: new Uint8Array([13, 14, 15]),
    ...overrides,
  });

  describe('ADD_MESSAGE', () => {
    it('should add a single message to a group', () => {
      const message = createMockMessage({ id: 'msg-1', group_id: 'group-1' });

      const newState = messageReducer(initialState, {
        type: 'ADD_MESSAGE',
        payload: message,
      });

      expect(newState.messages['group-1']).toHaveLength(1);
      expect(newState.messages['group-1'][0]).toEqual(message);
    });

    it('should add messages to multiple groups', () => {
      const msg1 = createMockMessage({ id: 'msg-1', group_id: 'group-1' });
      const msg2 = createMockMessage({ id: 'msg-2', group_id: 'group-2' });

      let state = messageReducer(initialState, {
        type: 'ADD_MESSAGE',
        payload: msg1,
      });

      state = messageReducer(state, {
        type: 'ADD_MESSAGE',
        payload: msg2,
      });

      expect(state.messages['group-1']).toHaveLength(1);
      expect(state.messages['group-2']).toHaveLength(1);
    });

    it('should deduplicate messages by ID', () => {
      const message1 = createMockMessage({ id: 'msg-1', group_id: 'group-1' });
      const message2 = createMockMessage({ id: 'msg-1', group_id: 'group-1' }); // Same ID

      let state = messageReducer(initialState, {
        type: 'ADD_MESSAGE',
        payload: message1,
      });

      state = messageReducer(state, {
        type: 'ADD_MESSAGE',
        payload: message2,
      });

      expect(state.messages['group-1']).toHaveLength(1);
    });

    it('should maintain sorted order by timestamp', () => {
      const msg1 = createMockMessage({
        id: 'msg-1',
        group_id: 'group-1',
        timestamp: '2024-01-01T12:00:00Z',
      });
      const msg2 = createMockMessage({
        id: 'msg-2',
        group_id: 'group-1',
        timestamp: '2024-01-01T11:00:00Z',
      });
      const msg3 = createMockMessage({
        id: 'msg-3',
        group_id: 'group-1',
        timestamp: '2024-01-01T13:00:00Z',
      });

      let state = messageReducer(initialState, { type: 'ADD_MESSAGE', payload: msg1 });
      state = messageReducer(state, { type: 'ADD_MESSAGE', payload: msg2 });
      state = messageReducer(state, { type: 'ADD_MESSAGE', payload: msg3 });

      const messages = state.messages['group-1'];
      expect(messages[0].id).toBe('msg-2'); // 11:00
      expect(messages[1].id).toBe('msg-1'); // 12:00
      expect(messages[2].id).toBe('msg-3'); // 13:00
    });

    it('should preserve client_seq and client_timestamp', () => {
      const message = createMockMessage({
        id: 'msg-1',
        group_id: 'group-1',
        client_seq: 5,
        client_timestamp: '2024-01-01T12:00:00Z',
      });

      const state = messageReducer(initialState, {
        type: 'ADD_MESSAGE',
        payload: message,
      });

      expect(state.messages['group-1'][0].client_seq).toBe(5);
      expect(state.messages['group-1'][0].client_timestamp).toBe('2024-01-01T12:00:00Z');
    });
  });

  describe('SET_HISTORICAL_MESSAGES', () => {
    it('should set messages for single group', () => {
      const msg1 = createMockMessage({ id: 'msg-1', group_id: 'group-1' });
      const msg2 = createMockMessage({ id: 'msg-2', group_id: 'group-1' });

      const state = messageReducer(initialState, {
        type: 'SET_HISTORICAL_MESSAGES',
        payload: [msg1, msg2],
      });

      expect(state.messages['group-1']).toHaveLength(2);
    });

    it('should set messages for multiple groups', () => {
      const msg1 = createMockMessage({ id: 'msg-1', group_id: 'group-1' });
      const msg2 = createMockMessage({ id: 'msg-2', group_id: 'group-2' });

      const state = messageReducer(initialState, {
        type: 'SET_HISTORICAL_MESSAGES',
        payload: [msg1, msg2],
      });

      expect(state.messages['group-1']).toHaveLength(1);
      expect(state.messages['group-2']).toHaveLength(1);
    });

    it('should sort historical messages by timestamp', () => {
      const msg1 = createMockMessage({
        id: 'msg-1',
        group_id: 'group-1',
        timestamp: '2024-01-01T12:00:00Z',
      });
      const msg2 = createMockMessage({
        id: 'msg-2',
        group_id: 'group-1',
        timestamp: '2024-01-01T11:00:00Z',
      });

      const state = messageReducer(initialState, {
        type: 'SET_HISTORICAL_MESSAGES',
        payload: [msg1, msg2],
      });

      const messages = state.messages['group-1'];
      expect(messages[0].id).toBe('msg-2');
      expect(messages[1].id).toBe('msg-1');
    });

    it('should replace existing messages', () => {
      const existing = createMockMessage({ id: 'msg-old', group_id: 'group-1' });
      let state = messageReducer(initialState, {
        type: 'ADD_MESSAGE',
        payload: existing,
      });

      const newMsg = createMockMessage({ id: 'msg-new', group_id: 'group-1' });
      state = messageReducer(state, {
        type: 'SET_HISTORICAL_MESSAGES',
        payload: [newMsg],
      });

      expect(state.messages['group-1']).toHaveLength(1);
      expect(state.messages['group-1'][0].id).toBe('msg-new');
    });
  });

  describe('MERGE_MESSAGES', () => {
    it('should merge incoming messages with existing state by ID', () => {
      const existing = createMockMessage({
        id: 'msg-1',
        group_id: 'group-1',
        timestamp: '2024-01-01T12:00:00Z',
      });
      let state = messageReducer(initialState, {
        type: 'ADD_MESSAGE',
        payload: existing,
      });

      const incoming = createMockMessage({
        id: 'msg-2',
        group_id: 'group-1',
        timestamp: '2024-01-01T13:00:00Z',
      });

      state = messageReducer(state, {
        type: 'MERGE_MESSAGES',
        payload: [incoming],
      });

      expect(state.messages['group-1']).toHaveLength(2);
      expect(state.messages['group-1'][0].id).toBe('msg-1');
      expect(state.messages['group-1'][1].id).toBe('msg-2');
    });

    it('should preserve WebSocket-delivered messages not in server response', () => {
      // Simulate: msg-1 from server, msg-2 from WebSocket
      const msg1 = createMockMessage({
        id: 'msg-1',
        group_id: 'group-1',
        timestamp: '2024-01-01T12:00:00Z',
      });
      const wsMsg = createMockMessage({
        id: 'msg-ws',
        group_id: 'group-1',
        timestamp: '2024-01-01T12:01:00Z',
      });

      let state = messageReducer(initialState, {
        type: 'SET_HISTORICAL_MESSAGES',
        payload: [msg1],
      });
      state = messageReducer(state, {
        type: 'ADD_MESSAGE',
        payload: wsMsg,
      });

      expect(state.messages['group-1']).toHaveLength(2);

      // Server response doesn't include wsMsg yet (race condition)
      state = messageReducer(state, {
        type: 'MERGE_MESSAGES',
        payload: [msg1],
      });

      // wsMsg should still be there
      expect(state.messages['group-1']).toHaveLength(2);
      expect(state.messages['group-1'].find((m) => m.id === 'msg-ws')).toBeDefined();
    });

    it('should overwrite existing messages with server data on ID conflict', () => {
      const original = createMockMessage({
        id: 'msg-1',
        group_id: 'group-1',
        timestamp: '2024-01-01T12:00:00Z',
      });
      let state = messageReducer(initialState, {
        type: 'ADD_MESSAGE',
        payload: original,
      });

      const updated = createMockMessage({
        id: 'msg-1',
        group_id: 'group-1',
        timestamp: '2024-01-01T12:00:01Z',
      });

      state = messageReducer(state, {
        type: 'MERGE_MESSAGES',
        payload: [updated],
      });

      expect(state.messages['group-1']).toHaveLength(1);
      expect(state.messages['group-1'][0].timestamp).toBe('2024-01-01T12:00:01Z');
    });

    it('should sort merged messages by timestamp', () => {
      const msg1 = createMockMessage({
        id: 'msg-1',
        group_id: 'group-1',
        timestamp: '2024-01-01T14:00:00Z',
      });
      let state = messageReducer(initialState, {
        type: 'ADD_MESSAGE',
        payload: msg1,
      });

      const msg2 = createMockMessage({
        id: 'msg-2',
        group_id: 'group-1',
        timestamp: '2024-01-01T11:00:00Z',
      });
      const msg3 = createMockMessage({
        id: 'msg-3',
        group_id: 'group-1',
        timestamp: '2024-01-01T16:00:00Z',
      });

      state = messageReducer(state, {
        type: 'MERGE_MESSAGES',
        payload: [msg2, msg3],
      });

      const messages = state.messages['group-1'];
      expect(messages[0].id).toBe('msg-2'); // 11:00
      expect(messages[1].id).toBe('msg-1'); // 14:00
      expect(messages[2].id).toBe('msg-3'); // 16:00
    });

    it('should remove groups no longer in incoming payload', () => {
      const msg1 = createMockMessage({ id: 'msg-1', group_id: 'group-1' });
      const msg2 = createMockMessage({ id: 'msg-2', group_id: 'group-2' });

      let state = messageReducer(initialState, {
        type: 'SET_HISTORICAL_MESSAGES',
        payload: [msg1, msg2],
      });

      expect(Object.keys(state.messages)).toHaveLength(2);

      // Merge with only group-1 messages — group-2 was deleted server-side
      const msg1Updated = createMockMessage({ id: 'msg-1', group_id: 'group-1' });
      state = messageReducer(state, {
        type: 'MERGE_MESSAGES',
        payload: [msg1Updated],
      });

      expect(state.messages['group-1']).toBeDefined();
      expect(state.messages['group-2']).toBeUndefined();
    });

    it('should handle merging into empty state', () => {
      const msg = createMockMessage({ id: 'msg-1', group_id: 'group-1' });

      const state = messageReducer(initialState, {
        type: 'MERGE_MESSAGES',
        payload: [msg],
      });

      expect(state.messages['group-1']).toHaveLength(1);
      expect(state.messages['group-1'][0].id).toBe('msg-1');
    });

    it('should handle merging with empty payload', () => {
      const msg = createMockMessage({ id: 'msg-1', group_id: 'group-1' });
      let state = messageReducer(initialState, {
        type: 'ADD_MESSAGE',
        payload: msg,
      });

      state = messageReducer(state, {
        type: 'MERGE_MESSAGES',
        payload: [],
      });

      // Empty payload means no groups in incoming — all existing groups removed
      expect(Object.keys(state.messages)).toHaveLength(0);
    });
  });

  describe('REMOVE_GROUP_MESSAGES', () => {
    it('should remove a specific group\'s messages from state', () => {
      const msg1 = createMockMessage({ id: 'msg-1', group_id: 'group-1' });
      const msg2 = createMockMessage({ id: 'msg-2', group_id: 'group-2' });

      let state = messageReducer(initialState, {
        type: 'SET_HISTORICAL_MESSAGES',
        payload: [msg1, msg2],
      });

      state = messageReducer(state, {
        type: 'REMOVE_GROUP_MESSAGES',
        payload: 'group-1',
      });

      expect(state.messages['group-1']).toBeUndefined();
    });

    it('should not affect other groups\' messages', () => {
      const msg1 = createMockMessage({ id: 'msg-1', group_id: 'group-1' });
      const msg2 = createMockMessage({ id: 'msg-2', group_id: 'group-2' });

      let state = messageReducer(initialState, {
        type: 'SET_HISTORICAL_MESSAGES',
        payload: [msg1, msg2],
      });

      state = messageReducer(state, {
        type: 'REMOVE_GROUP_MESSAGES',
        payload: 'group-1',
      });

      expect(state.messages['group-2']).toHaveLength(1);
      expect(state.messages['group-2'][0].id).toBe('msg-2');
    });

    it('should handle removing a non-existent group gracefully', () => {
      const msg = createMockMessage({ id: 'msg-1', group_id: 'group-1' });

      let state = messageReducer(initialState, {
        type: 'ADD_MESSAGE',
        payload: msg,
      });

      state = messageReducer(state, {
        type: 'REMOVE_GROUP_MESSAGES',
        payload: 'non-existent',
      });

      expect(state.messages['group-1']).toHaveLength(1);
    });
  });

  describe('SET_LOADING', () => {
    it('should set loading to true', () => {
      const state = messageReducer(initialState, {
        type: 'SET_LOADING',
        payload: true,
      });

      expect(state.loading).toBe(true);
    });

    it('should set loading to false', () => {
      const loadingState = { ...initialState, loading: true };
      const state = messageReducer(loadingState, {
        type: 'SET_LOADING',
        payload: false,
      });

      expect(state.loading).toBe(false);
    });
  });

  describe('SET_ERROR', () => {
    it('should set error message', () => {
      const state = messageReducer(initialState, {
        type: 'SET_ERROR',
        payload: 'Failed to load messages',
      });

      expect(state.error).toBe('Failed to load messages');
    });

    it('should clear error', () => {
      const errorState = { ...initialState, error: 'Some error' };
      const state = messageReducer(errorState, {
        type: 'SET_ERROR',
        payload: null,
      });

      expect(state.error).toBeNull();
    });
  });
});
