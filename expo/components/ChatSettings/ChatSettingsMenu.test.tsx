import React from "react";
import { render, fireEvent } from "@testing-library/react-native";
import { Platform, Linking } from "react-native";
import ChatSettingsMenu from "./ChatSettingsMenu";
import type { Group } from "@/types/types";

// Mock context hooks
jest.mock("../context/GlobalStoreContext", () => ({
  useGlobalStore: () => ({
    store: { saveGroups: jest.fn() },
    refreshGroups: jest.fn(),
  }),
}));

jest.mock("../context/WebSocketContext", () => ({
  useWebSocket: () => ({
    inviteUsersToGroup: jest.fn(),
    updateGroup: jest.fn(),
    getGroups: jest.fn().mockResolvedValue([]),
  }),
}));

jest.mock("expo-router", () => ({
  router: { back: jest.fn() },
}));

jest.mock("@/hooks/useUploadImageClear", () => ({
  useUploadImageClear: () => ({
    uploadImage: jest.fn(),
    isUploading: false,
  }),
}));

jest.mock("../GroupAvatarEditable", () => "GroupAvatarEditable");

const mockOpenURL = jest.fn(() => Promise.resolve());
jest.spyOn(Linking, "openURL").mockImplementation(mockOpenURL);

function makeGroup(overrides: Partial<Group> = {}): Group {
  return {
    id: "group-1",
    name: "Test Group",
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-01-01T00:00:00Z",
    admin: false,
    start_time: "2025-06-01T12:00:00Z",
    end_time: "2025-06-01T18:00:00Z",
    group_users: [],
    description: null,
    location: null,
    ...overrides,
  };
}

describe("ChatSettingsMenu – location maps link", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders 'Not set' placeholder when location is null", () => {
    const group = makeGroup({ location: null, description: "A description" });
    const { getByText } = render(
      <ChatSettingsMenu group={group} onUserKicked={jest.fn()} />
    );

    expect(getByText("Not set")).toBeTruthy();
  });

  it("renders 'Not set' placeholder when location is empty string", () => {
    const group = makeGroup({ location: "", description: "A description" });
    const { getByText } = render(
      <ChatSettingsMenu group={group} onUserKicked={jest.fn()} />
    );

    expect(getByText("Not set")).toBeTruthy();
  });

  it("renders the location text when location is set", () => {
    const group = makeGroup({ location: "123 Main St, Springfield, IL" });
    const { getByText } = render(
      <ChatSettingsMenu group={group} onUserKicked={jest.fn()} />
    );

    expect(getByText("123 Main St, Springfield, IL")).toBeTruthy();
  });

  it("opens Apple Maps URL on iOS when location is tapped", () => {
    Platform.OS = "ios";
    const location = "123 Main St, Springfield, IL";
    const group = makeGroup({ location });
    const { getByText } = render(
      <ChatSettingsMenu group={group} onUserKicked={jest.fn()} />
    );

    fireEvent.press(getByText(location));

    expect(mockOpenURL).toHaveBeenCalledTimes(1);
    expect(mockOpenURL).toHaveBeenCalledWith(
      `https://maps.apple.com/?q=${encodeURIComponent(location)}`
    );
  });

  it("opens Google Maps URL on Android when location is tapped", () => {
    Platform.OS = "android";
    const location = "456 Oak Ave, Chicago, IL";
    const group = makeGroup({ location });
    const { getByText } = render(
      <ChatSettingsMenu group={group} onUserKicked={jest.fn()} />
    );

    fireEvent.press(getByText(location));

    expect(mockOpenURL).toHaveBeenCalledTimes(1);
    expect(mockOpenURL).toHaveBeenCalledWith(
      `https://maps.google.com/?q=${encodeURIComponent(location)}`
    );
  });

  it("correctly encodes special characters in the location URL", () => {
    Platform.OS = "ios";
    const location = "Café & Bar, 789 Elm St #2, New York, NY 10001";
    const group = makeGroup({ location });
    const { getByText } = render(
      <ChatSettingsMenu group={group} onUserKicked={jest.fn()} />
    );

    fireEvent.press(getByText(location));

    expect(mockOpenURL).toHaveBeenCalledWith(
      `https://maps.apple.com/?q=${encodeURIComponent(location)}`
    );
  });
});
