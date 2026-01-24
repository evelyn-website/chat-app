import { MessageUser, ImageMessageContent } from "@/types/types";

export type TextDisplayableItem = {
  type: "message_text";
  id: string;
  groupId: string;
  user: MessageUser;
  content: string; // Plaintext
  align: "left" | "right";
  timestamp: string;
  clientSeq?: number;
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
};

export type DateSeparatorItem = {
  type: "date_separator";
  id: string;
  groupId: string;
  dateString: string;
  timestamp: string;
};

export type DisplayableItem =
  | TextDisplayableItem
  | ImageDisplayableItem
  | DateSeparatorItem;
