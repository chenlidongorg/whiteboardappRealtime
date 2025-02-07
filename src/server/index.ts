// src/server/index.ts

import {
  type Connection,
  Server,
  type WSMessage,
} from "partyserver";

import { ChatMessage, UserRole, UserSession, MessageType } from "../shared";

interface RoomData {
  users: Map<string, UserSession>;
  messages: ChatMessage[];
  drawingData: any[];
}

interface WebSocketMessage {
  type: string;
  content?: any;
  roomId?: string;
  userId?: string;
  userName?: string;
}

export class Chat extends Server<Env> {
  static options = {
    hibernate: true,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    }
  };

  private rooms = new Map<string, RoomData>();
  private connectionToUser = new Map<Connection, string>();

  onStart() {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        roomId TEXT,
        userId TEXT,
        userName TEXT,
        content TEXT,
        messageType TEXT,
        timestamp INTEGER
      )
    `);
  }

  onConnect(connection: Connection) {
    console.log("New connection established");
  }

  private checkConnection(connection: Connection): boolean {
    if (!connection || !this.connections.has(connection)) {
      console.error('Invalid connection');
      return false;
    }
    return true;
  }

  private createRoom(roomId: string): RoomData {
    const room: RoomData = {
      users: new Map<string, UserSession>(),
      messages: [],
      drawingData: []
    };
    this.rooms.set(roomId, room);
    return room;
  }

  private getOrCreateRoom(roomId: string): RoomData {
    return this.rooms.get(roomId) || this.createRoom(roomId);
  }

  private broadcastToRoom(roomId: string, message: any, exclude?: Connection) {
    const room = this.rooms.get(roomId);
    if (!room) return;

    for (const [userId, user] of room.users) {
      for (const connection of this.connections) {
        if (connection !== exclude && this.connectionToUser.get(connection) === userId) {
          connection.send(JSON.stringify(message));
        }
      }
    }
  }

  private broadcastUserList(roomId: string) {
    const room = this.rooms.get(roomId);
    if (!room) return;

    const userList = Array.from(room.users.values());
    this.broadcastToRoom(roomId, {
      type: "userList",
      content: userList
    });
  }

  onMessage(connection: Connection, message: WSMessage) {
    if (!this.checkConnection(connection)) return;

    try {
      const data = JSON.parse(message as string) as WebSocketMessage;
      if (!data.type) {
        throw new Error('Missing message type');
      }

      switch (data.type) {
        case 'createRoom':
          this.handleCreateRoom(connection, data);
          break;
        case 'join':
          this.handleJoin(connection, data);
          break;
        case 'chat':
          this.handleChat(connection, data);
          break;
        case 'draw':
          this.handleDraw(connection, data);
          break;
        case 'clear':
          this.handleClear(connection, data);
          break;
        default:
          console.warn('Unknown message type:', data.type);
      }
    } catch (error) {
      console.error('Error processing message:', error);
      connection.send(JSON.stringify({
        type: 'error',
        content: 'Invalid message format'
      }));
    }
  }

  private handleCreateRoom(connection: Connection, data: WebSocketMessage) {
    const { roomId, userId, userName } = data;
    if (!roomId || !userId || !userName) return;

    const room = this.getOrCreateRoom(roomId);
    const user: UserSession = {
      userId,
      userName,
      role: UserRole.HOST,
      roomId
    };

    room.users.set(userId, user);
    this.connectionToUser.set(connection, userId);

    connection.send(JSON.stringify({
      type: "init",
      content: {
        messages: room.messages,
        drawingData: room.drawingData,
        users: Array.from(room.users.values())
      }
    }));
  }

  private handleJoin(connection: Connection, data: WebSocketMessage) {
    if (!data.content) return;
    const { userId, userName, roomId, role } = data.content;
    if (!roomId || !userId || !userName) return;

    const room = this.getOrCreateRoom(roomId);
    const user: UserSession = {
      userId,
      userName,
      role: role || UserRole.VIEWER,
      roomId
    };

    room.users.set(userId, user);
    this.connectionToUser.set(connection, userId);

    connection.send(JSON.stringify({
      type: "init",
      content: {
        messages: room.messages,
        drawingData: room.drawingData,
        users: Array.from(room.users.values())
      }
    }));

    this.sendSystemMessage(roomId, `${userName} 加入了房间`);
    this.broadcastUserList(roomId);
  }

  private handleChat(connection: Connection, data: WebSocketMessage) {
    const userId = this.connectionToUser.get(connection);
    if (!userId || !data.content) return;

    const room = this.findRoomByUserId(userId);
    if (!room) return;

    const user = room.users.get(userId);
    if (!user) return;

    const message: ChatMessage = {
      id: crypto.randomUUID(),
      userId,
      userName: user.userName,
      content: data.content.text,
      timestamp: Date.now(),
      messageType: MessageType.TEXT
    };

    room.messages.push(message);
    this.saveMessageToDb(message, user.roomId!);

    this.broadcastToRoom(user.roomId!, {
      type: "chat",
      content: message
    });
  }

  private handleDraw(connection: Connection, data: WebSocketMessage) {
    const userId = this.connectionToUser.get(connection);
    if (!userId || !data.content) return;

    const room = this.findRoomByUserId(userId);
    if (!room) return;

    const user = room.users.get(userId);
    if (!user) return;

    room.drawingData.push(data.content);
    this.broadcastToRoom(user.roomId!, {
      type: "draw",
      content: data.content
    }, connection);
  }

  private handleClear(connection: Connection, data: WebSocketMessage) {
    const userId = this.connectionToUser.get(connection);
    if (!userId) return;

    const room = this.findRoomByUserId(userId);
    if (!room) return;

    const user = room.users.get(userId);
    if (!user) return;

    room.drawingData = [];
    this.broadcastToRoom(user.roomId!, {
      type: "clear"
    });
  }

  private findRoomByUserId(userId: string): RoomData | undefined {
    for (const [roomId, room] of this.rooms) {
      if (room.users.has(userId)) {
        return room;
      }
    }
    return undefined;
  }

  private sendSystemMessage(roomId: string, content: string) {
    const message: ChatMessage = {
      id: crypto.randomUUID(),
      userId: "system",
      userName: "System",
      content,
      timestamp: Date.now(),
      messageType: MessageType.SYSTEM
    };

    const room = this.rooms.get(roomId);
    if (room) {
      room.messages.push(message);
      this.saveMessageToDb(message, roomId);
      this.broadcastToRoom(roomId, {
        type: "chat",
        content: message
      });
    }
  }

  private saveMessageToDb(message: ChatMessage, roomId: string) {
    this.ctx.storage.sql.exec(
      `INSERT INTO messages (id, roomId, userId, userName, content, messageType, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        message.id,
        roomId,
        message.userId,
        message.userName,
        message.content,
        message.messageType,
        message.timestamp
      ]
    );
  }

  private cleanupEmptyRooms() {
    for (const [roomId, room] of this.rooms) {
      if (room.users.size === 0) {
        this.rooms.delete(roomId);
      }
    }
  }

  onClose(connection: Connection) {
    const userId = this.connectionToUser.get(connection);
    if (userId) {
      const room = this.findRoomByUserId(userId);
      if (room) {
        const user = room.users.get(userId);
        if (user) {
          room.users.delete(userId);
          this.sendSystemMessage(user.roomId!, `${user.userName} 离开了房间`);
          this.broadcastUserList(user.roomId!);
        }
      }
      this.connectionToUser.delete(connection);
    }
    this.connections.delete(connection);
    this.cleanupEmptyRooms();
  }

  static async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    if (request.headers.get("upgrade") === "websocket") {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);

      const chat = new Chat();
      await chat.handleWebSocket(server);

      return new Response(null, {
        status: 101,
        webSocket: client,
        headers: {
          'Upgrade': 'websocket',
          'Connection': 'Upgrade'
        }
      });
    }

    return env.ASSETS.fetch(request);
  }
}

export default {
  fetch: Chat.fetch
};