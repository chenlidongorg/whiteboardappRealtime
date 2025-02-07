// src/client/index.ts

document.addEventListener('DOMContentLoaded', () => {
  const root = document.getElementById('root');
  if (root) {
    root.innerHTML = `
      <div class="landing-page">
        <header>
          <h1>Whiteboard Realtime</h1>
        </header>

        <main>
          <section class="hero">
            <h2>实时协作白板</h2>
            <p>在iOS设备上体验流畅的多人协作白板</p>

            <div class="features">
              <div class="feature">
                <h3>实时协作</h3>
                <p>多人同时编辑，实时同步</p>
              </div>
              <div class="feature">
                <h3>即时通讯</h3>
                <p>内置聊天功能，协作更顺畅</p>
              </div>
              <div class="feature">
                <h3>安全可靠</h3>
                <p>基于Cloudflare构建，稳定可靠</p>
              </div>
            </div>
          </section>

          <section class="download">
            <h2>立即下载iOS应用</h2>
            <a href="#" class="app-store-button">
              App Store下载
            </a>
          </section>
        </main>

        <footer>
          <p>&copy; 2024 Whiteboard Realtime. All rights reserved.</p>
        </footer>
      </div>
    `;
  }
});