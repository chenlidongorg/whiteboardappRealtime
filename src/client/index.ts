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

function t(key: string): string {
  return String(i18n.t(key));
}

function renderPage() {
  const root = document.getElementById('root');
  if (!root) {
    console.error('Root element not found');
    return;
  }

  document.documentElement.lang = i18n.language || 'en';
  document.documentElement.dir = i18n.dir(i18n.language);
  document.title = t('title');
  const descriptionMeta = document.querySelector('meta[name="description"]');
  if (descriptionMeta) {
    descriptionMeta.setAttribute('content', t('hero_text'));
  }

  const inviteCode = getInviteCodeFromURL();
  const inviteSection = inviteCode
    ? `
      <section class="invite-card">
        <p class="invite-label">${t('invite_label')}</p>
        <div class="invite-row">
          <code id="invite-code-value">${escapeHtml(inviteCode)}</code>
          <button id="copy-invite-button" type="button">${t('copy_button')}</button>
        </div>
      </section>
    `
    : '';

  root.innerHTML = `
    <div class="landing-page">
      <header class="brand-card">
        <div class="brand-row">
          <img src="https://files.whiteboardapp.org/id490633790.png" alt="${t('logo_alt')}" class="logo">
          <h1>${t('title')}</h1>
        </div>
      </header>

      <section class="hero-card">
        <p class="hero-text">${t('hero_text')}</p>
      </section>

      ${inviteSection}

      <main>
        <section class="card">
          <h2>${t('section_download')}</h2>
          <ul class="download-list">
            <li><span>${t('download_ios_label')}</span><a href="https://apps.apple.com/app/id496465537" target="_blank" rel="noopener noreferrer">https://apps.apple.com/app/id496465537</a></li>
            <li><span>${t('download_google_label')}</span><a href="https://play.google.com/store/apps/details?id=cn.readpad.whiteboard" target="_blank" rel="noopener noreferrer">https://play.google.com/store/apps/details?id=cn.readpad.whiteboard</a></li>
            <li><span>${t('download_android_label')}</span><a href="https://endlessai.cn" target="_blank" rel="noopener noreferrer">https://endlessai.cn</a></li>
          </ul>
          <p class="tip">${t('download_tip')}</p>
        </section>

        <section class="card">
          <h2>${t('section_create')}</h2>
          <ol>
            <li>
              ${t('create_step_1_lead')} <strong>${t('export_action_label')}</strong>.
              <div class="step-location">${t('location_export')}</div>
              <div class="step-icon-row" aria-label="export-entry-button">
                <span class="app-btn-icon app-btn-icon-folder" aria-hidden="true">
                  <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
                    <rect x="4" y="8" width="13" height="11" rx="1.8" ry="1.8" fill="none" stroke="currentColor" stroke-width="1.8" />
                    <path d="M14 8h1.8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
                    <circle cx="18" cy="6" r="4" fill="#3d4a57" />
                    <path d="M16.2 7.8 19.2 4.8M17.4 4.8h1.8v1.8" fill="none" stroke="#ffffff" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
                  </svg>
                </span>
                <span class="icon-caption">${t('caption_export_entry')}</span>
              </div>
            </li>
            <li>
              ${t('create_step_2_prefix')} <strong>${t('cloud_share_label')}</strong> ${t('create_step_2_middle')} <strong>${t('collaborate_label')}</strong>.
              <div class="step-location">${t('location_collab_menu')}</div>
              <div class="step-icon-row" aria-label="collaborate-menu-button">
                <span class="app-btn-icon app-btn-icon-collab" aria-hidden="true">
                  <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
                    <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5s-3 1.34-3 3 1.34 3 3 3zM8 11c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5C15 14.17 10.33 13 8 13zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.98 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" />
                  </svg>
                </span>
                <span class="icon-caption">${t('caption_collab_menu')}</span>
              </div>
            </li>
            <li>${t('create_step_3')}</li>
            <li>${t('create_step_4')}</li>
          </ol>
        </section>

        <section class="card">
          <h2>${t('section_join')}</h2>
          <ol>
            <li>
              ${t('join_step_1_lead')}<strong>${t('collaborate_label')}</strong>${t('join_step_1_tail')}.
              <div class="step-location">${t('location_join_entry')}</div>
              <div class="step-icon-row" aria-label="join-entry-button-export">
                <span class="app-btn-icon app-btn-icon-folder" aria-hidden="true">
                  <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
                    <rect x="4" y="8" width="13" height="11" rx="1.8" ry="1.8" fill="none" stroke="currentColor" stroke-width="1.8" />
                    <path d="M14 8h1.8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
                    <circle cx="18" cy="6" r="4" fill="#3d4a57" />
                    <path d="M16.2 7.8 19.2 4.8M17.4 4.8h1.8v1.8" fill="none" stroke="#ffffff" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
                  </svg>
                </span>
                <span class="icon-caption">${t('caption_join_export')}</span>
              </div>
              <div class="step-icon-row" aria-label="join-entry-button-collaborate">
                <span class="app-btn-icon app-btn-icon-collab" aria-hidden="true">
                  <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
                    <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5s-3 1.34-3 3 1.34 3 3 3zM8 11c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5C15 14.17 10.33 13 8 13zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.98 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" />
                  </svg>
                </span>
                <span class="icon-caption">${t('caption_join_collab')}</span>
              </div>
            </li>
            <li>${t('join_step_2')}</li>
            <li>${t('join_step_3')}</li>
            <li>${t('join_step_4')}</li>
          </ol>
        </section>
      </main>

      <footer>
        <p>${t('footer')}</p>
        <p><a href="https://endlessai.org" target="_blank" rel="noopener noreferrer">${t('more_information')}</a></p>
      </footer>
    </div>
  `;

  const copyButton = document.getElementById('copy-invite-button') as HTMLButtonElement | null;
  if (copyButton && inviteCode) {
    copyButton.addEventListener('click', async () => {
      try {
        await copyToClipboard(inviteCode);
        copyButton.textContent = t('copy_success');
        window.setTimeout(() => {
          copyButton.textContent = t('copy_button');
        }, 1200);
      } catch {
        copyButton.textContent = t('copy_failed');
        window.setTimeout(() => {
          copyButton.textContent = t('copy_button');
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
