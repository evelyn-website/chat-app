import React, { memo, useMemo } from "react";
import { View, Pressable, ActivityIndicator } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Blurhash } from "react-native-blurhash";
import { Image } from "expo-image";
import { useCachedImageClear } from "@/hooks/useCachedImage";

type Props = {
  imageURL: string | null;
  blurhash: string | null;
  isEditing: boolean;
  isAdmin: boolean;
  onPick: () => void;
  onRemove: () => void;
  isUploading?: boolean;
};

const GroupAvatarEditable = memo(function GroupAvatarEditable({
  imageURL,
  blurhash,
  isEditing,
  isAdmin,
  onPick,
  onRemove,
  isUploading = false,
}: Props) {
  const params = useMemo(() => ({ imageURL, blurhash }), [imageURL, blurhash]);
  const { localUri, isLoading, error } = useCachedImageClear(params);

  let content: React.ReactNode;
  if (isLoading || isUploading) {
    content = (
      <View className="items-center justify-center">
        <ActivityIndicator size="large" color="#60A5FA" />
      </View>
    );
  } else if (error) {
    content = (
      <View className="items-center justify-center">
        <Ionicons name="alert-circle-outline" size={44} color="#EF4444" />
      </View>
    );
  } else if (localUri) {
    content = (
      <>
        {blurhash && (
          <Blurhash
            blurhash={blurhash}
            className="absolute w-full h-full rounded-full"
            style={{
              position: "absolute",
              width: "100%",
              height: "100%",
              borderRadius: 60,
            }}
          />
        )}
        <Image
          source={{ uri: localUri }}
          className="w-full h-full rounded-full"
          style={{ width: "100%", height: "100%" }}
          contentFit="cover"
        />
      </>
    );
  } else {
    content = (
      <View className="items-center justify-center">
        <Ionicons name="image-outline" size={52} color="#9CA3AF" />
      </View>
    );
  }

  return (
    <View className="items-center my-4">
      <View className="relative w-36 h-36 overflow-visible">
        <Pressable
          onPress={
            isEditing && isAdmin && !imageURL && !isUploading
              ? onPick
              : undefined
          }
          disabled={!isEditing || !isAdmin || !!imageURL || isUploading}
          className={`
            w-36 h-36 rounded-full bg-white/5 border-2 items-center justify-center overflow-hidden
            ${isEditing && isAdmin ? "border-blue-400" : "border-white/20"}
          `}
        >
          {content}

          {isEditing && isAdmin && !imageURL && !isUploading && (
            <View className="absolute inset-0 bg-black/40 items-center justify-center rounded-full">
              <Ionicons name="camera" size={24} color="white" />
            </View>
          )}
        </Pressable>

        {isEditing && isAdmin && imageURL && !isUploading && (
          <Pressable
            onPress={onPick}
            className="absolute bottom-1 right-1 z-10"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <View className="w-9 h-9 rounded-full bg-blue-500 border-2 border-white/20 items-center justify-center">
              <Ionicons name="pencil" size={18} color="white" />
            </View>
          </Pressable>
        )}

        {isEditing && isAdmin && imageURL && !isUploading && (
          <Pressable
            onPress={onRemove}
            className="absolute top-1 right-1 z-10"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <View className="w-7 h-7 rounded-full bg-red-500 border-2 border-white/20 items-center justify-center">
              <Ionicons name="close" size={16} color="white" />
            </View>
          </Pressable>
        )}
      </View>
    </View>
  );
});

export default GroupAvatarEditable;
