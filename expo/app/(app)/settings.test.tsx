import React from "react";
import { Alert } from "react-native";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import SettingsScreen from "./settings";

const mockLogout = jest.fn();
const mockSetUse24HourTime = jest.fn().mockResolvedValue(undefined);
const mockGetBlockedUsers = jest.fn();
const mockUnblockUser = jest.fn();
const mockGetGroups = jest.fn().mockResolvedValue([]);
const mockGetUsers = jest.fn().mockResolvedValue([]);
const mockStore = {
  saveGroups: jest.fn().mockResolvedValue(undefined),
  saveUsers: jest.fn().mockResolvedValue(undefined),
};
const mockRefreshGroups = jest.fn();
const mockRefreshUsers = jest.fn();

const mockRegisterForPushNotificationsAsync = jest.fn();
const mockSendPushTokenToServer = jest.fn();
const mockClearPushTokenOnServer = jest.fn();

jest.mock("@/components/context/AuthUtilsContext", () => ({
  useAuthUtils: () => ({
    logout: mockLogout,
  }),
}));

jest.mock("@/components/context/GlobalStoreContext", () => ({
  useGlobalStore: () => ({
    user: {
      id: "user-1",
      username: "evelyn",
      email: "evelyn@example.com",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    },
    deviceId: "device-1",
    store: mockStore,
    refreshGroups: mockRefreshGroups,
    refreshUsers: mockRefreshUsers,
  }),
}));

jest.mock("@/components/context/TimeFormatContext", () => ({
  useTimeFormat: () => ({
    use24HourTime: false,
    isLoading: false,
    setUse24HourTime: mockSetUse24HourTime,
  }),
}));

jest.mock("@/components/context/WebSocketContext", () => ({
  useWebSocket: () => ({
    getBlockedUsers: mockGetBlockedUsers,
    unblockUser: mockUnblockUser,
    getGroups: mockGetGroups,
    getUsers: mockGetUsers,
  }),
}));

jest.mock("@/services/notificationService", () => ({
  registerForPushNotificationsAsync: (...args: unknown[]) =>
    mockRegisterForPushNotificationsAsync(...args),
  sendPushTokenToServer: (...args: unknown[]) =>
    mockSendPushTokenToServer(...args),
  clearPushTokenOnServer: (...args: unknown[]) =>
    mockClearPushTokenOnServer(...args),
}));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(),
    setItem: jest.fn(),
  },
}));

describe("SettingsScreen", () => {
  const mockGetItem = AsyncStorage.getItem as jest.Mock;
  const mockSetItem = AsyncStorage.setItem as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetItem.mockResolvedValue("false");

    mockGetBlockedUsers.mockResolvedValue([
      {
        id: "blocked-1",
        username: "blockedUser",
        email: "blocked@example.com",
        blocked_at: "2026-02-16T00:00:00Z",
      },
    ]);
    mockRegisterForPushNotificationsAsync.mockResolvedValue("expoToken");
    mockSendPushTokenToServer.mockResolvedValue(true);
    mockClearPushTokenOnServer.mockResolvedValue(true);
  });

  it("loads and displays blocked users on mount", async () => {
    const { getByText } = render(<SettingsScreen />);

    await waitFor(() => {
      expect(mockGetBlockedUsers).toHaveBeenCalled();
    });

    expect(getByText("blockedUser")).toBeTruthy();
  });

  it("shows retry action when blocked users loading fails", async () => {
    mockGetBlockedUsers
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce([]);

    const { getByText } = render(<SettingsScreen />);

    await waitFor(() => {
      expect(
        getByText("Could not load blocked users. Please try again."),
      ).toBeTruthy();
    });

    fireEvent.press(getByText("Retry"));

    await waitFor(() => {
      expect(mockGetBlockedUsers).toHaveBeenCalledTimes(2);
    });
  });

  it("calls setUse24HourTime when 24-hour switch changes", async () => {
    const { getAllByRole } = render(<SettingsScreen />);

    await waitFor(() => {
      expect(mockGetBlockedUsers).toHaveBeenCalled();
    });

    const switches = getAllByRole("switch");
    const timeFormatSwitch = switches[1];
    await fireEvent(timeFormatSwitch, "valueChange", true);

    expect(mockSetUse24HourTime).toHaveBeenCalledWith(true);
  });

  it("enables push notifications and persists preference", async () => {
    const { getAllByRole } = render(<SettingsScreen />);

    await waitFor(() => {
      expect(mockGetBlockedUsers).toHaveBeenCalled();
    });

    const switches = getAllByRole("switch");
    const pushSwitch = switches[0];
    await fireEvent(pushSwitch, "valueChange", true);

    await waitFor(() => {
      expect(mockRegisterForPushNotificationsAsync).toHaveBeenCalled();
      expect(mockSendPushTokenToServer).toHaveBeenCalledWith(
        "expoToken",
        "device-1",
      );
      expect(mockSetItem).toHaveBeenCalledWith(
        "settings_push_enabled",
        "true",
      );
    });
  });

  it("disables push notifications and persists preference", async () => {
    mockGetItem.mockResolvedValue("true");

    const { getAllByRole } = render(<SettingsScreen />);

    await waitFor(() => {
      expect(mockGetBlockedUsers).toHaveBeenCalled();
    });

    const switches = getAllByRole("switch");
    const pushSwitch = switches[0];
    await fireEvent(pushSwitch, "valueChange", false);

    await waitFor(() => {
      expect(mockClearPushTokenOnServer).toHaveBeenCalledWith("device-1");
      expect(mockSetItem).toHaveBeenCalledWith(
        "settings_push_enabled",
        "false",
      );
    });
  });

  it("shows logout confirmation and logs out on confirm", async () => {
    const alertSpy = jest.spyOn(Alert, "alert");
    const { getAllByText } = render(<SettingsScreen />);

    await waitFor(() => {
      expect(mockGetBlockedUsers).toHaveBeenCalled();
    });

    fireEvent.press(getAllByText("Log Out")[1]);

    expect(alertSpy).toHaveBeenCalledWith(
      "Log Out?",
      "You will need to sign in again to access your chats.",
      expect.any(Array),
    );

    const buttons = alertSpy.mock.calls[0][2] as
      | { onPress?: () => void }[]
      | undefined;
    await buttons?.[1]?.onPress?.();

    expect(mockLogout).toHaveBeenCalled();
    alertSpy.mockRestore();
  });
});
