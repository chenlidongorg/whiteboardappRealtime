// src/server/index.ts

import { DurableObjectState } from 'cloudflare:workers';
import { ChatMessage, UserSession, MessageType, UserRole} from '../shared';

interface Env {
  ASSETS: any;
  WhieteboardRealTime: DurableObjectNamespace;
}

// WebSocket 消息类型
interface WebSocketMessage {
  type: string;
  content?: any;
}


export class Chat {
// 新增一个字段来存储文件名
  private fileName: string | null = null;
  private users: Map<string, UserSession> = new Map();
  private messages: ChatMessage[] = [];
  private drawingData: any[] = [];
  private connections: Set<WebSocket> = new Set();
  private connectionToUser: Map<WebSocket, string> = new Map();

  constructor(private state: DurableObjectState, private env: Env) {
    // 如果需要，可以在这里加载持久化的状态

    //super(state, env);
    //this.currentlyConnectedWebSockets = 0;

  }



  private handleWebSocket(webSocket: WebSocket) {
    this.connections.add(webSocket);
    webSocket.addEventListener('message', (event) => this.onMessage(webSocket, event.data));
    webSocket.addEventListener('close', () => this.onClose(webSocket));
  }

  private onClose(webSocket: WebSocket) {
    const userId = this.connectionToUser.get(webSocket);
    if (userId) {
      const user = this.users.get(userId);
      if (user) {
        this.users.delete(userId);
        this.sendSystemMessage(`${user.userName} 离开了房间`);
        this.broadcastUserList();
      }
      this.connectionToUser.delete(webSocket);
    }
    this.connections.delete(webSocket);
  }

  private async onMessage(webSocket: WebSocket, messageData: string) {
    try {
      const data = JSON.parse(messageData) as WebSocketMessage;
      if (!data.type) {
        throw new Error('Missing message type');
      }

      switch (data.type) {
        case 'create':
        this.handleCreate(webSocket, data);
        break;
        case 'join':
          this.handleJoin(webSocket, data);
          break;
        case 'chat':
          this.handleChat(webSocket, data);
          break;
        case 'draw':
          this.handleDraw(webSocket, data);
          break;
        case 'clear':
          this.handleClear(webSocket);
          break;
        default:
          console.warn('Unknown message type:', data.type);
      }
    } catch (error) {
      console.error('Error processing message:', error);
      webSocket.send(JSON.stringify({ type: 'error', content: 'Invalid message format' }));
    }
  }

//注册用户
private processUserSession(webSocket: WebSocket, data: WebSocketMessage){ //: UserSession | null {
  const { userId, userName, role } = data.content;
  if (!userId || !userName) {
    webSocket.send(JSON.stringify({ type: 'error', content: 'Missing userId or userName' }));
    return null;
  }

  const userSession: UserSession = {
    userId,
    userName,
    role: role || UserRole.VIEWER,
    roomId: this.state.id.toString(),
  };

  this.users.set(userId, userSession);
  this.connectionToUser.set(webSocket, userId);

  //return userSession;

}

// 处理文件名保存，以及初始化信息发起人信息
  private handleCreate(webSocket: WebSocket, data: WebSocketMessage) {

    this.processUserSession(webSocket, data);

    const { fileName } = data.content;
    if (fileName) {
      this.fileName = fileName; // 存储文件名
    }

  }



  private handleJoin(webSocket: WebSocket, data: WebSocketMessage) {
    this.processUserSession(webSocket, data);

    // 发送初始化数据 发送到哪里？
    webSocket.send(
      JSON.stringify({
        type: 'init',
        content: {
          messages: this.messages,
          drawingData: this.drawingData,
          users: Array.from(this.users.values()),
          fileName: this.fileName, // 将文件名到添加初始化数据中
        },
      })
    );

    this.sendSystemMessage(`${userName} 加入了房间`);
    this.broadcastUserList();

  }


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

    // 如果需要，将消息保存到存储

    const payload = JSON.stringify({ type: 'chat', content: message });
    this.broadcast(payload);
  }

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

  private handleClear(webSocket: WebSocket) {
    // 可根据需要检查用户权限
    this.drawingData = [];
    const payload = JSON.stringify({ type: 'clear' });
    this.broadcast(payload);
  }

  private broadcast(message: string, exclude?: WebSocket) {
    for (const ws of this.connections) {
      if (ws !== exclude) {
        ws.send(message);
      }
    }
  }

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
    this.broadcast(payload);
  }

  private broadcastUserList() {
    const userList = Array.from(this.users.values());
    const payload = JSON.stringify({ type: 'userList', content: userList });
    this.broadcast(payload);
  }


   async fetch(request: Request): Promise<Response> {
      if (request.headers.get('Upgrade') !== 'websocket') {
        return new Response('Expected WebSocket', { status: 426 });
      }

      const [clientSocket, serverSocket] = Object.values(new WebSocketPair());
      serverSocket.accept();
      this.handleWebSocket(serverSocket);

      return new Response(null, { status: 101, webSocket: clientSocket });
    }

}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.headers.get('Upgrade') === 'websocket') {
      const roomId = url.searchParams.get('room');
      if (!roomId) {
        return new Response('Missing room ID', { status: 400 });
      }

      // 获取对应的 Durable Object 实例
      const objectId = env.WhieteboardRealTime.idFromName(roomId);
      const stub = env.WhieteboardRealTime.get(objectId);

      // 将请求转发给 Durable Object
      return stub.fetch(request);
    }

    // 其他请求，例如静态资源
    return env.ASSETS.fetch(request);
  },
};