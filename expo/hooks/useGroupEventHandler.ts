import { useCallback } from "react";
import { GroupEvent } from "@/types/types";
import { useGlobalStore } from "@/components/context/GlobalStoreContext";
import { useMessageStore } from "@/components/context/MessageStoreContext";

export function useGroupEventHandler(
  fetchGroups: () => Promise<void>,
  fetchDeviceKeys: () => Promise<void>
) {
  const { store, refreshGroups } = useGlobalStore();
  const { removeGroupMessages } = useMessageStore();

  return useCallback(
    async (event: GroupEvent) => {
      try {
        switch (event.event) {
          case "user_invited":
            await Promise.all([fetchGroups(), fetchDeviceKeys()]);
            break;
          case "user_removed":
            await store.deleteGroup(event.group_id);
            removeGroupMessages(event.group_id);
            refreshGroups();
            break;
          case "group_updated":
            await fetchGroups();
            break;
          case "group_deleted":
            await store.deleteGroup(event.group_id);
            removeGroupMessages(event.group_id);
            refreshGroups();
            break;
          default:
            console.warn(`Received unknown group event type: ${event.event}`);
            break;
        }
      } catch (err) {
        console.error("Error handling group event:", err);
      }
    },
    [fetchGroups, fetchDeviceKeys, store, removeGroupMessages, refreshGroups]
  );
}
