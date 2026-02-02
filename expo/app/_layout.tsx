import "react-native-get-random-values";
import { WebSocketProvider } from "@/components/context/WebSocketContext";
import { GlobalStoreProvider } from "@/components/context/GlobalStoreContext";
import { Stack } from "expo-router";
import { AuthUtilsProvider } from "@/components/context/AuthUtilsContext";
import { MessageStoreProvider } from "@/components/context/MessageStoreContext";
import { NotificationProvider } from "@/components/context/NotificationContext";

import "../styles/global.css";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ActionSheetProvider } from "@expo/react-native-action-sheet";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ActionSheetProvider>
        <GlobalStoreProvider>
          <WebSocketProvider>
            <MessageStoreProvider>
              <AuthUtilsProvider>
                <NotificationProvider>
                  <Stack>
                    <Stack.Screen
                      name="(auth)"
                      options={{ headerShown: false }}
                    />
                    <Stack.Screen name="(app)" options={{ headerShown: false }} />
                  </Stack>
                </NotificationProvider>
              </AuthUtilsProvider>
            </MessageStoreProvider>
          </WebSocketProvider>
        </GlobalStoreProvider>
      </ActionSheetProvider>
    </SafeAreaProvider>
  );
}
