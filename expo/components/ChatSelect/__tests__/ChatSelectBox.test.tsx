import React from "react";
import { render, screen } from "@testing-library/react-native";
import { ChatSelectBox } from "../ChatSelectBox";
import { Group } from "@/types/types";

// Track the activeGroupId value returned by the mock
let mockActiveGroupId: string | null = null;

jest.mock("@/components/context/GlobalStoreContext", () => ({
  useGlobalStore: () => ({
    activeGroupId: mockActiveGroupId,
  }),
}));

// Mock expo-router
jest.mock("expo-router", () => ({
  router: { push: jest.fn() },
  usePathname: () => "/groups",
}));

// Mock Ionicons
jest.mock("@expo/vector-icons/Ionicons", () => "Ionicons");

// Mock GroupAvatarSmall
jest.mock("../../GroupAvatarSmall", () => "GroupAvatarSmall");

const makeGroup = (overrides: Partial<Group> = {}): Group => ({
  id: "group-1",
  name: "Test Group",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  admin: false,
  start_time: null,
  end_time: null,
  group_users: [],
  last_read_timestamp: null,
  last_message_timestamp: null,
  ...overrides,
});

describe("ChatSelectBox - unread indicator", () => {
  beforeEach(() => {
    mockActiveGroupId = null;
  });

  it("shows unread indicator when last_message_timestamp > last_read_timestamp", () => {
    const group = makeGroup({
      last_message_timestamp: "2026-01-02T00:00:00Z",
      last_read_timestamp: "2026-01-01T00:00:00Z",
    });

    render(<ChatSelectBox group={group} isFirst={true} isLast={false} />);

    // The group name should be rendered with semibold font (unread style)
    const groupName = screen.getByText("Test Group");
    expect(groupName.props.className).toContain("font-semibold");
  });

  it("does not show unread indicator when last_read_timestamp >= last_message_timestamp", () => {
    const group = makeGroup({
      last_message_timestamp: "2026-01-01T00:00:00Z",
      last_read_timestamp: "2026-01-02T00:00:00Z",
    });

    render(<ChatSelectBox group={group} isFirst={true} isLast={false} />);

    const groupName = screen.getByText("Test Group");
    expect(groupName.props.className).not.toContain("font-semibold");
  });

  it("does not show unread indicator when no messages exist", () => {
    const group = makeGroup({
      last_message_timestamp: null,
      last_read_timestamp: null,
    });

    render(<ChatSelectBox group={group} isFirst={true} isLast={false} />);

    const groupName = screen.getByText("Test Group");
    expect(groupName.props.className).not.toContain("font-semibold");
  });

  it("shows unread indicator when last_message_timestamp exists but last_read_timestamp is null", () => {
    const group = makeGroup({
      last_message_timestamp: "2026-01-01T00:00:00Z",
      last_read_timestamp: null,
    });

    render(<ChatSelectBox group={group} isFirst={true} isLast={false} />);

    const groupName = screen.getByText("Test Group");
    expect(groupName.props.className).toContain("font-semibold");
  });

  it("suppresses unread indicator when group is the active group", () => {
    mockActiveGroupId = "group-1";

    const group = makeGroup({
      id: "group-1",
      last_message_timestamp: "2026-01-02T00:00:00Z",
      last_read_timestamp: "2026-01-01T00:00:00Z",
    });

    render(<ChatSelectBox group={group} isFirst={true} isLast={false} />);

    // Despite having newer messages, the unread indicator should be suppressed
    const groupName = screen.getByText("Test Group");
    expect(groupName.props.className).not.toContain("font-semibold");
  });

  it("still shows unread indicator for non-active groups", () => {
    mockActiveGroupId = "group-other";

    const group = makeGroup({
      id: "group-1",
      last_message_timestamp: "2026-01-02T00:00:00Z",
      last_read_timestamp: "2026-01-01T00:00:00Z",
    });

    render(<ChatSelectBox group={group} isFirst={true} isLast={false} />);

    const groupName = screen.getByText("Test Group");
    expect(groupName.props.className).toContain("font-semibold");
  });

  it("suppresses unread indicator even when last_read_timestamp is null for active group", () => {
    mockActiveGroupId = "group-1";

    const group = makeGroup({
      id: "group-1",
      last_message_timestamp: "2026-01-01T00:00:00Z",
      last_read_timestamp: null,
    });

    render(<ChatSelectBox group={group} isFirst={true} isLast={false} />);

    const groupName = screen.getByText("Test Group");
    expect(groupName.props.className).not.toContain("font-semibold");
  });
});
