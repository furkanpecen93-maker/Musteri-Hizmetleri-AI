// services/meta_api.js — Meta Graph API ile Instagram DM + Messenger mesaj gönderme
const fetch = require('node-fetch');
const { config } = require('../config/env');
const log = require('../utils/logger');

const META_API_VERSION = 'v21.0';
const META_BASE_URL = `https://graph.facebook.com/${META_API_VERSION}`;

/**
 * Meta Graph API üzerinden mesaj gönder (Instagram + Messenger)
 * @param {string} recipientId - Alıcının PSID veya IGSID'si
 * @param {string} messageText - Gönderilecek mesaj
 * @param {string} platform - 'instagram' veya 'messenger'
 */
async function sendMessage(recipientId, messageText, platform = 'messenger') {
  if (!config.metaPageAccessToken) {
    log.error(`[meta_api] META_PAGE_ACCESS_TOKEN tanımlı değil! ${platform} mesajı gönderilemedi.`);
    return false;
  }

  // ═══ SON SAVUNMA HATTI: Dahili düşünce sızıntısı kontrolü ═══
  // Gemini bazen "THOUGHT", "THINKING" gibi iç monolog yazabiliyor.
  // Bu kontrol, gemini.js'deki sanitize'dan kaçan her şeyi yakalar.
  let cleanedMessage = messageText;
  
  // THOUGHT/THINKING/REASONING blokları ve sonrasını temizle
  cleanedMessage = cleanedMessage.replace(/(?:^|\n)\s*(?:\[|\*|\()?\s*(?:THOUGHT|THINKING|REASONING|ANALYSIS|DÜŞÜNCE|ANALİZ|İÇ\s*MONOLOG|INTERNAL|NOTE\s*TO\s*SELF)\s*(?:\]|\*|\))?\s*[:\-]?\s*[\s\S]*?(?=\n\n|$)/gi, '');
  
  // "I should...", "Since there's no...", "The user is asking..." gibi İngilizce iç monolog cümleleri
  cleanedMessage = cleanedMessage.replace(/(?:^|\n)\s*(?:Since there'?s|I should|I need to|The user is|The customer is|Based on the rules|According to|Let me think|I will respond|I notice that|rule \d)[^\n]*(?:\n(?!\n)[^\n]*)*/gi, '');
  
  // Çoklu boş satırları temizle
  cleanedMessage = cleanedMessage.replace(/\n{3,}/g, '\n\n').trim();
  
  // Eğer mesaj tamamen temizlendiyse log'la ve fallback kullan
  if (!cleanedMessage || cleanedMessage.length < 5) {
    log.error(`[meta_api] ⚠️ THOUGHT LEAK TESPİT EDİLDİ VE ENGELLENDİ! Orijinal mesaj:`, messageText.substring(0, 300));
    cleanedMessage = 'Mesajınızı aldım efendim. Sizi ilgili ekip arkadaşlarıma yönlendiriyorum, en kısa sürede size dönüş yapacaklar.';
  }

  // Instagram mesajları 1000 karakter limiti var
  const maxLen = platform === 'instagram' ? 1000 : 2000;
  const trimmedText = cleanedMessage.length > maxLen 
    ? cleanedMessage.substring(0, maxLen - 3) + '...' 
    : cleanedMessage;

  const url = `${META_BASE_URL}/me/messages?access_token=${config.metaPageAccessToken}`;
  
  const body = {
    recipient: { id: recipientId },
    message: { text: trimmedText }
  };

  // Instagram için messaging_type eklenmeli
  if (platform === 'instagram') {
    body.messaging_type = 'RESPONSE';
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const data = await response.json();

    if (data.error) {
      log.error(`[meta_api] ${platform} mesaj gönderme hatası`, data.error);
      return false;
    }

    log.info(`[meta_api] ${platform} mesaj gönderildi`, { recipientId, msgLen: trimmedText.length });
    return true;
  } catch (err) {
    log.error(`[meta_api] ${platform} istek hatası`, err);
    return false;
  }
}

/**
 * Instagram DM'e cevap gönder
 */
async function sendInstagramMessage(recipientId, messageText) {
  return sendMessage(recipientId, messageText, 'instagram');
}

/**
 * Facebook Messenger'a cevap gönder
 */
async function sendMessengerMessage(recipientId, messageText) {
  return sendMessage(recipientId, messageText, 'messenger');
}

/**
 * Gelen webhook event'ından mesaj bilgisini çıkar
 * @param {Object} entry - Webhook entry objesi
 * @returns {Object|null} { senderId, messageText, platform, timestamp }
 */
function extractMessageFromEntry(entry) {
  // Messenger
  if (entry.messaging) {
    for (const event of entry.messaging) {
      if (event.message && event.message.text) {
        return {
          senderId: event.sender.id,
          messageText: event.message.text,
          platform: 'messenger',
          timestamp: event.timestamp,
          messageId: event.message.mid
        };
      }
    }
  }

  // Instagram
  if (entry.messaging) {
    for (const event of entry.messaging) {
      if (event.message && event.message.text) {
        // Instagram ve Messenger aynı yapıyı kullanır
        // Platform ayrımı page_id'den yapılır
        return {
          senderId: event.sender.id,
          messageText: event.message.text,
          platform: entry.id ? 'auto' : 'messenger', // entry.id page_id'dir
          timestamp: event.timestamp,
          messageId: event.message.mid
        };
      }
    }
  }

  return null;
}

module.exports = { sendInstagramMessage, sendMessengerMessage, sendMessage, extractMessageFromEntry };
