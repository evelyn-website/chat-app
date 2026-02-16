import {
  RawMessage,
  Group,
  User,
  UpdateGroupParams,
  CreateGroupParams,
  GroupEvent,
  BlockedUser,
  InvitePreview,
  CreateInviteResponse,
  AcceptInviteResponse,
} from "@/types/types";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { AppState, AppStateStatus } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import axios from "axios";
import http from "@/util/custom-axios";
import { get } from "@/util/custom-store";

interface WebSocketContextType {
  sendMessage: (packet: RawMessage) => void;
  connected: boolean;
  onMessage: (callback: (packet: RawMessage) => void) => void;
  removeMessageHandler: (callback: (packet: RawMessage) => void) => void;
  onGroupEvent: (callback: (event: GroupEvent) => void) => void;
  removeGroupEventHandler: (callback: (event: GroupEvent) => void) => void;
  establishConnection: () => Promise<void>;
  disconnect: () => void;
  createGroup: (
    id: string,
    name: string,
    startTime: Date,
    endTime: Date,
    description?: string | null,
    location?: string | null,
    imageUrl?: string | null,
    blurhash?: string | null,
  ) => Promise<Group | undefined>;
  updateGroup: (
    id: string,
    updateParams: UpdateGroupParams,
  ) => Promise<Group | undefined>;
  inviteUsersToGroup: (
    emails: string[],
    group_id: string,
  ) => Promise<{ skipped_users: string[] }>;
  removeUserFromGroup: (email: string, group_id: string) => void;
  leaveGroup: (group_id: string) => void;
  getGroups: () => Promise<Group[]>;
  getUsers: () => Promise<User[]>;
  toggleGroupMuted: (
    groupId: string,
  ) => Promise<{ muted: boolean } | undefined>;
  blockUser: (userId: string) => Promise<{ removed_from_groups?: string[] }>;
  unblockUser: (userId: string) => Promise<void>;
  getBlockedUsers: () => Promise<BlockedUser[]>;
  createInviteLink: (
    groupId: string,
    maxUses?: number,
  ) => Promise<CreateInviteResponse>;
  validateInvite: (code: string) => Promise<InvitePreview>;
  acceptInvite: (code: string) => Promise<AcceptInviteResponse>;
}

const WebSocketContext = createContext<WebSocketContextType | undefined>(
  undefined,
);

const httpBaseURL = `${process.env.EXPO_PUBLIC_HOST}/ws`;
const wsBaseURL = `${process.env.EXPO_PUBLIC_WS_HOST}/ws`;

const MAX_RETRIES = 5;
const INITIAL_RETRY_DELAY = 1000;
const MAX_RETRY_DELAY = 30000;

const CLOSE_CODE_AUTH_FAILED = 4001;
const CLOSE_CODE_UNAUTHENTICATED = 4003;

export const WebSocketProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const socketRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const messageHandlersRef = useRef<((packet: RawMessage) => void)[]>([]);
  const groupEventHandlersRef = useRef<((event: GroupEvent) => void)[]>([]);
  const isReconnecting = useRef(false);
  const preventRetriesRef = useRef(false);
  const appState = useRef(AppState.currentState);

  const createGroup = useCallback(
    async (
      id: string,
      name: string,
      startTime: Date,
      endTime: Date,
      description?: string | null,
      location?: string | null,
      imageUrl?: string | null,
      blurhash?: string | null,
    ): Promise<Group | undefined> => {
      const httpURL = `${httpBaseURL}/create-group`;
      const payload: CreateGroupParams = {
        id,
        name,
        start_time: startTime.toISOString(),
        end_time: endTime.toISOString(),
        ...(description !== undefined && { description }),
        ...(location !== undefined && { location }),
        ...(imageUrl !== undefined && { image_url: imageUrl }),
        ...(blurhash !== undefined && { blurhash }),
      };
      return http
        .post(httpURL, payload)
        .then((response) => response.data)
        .catch((error) => {
          console.error("Error creating group:", error);
          return undefined;
        });
    },
    [],
  );

  const updateGroup = useCallback(
    async (
      id: string,
      updateParams: UpdateGroupParams,
    ): Promise<Group | undefined> => {
      const httpURL = `${httpBaseURL}/update-group/${id}`;
      if (
        !Object.values(updateParams).some(
          (value) => value !== undefined && value !== null,
        )
      ) {
        console.error("Invalid update input: No parameters provided.");
        return undefined;
      }
      return http
        .put(httpURL, updateParams)
        .then((response) => response.data)
        .catch((error) => {
          console.error("Error updating group:", error);
          return undefined;
        });
    },
    [],
  );

  const establishConnection = useCallback((): Promise<void> => {
    let promiseSettled = false;
    preventRetriesRef.current = false;
    let currentAttemptPreventRetries = false;

    return new Promise(async (resolve, reject) => {
      const token = await get("jwt");
      if (!token) {
        if (!promiseSettled) {
          promiseSettled = true;
          reject(new Error("Authentication token not found."));
        }
        return;
      }

      if (socketRef.current?.readyState === WebSocket.OPEN) {
        if (!promiseSettled) {
          promiseSettled = true;
          resolve();
        }
        return;
      }

      if (isReconnecting.current) {
        console.log("Connection attempt already in progress.");
        if (!promiseSettled) {
          reject(new Error("Connection attempt already in progress."));
        }
        return;
      }

      isReconnecting.current = true;
      currentAttemptPreventRetries = false;

      const wsURL = `${wsBaseURL}/establish-connection`;
      let retryCount = 0;
      let isAuthenticated = false;

      const cleanup = (reason?: string) => {
        if (socketRef.current) {
          const ws = socketRef.current;
          socketRef.current = null;
          ws.onopen = null;
          ws.onmessage = null;
          ws.onclose = null;
          ws.onerror = null;
          if (
            ws.readyState !== WebSocket.CLOSING &&
            ws.readyState !== WebSocket.CLOSED
          ) {
            ws.close(1000, `Client cleanup: ${reason || "Normal"}`);
          }
        }
        isAuthenticated = false;
        setConnected(false);
      };

      const safeReject = (error: Error) => {
        if (!promiseSettled) {
          promiseSettled = true;
          reject(error);
        }
        isReconnecting.current = false;
        currentAttemptPreventRetries = true;
        if (socketRef.current) {
          cleanup(error.message);
        } else {
          isAuthenticated = false;
          setConnected(false);
        }
      };

      const connect = () => {
        if (currentAttemptPreventRetries || preventRetriesRef.current) {
          console.log("Retries prevented for current connection flow.");
          isReconnecting.current = false;
          if (!promiseSettled && !isAuthenticated) {
            safeReject(new Error("Connection retries aborted."));
          }
          return;
        }

        if (socketRef.current) {
          const oldSocket = socketRef.current;
          socketRef.current = null;

          oldSocket.onopen = null;
          oldSocket.onmessage = null;
          oldSocket.onclose = null;
          oldSocket.onerror = null;
          if (
            oldSocket.readyState !== WebSocket.CLOSING &&
            oldSocket.readyState !== WebSocket.CLOSED
          ) {
            oldSocket.close(
              1000,
              "Client cleanup: Starting new connection attempt",
            );
          }
        }

        const socket = new WebSocket(wsURL);
        socketRef.current = socket;

        socket.onopen = () => {
          if (socketRef.current !== socket) return;
          try {
            socket.send(JSON.stringify({ type: "auth", token: token }));
          } catch {
            safeReject(new Error("Failed to send authentication message."));
            socket.close(CLOSE_CODE_AUTH_FAILED, "Failed to send auth");
          }
        };

        socket.onmessage = (event) => {
          if (socketRef.current !== socket) return;
          try {
            const parsedData = JSON.parse(event.data as string);

            if (!isAuthenticated) {
              if (parsedData.type === "auth_success") {
                isAuthenticated = true;
                setConnected(true);
                isReconnecting.current = false;
                retryCount = 0;
                preventRetriesRef.current = false;
                if (!promiseSettled) {
                  promiseSettled = true;
                  resolve();
                }
              } else if (parsedData.type === "auth_failure") {
                preventRetriesRef.current = true;
                safeReject(
                  new Error(
                    `Authentication failed: ${parsedData.error || "Unknown reason"}`,
                  ),
                );
                socket.close(CLOSE_CODE_AUTH_FAILED, "Authentication Failed");
              } else {
                preventRetriesRef.current = true;
                safeReject(
                  new Error(
                    "Received unexpected message during authentication phase.",
                  ),
                );
              }
            } else {
              if (
                parsedData.type === "group_event" &&
                parsedData.event &&
                parsedData.group_id
              ) {
                groupEventHandlersRef.current.forEach((handler) => {
                  try {
                    handler(parsedData as GroupEvent);
                  } catch (handlerError) {
                    console.error(
                      "Error in group event handler:",
                      handlerError,
                    );
                  }
                });
              } else if (
                parsedData.group_id &&
                parsedData.ciphertext &&
                parsedData.envelopes &&
                Array.isArray(parsedData.envelopes)
              ) {
                messageHandlersRef.current.forEach((handler) => {
                  try {
                    handler(parsedData as RawMessage);
                  } catch (handlerError) {
                    console.error("Error in message handler:", handlerError);
                  }
                });
              } else if (parsedData.type && parsedData.type === "error") {
                console.error(
                  "Received operational error from server:",
                  parsedData.message,
                );
              } else {
                console.warn(
                  "Received non-message data or malformed E2EE packet after auth:",
                  parsedData,
                );
              }
            }
          } catch (error) {
            console.error(
              "Error parsing WebSocket message or in handler:",
              error,
            );
          }
        };

        socket.onclose = (event) => {
          if (socketRef.current !== socket && socketRef.current !== null) {
            return;
          }
          const wasCurrentSocket = socketRef.current === socket;

          if (wasCurrentSocket) {
            socketRef.current = null;
          }

          if (wasCurrentSocket || !socketRef.current) {
            setConnected(false);
          }

          if (
            currentAttemptPreventRetries ||
            preventRetriesRef.current ||
            event.code === 1000 ||
            event.code === CLOSE_CODE_AUTH_FAILED ||
            event.code === CLOSE_CODE_UNAUTHENTICATED
          ) {
            isReconnecting.current = false;
            if (!promiseSettled && !isAuthenticated && event.code !== 1000) {
              promiseSettled = true;
              reject(
                new Error(
                  `WebSocket closed (Code: ${event.code}) before authentication completed.`,
                ),
              );
            }
            return;
          }

          retryCount++;
          if (retryCount <= MAX_RETRIES) {
            const delay = Math.min(
              INITIAL_RETRY_DELAY * Math.pow(2, retryCount - 1) +
                Math.random() * 1000,
              MAX_RETRY_DELAY,
            );
            console.log(
              `WebSocket closed unexpectedly. Retrying in ${delay.toFixed(0)}ms... (Attempt ${retryCount})`,
            );
            setTimeout(connect, delay);
          } else {
            isReconnecting.current = false;
            console.error("WebSocket connection failed after maximum retries.");
            if (!promiseSettled) {
              promiseSettled = true;
              reject(
                new Error("WebSocket connection failed after maximum retries"),
              );
            }
          }
        };

        socket.onerror = (event) => {
          if (socketRef.current !== socket) return;
          console.error("WebSocket error:", event);
        };
      };
      connect();
    });
  }, [setConnected]);

  const leaveGroup = useCallback(async (group_id: string) => {
    return http
      .post(`${httpBaseURL}/leave-group/${group_id}`)
      .catch((error) => {
        console.error("Error leaving group:", error);
      });
  }, []);

  const disconnect = useCallback(() => {
    preventRetriesRef.current = true;
    isReconnecting.current = false;
    if (socketRef.current) {
      socketRef.current.close(1000, "User initiated disconnect");
    }
  }, []);

  const inviteUsersToGroup = useCallback(
    async (
      emails: string[],
      group_id: string,
    ): Promise<{ skipped_users: string[] }> => {
      const response = await http.post(`${httpBaseURL}/invite-users-to-group`, {
        group_id: group_id,
        emails: emails,
      });
      return response.data as { skipped_users: string[] };
    },
    [],
  );

  const removeUserFromGroup = useCallback(
    async (email: string, group_id: string): Promise<any> => {
      // TODO: define a more specific return type
      return http
        .post(`${httpBaseURL}/remove-user-from-group`, {
          group_id: group_id,
          email: email,
        })
        .catch((error) => {
          console.error("Error removing user:", error);
        });
    },
    [],
  );

  const getGroups = useCallback(async (): Promise<Group[]> => {
    const response = await http.get(`${httpBaseURL}/get-groups`);
    return response.data as Group[];
  }, []);

  const getUsers = useCallback(async (): Promise<User[]> => {
    const response = await http.get(`${httpBaseURL}/relevant-users`);
    return response.data as User[];
  }, []);

  const toggleGroupMuted = useCallback(
    async (groupId: string): Promise<{ muted: boolean } | undefined> => {
      const apiBaseURL = `${process.env.EXPO_PUBLIC_HOST}/api`;
      return http
        .put(`${apiBaseURL}/groups/${groupId}/mute`)
        .then((response) => response.data as { muted: boolean })
        .catch((error) => {
          console.error("Error toggling group mute:", error);
          return undefined;
        });
    },
    [],
  );

  const blockUser = useCallback(
    async (userId: string): Promise<{ removed_from_groups?: string[] }> => {
      const response = await http.post(`${httpBaseURL}/block-user`, {
        user_id: userId,
      });
      return response.data as { removed_from_groups?: string[] };
    },
    [],
  );

  const unblockUser = useCallback(async (userId: string): Promise<void> => {
    await http.post(`${httpBaseURL}/unblock-user`, { user_id: userId });
  }, []);

  const getBlockedUsers = useCallback(async (): Promise<BlockedUser[]> => {
    const response = await http.get(`${httpBaseURL}/blocked-users`);
    return response.data as BlockedUser[];
  }, []);

  const createInviteLink = useCallback(
    async (
      groupId: string,
      maxUses?: number,
    ): Promise<CreateInviteResponse> => {
      const response = await http.post(
        `${process.env.EXPO_PUBLIC_HOST}/api/invites`,
        {
          group_id: groupId,
          max_uses: maxUses ?? 0,
        },
      );
      return response.data as CreateInviteResponse;
    },
    [],
  );

  const validateInvite = useCallback(
    async (code: string): Promise<InvitePreview> => {
      // validateInvite intentionally uses axios instead of http because this is a
      // public endpoint and http injects JWT/auth interceptors. Tradeoff: bypasses
      // shared http defaults (timeouts/error handlers), so revisit if needed.
      const response = await axios.get(
        `${process.env.EXPO_PUBLIC_HOST}/public/invites/${code}`,
      );
      return response.data as InvitePreview;
    },
    [],
  );

  const acceptInvite = useCallback(
    async (code: string): Promise<AcceptInviteResponse> => {
      const response = await http.post(
        `${process.env.EXPO_PUBLIC_HOST}/api/invites/${code}/accept`,
      );
      return response.data as AcceptInviteResponse;
    },
    [],
  );

  const sendMessage = useCallback(
    (packet: RawMessage) => {
      const socket = socketRef.current;
      if (socket && socket.readyState === WebSocket.OPEN && connected) {
        try {
          socket.send(JSON.stringify(packet));
        } catch (error) {
          console.error("Error sending message:", error);
        }
      } else {
        console.error(
          "WebSocket is not connected or not authenticated. Message not sent.",
        );
      }
    },
    [connected],
  );

  const onMessage = useCallback((callback: (packet: RawMessage) => void) => {
    if (!messageHandlersRef.current.includes(callback)) {
      messageHandlersRef.current = [...messageHandlersRef.current, callback];
    }
  }, []);

  const removeMessageHandler = useCallback(
    (callback: (packet: RawMessage) => void) => {
      messageHandlersRef.current = messageHandlersRef.current.filter(
        (h) => h !== callback,
      );
    },
    [],
  );

  const onGroupEvent = useCallback((callback: (event: GroupEvent) => void) => {
    if (!groupEventHandlersRef.current.includes(callback)) {
      groupEventHandlersRef.current = [
        ...groupEventHandlersRef.current,
        callback,
      ];
    }
  }, []);

  const removeGroupEventHandler = useCallback(
    (callback: (event: GroupEvent) => void) => {
      groupEventHandlersRef.current = groupEventHandlersRef.current.filter(
        (h) => h !== callback,
      );
    },
    [],
  );

  useEffect(() => {
    preventRetriesRef.current = false;
    return () => {
      preventRetriesRef.current = true;
      isReconnecting.current = false;
      if (socketRef.current) {
        const wsToClose = socketRef.current;
        socketRef.current = null;
        wsToClose.onclose = null;
        wsToClose.close(1000, "Component unmounting");
      }
    };
  }, []);

  // Disconnect WebSocket when app goes to background, reconnect on foreground
  useEffect(() => {
    const subscription = AppState.addEventListener(
      "change",
      (nextAppState: AppStateStatus) => {
        if (nextAppState === "background") {
          console.log("App backgrounded, disconnecting WebSocket");
          disconnect();
        } else if (
          appState.current.match(/inactive|background/) &&
          nextAppState === "active"
        ) {
          console.log("App foregrounded, reconnecting WebSocket");
          establishConnection().catch((err) =>
            console.error("Reconnection failed:", err),
          );
        }
        appState.current = nextAppState;
      },
    );

    return () => {
      subscription.remove();
    };
  }, [disconnect, establishConnection]);

  // Watchdog: periodically verify connection health and recover from silent disconnects
  useEffect(() => {
    const WATCHDOG_INTERVAL = 30_000;
    const intervalId = setInterval(() => {
      // Skip watchdog while app is backgrounded or after an explicit disconnect
      if (appState.current !== "active") return;
      if (preventRetriesRef.current) return;

      const socket = socketRef.current;
      if (connected && (!socket || socket.readyState !== WebSocket.OPEN)) {
        console.log(
          "Watchdog: connected state is stale, resetting and reconnecting",
        );
        setConnected(false);
        if (!isReconnecting.current) {
          establishConnection().catch((err) =>
            console.error("Watchdog reconnection failed:", err),
          );
        }
      } else if (!connected && !isReconnecting.current) {
        console.log("Watchdog: not connected, attempting reconnection");
        establishConnection().catch((err) =>
          console.error("Watchdog reconnection failed:", err),
        );
      }
    }, WATCHDOG_INTERVAL);

    return () => {
      clearInterval(intervalId);
    };
  }, [connected, establishConnection]);

  // Reconnect on network restoration (e.g. WiFi/cellular switch, airplane mode off)
  useEffect(() => {
    const wasConnectedRef = { current: true };
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const unsubscribe = NetInfo.addEventListener((state) => {
      const isNowConnected = !!state.isConnected;

      if (!wasConnectedRef.current && isNowConnected) {
        // Network restored — debounce to avoid flapping during rapid transitions
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          if (
            !connected &&
            !isReconnecting.current &&
            !preventRetriesRef.current
          ) {
            console.log("NetInfo: network restored, attempting reconnection");
            establishConnection().catch((err) =>
              console.error("NetInfo reconnection failed:", err),
            );
          }
        }, 1500);
      }

      wasConnectedRef.current = isNowConnected;
    });

    return () => {
      unsubscribe();
      if (debounceTimer) clearTimeout(debounceTimer);
    };
  }, [connected, establishConnection]);

  return (
    <WebSocketContext.Provider
      value={{
        sendMessage,
        connected,
        onMessage,
        removeMessageHandler,
        onGroupEvent,
        removeGroupEventHandler,
        establishConnection,
        disconnect,
        createGroup,
        updateGroup,
        leaveGroup,
        inviteUsersToGroup,
        removeUserFromGroup,
        getGroups,
        getUsers,
        toggleGroupMuted,
        blockUser,
        unblockUser,
        getBlockedUsers,
        createInviteLink,
        validateInvite,
        acceptInvite,
      }}
    >
      {children}
    </WebSocketContext.Provider>
  );
};

export const useWebSocket = () => {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error("useWebSocket must be used within a WebSocketProvider");
  }
  return context;
};
