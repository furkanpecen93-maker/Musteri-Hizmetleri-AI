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
  
  log.info(`[telegram] Bildirim gönderiliyor`, { customerNumber });
  
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

// --- TELEGRAM CALLBACK İŞLEME (Botu Sustur butonu) ---
let pauseCallback = null;
function setPauseCallback(cb) {
  pauseCallback = cb;
  log.info('[telegram] pauseCallback kaydedildi ✅');
}

/**
 * Bir callback_query'yi işle — polling veya webhook'tan çağrılabilir
 */
function handleCallbackQuery(callbackQuery) {
  if (!callbackQuery || !callbackQuery.data) return;
  
  const cbData = callbackQuery.data;
  const queryId = callbackQuery.id;
  
  log.info(`[telegram] Callback query alındı`, { cbData, queryId });
  
  if (cbData.startsWith('pause_')) {
    const customerNumber = cbData.replace('pause_', '');
    
    log.info(`[telegram] ▶ Botu sustur talebi alındı`, { customerNumber, callbackRegistered: !!pauseCallback });
    
    if (pauseCallback) {
      pauseCallback(customerNumber);
      log.info(`[telegram] ✅ pauseCallback çağrıldı, bot duraklatıldı`, { customerNumber });
      
      // Ekrana popup bilgi ver
      fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callback_query_id: queryId, text: `✅ ${customerNumber} için bot 15 dakika duraklatıldı!`, show_alert: true })
      }).catch(err => log.warn('[telegram] answerCallbackQuery hatası', err.message));
      
      // Mesaja da geri dönüş yaz
      const chatId = callbackQuery.message?.chat?.id;
      if (chatId) {
        fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text: `✅ Bot ${customerNumber} numaralı müşteri için 15 dakika boyunca sessize alındı. Şimdi WhatsApp'a girip manuel cevap yazabilirsiniz.` })
        }).catch(err => log.warn('[telegram] Onay mesajı gönderilemedi', err.message));
      }
    } else {
      log.error(`[telegram] ❌ pauseCallback henüz kayıtlı değil! Botu susturma başarısız.`, { customerNumber });
      // Yine de kullanıcıya bilgi ver
      fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callback_query_id: queryId, text: `❌ Bot henüz hazır değil, lütfen birkaç saniye sonra tekrar deneyin.`, show_alert: true })
      }).catch(() => {});
    }
  }
}

// --- TELEGRAM POLLING (BUTONLARA TIKLANINCA ALGILAMAK İÇİN) ---
const POLL_TIMEOUT_SEC = 30;
const FETCH_TIMEOUT_MS = (POLL_TIMEOUT_SEC + 10) * 1000; // 40 saniye (long poll + margin)
let lastUpdateId = 0;
let pollingActive = false;
let consecutiveErrors = 0;

async function pollTelegram() {
  if (!pollingActive) return;
  
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates?offset=${lastUpdateId + 1}&timeout=${POLL_TIMEOUT_SEC}`;
    
    // AbortController ile timeout ekle — fetch asılı kalmasın
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    
    let response;
    try {
      response = await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(timeoutId);
    }
    
    if (response.ok) {
      const data = await response.json();
      consecutiveErrors = 0; // Başarılı istek, hata sayacını sıfırla
      
      for (const update of data.result) {
        lastUpdateId = update.update_id;
        
        // Butona tıklandıysa
        if (update.callback_query) {
          handleCallbackQuery(update.callback_query);
        }
      }
    } else {
      const errText = await response.text().catch(() => 'unknown');
      log.warn(`[telegram-poll] Telegram API hatası: ${response.status}`, errText);
      consecutiveErrors++;
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      log.warn(`[telegram-poll] Polling timeout (${FETCH_TIMEOUT_MS}ms) — yeniden başlatılıyor`);
    } else {
      log.warn(`[telegram-poll] Polling hatası: ${err.message}`);
    }
    consecutiveErrors++;
  } finally {
    if (pollingActive) {
      // Ardışık hata durumunda bekle (backoff: max 30sn)
      const delay = consecutiveErrors > 0 ? Math.min(consecutiveErrors * 2000, 30000) : 1000;
      setTimeout(pollTelegram, delay);
    }
  }
}

/**
 * Telegram polling'i başlat — server.js'den setPauseCallback'ten sonra çağrılmalı
 */
function startPolling() {
  if (pollingActive) {
    log.warn('[telegram-poll] Polling zaten aktif, tekrar başlatılmadı');
    return;
  }
  pollingActive = true;
  log.info('[telegram-poll] Telegram polling başlatıldı ✅');
  pollTelegram();
}

function stopPolling() {
  pollingActive = false;
  log.info('[telegram-poll] Telegram polling durduruldu');
}

module.exports = { 
  sendTelegramNotification, 
  sendTelegramReport, 
  TELEGRAM_BOT_TOKEN, 
  TELEGRAM_CHAT_ID, 
  setPauseCallback, 
  startPolling, 
  stopPolling,
  handleCallbackQuery 
};

