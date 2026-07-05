// services/memory.js — Basit in-memory konuşma geçmişi
const log = require('../utils/logger');

// In-memory store — {senderId: [{role, content, timestamp}]}
const conversations = new Map();
const userStates = new Map(); // Store state per user (e.g. hasAskedLocation, profile)
const MAX_HISTORY = 20; // Son 20 mesaj tutulur
const CONVERSATION_TTL_MS = 24 * 60 * 60 * 1000; // 24 saat

/**
 * Kullanıcı state'ini getir
 */
function getState(senderId) {
  if (!userStates.has(senderId)) {
    userStates.set(senderId, { hasAskedLocation: false, profile: {} });
  }
  return userStates.get(senderId);
}

/**
 * Kullanıcı state'ini güncelle
 */
function updateState(senderId, updates) {
  const currentState = getState(senderId);
  Object.assign(currentState, updates);
}

/**
 * Konuşma geçmişine mesaj ekle
 */
function addMessage(senderId, role, content) {
  if (!conversations.has(senderId)) {
    conversations.set(senderId, []);
  }
  
  const history = conversations.get(senderId);
  history.push({
    role,
    content,
    timestamp: Date.now()
  });

  // Max history aş → eski mesajları sil
  while (history.length > MAX_HISTORY) {
    history.shift();
  }
}

/**
 * Konuşma geçmişini getir
 */
function getHistory(senderId) {
  const history = conversations.get(senderId);
  if (!history) return [];
  
  // 24 saatten eski konuşmaları temizle
  const cutoff = Date.now() - CONVERSATION_TTL_MS;
  const filtered = history.filter(m => m.timestamp > cutoff);
  
  if (filtered.length !== history.length) {
    conversations.set(senderId, filtered);
  }
  
  return filtered;
}

/**
 * Duplicate mesaj kontrolü (30 saniye içinde aynı mesaj)
 */
function isDuplicate(senderId, messageText, windowMs = 30000) {
  const history = conversations.get(senderId);
  if (!history || history.length === 0) return false;
  
  const cutoff = Date.now() - windowMs;
  return history.some(m => 
    m.role === 'user' && 
    m.content === messageText && 
    m.timestamp > cutoff
  );
}

/**
 * Periyodik temizlik — 24 saatten eski konuşmaları sil
 */
function cleanup() {
  const cutoff = Date.now() - CONVERSATION_TTL_MS;
  let cleaned = 0;
  
  for (const [senderId, history] of conversations) {
    const latest = history[history.length - 1];
    if (!latest || latest.timestamp < cutoff) {
      conversations.delete(senderId);
      cleaned++;
    }
  }
  
  if (cleaned > 0) {
    log.info('[memory] Eski konuşmalar temizlendi', { cleaned });
  }
}

// Her 1 saatte temizlik yap
setInterval(cleanup, 60 * 60 * 1000);

/**
 * Mesajın standart bir karşılama olup olmadığını kontrol et
 */
function isGenericGreeting(messageText) {
  if (!messageText) return false;
  const txt = messageText.toLowerCase().trim();
  
  // Direkt eşleşmeler (Sadece bunlarda AI'ı es geçip manuel soru sorulacak)
  const exactMatches = ['merhaba', 'merhabalar', 'selam', 'selamlar', 'iyi günler', 'kolay gelsin', 'nasılsınız', 'slm'];
  if (exactMatches.includes(txt)) return true;
  
  return false;
}

function clearHistory(senderId) {
  conversations.delete(senderId);
  userStates.delete(senderId);
  log.info(`[memory] ${senderId} icin gecmis ve state temizlendi.`);
}

module.exports = { addMessage, getHistory, isDuplicate, getState, updateState, isGenericGreeting, clearHistory };
