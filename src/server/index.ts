// src/server/index.ts

import {
  type Connection,
  Server,
  type WSMessage,
} from "partyserver";

import type { ChatMessage, Message } from "../shared";

// 导出 Chat 类 (之前的主要功能都保留)
export class Chat extends Server<Env> {
  static options = {
    hibernate: true,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    }
  };

  connections = new Set<Connection>();
  messages = [] as ChatMessage[];
  drawingData: any[] = []; // 存储绘画数据
  participants = new Map<string, string>(); // userId -> userName

  onStart() {
    // 初始化数据库
    this.ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        user TEXT,
        role TEXT,
        content TEXT,
        timestamp INTEGER
      )`
    );

    // 加载历史消息
    this.messages = this.ctx.storage.sql
      .exec(`SELECT * FROM messages ORDER BY timestamp DESC LIMIT 100`)
      .toArray() as ChatMessage[];
  }

  onConnect(connection: Connection) {
    this.connections.add(connection);

    // 发送当前状态给新连接的客户端
    connection.send(JSON.stringify({
      type: "init",
      data: {
        messages: this.messages,
        drawingData: this.drawingData,
        participants: Array.from(this.participants.entries())
      }
    }));
  }

  // 保存消息到数据库
  saveMessage(message: ChatMessage) {
    const existingMessage = this.messages.find((m) => m.id === message.id);
    if (existingMessage) {
      this.messages = this.messages.map((m) =>
        m.id === message.id ? message : m
      );
    } else {
      this.messages.push(message);
    }

    // 保存到数据库
    this.ctx.storage.sql.exec(
      `INSERT INTO messages (id, user, role, content, timestamp)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET
       content = ?, timestamp = ?`,
      [
        message.id,
        message.user,
        message.role,
        JSON.stringify(message.content),
        Date.now(),
        JSON.stringify(message.content),
        Date.now()
      ]
    );
  }

  onMessage(connection: Connection, message: WSMessage) {
    try {
      const data = JSON.parse(message as string);

      switch (data.type) {
        case 'join':
          this.handleJoin(connection, data);
          break;

        case 'draw':
          this.handleDraw(data);
          break;

        case 'chat':
          this.handleChat(data);
          break;

        case 'clear':
          this.handleClear();
          break;

        case 'add':
        case 'update':
          this.saveMessage(data);
          break;
      }

      // 广播消息给其他客户端
      this.broadcast(message as string, connection);

    } catch (error) {
      console.error('Error processing message:', error);
    }
  }

  private handleJoin(connection: Connection, data: any) {
    const { userId, userName } = data.content;
    this.participants.set(userId, userName);

    // 广播新用户加入
    this.broadcast(JSON.stringify({
      type: 'userJoined',
      content: { userId, userName }
    }));
  }

  private handleDraw(data: any) {
    this.drawingData.push(data.content);
  }

  private handleChat(data: any) {
    const chatMessage = {
      id: crypto.randomUUID(),
      user: data.userId,
      role: 'user',
      content: data.content.text,
      timestamp: Date.now()
    };

    this.saveMessage(chatMessage);
  }

  private handleClear() {
    this.drawingData = [];
    // 广播清除命令
    this.broadcast(JSON.stringify({ type: 'clear' }));
  }

  onClose(connection: Connection) {
    this.connections.delete(connection);
    // 可以在这里处理用户断开连接的逻辑
  }

  private broadcast(message: string, exclude?: Connection) {
    for (const connection of this.connections) {
      if (connection !== exclude) {
        connection.send(message);
      }
    }
  }
}

// 导出默认处理程序
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    // 处理 WebSocket 连接
    if (request.headers.get("Upgrade") === "websocket") {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);

      server.accept();

      return new Response(null, {
        status: 101,
        webSocket: client,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        }
      });
    }

    // 处理普通 HTTP 请求
    return env.ASSETS.fetch(request);
  }
};