import { View, Text, ActivityIndicator } from "react-native";
import { useEffect, useState, useRef } from "react";
import { useGlobalStore } from "../../context/GlobalStoreContext";
import Ionicons from "@expo/vector-icons/Ionicons";
import UserMultiSelect from "@/components/Global/Multiselect/UserMultiselect";
import type { User } from "@/types/types";

interface Props {
  placeholderText: string;
  userList: string[];
  setUserList: React.Dispatch<React.SetStateAction<string[]>>;
  excludedUserList: User[];
}

export default function UserInviteMultiselect({
  placeholderText,
  userList,
  setUserList,
  excludedUserList,
}: Props) {
  const { store, usersRefreshKey } = useGlobalStore();
  const [contacts, setContacts] = useState<User[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasLoadedOnce = useRef(false);

  useEffect(() => {
    let isMounted = true;
    const load = async () => {
      if (!hasLoadedOnce.current) {
        setIsLoading(true);
        setError(null);
      }
      try {
        const users = await store.loadUsers();
        if (!isMounted) return;
        setContacts(users);
        hasLoadedOnce.current = true;
      } catch (e) {
        console.error("Failed to load contacts:", e);
        if (isMounted && !hasLoadedOnce.current) {
          setError("Could not load contacts. Please try again later.");
        }
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };
    load();
    return () => {
      isMounted = false;
    };
  }, [usersRefreshKey, store]);

  if (contacts === null && isLoading) {
    return (
      <View
        className="w-full h-32 bg-black/20 border border-white/10 rounded-xl p-3 
                       justify-center items-center"
      >
        <ActivityIndicator size="small" color="#9CA3AF" />
        <Text className="text-zinc-400 mt-2">Loading contacts...</Text>
      </View>
    );
  }

  if (contacts === null && error) {
    return (
      <View
        className="w-full h-32 bg-black/20 border border-white/10 rounded-xl p-3 
                       justify-center items-center"
      >
        <Ionicons name="warning-outline" size={24} color="#F87171" />
        <Text className="text-red-400 mt-2 text-center">{error}</Text>
      </View>
    );
  }

  return (
    <View className="w-full relative">
      {isLoading && (
        <View
          className="absolute inset-0 justify-center 
                           items-center bg-black/40 rounded-xl"
        >
          <ActivityIndicator size="small" color="#9CA3AF" />
        </View>
      )}
      <UserMultiSelect
        placeholderText={placeholderText}
        tags={userList ?? []}
        options={contacts! ?? []}
        setTags={setUserList}
        excludedUserList={excludedUserList ?? []}
      />
    </View>
  );
}
