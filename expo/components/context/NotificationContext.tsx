import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useCallback,
  useState,
} from "react";
import { AppState, AppStateStatus } from "react-native";
import { router } from "expo-router";
import * as Notifications from "expo-notifications";
import {
  registerForPushNotificationsAsync,
  sendPushTokenToServer,
  clearPushTokenOnServer,
  addNotificationReceivedListener,
  addNotificationResponseReceivedListener,
} from "@/services/notificationService";
import { useGlobalStore } from "./GlobalStoreContext";

interface NotificationContextType {
  expoPushToken: string | null;
  registerPushNotifications: () => Promise<void>;
  clearPushNotifications: () => Promise<void>;
}

const NotificationContext = createContext<NotificationContextType | undefined>(
  undefined
);

export const NotificationProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { user, deviceId } = useGlobalStore();
  const [expoPushToken, setExpoPushToken] = useState<string | null>(null);
  const notificationListener = useRef<Notifications.EventSubscription>();
  const responseListener = useRef<Notifications.EventSubscription>();
  const appState = useRef(AppState.currentState);

  const registerPushNotifications = useCallback(async () => {
    if (!user || !deviceId) {
      return;
    }

    try {
      const token = await registerForPushNotificationsAsync();
      if (token) {
        setExpoPushToken(token);
        await sendPushTokenToServer(token, deviceId);
      }
    } catch (error) {
      console.error("Error registering push notifications:", error);
    }
  }, [user, deviceId]);

  const clearPushNotifications = useCallback(async () => {
    if (!deviceId) {
      return;
    }

    try {
      await clearPushTokenOnServer(deviceId);
      setExpoPushToken(null);
    } catch (error) {
      console.error("Error clearing push notifications:", error);
    }
  }, [deviceId]);

  // Register for push notifications when user logs in
  useEffect(() => {
    if (user && deviceId) {
      registerPushNotifications();
    }
  }, [user, deviceId, registerPushNotifications]);

  // Re-register on app foreground (tokens can change/expire)
  useEffect(() => {
    const subscription = AppState.addEventListener(
      "change",
      (nextAppState: AppStateStatus) => {
        if (
          appState.current.match(/inactive|background/) &&
          nextAppState === "active"
        ) {
          // App has come to the foreground
          if (user && deviceId) {
            registerPushNotifications();
          }
        }
        appState.current = nextAppState;
      }
    );

    return () => {
      subscription.remove();
    };
  }, [user, deviceId, registerPushNotifications]);

  // Handle incoming notifications
  useEffect(() => {
    // Handle notifications received while app is in foreground
    notificationListener.current = addNotificationReceivedListener(
      (notification) => {
        console.log("Notification received in foreground:", notification);
      }
    );

    // Handle notification taps (when user interacts with notification)
    responseListener.current = addNotificationResponseReceivedListener(
      (response) => {
        const data = response.notification.request.content.data;
        const groupId = data?.groupId as string | undefined;

        if (groupId) {
          // Navigate to the group chat
          router.push({
            pathname: "/(app)/groups/[id]",
            params: { id: groupId },
          });
        }
      }
    );

    return () => {
      if (notificationListener.current) {
        notificationListener.current.remove();
      }
      if (responseListener.current) {
        responseListener.current.remove();
      }
    };
  }, []);

  return (
    <NotificationContext.Provider
      value={{
        expoPushToken,
        registerPushNotifications,
        clearPushNotifications,
      }}
    >
      {children}
    </NotificationContext.Provider>
  );
};

export const useNotifications = () => {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error(
      "useNotifications must be used within a NotificationProvider"
    );
  }
  return context;
};
