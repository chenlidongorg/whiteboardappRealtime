// src/client/index.ts
import './i18n';
import i18n from './i18n';

document.addEventListener('DOMContentLoaded', () => {
  console.log('DOM fully loaded and parsed');

  // 获取i18n当前语言
  const currentLanguage = i18n.language || 'en'; // 如果i18n还未初始化则默认'en'

  // 设置选择框的当前语言
  const languageSelector = document.getElementById('language-selector') as HTMLSelectElement;
  if (languageSelector) {
    languageSelector.value = currentLanguage;
  }

  renderPage(); // 在页面加载后进行初次渲染
});

document.getElementById('language-selector').addEventListener('change', (event) => {
  const language = (event.target as HTMLSelectElement).value;

  // 保存语言选择
  localStorage.setItem('preferred-language', language);

  // 切换i18n的语言
  i18n.changeLanguage(language).then(() => {
    renderPage(); // 重新渲染页面而不是刷新
  });
});



// 将渲染逻辑抽取为单独的函数
function renderPage() {
  const root = document.getElementById('root');
  if (root) {
    root.innerHTML = `
      <div class="landing-page">
        <header>
          <img src="https://files.whiteboardapp.org/id490633790.png" alt="Logo" class="logo">
          <h1>${i18n.t('title')}</h1>
          <p>${i18n.t('description')}</p>
        </header>

        <main>
          <section class="features">
            <div class="feature">
              <h3>${i18n.t('real_time_feature')}</h3>
              <p>${i18n.t('chat_feature')}</p>
            </div>
            <div class="feature">
              <h3>${i18n.t('secure_feature')}</h3>
              <p>${i18n.t('secure_feature')}</p>
            </div>
          </section>

          <section class="download">
            <h2>${i18n.t('download_now')}</h2>
            <div class="download-content">
              <img src="https://files.whiteboardapp.org/whiteboard_installapp.png" alt="QR Code" class="qr-code">
              <a href="https://apps.apple.com/app/id496465537" class="app-store-button" target="_blank">
                ${i18n.t('download_now')}
              </a>
            </div>
          </section>
        </main>

        <footer>
          <p>${i18n.t('footer')}</p>
          <p><a href="https://endlessai.org" target="_blank">More Information</a></p>
        </footer>
      </div>
    `;
  } else {
          console.error('Root element not found');
        }
}