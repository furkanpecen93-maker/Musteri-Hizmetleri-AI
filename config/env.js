// config/env.js
require('dotenv').config();

// ── Zorunlu değişkenler ──
const requiredEnvs = [
  'GEMINI_API_KEY'
];

for (const env of requiredEnvs) {
  if (!process.env[env]) {
    throw new Error(`EnvironmentError: Gerekli ortam degiskeni eksik: ${env}`);
  }
}

const config = {
  // ── Sunucu ──
  port: process.env.PORT || 3500,

  // ── Meta (Instagram + Messenger) ──
  metaPageAccessToken: process.env.META_PAGE_ACCESS_TOKEN || '',
  metaVerifyToken: process.env.META_VERIFY_TOKEN || 'musteri_hizmetleri_verify_2026',
  metaAppSecret: process.env.META_APP_SECRET || '',

  // ── Gemini AI ──
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash',

  // ── Google Sheets (ürün kataloğu) ──
  googleSheetsId: process.env.GOOGLE_SHEETS_ID || '',
  googleServiceAccountEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '',
  googlePrivateKey: (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),

  // ── İşletme bilgileri ──
  businessName: process.env.BUSINESS_NAME || 'Peçen Toptan',
  businessSector: process.env.BUSINESS_SECTOR || 'Toptan Satış',
  businessIban: process.env.BUSINESS_IBAN || '',
  businessPhone: process.env.BUSINESS_PHONE || '',

  // ── Eskalasyon ──
  escalationEmail: process.env.ESCALATION_EMAIL || '',
  adminNotifyEmail: process.env.ADMIN_NOTIFY_EMAIL || '',

  // ── WhatsApp AutoResponder webhook ──
  whatsappWebhookSecret: process.env.WHATSAPP_WEBHOOK_SECRET || '',

  // ── Supabase (Hafıza) ──
  supabaseUrl: process.env.SUPABASE_URL || 'https://pvipasgwzcrfkwjwrqwt.supabase.co',
  supabaseKey: process.env.SUPABASE_KEY || 'sb_publishable_pIW0q6dsFivhi_V2zodp0w_5iOzOmOy',

  // ── Günlük Rapor ──
  dailyReportHour: parseInt(process.env.DAILY_REPORT_HOUR || '21', 10), // Türkiye saati (default: 21:00)
  dailyReportEnabled: process.env.DAILY_REPORT_ENABLED !== 'false',     // default: true

  // ── Takip Hatırlatma ──
  followupReminder1hEnabled: process.env.FOLLOWUP_1H_ENABLED !== 'false',   // default: true
  followupReminder24hEnabled: process.env.FOLLOWUP_24H_ENABLED !== 'false', // default: true
  followupCheckIntervalMin: parseInt(process.env.FOLLOWUP_CHECK_INTERVAL || '10', 10), // dakika

  // ── Telegram ──
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '8904842068:AAEXgPjzxibJ20vr3xoCu9NjgLG_xUmuU8c',
  telegramChatId: process.env.TELEGRAM_CHAT_ID || '1222016405',
};

module.exports = { config };
