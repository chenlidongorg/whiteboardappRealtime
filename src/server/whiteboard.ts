// src/server/whiteboard.ts

export class WhiteboardRoom {
  private sessions: Set<WebSocket>;
  private state: any;

  constructor(private state: DurableObjectState, private env: Env) {
    this.sessions = new Set();
    this.state = {};
  }

  async fetch(request: Request) {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    await this.handleSession(server);

    return new Response(null, {
      status: 101,
      webSocket: client,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': '*',
      }
    });
  }

  private async handleSession(webSocket: WebSocket) {
    webSocket.accept();
    this.sessions.add(webSocket);

    // 发送当前状态给新连接的客户端
    webSocket.send(JSON.stringify({
      type: 'init',
      state: this.state
    }));

    webSocket.addEventListener('message', async (msg) => {
      try {
        const data = JSON.parse(msg.data);
        // 更新状态
        this.state = {...this.state, ...data};

        // 广播给所有连接的客户端
        this.broadcast(msg.data, webSocket);
      } catch (err) {
        console.error('Error processing message:', err);
      }
    });

    webSocket.addEventListener('close', () => {
      this.sessions.delete(webSocket);
    });

    webSocket.addEventListener('error', () => {
      this.sessions.delete(webSocket);
    });
  }

  private broadcast(message: string, exclude?: WebSocket) {
    for (const session of this.sessions) {
      if (session !== exclude && session.readyState === WebSocket.READY_STATE.OPEN) {
        session.send(message);
      }
    }
  }
}