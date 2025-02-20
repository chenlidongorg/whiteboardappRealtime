import { DurableObjectState } from 'cloudflare:workers';
import { ChatMessage, UserSession, MessageType, UserRole, RealTimeCommand, PrefixType } from '../shared';

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
        this.sendSystemMessage(`${user.userName}XXXleave_room`);
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
              console.log('Cleared background data as last user left.');
            })

            .catch(error => {
              console.error('Failed to clear data:', error);
            });
        }


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
          console.warn('Unknown message type:', data.type); //未知的消息类型

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


// 处理关闭房间的方法
  private async handleCloseRoom(webSocket: WebSocket, data: WebSocketMessage) {
    const userId = this.connectionToUser.get(webSocket);
    if (!userId) return;

    const user = this.users.get(userId);


    if (!user || user.role !== UserRole.HOST) {

      // 只有房主可以关闭房间
      webSocket.send(JSON.stringify({
        type: 'error',
        content: 'Only host can close the room'
      }));

      return;
    }

    // 标记房间已关闭
    this.isRoomClosed = true;

// 广播房间关闭消息
    const closeMessage = JSON.stringify({
      type: RealTimeCommand.closeRoom,
      content: 'room_closed'
    });
    this.broadcast(closeMessage);

    // 广播房间关闭消息
    //this.sendSystemMessage(`room_closed`);

    // 等待一小段时间确保消息发送完成
    await new Promise(resolve => setTimeout(resolve, 1000));

    // 断开所有连接
    for (const ws of this.connections) {
      try {
        ws.close(1000, 'Room closed by host');
      } catch (error) {
        console.error('Error closing connection:', error);
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
    // 从消息内容中获取新的用户名
    const {userName} = data.content;

    // 获取当前websocket连接对应的用户ID
    const userId = this.connectionToUser.get(webSocket);

    if (!userId) {
        // 如果找不到userId,返回错误
        webSocket.send(JSON.stringify({
            type: 'error',
            content: 'User not found'
        }));
        return;
    }

    // 从users Map中获取用户会话
    const userSession = this.users.get(userId);
    if (!userSession) {
        // 如果找不到用户会话,返回错误
        webSocket.send(JSON.stringify({
            type: 'error',
            content: 'User session not found'
        }));
        return;
    }

    // 更新用户会话中的用户名
    userSession.userName = userName;

    // 更新users Map中的数据
    this.users.set(userId, userSession);

    // 发送系统消息通知名字更新
    this.sendSystemMessage(`${userName}XXXupdate_name`);

    // 广播更新后的用户列表给所有连接的客户端
    this.broadcastUserList();
}

  // 处理创建房间逻辑
  private handleCreate(webSocket: WebSocket, data: WebSocketMessage) {

    const { userId, userName, role, fileName } = data.content;
    const userSession = this.loginUserSession(webSocket, userId, userName, role);
    if (!userSession) return;

    this.state.storage.deleteAll();

    if (fileName) {
      this.fileName = fileName; // 存储文件名
    }

    this.sendSystemMessage(`${userName}XXXjoined_room`);
    this.broadcastUserList(); // 广播用户列表
  }

  // 处理加入房间逻辑
  private async handleJoin(webSocket: WebSocket, data: WebSocketMessage) {

  if (this.isRoomClosed) {
        webSocket.send(JSON.stringify({
          type: 'error',
          content: 'Room is closed'
        }));
        webSocket.close(1000, 'Room is closed');
        return;
      }


      const { userId, userName, role } = data.content;
      const userSession = this.loginUserSession(webSocket, userId, userName, role);
      if (!userSession) return;

      // 初始化数据对象
      let initData: any = {
          messages: this.messages,
          users: Array.from(this.users.values()),
          fileName: this.fileName
      };

      // 安全地获取和添加 moveModels

          try {
              // 使用正确的list选项格式
              const moveModelsMap = await this.state.storage.list({
                  prefix: PrefixType.moveView
              });

              // 将Map转换为数组
              const moveModels = Array.from(moveModelsMap.values());

              if (moveModels.length > 0) {
                  initData.moveModels = moveModels;
              } else {
                  initData.moveModels = [];
              }
          } catch (error) {
              console.error('Error fetching moveModels:', error);
              initData.moveModels = [];
          }

      // 安全地获取和添加 bgModel
      try {
          const bgModel = await this.state.storage.get(RealTimeCommand.updateBackground);
          if (bgModel) {
              initData.bgModel = bgModel;
          }
      } catch (error) {
          console.error('Error fetching bgModel:', error);
          // 如果获取失败,设置为null或适当的默认值
          initData.bgModel = null;
      }

// 安全地获取 绘画线条

          try {
              // 使用正确的list选项格式
              const drawingModelsMap = await this.state.storage.list({
                  prefix: PrefixType.drawing
              });

              // 将Map转换为数组
              const drawingModels = Array.from(drawingModelsMap.values());

              if (drawingModels.length > 0) {
                  initData.drawingModels = drawingModels;
              } else {
                  initData.drawingModels = [];
              }
          } catch (error) {
              console.error('Error fetching drawingModels:', error);
              initData.drawingModels = [];
          }


      // 发送初始化数据给加入的用户
      webSocket.send(
          JSON.stringify({
              type: RealTimeCommand.initSetup,
              content: initData
          })
      );

      this.sendSystemMessage(`${userName}XXXjoined_room`);
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

    const payload = JSON.stringify({ type: RealTimeCommand.chat, content: message });
    this.broadcast(payload); // 广播消息
  }



// 处理背景更新的具体实现
private handleUpdateBackground(webSocket: WebSocket, data: WebSocketMessage) {
    if (data.content) {
        // 将背景数据持久化，比如保存在 Durable Object 的 state 中
        this.state.storage.put(RealTimeCommand.updateBackground, data.content);

        if (!data.broadcast) return;

        const payload = JSON.stringify({ type: RealTimeCommand.updateBackground, content: data.content });
        this.broadcast(payload, webSocket); // 广播消息

    }
}


// 处理移动层更新
    private async handleUpdateMoveView(webSocket: WebSocket, data: WebSocketMessage) {
        if (data.content) {
            const { id, model } = data.content;

            // 准备元数据
            const metadata: Metadata = {
                id,
                model,
                timestamp: Date.now()
            };


            // 保存元数据到storage
            const storageKey = `${PrefixType.moveView}${id}`;
            await this.state.storage.put(storageKey, metadata);

            if (!data.broadcast) return;
            // 广播更新消息给所有连接的客户端
            this.broadcast(JSON.stringify({
                type: RealTimeCommand.updateMoveView,
                content: data.content // 直接转发原始数据给其他客户端
            }), webSocket);
        }
    }


    // 处理删除移动层
    private async handleDeleteMoveView(webSocket: WebSocket, data: WebSocketMessage) {
         if (data.content) {
            const { id } = data.content;
            const storageKey = `${PrefixType.moveView}${id}`;
            // 删除storage中的元数据
            await this.state.storage.delete(storageKey);

            // 广播删除消息
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

           // 添加action类型检查
                     if (!['addStrokes', 'moveStrokes', 'removeStrokes', 'clear'].includes(action)) {
                         throw new Error('Invalid drawing action');
                     }

                     const metadata: Metadata = {
                         id,
                         model,
                         timestamp: Date.now()
                     };

                     const storageKey = `${PrefixType.drawing}${id}`;

                     // 优化存储逻辑
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
           console.error('Error handling drawing update:', error);
           // 可以添加错误响应
           webSocket.send(JSON.stringify({
               type: 'error',
               content: 'Failed to process drawing update'
           }));
       }
   }



  // 清空绘图
  private handleClear(webSocket: WebSocket) {
    // 可根据需要检查用户权限

    const payload = JSON.stringify({ type: RealTimeCommand.clear });
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

    const payload = JSON.stringify({ type: RealTimeCommand.chat, content: message });
    this.broadcast(payload); // 广播系统消息
  }

  // 广播用户列表
  private broadcastUserList() {
    const userList = Array.from(this.users.values());
    const payload = JSON.stringify({ type: RealTimeCommand.userList, content: userList });
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