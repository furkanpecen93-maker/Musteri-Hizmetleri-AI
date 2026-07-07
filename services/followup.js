// services/followup.js — Takip hatırlatma sistemi
// Mesaj atıp susan müşterilere otomatik hatırlatma gönderir
const { createClient } = require('@supabase/supabase-js');
const { config } = require('../config/env');
const log = require('../utils/logger');
const { sendInstagramMessage, sendMessengerMessage } = require('./meta_api');
const { trackEvent } = require('./analytics');

const supabase = createClient(config.supabaseUrl, config.supabaseKey);

// Hatırlatma mesaj şablonları
const REMINDER_MESSAGES = {
  '1h': 'Merhaba, mesajınızı aldık. Size yardımcı olabilecek bir konu kaldıysa, yazmaktan çekinmeyin efendim 😊',
  '24h': 'Merhabalar, dün görüşmüştük. Kataloğumuzu inceleme fırsatınız olduysa, sorularınızı bekliyoruz efendim. İyi günler 🙏'
};

/**
 * Müşteriyi hatırlatma kuyruğuna ekle
 * Bot cevap verdiğinde çağrılır
 */
async function enqueueFollowup(senderId, platform) {
  try {
    // Önce bu müşteri için açık bir kayıt var mı kontrol et
    const { data: existing } = await supabase
      .from('followup_queue')
      .select('id')
      .eq('sender_id', senderId)
      .eq('is_completed', false)
      .limit(1);

    if (existing && existing.length > 0) {
      // Müşteri tekrar yazdı — mevcut kuyruğu güncelle (timer sıfırla)
      await supabase
        .from('followup_queue')
        .update({
          last_bot_message_at: new Date().toISOString(),
          reminder_1h_sent: false,
          reminder_24h_sent: false
        })
        .eq('id', existing[0].id);
      
      log.info(`[followup] Müşteri tekrar yazdı, timer sıfırlandı`, { senderId });
      return;
    }

    // Yeni kayıt oluştur
    await supabase.from('followup_queue').insert({
      sender_id: senderId,
      platform: platform || 'unknown',
      last_bot_message_at: new Date().toISOString(),
      reminder_1h_sent: false,
      reminder_24h_sent: false,
      is_completed: false
    });

    log.info(`[followup] Müşteri kuyruğa eklendi`, { senderId, platform });
  } catch (err) {
    log.error('[followup] Kuyruk ekleme hatası', err);
  }
}

/**
 * Müşteri cevap verdiğinde kuyruğu tamamla
 */
async function completeFollowup(senderId) {
  try {
    const { data } = await supabase
      .from('followup_queue')
      .update({ is_completed: true })
      .eq('sender_id', senderId)
      .eq('is_completed', false)
      .select('id, reminder_1h_sent, reminder_24h_sent');

    if (data && data.length > 0) {
      // Hatırlatmadan sonra cevap verdiyse conversion kaydet
      const entry = data[0];
      if (entry.reminder_1h_sent || entry.reminder_24h_sent) {
        const reminderType = entry.reminder_24h_sent ? '24h' : '1h';
        await trackEvent(senderId, 'reminder_converted', null, { original_reminder_type: reminderType });
        log.info(`[followup] Hatırlatma conversion! Müşteri cevap verdi`, { senderId, reminderType });
      }
    }
  } catch (err) {
    log.error('[followup] Tamamlama hatası', err);
  }
}

/**
 * Ekibe devredilen müşterinin kuyruğunu kapat
 * (Onlara hatırlatma gönderilmez)
 */
async function cancelFollowup(senderId) {
  try {
    await supabase
      .from('followup_queue')
      .update({ is_completed: true })
      .eq('sender_id', senderId)
      .eq('is_completed', false);
  } catch (err) {
    log.error('[followup] İptal hatası', err);
  }
}

/**
 * Bekleyen hatırlatmaları işle (cron job tarafından çağrılır)
 * Her 10 dakikada bir çalışır
 */
async function processReminders() {
  const now = new Date();
  const currentHour = now.getHours(); // Server zamanı (Railway'de UTC olabilir)
  
  // Türkiye saati hesapla (UTC+3)
  const turkeyHour = (now.getUTCHours() + 3) % 24;
  
  // Gece 22:00 - 09:00 arası gönderme
  if (turkeyHour >= 22 || turkeyHour < 9) {
    log.info('[followup] Gece saati, hatırlatmalar atlanıyor', { turkeyHour });
    return;
  }

  try {
    // 1 saatlik hatırlatma bekleyenler
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
    
    const { data: pending1h } = await supabase
      .from('followup_queue')
      .select('*')
      .eq('is_completed', false)
      .eq('reminder_1h_sent', false)
      .lt('last_bot_message_at', oneHourAgo)
      .limit(20);

    if (pending1h && pending1h.length > 0) {
      log.info(`[followup] 1 saatlik hatırlatma bekleyen: ${pending1h.length}`);

      for (const entry of pending1h) {
        await sendReminder(entry, '1h');
      }
    }

    // 24 saatlik hatırlatma bekleyenler (1 saatlik zaten gönderilmiş olanlar)
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    
    const { data: pending24h } = await supabase
      .from('followup_queue')
      .select('*')
      .eq('is_completed', false)
      .eq('reminder_1h_sent', true)
      .eq('reminder_24h_sent', false)
      .lt('last_bot_message_at', twentyFourHoursAgo)
      .limit(20);

    if (pending24h && pending24h.length > 0) {
      log.info(`[followup] 24 saatlik hatırlatma bekleyen: ${pending24h.length}`);

      for (const entry of pending24h) {
        await sendReminder(entry, '24h');
      }
    }
  } catch (err) {
    log.error('[followup] processReminders hatası', err);
  }
}

/**
 * Tek bir müşteriye hatırlatma gönder
 */
async function sendReminder(entry, type) {
  const { sender_id, platform, id } = entry;
  const message = REMINDER_MESSAGES[type];

  try {
    let sent = false;

    if (platform === 'instagram') {
      sent = await sendInstagramMessage(sender_id, message);
    } else if (platform === 'messenger') {
      sent = await sendMessengerMessage(sender_id, message);
    } else if (platform === 'whatsapp') {
      // WhatsApp AutoResponder — proaktif mesaj gönderilemez
      log.info(`[followup] WhatsApp müşterisi, hatırlatma gönderilemez (raporda listelenecek)`, { sender_id });
      // Yine de kaydı güncelle ki tekrar denemesin
      sent = false;
    }

    // DB güncelle
    const updateData = type === '1h' 
      ? { reminder_1h_sent: true }
      : { reminder_24h_sent: true, is_completed: true }; // 24h son hatırlatma, kuyruğu kapat

    await supabase.from('followup_queue').update(updateData).eq('id', id);

    if (sent) {
      await trackEvent(sender_id, 'reminder_sent', platform, { reminder_type: type });
      log.info(`[followup] ${type} hatırlatma gönderildi`, { sender_id, platform });
    }
  } catch (err) {
    log.error(`[followup] Hatırlatma gönderme hatası`, { sender_id, type, err: err.message });
  }
}

/**
 * Rapor için bekleyen (sessiz) müşterilerin listesi
 */
async function getSilentCustomers() {
  try {
    const { data } = await supabase
      .from('followup_queue')
      .select('sender_id, platform, last_bot_message_at, reminder_1h_sent, reminder_24h_sent')
      .eq('is_completed', false)
      .order('last_bot_message_at', { ascending: true });

    return data || [];
  } catch (err) {
    log.error('[followup] getSilentCustomers hatası', err);
    return [];
  }
}

module.exports = { enqueueFollowup, completeFollowup, cancelFollowup, processReminders, getSilentCustomers };
