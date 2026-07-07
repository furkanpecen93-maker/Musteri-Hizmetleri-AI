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
    body: JSON.stringify({ 
      chat_id: TELEGRAM_CHAT_ID, 
      text: text,
      reply_markup: {
        inline_keyboard: [[
          { text: "🔇 Botu Sustur (15 Dk)", callback_data: `pause_${customerNumber}` }
        ]]
      }
    })
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

// --- TELEGRAM POLLING (BUTONLARA TIKLANINCA ALGILAMAK İÇİN) ---
let pauseCallback = null;
function setPauseCallback(cb) {
  pauseCallback = cb;
}

let lastUpdateId = 0;
async function pollTelegram() {
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates?offset=${lastUpdateId + 1}&timeout=30`;
    const response = await fetch(url);
    
    if (response.ok) {
      const data = await response.json();
      for (const update of data.result) {
        lastUpdateId = update.update_id;
        
        // Butona tıklandıysa
        if (update.callback_query && update.callback_query.data) {
          const cbData = update.callback_query.data;
          const queryId = update.callback_query.id;
          
          if (cbData.startsWith('pause_')) {
            const customerNumber = cbData.split('pause_')[1];
            
            if (pauseCallback) {
              pauseCallback(customerNumber);
              
              // Ekrana popup bilgi ver
              fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ callback_query_id: queryId, text: `✅ ${customerNumber} için bot 15 dakika duraklatıldı!`, show_alert: true })
              }).catch(() => {});
              
              // Mesaja da geri dönüş yaz
              fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: update.callback_query.message.chat.id, text: `✅ Bot ${customerNumber} numaralı müşteri için 15 dakika boyunca sessize alındı. Şimdi WhatsApp'a girip manuel cevap yazabilirsiniz.` })
              }).catch(() => {});
            }
          }
        }
      }
    }
  } catch (err) {
    // Network errors during long polling are normal, ignore
  } finally {
    // Her 2 saniyede bir veya istek bittiğinde tekrarla
    setTimeout(pollTelegram, 2000);
  }
}

// Polling'i başlat
pollTelegram();

module.exports = { sendTelegramNotification, sendTelegramReport, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, setPauseCallback };
