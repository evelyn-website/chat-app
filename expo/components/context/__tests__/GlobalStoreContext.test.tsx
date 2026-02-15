import React from "react";
import { Text } from "react-native";
import { renderHook, act } from "@testing-library/react-native";
import { GlobalStoreProvider, useGlobalStore } from "../GlobalStoreContext";

// Mock axios
jest.mock("@/util/custom-axios", () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() },
}));

// Mock encryption service
jest.mock("@/services/encryptionService", () => ({
  base64ToUint8Array: jest.fn((str: string) => new Uint8Array()),
}));

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <GlobalStoreProvider>{children}</GlobalStoreProvider>
);

describe("GlobalStoreContext - activeGroupId", () => {
  it("initializes activeGroupId as null", () => {
    const { result } = renderHook(() => useGlobalStore(), { wrapper });
    expect(result.current.activeGroupId).toBeNull();
  });

  it("sets activeGroupId when setActiveGroupId is called", () => {
    const { result } = renderHook(() => useGlobalStore(), { wrapper });

    act(() => {
      result.current.setActiveGroupId("group-123");
    });

    expect(result.current.activeGroupId).toBe("group-123");
  });

  it("clears activeGroupId when set to null", () => {
    const { result } = renderHook(() => useGlobalStore(), { wrapper });

    act(() => {
      result.current.setActiveGroupId("group-123");
    });
    expect(result.current.activeGroupId).toBe("group-123");

    act(() => {
      result.current.setActiveGroupId(null);
    });
    expect(result.current.activeGroupId).toBeNull();
  });

  it("updates activeGroupId when switching groups", () => {
    const { result } = renderHook(() => useGlobalStore(), { wrapper });

    act(() => {
      result.current.setActiveGroupId("group-1");
    });
    expect(result.current.activeGroupId).toBe("group-1");

    act(() => {
      result.current.setActiveGroupId("group-2");
    });
    expect(result.current.activeGroupId).toBe("group-2");
  });
});
