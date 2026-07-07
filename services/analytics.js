// services/analytics.js — Müşteri etkileşim olay takip sistemi
const { createClient } = require('@supabase/supabase-js');
const { config } = require('../config/env');
const log = require('../utils/logger');

const supabase = createClient(config.supabaseUrl, config.supabaseKey);

// ── Olay Kaydetme ──

/**
 * Müşteri etkileşim olayı kaydet
 * @param {string} senderId 
 * @param {string} eventType - 'message_received', 'catalog_sent', 'order_intent', vb.
 * @param {string} platform - 'instagram', 'messenger', 'whatsapp'
 * @param {Object} metadata - Ekstra bilgi
 */
async function trackEvent(senderId, eventType, platform, metadata = {}) {
  try {
    await supabase.from('customer_events').insert({
      sender_id: senderId,
      event_type: eventType,
      platform: platform || 'unknown',
      metadata: metadata,
      created_at: new Date().toISOString()
    });
  } catch (err) {
    // Analytics hatası ana akışı bozmasın
    log.error(`[analytics] Event kayıt hatası: ${eventType}`, err);
  }
}

/**
 * Bot cevabını analiz edip uygun event'ları otomatik kaydet
 * @param {string} senderId
 * @param {string} userMessage - Müşteri mesajı
 * @param {string} botResponse - Bot cevabı
 * @param {string} platform
 * @param {Object} extras - { responseTimeMs, toolCalled, queryUsed, resultCount }
 */
async function analyzeAndTrack(senderId, userMessage, botResponse, platform, extras = {}) {
  const events = [];
  const lowerResponse = botResponse.toLowerCase();
  const lowerMessage = userMessage.toLowerCase();

  // 1. Katalog gönderildi mi?
  if (lowerResponse.includes('katalog') && (lowerResponse.includes('railway.app/katalog') || lowerResponse.includes('inceleyin'))) {
    events.push({ type: 'catalog_sent', meta: {} });
  }

  // 2. Ürün sorgusu (function calling tetiklendi mi?)
  if (extras.toolCalled === 'urun_sorgula') {
    events.push({ type: 'product_query', meta: { 
      query: extras.queryUsed || '', 
      result_count: extras.resultCount || 0,
      product_codes: extras.productCodes || []
    }});

    // Sonuç boş döndüyse — bulunamayan ürün
    if ((extras.resultCount || 0) === 0) {
      events.push({ type: 'product_not_found', meta: { query: extras.queryUsed || '' } });
    }
  }

  // 3. Fiyat sorgusu
  const priceKeywords = ['fiyat', 'kaç tl', 'kaç lira', 'ne kadar', 'fiyatı', 'ücret'];
  if (priceKeywords.some(k => lowerMessage.includes(k))) {
    events.push({ type: 'price_inquiry', meta: { query: userMessage } });
  }

  // 4. Beden/renk sorgusu
  const sizeColorKeywords = ['beden', 'numara', 'renk', 'xl', 'xxl', 'small', 'medium', 'large', 'battal', 'büyük beden'];
  if (sizeColorKeywords.some(k => lowerMessage.includes(k))) {
    events.push({ type: 'size_color_inquiry', meta: { query: userMessage } });
  }

  // 5. Sipariş niyeti
  const orderKeywords = ['sipariş', 'siparis', 'almak istiyorum', 'gönderin', 'gönder', 'kaç seri', 'seri alayım', 'alacağım', 'alacagim'];
  if (orderKeywords.some(k => lowerMessage.includes(k))) {
    events.push({ type: 'order_intent', meta: { context: userMessage.substring(0, 200) } });
  }

  // 6. Ekibe devredildi mi?
  if (botResponse.includes('[DEVRET]') || botResponse.includes('(DEVRET)') || botResponse.includes('[SİPARİŞ]')) {
    // Devir sebebini tahmin et
    let reason = 'genel';
    if (orderKeywords.some(k => lowerMessage.includes(k))) reason = 'sipariş';
    else if (lowerMessage.includes('şikayet') || lowerMessage.includes('sorun') || lowerMessage.includes('kızgın')) reason = 'şikayet';
    else if (lowerMessage.includes('görüntülü') || lowerMessage.includes('arama') || lowerMessage.includes('randevu')) reason = 'randevu';
    else if (lowerMessage.includes('iade') || lowerMessage.includes('değişim')) reason = 'iade';
    else if (lowerMessage.includes('fason') || lowerMessage.includes('özel üretim')) reason = 'fason';
    
    events.push({ type: 'escalated', meta: { reason } });
  }

  // 7. Negatif sentiment (sinirli müşteri)
  const negativeKeywords = ['kızgın', 'sinir', 'rezalet', 'dolandır', 'güvenilmez', 'saçma', 'çok kötü', 'berbat', 'aldatma', 'yalan'];
  if (negativeKeywords.some(k => lowerMessage.includes(k))) {
    events.push({ type: 'negative_sentiment', meta: { trigger_words: negativeKeywords.filter(k => lowerMessage.includes(k)) } });
  }

  // 8. Bot cevap süresi
  if (extras.responseTimeMs) {
    events.push({ type: 'bot_response', meta: { response_time_ms: extras.responseTimeMs } });
  }

  // Tüm event'ları paralel kaydet
  await Promise.all(events.map(e => trackEvent(senderId, e.type, platform, e.meta)));
}

// ── Rapor için Sorgu Fonksiyonları ──

/**
 * Belirli tarih aralığındaki event'ları say
 */
async function getEventCounts(startDate, endDate) {
  try {
    const { data, error } = await supabase
      .from('customer_events')
      .select('event_type, sender_id, platform, metadata, created_at')
      .gte('created_at', startDate)
      .lt('created_at', endDate);

    if (error) throw error;
    return data || [];
  } catch (err) {
    log.error('[analytics] getEventCounts hatası', err);
    return [];
  }
}

/**
 * Günlük rapor için aggregate veri üret
 */
async function getDailyStats(dateStr) {
  // dateStr format: '2026-07-07'
  const startDate = `${dateStr}T00:00:00+03:00`;
  const endDate = `${dateStr}T23:59:59+03:00`;

  const events = await getEventCounts(startDate, endDate);
  
  if (events.length === 0) {
    return null;
  }

  // Tekil müşteriler
  const uniqueSenders = new Set(events.filter(e => e.event_type === 'message_received').map(e => e.sender_id));
  
  // Platform dağılımı
  const platformCounts = {};
  events.filter(e => e.event_type === 'message_received').forEach(e => {
    platformCounts[e.platform] = (platformCounts[e.platform] || new Set()).add(e.sender_id);
  });
  const platformStats = {};
  for (const [p, senders] of Object.entries(platformCounts)) {
    platformStats[p] = senders.size;
  }

  // Event türlerine göre sayılar
  const eventsByType = {};
  events.forEach(e => {
    if (!eventsByType[e.event_type]) eventsByType[e.event_type] = [];
    eventsByType[e.event_type].push(e);
  });

  // Yeni müşteri kontrolü (message_received'da is_new_customer: true olanlar)
  const newCustomers = (eventsByType['message_received'] || [])
    .filter(e => e.metadata?.is_new_customer === true)
    .map(e => e.sender_id);
  const uniqueNewCustomers = new Set(newCustomers).size;

  // Katalog gönderilen tekil müşteri
  const catalogSent = new Set((eventsByType['catalog_sent'] || []).map(e => e.sender_id)).size;

  // Fiyat soran
  const priceInquiry = new Set((eventsByType['price_inquiry'] || []).map(e => e.sender_id)).size;

  // Beden/renk soran
  const sizeColorInquiry = new Set((eventsByType['size_color_inquiry'] || []).map(e => e.sender_id)).size;

  // Sipariş niyeti
  const orderIntent = new Set((eventsByType['order_intent'] || []).map(e => e.sender_id)).size;

  // Ekibe devredilen
  const escalated = (eventsByType['escalated'] || []);
  const escalatedUnique = new Set(escalated.map(e => e.sender_id)).size;
  const escalationReasons = {};
  escalated.forEach(e => {
    const reason = e.metadata?.reason || 'genel';
    escalationReasons[reason] = (escalationReasons[reason] || 0) + 1;
  });

  // Popüler ürünler (product_query'lerden)
  const productQueries = (eventsByType['product_query'] || []);
  const productQueryCounts = {};
  productQueries.forEach(e => {
    const query = e.metadata?.query || 'bilinmiyor';
    productQueryCounts[query] = (productQueryCounts[query] || 0) + 1;
  });
  const topProducts = Object.entries(productQueryCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  // Bulunamayan ürünler
  const notFoundQueries = (eventsByType['product_not_found'] || []);
  const notFoundCounts = {};
  notFoundQueries.forEach(e => {
    const query = e.metadata?.query || 'bilinmiyor';
    notFoundCounts[query] = (notFoundCounts[query] || 0) + 1;
  });
  const topNotFound = Object.entries(notFoundCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  // Sinirli müşteriler
  const negativeSentiment = (eventsByType['negative_sentiment'] || []);
  const negativeUnique = new Set(negativeSentiment.map(e => e.sender_id)).size;

  // Cevap süresi ortalaması
  const responseTimes = (eventsByType['bot_response'] || [])
    .map(e => e.metadata?.response_time_ms)
    .filter(t => t != null && t > 0);
  const avgResponseTime = responseTimes.length > 0 
    ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length)
    : 0;

  // Saat dağılımı
  const hourlyDistribution = {};
  events.filter(e => e.event_type === 'message_received').forEach(e => {
    const hour = new Date(e.created_at).getHours();
    if (!hourlyDistribution[hour]) hourlyDistribution[hour] = new Set();
    hourlyDistribution[hour].add(e.sender_id);
  });
  const hourlyStats = {};
  for (const [h, senders] of Object.entries(hourlyDistribution)) {
    hourlyStats[h] = senders.size;
  }

  // Toplam mesaj sayısı
  const totalMessages = events.filter(e => 
    e.event_type === 'message_received' || e.event_type === 'bot_response'
  ).length;

  // Hatırlatma istatistikleri
  const remindersSent = (eventsByType['reminder_sent'] || []).length;
  const remindersConverted = (eventsByType['reminder_converted'] || []).length;

  return {
    date: dateStr,
    totalCustomers: uniqueSenders.size,
    newCustomers: uniqueNewCustomers,
    returningCustomers: uniqueSenders.size - uniqueNewCustomers,
    totalMessages,
    avgMessagesPerCustomer: uniqueSenders.size > 0 ? (totalMessages / uniqueSenders.size).toFixed(1) : '0',
    catalogSent,
    priceInquiry,
    sizeColorInquiry,
    orderIntent,
    escalatedUnique,
    escalationReasons,
    topProducts,
    topNotFound,
    negativeUnique,
    avgResponseTimeMs: avgResponseTime,
    platformStats,
    hourlyStats,
    remindersSent,
    remindersConverted,
    rawEvents: events // Gemini analizi için ham veri
  };
}

module.exports = { trackEvent, analyzeAndTrack, getDailyStats, getEventCounts };
