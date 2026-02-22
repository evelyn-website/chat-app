import React from "react";
import { Switch, Text, View } from "react-native";

type NotificationsSectionProps = {
  isPushEnabled: boolean;
  isDisabled: boolean;
  onTogglePushNotifications: (nextValue: boolean) => void;
};

const panelClassName =
  "w-full rounded-2xl border border-white/10 bg-white/5 p-4 mb-3";
const sectionTitleClassName = "text-sm font-semibold text-blue-200 mb-3";

const NotificationsSection = ({
  isPushEnabled,
  isDisabled,
  onTogglePushNotifications,
}: NotificationsSectionProps) => {
  return (
    <View className={panelClassName}>
      <Text className={sectionTitleClassName}>Notifications</Text>
      <View className="flex-row justify-between items-center bg-black/20 rounded-xl p-3 border border-white/10">
        <View className="flex-1 pr-3">
          <Text className="text-sm text-zinc-100">Push Notifications</Text>
          <Text className="text-xs text-zinc-400 mt-1">
            Enable message alerts on this device.
          </Text>
        </View>
        <Switch
          value={isPushEnabled}
          onValueChange={onTogglePushNotifications}
          disabled={isDisabled}
          trackColor={{ false: "#4B5563", true: "#3B82F6" }}
          thumbColor={isPushEnabled ? "#FFFFFF" : "#9CA3AF"}
        />
      </View>
    </View>
  );
};

export default NotificationsSection;
