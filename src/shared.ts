// src/shared.ts

// 用户角色
export enum UserRole {
  HOST = "host",
  EDITOR = "editor",
  VIEWER = "viewer"
}

export enum PrefixType {
  moveView = "moveview_",
  drawing = "drawing_"
}

export enum RealTimeCommand{
            create = "create",
            join = "join",
            initSetup = "initSetup",
            clear = "clear",
            userList = "userList",
            chat = "chat",
            updateBackground = "updateBackground",
            updateMoveView = "updateMoveView",
            deleteMoveView = "deleteMoveView",
            drawingUpdate = "drawingUpdate",
            userUpdate = "userUpdate",
            closeRoom = 'closeRoom',
            error = 'error'
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


export enum ErrorType {
  MISSING_USER_INFO = 'Missing user information',
  USER_NOT_FOUND = 'User not found',
  SESSION_NOT_FOUND = 'User session not found',
  NOT_JOINED = 'User not joined',
  DRAWING_UPDATE_FAILED = 'Failed to process drawing update',
  PERMISSION_DENIED = 'Permission denied',
  ONLY_HOST_CAN_DO = 'Only host can close the room',
  ONLY_HOST_CAN_CREATE = 'only_host_can_create_the_room',
  ROOM_IS_CLOSED = 'room_is_closed',
  USER_NOT_JOINED = 'User not joined',
  INVALID_FORMAT = 'invalid_format',
  RATE_LIMITED = 'rate_limited', // 新增
  ROOM_NOT_EXIST = 'Room_does_not_exist',  // 新增：房间不存在的错误
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

