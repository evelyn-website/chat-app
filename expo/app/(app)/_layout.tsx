import { ActivityIndicator, View, Platform, AppState, AppStateStatus } from "react-native";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Redirect, Tabs } from "expo-router";
import { useAuthUtils } from "@/components/context/AuthUtilsContext";
import { User, GroupEvent } from "@/types/types";
import { useWebSocket } from "@/components/context/WebSocketContext";
import { useGlobalStore } from "@/components/context/GlobalStoreContext";
import { CanceledError, isCancel } from "axios";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMessageStore } from "@/components/context/MessageStoreContext";

const AppLayout = () => {
  const { whoami } = useAuthUtils();
  const { getGroups, getUsers, connected: wsConnected, onGroupEvent, removeGroupEventHandler } = useWebSocket();
  const {
    store,
    deviceId,
    refreshGroups,
    refreshUsers,
    loadRelevantDeviceKeys,
  } = useGlobalStore();
  const { loadHistoricalMessages, removeGroupMessages } = useMessageStore();
  const [user, setUser] = useState<User | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    let isMounted = true;

    const initialize = async () => {
      try {
        setIsLoading(true);
        const { user: loggedInUser } = await whoami();
        if (isMounted) {
          setUser(loggedInUser);
        }
      } catch (err) {
        console.error("Error during app initialization: ", err);
        if (isMounted) {
          setUser(undefined);
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    initialize();

    return () => {
      isMounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isFetchingGroups = useRef(false);
  const fetchGroups = useCallback(async () => {
    if (isFetchingGroups.current || !user) return;
    isFetchingGroups.current = true;
    try {
      // Prune locally-expired groups before fetching
      const expiredIds = await store.deleteExpiredGroups();
      for (const groupId of expiredIds) {
        removeGroupMessages(groupId);
      }

      const data = await getGroups();
      await store.saveGroups(data);
      refreshGroups();
    } catch (error) {
      if (isCancel(error) || error instanceof CanceledError) {
        console.error("Failed to fetch/store groups:", error);
        await store.loadGroups();
      }
    } finally {
      isFetchingGroups.current = false;
    }
  }, [user, getGroups, store, refreshGroups, removeGroupMessages]);

  const isFetchingUsers = useRef(false);
  const fetchUsers = useCallback(async () => {
    if (isFetchingUsers.current || !user) return;
    isFetchingUsers.current = true;
    try {
      const data = await getUsers();
      await store.saveUsers(data);
      refreshUsers();
    } catch (error) {
      if (isCancel(error) || error instanceof CanceledError) {
        console.error("Failed to fetch/store users:", error);
        await store.loadUsers();
      }
    } finally {
      isFetchingUsers.current = false;
    }
  }, [user, getUsers, store, refreshUsers]);

  const isFetchingDeviceKeys = useRef(false);
  const fetchDeviceKeys = useCallback(async () => {
    if (isFetchingDeviceKeys.current || !user) return;
    isFetchingDeviceKeys.current = true;
    try {
      await loadRelevantDeviceKeys();
    } catch (error) {
      if (isCancel(error) || error instanceof CanceledError) {
        console.error(
          "AppLayout: Error explicitly calling fetchDeviceKeys:",
          error
        );
      }
    } finally {
      isFetchingDeviceKeys.current = false;
    }
  }, [user, loadRelevantDeviceKeys]);

  const handleGroupEvent = useCallback(async (event: GroupEvent) => {
    switch (event.event) {
      case "user_invited":
        fetchGroups();
        fetchDeviceKeys();
        break;
      case "user_removed":
        await store.deleteGroup(event.group_id);
        removeGroupMessages(event.group_id);
        refreshGroups();
        break;
      case "group_updated":
        fetchGroups();
        break;
      case "group_deleted":
        await store.deleteGroup(event.group_id);
        removeGroupMessages(event.group_id);
        refreshGroups();
        break;
    }
  }, [fetchGroups, fetchDeviceKeys, store, removeGroupMessages, refreshGroups]);

  useEffect(() => {
    if (user) {
      onGroupEvent(handleGroupEvent);
      return () => {
        removeGroupEventHandler(handleGroupEvent);
      };
    }
    return undefined;
  }, [user, onGroupEvent, removeGroupEventHandler, handleGroupEvent]);

  const POLL_INTERVAL = 60000;

  const groupsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const usersIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const deviceKeysIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearAllIntervals = useCallback(() => {
    if (groupsIntervalRef.current) {
      clearInterval(groupsIntervalRef.current);
      groupsIntervalRef.current = null;
    }
    if (usersIntervalRef.current) {
      clearInterval(usersIntervalRef.current);
      usersIntervalRef.current = null;
    }
    if (deviceKeysIntervalRef.current) {
      clearInterval(deviceKeysIntervalRef.current);
      deviceKeysIntervalRef.current = null;
    }
  }, []);

  const startIntervals = useCallback(() => {
    clearAllIntervals();
    groupsIntervalRef.current = setInterval(fetchGroups, POLL_INTERVAL);
    usersIntervalRef.current = setInterval(fetchUsers, POLL_INTERVAL);
    deviceKeysIntervalRef.current = setInterval(fetchDeviceKeys, POLL_INTERVAL);
  }, [clearAllIntervals, fetchGroups, fetchUsers, fetchDeviceKeys]);

  const runCatchUpSync = useCallback(() => {
    fetchGroups();
    fetchUsers();
    loadHistoricalMessages();
    fetchDeviceKeys();
  }, [fetchGroups, fetchUsers, loadHistoricalMessages, fetchDeviceKeys]);

  useEffect(() => {
    if (user && deviceId) {
      // Initial fetch on mount
      runCatchUpSync();
      startIntervals();

      const handleAppStateChange = (nextState: AppStateStatus) => {
        if (nextState === "active") {
          runCatchUpSync();
          startIntervals();
        } else {
          clearAllIntervals();
        }
      };

      const subscription = AppState.addEventListener("change", handleAppStateChange);

      return () => {
        clearAllIntervals();
        subscription.remove();
      };
    }
    return undefined;
  }, [user, deviceId, runCatchUpSync, startIntervals, clearAllIntervals]);

  // Catch up on missed messages when WebSocket reconnects (not initial connect)
  const prevWsConnected = useRef<boolean | null>(null);
  useEffect(() => {
    if (prevWsConnected.current === false && wsConnected && user && deviceId) {
      loadHistoricalMessages();
    }
    prevWsConnected.current = wsConnected;
  }, [wsConnected, user, deviceId, loadHistoricalMessages]);

  if (isLoading) {
    return (
      <View className="flex-1 justify-center items-center bg-gray-900">
        <ActivityIndicator size="large" color="#60A5FA" />
      </View>
    );
  }

  if (!isLoading && !user) {
    return <Redirect href={"/(auth)"} />;
  }

  const bottomPadding =
    Platform.OS === "ios"
      ? Math.max(insets.bottom, 16)
      : Platform.OS === "android"
        ? 16
        : 20; // web

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: "#1F2937", // gray-800
          borderTopColor: "#374151", // gray-700
          borderTopWidth: 1,
          height: 60 + bottomPadding,
          paddingBottom: bottomPadding,
          paddingTop: 8,
          elevation: 8,
          shadowColor: "#000",
          shadowOffset: { width: 0, height: -3 },
          shadowOpacity: 0.3,
          shadowRadius: 4,
        },
        tabBarActiveTintColor: "#60A5FA", // blue-400
        tabBarInactiveTintColor: "#9CA3AF", // gray-400
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: "500",
          marginTop: 2,
        },
        tabBarIconStyle: {
          marginBottom: -2,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarLabel: "Home",
          tabBarIcon: ({ focused, color }) => (
            <Ionicons
              size={22}
              name={focused ? "home" : "home-outline"}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="groups"
        options={{
          title: "Groups",
          tabBarLabel: "Groups",
          tabBarIcon: ({ focused, color }) => (
            <Ionicons
              size={22}
              name={focused ? "chatbubbles" : "chatbubbles-outline"}
              color={color}
            />
          ),
        }}
      />
    </Tabs>
  );
};

export default AppLayout;
