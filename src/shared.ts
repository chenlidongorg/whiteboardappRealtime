// src/shared.ts

// 用户角色
export enum UserRole {
  HOST = "host",
  EDITOR = "editor",
  VIEWER = "viewer"
}

// 用户会话
export interface UserSession {
  userId: string;
  userName: string;
  role?: UserRole;
  roomId?: string;
}

// 消息类型
export enum MessageType {
  TEXT = "text",
  SYSTEM = "system",
  FILE = "file"
}

// 聊天消息
export interface ChatMessage {
  id: string;
  userId: string;
  userName: string;
  content: string;
  timestamp: number;
  messageType: MessageType;
}

