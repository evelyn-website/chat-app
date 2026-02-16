import React, { memo } from "react";
import { View, Text, ActivityIndicator, StyleSheet } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Blurhash } from "react-native-blurhash";
import { Image } from "expo-image";
import { useCachedImageClear } from "@/hooks/useCachedImage";

type Props = {
  imageURL: string | null;
  blurhash: string | null;
  name: string | null | undefined;
};

const GroupAvatarSmall = memo(function GroupAvatarSmall({
  imageURL,
  blurhash,
  name,
}: Props) {
  const { localUri, isLoading, error } = useCachedImageClear({
    imageURL,
    blurhash,
  });

  let content;
  if (isLoading) {
    content = <ActivityIndicator size="small" color="#60A5FA" />;
  } else if (error) {
    content = (
      <Ionicons name="alert-circle-outline" size={12} color="#EF4444" />
    );
  } else if (localUri) {
    content = (
      <>
        {blurhash && (
          <Blurhash blurhash={blurhash} style={styles.absoluteFill} />
        )}
        <Image
          source={{ uri: localUri }}
          contentFit="cover"
          style={styles.absoluteFill}
        />
      </>
    );
  } else {
    const initial = name ? name.charAt(0).toUpperCase() : "?";
    content = (
      <Text className="text-gray-100 text-sm font-bold">
        {initial}
      </Text>
    );
  }

  return <View style={styles.container}>{content}</View>;
});

export default GroupAvatarSmall;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  absoluteFill: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 999,
  },
});
