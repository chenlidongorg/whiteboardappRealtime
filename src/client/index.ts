// src/client/index.tsx
import React from 'react';
import ReactDOM from 'react-dom';

const LandingPage = () => {
  return (
    <div className="landing-page">
      <header>
        <h1>Whiteboard Realtime</h1>
      </header>

      <main>
        <section className="hero">
          <h2>实时协作白板</h2>
          <p>在iOS设备上体验流畅的多人协作白板</p>

          <div className="features">
            <div className="feature">
              <h3>实时协作</h3>
              <p>多人同时编辑，实时同步</p>
            </div>
            <div className="feature">
              <h3>即时通讯</h3>
              <p>内置聊天功能，协作更顺畅</p>
            </div>
            <div className="feature">
              <h3>安全可靠</h3>
              <p>基于Cloudflare构建，稳定可靠</p>
            </div>
          </div>
        </section>

        <section className="download">
          <h2>立即下载iOS应用</h2>
          <a href="#" className="app-store-button">
            App Store下载
          </a>
        </section>
      </main>

      <footer>
        <p>&copy; 2024 Whiteboard Realtime. All rights reserved.</p>
      </footer>
    </div>
  );
};

ReactDOM.render(
  <React.StrictMode>
    <LandingPage />
  </React.StrictMode>,
  document.getElementById('root')
);