import React from "react";
import { Text, View } from "react-native";

type AppInfoSectionProps = {
  appName: string;
  appVersion: string;
};

const panelClassName =
  "w-full rounded-2xl border border-white/10 bg-white/5 p-4 mb-3";
const sectionTitleClassName = "text-sm font-semibold text-blue-200 mb-3";

const AppInfoSection = ({ appName, appVersion }: AppInfoSectionProps) => {
  return (
    <View className={panelClassName}>
      <Text className={sectionTitleClassName}>App Info</Text>
      <View className="bg-black/20 rounded-xl border border-white/10 p-3">
        <Text className="text-xs text-zinc-400 mb-1">Application</Text>
        <Text className="text-sm text-zinc-100 mb-3">{appName}</Text>
        <Text className="text-xs text-zinc-400 mb-1">Version</Text>
        <Text className="text-sm text-zinc-100">{appVersion}</Text>
      </View>
    </View>
  );
};

export default AppInfoSection;
