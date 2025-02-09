import i18n from './i18n';

function updateContent() {
    const root = document.getElementById('root');
    if (root) {
        root.innerHTML = `
            <div class="landing-page">
                <header>
                    <h1>${i18n.t('title')}</h1>
                </header>
                <main>
                    <section class="hero">
                        <h2>${i18n.t('hero_title')}</h2>
                        <p>${i18n.t('description')}</p>
                        <div class="features">
                            <div class="feature">
                                <h3>${i18n.t('real_time_feature')}</h3>
                                <p>${i18n.t('chat_feature')}</p>
                            </div>
                            <div class="feature">
                                <h3>${i18n.t('secure_feature')}</h3>
                                <p>${i18n.t('secure_feature')}</p>
                            </div>
                        </div>
                    </section>
                    <section class="download">
                        <h2>${i18n.t('download_now')}</h2>
                        <a href="#" class="app-store-button">
                            ${i18n.t('download_now')}
                        </a>
                    </section>
                </main>
                <footer>
                    <p>${i18n.t('footer')}</p>
                </footer>
            </div>
        `;
    }
}

// 等待 i18n 初始化完成
i18n.on('initialized', () => {
    updateContent();

    // 监听语言切换
    const selector = document.getElementById('language-selector') as HTMLSelectElement;
    if (selector) {
        selector.value = i18n.language;
        selector.addEventListener('change', (event: Event) => {
            const target = event.target as HTMLSelectElement;
            i18n.changeLanguage(target.value).then(() => {
                updateContent();
            });
        });
    }
});

// 监听语言改变
i18n.on('languageChanged', () => {
    updateContent();
});