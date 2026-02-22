import React from "react";
import { render, waitFor } from "@testing-library/react-native";
import GroupPage from "@/app/(app)/groups/[id]";

const mockSetActiveGroupId = jest.fn();
const mockMarkGroupRead = jest.fn().mockResolvedValue(undefined);
const mockRefreshGroups = jest.fn();
const mockLoadGroups = jest.fn();
const mockIsAvailable = jest.fn().mockReturnValue(true);

// Stable references to avoid infinite re-renders (these are in effect deps)
const mockUser = {
  id: "user-1",
  username: "test",
  email: "test@test.com",
  created_at: "",
  updated_at: "",
};
const mockStore = {
  loadGroups: mockLoadGroups,
  markGroupRead: mockMarkGroupRead,
  isAvailable: mockIsAvailable,
};

// Allow groupsRefreshKey to be changed between renders
let mockGroupsRefreshKey = 0;

// Mock GlobalStoreContext
jest.mock("@/components/context/GlobalStoreContext", () => ({
  useGlobalStore: () => ({
    user: mockUser,
    store: mockStore,
    groupsRefreshKey: mockGroupsRefreshKey,
    refreshGroups: mockRefreshGroups,
    setActiveGroupId: mockSetActiveGroupId,
  }),
}));

// Mock expo-router
const mockId = "550e8400-e29b-41d4-a716-446655440000";
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ id: mockId }),
  router: {
    replace: jest.fn(),
    push: jest.fn(),
    canGoBack: () => false,
    back: jest.fn(),
  },
  Redirect: () => null,
}));

// Mock uuid
jest.mock("uuid", () => ({
  validate: (id: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      id,
    ),
}));

// Mock ChatBox
jest.mock("@/components/ChatBox/ChatBox", () => "ChatBox");

const mockGroup = {
  id: mockId,
  name: "Test Group",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  admin: false,
  start_time: null,
  end_time: null,
  group_users: [],
  last_read_timestamp: null,
  last_message_timestamp: null,
};

describe("GroupPage - activeGroupId management", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGroupsRefreshKey = 0;
    mockLoadGroups.mockResolvedValue([mockGroup]);
    mockIsAvailable.mockReturnValue(true);
    mockMarkGroupRead.mockResolvedValue(undefined);
  });

  it("sets activeGroupId on mount", async () => {
    render(<GroupPage />);

    expect(mockSetActiveGroupId).toHaveBeenCalledWith(mockId);
  });

  it("clears activeGroupId on unmount", async () => {
    const { unmount } = render(<GroupPage />);

    await waitFor(() => {
      expect(mockSetActiveGroupId).toHaveBeenCalledWith(mockId);
    });

    jest.clearAllMocks();
    unmount();

    expect(mockSetActiveGroupId).toHaveBeenCalledWith(null);
  });

  it("calls markGroupRead on unmount", async () => {
    const { unmount } = render(<GroupPage />);

    await waitFor(() => {
      expect(mockLoadGroups).toHaveBeenCalled();
    });

    jest.clearAllMocks();
    unmount();

    expect(mockMarkGroupRead).toHaveBeenCalledWith(mockId);
  });

  it("calls markGroupRead when group is loaded (via groupsRefreshKey effect)", async () => {
    render(<GroupPage />);

    await waitFor(() => {
      expect(mockMarkGroupRead).toHaveBeenCalledWith(mockId);
    });
  });

  it("re-marks group as read when groupsRefreshKey changes", async () => {
    const { rerender } = render(<GroupPage />);

    await waitFor(() => {
      expect(mockMarkGroupRead).toHaveBeenCalledWith(mockId);
    });

    jest.clearAllMocks();

    // Simulate groupsRefreshKey incrementing (new messages arrived)
    mockGroupsRefreshKey = 1;
    rerender(<GroupPage />);

    await waitFor(() => {
      expect(mockMarkGroupRead).toHaveBeenCalledWith(mockId);
    });
  });

  it("does not call markGroupRead when store is unavailable on unmount", async () => {
    const { unmount } = render(<GroupPage />);

    await waitFor(() => {
      expect(mockLoadGroups).toHaveBeenCalled();
    });

    jest.clearAllMocks();
    mockIsAvailable.mockReturnValue(false);
    unmount();

    expect(mockMarkGroupRead).not.toHaveBeenCalled();
  });

  it("clears activeGroupId on unmount even when store is unavailable", async () => {
    const { unmount } = render(<GroupPage />);

    await waitFor(() => {
      expect(mockSetActiveGroupId).toHaveBeenCalledWith(mockId);
    });

    jest.clearAllMocks();
    mockIsAvailable.mockReturnValue(false);
    unmount();

    expect(mockSetActiveGroupId).toHaveBeenCalledWith(null);
    expect(mockMarkGroupRead).not.toHaveBeenCalled();
  });

  it("handles markGroupRead rejection on unmount without throwing", async () => {
    const { unmount } = render(<GroupPage />);

    await waitFor(() => {
      expect(mockLoadGroups).toHaveBeenCalled();
    });

    jest.clearAllMocks();
    mockMarkGroupRead.mockRejectedValueOnce(new Error("db error"));
    const consoleSpy = jest.spyOn(console, "error").mockImplementation();

    unmount();

    // Wait for the rejected promise to be caught
    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith(
        "Error marking group as read on unmount:",
        expect.any(Error),
      );
    });

    consoleSpy.mockRestore();
  });

  it("does not call markGroupRead via groupsRefreshKey when group is not found", async () => {
    mockLoadGroups.mockResolvedValue([]);

    const { rerender } = render(<GroupPage />);

    // Wait for loadGroups to resolve and component to settle
    await waitFor(() => {
      expect(mockLoadGroups).toHaveBeenCalled();
    });

    // Wait for any pending effects to flush, then clear
    await new Promise((resolve) => setTimeout(resolve, 50));
    jest.clearAllMocks();

    // Simulate groupsRefreshKey incrementing - currentGroup is null so
    // the groupsRefreshKey effect guard should prevent markGroupRead
    mockGroupsRefreshKey = 1;
    rerender(<GroupPage />);

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(mockMarkGroupRead).not.toHaveBeenCalled();
  });
});
