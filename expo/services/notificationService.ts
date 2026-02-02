import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import { Platform } from "react-native";
import http from "@/util/custom-axios";
import Constants from "expo-constants";

const API_BASE_URL = `${process.env.EXPO_PUBLIC_HOST}/api`;

// Configure how notifications are handled when app is in foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function registerForPushNotificationsAsync(): Promise<
  string | null
> {
  // Push notifications only work on physical devices
  if (!Device.isDevice) {
    console.log("Push notifications require a physical device");
    return null;
  }

  // Check/request permissions
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== "granted") {
    console.log("Push notification permission not granted");
    return null;
  }

  // Get Expo push token
  try {
    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    if (!projectId) {
      console.error("No EAS project ID found");
      return null;
    }

    const tokenResponse = await Notifications.getExpoPushTokenAsync({
      projectId,
    });
    const token = tokenResponse.data;
    console.log("Expo push token:", token);

    // Configure Android channel
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "default",
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: "#FF231F7C",
      });
    }

    return token;
  } catch (error) {
    console.error("Error getting push token:", error);
    return null;
  }
}

export async function sendPushTokenToServer(
  token: string,
  deviceIdentifier: string
): Promise<boolean> {
  try {
    await http.post(`${API_BASE_URL}/notifications/register-token`, {
      deviceIdentifier,
      expoPushToken: token,
    });
    console.log("Push token registered with server");
    return true;
  } catch (error) {
    console.error("Error registering push token with server:", error);
    return false;
  }
}

export async function clearPushTokenOnServer(
  deviceIdentifier: string
): Promise<boolean> {
  try {
    await http.delete(`${API_BASE_URL}/notifications/token`, {
      data: { deviceIdentifier },
    });
    console.log("Push token cleared from server");
    return true;
  } catch (error) {
    console.error("Error clearing push token from server:", error);
    return false;
  }
}

// Helper to add notification listeners
export function addNotificationReceivedListener(
  callback: (notification: Notifications.Notification) => void
) {
  return Notifications.addNotificationReceivedListener(callback);
}

export function addNotificationResponseReceivedListener(
  callback: (response: Notifications.NotificationResponse) => void
) {
  return Notifications.addNotificationResponseReceivedListener(callback);
}
