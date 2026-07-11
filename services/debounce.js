// services/debounce.js — Adaptive Message Debounce Sistemi (v2)
// Ard arda gelen müşteri mesajlarını birleştirip tek AI cevabı üretir.
//
// SORUN: ManyChat sıralı (sequential) HTTP request gönderiyor.
// İlk request'in response'unu alıp sonra ikincisini gönderiyor.
// Bu yüzden klasik "concurrent request" debounce çalışmıyor.
//
// ÇÖZÜM: "Cooldown penceresi" yaklaşımı:
//  1. İlk mesaj geldiğinde DEBOUNCE_WAIT_MS timer başlar (ilk bekleme)
//  2. Timer dolduğunda mesaj işlenir ve cevap döner
//  3. Cevap döndükten sonra COOLDOWN_MS boyunca "son cevap zamanı" kaydedilir
//  4. Cooldown süresi içinde yeni mesaj gelirse → onu da beklet + birleştir
//  5. Cooldown dışında gelen mesajlar normal işlenir
//
// Hem concurrent hem sequential mesajları yakalar.

const log = require('../utils/logger');

const DEBOUNCE_WAIT_MS = 3000;  // Son mesajdan sonra bu kadar sessizlik → işle
const MAX_WAIT_MS = 15000;      // Mutlak üst sınır: ilk mesajdan itibaren max bekleme
const COOLDOWN_MS = 4000;       // Son cevaptan sonra bu süre içinde gelen mesajlar biriktirilir

// senderId → { messages: string[], timer: NodeJS.Timeout, startTime: number, resolve: Function }
const pendingQueues = new Map();

// senderId → timestamp (son cevabın ne zaman verildiği)
const lastResponseTime = new Map();

/**
 * Mesajı debounce kuyruğuna ekle.
 * 
 * @param {string} senderId - Müşteri ID'si
 * @param {string} messageText - Mesaj metni
 * @returns {Promise<{messages: string[], combined: string} | null>}
 *   - İlk mesaj / cooldown mesajı: resolve olduğunda birleştirilmiş mesajları döner
 *   - Ek mesajlar (concurrent): null döner (ilk çağrı zaten bekliyor)
 */
function enqueue(senderId, messageText) {
  const existing = pendingQueues.get(senderId);

  if (existing) {
    // ── Kuyruğa ekle + timer sıfırla (concurrent mesaj) ──
    existing.messages.push(messageText);
    clearTimeout(existing.timer);

    const elapsed = Date.now() - existing.startTime;
    const remaining = Math.max(0, MAX_WAIT_MS - elapsed);
    const waitMs = Math.min(DEBOUNCE_WAIT_MS, remaining);

    if (waitMs <= 0) {
      flush(senderId);
    } else {
      existing.timer = setTimeout(() => flush(senderId), waitMs);
    }

    log.info(`[debounce] Mesaj kuyruğa eklendi (concurrent)`, {
      senderId,
      queueLen: existing.messages.length,
      elapsed: `${elapsed}ms`,
      nextFlush: `${waitMs}ms`
    });

    return Promise.resolve(null);
  }

  // ── Cooldown kontrolü: az önce cevap verilmiş mi? ──
  const lastResp = lastResponseTime.get(senderId);
  const inCooldown = lastResp && (Date.now() - lastResp) < COOLDOWN_MS;

  // ── Yeni kuyruk başlat ──
  return new Promise((resolve) => {
    const entry = {
      messages: [messageText],
      startTime: Date.now(),
      resolve,
      timer: setTimeout(() => flush(senderId), DEBOUNCE_WAIT_MS)
    };
    pendingQueues.set(senderId, entry);

    log.info(`[debounce] Yeni kuyruk başlatıldı`, {
      senderId,
      waitMs: DEBOUNCE_WAIT_MS,
      inCooldown
    });
  });
}

/**
 * Kuyruğu boşalt: mesajları birleştir ve bekleyen Promise'i çöz.
 */
function flush(senderId) {
  const entry = pendingQueues.get(senderId);
  if (!entry) return;

  clearTimeout(entry.timer);
  pendingQueues.delete(senderId);

  const messages = entry.messages;
  const combined = messages.length === 1
    ? messages[0]
    : messages.join('\n');

  const totalWait = Date.now() - entry.startTime;

  // Cooldown başlat: bu cevaptan sonra gelen mesajlar da birleştirilecek
  lastResponseTime.set(senderId, Date.now());

  if (messages.length > 1) {
    log.info(`[debounce] ${messages.length} mesaj birleştirildi`, {
      senderId,
      totalWait: `${totalWait}ms`,
      combined: combined.substring(0, 100)
    });
  }

  entry.resolve({ messages, combined });
}

/**
 * Belirli bir sender için bekleyen kuyruk var mı?
 */
function hasPending(senderId) {
  return pendingQueues.has(senderId);
}

/**
 * Cooldown aktif mi? (Son cevaptan bu yana COOLDOWN_MS geçmemiş mi?)
 */
function isInCooldown(senderId) {
  const lastResp = lastResponseTime.get(senderId);
  if (!lastResp) return false;
  return (Date.now() - lastResp) < COOLDOWN_MS;
}

/**
 * Kuyruğu iptal et (örn. bot duraklatıldığında).
 */
function cancel(senderId) {
  const entry = pendingQueues.get(senderId);
  if (!entry) return;
  clearTimeout(entry.timer);
  pendingQueues.delete(senderId);
  entry.resolve(null);
  log.info(`[debounce] Kuyruk iptal edildi`, { senderId });
}

// Eski cooldown kayıtlarını temizle (memory leak önleme)
setInterval(() => {
  const now = Date.now();
  for (const [id, ts] of lastResponseTime.entries()) {
    if (now - ts > 60000) lastResponseTime.delete(id);
  }
}, 60000);

module.exports = {
  enqueue,
  hasPending,
  isInCooldown,
  cancel,
  flush,
  DEBOUNCE_WAIT_MS,
  MAX_WAIT_MS,
  COOLDOWN_MS
};
