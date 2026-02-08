import { GroupEvent } from "@/types/types";

/**
 * Creates a handler function matching the logic in _layout.tsx's handleGroupEvent.
 * This extracts the logic into a testable form.
 */
function createGroupEventHandler(deps: {
  fetchGroups: jest.Mock;
  fetchDeviceKeys: jest.Mock;
  store: { deleteGroup: jest.Mock };
  removeGroupMessages: jest.Mock;
  refreshGroups: jest.Mock;
}) {
  return async (event: GroupEvent) => {
    switch (event.event) {
      case "user_invited":
        deps.fetchGroups();
        deps.fetchDeviceKeys();
        break;
      case "user_removed":
        await deps.store.deleteGroup(event.group_id);
        deps.removeGroupMessages(event.group_id);
        deps.refreshGroups();
        break;
      case "group_updated":
        deps.fetchGroups();
        break;
      case "group_deleted":
        await deps.store.deleteGroup(event.group_id);
        deps.removeGroupMessages(event.group_id);
        deps.refreshGroups();
        break;
    }
  };
}

describe("Group Event Handler", () => {
  let fetchGroups: jest.Mock;
  let fetchDeviceKeys: jest.Mock;
  let store: { deleteGroup: jest.Mock };
  let removeGroupMessages: jest.Mock;
  let refreshGroups: jest.Mock;
  let handler: (event: GroupEvent) => Promise<void>;

  beforeEach(() => {
    fetchGroups = jest.fn();
    fetchDeviceKeys = jest.fn();
    store = { deleteGroup: jest.fn().mockResolvedValue(undefined) };
    removeGroupMessages = jest.fn();
    refreshGroups = jest.fn();
    handler = createGroupEventHandler({
      fetchGroups,
      fetchDeviceKeys,
      store,
      removeGroupMessages,
      refreshGroups,
    });
  });

  it("user_invited calls fetchGroups and fetchDeviceKeys", async () => {
    await handler({
      type: "group_event",
      event: "user_invited",
      group_id: "group-1",
    });

    expect(fetchGroups).toHaveBeenCalledTimes(1);
    expect(fetchDeviceKeys).toHaveBeenCalledTimes(1);
    expect(store.deleteGroup).not.toHaveBeenCalled();
    expect(removeGroupMessages).not.toHaveBeenCalled();
    expect(refreshGroups).not.toHaveBeenCalled();
  });

  it("user_removed calls store.deleteGroup, removeGroupMessages, and refreshGroups", async () => {
    await handler({
      type: "group_event",
      event: "user_removed",
      group_id: "group-2",
    });

    expect(store.deleteGroup).toHaveBeenCalledWith("group-2");
    expect(removeGroupMessages).toHaveBeenCalledWith("group-2");
    expect(refreshGroups).toHaveBeenCalledTimes(1);
    expect(fetchGroups).not.toHaveBeenCalled();
    expect(fetchDeviceKeys).not.toHaveBeenCalled();
  });

  it("group_updated calls fetchGroups", async () => {
    await handler({
      type: "group_event",
      event: "group_updated",
      group_id: "group-3",
    });

    expect(fetchGroups).toHaveBeenCalledTimes(1);
    expect(fetchDeviceKeys).not.toHaveBeenCalled();
    expect(store.deleteGroup).not.toHaveBeenCalled();
    expect(removeGroupMessages).not.toHaveBeenCalled();
    expect(refreshGroups).not.toHaveBeenCalled();
  });

  it("group_deleted calls store.deleteGroup, removeGroupMessages, and refreshGroups", async () => {
    await handler({
      type: "group_event",
      event: "group_deleted",
      group_id: "group-4",
    });

    expect(store.deleteGroup).toHaveBeenCalledWith("group-4");
    expect(removeGroupMessages).toHaveBeenCalledWith("group-4");
    expect(refreshGroups).toHaveBeenCalledTimes(1);
    expect(fetchGroups).not.toHaveBeenCalled();
    expect(fetchDeviceKeys).not.toHaveBeenCalled();
  });

  it("unknown event types are handled gracefully (no crash)", async () => {
    // Force an unknown event type via type assertion
    await expect(
      handler({
        type: "group_event",
        event: "unknown_event" as GroupEvent["event"],
        group_id: "group-5",
      })
    ).resolves.toBeUndefined();

    expect(fetchGroups).not.toHaveBeenCalled();
    expect(fetchDeviceKeys).not.toHaveBeenCalled();
    expect(store.deleteGroup).not.toHaveBeenCalled();
    expect(removeGroupMessages).not.toHaveBeenCalled();
    expect(refreshGroups).not.toHaveBeenCalled();
  });
});
