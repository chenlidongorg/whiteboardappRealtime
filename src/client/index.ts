import './i18n';
import i18n from './i18n';

const INVITE_PARAM_KEYS = ['invite', 'inviteCode', 'code', 'roomCode'];

function normalizeInviteCode(raw: string | null): string | null {
  if (!raw) return null;
  const value = raw.trim();
  return value.length > 0 ? value : null;
}

function getInviteCodeFromURL(): string | null {
  const searchParams = new URLSearchParams(window.location.search);
  for (const key of INVITE_PARAM_KEYS) {
    const value = normalizeInviteCode(searchParams.get(key));
    if (value) return value;
  }
  return null;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textArea = document.createElement('textarea');
  textArea.value = text;
  textArea.style.position = 'fixed';
  textArea.style.opacity = '0';
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();
  document.execCommand('copy');
  document.body.removeChild(textArea);
}

function renderPage() {
  const root = document.getElementById('root');
  if (!root) {
    console.error('Root element not found');
    return;
  }

  const inviteCode = getInviteCodeFromURL();
  const inviteSection = inviteCode
    ? `
      <section class="invite-card">
        <p class="invite-label">协同 邀请码</p>
        <div class="invite-row">
          <code id="invite-code-value">${escapeHtml(inviteCode)}</code>
          <button id="copy-invite-button" type="button">复制</button>
        </div>
      </section>
    `
    : '';

  root.innerHTML = `
    <div class="landing-page">
      <header class="hero">
        <img src="https://files.whiteboardapp.org/id490633790.png" alt="Whiteboard Logo" class="logo">
        <h1>Whiteboard Realtime</h1>
        <p class="hero-text">Experience smooth multi-person collaboration on iOS devices and Android devices</p>
      </header>

      ${inviteSection}

      <main>
        <section class="card">
          <h2>安装下载</h2>
          <ul class="download-list">
            <li><span>iOS / macOS</span><a href="https://apps.apple.com/app/id496465537" target="_blank" rel="noopener noreferrer">https://apps.apple.com/app/id496465537</a></li>
            <li><span>Google Play</span><a href="https://play.google.com/store/apps/details?id=cn.readpad.whiteboard" target="_blank" rel="noopener noreferrer">https://play.google.com/store/apps/details?id=cn.readpad.whiteboard</a></li>
            <li><span>安卓官方下载</span><a href="https://endlessai.cn" target="_blank" rel="noopener noreferrer">https://endlessai.cn</a></li>
          </ul>
          <p class="tip">或在各个应用市场搜索“白板”，核对好 logo 后安装即可。</p>
        </section>

        <section class="card">
          <h2>如何发起</h2>
          <ol>
            <li>打开白板后进入 <strong>Export / 导出文件</strong>。</li>
            <li>在 <strong>Cloud Share</strong> 下点击 <strong>Collaborate</strong>。</li>
            <li>点击 <strong>Create Room</strong> 发起协作房间。</li>
            <li>复制邀请码并分享给协作者。</li>
          </ol>
        </section>

        <section class="card">
          <h2>如何加入</h2>
          <ol>
            <li>在白板中打开协作面板（Collaborate）。</li>
            <li>将邀请码粘贴到 <strong>Invite Code</strong> 输入框。</li>
            <li>点击 <strong>Join by Code</strong> 即可加入协作。</li>
            <li>若当前文件不匹配，客户端会自动切换到对应协作文件（无限画布）。</li>
          </ol>
        </section>
      </main>

      <footer>
        <p>${i18n.t('footer')}</p>
        <p><a href="https://endlessai.org" target="_blank" rel="noopener noreferrer">More Information</a></p>
      </footer>
    </div>
  `;

  const copyButton = document.getElementById('copy-invite-button') as HTMLButtonElement | null;
  if (copyButton && inviteCode) {
    copyButton.addEventListener('click', async () => {
      try {
        await copyToClipboard(inviteCode);
        copyButton.textContent = '已复制';
        window.setTimeout(() => {
          copyButton.textContent = '复制';
        }, 1200);
      } catch {
        copyButton.textContent = '复制失败';
        window.setTimeout(() => {
          copyButton.textContent = '复制';
        }, 1200);
      }
    });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const currentLanguage = i18n.language || 'en';
  const languageSelector = document.getElementById('language-selector') as HTMLSelectElement | null;
  if (languageSelector) {
    languageSelector.value = currentLanguage;
    languageSelector.addEventListener('change', (event) => {
      const language = (event.target as HTMLSelectElement).value;
      localStorage.setItem('preferred-language', language);
      i18n.changeLanguage(language).then(() => {
        renderPage();
      });
    });
  }

  renderPage();
});
