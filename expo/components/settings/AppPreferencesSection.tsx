import Button from "@/components/Global/Button/Button";
import Ionicons from "@expo/vector-icons/Ionicons";
import React from "react";
import { Switch, Text, View } from "react-native";

type AppPreferencesSectionProps = {
  use24HourTime: boolean;
  isRefreshingData: boolean;
  onToggle24HourTime: (nextValue: boolean) => void;
  onRefreshData: () => void;
};

const panelClassName =
  "w-full rounded-2xl border border-white/10 bg-white/5 p-4 mb-3";
const sectionTitleClassName = "text-sm font-semibold text-blue-200 mb-3";

const AppPreferencesSection = ({
  use24HourTime,
  isRefreshingData,
  onToggle24HourTime,
  onRefreshData,
}: AppPreferencesSectionProps) => {
  return (
    <View className={panelClassName}>
      <Text className={sectionTitleClassName}>App Preferences</Text>
      <View className="bg-black/20 rounded-xl border border-white/10 overflow-hidden">
        <View className="flex-row justify-between items-center p-3">
          <View className="flex-1 pr-3">
            <Text className="text-sm text-zinc-100">Use 24-hour time</Text>
            <Text className="text-xs text-zinc-400 mt-1">
              Apply a 24-hour clock where supported.
            </Text>
          </View>
          <Switch
            value={use24HourTime}
            onValueChange={onToggle24HourTime}
            trackColor={{ false: "#4B5563", true: "#3B82F6" }}
            thumbColor={use24HourTime ? "#FFFFFF" : "#9CA3AF"}
          />
        </View>
        <View className="border-t border-white/10 p-3">
          <Button
            text={isRefreshingData ? "Refreshing..." : "Refresh App Data"}
            onPress={onRefreshData}
            variant="outline"
            size="sm"
            className="self-start"
            disabled={isRefreshingData}
            leftIcon={
              <Ionicons name="refresh-outline" size={16} color="#60a5fa" />
            }
          />
        </View>
      </View>
    </View>
  );
};

export default AppPreferencesSection;
