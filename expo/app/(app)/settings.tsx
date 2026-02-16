import { useAuthUtils } from "@/components/context/AuthUtilsContext";
import { useGlobalStore } from "@/components/context/GlobalStoreContext";
import { useTimeFormat } from "@/components/context/TimeFormatContext";
import { useWebSocket } from "@/components/context/WebSocketContext";
import AccountSection from "@/components/settings/AccountSection";
import AppInfoSection from "@/components/settings/AppInfoSection";
import AppPreferencesSection from "@/components/settings/AppPreferencesSection";
import BlockedUsersSection from "@/components/settings/BlockedUsersSection";
import LogoutSection from "@/components/settings/LogoutSection";
import NotificationsSection from "@/components/settings/NotificationsSection";
import {
  clearPushTokenOnServer,
  registerForPushNotificationsAsync,
  sendPushTokenToServer,
} from "@/services/notificationService";
import type { BlockedUser } from "@/types/types";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const SETTINGS_PUSH_ENABLED_KEY = "settings_push_enabled";

export default function SettingsScreen() {
  const { logout } = useAuthUtils();
  const { use24HourTime, setUse24HourTime, isLoading: isTimeFormatLoading } =
    useTimeFormat();
  const { user, deviceId, store, refreshGroups, refreshUsers } = useGlobalStore();
  const { getBlockedUsers, unblockUser, getGroups, getUsers } = useWebSocket();
  const insets = useSafeAreaInsets();

  const [blockedUsers, setBlockedUsers] = useState<BlockedUser[]>([]);
  const [isLoadingBlockedUsers, setIsLoadingBlockedUsers] = useState(true);
  const [blockedUsersError, setBlockedUsersError] = useState<string | null>(
    null,
  );
  const [unblockingUserId, setUnblockingUserId] = useState<string | null>(null);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [isPushEnabled, setIsPushEnabled] = useState(false);
  const [isUpdatingPush, setIsUpdatingPush] = useState(false);
  const [isPushSettingLoading, setIsPushSettingLoading] = useState(true);
  const [isRefreshingData, setIsRefreshingData] = useState(false);

  const appVersion = Constants.expoConfig?.version ?? "Unknown";
  const appName = Constants.expoConfig?.name ?? "Chat App";

  useEffect(() => {
    const loadPreferences = async () => {
      try {
        const pushPref = await AsyncStorage.getItem(SETTINGS_PUSH_ENABLED_KEY);
        setIsPushEnabled(pushPref === "true");
      } catch (error) {
        console.error("Failed to load settings preferences:", error);
      } finally {
        setIsPushSettingLoading(false);
      }
    };
    loadPreferences();
  }, []);

  const fetchBlockedUsers = useCallback(
    async (showLoading = true) => {
      if (showLoading) {
        setIsLoadingBlockedUsers(true);
      }
      setBlockedUsersError(null);
      try {
        const users = await getBlockedUsers();
        setBlockedUsers(users);
      } catch (error) {
        console.error("Failed to load blocked users:", error);
        setBlockedUsersError("Could not load blocked users. Please try again.");
      } finally {
        if (showLoading) {
          setIsLoadingBlockedUsers(false);
        }
      }
    },
    [getBlockedUsers],
  );

  useEffect(() => {
    fetchBlockedUsers();
  }, [fetchBlockedUsers]);

  const formatBlockedDate = useCallback((dateString: string) => {
    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) {
      return "Unknown date";
    }
    return date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }, []);

  const sortedBlockedUsers = useMemo(
    () =>
      [...blockedUsers].sort((a, b) => {
        return (
          new Date(b.blocked_at).getTime() - new Date(a.blocked_at).getTime()
        );
      }),
    [blockedUsers],
  );

  const handleUnblockUser = useCallback(
    (blockedUser: BlockedUser) => {
      if (unblockingUserId) return;

      Alert.alert(
        "Unblock User",
        `Unblock ${blockedUser.username}? You can be added to groups together again.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Unblock",
            onPress: async () => {
              setUnblockingUserId(blockedUser.id);
              try {
                await unblockUser(blockedUser.id);
                setBlockedUsers((prev) =>
                  prev.filter((item) => item.id !== blockedUser.id),
                );
                await fetchBlockedUsers(false);
              } catch (error) {
                console.error("Failed to unblock user:", error);
                Alert.alert(
                  "Unblock Failed",
                  `Could not unblock ${blockedUser.username}. Please try again.`,
                );
              } finally {
                setUnblockingUserId(null);
              }
            },
          },
        ],
      );
    },
    [fetchBlockedUsers, unblockUser, unblockingUserId],
  );

  const handleTogglePushNotifications = useCallback(
    async (nextValue: boolean) => {
      if (isUpdatingPush || isPushSettingLoading) return;
      if (!deviceId) {
        Alert.alert(
          "Device Not Ready",
          "Please wait for app initialization and try again.",
        );
        return;
      }

      setIsUpdatingPush(true);
      try {
        if (nextValue) {
          const token = await registerForPushNotificationsAsync();
          if (!token) {
            Alert.alert(
              "Permission Required",
              "Push notifications are unavailable until permission is granted.",
            );
            return;
          }
          const registered = await sendPushTokenToServer(token, deviceId);
          if (!registered) {
            Alert.alert(
              "Enable Failed",
              "Could not enable push notifications. Please try again.",
            );
            return;
          }
          setIsPushEnabled(true);
          await AsyncStorage.setItem(SETTINGS_PUSH_ENABLED_KEY, "true");
        } else {
          const cleared = await clearPushTokenOnServer(deviceId);
          if (!cleared) {
            Alert.alert(
              "Disable Failed",
              "Could not disable push notifications. Please try again.",
            );
            return;
          }
          setIsPushEnabled(false);
          await AsyncStorage.setItem(SETTINGS_PUSH_ENABLED_KEY, "false");
        }
      } catch (error) {
        console.error("Failed to update push notifications setting:", error);
        Alert.alert(
          "Update Failed",
          "Could not update notification settings right now.",
        );
      } finally {
        setIsUpdatingPush(false);
      }
    },
    [deviceId, isPushSettingLoading, isUpdatingPush],
  );

  const handleToggle24HourTime = useCallback(
    async (nextValue: boolean) => {
      await setUse24HourTime(nextValue);
    },
    [setUse24HourTime],
  );

  const handleRefreshData = useCallback(async () => {
    if (isRefreshingData) return;
    setIsRefreshingData(true);
    try {
      const [groups, users] = await Promise.all([getGroups(), getUsers()]);
      await Promise.all([store.saveGroups(groups), store.saveUsers(users)]);
      refreshGroups();
      refreshUsers();
      Alert.alert("Synced", "Latest groups and users have been refreshed.");
    } catch (error) {
      console.error("Failed to refresh app data:", error);
      Alert.alert(
        "Sync Failed",
        "Could not refresh app data right now. Please try again.",
      );
    } finally {
      setIsRefreshingData(false);
    }
  }, [getGroups, getUsers, isRefreshingData, refreshGroups, refreshUsers, store]);

  const handleLogout = useCallback(() => {
    if (isLoggingOut) return;

    Alert.alert(
      "Log Out?",
      "You will need to sign in again to access your chats.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Log Out",
          style: "destructive",
          onPress: async () => {
            setIsLoggingOut(true);
            try {
              await logout();
            } finally {
              setIsLoggingOut(false);
            }
          },
        },
      ],
    );
  }, [isLoggingOut, logout]);

  return (
    <View className="flex-1 bg-gray-900" style={{ paddingTop: insets.top }}>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
      >
        <View className="pt-2 pb-4">
          <Text className="text-2xl font-bold text-zinc-100">Settings</Text>
          <Text className="text-sm text-zinc-400 mt-1">
            Manage your account and safety preferences.
          </Text>
        </View>

        <AccountSection
          username={user?.username}
          email={user?.email}
          deviceId={deviceId}
        />

        <NotificationsSection
          isPushEnabled={isPushEnabled}
          isDisabled={isUpdatingPush || isPushSettingLoading}
          onTogglePushNotifications={handleTogglePushNotifications}
        />

        <BlockedUsersSection
          blockedUsers={sortedBlockedUsers}
          isLoading={isLoadingBlockedUsers}
          error={blockedUsersError}
          unblockingUserId={unblockingUserId}
          onRetry={() => fetchBlockedUsers()}
          onUnblockUser={handleUnblockUser}
          formatBlockedDate={formatBlockedDate}
        />

        <AppPreferencesSection
          use24HourTime={use24HourTime}
          isRefreshingData={isRefreshingData}
          onToggle24HourTime={handleToggle24HourTime}
          onRefreshData={handleRefreshData}
          isTimeFormatLoading={isTimeFormatLoading}
        />

        <AppInfoSection appName={appName} appVersion={appVersion} />

        <LogoutSection isLoggingOut={isLoggingOut} onLogout={handleLogout} />
      </ScrollView>
    </View>
  );
}
