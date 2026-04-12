import { DbMessage, RawMessage } from "@/types/types";
import React, {
  createContext,
  useContext,
  useReducer,
  useCallback,
  useMemo,
  useEffect,
  useRef,
  useState,
} from "react";
import { useWebSocket } from "./WebSocketContext";
import http from "@/util/custom-axios";
import { useGlobalStore } from "./GlobalStoreContext";
import { CanceledError } from "axios";
import * as encryptionService from "@/services/encryptionService";
import { OptimisticMessageItem } from "../ChatBox/types";
import { DEBUG } from "@/utils/debug";

type MessageAction =
  | { type: "ADD_MESSAGE"; payload: DbMessage }
  | { type: "SET_HISTORICAL_MESSAGES"; payload: DbMessage[] }
  | { type: "MERGE_MESSAGES"; payload: DbMessage[] }
  | { type: "REMOVE_GROUP_MESSAGES"; payload: string }
  | { type: "SET_LOADING"; payload: boolean }
  | { type: "SET_ERROR"; payload: string | null };

interface MessageState {
  messages: Record<string, DbMessage[]>;
  loading: boolean;
  error: string | null;
}

interface MessageStoreContextType {
  getMessagesForGroup: (groupId: string) => DbMessage[];
  loading: boolean;
  error: string | null;
  loadHistoricalMessages: (deviceId?: string) => Promise<void>;
  removeGroupMessages: (groupId: string) => void;
  optimistic: Record<string, OptimisticMessageItem[]>;
  addOptimisticDisplayable: (item: OptimisticMessageItem) => void;
  removeOptimisticDisplayable: (groupId: string, id: string) => void;
  getNextClientSeq: () => number;
}

export const initialState: MessageState = {
  messages: {},
  loading: false,
  error: null,
};

export const messageReducer = (
  state: MessageState,
  action: MessageAction
): MessageState => {
  switch (action.type) {
    case "ADD_MESSAGE": {
      const groupId = action.payload.group_id;
      const existingGroupMessages = state.messages[groupId] || [];
      if (existingGroupMessages.find((m) => m.id === action.payload.id)) {
        return state;
      }
      const updatedGroupMessages = [...existingGroupMessages, action.payload];
      updatedGroupMessages.sort(
        (a, b) =>
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      );
      return {
        ...state,
        messages: {
          ...state.messages,
          [groupId]: updatedGroupMessages,
        },
      };
    }
    case "SET_HISTORICAL_MESSAGES": {
      const messagesByGroup = action.payload.reduce(
        (acc, message) => {
          const groupId = message.group_id;
          if (!acc[groupId]) acc[groupId] = [];
          acc[groupId].push(message);
          return acc;
        },
        {} as Record<string, DbMessage[]>
      );
      for (const groupId in messagesByGroup) {
        messagesByGroup[groupId].sort(
          (a, b) =>
            new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        );
      }
      return { ...state, messages: messagesByGroup };
    }
    case "MERGE_MESSAGES": {
      const incoming = action.payload.reduce(
        (acc, message) => {
          const groupId = message.group_id;
          if (!acc[groupId]) acc[groupId] = [];
          acc[groupId].push(message);
          return acc;
        },
        {} as Record<string, DbMessage[]>
      );
      const merged = { ...state.messages };
      for (const groupId in incoming) {
        const existingMap = new Map(
          (merged[groupId] || []).map((m) => [m.id, m])
        );
        for (const msg of incoming[groupId]) {
          existingMap.set(msg.id, msg);
        }
        merged[groupId] = Array.from(existingMap.values()).sort(
          (a, b) =>
            new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        );
      }
      return { ...state, messages: merged };
    }
    case "REMOVE_GROUP_MESSAGES": {
      const { [action.payload]: _, ...remaining } = state.messages;
      return { ...state, messages: remaining };
    }
    case "SET_LOADING":
      return { ...state, loading: action.payload };
    case "SET_ERROR":
      return { ...state, error: action.payload };
    default:
      return state;
  }
};

const MessageStoreContext = createContext<MessageStoreContextType | undefined>(
  undefined
);

export const MessageStoreProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [state, dispatch] = useReducer(messageReducer, initialState);
  const { onMessage, removeMessageHandler } = useWebSocket();
  const { store, deviceId: globalDeviceId, refreshGroups, relevantDeviceKeys } =
    useGlobalStore();

  const [optimistic, setOptimistic] = useState<
    Record<string, OptimisticMessageItem[]>
  >({});

  const globalClientSequenceRef = useRef(0);
  const hasLoadedHistoricalMessagesRef = useRef(false);
  const optimisticRef = useRef<Record<string, OptimisticMessageItem[]>>({});
  const relevantDeviceKeysRef = useRef(relevantDeviceKeys);

  const getNextClientSeq = useCallback(() => {
    return ++globalClientSequenceRef.current;
  }, []);

  const addOptimisticDisplayable = useCallback(
    (item: OptimisticMessageItem) => {
      setOptimistic((o) => {
        const list = o[item.groupId] || [];
        const newState = { ...o, [item.groupId]: [...list, item] };

        if (DEBUG.MESSAGE_FLOW) {
          console.log('[MSG] Optimistic created', {
            id: item.id.slice(0, 8),
            seq: item.clientSeq,
            time: new Date(item.timestamp).toISOString().slice(11, 23),
          });
        }

        return newState;
      });
    },
    []
  );

  const removeOptimisticDisplayable = useCallback(
    (groupId: string, id: string) => {
      setOptimistic((o) => {
        const newState = {
          ...o,
          [groupId]: (o[groupId] || []).filter((x) => x.id !== id),
        };
        // if (DEBUG_STORE) {
        //   console.log("[Store] optimistic remove", { groupId, id });
        // }
        return newState;
      });
    },
    []
  );

  const updateOptimisticMessage = useCallback(
    (groupId: string, id: string, updates: { timestamp?: string; pinToBottom?: boolean }) => {
      setOptimistic((o) => {
        const list = o[groupId];
        if (!list) return o;
        return {
          ...o,
          [groupId]: list.map((item): OptimisticMessageItem =>
            item.id === id ? { ...item, ...updates } : item
          ),
        };
      });
    },
    []
  );

  // Keep optimisticRef in sync with optimistic state to avoid circular dependency
  useEffect(() => {
    optimisticRef.current = optimistic;
  }, [optimistic]);

  const isSyncingHistoricalMessagesRef = useRef(false);
  const lastRecoverySyncAttemptRef = useRef(0);
  const hasPendingSigningKeyRecoveryRef = useRef(false);
  const recoveryRetryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const clearRecoveryRetryTimeout = useCallback(() => {
    if (recoveryRetryTimeoutRef.current !== null) {
      clearTimeout(recoveryRetryTimeoutRef.current);
      recoveryRetryTimeoutRef.current = null;
    }
  }, []);

  const loadHistoricalMessages = useCallback(
    async (deviceId?: string) => {
      const preferredDeviceId = globalDeviceId ?? deviceId;
      if (isSyncingHistoricalMessagesRef.current) {
        console.log(
          "loadHistoricalMessages: Sync already in progress. Skipping."
        );
        if (
          hasPendingSigningKeyRecoveryRef.current &&
          recoveryRetryTimeoutRef.current === null
        ) {
          recoveryRetryTimeoutRef.current = setTimeout(() => {
            recoveryRetryTimeoutRef.current = null;
            if (!hasPendingSigningKeyRecoveryRef.current) {
              return;
            }
            void loadHistoricalMessages(preferredDeviceId);
          }, 1000);
        }
        return;
      }
      if (!preferredDeviceId) {
        console.error(
          "loadHistoricalMessages: Device ID not available. Skipping."
        );
        dispatch({ type: "SET_ERROR", payload: "Device ID not configured." });
        return;
      }

      isSyncingHistoricalMessagesRef.current = true;
      dispatch({ type: "SET_LOADING", payload: true });

      try {
        const response = await http.get<RawMessage[]>(
          `${process.env.EXPO_PUBLIC_HOST}/ws/relevant-messages`
        );
        const rawMessages: RawMessage[] = response.data;
        const processedMessages: DbMessage[] = [];
        let skippedForMissingSigningKey = 0;

        for (const rawMsg of rawMessages) {
          const senderSigningPublicKey = (
            relevantDeviceKeysRef.current[rawMsg.sender_id] || []
          ).find((key) => key.deviceId === rawMsg.sender_device_id)
            ?.signingPublicKey;
          if (!senderSigningPublicKey) {
            skippedForMissingSigningKey++;
            continue;
          }
          const baseProcessed = encryptionService.processAndDecodeIncomingMessage(
            rawMsg,
            preferredDeviceId,
            rawMsg.sender_id,
            rawMsg.id,
            rawMsg.timestamp,
            senderSigningPublicKey,
            rawMsg.sender_username
          );
          if (baseProcessed) {
            // Historical messages don't have client metadata (NULL values OK)
            const processedMessage: DbMessage = {
              ...baseProcessed,
              client_seq: null,
              client_timestamp: null,
            };
            processedMessages.push(processedMessage);
            // Note: Optimistic messages will be filtered out by ChatBox automatically
          }
          // Note: processAndDecodeIncomingMessage returns null for messages without
          // an envelope for this device - this is expected for historical messages
        }

        // Only replace the full local snapshot when we can process every server message.
        // If some messages are skipped due to missing signing keys, merge instead to avoid
        // wiping locally cached history during startup races.
        const isFirstLoad = !hasLoadedHistoricalMessagesRef.current;
        const canReplaceSnapshot =
          isFirstLoad && skippedForMissingSigningKey === 0;
        hasPendingSigningKeyRecoveryRef.current = skippedForMissingSigningKey > 0;
        if (!hasPendingSigningKeyRecoveryRef.current) {
          clearRecoveryRetryTimeout();
        }
        await store.saveMessages(processedMessages, canReplaceSnapshot);

        // Mark that we've loaded historical messages at least once
        hasLoadedHistoricalMessagesRef.current = true;

        dispatch({
          type: canReplaceSnapshot ? "SET_HISTORICAL_MESSAGES" : "MERGE_MESSAGES",
          payload: processedMessages,
        });
        dispatch({ type: "SET_ERROR", payload: null });

        refreshGroups();
      } catch (error) {
        if (!(error instanceof CanceledError)) {
          console.error(
            "loadHistoricalMessages: Failed to sync messages:",
            error
          );
          try {
            const messages = await store.loadMessages();
            dispatch({ type: "SET_HISTORICAL_MESSAGES", payload: messages });
            dispatch({
              type: "SET_ERROR",
              payload: "Failed to sync messages, showing local data.",
            });

            // Refresh groups even when loading from local store
            refreshGroups();
          } catch (storeError) {
            console.error(
              "loadHistoricalMessages: Failed to load messages from store after sync error:",
              storeError
            );
            dispatch({ type: "SET_ERROR", payload: "Failed to load messages" });
          }
        } else {
          console.log("loadHistoricalMessages: Sync operation was canceled.");
        }
      } finally {
        dispatch({ type: "SET_LOADING", payload: false });
        isSyncingHistoricalMessagesRef.current = false;
      }
    },
    [
      dispatch,
      store,
      globalDeviceId,
      refreshGroups,
      clearRecoveryRetryTimeout,
    ]
  );

  useEffect(() => {
    relevantDeviceKeysRef.current = relevantDeviceKeys;

    if (!hasPendingSigningKeyRecoveryRef.current) {
      clearRecoveryRetryTimeout();
      return;
    }

    // New signing keys arrived while recovery was pending; retry history sync immediately.
    const hasAnyDeviceKeys = Object.keys(relevantDeviceKeys).length > 0;
    if (!hasAnyDeviceKeys) {
      return;
    }

    void loadHistoricalMessages();
  }, [relevantDeviceKeys, loadHistoricalMessages, clearRecoveryRetryTimeout]);

  useEffect(
    () => () => {
      clearRecoveryRetryTimeout();
    },
    [clearRecoveryRetryTimeout]
  );

  useEffect(() => {
    const handleNewRawMessage = async (rawMsg: RawMessage) => {
      if (!globalDeviceId) {
        console.error(
          "handleNewRawMessage: Device ID not available, cannot process message."
        );
        return;
      }

      // Find optimistic message to extract client metadata
      const optimisticMsg = optimisticRef.current[rawMsg.group_id]?.find(
        (m) => m.id === rawMsg.id
      );

      const senderSigningPublicKey = (
        relevantDeviceKeysRef.current[rawMsg.sender_id] || []
      ).find((key) => key.deviceId === rawMsg.sender_device_id)
        ?.signingPublicKey;
      if (!senderSigningPublicKey) {
        console.warn(
          "handleNewRawMessage: Missing sender signing key; scheduling historical recovery sync.",
          {
            messageId: rawMsg.id,
            senderId: rawMsg.sender_id,
            senderDeviceId: rawMsg.sender_device_id,
          }
        );
        if (optimisticMsg) {
          updateOptimisticMessage(rawMsg.group_id, rawMsg.id, {
            timestamp: rawMsg.timestamp,
            pinToBottom: false,
          });
        }
        hasPendingSigningKeyRecoveryRef.current = true;
        const now = Date.now();
        if (now - lastRecoverySyncAttemptRef.current > 2000) {
          lastRecoverySyncAttemptRef.current = now;
          void loadHistoricalMessages();
        }
        return;
      }
      const baseProcessed = encryptionService.processAndDecodeIncomingMessage(
        rawMsg,
        globalDeviceId,
        rawMsg.sender_id,
        rawMsg.id,
        rawMsg.timestamp,
        senderSigningPublicKey,
        rawMsg.sender_username
      );

      if (baseProcessed) {
        // Only unpin/update optimistic message after verification/decode succeeds.
        if (optimisticMsg) {
          updateOptimisticMessage(rawMsg.group_id, rawMsg.id, {
            timestamp: rawMsg.timestamp,
            pinToBottom: false,
          });
        }

        const processedMessage: DbMessage = {
          ...baseProcessed,
          client_seq: optimisticMsg?.clientSeq ?? null,
          client_timestamp: optimisticMsg?.timestamp ?? null,
        };

        if (DEBUG.MESSAGE_FLOW) {
          console.log('[MSG] Server confirmed', {
            id: processedMessage.id.slice(0, 8),
            time: new Date(processedMessage.timestamp).toISOString().slice(11, 23),
            clientSeq: processedMessage.client_seq,
          });
        }

        dispatch({ type: "ADD_MESSAGE", payload: processedMessage });
        await store.saveMessages([processedMessage]);

        refreshGroups();

        // Note: Optimistic messages are automatically filtered out by ChatBox
        // when their real counterparts are decrypted and ready to display.
        // No need for a timer-based removal.
      }
      // Note: processAndDecodeIncomingMessage returns null for messages without
      // an envelope for this device - this is expected and not an error
    };

    onMessage(handleNewRawMessage);
    return () => removeMessageHandler(handleNewRawMessage);
  }, [
    onMessage,
    removeMessageHandler,
    store,
    globalDeviceId,
    refreshGroups,
    updateOptimisticMessage,
    loadHistoricalMessages,
  ]);

  const getMessagesForGroup = useCallback(
    (groupId: string) => {
      return state.messages[groupId] || [];
    },
    [state.messages]
  );

  const removeGroupMessages = useCallback(
    (groupId: string) => {
      dispatch({ type: "REMOVE_GROUP_MESSAGES", payload: groupId });
    },
    []
  );

  const value = useMemo(
    () => ({
      getMessagesForGroup,
      loading: state.loading,
      error: state.error,
      loadHistoricalMessages,
      removeGroupMessages,
      optimistic,
      addOptimisticDisplayable,
      removeOptimisticDisplayable,
      getNextClientSeq,
    }),
    [
      getMessagesForGroup,
      state.loading,
      state.error,
      loadHistoricalMessages,
      removeGroupMessages,
      optimistic,
      addOptimisticDisplayable,
      removeOptimisticDisplayable,
      getNextClientSeq,
    ]
  );

  return (
    <MessageStoreContext.Provider value={value}>
      {children}
    </MessageStoreContext.Provider>
  );
};

export const useMessageStore = () => {
  const context = useContext(MessageStoreContext);
  if (!context) {
    throw new Error(
      "useMessageStore must be used within a MessageStoreProvider"
    );
  }
  return context;
};
