import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  Platform,
  SafeAreaView,
  StatusBar,
} from "react-native";
import { ChatSelectBox } from "./ChatSelectBox";
import { useGlobalStore } from "../context/GlobalStoreContext";
import { Group } from "@/types/types";
import { useState, useEffect, useCallback, useMemo } from "react";
import { useWebSocket } from "../context/WebSocketContext";
import { router } from "expo-router";
import Button from "../Global/Button/Button";

export const ChatSelect = () => {
  const { store, groupsRefreshKey, refreshGroups } = useGlobalStore();
  const { getGroups } = useWebSocket();

  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [groups, setGroups] = useState<Group[]>([]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const data = await getGroups();
      await store.saveGroups(data);
      refreshGroups();
    } catch (error) {
      console.error(error);
    }
    setTimeout(() => {
      setRefreshing(false);
    }, 300);
  }, [getGroups, store, refreshGroups]);

  useEffect(() => {
    store
      .loadGroups()
      .then((savedGroups) => {
        const now = new Date();
        const nonExpired = savedGroups.filter(
          (g) => !g.end_time || new Date(g.end_time) > now
        );
        setGroups(nonExpired);
      })
      .catch((error) => console.error(error));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupsRefreshKey]);

  const sortedGroups = useMemo(() => {
    return [...groups].sort((a, b) => {
      const timeA = a.last_message_timestamp || a.created_at || "";
      const timeB = b.last_message_timestamp || b.created_at || "";

      const dateA = new Date(timeA);
      const dateB = new Date(timeB);

      return dateB.getTime() - dateA.getTime();
    });
  }, [groups]);

  const statusBarHeight = StatusBar.currentHeight || 0;
  const topPadding = Platform.OS === "ios" ? 50 : statusBarHeight + 16;

  return (
    <SafeAreaView
      className={"w-full flex-1 bg-gray-900 border-r border-gray-700"}
      style={{
        paddingTop: topPadding,
      }}
    >
      <View className="px-3 mb-2">
        <Text className="text-xl font-semibold text-blue-400 mb-3 px-1">
          Your Groups
        </Text>
        <View className="items-center justify-center">
          <Button
            onPress={() => {
              router.push("/groups/chat-create");
            }}
            text="Create New Group"
            size="base"
            variant="secondary"
            className="mt-3"
          />
        </View>
      </View>

      <ScrollView
        className="flex-1 mt-3"
        contentContainerStyle={{
          flexGrow: 1,
          paddingBottom: 20,
        }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            progressViewOffset={60}
            tintColor="#60A5FA" // blue-400
            colors={["#60A5FA"]} // blue-400
          />
        }
      >
        <View className="bg-gray-800 mx-3 rounded-lg overflow-hidden">
          {sortedGroups.length > 0 ? (
            sortedGroups.map((group, index) => (
              <ChatSelectBox
                key={group.id || index}
                group={group}
                isFirst={index === 0}
                isLast={index === sortedGroups.length - 1}
              />
            ))
          ) : (
            <View className="py-6 px-4">
              <Text className="text-gray-400 text-center">
                No groups yet. Create a new group to get started.
              </Text>
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};
