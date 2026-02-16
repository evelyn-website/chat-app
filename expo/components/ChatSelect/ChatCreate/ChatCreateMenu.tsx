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
        "Please provide a group name and set the event schedule."
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
        currentBlurhash
      );

      if (createdGroup) {
        if (usersToInvite.length > 0) {
          const result = await inviteUsersToGroup(usersToInvite, createdGroup.id);
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
          "Could not create the group. Please try again."
        );
      }
    } catch (error) {
      console.error("Error durlng group creation process:", error);
      Alert.alert(
        "Error",
        "An unexpected error occurred durlng group creation."
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
        "You've refused to allow this app to access your photos."
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
        console.error("ChatSettingsMenu:", error);
        Alert.alert(
          "Upload Failed",
          "Could not upload image. Please try again."
        );
      }
    }
  }, [uploadImage, tempGroupId, isUploading]);

  const handleRemoveImage = useCallback(() => {
    setCurrentImageUrlForPreview(null);
    setCurrentBlurhash(null);
  }, []);

  return (
    <View className="w-full">
      <View className="items-center my-4">
        <GroupAvatarEditable
          imageURL={currentImageUrlForPreview}
          blurhash={currentBlurhash}
          isEditing={true}
          isAdmin={true}
          onPick={handlePickImage}
          onRemove={handleRemoveImage}
        />
      </View>

      {/* Group Name Card */}
      <View className="w-full bg-gray-900 rounded-xl shadow-md p-4 mb-4">
        <Text className="text-lg font-semibold text-blue-400 mb-3">
          Group Name *
        </Text>
        <TextInput
          className="bg-gray-700 text-white border border-gray-600 rounded-lg px-4 py-3 w-full"
          onChangeText={setGroupName}
          value={groupName}
          placeholder="Enter group name"
          placeholderTextColor="#6B7280"
        />
      </View>

      {/* Event Schedule Card */}
      <View className="w-full bg-gray-900 rounded-xl shadow-md p-4 mb-4">
        <View className="flex-row justify-between items-center mb-3">
          <Text className="text-lg font-semibold text-blue-400">
            Event Schedule *
          </Text>
          <Button
            size="sm"
            onPress={() => setShowDateOptions(!showDateOptions)}
            text={showDateOptions ? "Hide" : "Edit"}
            variant="secondary"
          />
        </View>
        {!showDateOptions && (dateOptions.startTime || dateOptions.endTime) && (
          <View className="bg-gray-800 rounded-lg p-3 mb-2">
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
        {!showDateOptions && !dateOptions.startTime && !dateOptions.endTime && (
          <View className="bg-gray-800 rounded-lg p-3 mb-2">
            <Text className="text-base text-gray-400">No schedule set</Text>
          </View>
        )}
        {showDateOptions && (
          <GroupDateOptions
            dateOptions={dateOptions}
            setDateOptions={setDateOptions}
          />
        )}
      </View>

      {/* Optional Details Card */}
      <View className="w-full bg-gray-900 rounded-xl shadow-md p-4 mb-4">
        <Text className="text-lg font-semibold text-blue-400 mb-3">
          Optional Details
        </Text>
        <View className="mb-3">
          <Pressable
            onPress={() => setShowDescriptionInput(!showDescriptionInput)}
            className="flex-row justify-between items-center p-3 bg-gray-800 rounded-lg mb-2 active:bg-gray-700"
          >
            <Text className="text-base text-gray-300">Description</Text>
            <Text className="text-blue-400">
              {showDescriptionInput ? "Hide" : description ? "Edit" : "Add"}
            </Text>
          </Pressable>
          {showDescriptionInput && (
            <TextInput
              className="bg-gray-700 text-white border border-gray-600 rounded-lg px-4 py-3 w-full h-24"
              onChangeText={setDescription}
              value={description}
              placeholder="Add a description (optional)"
              placeholderTextColor="#6B7280"
              multiline
              textAlignVertical="top"
            />
          )}
          {!showDescriptionInput && description ? (
            <Text className="text-gray-400 px-3 py-1 text-sm italic">
              {description}
            </Text>
          ) : null}
        </View>
        <View>
          <Pressable
            onPress={() => setShowLocationInput(!showLocationInput)}
            className="flex-row justify-between items-center p-3 bg-gray-800 rounded-lg mb-2 active:bg-gray-700"
          >
            <Text className="text-base text-gray-300">Location</Text>
            <Text className="text-blue-400">
              {showLocationInput ? "Hide" : location ? "Edit" : "Add"}
            </Text>
          </Pressable>
          {showLocationInput && (
            <TextInput
              className="bg-gray-700 text-white border border-gray-600 rounded-lg px-4 py-3 w-full"
              onChangeText={setLocation}
              value={location}
              placeholder="Add a location (optional)"
              placeholderTextColor="#6B7280"
            />
          )}
          {!showLocationInput && location ? (
            <Text className="text-gray-400 px-3 py-1 text-sm italic">
              {location}
            </Text>
          ) : null}
        </View>
      </View>

      {/* User Invite Card */}
      <View className="w-full z-50 bg-gray-900 rounded-xl shadow-md p-4 mb-4 overflow-visible">
        <Text className="text-lg font-semibold text-blue-400 mb-3">
          Invite Friends
        </Text>
        <View className="z-40 bg-gray-800 rounded-lg p-3 overflow-visible">
          <UserInviteMultiselect
            placeholderText="Select friends to invite"
            userList={usersToInvite}
            setUserList={setUsersToInvite}
            excludedUserList={self ? [self] : []}
          />
        </View>
      </View>

      {/* Create Button */}
      <View className="z-10 mb-4">
        <Button
          variant="primary"
          size="lg"
          className="w-full"
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
