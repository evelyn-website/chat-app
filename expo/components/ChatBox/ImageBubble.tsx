import React, { useMemo, useRef } from "react";
import {
  View,
  Text,
  ActivityIndicator,
  Pressable,
  GestureResponderEvent,
  StyleProp,
  ViewStyle,
  Alert,
} from "react-native";
import Animated, {
  useAnimatedStyle,
  SharedValue,
  useDerivedValue,
  interpolate,
  Extrapolation,
} from "react-native-reanimated";
import { Image } from "expo-image";
import type { MessageUser, ImageMessageContent } from "@/types/types";
import { Ionicons } from "@expo/vector-icons";
import { useCachedImageEncrypted } from "../../hooks/useCachedImage";
import { Blurhash } from "react-native-blurhash";
import * as MediaLibrary from "expo-media-library";
import * as Clipboard from "expo-clipboard";
import * as FileSystem from "expo-file-system";
import ContextMenu from "react-native-context-menu-view";
import { useTimeFormat } from "../context/TimeFormatContext";

const MAX_TAP_DURATION = 250;
const MAX_TAP_DISTANCE = 10;

export interface ImageBubbleProps {
  prevUserId: string;
  user: MessageUser;
  content: ImageMessageContent;
  align: "left" | "right";
  timestamp: string;
  swipeX?: SharedValue<number>;
  showTimestamp?: boolean;
  onImagePress?: (uri: string) => void;
}

const ImageBubble: React.FC<ImageBubbleProps> = React.memo(
  ({
    prevUserId,
    user,
    content,
    align,
    timestamp,
    swipeX,
    showTimestamp = false,
    onImagePress,
  }) => {
    const { localUri, isLoading, error } = useCachedImageEncrypted(content);
    const { use24HourTime } = useTimeFormat();

    const gestureState = useRef({
      pressInTime: 0,
      pressInPosition: { x: 0, y: 0 },
    });

    const isOwn = align === "right";
    const formattedTime = React.useMemo(() => {
      const messageDate = new Date(timestamp);
      return messageDate.toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
        hour12: !use24HourTime,
      });
    }, [timestamp, use24HourTime]);

    const aspectRatio =
      content.width && content.height ? content.width / content.height : 16 / 9;

    const timestampOpacity = useDerivedValue(() => {
      if (!showTimestamp || !swipeX) return 0;
      const swipeValue = Math.abs(swipeX.value);
      return interpolate(swipeValue, [20, 60], [0, 1], Extrapolation.CLAMP);
    });

    const messageAnimatedStyle = useAnimatedStyle(() => {
      if (!swipeX) return {};
      if (isOwn) {
        return { transform: [{ translateX: swipeX.value }] };
      } else {
        const otherUserOffset = interpolate(
          swipeX.value,
          [-80, 0],
          [-20, 0],
          Extrapolation.CLAMP
        );
        return { transform: [{ translateX: otherUserOffset }] };
      }
    });

    const timestampAnimatedStyle = useAnimatedStyle(() => ({
      opacity: timestampOpacity.value,
    }));

    const handlePressIn = (event: GestureResponderEvent) => {
      gestureState.current.pressInTime = Date.now();
      gestureState.current.pressInPosition = {
        x: event.nativeEvent.pageX,
        y: event.nativeEvent.pageY,
      };
    };

    const handlePressOut = (event: GestureResponderEvent) => {
      const pressDuration = Date.now() - gestureState.current.pressInTime;

      const pressOutPosition = {
        x: event.nativeEvent.pageX,
        y: event.nativeEvent.pageY,
      };

      const distanceMoved = Math.sqrt(
        Math.pow(
          pressOutPosition.x - gestureState.current.pressInPosition.x,
          2
        ) +
          Math.pow(
            pressOutPosition.y - gestureState.current.pressInPosition.y,
            2
          )
      );
      if (
        pressDuration < MAX_TAP_DURATION &&
        distanceMoved < MAX_TAP_DISTANCE
      ) {
        if (onImagePress && localUri && !error) {
          onImagePress(localUri);
        }
      }
    };

    const menuActions = useMemo(() => {
      const actions = [];
      if (localUri) {
        actions.push({ title: "Copy Image", systemIcon: "doc.on.doc" });
        actions.push({ title: "Save Image", systemIcon: "arrow.down.circle" });
      }
      return actions;
    }, [localUri]);

    const handleContextMenuAction = async (e: {
      nativeEvent: { index: number };
    }) => {
      if (!localUri) return;
      switch (e.nativeEvent.index) {
        case 0: // "Copy Image"
          try {
            const base64 = await FileSystem.readAsStringAsync(localUri, {
              encoding: FileSystem.EncodingType.Base64,
            });
            await Clipboard.setImageAsync(base64);
          } catch (err) {
            Alert.alert("Error", "Could not copy image.");
            console.error("Failed to copy image:", err);
          }
          break;
        case 1: // "Save Image"
          try {
            const { status } = await MediaLibrary.requestPermissionsAsync();
            if (status !== "granted") {
              Alert.alert(
                "Permission Required",
                "We need permission to save photos."
              );
              return;
            }
            await MediaLibrary.saveToLibraryAsync(localUri);
            Alert.alert("Saved", "Image saved to your photo library.");
          } catch (err) {
            Alert.alert("Error", "Could not save image.");
            console.error("Failed to save image:", err);
          }
          break;
      }
    };

    const bubbleStyle: StyleProp<ViewStyle> = {
      overflow: "hidden",
      borderRadius: 16,
      ...(isOwn ? { borderTopRightRadius: 0 } : { borderTopLeftRadius: 0 }),
    };

    const renderImageContent = () => {
      if (isLoading) {
        return <ActivityIndicator size="large" color="gray" />;
      }
      if (error) {
        return (
          <View className="items-center justify-center p-2">
            <Ionicons name="alert-circle-outline" size={40} color="#f87171" />
            <Text className="text-red-400 mt-2 text-center text-xs">
              Could not load image
            </Text>
          </View>
        );
      }
      if (localUri) {
        return (
          <>
            {content.blurhash && (
              <Blurhash
                blurhash={content.blurhash}
                style={{ position: "absolute", width: "100%", height: "100%" }}
              />
            )}
            <Image
              source={{ uri: localUri }}
              style={{ width: "100%", height: "100%" }}
              contentFit="cover"
              transition={300}
            />
          </>
        );
      }
      if (isLoading && content.blurhash) {
        return (
          <Blurhash
            blurhash={content.blurhash}
            style={{ width: "100%", height: "100%" }}
          />
        );
      }
      return <Ionicons name="image-outline" size={48} color="gray" />;
    };

    return (
      <View className="mb-2 relative">
        <View className="flex-row items-end relative">
          <Animated.View
            style={[messageAnimatedStyle, { width: "100%" }]}
            className={`flex-row ${
              isOwn ? "justify-end pr-4" : "justify-start pl-4"
            }`}
          >
            <View
              className={`flex-col ${
                isOwn ? "items-end" : "items-start"
              } max-w-[80%] web:max-w-[60vw] md:web:max-w-[50vw]`}
            >
              {prevUserId !== user.id && (
                <Text
                  className={`text-xs mb-1 ${
                    isOwn
                      ? "text-blue-200 text-right"
                      : "text-gray-400 text-left"
                  }`}
                >
                  {user.username}
                </Text>
              )}
              <ContextMenu
                onPress={handleContextMenuAction}
                actions={menuActions}
                style={bubbleStyle}
                previewBackgroundColor="transparent"
                disabled={!localUri || !!error}
                borderRadius={16}
                borderTopRightRadius={isOwn ? 0 : 16}
                borderTopLeftRadius={isOwn ? 16 : 0}
                borderBottomLeftRadius={16}
                borderBottomRightRadius={16}
              >
                <Pressable
                  onPressIn={handlePressIn}
                  onPressOut={handlePressOut}
                  disabled={!localUri || !!error}
                >
                  <View
                    className="w-full bg-black/20 items-center justify-center"
                    style={[bubbleStyle, { aspectRatio }]}
                  >
                    {renderImageContent()}
                  </View>
                </Pressable>
              </ContextMenu>
            </View>
          </Animated.View>
          {showTimestamp && (
            <Animated.View
              style={[
                timestampAnimatedStyle,
                {
                  position: "absolute",
                  right: 8,
                  top: "50%",
                  transform: [{ translateY: -8 }],
                  alignItems: "flex-end",
                },
              ]}
            >
              <Text className="text-xs text-gray-500">{formattedTime}</Text>
            </Animated.View>
          )}
        </View>
      </View>
    );
  },
  (prevProps, nextProps) => {
    // Custom comparison to prevent re-renders when content changes but localUri stays the same
    return (
      prevProps.prevUserId === nextProps.prevUserId &&
      prevProps.user.id === nextProps.user.id &&
      prevProps.user.username === nextProps.user.username &&
      prevProps.align === nextProps.align &&
      prevProps.timestamp === nextProps.timestamp &&
      prevProps.showTimestamp === nextProps.showTimestamp &&
      // For content, compare the important fields that affect rendering
      prevProps.content.localUri === nextProps.content.localUri &&
      prevProps.content.blurhash === nextProps.content.blurhash &&
      prevProps.content.width === nextProps.content.width &&
      prevProps.content.height === nextProps.content.height
    );
  }
);

ImageBubble.displayName = "ImageBubble";

export default ImageBubble;
