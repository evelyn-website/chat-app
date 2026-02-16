import React, { useState, useRef } from "react";
import {
  Pressable,
  View,
  TextInput,
  ActivityIndicator,
  Text,
  Alert,
} from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import * as ImagePicker from "expo-image-picker";

import { useGlobalStore } from "../context/GlobalStoreContext";
import { Group } from "@/types/types";
import { useSendMessage } from "@/hooks/useSendMessage";
import { useSendImage } from "@/hooks/useSendImage";

const MessageEntry = ({
  group,
  recipientUserIds,
}: {
  group: Group;
  recipientUserIds: string[];
}) => {
  const { user } = useGlobalStore();
  const { sendMessage, isSending, sendError } = useSendMessage();
  const { sendImage, isSendingImage, imageSendError } = useSendImage();

  const [textContent, setTextContent] = useState<string>("");
  const textInputRef = useRef<TextInput>(null);
  const isBusy = isSending || isSendingImage;
  const sendChainRef = useRef<Promise<void>>(Promise.resolve());

  const handleSubmitText = async () => {
    const trimmedContent = textContent.trim();
    if (!trimmedContent || !user) {
      if (!trimmedContent && user) {
        setTextContent("");
      }
      return;
    }

    const contentToSend = trimmedContent;
    setTextContent("");

    // Chain sends to preserve order without blocking the UI
    sendChainRef.current = sendChainRef.current
      .then(async () => {
        try {
          await sendMessage(contentToSend, group.id, recipientUserIds);
        } catch (error) {
          console.error("MessageEntry: Error sending text message:", error);
        }
      })
      .catch(() => {
        // Swallow to keep the chain alive
      });
  };

  const handleAttachImage = async () => {
    const permissionResult =
      await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (permissionResult.granted === false) {
      Alert.alert(
        "Permission Required",
        "You've refused to allow this app to access your photos."
      );
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: "images",
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.8,
    });

    if (!result.canceled && result.assets && result.assets.length > 0) {
      const imageAsset = result.assets[0];
      try {
        await sendImage(imageAsset, group.id, recipientUserIds);
      } catch (error) {
        console.error("MessageEntry: Error sending image:", error);
      }
    }
  };

  // DEV ONLY: Send burst of messages for testing
  const handleSendBurst = async () => {
    if (!user) return;
    const count = 40;
    const startTime = Date.now();
    console.log(`🚀 [BURST] Starting burst of ${count} messages`);

    // Fire all messages in parallel (bypasses the send chain)
    const promises = [];
    for (let i = 1; i <= count; i++) {
      const messageNum = i;

      const promise = sendMessage(`Test message ${messageNum}`, group.id, recipientUserIds)
        .catch((error) => {
          console.error(`❌ [BURST] Error sending message ${messageNum}:`, error);
        });

      promises.push(promise);

      // Small stagger to prevent exact simultaneous sends
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    // Wait for all to complete
    await Promise.all(promises);
    const totalTime = Date.now() - startTime;
    console.log(`✅ [BURST] Completed ${count} messages in ${totalTime}ms`);
  };

  return (
    <View>
      <View className="flex-row items-center px-3 py-2">
        {/* DEV ONLY: Burst test button */}
        {__DEV__ && (
          <Pressable
            onPress={handleSendBurst}
            disabled={isBusy}
            className="p-2 mr-1"
          >
            <Text className="text-xs text-blue-400 font-bold">BURST</Text>
          </Pressable>
        )}

        <Pressable
          onPress={handleAttachImage}
          disabled={isBusy}
          className="p-2 mr-2"
        >
          {isSendingImage ? (
            <ActivityIndicator size="small" color="#9CA3AF" />
          ) : (
            <Ionicons
              name="add"
              size={24}
              color={isBusy ? "#4B5563" : "#9CA3AF"}
            />
          )}
        </Pressable>

        <View className="flex-1 flex-row items-center bg-gray-800 rounded-full border border-gray-700 px-4">
          <TextInput
            ref={textInputRef}
            autoCorrect
            spellCheck
            keyboardType="default"
            className="flex-1 text-gray-200 px-0 outline-0"
            style={{
              height: 40,
              fontSize: 16,
              lineHeight: 20,
              paddingTop: 0,
              paddingBottom: 0,
              paddingVertical: 0,
            }}
            value={textContent}
            onChangeText={setTextContent}
            placeholder="Type a message..."
            placeholderTextColor="#9CA3AF"
            blurOnSubmit={false}
            returnKeyType="send"
            onSubmitEditing={handleSubmitText}
          />
          <Pressable
            onPress={handleSubmitText}
            disabled={!textContent.trim()}
            className="ml-2"
          >
            {isSending ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Ionicons
                name="send"
                size={24}
                color={!textContent.trim() || isBusy ? "#4B5563" : "#FFFFFF"}
              />
            )}
          </Pressable>
        </View>
      </View>
      {(sendError || imageSendError) && (
        <Text
          style={{
            color: "red",
            paddingHorizontal: 15,
            paddingBottom: 5,
            fontSize: 12,
          }}
        >
          Error: {sendError || imageSendError}
        </Text>
      )}
    </View>
  );
};

export default MessageEntry;
