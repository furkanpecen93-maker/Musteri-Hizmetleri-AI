// services/debounce.js — Adaptive Message Debounce Sistemi
// Ard arda gelen müşteri mesajlarını birleştirip tek AI cevabı üretir.
//
// Mantık:
//  1. İlk mesaj geldiğinde DEBOUNCE_WAIT_MS (3 sn) timer başlar
//  2. Timer dolmadan yeni mesaj gelirse → kuyruğa ekle + timer sıfırla
//  3. Timer dolduğunda → kuyruktaki tüm mesajlar birleştirilip handler'a verilir
//  4. MAX_WAIT_MS (15 sn) güvenlik sınırı: ne olursa olsun 15 sn'de keser
//
// Bu, eski polling-loop (COALESCE) yaklaşımının yerine geçer.
// Avantajları:
//  - Tek mesaj gönderen müşteri max 3 sn bekler (eskisi 7 sn idi)
//  - Timer event-driven: gereksiz CPU/sleep yok
//  - Maksimum bekleme süresi garanti (15 sn hard cap)

const log = require('../utils/logger');

const DEBOUNCE_WAIT_MS = 3000;  // Son mesajdan sonra bu kadar sessizlik → işle
const MAX_WAIT_MS = 15000;      // Mutlak üst sınır: ilk mesajdan itibaren max bekleme

// senderId → { messages: string[], timer: NodeJS.Timeout, startTime: number, resolve: Function }
const pendingQueues = new Map();

/**
 * Mesajı debounce kuyruğuna ekle.
 * 
 * @param {string} senderId - Müşteri ID'si
 * @param {string} messageText - Mesaj metni
 * @returns {Promise<{messages: string[], combined: string} | null>}
 *   - İlk mesaj için: resolve olduğunda birleştirilmiş mesajları döner
 *   - Ek mesajlar için: null döner (ilk çağrı zaten bekliyor)
 */
function enqueue(senderId, messageText) {
  const existing = pendingQueues.get(senderId);

  if (existing) {
    // ── Kuyruğa ekle + timer sıfırla ──
    existing.messages.push(messageText);
    clearTimeout(existing.timer);

    const elapsed = Date.now() - existing.startTime;
    const remaining = Math.max(0, MAX_WAIT_MS - elapsed);
    const waitMs = Math.min(DEBOUNCE_WAIT_MS, remaining);

    if (waitMs <= 0) {
      // Max süreye ulaşıldı, hemen işle
      flush(senderId);
    } else {
      existing.timer = setTimeout(() => flush(senderId), waitMs);
    }

    log.info(`[debounce] Mesaj kuyruğa eklendi`, {
      senderId,
      queueLen: existing.messages.length,
      elapsed: `${elapsed}ms`,
      nextFlush: `${waitMs}ms`
    });

    return Promise.resolve(null); // Bu çağıran "kuyrukta" olduğunu anlasın
  }

  // ── İlk mesaj: yeni kuyruk başlat ──
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
      waitMs: DEBOUNCE_WAIT_MS
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

module.exports = {
  enqueue,
  hasPending,
  cancel,
  flush,
  // Konfigürasyon (test/debug için export)
  DEBOUNCE_WAIT_MS,
  MAX_WAIT_MS
};
