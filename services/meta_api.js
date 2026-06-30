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

  // Instagram mesajları 1000 karakter limiti var
  const maxLen = platform === 'instagram' ? 1000 : 2000;
  const trimmedText = messageText.length > maxLen 
    ? messageText.substring(0, maxLen - 3) + '...' 
    : messageText;

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
