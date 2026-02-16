import "react-native-get-random-values";
import ChatBox from "@/components/ChatBox/ChatBox";
import { useGlobalStore } from "@/components/context/GlobalStoreContext";
import { Group } from "@/types/types";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useState, useEffect, useMemo } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { validate } from "uuid";

const GroupPage = () => {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user, store, groupsRefreshKey, refreshGroups, setActiveGroupId } = useGlobalStore();

  const [allGroups, setAllGroups] = useState<Group[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isNavigatingAway, setIsNavigatingAway] = useState(false);

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

  // Track the active group and mark it as read when leaving. Runs on initial
  // render and whenever the group id changes; the cleanup persists the read
  // timestamp for the previous group.
  useEffect(() => {
    if (id) {
      setActiveGroupId(id);
    }
    return () => {
      if (id && store && store.isAvailable()) {
        store
          .markGroupRead(id)
          .then(() => {
            refreshGroups();
          })
          .catch((error) => {
            console.error("Error marking group as read on unmount:", error);
          });
      }
    };
  }, [id, store, refreshGroups, setActiveGroupId]);

  // Clear activeGroupId only on true component unmount, not on dep changes.
  // Separated from the above effect so that navigating between groups
  // (id change) does not null out activeGroupId before the new id is set.
  useEffect(() => {
    return () => {
      setActiveGroupId(null);
    };
  }, [setActiveGroupId]);

  // Re-mark group as read whenever groupsRefreshKey changes while viewing.
  // Does NOT call refreshGroups() to avoid an infinite loop (refreshGroups
  // increments groupsRefreshKey). The active group suppression in
  // ChatSelectBox handles the UI side; this just keeps the local
  // last_read_timestamp current so the unread indicator stays correct
  // when the user eventually leaves the group.
  useEffect(() => {
    if (currentGroup && id && store && store.isAvailable()) {
      store.markGroupRead(id).catch((error) => {
        console.error("Error marking group as read:", error);
      });
    }
  }, [groupsRefreshKey, id, store, currentGroup]);

  useEffect(() => {
    if (!isLoading && currentGroup === null) {
      setIsNavigatingAway(true);
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

  if (isNavigatingAway || !currentGroup) {
    return (
      <View className="flex-1 justify-center items-center bg-gray-900">
        <ActivityIndicator size="large" color="#007AFF" />
        <Text className="mt-2.5 text-base text-gray-100">Returning to groups...</Text>
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
