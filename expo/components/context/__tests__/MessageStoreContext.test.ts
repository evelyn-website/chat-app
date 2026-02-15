import { messageReducer, initialState } from "../MessageStoreContext";
import { MessageType } from "@/types/types";

const makeMessage = (overrides: Record<string, unknown> = {}) => ({
  id: "msg-1",
  sender_id: "user-1",
  group_id: "group-1",
  timestamp: "2026-01-01T00:00:00Z",
  client_seq: null,
  client_timestamp: null,
  ciphertext: new Uint8Array(),
  message_type: MessageType.TEXT,
  msg_nonce: new Uint8Array(),
  sender_ephemeral_public_key: new Uint8Array(),
  sym_key_encryption_nonce: new Uint8Array(),
  sealed_symmetric_key: new Uint8Array(),
  ...overrides,
});

describe("messageReducer", () => {
  it("adds a message to an empty group", () => {
    const msg = makeMessage();
    const state = messageReducer(initialState, {
      type: "ADD_MESSAGE",
      payload: msg,
    });

    expect(state.messages["group-1"]).toHaveLength(1);
    expect(state.messages["group-1"][0].id).toBe("msg-1");
  });

  it("deduplicates messages with the same id", () => {
    const msg = makeMessage();
    const state1 = messageReducer(initialState, {
      type: "ADD_MESSAGE",
      payload: msg,
    });
    const state2 = messageReducer(state1, {
      type: "ADD_MESSAGE",
      payload: msg,
    });

    expect(state2.messages["group-1"]).toHaveLength(1);
    // Should return same reference when no change
    expect(state2).toBe(state1);
  });

  it("sorts messages by timestamp on ADD_MESSAGE", () => {
    const msg1 = makeMessage({ id: "msg-1", timestamp: "2026-01-02T00:00:00Z" });
    const msg2 = makeMessage({ id: "msg-2", timestamp: "2026-01-01T00:00:00Z" });

    let state = messageReducer(initialState, { type: "ADD_MESSAGE", payload: msg1 });
    state = messageReducer(state, { type: "ADD_MESSAGE", payload: msg2 });

    expect(state.messages["group-1"][0].id).toBe("msg-2");
    expect(state.messages["group-1"][1].id).toBe("msg-1");
  });

  it("sets historical messages grouped by group_id", () => {
    const msgs = [
      makeMessage({ id: "msg-1", group_id: "group-1" }),
      makeMessage({ id: "msg-2", group_id: "group-2" }),
    ];
    const state = messageReducer(initialState, {
      type: "SET_HISTORICAL_MESSAGES",
      payload: msgs,
    });

    expect(state.messages["group-1"]).toHaveLength(1);
    expect(state.messages["group-2"]).toHaveLength(1);
  });

  it("merges messages without duplicating existing ones", () => {
    const existing = makeMessage({ id: "msg-1", timestamp: "2026-01-01T00:00:00Z" });
    const state1 = messageReducer(initialState, {
      type: "ADD_MESSAGE",
      payload: existing,
    });

    const incoming = [
      makeMessage({ id: "msg-1", timestamp: "2026-01-01T00:00:00Z" }),
      makeMessage({ id: "msg-2", timestamp: "2026-01-02T00:00:00Z" }),
    ];
    const state2 = messageReducer(state1, {
      type: "MERGE_MESSAGES",
      payload: incoming,
    });

    expect(state2.messages["group-1"]).toHaveLength(2);
  });

  it("removes group messages", () => {
    const msg = makeMessage();
    const state1 = messageReducer(initialState, {
      type: "ADD_MESSAGE",
      payload: msg,
    });
    const state2 = messageReducer(state1, {
      type: "REMOVE_GROUP_MESSAGES",
      payload: "group-1",
    });

    expect(state2.messages["group-1"]).toBeUndefined();
  });

  it("sets loading state", () => {
    const state = messageReducer(initialState, {
      type: "SET_LOADING",
      payload: true,
    });
    expect(state.loading).toBe(true);
  });

  it("sets error state", () => {
    const state = messageReducer(initialState, {
      type: "SET_ERROR",
      payload: "Something went wrong",
    });
    expect(state.error).toBe("Something went wrong");
  });

  it("clears error state", () => {
    const errState = messageReducer(initialState, {
      type: "SET_ERROR",
      payload: "err",
    });
    const state = messageReducer(errState, {
      type: "SET_ERROR",
      payload: null,
    });
    expect(state.error).toBeNull();
  });
});
