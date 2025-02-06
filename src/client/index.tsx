//导入模块，导入了React、React Router、partysocket和其他必要的模块和类型。

import { createRoot } from "react-dom/client";
import { usePartySocket } from "partysocket/react";
import React, { useState } from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useParams,
} from "react-router";
import { nanoid } from "nanoid";

import { names, type ChatMessage, type Message } from "../shared";



//主应用组件 `App`，
/*
- `useState`：初始化用户姓名和消息列表的状态。
- `useParams`：用于获取URL中的`room`参数。
- `usePartySocket`：创建和房间相连的WebSocket，并监听消息事件，处理接收到的消息。
*/

function App() {
  const [name] = useState(names[Math.floor(Math.random() * names.length)]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const { room } = useParams();

  const socket = usePartySocket({
    party: "chat",
    room,
    onMessage: (evt) => {
      const message = JSON.parse(evt.data as string) as Message;
      if (message.type === "add") {
        const foundIndex = messages.findIndex((m) => m.id === message.id);
        if (foundIndex === -1) {
        // 如果找不到相同的消息ID，认为是其他用户发的消息，添加到消息列表中
          // probably someone else who added a message
          setMessages((messages) => [
            ...messages,
            {
              id: message.id,
              content: message.content,
              user: message.user,
              role: message.role,
            },
          ]);
        } else {
        // 自己发的消息被广播回来，用新消息替换旧消息
          // this usually means we ourselves added a message
          // and it was broadcasted back
          // so let's replace the message with the new message
          setMessages((messages) => {
            return messages
              .slice(0, foundIndex)
              .concat({
                id: message.id,
                content: message.content,
                user: message.user,
                role: message.role,
              })
              .concat(messages.slice(foundIndex + 1));
          });
        }
      } else if (message.type === "update") {
      // 更新现有的消息
        setMessages((messages) =>
          messages.map((m) =>
            m.id === message.id
              ? {
                  id: message.id,
                  content: message.content,
                  user: message.user,
                  role: message.role,
                }
              : m,
          ),
        );
      } else {
       // 覆盖整个消息列表
        setMessages(message.messages);
      }
    },
  });

//渲染消息和输入表单
/*
- `messages.map`：遍历当前消息列表并展示每条消息。
- `form`：提交表单时发送`ChatMessage`到服务器，并清空输入框。
*/
  return (
    <div className="chat container">
      {messages.map((message) => (
        <div key={message.id} className="row message">
          <div className="two columns user">{message.user}</div>
          <div className="ten columns">{message.content}</div>
        </div>
      ))}
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          const content = e.currentTarget.elements.namedItem(
            "content",
          ) as HTMLInputElement;
          const chatMessage: ChatMessage = {
            id: nanoid(8),
            content: content.value,
            user: name,
            role: "user",
          };
          setMessages((messages) => [...messages, chatMessage]);
          // we could broadcast the message here
         // 发送消息给服务器
          socket.send(
            JSON.stringify({
              type: "add",
              ...chatMessage,
            } satisfies Message),
          );

          content.value = "";
        }}
      >
        <input
          type="text"
          name="content"
          className="ten columns my-input-text"
          placeholder={`Hello ${name}! Type a message...`}
          autoComplete="off"
        />
        <button type="submit" className="send-message two columns">
          Send
        </button>
      </form>
    </div>
  );
}

//渲染应用入口
/*
- `createRoot`：初始化React应用，将其挂载到页面的`root`元素。
- `BrowserRouter`：使用React Router进行路由管理。
- `Routes` 和 `Route`：定义应用的路径配置。
- `<Navigate>`：示例中将根路径重定向到新的唯一房间路径。
*/
// eslint-disable-next-line @typescript-eslint/no-non-null-assertion

createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <Routes>
      <Route path="/" element={<Navigate to={`/${nanoid()}`} />} />
      <Route path="/:room" element={<App />} />
      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
  </BrowserRouter>,
);
