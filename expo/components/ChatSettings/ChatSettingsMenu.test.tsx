import React from "react";
import { render, fireEvent } from "@testing-library/react-native";
import { Platform, Linking, Alert } from "react-native";
import ChatSettingsMenu from "./ChatSettingsMenu";
import type { Group } from "@/types/types";

// Mock context hooks
jest.mock("../context/GlobalStoreContext", () => ({
  useGlobalStore: () => ({
    store: { saveGroups: jest.fn() },
    refreshGroups: jest.fn(),
  }),
}));

const mockToggleGroupMuted = jest.fn();

jest.mock("../context/WebSocketContext", () => ({
  useWebSocket: () => ({
    inviteUsersToGroup: jest.fn(),
    updateGroup: jest.fn(),
    getGroups: jest.fn().mockResolvedValue([]),
    toggleGroupMuted: mockToggleGroupMuted,
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

// Helper to safely mock Platform.OS (readonly property)
const originalPlatformOS = Platform.OS;

function setPlatformOS(os: typeof Platform.OS): void {
  Object.defineProperty(Platform, "OS", {
    get: () => os,
    configurable: true,
  });
}

function restorePlatformOS(): void {
  Object.defineProperty(Platform, "OS", {
    get: () => originalPlatformOS,
    configurable: true,
  });
}

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

  afterEach(() => {
    restorePlatformOS();
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
    setPlatformOS("ios");
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
    setPlatformOS("android");
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
    setPlatformOS("ios");
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

describe("ChatSettingsMenu – mute notifications toggle", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders the Mute Notifications toggle for non-admin members", () => {
    const group = makeGroup({ admin: false });
    const { getByText } = render(
      <ChatSettingsMenu group={group} onUserKicked={jest.fn()} />
    );

    expect(getByText("Mute Notifications")).toBeTruthy();
  });

  it("renders the Mute Notifications toggle for admin members", () => {
    const group = makeGroup({ admin: true });
    const { getByText } = render(
      <ChatSettingsMenu group={group} onUserKicked={jest.fn()} />
    );

    expect(getByText("Mute Notifications")).toBeTruthy();
  });

  it("renders the Notifications section header", () => {
    const group = makeGroup();
    const { getByText } = render(
      <ChatSettingsMenu group={group} onUserKicked={jest.fn()} />
    );

    expect(getByText("Notifications")).toBeTruthy();
  });

  it("initializes the toggle to off when group is not muted", () => {
    const group = makeGroup({ muted: false });
    const { getByRole } = render(
      <ChatSettingsMenu group={group} onUserKicked={jest.fn()} />
    );

    const toggle = getByRole("switch");
    expect(toggle.props.value).toBe(false);
  });

  it("initializes the toggle to on when group is muted", () => {
    const group = makeGroup({ muted: true });
    const { getByRole } = render(
      <ChatSettingsMenu group={group} onUserKicked={jest.fn()} />
    );

    const toggle = getByRole("switch");
    expect(toggle.props.value).toBe(true);
  });

  it("calls toggleGroupMuted with group id when toggled", async () => {
    mockToggleGroupMuted.mockResolvedValue({ muted: true });
    const group = makeGroup({ muted: false });
    const { getByRole } = render(
      <ChatSettingsMenu group={group} onUserKicked={jest.fn()} />
    );

    const toggle = getByRole("switch");
    await fireEvent(toggle, "valueChange", true);

    expect(mockToggleGroupMuted).toHaveBeenCalledWith("group-1");
  });

  it("shows alert when toggleGroupMuted returns undefined", async () => {
    mockToggleGroupMuted.mockResolvedValue(undefined);
    const alertSpy = jest.spyOn(Alert, "alert");
    const group = makeGroup({ muted: false });
    const { getByRole } = render(
      <ChatSettingsMenu group={group} onUserKicked={jest.fn()} />
    );

    const toggle = getByRole("switch");
    await fireEvent(toggle, "valueChange", true);

    expect(alertSpy).toHaveBeenCalledWith(
      "Error",
      "Could not toggle mute. Please try again."
    );
    alertSpy.mockRestore();
  });
});
