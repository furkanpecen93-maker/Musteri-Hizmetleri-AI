// config/env.js
require('dotenv').config();

// ── Zorunlu değişkenler ──
const requiredEnvs = [
  'META_PAGE_ACCESS_TOKEN',
  'META_VERIFY_TOKEN',
  'GEMINI_API_KEY'
];

for (const env of requiredEnvs) {
  if (!process.env[env]) {
    console.error(`⚠️  Uyarı: ${env} tanımlı değil. İlgili özellik çalışmayacak.`);
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
};

module.exports = { config };
