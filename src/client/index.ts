// src/client/index.ts
 import './i18n'; // 确保 i18n 配置已被加载
import i18n from 'i18n';

  document.getElementById('language-selector').addEventListener('change', (event) => {
     const language = event.target.value;
     i18n.changeLanguage(language).then(() => {
       // 重新渲染或刷新页面
       location.reload();
     });
   });

   document.addEventListener('DOMContentLoaded', () => {
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
   });