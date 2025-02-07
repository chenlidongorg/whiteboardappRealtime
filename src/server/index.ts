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

export class Chat extends Server<Env> {
  static options = {
    hibernate: true,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    }
  };

  // 存储所有房间数据
  private rooms = new Map<string, RoomData>();

  // 存储连接到用户的映射
  private connectionToUser = new Map<Connection, string>();

  onStart() {
    // 初始化数据库
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
    // 等待加入房间的消息
    console.log("New connection established");
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
    try {
      const data = JSON.parse(message as string);

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
      }
    } catch (error) {
      console.error('Error processing message:', error);
    }
  }

  private handleCreateRoom(connection: Connection, data: any) {
    const { roomId, userId, userName } = data;
    const room = this.getOrCreateRoom(roomId);

    const user: UserSession = {
      userId,
      userName,
      role: UserRole.HOST,
      roomId
    };

    room.users.set(userId, user);
    this.connectionToUser.set(connection, userId);

    // 发送房间初始状态
    connection.send(JSON.stringify({
      type: "init",
      content: {
        messages: room.messages,
        drawingData: room.drawingData,
        users: Array.from(room.users.values())
      }
    }));
  }

  private handleJoin(connection: Connection, data: any) {
    const { userId, userName, roomId, role } = data.content;
    const room = this.getOrCreateRoom(roomId);

    const user: UserSession = {
      userId,
      userName,
      role,
      roomId
    };

    room.users.set(userId, user);
    this.connectionToUser.set(connection, userId);

    // 发送房间初始状态
    connection.send(JSON.stringify({
      type: "init",
      content: {
        messages: room.messages,
        drawingData: room.drawingData,
        users: Array.from(room.users.values())
      }
    }));

    // 广播系统消息
    this.sendSystemMessage(roomId, `${userName} 加入了房间`);

    // 广播用户列表更新
    this.broadcastUserList(roomId);
  }

  private handleChat(connection: Connection, data: any) {
    const userId = this.connectionToUser.get(connection);
    if (!userId) return;

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

  private handleDraw(connection: Connection, data: any) {
    const userId = this.connectionToUser.get(connection);
    if (!userId) return;

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

  private handleClear(connection: Connection, data: any) {
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
  }
}
// src/server/index.ts 中的 fetch 函数修改

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    // 添加详细的 CORS 和 WebSocket 握手处理
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With, Upgrade, Connection, Sec-WebSocket-Key, Sec-WebSocket-Version, Sec-WebSocket-Extensions",
          "Access-Control-Max-Age": "86400",
        }
      });
    }

    // WebSocket 连接处理
    if (request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
      try {
        // 验证 WebSocket 握手必需的头部
        const upgradeHeader = request.headers.get("Upgrade");
        const connectionHeader = request.headers.get("Connection");
        const secWebSocketKey = request.headers.get("Sec-WebSocket-Key");
        const secWebSocketVersion = request.headers.get("Sec-WebSocket-Version");

        if (!upgradeHeader || !connectionHeader || !secWebSocketKey || secWebSocketVersion !== "13") {
          return new Response("Invalid WebSocket handshake", { status: 400 });
        }

        // 创建 WebSocket 对
        const pair = new WebSocketPair();
        const [client, server] = Object.values(pair);

        // 配置服务器端 WebSocket
        server.accept();
        const chat = new Chat();
        chat.handleWebSocket(server);

        // 返回正确的握手响应
        return new Response(null, {
          status: 101,
          webSocket: client,
          headers: {
            "Upgrade": "websocket",
            "Connection": "Upgrade",
            "Sec-WebSocket-Accept": computeAcceptKey(secWebSocketKey),
            "Access-Control-Allow-Origin": "*",
          }
        });
      } catch (err) {
        console.error("WebSocket handshake error:", err);
        return new Response("WebSocket handshake failed", { status: 500 });
      }
    }

    return env.ASSETS.fetch(request);
  }
};