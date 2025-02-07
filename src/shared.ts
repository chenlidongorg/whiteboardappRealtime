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

// WebSocket 消息类型
export type WSMessage =
  | {
      type: "createRoom";
      roomId: string;
      userId: string;
      userName: string;
    }
  | {
      type: "join";
      content: {
        userId: string;
        userName: string;
        roomId: string;
        role: UserRole;
      };
    }
  | {
      type: "chat";
      content: ChatMessage;
    }
  | {
      type: "userList";
      content: UserSession[];
    }
  | {
      type: "draw";
      content: any; // 绘画数据类型
    }
  | {
      type: "clear";
    };