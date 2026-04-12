import Button from "@/components/Global/Button/Button";
import Ionicons from "@expo/vector-icons/Ionicons";
import React from "react";
import { Text, View } from "react-native";

type LogoutSectionProps = {
  isLoggingOut: boolean;
  onLogout: () => void;
};

const LogoutSection = ({ isLoggingOut, onLogout }: LogoutSectionProps) => {
  return (
    <View className="w-full bg-red-950/15 rounded-2xl p-4 mt-1 mb-4 border border-red-400/25">
      <Text className="text-base font-semibold text-red-300 mb-1">Log Out</Text>
      <Text className="text-sm text-zinc-400 mb-3">
        End your current session on this device.
      </Text>
      <Button
        variant="outline"
        size="lg"
        className="w-full border-red-500/70 active:bg-red-500/10"
        textClassName="text-red-300"
        text={isLoggingOut ? "Logging out..." : "Log Out"}
        onPress={onLogout}
        disabled={isLoggingOut}
        leftIcon={<Ionicons name="log-out-outline" size={18} color="#fca5a5" />}
      />
    </View>
  );
};

export default LogoutSection;
