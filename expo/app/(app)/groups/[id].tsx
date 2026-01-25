import "react-native-get-random-values";
import ChatBox from "@/components/ChatBox/ChatBox";
import { useGlobalStore } from "@/components/context/GlobalStoreContext";
import { Group } from "@/types/types";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useState, useEffect, useMemo, useRef } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { validate } from "uuid";

const GroupPage = () => {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user, store, groupsRefreshKey, refreshGroups } = useGlobalStore();

  const [allGroups, setAllGroups] = useState<Group[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const markedAsReadRef = useRef<string | null>(null);

  useEffect(() => {
    if (!store || !id) {
      if (!id && user) {
        router.replace("/groups");
      }
      return;
    }

    if (!validate(id)) {
      setAllGroups(null);
      setIsLoading(false);
      return;
    }

    let isMounted = true;
    setIsLoading(true);

    store
      .loadGroups()
      .then((groups) => {
        if (isMounted) {
          setAllGroups(groups ?? []);
        }
      })
      .catch((error) => {
        console.error("GroupPage: Error loading groups:", error);
        if (isMounted) setAllGroups([]);
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [id, store, groupsRefreshKey, user]);

  const currentGroup = useMemo(() => {
    if (!id || !allGroups) return undefined;
    return allGroups.find((g) => g.id.toString() === id) || null;
  }, [id, allGroups]);

  // Mark group as read when it's successfully loaded (only once per group)
  useEffect(() => {
    if (currentGroup && id && store && markedAsReadRef.current !== id) {
      markedAsReadRef.current = id;
      store
        .markGroupRead(id)
        .then(() => {
          refreshGroups();
        })
        .catch((error) => {
          console.error("Error marking group as read:", error);
        });
    }
  }, [currentGroup, id, store, refreshGroups]);

  useEffect(() => {
    if (!isLoading && currentGroup === null) {
      if (router.canGoBack()) {
        router.back();
      } else {
        router.replace("/groups");
      }
    }
  }, [isLoading, currentGroup]);

  if (!user) {
    return <Redirect href={"/(auth)"} />;
  }

  if ((isLoading && allGroups === null) || currentGroup === undefined) {
    return (
      <View className="flex-1 justify-center items-center bg-gray-900">
        <ActivityIndicator size="large" color="#007AFF" />
        <Text className="mt-2.5 text-base text-gray-100">Loading Group...</Text>
      </View>
    );
  }

  if (!currentGroup) {
    return (
      <View className="flex-1 justify-center items-center bg-gray-900">
        <Text className="text-lg text-red-400">Group not found.</Text>
      </View>
    );
  }

  return (
    <View className="flex-1 justify-end bg-gray-900">
      <ChatBox group={currentGroup} />
    </View>
  );
};

export default GroupPage;
