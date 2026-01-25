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
import { DisplayableItem } from "../ChatBox/types";
import { DEBUG } from "@/utils/debug";

type MessageAction =
  | { type: "ADD_MESSAGE"; payload: DbMessage }
  | { type: "SET_HISTORICAL_MESSAGES"; payload: DbMessage[] }
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
  optimistic: Record<string, DisplayableItem[]>;
  addOptimisticDisplayable: (item: DisplayableItem) => void;
  removeOptimisticDisplayable: (groupId: string, id: string) => void;
  getNextClientSeq: () => number;
}

const initialState: MessageState = {
  messages: {},
  loading: false,
  error: null,
};

const messageReducer = (
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
  const { store, deviceId: globalDeviceId, refreshGroups } = useGlobalStore();

  const [optimistic, setOptimistic] = useState<
    Record<string, DisplayableItem[]>
  >({});

  const globalClientSequenceRef = useRef(0);
  const hasLoadedHistoricalMessagesRef = useRef(false);
  const optimisticRef = useRef<Record<string, DisplayableItem[]>>({});

  const getNextClientSeq = useCallback(() => {
    return ++globalClientSequenceRef.current;
  }, []);

  const addOptimisticDisplayable = useCallback(
    (item: DisplayableItem) => {
      setOptimistic((o) => {
        const list = o[item.groupId] || [];
        const newState = { ...o, [item.groupId]: [...list, item] };

        if (DEBUG.MESSAGE_FLOW) {
          console.log('[MSG] Optimistic created', {
            id: item.id.slice(0, 8),
            seq: (item as any).clientSeq,
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

  // Keep optimisticRef in sync with optimistic state to avoid circular dependency
  useEffect(() => {
    optimisticRef.current = optimistic;
  }, [optimistic]);

  const isSyncingHistoricalMessagesRef = useRef(false);

  const loadHistoricalMessages = useCallback(
    async (deviceId?: string) => {
      const preferredDeviceId = globalDeviceId ?? deviceId;
      if (isSyncingHistoricalMessagesRef.current) {
        console.log(
          "loadHistoricalMessages: Sync already in progress. Skipping."
        );
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

        for (const rawMsg of rawMessages) {
          const baseProcessed = encryptionService.processAndDecodeIncomingMessage(
            rawMsg,
            preferredDeviceId,
            rawMsg.sender_id,
            rawMsg.id,
            rawMsg.timestamp
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

        // Only clear messages on the first historical load to prevent flash
        const shouldClearFirst = !hasLoadedHistoricalMessagesRef.current;
        await store.saveMessages(processedMessages, shouldClearFirst);

        // Mark that we've loaded historical messages at least once
        hasLoadedHistoricalMessagesRef.current = true;

        dispatch({
          type: "SET_HISTORICAL_MESSAGES",
          payload: processedMessages,
        });
        dispatch({ type: "SET_ERROR", payload: null });

        setTimeout(() => refreshGroups(), 100);
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
    ]
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

      const baseProcessed =
        encryptionService.processAndDecodeIncomingMessage(
          rawMsg,
          globalDeviceId,
          rawMsg.sender_id,
          rawMsg.id,
          rawMsg.timestamp
        );

      if (baseProcessed) {
        const processedMessage: DbMessage = {
          ...baseProcessed,
          client_seq: (optimisticMsg && 'clientSeq' in optimisticMsg) ? (optimisticMsg.clientSeq ?? null) : null,
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
  ]);

  const getMessagesForGroup = useCallback(
    (groupId: string) => {
      return state.messages[groupId] || [];
    },
    [state.messages]
  );

  const value = useMemo(
    () => ({
      getMessagesForGroup,
      loading: state.loading,
      error: state.error,
      loadHistoricalMessages,
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
