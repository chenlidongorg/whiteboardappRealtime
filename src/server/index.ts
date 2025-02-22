import { DurableObjectState } from 'cloudflare:workers';
import { ChatMessage, UserSession, MessageType, UserRole, RealTimeCommand, PrefixType, ErrorType } from '../shared';

// 定义环境变量接口
interface Env {
  ASSETS: any; // 公开访问的静态文件
  WhiteboardRealTime: DurableObjectNamespace; // 白板实时持久化对象命名空间
}

// WebSocket 消息类型接口
interface WebSocketMessage {
  type: string; // 消息类型
  content?: any; // 消息内容（可选）
  broadcast?: boolean;
}

// 定义移动层元数据接口
interface Metadata {
    id: string;
    model: string;     // 移动层基本信息
    timestamp: number; // 用于追踪更新时间
}

// Chat类定义
export class Chat {
  private isRoomClosed: boolean = false; // 添加房间状态标记
  private fileName: string | null = null; // 存储文件名
  private users: Map<string, UserSession> = new Map(); // 用户列表
  private messages: ChatMessage[] = []; // 聊天记录
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
        this.sendSystemMessage(`${user.userName}XXXleft_room`);
        this.broadcastUserList(); // 广播用户列表
      }
      this.connectionToUser.delete(webSocket);
    }
    this.connections.delete(webSocket);

    // 检查是否没有连接用户
    if (this.connections.size === 0) {
      // 清理持久化数据
      this.state.storage.deleteAll()
        .then(() => {
          console.log('cleared_data_user_left');
        })
        .catch(error => {
          console.error('failed_clear_data', error);
        });
    }
  }

  // 处理 WebSocket 收到的消息
  private async onMessage(webSocket: WebSocket, messageData: string) {
    try {
      const data = JSON.parse(messageData) as WebSocketMessage;
      if (!data.type) {
        throw new Error('missing_message_type');
      }

      switch (data.type) {
        case RealTimeCommand.create: //创建房间
          this.handleCreate(webSocket, data);
          break;
        case RealTimeCommand.join: //加入房间
          await this.handleJoin(webSocket, data);
          break;
        case RealTimeCommand.chat: //处理聊天消息
          this.handleChat(webSocket, data);
          break;
        case RealTimeCommand.updateBackground:
          this.handleUpdateBackground(webSocket, data);
          break;
        case RealTimeCommand.updateMoveView: // 处理移动层更新
          this.handleUpdateMoveView(webSocket, data);
          break;
        case RealTimeCommand.deleteMoveView: // 处理移动层更新
          this.handleDeleteMoveView(webSocket, data);
          break;
        case RealTimeCommand.userUpdate: // 修改名字
          this.handleUserUpdate(webSocket, data);
          break;
        case RealTimeCommand.clear: //清空绘图数据
          this.handleClear(webSocket);
          break;
        case RealTimeCommand.drawingUpdate:
          await this.handleDrawingUpdate(webSocket, data);
          break;
        case RealTimeCommand.closeRoom:
          await this.handleCloseRoom(webSocket, data);
          break;
        default:
          console.warn('unknown_message_type', data.type);
      }
    } catch (error) {
      console.error('error_processing_message', error);
      this.sendError(webSocket, ErrorType.INVALID_FORMAT);
    }
  }

  // 注册用户会话
  private loginUserSession(webSocket: WebSocket, userId: string, userName: string, role: string): UserSession | null {
    if (!userId || !userName) {
      this.sendError(webSocket, ErrorType.MISSING_USER_INFO);
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

    return userSession;
  }

  // 处理关闭房间的方法
  private async handleCloseRoom(webSocket: WebSocket, data: WebSocketMessage) {
    const userId = this.connectionToUser.get(webSocket);
    if (!userId) return;

    const user = this.users.get(userId);
    if (!user || user.role !== UserRole.HOST) {
      this.sendError(webSocket, ErrorType.ONLY_HOST_CAN_DO);
      return;
    }

    // 标记房间已关闭
    this.isRoomClosed = true;

    const closeMessage = JSON.stringify({
      type: RealTimeCommand.closeRoom,
      content: 'room_closed'
    });
    this.broadcast(closeMessage);

    await new Promise(resolve => setTimeout(resolve, 1000));

    // 断开所有连接
    for (const ws of this.connections) {
      try {
        ws.close(1000, 'room_closed_by_host');
      } catch (error) {
        console.error('error_closing_connection', error);
      }
    }

    // 清理所有数据
    this.connections.clear();
    this.users.clear();
    this.connectionToUser.clear();
    this.messages = [];
    await this.state.storage.deleteAll();
  }

  private handleUserUpdate(webSocket: WebSocket, data: WebSocketMessage) {
    const { userName } = data.content;
    const userId = this.connectionToUser.get(webSocket);

    if (!userId) {
      this.sendError(webSocket, ErrorType.USER_NOT_FOUND);
      return;
    }

    const userSession = this.users.get(userId);
    if (!userSession) {
      this.sendError(webSocket, ErrorType.SESSION_NOT_FOUND);
      return;
    }

    userSession.userName = userName;
    this.users.set(userId, userSession);

    this.sendSystemMessage(`${userName}XXXupdated_name`);
    this.broadcastUserList();
  }

  // 处理创建房间逻辑
  private handleCreate(webSocket: WebSocket, data: WebSocketMessage) {
    const { userId, userName, role, fileName } = data.content;
    const userSession = this.loginUserSession(webSocket, userId, userName, role);
    if (!userSession) return;

    this.state.storage.deleteAll();

    if (fileName) {
      this.fileName = fileName;
    }

    this.sendSystemMessage(`${userName}XXXjoined_room`);
    this.broadcastUserList();
  }

  // 处理加入房间逻辑
  private async handleJoin(webSocket: WebSocket, data: WebSocketMessage) {
    if (this.isRoomClosed) {
      this.sendError(webSocket, ErrorType.ROOM_IS_CLOSED);
      webSocket.close(1000, 'room_is_closed');
      return;
    }

    const { userId, userName, role } = data.content;
    const userSession = this.loginUserSession(webSocket, userId, userName, role);
    if (!userSession) return;

    let initData: any = {
      messages: this.messages,
      users: Array.from(this.users.values()),
      fileName: this.fileName
    };

    // 安全地获取和添加 moveModels
    try {
      const moveModelsMap = await this.state.storage.list({
        prefix: PrefixType.moveView
      });

      const moveModels = Array.from(moveModelsMap.values());
      if (moveModels.length > 0) {
        initData.moveModels = moveModels;
      } else {
        initData.moveModels = [];
      }
    } catch (error) {
      console.error('error_fetching_moveModels', error);
      initData.moveModels = [];
    }

    // 安全地获取和添加 bgModel
    try {
      const bgModel = await this.state.storage.get(RealTimeCommand.updateBackground);
      if (bgModel) {
        initData.bgModel = bgModel;
      }
    } catch (error) {
      console.error('error_fetching_bgModel', error);
      initData.bgModel = null;
    }

    // 安全地获取绘画线条
    try {
      const drawingModelsMap = await this.state.storage.list({
        prefix: PrefixType.drawing
      });

      const drawingModels = Array.from(drawingModelsMap.values());
      if (drawingModels.length > 0) {
        initData.drawingModels = drawingModels;
      } else {
        initData.drawingModels = [];
      }
    } catch (error) {
      console.error('error_fetching_drawingModels', error);
      initData.drawingModels = [];
    }

    webSocket.send(JSON.stringify({
      type: RealTimeCommand.initSetup,
      content: initData
    }));

    this.sendSystemMessage(`${userName}XXXjoined_room`);
    this.broadcastUserList();
  }

  // 处理聊天消息
  private handleChat(webSocket: WebSocket, data: WebSocketMessage) {
    const userId = this.connectionToUser.get(webSocket);
    if (!userId) {
      this.sendError(webSocket, ErrorType.USER_NOT_JOINED);
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

    const payload = JSON.stringify({ type: RealTimeCommand.chat, content: message });
    this.broadcast(payload);
  }

  // 处理背景更新的具体实现
  private handleUpdateBackground(webSocket: WebSocket, data: WebSocketMessage) {
    if (data.content) {
      this.state.storage.put(RealTimeCommand.updateBackground, data.content);
      if (!data.broadcast) return;
      const payload = JSON.stringify({ type: RealTimeCommand.updateBackground, content: data.content });
      this.broadcast(payload, webSocket);
    }
  }

  // 处理移动层更新
  private async handleUpdateMoveView(webSocket: WebSocket, data: WebSocketMessage) {
    if (data.content) {
      const { id, model } = data.content;
      const metadata: Metadata = {
        id,
        model,
        timestamp: Date.now()
      };

      const storageKey = `${PrefixType.moveView}${id}`;
      await this.state.storage.put(storageKey, metadata);

      if (!data.broadcast) return;
      this.broadcast(JSON.stringify({
        type: RealTimeCommand.updateMoveView,
        content: data.content
      }), webSocket);
    }
  }

  // 处理删除移动层
  private async handleDeleteMoveView(webSocket: WebSocket, data: WebSocketMessage) {
    if (data.content) {
      const { id } = data.content;
      const storageKey = `${PrefixType.moveView}${id}`;
      await this.state.storage.delete(storageKey);

      this.broadcast(JSON.stringify({
        type: RealTimeCommand.deleteMoveView,
        content: { id }
      }), webSocket);
    }
  }

  // 处理绘画更新
  private async handleDrawingUpdate(webSocket: WebSocket, data: WebSocketMessage) {
    if (!data.content) return;

    try {
      const { id, action, model } = data.content;

      if (!['addStrokes', 'moveStrokes', 'removeStrokes', 'clear'].includes(action)) {
        throw new Error('invalid_drawing_action');
      }

      const metadata: Metadata = {
        id,
        model,
        timestamp: Date.now()
      };

      const storageKey = `${PrefixType.drawing}${id}`;

      switch (action) {
        case 'addStrokes':
          await this.state.storage.put(storageKey, metadata);
          break;
        case 'moveStrokes':
          await this.state.storage.put(storageKey, metadata);
          break;
        case 'removeStrokes':
          await this.state.storage.put(storageKey, metadata);
          break;
        case 'clear':
          await this.state.storage.delete({ prefix: PrefixType.drawing });
          break;
      }

      if (!data.broadcast) return;
      const payload = JSON.stringify({
        type: RealTimeCommand.drawingUpdate,
        content: data.content
      });

      this.broadcast(payload, webSocket);
    } catch (error) {
      console.error('error_handling_drawing_update', error);
      this.sendError(webSocket, ErrorType.DRAWING_UPDATE_FAILED);
    }
  }

  // 清空绘图
  private handleClear(webSocket: WebSocket) {
    const payload = JSON.stringify({ type: RealTimeCommand.clear });
    this.broadcast(payload);
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

    const payload = JSON.stringify({ type: RealTimeCommand.chat, content: message });
    this.broadcast(payload);
  }

  // 添加一个用于发送错误消息的辅助函数
  private sendError(webSocket: WebSocket, errorType: ErrorType) {
    webSocket.send(JSON.stringify({
      type: RealTimeCommand.error,
      content: errorType
    }));
  }

  // 广播用户列表
  private broadcastUserList() {
    const userList = Array.from(this.users.values());
    const payload = JSON.stringify({ type: RealTimeCommand.userList, content: userList });
    this.broadcast(payload);
  }

  // 处理 fetch 请求
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('expected_websocket', { status: 426 });
    }

    const [clientSocket, serverSocket] = Object.values(new WebSocketPair());
    serverSocket.accept();
    this.handleWebSocket(serverSocket);

    return new Response(null, { status: 101, webSocket: clientSocket });
  }
}

// 默认导出用于 Cloudflare Worker 处理 fetch 请求
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.headers.get('Upgrade') === 'websocket') {
      const roomId = url.searchParams.get('room');
      if (!roomId) {
        return new Response('missing_room_id', { status: 400 });
      }

      const objectId = env.WhiteboardRealTime.idFromName(roomId);
      const stub = env.WhiteboardRealTime.get(objectId);

      return stub.fetch(request);
    }

    return env.ASSETS.fetch(request);
  },
};