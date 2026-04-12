import React from "react";
import { Text, View } from "react-native";

type AccountSectionProps = {
  username?: string;
  email?: string;
  deviceId?: string;
};

const panelClassName =
  "w-full rounded-2xl border border-white/10 bg-white/5 p-4 mb-3";
const sectionTitleClassName = "text-sm font-semibold text-blue-200 mb-3";

const AccountSection = ({ username, email, deviceId }: AccountSectionProps) => {
  return (
    <View className={panelClassName}>
      <Text className={sectionTitleClassName}>Account</Text>
      <View className="bg-black/20 rounded-xl border border-white/10 p-3">
        <View className="mb-3">
          <Text className="text-xs text-zinc-400 mb-1">Username</Text>
          <Text className="text-sm text-zinc-100">{username ?? "Unknown"}</Text>
        </View>
        <View className="mb-3">
          <Text className="text-xs text-zinc-400 mb-1">Email</Text>
          <Text className="text-sm text-zinc-100">{email ?? "Unknown"}</Text>
        </View>
        <View>
          <Text className="text-xs text-zinc-400 mb-1">Device ID</Text>
          <Text className="text-xs text-zinc-300">{deviceId ?? "Loading..."}</Text>
        </View>
      </View>
    </View>
  );
};

export default AccountSection;
