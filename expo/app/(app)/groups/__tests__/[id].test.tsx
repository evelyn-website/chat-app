import React from "react";
import { render, waitFor } from "@testing-library/react-native";
import GroupPage from "../[id]";

const mockSetActiveGroupId = jest.fn();
const mockMarkGroupRead = jest.fn().mockResolvedValue(undefined);
const mockRefreshGroups = jest.fn();
const mockLoadGroups = jest.fn();

// Mock GlobalStoreContext
jest.mock("@/components/context/GlobalStoreContext", () => ({
  useGlobalStore: () => ({
    user: { id: "user-1", username: "test", email: "test@test.com", created_at: "", updated_at: "" },
    store: {
      loadGroups: mockLoadGroups,
      markGroupRead: mockMarkGroupRead,
      isAvailable: () => true,
    },
    groupsRefreshKey: 0,
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
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id),
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
    mockLoadGroups.mockResolvedValue([mockGroup]);
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
});
