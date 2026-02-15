import { renderHook, act } from "@testing-library/react-native";
import { useGroupEventHandler } from "@/hooks/useGroupEventHandler";
import { useGlobalStore } from "@/components/context/GlobalStoreContext";
import { useMessageStore } from "@/components/context/MessageStoreContext";
import { GroupEvent } from "@/types/types";

jest.mock("@/components/context/GlobalStoreContext");
jest.mock("@/components/context/MessageStoreContext");

describe("useGroupEventHandler", () => {
  const fetchGroups = jest.fn().mockResolvedValue(undefined);
  const fetchDeviceKeys = jest.fn().mockResolvedValue(undefined);
  const deleteGroup = jest.fn().mockResolvedValue(undefined);
  const removeGroupMessages = jest.fn();
  const refreshGroups = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();

    (useGlobalStore as jest.Mock).mockReturnValue({
      store: { deleteGroup },
      refreshGroups,
    });

    (useMessageStore as jest.Mock).mockReturnValue({
      removeGroupMessages,
    });
  });

  function renderHandler() {
    return renderHook(() => useGroupEventHandler(fetchGroups, fetchDeviceKeys));
  }

  it("user_invited awaits fetchGroups and fetchDeviceKeys", async () => {
    const { result } = renderHandler();

    await act(async () => {
      await result.current({
        type: "group_event",
        event: "user_invited",
        group_id: "group-1",
      });
    });

    expect(fetchGroups).toHaveBeenCalledTimes(1);
    expect(fetchDeviceKeys).toHaveBeenCalledTimes(1);
    expect(deleteGroup).not.toHaveBeenCalled();
    expect(removeGroupMessages).not.toHaveBeenCalled();
    expect(refreshGroups).not.toHaveBeenCalled();
  });

  it("user_removed calls store.deleteGroup, removeGroupMessages, and refreshGroups", async () => {
    const { result } = renderHandler();

    await act(async () => {
      await result.current({
        type: "group_event",
        event: "user_removed",
        group_id: "group-2",
      });
    });

    expect(deleteGroup).toHaveBeenCalledWith("group-2");
    expect(removeGroupMessages).toHaveBeenCalledWith("group-2");
    expect(refreshGroups).toHaveBeenCalledTimes(1);
    expect(fetchGroups).not.toHaveBeenCalled();
    expect(fetchDeviceKeys).not.toHaveBeenCalled();
  });

  it("group_updated awaits fetchGroups", async () => {
    const { result } = renderHandler();

    await act(async () => {
      await result.current({
        type: "group_event",
        event: "group_updated",
        group_id: "group-3",
      });
    });

    expect(fetchGroups).toHaveBeenCalledTimes(1);
    expect(fetchDeviceKeys).not.toHaveBeenCalled();
    expect(deleteGroup).not.toHaveBeenCalled();
    expect(removeGroupMessages).not.toHaveBeenCalled();
    expect(refreshGroups).not.toHaveBeenCalled();
  });

  it("group_deleted calls store.deleteGroup, removeGroupMessages, and refreshGroups", async () => {
    const { result } = renderHandler();

    await act(async () => {
      await result.current({
        type: "group_event",
        event: "group_deleted",
        group_id: "group-4",
      });
    });

    expect(deleteGroup).toHaveBeenCalledWith("group-4");
    expect(removeGroupMessages).toHaveBeenCalledWith("group-4");
    expect(refreshGroups).toHaveBeenCalledTimes(1);
    expect(fetchGroups).not.toHaveBeenCalled();
    expect(fetchDeviceKeys).not.toHaveBeenCalled();
  });

  it("unknown event types are handled gracefully (no crash)", async () => {
    const consoleSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    const { result } = renderHandler();

    await act(async () => {
      await result.current({
        type: "group_event",
        event: "unknown_event" as GroupEvent["event"],
        group_id: "group-5",
      });
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("unknown_event")
    );
    expect(fetchGroups).not.toHaveBeenCalled();
    expect(fetchDeviceKeys).not.toHaveBeenCalled();
    expect(deleteGroup).not.toHaveBeenCalled();
    expect(removeGroupMessages).not.toHaveBeenCalled();
    expect(refreshGroups).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
  });
});
