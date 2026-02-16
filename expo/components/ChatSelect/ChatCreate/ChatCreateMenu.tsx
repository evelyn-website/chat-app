import { DateOptions } from "@/types/types";
import { useCallback, useState } from "react";
import { Text, TextInput, View, Pressable, Alert } from "react-native";
import { useWebSocket } from "../../context/WebSocketContext";
import { router } from "expo-router";
import { useGlobalStore } from "../../context/GlobalStoreContext";
import UserInviteMultiselect from "../../Global/Multiselect/UserInviteMultiselect";
import Button from "@/components/Global/Button/Button";
import GroupDateOptions from "@/components/Global/GroupDateOptions/GroupDateOptions";
import { v4 as uuidv4 } from "uuid";
import { useUploadImageClear } from "@/hooks/useUploadImageClear";
import {
  requestMediaLibraryPermissionsAsync,
  launchImageLibraryAsync,
} from "expo-image-picker";
import GroupAvatarEditable from "@/components/GroupAvatarEditable";
import Ionicons from "@expo/vector-icons/Ionicons";

export const ChatCreateMenu = ({ onSubmit }: { onSubmit: () => void }) => {
  const [tempGroupId] = useState(() => uuidv4());
  const { user: self, store, refreshGroups } = useGlobalStore();
  const [groupName, setGroupName] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [location, setLocation] = useState<string>("");
  const [currentImageUrlForPreview, setCurrentImageUrlForPreview] = useState<
    string | null
  >(null);
  const [currentBlurhash, setCurrentBlurhash] = useState<string | null>(null);

  const { uploadImage, isUploading } = useUploadImageClear();

  const [usersToInvite, setUsersToInvite] = useState<string[]>([]);
  const [dateOptions, setDateOptions] = useState<DateOptions>({
    startTime: null,
    endTime: null,
  });

  const { createGroup, inviteUsersToGroup, getGroups } = useWebSocket();
  const [isLoading, setIsLoading] = useState(false);
  const [showDateOptions, setShowDateOptions] = useState(false);
  const [showDescriptionInput, setShowDescriptionInput] = useState(false);
  const [showLocationInput, setShowLocationInput] = useState(false);

  const fetchAndRefreshGroups = async () => {
    try {
      const updatedGroups = await getGroups();
      await store.saveGroups(updatedGroups);
      refreshGroups();
    } catch (error) {
      console.error("Failed to fetch and refresh groups:", error);
    }
  };

  const handleCreateGroup = async () => {
    if (!groupName.trim() || !dateOptions.startTime || !dateOptions.endTime) {
      Alert.alert(
        "Missing Information",
        "Please provide a group name and set the event schedule.",
      );
      return;
    }

    setIsLoading(true);

    try {
      const createdGroup = await createGroup(
        tempGroupId,
        groupName,
        dateOptions.startTime,
        dateOptions.endTime,
        description,
        location,
        currentImageUrlForPreview,
        currentBlurhash,
      );

      if (createdGroup) {
        if (usersToInvite.length > 0) {
          const result = await inviteUsersToGroup(
            usersToInvite,
            createdGroup.id,
          );
          if (result.skipped_users && result.skipped_users.length > 0) {
            Alert.alert(
              "Some Users Not Invited",
              `The following users could not be invited at this time: ${result.skipped_users.join(", ")}`,
            );
          }
        }

        await fetchAndRefreshGroups();

        setGroupName("");
        setDescription("");
        setLocation("");
        setUsersToInvite([]);
        setDateOptions({ startTime: null, endTime: null });

        onSubmit();
        router.push(`/groups/${createdGroup.id}`);
      } else {
        console.error("Group creation returned undefined.");
        Alert.alert(
          "Creation Failed",
          "Could not create the group. Please try again.",
        );
      }
    } catch (error) {
      console.error("Error during group creation process:", error);
      Alert.alert(
        "Error",
        "An unexpected error occurred during group creation.",
      );
    } finally {
      setIsLoading(false);
    }
  };

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
        const uploadResult = await uploadImage(imageAsset, tempGroupId, true);
        if (!uploadResult) {
          throw new Error("Error uploading image");
        }

        const { imageURL, blurhash } = uploadResult;
        setCurrentBlurhash(blurhash);
        setCurrentImageUrlForPreview(imageURL);
      } catch (error) {
        console.error("ChatCreateMenu:", error);
        Alert.alert(
          "Upload Failed",
          "Could not upload image. Please try again.",
        );
      }
    }
  }, [uploadImage, tempGroupId, isUploading]);

  const handleRemoveImage = useCallback(() => {
    setCurrentImageUrlForPreview(null);
    setCurrentBlurhash(null);
  }, []);

  const panelClassName =
    "w-full rounded-2xl border border-white/10 bg-white/5 p-4";
  const sectionTitleClassName = "text-sm font-semibold text-blue-200 mb-3";
  const inputClassName =
    "bg-black/20 text-white border border-white/10 rounded-xl px-4 py-3 w-full";

  return (
    <View className="w-full pb-4">
      <View className="items-center mt-2 mb-4">
        <GroupAvatarEditable
          imageURL={currentImageUrlForPreview}
          blurhash={currentBlurhash}
          isEditing={true}
          isAdmin={true}
          onPick={handlePickImage}
          onRemove={handleRemoveImage}
        />
      </View>

      <View className={panelClassName}>
        <View className="pb-4 mb-4 border-b border-white/10">
          <Text className={sectionTitleClassName}>Group Name *</Text>
          <TextInput
            className={inputClassName}
            onChangeText={setGroupName}
            value={groupName}
            placeholder="Enter group name"
            placeholderTextColor="#9CA3AF"
          />
        </View>

        <View className="pb-4 mb-4 border-b border-white/10">
          <View className="flex-row justify-between items-center mb-3">
            <Text className={sectionTitleClassName}>Event Schedule *</Text>
            <Button
              size="sm"
              onPress={() => setShowDateOptions(!showDateOptions)}
              text={showDateOptions ? "Hide" : "Edit"}
              variant="ghost"
              className="px-2 py-1 rounded-lg"
              textClassName="text-blue-200"
            />
          </View>
          {!showDateOptions &&
            (dateOptions.startTime || dateOptions.endTime) && (
              <View className="bg-black/20 rounded-xl p-3 mb-2 border border-white/10">
                <View className="mb-2 flex-row items-start">
                  <Ionicons
                    name="play-circle-outline"
                    size={18}
                    color="#bfdbfe"
                    style={{ marginTop: 2, marginRight: 8 }}
                  />
                  <View className="flex-1">
                    <Text className="text-xs text-zinc-300 mb-1">Starts</Text>
                    <Text className="text-sm font-medium text-zinc-100">
                      {formatDate(dateOptions.startTime)}
                    </Text>
                  </View>
                </View>
                <View className="flex-row items-start">
                  <Ionicons
                    name="stop-circle-outline"
                    size={18}
                    color="#bfdbfe"
                    style={{ marginTop: 2, marginRight: 8 }}
                  />
                  <View className="flex-1">
                    <Text className="text-xs text-zinc-300 mb-1">Ends</Text>
                    <Text className="text-sm font-medium text-zinc-100">
                      {formatDate(dateOptions.endTime)}
                    </Text>
                  </View>
                </View>
              </View>
            )}
          {!showDateOptions &&
            !dateOptions.startTime &&
            !dateOptions.endTime && (
              <View className="bg-black/20 rounded-xl p-3 mb-2 border border-white/10">
                <Text className="text-sm text-zinc-300">No schedule set</Text>
              </View>
            )}
          {showDateOptions && (
            <GroupDateOptions
              dateOptions={dateOptions}
              setDateOptions={setDateOptions}
            />
          )}
        </View>

        <View className="pb-4 mb-4 border-b border-white/10">
          <View className="mb-3">
            <Pressable
              onPress={() => setShowDescriptionInput(!showDescriptionInput)}
              className="flex-row justify-between items-center p-3 bg-black/20 rounded-xl mb-2 border border-white/10 active:bg-black/30"
            >
              <View className="flex-row items-center">
                <Ionicons
                  name="document-text-outline"
                  size={16}
                  color="#a1a1aa"
                />
                <Text className="text-sm text-zinc-200 ml-2">
                  Description (optional)
                </Text>
              </View>
              <Text className="text-blue-200 text-sm">
                {showDescriptionInput ? "Hide" : description ? "Edit" : "Add"}
              </Text>
            </Pressable>
            {showDescriptionInput && (
              <TextInput
                className={`${inputClassName} h-24`}
                onChangeText={setDescription}
                value={description}
                placeholder="Add a description"
                placeholderTextColor="#9CA3AF"
                multiline
                textAlignVertical="top"
              />
            )}
            {!showDescriptionInput && description ? (
              <Text className="text-zinc-400 px-3 py-1 text-sm italic">
                {description}
              </Text>
            ) : null}
          </View>
          <View>
            <Pressable
              onPress={() => setShowLocationInput(!showLocationInput)}
              className="flex-row justify-between items-center p-3 bg-black/20 rounded-xl mb-2 border border-white/10 active:bg-black/30"
            >
              <View className="flex-row items-center">
                <Ionicons name="location-outline" size={16} color="#a1a1aa" />
                <Text className="text-sm text-zinc-200 ml-2">
                  Location (optional)
                </Text>
              </View>
              <Text className="text-blue-200 text-sm">
                {showLocationInput ? "Hide" : location ? "Edit" : "Add"}
              </Text>
            </Pressable>
            {showLocationInput && (
              <TextInput
                className={inputClassName}
                onChangeText={setLocation}
                value={location}
                placeholder="Add a location"
                placeholderTextColor="#9CA3AF"
              />
            )}
            {!showLocationInput && location ? (
              <Text className="text-zinc-400 px-3 py-1 text-sm italic">
                {location}
              </Text>
            ) : null}
          </View>
        </View>

        <View className="z-50 overflow-visible pt-1">
          <Text className={sectionTitleClassName}>
            Invite Friends
            {usersToInvite.length > 0
              ? ` (${usersToInvite.length} selected)`
              : " (optional)"}
          </Text>
          <Text className="text-xs text-zinc-400 mb-2">
            Invite now or skip and add people later.
          </Text>
          <View className="z-40 rounded-xl overflow-visible">
            <UserInviteMultiselect
              placeholderText="Select friends to invite"
              userList={usersToInvite}
              setUserList={setUsersToInvite}
              excludedUserList={self ? [self] : []}
            />
          </View>
        </View>
      </View>

      {/* Create Button */}
      <View className="z-10 mt-5 mb-4">
        <Button
          variant="primary"
          size="lg"
          className="w-full rounded-xl"
          text={isLoading ? "Creating..." : "Create Group"}
          onPress={handleCreateGroup}
          disabled={
            isLoading ||
            !groupName.trim() ||
            !dateOptions.startTime ||
            !dateOptions.endTime
          }
        />
      </View>
    </View>
  );
};
