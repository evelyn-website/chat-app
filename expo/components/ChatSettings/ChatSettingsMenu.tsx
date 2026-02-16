import {
  Text,
  View,
  TextInput,
  Alert,
  Linking,
  Platform,
  TouchableOpacity,
  Switch,
  Share,
  ActivityIndicator,
} from "react-native";
import React, { useCallback, useEffect, useState } from "react";
import type { Group, UpdateGroupParams, DateOptions } from "@/types/types";
import UserList from "./UserList";
import Button from "../Global/Button/Button";
import UserInviteMultiselect from "../Global/Multiselect/UserInviteMultiselect";
import { useGlobalStore } from "../context/GlobalStoreContext";
import { useMessageStore } from "../context/MessageStoreContext";
import { useWebSocket } from "../context/WebSocketContext";
import { router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import GroupDateOptions from "../Global/GroupDateOptions/GroupDateOptions";
import {
  launchImageLibraryAsync,
  requestMediaLibraryPermissionsAsync,
} from "expo-image-picker";
import { useUploadImageClear } from "@/hooks/useUploadImageClear";
import GroupAvatarEditable from "../GroupAvatarEditable";

const ChatSettingsMenu = (props: {
  group: Group;
  onUserKicked: (userId: string) => void;
}) => {
  const { group: initialGroup, onUserKicked } = props;
  const { store, refreshGroups } = useGlobalStore();
  const currentUserIsAdmin = initialGroup.admin;

  const {
    inviteUsersToGroup,
    updateGroup,
    getGroups,
    leaveGroup,
    toggleGroupMuted,
    createInviteLink,
  } = useWebSocket();
  const { removeGroupMessages } = useMessageStore();

  const [currentGroup, setCurrentGroup] = useState<Group>(initialGroup);

  const [isEditing, setIsEditing] = useState(false);
  const [editableName, setEditableName] = useState(initialGroup.name);
  const [editableDescription, setEditableDescription] = useState(
    initialGroup.description || "",
  );
  const [editableLocation, setEditableLocation] = useState(
    initialGroup.location || "",
  );
  const [currentImageUrlForPreview, setCurrentImageUrlForPreview] = useState<
    string | null
  >(initialGroup.image_url ?? null);
  const [currentBlurhash, setCurrentBlurhash] = useState<string | null>(
    initialGroup.blurhash ?? null,
  );

  const { uploadImage, isUploading } = useUploadImageClear();

  const parseDate = useCallback(
    (dateString: string | null | undefined): Date | null => {
      if (!dateString) return null;
      const timestamp = Date.parse(dateString);
      return isNaN(timestamp) ? null : new Date(timestamp);
    },
    [],
  );

  const [dateOptions, setDateOptions] = useState<DateOptions>({
    startTime: parseDate(currentGroup.start_time),
    endTime: parseDate(currentGroup.end_time),
  });

  const [usersToInvite, setUsersToInvite] = useState<string[]>([]);

  const [isMuted, setIsMuted] = useState(initialGroup.muted ?? false);
  const [isTogglingMute, setIsTogglingMute] = useState(false);
  const [isLoadingUpdate, setIsLoadingUpdate] = useState(false);
  const [isLoadingInvite, setIsLoadingInvite] = useState(false);
  const [isGeneratingLink, setIsGeneratingLink] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);

  useEffect(() => {
    setCurrentGroup(initialGroup);
    setIsMuted(initialGroup.muted ?? false);
    if (!isEditing) {
      setEditableName(initialGroup.name);
      setEditableDescription(initialGroup.description || "");
      setEditableLocation(initialGroup.location || "");
      setCurrentImageUrlForPreview(initialGroup.image_url || null);
      setCurrentBlurhash(initialGroup.blurhash || null);
      setDateOptions({
        startTime: parseDate(initialGroup.start_time),
        endTime: parseDate(initialGroup.end_time),
      });
    }
  }, [initialGroup, isEditing, parseDate]);

  const syncWithServerAndGlobalStore = async () => {
    if (isSyncing) {
      console.log("Sync already in progress, skipping");
      return;
    }

    setIsSyncing(true);
    try {
      const allGroups = await getGroups();
      await store.saveGroups(allGroups);

      const latestVersionOfCurrentGroup = allGroups.find(
        (g) => g.id === currentGroup.id,
      );

      if (latestVersionOfCurrentGroup) {
        setCurrentGroup(latestVersionOfCurrentGroup);
        refreshGroups();
      } else {
        console.warn(
          "Current group not found after sync, it might have been deleted.",
        );
        router.back();
      }
    } catch (error) {
      console.error("Failed to sync with server and global store:", error);
    } finally {
      setIsSyncing(false);
    }
  };

  const onKickSuccess = async (userId: string) => {
    await onUserKicked(userId);
    await syncWithServerAndGlobalStore();
  };

  const handleSaveChanges = async () => {
    setIsLoadingUpdate(true);
    const payload: UpdateGroupParams = {};
    let hasChanges = false;

    if (initialGroup.image_url !== currentImageUrlForPreview) {
      payload.image_url = currentImageUrlForPreview;
      payload.blurhash = currentBlurhash;
      hasChanges = true;
    }

    if (
      editableName.trim() !== currentGroup.name &&
      editableName.trim() !== ""
    ) {
      payload.name = editableName.trim();
      hasChanges = true;
    }
    if (editableDescription !== (currentGroup.description || "")) {
      payload.description = editableDescription;
      hasChanges = true;
    }
    if (editableLocation !== (currentGroup.location || "")) {
      payload.location = editableLocation;
      hasChanges = true;
    }
    const groupStartTime = parseDate(currentGroup.start_time);
    const groupEndTime = parseDate(currentGroup.end_time);
    if (
      dateOptions.startTime?.toISOString() !== groupStartTime?.toISOString() &&
      dateOptions.startTime !== null
    ) {
      payload.start_time = dateOptions.startTime.toISOString();
      hasChanges = true;
    }
    if (
      dateOptions.endTime?.toISOString() !== groupEndTime?.toISOString() &&
      dateOptions.endTime !== null
    ) {
      payload.end_time = dateOptions.endTime.toISOString();
      hasChanges = true;
    }
    if (hasChanges) {
      try {
        const updatedGroupData = await updateGroup(currentGroup.id, payload);
        if (updatedGroupData) {
          const optimisticallyUpdatedGroup = {
            ...currentGroup,
            ...payload,
            start_time: payload.start_time || currentGroup.start_time,
            end_time: payload.end_time || currentGroup.end_time,
          };
          setCurrentGroup(optimisticallyUpdatedGroup as Group);
          await syncWithServerAndGlobalStore();
        } else {
          Alert.alert("Update Failed", "Could not save changes.");
        }
      } catch (error) {
        console.error("Error saving changes", error);
      }
    }
    setIsLoadingUpdate(false);
    setIsEditing(false);
  };

  const handleInviteUsers = async () => {
    if (usersToInvite.length === 0) return;
    setIsLoadingInvite(true);
    try {
      const result = await inviteUsersToGroup(usersToInvite, currentGroup.id);

      setUsersToInvite([]);
      await syncWithServerAndGlobalStore();

      if (result.skipped_users && result.skipped_users.length > 0) {
        Alert.alert(
          "Some Users Not Invited",
          `The following users could not be invited at this time: ${result.skipped_users.join(", ")}`,
        );
      }
    } catch (error) {
      console.error("Error inviting users:", error);
      Alert.alert("Invite Failed", "Could not invite users. Please try again.");
    } finally {
      setIsLoadingInvite(false);
    }
  };

  const handleShareInviteLink = useCallback(async () => {
    if (isGeneratingLink) return;
    setIsGeneratingLink(true);
    try {
      const result = await createInviteLink(currentGroup.id);
      await Share.share({
        message: `Join ${currentGroup.name} on the app! ${result.invite_url}`,
      });
    } catch (error) {
      console.error("Error sharing invite link:", error);
      Alert.alert("Error", "Could not generate invite link. Please try again.");
    } finally {
      setIsGeneratingLink(false);
    }
  }, [currentGroup.id, currentGroup.name, createInviteLink, isGeneratingLink]);

  const handlePickImage = useCallback(async () => {
    if (isUploading) {
      console.log("Upload already in progress, ignoring additional requests");
      return;
    }

    const permissionResult = await requestMediaLibraryPermissionsAsync();
    if (permissionResult.granted === false) {
      Alert.alert(
        "Permission Required",
        "You've refused to allow this app to access your photos.",
      );
      return;
    }

    const result = await launchImageLibraryAsync({
      mediaTypes: "images",
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });

    if (!result.canceled && result.assets && result.assets.length > 0) {
      const imageAsset = result.assets[0];
      try {
        const uploadResult = await uploadImage(imageAsset, currentGroup.id);
        if (!uploadResult) {
          throw new Error("Error uploading image");
        }

        const { imageURL, blurhash } = uploadResult;
        setCurrentBlurhash(blurhash);
        setCurrentImageUrlForPreview(imageURL);
      } catch (error) {
        console.error("ChatSettingsMenu:", error);
        Alert.alert(
          "Upload Failed",
          "Could not upload image. Please try again.",
        );
      }
    }
  }, [uploadImage, currentGroup.id, isUploading]);

  const handleToggleMute = async () => {
    if (isTogglingMute) return;
    setIsTogglingMute(true);
    try {
      const result = await toggleGroupMuted(currentGroup.id);
      if (result !== undefined) {
        setIsMuted(result.muted);
        await syncWithServerAndGlobalStore();
      } else {
        Alert.alert("Error", "Could not toggle mute. Please try again.");
      }
    } catch (error) {
      console.error("Error toggling mute:", error);
      Alert.alert("Error", "Could not toggle mute. Please try again.");
    } finally {
      setIsTogglingMute(false);
    }
  };

  const handleRemoveImage = useCallback(() => {
    setCurrentImageUrlForPreview("");
    setCurrentBlurhash("");
  }, []);

  const handleLeaveGroup = useCallback(() => {
    Alert.alert(
      "Leave Group?",
      "You will no longer be able to see messages or participate in this group. You can rejoin if someone invites you again.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Leave",
          style: "destructive",
          onPress: async () => {
            if (isLeaving) return;
            setIsLeaving(true);
            try {
              await leaveGroup(currentGroup.id);
              const allGroups = await getGroups();
              await store.saveGroups(allGroups);
              removeGroupMessages(currentGroup.id);
              refreshGroups();
              router.back();
            } catch (error) {
              console.error("Error leaving group:", error);
              Alert.alert(
                "Leave Failed",
                "Could not leave the group. Please try again."
              );
            } finally {
              setIsLeaving(false);
            }
          },
        },
      ]
    );
  }, [
    currentGroup.id,
    isLeaving,
    leaveGroup,
    getGroups,
    store,
    removeGroupMessages,
    refreshGroups,
  ]);

  const formatDate = (date: Date | null) => {
    if (!date) return "Not set";
    return date.toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const renderEditableField = (
    label: string,
    value: string,
    setter: (text: string) => void,
    placeholder: string,
    multiline = false,
    required = false,
  ) => (
    <View className="mb-3">
      <Text className="text-sm text-gray-400 mb-1">
        {label}
        {required && " *"}
      </Text>
      <TextInput
        className={`bg-gray-700 text-white border border-gray-600 rounded-lg px-4 py-3 w-full ${
          multiline ? "h-24" : ""
        }`}
        value={value}
        onChangeText={setter}
        placeholder={placeholder}
        placeholderTextColor="#6B7280"
        multiline={multiline}
        textAlignVertical={multiline ? "top" : "auto"}
      />
    </View>
  );

  const renderDisplayField = (
    label: string,
    value: string | null | undefined,
  ) => (
    <View className="mb-3">
      <Text className="text-sm text-gray-400 mb-1">{label}</Text>
      <Text className="text-base text-gray-200">
        {value || <Text className="italic text-gray-500">Not set</Text>}
      </Text>
    </View>
  );

  return (
    <View className={"w-full pb-4"}>
      <View className="items-center my-4">
        <GroupAvatarEditable
          imageURL={currentImageUrlForPreview}
          blurhash={currentBlurhash}
          isEditing={isEditing}
          isAdmin={currentUserIsAdmin}
          onPick={handlePickImage}
          onRemove={handleRemoveImage}
        />
      </View>

      {/* Admin Edit Controls */}
      {currentUserIsAdmin && (
        <View className="flex-row justify-end mb-4 px-4">
          {isEditing ? (
            <>
              <Button
                text="Cancel"
                onPress={() => setIsEditing(false)}
                size="sm"
                variant="secondary"
                className="mr-2"
              />
              <Button
                text={isLoadingUpdate ? "Saving..." : "Save Changes"}
                onPress={handleSaveChanges}
                disabled={isLoadingUpdate}
                size="sm"
                variant="primary"
              />
            </>
          ) : (
            <Button
              text="Edit Group"
              onPress={() => setIsEditing(true)}
              size="sm"
              variant="primary"
              leftIcon={<Ionicons name="pencil" size={16} color="white" />}
            />
          )}
        </View>
      )}

      {/* Group Details Card */}
      <View className="w-full bg-gray-900 rounded-xl shadow-md p-4 mb-4">
        <Text className="text-lg font-semibold text-blue-400 mb-3">
          Group Details
        </Text>
        {isEditing && currentUserIsAdmin
          ? renderEditableField(
              "Group Name",
              editableName,
              setEditableName,
              "Enter group name",
              false,
              true,
            )
          : renderDisplayField("Group Name", currentGroup.name)}

        {isEditing && currentUserIsAdmin
          ? renderEditableField(
              "Description",
              editableDescription,
              setEditableDescription,
              "Enter description (optional)",
              true,
            )
          : renderDisplayField("Description", currentGroup.description)}

        {isEditing && currentUserIsAdmin ? (
          renderEditableField(
            "Location",
            editableLocation,
            setEditableLocation,
            "Enter location (optional)",
          )
        ) : (
          <View className="mb-3">
            <Text className="text-sm text-gray-400 mb-1">Location</Text>
            {currentGroup.location ? (
              <TouchableOpacity
                onPress={() => {
                  const url =
                    Platform.OS === "ios"
                      ? `https://maps.apple.com/?q=${encodeURIComponent(currentGroup.location!)}`
                      : `https://maps.google.com/?q=${encodeURIComponent(currentGroup.location!)}`;
                  Linking.openURL(url);
                }}
                className="flex-row items-center"
              >
                <Ionicons
                  name="location-outline"
                  size={16}
                  color="#60A5FA"
                  className="mr-1"
                />
                <Text className="text-base text-blue-400">
                  {currentGroup.location}
                </Text>
              </TouchableOpacity>
            ) : (
              <Text className="text-base text-gray-200">
                <Text className="italic text-gray-500">Not set</Text>
              </Text>
            )}
          </View>
        )}
      </View>

      {/* Event Schedule Card */}
      <View className="w-full bg-gray-900 rounded-xl shadow-md p-4 mb-4">
        <View className="flex-row justify-between items-center mb-3">
          <Text className="text-lg font-semibold text-blue-400">
            Event Schedule{isEditing && currentUserIsAdmin ? " *" : ""}
          </Text>
        </View>
        {isEditing && currentUserIsAdmin ? (
          <GroupDateOptions
            dateOptions={dateOptions}
            setDateOptions={setDateOptions}
          />
        ) : (
          <View className="bg-gray-800 rounded-lg p-3">
            <View className="mb-1">
              <Text className="text-sm text-gray-400 mb-1">Starts:</Text>
              <Text className="text-base font-medium text-gray-200">
                {formatDate(dateOptions.startTime)}
              </Text>
            </View>
            <View>
              <Text className="text-sm text-gray-400 mb-1">Ends:</Text>
              <Text className="text-base font-medium text-gray-200">
                {formatDate(dateOptions.endTime)}
              </Text>
            </View>
          </View>
        )}
      </View>

      {/* Notification Settings Card */}
      <View className="w-full bg-gray-900 rounded-xl shadow-md p-4 mb-4">
        <Text className="text-lg font-semibold text-blue-400 mb-3">
          Notifications
        </Text>
        <View className="flex-row justify-between items-center bg-gray-800 rounded-lg p-3">
          <Text className="text-base text-gray-200">Mute Notifications</Text>
          <Switch
            value={isMuted}
            onValueChange={handleToggleMute}
            disabled={isTogglingMute}
            trackColor={{ false: "#4B5563", true: "#3B82F6" }}
            thumbColor={isMuted ? "#FFFFFF" : "#9CA3AF"}
          />
        </View>
      </View>

      {/* Group Members Card */}
      <View className="w-full bg-gray-900 rounded-xl shadow-md p-4 mb-4">
        <Text className="text-lg font-semibold text-blue-400 mb-3">
          {/* *** Use currentGroup for member count *** */}
          {currentGroup.group_users.length}{" "}
          {currentGroup.group_users.length === 1 ? "Member" : "Members"}
        </Text>
        <View className="bg-gray-800 rounded-lg p-1">
          <UserList
            group={currentGroup}
            currentUserIsAdmin={currentUserIsAdmin}
            onUserKicked={onKickSuccess}
          />
        </View>
      </View>

      {/* Share Invite Link Card */}
      {currentUserIsAdmin && (
        <View className="w-full bg-gray-900 rounded-xl shadow-md p-4 mb-4">
          <Text className="text-lg font-semibold text-blue-400 mb-3">
            Share Invite Link
          </Text>
          <Button
            variant="primary"
            size="lg"
            className="w-full"
            text={isGeneratingLink ? "Generating..." : "Share Invite Link"}
            onPress={handleShareInviteLink}
            disabled={isGeneratingLink}
            leftIcon={
              isGeneratingLink ? (
                <ActivityIndicator size="small" color="white" />
              ) : (
                <Ionicons name="link-outline" size={18} color="white" />
              )
            }
          />
        </View>
      )}

      {/* User Invite Card */}
      {currentUserIsAdmin && (
        <View className="w-full z-30 bg-gray-900 rounded-xl shadow-md p-4 mb-4 overflow-visible">
          <Text className="text-lg font-semibold text-blue-400 mb-3">
            Invite Friends
          </Text>
          <View className="z-20 bg-gray-800 rounded-lg p-3 overflow-visible">
            <UserInviteMultiselect
              placeholderText="Select friends to invite"
              userList={usersToInvite}
              setUserList={setUsersToInvite}
              excludedUserList={currentGroup.group_users}
            />
          </View>
          {usersToInvite.length > 0 && (
            <View className="mt-3">
              <Button
                variant="primary"
                size="lg"
                className="w-full bg-green-600"
                text={isLoadingInvite ? "Inviting..." : "Add New Users"}
                onPress={handleInviteUsers}
                disabled={isLoadingInvite}
              />
            </View>
          )}
        </View>
      )}

      {/* Leave Group - visible to all members */}
      <View className="w-full bg-gray-900 rounded-xl shadow-md p-4 mb-4">
        <Text className="text-lg font-semibold text-blue-400 mb-3">
          Leave Group
        </Text>
        <Button
          variant="secondary"
          size="lg"
          className="w-full bg-red-900/80 active:bg-red-800"
          text={isLeaving ? "Leaving..." : "Leave Group"}
          onPress={handleLeaveGroup}
          disabled={isLeaving}
        />
      </View>
    </View>
  );
};

export default ChatSettingsMenu;
