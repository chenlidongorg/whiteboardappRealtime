import i18n from 'i18next';

// 获取保存的语言设置或使用默认语言
const savedLanguage = localStorage.getItem('preferred-language') || 'en';

   i18n.init({
     lng: savedLanguage, // 使用保存的语言
     resources: {
       en: {
         translation: {
           title: "Whiteboard Realtime",
           hero_title: "Real-time Collaboration Whiteboard",
           description: "Experience smooth multi-person collaboration on iOS devices",
           real_time_feature: "Real-time Collaboration",
           chat_feature: "Instant Messaging",
           secure_feature: "Secure and Reliable",
           download_now: "Download iOS App Now",
           footer: "&copy; 2024 Whiteboard Realtime. All rights reserved."
         }
       },
       zh: {
         translation: {
           title: "实时协作白板",
           hero_title: "实时协作白板",
           description: "在iOS设备上体验流畅的多人协作白板",
           real_time_feature: "实时协作",
           chat_feature: "即时通讯",
           secure_feature: "安全可靠",
           download_now: "立即下载iOS应用",
           footer: "&copy; 2024 Whiteboard Realtime. 版权所有。"
         }
       },
       ja: {
         translation: {
           title: "リアルタイムコラボレーションホワイトボード",
           hero_title: "リアルタイムコラボレーションホワイトボード",
           description: "iOSデバイスでスムーズなマルチコラボレーションを体験してください",
           real_time_feature: "リアルタイムコラボレーション",
           chat_feature: "インスタントメッセージング",
           secure_feature: "安全で信頼できる",
           download_now: "iOSアプリを今すぐダウンロード",
           footer: "&copy; 2024 Whiteboard Realtime. すべての権利を保有。"
         }
       },
       ar: {
         translation: {
           title: "لوحة التعاون في الوقت الفعلي",
           hero_title: "لوحة التعاون في الوقت الفعلي",
           description: "استمتع بتعاون متعدد الأشخاص السلس على أجهزة iOS",
           real_time_feature: "التعاون في الوقت الحقيقي",
           chat_feature: "الرسائل الفورية",
           secure_feature: "آمن وموثوق",
           download_now: "قم بتنزيل تطبيق iOS الآن",
           footer: "حقوق النشر &copy; 2024 Whiteboard Realtime. جميع الحقوق محفوظة."
         }
       }
     }
   });

   export default i18n;