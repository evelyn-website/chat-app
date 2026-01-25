import { MessageUser, ImageMessageContent } from "@/types/types";

export type TextDisplayableItem = {
  type: "message_text";
  id: string;
  groupId: string;
  user: MessageUser;
  content: string; // Plaintext
  align: "left" | "right";
  timestamp: string;
  clientSeq?: number; // Optimistic (in-memory)
  client_seq?: number | null; // Persisted (from DB)
  client_timestamp?: string | null;
  pinToBottom?: boolean; // Keep at bottom while sending (optimistic only)
};

export type ImageDisplayableItem = {
  type: "message_image";
  id: string;
  groupId: string;
  user: MessageUser;
  content: ImageMessageContent;
  align: "left" | "right";
  timestamp: string;
  clientSeq?: number;
  client_seq?: number | null;
  client_timestamp?: string | null;
  pinToBottom?: boolean; // Keep at bottom while sending (optimistic only)
};

export type DateSeparatorItem = {
  type: "date_separator";
  id: string;
  groupId: string;
  dateString: string;
  timestamp: string;
};

export type OptimisticMessageItem = TextDisplayableItem | ImageDisplayableItem;

export type DisplayableItem =
  | TextDisplayableItem
  | ImageDisplayableItem
  | DateSeparatorItem;
