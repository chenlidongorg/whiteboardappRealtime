import { DurableObjectState } from 'cloudflare:workers';
import { ChatMessage, UserSession, MessageType, UserRole } from '../shared';

// 定义环境变量接口
interface Env {
  ASSETS: any; // 公开访问的静态文件
  WhiteboardRealTime: DurableObjectNamespace; // 白板实时持久化对象命名空间
}

// WebSocket 消息类型接口
interface WebSocketMessage {
  type: string; // 消息类型
  content?: any; // 消息内容（可选）
}

// Chat类定义
export class Chat {
  private fileName: string | null = null; // 存储文件名
  private users: Map<string, UserSession> = new Map(); // 用户列表
  private messages: ChatMessage[] = []; // 聊天记录
  private drawingData: any[] = []; // 绘图数据
  private connections: Set<WebSocket> = new Set(); // 连接集合
  private connectionToUser: Map<WebSocket, string> = new Map(); // WebSocket 到用户的映射

  constructor(private state: DurableObjectState, private env: Env) {
    // 构造函数，用于初始化持久化状态
  }

  // 处理新连接的 WebSocket
  private handleWebSocket(webSocket: WebSocket) {
    this.connections.add(webSocket);
    webSocket.addEventListener('message', (event) => this.onMessage(webSocket, event.data));
    webSocket.addEventListener('close', () => this.onClose(webSocket));
  }

  // 处理 WebSocket 关闭事件
  private onClose(webSocket: WebSocket) {
    const userId = this.connectionToUser.get(webSocket);
    if (userId) {
      const user = this.users.get(userId);
      if (user) {
        this.users.delete(userId);
        this.sendSystemMessage(`${user.userName} 离开了房间`);
        this.broadcastUserList(); // 广播用户列表
      }
      this.connectionToUser.delete(webSocket);
    }
    this.connections.delete(webSocket);
  }

  // 处理 WebSocket 收到的消息
  private async onMessage(webSocket: WebSocket, messageData: string) {
    try {
      const data = JSON.parse(messageData) as WebSocketMessage;
      if (!data.type) {
        throw new Error('Missing message type'); // 缺失消息类型
      }

      // 根据消息类型处理不同操作
      switch (data.type) {
        case 'create': // 创建房间
          this.handleCreate(webSocket, data);
          break;
        case 'join': // 加入房间
          this.handleJoin(webSocket, data);
          break;
        case 'chat': // 处理聊天消息
          this.handleChat(webSocket, data);
          break;
        case 'draw': // 处理绘图数据
          this.handleDraw(webSocket, data);
          break;
        case 'clear': // 清空绘图数据
          this.handleClear(webSocket);
          break;
        default:
          console.warn('Unknown message type:', data.type); // 未知的消息类型
      }
    } catch (error) {
      console.error('Error processing message:', error); // 处理消息错误
      webSocket.send(JSON.stringify({ type: 'error', content: 'Invalid message format' })); // 无效的消息格式
    }
  }

  // 注册用户会话
  private loginUserSession(webSocket: WebSocket, userId: string, userName: string, role: string): UserSession | null {
    if (!userId || !userName) {
      webSocket.send(JSON.stringify({ type: 'error', content: 'Missing userId or userName' }));
      return null;
    }

    const userSession: UserSession = {
      userId,
      userName,
      role: role || UserRole.VIEWER, // 默认角色为 VIEWER
      roomId: this.state.id.toString(),
    };

    this.users.set(userId, userSession);
    this.connectionToUser.set(webSocket, userId);

    return userSession;
  }

  // 处理创建房间逻辑
  private handleCreate(webSocket: WebSocket, data: WebSocketMessage) {
    const { userId, userName, role, fileName } = data.content;
    const userSession = this.loginUserSession(webSocket, userId, userName, role);
    if (!userSession) return;

    if (fileName) {
      this.fileName = fileName; // 存储文件名
    }

    this.sendSystemMessage(`${userName} 加入了房间`);
    this.broadcastUserList(); // 广播用户列表
  }

  // 处理加入房间逻辑
  private handleJoin(webSocket: WebSocket, data: WebSocketMessage) {
    const { userId, userName, role } = data.content;
    const userSession = this.loginUserSession(webSocket, userId, userName, role);
    if (!userSession) return;

    // 发送初始化数据给加入的用户
    webSocket.send(
      JSON.stringify({
        type: 'init',
        content: {
          messages: this.messages,
          drawingData: this.drawingData,
          users: Array.from(this.users.values()),
          fileName: this.fileName, // 包含文件名
        },
      })
    );

    this.sendSystemMessage(`${userName} 加入了房间`);
    this.broadcastUserList();
  }

  // 处理聊天消息
  private handleChat(webSocket: WebSocket, data: WebSocketMessage) {
    const userId = this.connectionToUser.get(webSocket);
    if (!userId) {
      webSocket.send(JSON.stringify({ type: 'error', content: 'User not joined' }));
      return;
    }

    const user = this.users.get(userId);
    if (!user) return;

    const message: ChatMessage = {
      id: crypto.randomUUID(),
      userId: user.userId,
      userName: user.userName,
      content: data.content?.content,
      timestamp: Date.now(),
      messageType: MessageType.TEXT,
    };

    this.messages.push(message);

    // 如果需要，可以将此消息持久化保存

    const payload = JSON.stringify({ type: 'chat', content: message });
    this.broadcast(payload); // 广播消息
  }

  // 处理绘图数据
  private handleDraw(webSocket: WebSocket, data: WebSocketMessage) {
    const userId = this.connectionToUser.get(webSocket);
    if (!userId) {
      webSocket.send(JSON.stringify({ type: 'error', content: 'User not joined' }));
      return;
    }

    this.drawingData.push(data.content);

    const payload = JSON.stringify({ type: 'draw', content: data.content });
    this.broadcast(payload, webSocket); // 如果需要，可排除发送者
  }

  // 清空绘图
  private handleClear(webSocket: WebSocket) {
    // 可根据需要检查用户权限
    this.drawingData = [];
    const payload = JSON.stringify({ type: 'clear' });
    this.broadcast(payload); // 广播清除消息
  }

  // 广播消息给所有连接者
  private broadcast(message: string, exclude?: WebSocket) {
    for (const ws of this.connections) {
      if (ws !== exclude) {
        ws.send(message);
      }
    }
  }

  // 发送系统消息
  private sendSystemMessage(content: string) {
    const message: ChatMessage = {
      id: crypto.randomUUID(),
      userId: 'system',
      userName: 'System',
      content,
      timestamp: Date.now(),
      messageType: MessageType.SYSTEM,
    };

    this.messages.push(message);

    const payload = JSON.stringify({ type: 'chat', content: message });
    this.broadcast(payload); // 广播系统消息
  }

  // 广播用户列表
  private broadcastUserList() {
    const userList = Array.from(this.users.values());
    const payload = JSON.stringify({ type: 'userList', content: userList });
    this.broadcast(payload); // 广播用户列表
  }

  // 处理 fetch 请求
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }

    const [clientSocket, serverSocket] = Object.values(new WebSocketPair());
    serverSocket.accept(); // 接受 WebSocket 连接
    this.handleWebSocket(serverSocket); // 处理 WebSocket

    return new Response(null, { status: 101, webSocket: clientSocket });
  }
}

// 默认导出用于 Cloudflare Worker 处理 fetch 请求
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.headers.get('Upgrade') === 'websocket') {
      const roomId = url.searchParams.get('room'); // 获取房间ID
      if (!roomId) {
        return new Response('Missing room ID', { status: 400 });
      }

      // 获取对应的 Durable Object 实例
      const objectId = env.WhiteboardRealTime.idFromName(roomId);
      const stub = env.WhiteboardRealTime.get(objectId);

      // 将请求转发给 Durable Object
      return stub.fetch(request);
    }

    // 处理其他请求，例如静态资源
    return env.ASSETS.fetch(request); // 使用 Cloudflare 的 ASSETS 处理请求
  },
};