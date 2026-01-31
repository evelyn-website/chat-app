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
