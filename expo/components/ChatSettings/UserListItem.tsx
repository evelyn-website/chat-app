import { Pressable, Text, View, Alert } from "react-native";
import React, { useState } from "react";
import { Group, GroupUser } from "@/types/types";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useWebSocket } from "../context/WebSocketContext";
import { useGlobalStore } from "../context/GlobalStoreContext";

type UserListItemProps = {
  user: GroupUser;
  group: Group;
  index: number;
  currentUserIsAdmin?: boolean;
  onKickSuccess: (userId: string) => void;
  onKickFailure?: (userId: string) => void;
};

const UserListItem = (props: UserListItemProps) => {
  const {
    user,
    group,
    index,
    currentUserIsAdmin,
    onKickSuccess,
    onKickFailure,
  } = props;

  const [isKicking, setIsKicking] = useState(false);

  const { removeUserFromGroup, blockUser } = useWebSocket();
  const { user: self } = useGlobalStore();

  const isTargetUserAdmin = user.admin;
  const isSelf = self?.id === user.id;

  const canKickUser = currentUserIsAdmin && !isTargetUserAdmin && !isSelf;
  const canBlock = !isSelf && !isTargetUserAdmin;

  const handleLongPress = () => {
    if (!canBlock) return;

    Alert.alert(
      "Block User",
      `Block ${user.username}? They will be removed from all shared groups and neither of you will be able to add each other to groups.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Block",
          style: "destructive",
          onPress: async () => {
            try {
              await blockUser(user.id);
              onKickSuccess(user.id);
            } catch (error) {
              console.error("Failed to block user:", error);
              Alert.alert(
                "Error",
                `Failed to block ${user.username}. Please try again.`
              );
            }
          },
        },
      ]
    );
  };

  const handleKickUser = () => {
    if (isKicking) return;

    Alert.alert(
      "Confirm Kick",
      `Are you sure you want to remove ${user.username} from "${group.name}"?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Kick",
          style: "destructive",
          onPress: async () => {
            setIsKicking(true);
            try {
              await removeUserFromGroup(user.email, group.id);
              onKickSuccess(user.id);
            } catch (error) {
              console.error("Failed to remove user:", error);
              Alert.alert(
                "Error",
                `Failed to remove ${user.username}. Please try again.`
              );
              if (onKickFailure) {
                onKickFailure(user.id);
              }
            } finally {
              setIsKicking(false);
            }
          },
        },
      ]
    );
  };

  return (
    <Pressable
      onLongPress={canBlock ? handleLongPress : undefined}
      className={`${index !== 0 ? "border-t border-gray-700" : ""} w-full`}
    >
      <View className="flex-row items-center px-4 py-3">
        <View className="flex-1">
          <View className="flex-row items-center">
            <Text
              numberOfLines={1}
              className={`font-medium text-base ${
                isTargetUserAdmin ? "text-blue-400" : "text-gray-200"
              }`}
            >
              {user.username}
            </Text>
            {isTargetUserAdmin && (
              <View className="ml-2 px-2 py-0.5 bg-blue-900/30 rounded-full">
                <Text className="text-xs text-blue-400">Admin</Text>
              </View>
            )}
            {isSelf && (
              <View className="ml-2 px-2 py-0.5 bg-gray-700 rounded-full">
                <Text className="text-xs text-gray-400">You</Text>
              </View>
            )}
          </View>
          <Text
            numberOfLines={1}
            ellipsizeMode="tail"
            className="text-sm text-gray-400"
          >
            {user.email}
          </Text>
        </View>

        {canKickUser && (
          <Pressable
            testID={`kick-button-${user.username}`}
            disabled={isKicking}
            className={`w-8 h-8 rounded-full items-center justify-center active:bg-gray-700 ${
              isKicking ? "opacity-50" : ""
            }`}
            onPress={handleKickUser}
          >
            {({ pressed }) => (
              <Ionicons
                color={pressed || isKicking ? "#6B7280" : "#9CA3AF"}
                name={"close-circle-outline"}
                size={22}
              />
            )}
          </Pressable>
        )}
      </View>
    </Pressable>
  );
};

export default UserListItem;
