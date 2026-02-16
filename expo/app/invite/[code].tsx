import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useWebSocket } from "@/components/context/WebSocketContext";
import { useGlobalStore } from "@/components/context/GlobalStoreContext";
import type { InvitePreview } from "@/types/types";
import Button from "@/components/Global/Button/Button";
import { SafeAreaView } from "react-native-safe-area-context";

const PENDING_INVITE_KEY = "pendingInviteCode";

export default function InviteScreen() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const { validateInvite, acceptInvite } = useWebSocket();
  const { user, refreshGroups } = useGlobalStore();

  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!code) return;

    const fetchPreview = async () => {
      try {
        const data = await validateInvite(code);
        setPreview(data);
      } catch (err: unknown) {
        const status = (err as { response?: { status?: number } })?.response
          ?.status;
        if (status === 404) {
          setError("This invite link is invalid.");
        } else if (status === 410) {
          setError("This invite link has expired.");
        } else {
          setError("Could not load invite. Please try again.");
        }
      } finally {
        setLoading(false);
      }
    };

    // If not logged in, save code and redirect to auth
    if (!user) {
      AsyncStorage.setItem(PENDING_INVITE_KEY, code).then(() => {
        router.replace("/(auth)");
      });
      return;
    }

    fetchPreview();
  }, [code, user, validateInvite]);

  const handleJoin = useCallback(async () => {
    if (!code || joining) return;
    setJoining(true);
    try {
      await acceptInvite(code);
      refreshGroups();
      // Navigate to the group
      router.replace("/(app)");
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response
        ?.status;
      if (status === 403) {
        Alert.alert("Unable to Join", "You are unable to join this group.");
      } else if (status === 410) {
        Alert.alert("Expired", "This invite link has expired.");
      } else {
        Alert.alert("Error", "Could not join group. Please try again.");
      }
    } finally {
      setJoining(false);
    }
  }, [code, acceptInvite, refreshGroups, joining]);

  const formatDate = (dateString: string | null | undefined) => {
    if (!dateString) return null;
    const date = new Date(dateString);
    return date.toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  if (loading) {
    return (
      <SafeAreaView className="flex-1 bg-gray-950 justify-center items-center">
        <ActivityIndicator size="large" color="#3B82F6" />
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView className="flex-1 bg-gray-950 justify-center items-center px-6">
        <Text className="text-white text-lg text-center mb-4">{error}</Text>
        <Button
          text="Go Back"
          onPress={() => router.replace("/(app)")}
          variant="secondary"
          size="lg"
        />
      </SafeAreaView>
    );
  }

  if (!preview) return null;

  return (
    <SafeAreaView className="flex-1 bg-gray-950 justify-center items-center px-6">
      <View className="w-full bg-gray-900 rounded-2xl p-6 items-center">
        <Text className="text-2xl font-bold text-white mb-2">
          {preview.group_name}
        </Text>

        {preview.description && (
          <Text className="text-gray-400 text-center mb-3">
            {preview.description}
          </Text>
        )}

        <Text className="text-gray-500 mb-1">
          {preview.member_count}{" "}
          {preview.member_count === 1 ? "member" : "members"}
        </Text>

        {preview.start_time && (
          <Text className="text-gray-500 text-sm mb-1">
            Starts: {formatDate(preview.start_time)}
          </Text>
        )}
        {preview.end_time && (
          <Text className="text-gray-500 text-sm mb-4">
            Ends: {formatDate(preview.end_time)}
          </Text>
        )}

        <Button
          text={joining ? "Joining..." : "Join Group"}
          onPress={handleJoin}
          disabled={joining}
          variant="primary"
          size="lg"
          className="w-full mt-4"
        />

        <Button
          text="Cancel"
          onPress={() => router.replace("/(app)")}
          variant="secondary"
          size="sm"
          className="mt-3"
        />
      </View>
    </SafeAreaView>
  );
}
