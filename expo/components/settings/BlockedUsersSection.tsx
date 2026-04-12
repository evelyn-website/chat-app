import Button from "@/components/Global/Button/Button";
import type { BlockedUser } from "@/types/types";
import Ionicons from "@expo/vector-icons/Ionicons";
import React from "react";
import { ActivityIndicator, Text, View } from "react-native";

type BlockedUsersSectionProps = {
  blockedUsers: BlockedUser[];
  isLoading: boolean;
  error: string | null;
  unblockingUserId: string | null;
  onRetry: () => void;
  onUnblockUser: (user: BlockedUser) => void;
  formatBlockedDate: (dateString: string) => string;
};

const panelClassName =
  "w-full rounded-2xl border border-white/10 bg-white/5 p-4 mb-3";
const sectionTitleClassName = "text-sm font-semibold text-blue-200 mb-3";

const BlockedUsersSection = ({
  blockedUsers,
  isLoading,
  error,
  unblockingUserId,
  onRetry,
  onUnblockUser,
  formatBlockedDate,
}: BlockedUsersSectionProps) => {
  return (
    <View className={panelClassName}>
      <Text className={sectionTitleClassName}>Blocked Users</Text>
      <Text className="text-xs text-zinc-400 mb-3">
        People you block are removed from shared groups and cannot be invited
        with you.
      </Text>

      {isLoading ? (
        <View className="py-6 items-center justify-center">
          <ActivityIndicator size="small" color="#93c5fd" />
          <Text className="text-zinc-400 text-sm mt-2">
            Loading blocked users...
          </Text>
        </View>
      ) : error ? (
        <View className="bg-black/20 rounded-xl p-3 border border-white/10">
          <Text className="text-sm text-red-300 mb-3">{error}</Text>
          <Button
            text="Retry"
            onPress={onRetry}
            variant="outline"
            size="sm"
            className="self-start"
          />
        </View>
      ) : blockedUsers.length === 0 ? (
        <View className="bg-black/20 rounded-xl p-3 border border-white/10">
          <Text className="text-sm text-zinc-300">No blocked users.</Text>
        </View>
      ) : (
        <View className="bg-black/20 rounded-xl border border-white/10 overflow-hidden">
          {blockedUsers.map((blockedUser, index) => {
            const isUnblocking = unblockingUserId === blockedUser.id;
            return (
              <View
                key={blockedUser.id}
                className={`p-3 ${index !== 0 ? "border-t border-white/10" : ""}`}
              >
                <View className="flex-row items-center justify-between">
                  <View className="flex-1 pr-3">
                    <View className="flex-row items-center">
                      <Ionicons name="ban-outline" size={14} color="#fca5a5" />
                      <Text
                        className="text-zinc-100 font-medium ml-2"
                        numberOfLines={1}
                      >
                        {blockedUser.username}
                      </Text>
                    </View>
                    <Text
                      className="text-xs text-zinc-400 mt-1"
                      numberOfLines={1}
                    >
                      {blockedUser.email}
                    </Text>
                    <Text className="text-xs text-zinc-500 mt-1">
                      Blocked {formatBlockedDate(blockedUser.blocked_at)}
                    </Text>
                  </View>
                  <Button
                    text={isUnblocking ? "..." : "Unblock"}
                    onPress={() => onUnblockUser(blockedUser)}
                    size="sm"
                    variant="ghost"
                    className="px-3"
                    textClassName="text-blue-200"
                    disabled={Boolean(unblockingUserId)}
                  />
                </View>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
};

export default BlockedUsersSection;
