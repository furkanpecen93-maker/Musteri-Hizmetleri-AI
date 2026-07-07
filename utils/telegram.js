// utils/telegram.js — Telegram bildirim ve rapor gönderme utility
const fetch = require('node-fetch');
const log = require('./logger');

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8904842068:AAEXgPjzxibJ20vr3xoCu9NjgLG_xUmuU8c';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '1222016405';

/**
 * Kısa bildirim mesajı gönder (mevcut fonksiyon — server.js'den taşındı)
 */
function sendTelegramNotification(customerNumber, customerMessage) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const text = `🚨 DİKKAT: Bir müşteri ekibe devredildi!\n\n📱 Müşteri/Numara: ${customerNumber}\n💬 Son Mesajı: "${customerMessage}"`;
  
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: text })
  }).catch(err => log.error('[telegram] Bildirim hatası:', err.message));
}

/**
 * Uzun rapor mesajı gönder (Markdown formatında)
 * Telegram 4096 karakter limiti var — gerekirse birden fazla mesaja böler
 */
async function sendTelegramReport(reportText) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const MAX_LENGTH = 4000; // Güvenli sınır (emoji'ler çok byte yer)

  // Raporu parçalara böl
  const chunks = [];
  let remaining = reportText;
  while (remaining.length > 0) {
    if (remaining.length <= MAX_LENGTH) {
      chunks.push(remaining);
      break;
    }
    // En yakın satır sonundan böl
    let splitIndex = remaining.lastIndexOf('\n', MAX_LENGTH);
    if (splitIndex === -1 || splitIndex < MAX_LENGTH * 0.5) {
      splitIndex = MAX_LENGTH;
    }
    chunks.push(remaining.substring(0, splitIndex));
    remaining = remaining.substring(splitIndex).trimStart();
  }

  for (let i = 0; i < chunks.length; i++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: TELEGRAM_CHAT_ID,
          text: chunks[i],
          parse_mode: 'HTML',
          disable_web_page_preview: true
        })
      });
      
      if (!response.ok) {
        // HTML parse hatası olursa düz metin olarak tekrar dene
        const errText = await response.text();
        log.warn(`[telegram] Rapor HTML parse hatası, düz metin deneniyor`, errText);
        await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: TELEGRAM_CHAT_ID,
            text: chunks[i].replace(/<[^>]*>/g, ''), // HTML tag'lerini kaldır
            disable_web_page_preview: true
          })
        });
      }

      // Rate limiting — mesajlar arası 500ms bekle
      if (i < chunks.length - 1) {
        await new Promise(r => setTimeout(r, 500));
      }
    } catch (err) {
      log.error(`[telegram] Rapor gönderme hatası (parça ${i + 1}/${chunks.length})`, err);
    }
  }

  log.info(`[telegram] Rapor gönderildi (${chunks.length} parça)`);
}

module.exports = { sendTelegramNotification, sendTelegramReport, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID };
