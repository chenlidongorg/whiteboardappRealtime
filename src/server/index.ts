// src/server/index.ts

import { Server, Connection } from "partyserver";

// 定义消息类型
interface WhiteboardMessage {
  type: 'join' | 'leave' | 'draw' | 'clear' | 'chat';
  userId: string;
  roomId: string;
  content: any;
  timestamp: number;
}

// 定义用户信息
interface User {
  id: string;
  name: string;
  role: 'creator' | 'editor' | 'viewer';
}

export class WhiteboardRoom extends Server<Env> {
  // 配置选项
  static options = {
    hibernate: true,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    }
  };

  // 类属性
  private connections = new Map<string, Connection>(); // userId -> connection
  private users = new Map<string, User>(); // userId -> user
  private drawingData: any[] = []; // 存储绘画数据
  private chatHistory: any[] = []; // 存储聊天记录

  // 当服务器启动时
  onStart() {
    // 从数据库加载持久化数据
    this.loadPersistedData();
  }

  // 当新客户端连接时
  onConnect(connection: Connection) {
    // 发送当前状态给新连接的客户端
    connection.send(JSON.stringify({
      type: 'init',
      data: {
        users: Array.from(this.users.values()),
        drawingData: this.drawingData,
        chatHistory: this.chatHistory
      }
    }));
  }

  // 处理收到的消息
  onMessage(connection: Connection, message: string) {
    try {
      const data = JSON.parse(message) as WhiteboardMessage;

      switch (data.type) {
        case 'join':
          this.handleJoin(connection, data);
          break;

        case 'leave':
          this.handleLeave(data.userId);
          break;

        case 'draw':
          this.handleDraw(data);
          break;

        case 'clear':
          this.handleClear(data);
          break;

        case 'chat':
          this.handleChat(data);
          break;
      }

      // 保存状态
      this.persistState();

    } catch (error) {
      console.error('Error processing message:', error);
      connection.send(JSON.stringify({
        type: 'error',
        message: 'Invalid message format'
      }));
    }
  }

  // 处理加入房间
  private handleJoin(connection: Connection, data: WhiteboardMessage) {
    const { userId, content } = data;

    // 存储用户信息和连接
    this.connections.set(userId, connection);
    this.users.set(userId, {
      id: userId,
      name: content.userName,
      role: content.isCreator ? 'creator' : (content.canEdit ? 'editor' : 'viewer')
    });

    // 广播新用户加入
    this.broadcast({
      type: 'userJoined',
      user: this.users.get(userId)
    });
  }

  // 处理离开房间
  private handleLeave(userId: string) {
    this.connections.delete(userId);
    this.users.delete(userId);

    // 广播用户离开
    this.broadcast({
      type: 'userLeft',
      userId
    });
  }

  // 处理绘画数据
  private handleDraw(data: WhiteboardMessage) {
    this.drawingData.push(data.content);

    // 广播绘画数据
    this.broadcast({
      type: 'draw',
      data: data.content
    });
  }

  // 处理清除画板
  private handleClear(data: WhiteboardMessage) {
    this.drawingData = [];

    // 广播清除命令
    this.broadcast({
      type: 'clear'
    });
  }

  // 处理聊天消息
  private handleChat(data: WhiteboardMessage) {
    this.chatHistory.push({
      userId: data.userId,
      message: data.content.text,
      timestamp: data.timestamp
    });

    // 广播聊天消息
    this.broadcast({
      type: 'chat',
      message: {
        userId: data.userId,
        text: data.content.text,
        timestamp: data.timestamp
      }
    });
  }

  // 广播消息给所有连接的客户端
  private broadcast(message: any, excludeUserId?: string) {
    const messageStr = JSON.stringify(message);

    this.connections.forEach((connection, userId) => {
      if (userId !== excludeUserId) {
        connection.send(messageStr);
      }
    });
  }

  // 加载持久化数据
  private async loadPersistedData() {
    try {
      // 从数据库加载数据
      const stored = await this.ctx.storage.get('whiteboardState');
      if (stored) {
        const state = JSON.parse(stored as string);
        this.drawingData = state.drawingData || [];
        this.chatHistory = state.chatHistory || [];
      }
    } catch (error) {
      console.error('Error loading persisted data:', error);
    }
  }

  // 保存状态到持久化存储
  private async persistState() {
    try {
      await this.ctx.storage.put('whiteboardState', JSON.stringify({
        drawingData: this.drawingData,
        chatHistory: this.chatHistory
      }));
    } catch (error) {
      console.error('Error persisting state:', error);
    }
  }

  // 当客户端断开连接时
  onClose(connection: Connection) {
    // 找到断开连接的用户
    let disconnectedUserId: string | undefined;
    this.connections.forEach((conn, userId) => {
      if (conn === connection) {
        disconnectedUserId = userId;
      }
    });

    if (disconnectedUserId) {
      this.handleLeave(disconnectedUserId);
    }
  }
}

// 导出默认处理程序
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
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

    return new Response('Expected WebSocket', { status: 426 });
  }
};