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

const LEGACY_COLLAB_PROTOCOL_VERSION = 1;

// Chat类定义
export class Chat {

    private static readonly EMPTY_ROOM_CLEANUP_DELAY_MS = 3 * 60 * 1000; // 空房间延迟清理，避免短暂后台切换导致清库

    private isRoomClosed: boolean = false; // 添加房间状态标记
    private fileName: string | null = null; // 存储文件名
    private roomMinProtocolVersion: number | null = null; // 房间最低协同协议版本（由发起者决定）
    private users: Map<string, UserSession> = new Map(); // 用户列表
    private messages: ChatMessage[] = []; // 聊天记录
    private connections: Set<WebSocket> = new Set(); // 连接集合
    private connectionToUser: Map<WebSocket, string> = new Map(); // WebSocket 到用户的映射

    private messageLimiter = new RateLimiter(10, 5000); // 5秒内最多10条消息
    private drawingLimiter = new RateLimiter(100, 5000); // 5秒内最多100次绘图操作
    private pendingCleanupAt: number | null = null;


    constructor(private state: DurableObjectState, private env: Env) {
        // 构造函数，用于初始化持久化状态




    }

    private cancelPendingCleanup() {
        if (this.pendingCleanupAt === null) return;
        this.pendingCleanupAt = null;
        this.state.storage.deleteAlarm()
            .catch((error) => {
                console.error('failed_cancel_cleanup_alarm', error);
            });
    }

    private scheduleEmptyRoomCleanup() {
        if (this.pendingCleanupAt !== null) return;
        const cleanupAt = Date.now() + Chat.EMPTY_ROOM_CLEANUP_DELAY_MS;
        this.pendingCleanupAt = cleanupAt;
        this.state.storage.setAlarm(cleanupAt)
            .then(() => {
                console.log('scheduled_empty_room_cleanup');
            })
            .catch((error) => {
                console.error('failed_schedule_cleanup', error);
                this.pendingCleanupAt = null;
            });
    }

    private async clearRoomData(reason: string) {
        this.pendingCleanupAt = null;
        this.connections.clear();
        this.users.clear();
        this.connectionToUser.clear();
        this.messages = [];
        this.roomMinProtocolVersion = null;
        this.fileName = null;
        this.isRoomClosed = false;

        await this.state.storage.deleteAll();
        await this.state.storage.deleteAlarm();
        console.log(`cleared_room_data:${reason}`);
    }

    async alarm() {
        this.pendingCleanupAt = null;
        if (this.connections.size > 0) {
            return;
        }

        try {
            await this.clearRoomData('empty_room_timeout');
        } catch (error) {
            console.error('failed_cleanup_on_alarm', error);
        }
    }

    // 处理新连接的 WebSocket
    private handleWebSocket(webSocket: WebSocket) {
        this.cancelPendingCleanup();
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

        // 检查是否没有连接用户：延迟清理，给移动端切后台留缓冲时间
        if (this.connections.size === 0) {
            this.scheduleEmptyRoomCleanup();
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
                await this.handleCreate(webSocket, data);
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
    private loginUserSession(
        webSocket: WebSocket,
        userId: string,
        userName: string,
        role: string,
        protocolVersion: number,
        platform?: string,
        appVersion?: string
    ): UserSession | null {
        if (!userId || !userName) {
            this.sendError(webSocket, ErrorType.MISSING_USER_INFO);
            return null;
        }

        const userSession: UserSession = {
            userId,
            userName,
            role: role || UserRole.VIEWER,
            roomId: this.state.id.toString(),
            protocolVersion,
            platform,
            appVersion,
        };

        this.users.set(userId, userSession);
        this.connectionToUser.set(webSocket, userId);

        return userSession;
    }

    private resolveClientProtocolVersion(content: any): number {
        const protocolVersion = content?.protocolVersion;
        if (typeof protocolVersion === 'number' && Number.isInteger(protocolVersion) && protocolVersion > 0) {
            return protocolVersion;
        }
        // 兼容旧客户端：未上报协议版本时默认按 v1
        return LEGACY_COLLAB_PROTOCOL_VERSION;
    }

    private resolveClientMeta(content: any): { protocolVersion: number; platform?: string; appVersion?: string } {
        const protocolVersion = this.resolveClientProtocolVersion(content);
        const platform = typeof content?.platform === 'string' ? content.platform : undefined;
        const appVersion = typeof content?.appVersion === 'string' ? content.appVersion : undefined;

        return { protocolVersion, platform, appVersion };
    }

    private validateJoinProtocolCompatibility(webSocket: WebSocket, joinerVersion: number): boolean {
        const requiredMinVersion = this.roomMinProtocolVersion ?? LEGACY_COLLAB_PROTOCOL_VERSION;

        if (joinerVersion < requiredMinVersion) {
            this.sendError(webSocket, ErrorType.UPGRADE_REQUIRED);
            try {
                webSocket.close(1008, ErrorType.UPGRADE_REQUIRED);
            } catch (error) {
                console.error('failed_close_on_upgrade_required', error);
            }
            return false;
        }

        return true;
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
            content: 'room_closed_by_host'
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

        // 主持人主动关房：立即清理
        await this.clearRoomData('host_closed_room');
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
    private async handleCreate(webSocket: WebSocket, data: WebSocketMessage) {
        if (!data.content || !data.content.userId || !data.content.userName || !data.content.role) {
            this.sendError(webSocket, ErrorType.MISSING_USER_INFO);
            return;
        }

        const { userId, userName, role, fileName } = data.content;
        const { protocolVersion, platform, appVersion } = this.resolveClientMeta(data.content);
        const hasActiveUsers = this.users.size > 0;

        this.cancelPendingCleanup();
        this.isRoomClosed = false;

        // 确保只有 HOST 角色的用户才能创建房间
        if (role !== UserRole.HOST) {
            this.sendError(webSocket, ErrorType.ROOM_IS_CLOSED);
            return;
        }

        // 发起者协议版本决定房间最低版本
        this.roomMinProtocolVersion = protocolVersion;

        // 首次创建房间时清理旧缓存；有人在线时视为重连，不清库
        if (!hasActiveUsers) {
            await this.state.storage.deleteAll();
            await this.state.storage.deleteAlarm();
        }

        const userSession = this.loginUserSession(webSocket, userId, userName, role, protocolVersion, platform, appVersion);
        if (!userSession) return;

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
            webSocket.close(1000, ErrorType.ROOM_IS_CLOSED);
            return;
        }

        if (!data.content || !data.content.userId || !data.content.userName || !data.content.role) {
            this.sendError(webSocket, ErrorType.MISSING_USER_INFO);
            return;
        }

        const { userId, userName, role } = data.content;
        const { protocolVersion, platform, appVersion } = this.resolveClientMeta(data.content);

        // 检查房间是否存在 (通过检查是否有其他用户或者是否有 HOST 用户)
        const roomExists = this.users.size > 0;

        // 如果房间不存在且用户不是 HOST，则发送错误
        if (!roomExists && role !== UserRole.HOST) {
            this.sendError(webSocket, ErrorType.ROOM_IS_CLOSED);
            return;
        }

        if (!this.validateJoinProtocolCompatibility(webSocket, protocolVersion)) {
            return;
        }

        const userSession = this.loginUserSession(webSocket, userId, userName, role, protocolVersion, platform, appVersion);
        if (!userSession) return;

        let initData: any = {
            messages: this.messages,
            users: Array.from(this.users.values()),
            fileName: this.fileName,
            roomMinProtocolVersion: this.roomMinProtocolVersion ?? LEGACY_COLLAB_PROTOCOL_VERSION
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


    // 添加内容净化方法
    private sanitizeContent(content: string): string {
        // 移除可能的HTML/JS注入
        let sanitized = content
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');

        // 可以添加更多过滤逻辑，如敏感词过滤等

        return sanitized;
    }

    // 处理聊天消息
    private handleChat(webSocket: WebSocket, data: WebSocketMessage) {
        const userId = this.connectionToUser.get(webSocket);
        if (!userId) {
            this.sendError(webSocket, ErrorType.USER_NOT_JOINED);
            return;
        }

        if (this.messageLimiter.isRateLimited(userId)) {
            this.sendError(webSocket, ErrorType.RATE_LIMITED);
            return;
        }

        const user = this.users.get(userId);
        if (!user) return;


        // 验证消息内容
        const content = data.content?.content;
        if (!content || typeof content !== 'string') {
            this.sendError(webSocket, ErrorType.INVALID_FORMAT);
            return;
        }

        // 检查消息长度
        if (content.length > 1000) { // 限制消息长度
            this.sendError(webSocket, ErrorType.MESSAGE_TOO_LONG);
            return;
        }

        // 简单的内容过滤，可以根据需要扩展
        const filteredContent = this.sanitizeContent(content);

        const message: ChatMessage = {
            id: crypto.randomUUID(),
            userId: user.userId,
            userName: user.userName,
            content: filteredContent,
            timestamp: Date.now(),
            messageType: MessageType.TEXT,
        };

        this.messages.push(message);

        const payload = JSON.stringify({ type: RealTimeCommand.chat, content: message });
        this.broadcast(payload);
    }

    // 处理背景更新的具体实现
    private handleUpdateBackground(webSocket: WebSocket, data: WebSocketMessage) {

        const userId = this.connectionToUser.get(webSocket);
        if (!userId) return;

        if (this.drawingLimiter.isRateLimited(userId)) {
            this.sendError(webSocket, ErrorType.RATE_LIMITED);
            return;
        }

        if (data.content) {
            this.state.storage.put(RealTimeCommand.updateBackground, data.content);
            if (!data.broadcast) return;
            const payload = JSON.stringify({ type: RealTimeCommand.updateBackground, content: data.content });
            this.broadcast(payload, webSocket);
        }
    }


    // 处理移动层更新
    private async handleUpdateMoveView(webSocket: WebSocket, data: WebSocketMessage) {

        const userId = this.connectionToUser.get(webSocket);
        if (!userId) return;

        if (this.drawingLimiter.isRateLimited(userId)) {
            this.sendError(webSocket, ErrorType.RATE_LIMITED);
            return;
        }

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

        const userId = this.connectionToUser.get(webSocket);
        if (!userId) return;

        if (this.drawingLimiter.isRateLimited(userId)) {
            this.sendError(webSocket, ErrorType.RATE_LIMITED);
            return;
        }


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

            const userId = this.connectionToUser.get(webSocket);
            if (!userId) return;

            if (this.drawingLimiter.isRateLimited(userId)) {
                this.sendError(webSocket, ErrorType.RATE_LIMITED);
                return;
            }


            const { id, action, model } = data.content;

            if (!['addStrokes', 'moveStrokes', 'removeStrokes', 'clearStrokes'].includes(action)) {
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
            case 'clearStrokes':
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



    // 清空所有
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


class RateLimiter {
    private requestCounts: Map<string, {count: number, timestamp: number}> = new Map();
    private maxRequests: number;
    private windowMs: number;

    constructor(maxRequests: number = 50, windowMs: number = 60000) {
        this.maxRequests = maxRequests;
        this.windowMs = windowMs;
    }

    isRateLimited(key: string): boolean {
        const now = Date.now();
        const record = this.requestCounts.get(key);

        if (!record) {
            this.requestCounts.set(key, { count: 1, timestamp: now });
            return false;
        }

        if (now - record.timestamp > this.windowMs) {
            // 如果时间窗口已过，重置计数
            this.requestCounts.set(key, { count: 1, timestamp: now });
            return false;
        }

        if (record.count >= this.maxRequests) {
            return true; // 速率限制触发
        }

        // 更新请求计数
        record.count += 1;
        this.requestCounts.set(key, record);
        return false;
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
