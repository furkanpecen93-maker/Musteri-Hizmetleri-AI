// services/daily_report.js — Günlük rapor üretici
// Her gün 21:00 (Türkiye saati) Telegram'a kapsamlı rapor gönderir
const { getDailyStats, getEventCounts } = require('./analytics');
const { getSilentCustomers } = require('./followup');
const { sendTelegramReport } = require('../utils/telegram');
const log = require('../utils/logger');

/**
 * Türkiye saatine göre bugünün tarih string'ini döndür
 */
function getTurkeyDateStr(date = new Date()) {
  const turkeyOffset = 3 * 60; // UTC+3
  const utc = date.getTime() + date.getTimezoneOffset() * 60000;
  const turkeyTime = new Date(utc + turkeyOffset * 60000);
  return turkeyTime.toISOString().split('T')[0];
}

/**
 * Türkiye gün adı
 */
function getTurkeyDayName(dateStr) {
  const days = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
  const date = new Date(dateStr + 'T12:00:00+03:00');
  return days[date.getDay()];
}

/**
 * Yüzde hesapla
 */
function pct(part, total) {
  if (total === 0) return '0';
  return Math.round((part / total) * 100);
}

/**
 * Basit progress bar oluştur
 */
function bar(value, maxValue) {
  if (maxValue === 0) return '';
  const filled = Math.round((value / maxValue) * 8);
  return '█'.repeat(Math.max(1, filled));
}

/**
 * Dünün istatistikleriyle karşılaştırma
 */
function trendArrow(today, yesterday) {
  if (yesterday === 0) return today > 0 ? '🆕' : '';
  const change = Math.round(((today - yesterday) / yesterday) * 100);
  if (change > 0) return `+%${change} ↑`;
  if (change < 0) return `%${change} ↓`;
  return '→';
}

/**
 * En yoğun saatleri bul
 */
function getTopHours(hourlyStats, topN = 3) {
  return Object.entries(hourlyStats)
    .map(([h, count]) => ({ hour: parseInt(h), count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, topN);
}

/**
 * Günlük rapor metnini oluştur
 */
async function generateDailyReport(dateStr) {
  const stats = await getDailyStats(dateStr);
  
  if (!stats) {
    return `📊 GÜNLÜK RAPOR — ${dateStr}\n\nBugün hiç müşteri etkileşimi olmadı.`;
  }

  const dayName = getTurkeyDayName(dateStr);
  const silentCustomers = await getSilentCustomers();

  // Dünün verilerini al (trend karşılaştırması için)
  const yesterday = new Date(new Date(dateStr + 'T12:00:00+03:00').getTime() - 86400000);
  const yesterdayStr = yesterday.toISOString().split('T')[0];
  const yesterdayStats = await getDailyStats(yesterdayStr);

  let report = '';

  // ═══ BÖLÜM 1: GENEL ÖZET ═══
  report += `📊 GÜNLÜK RAPOR — ${dateStr} (${dayName})\n`;
  report += `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  report += `👥 Toplam Yazan Müşteri: ${stats.totalCustomers}\n`;
  report += `💬 Toplam Mesaj Sayısı: ${stats.totalMessages}\n`;
  report += `🆕 Yeni Müşteri: ${stats.newCustomers}\n`;
  report += `🔄 Dönen Müşteri: ${stats.returningCustomers}\n`;
  report += `📊 Müşteri Başı Ort. Mesaj: ${stats.avgMessagesPerCustomer}\n`;

  // ═══ BÖLÜM 2: SATIŞ HUNİSİ ═══
  report += `\n🛒 SATIŞ HUNİSİ\n`;
  report += `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  report += `📋 Katalog Gönderilen: ${stats.catalogSent} (%${pct(stats.catalogSent, stats.totalCustomers)})\n`;
  report += `💰 Fiyat Soran: ${stats.priceInquiry} (%${pct(stats.priceInquiry, stats.totalCustomers)})\n`;
  report += `📐 Beden/Renk Soran: ${stats.sizeColorInquiry} (%${pct(stats.sizeColorInquiry, stats.totalCustomers)})\n`;
  report += `🛍️ Sipariş Niyeti: ${stats.orderIntent} (%${pct(stats.orderIntent, stats.totalCustomers)})\n`;
  report += `🔄 Ekibe Devredilen: ${stats.escalatedUnique} (%${pct(stats.escalatedUnique, stats.totalCustomers)})\n`;

  // Devir sebepleri
  if (Object.keys(stats.escalationReasons).length > 0) {
    for (const [reason, count] of Object.entries(stats.escalationReasons)) {
      report += `   ├─ ${reason}: ${count}\n`;
    }
  }

  // ═══ BÖLÜM 3: POPÜLER ÜRÜNLER ═══
  report += `\n👗 POPÜLER ÜRÜNLER\n`;
  report += `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  
  if (stats.topProducts.length > 0) {
    report += `🏆 En Çok Sorulan:\n`;
    stats.topProducts.forEach(([query, count], i) => {
      report += `   ${i + 1}. "${query}" — ${count} kez\n`;
    });
  } else {
    report += `Bugün ürün sorgusu yapılmadı.\n`;
  }

  if (stats.topNotFound.length > 0) {
    report += `\n🔍 Bulunamayan Ürünler:\n`;
    stats.topNotFound.forEach(([query, count]) => {
      report += `   • "${query}" — ${count} kez soruldu\n`;
    });
  }

  // ═══ BÖLÜM 4: AKSAYAN KONULAR ═══
  report += `\n⚠️ AKSAYAN KONULAR\n`;
  report += `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  
  if (stats.negativeUnique > 0) {
    report += `😤 Sinirli/Memnuniyetsiz Müşteri: ${stats.negativeUnique}\n`;
  }

  // Bot'un çözemediği konular (escalation sebepleri)
  const nonOrderEscalations = Object.entries(stats.escalationReasons)
    .filter(([reason]) => reason !== 'sipariş');
  if (nonOrderEscalations.length > 0) {
    report += `🤖 Bot'un Çözemediği Konular:\n`;
    nonOrderEscalations.forEach(([reason, count]) => {
      report += `   • ${reason}: ${count} kez\n`;
    });
  }

  if (stats.negativeUnique === 0 && nonOrderEscalations.length === 0) {
    report += `✅ Bugün önemli bir aksaklık tespit edilmedi.\n`;
  }

  // ═══ BÖLÜM 5: PLATFORM & SAAT ANALİZİ ═══
  report += `\n📱 PLATFORM DAĞILIMI\n`;
  report += `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  
  const maxPlatformCount = Math.max(...Object.values(stats.platformStats), 1);
  for (const [platform, count] of Object.entries(stats.platformStats).sort((a, b) => b[1] - a[1])) {
    const platformName = platform === 'whatsapp' ? 'WhatsApp' : platform === 'instagram' ? 'Instagram' : 'Messenger';
    report += `   • ${platformName}: ${count} müşteri (%${pct(count, stats.totalCustomers)}) ${bar(count, maxPlatformCount)}\n`;
  }

  // En yoğun saatler
  const topHours = getTopHours(stats.hourlyStats);
  if (topHours.length > 0) {
    report += `\n⏰ EN YOĞUN SAATLER\n`;
    topHours.forEach(({ hour, count }) => {
      const hourStr = `${String(hour).padStart(2, '0')}:00-${String(hour + 1).padStart(2, '0')}:00`;
      report += `   • ${hourStr}  ${bar(count, topHours[0].count)} ${count} müşteri\n`;
    });
  }

  // ═══ BÖLÜM 6: BOT PERFORMANSI ═══
  report += `\n🤖 BOT PERFORMANSI\n`;
  report += `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  
  const botResolved = stats.totalCustomers - stats.escalatedUnique;
  report += `✅ Bot Çözdü (insan gerekmedi): ${botResolved} (%${pct(botResolved, stats.totalCustomers)})\n`;
  report += `🔄 İnsan Devir Oranı: ${stats.escalatedUnique} (%${pct(stats.escalatedUnique, stats.totalCustomers)})\n`;
  
  if (stats.avgResponseTimeMs > 0) {
    const avgSec = (stats.avgResponseTimeMs / 1000).toFixed(1);
    report += `⏱️ Ort. Cevap Süresi: ${avgSec} sn\n`;
  }
  
  report += `💬 Ort. Konuşma Uzunluğu: ${stats.avgMessagesPerCustomer} mesaj\n`;

  // Funnel conversion'lar
  if (stats.catalogSent > 0 && stats.priceInquiry > 0) {
    report += `🎯 Katalog → Fiyat Sorma: %${pct(stats.priceInquiry, stats.catalogSent)}\n`;
  }
  if (stats.priceInquiry > 0 && stats.orderIntent > 0) {
    report += `🎯 Fiyat → Sipariş Niyeti: %${pct(stats.orderIntent, stats.priceInquiry)}\n`;
  }

  // ═══ BÖLÜM 7: TAKİP & HATIRLATMA ═══
  report += `\n🔕 TAKİP DURUMU\n`;
  report += `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  
  if (stats.remindersSent > 0) {
    report += `📤 Bugün Hatırlatma Gönderilen: ${stats.remindersSent}\n`;
    if (stats.remindersConverted > 0) {
      report += `📊 Hatırlatma → Dönüş Oranı: %${pct(stats.remindersConverted, stats.remindersSent)}\n`;
    }
  }

  // Sessiz müşteriler
  if (silentCustomers.length > 0) {
    report += `\n🔕 Şu An Sessiz Müşteriler: ${silentCustomers.length}\n`;
    
    // Platform bazında grupla
    const silentByPlatform = {};
    silentCustomers.forEach(c => {
      const p = c.platform || 'bilinmiyor';
      if (!silentByPlatform[p]) silentByPlatform[p] = [];
      silentByPlatform[p].push(c);
    });
    
    for (const [platform, customers] of Object.entries(silentByPlatform)) {
      const platformName = platform === 'whatsapp' ? 'WhatsApp' : platform === 'instagram' ? 'Instagram' : platform === 'messenger' ? 'Messenger' : platform;
      const note = platform === 'whatsapp' ? ' (manuel takip gerekli)' : '';
      report += `   • ${platformName}: ${customers.length} kişi${note}\n`;
    }
  } else {
    report += `✅ Tüm müşteriler cevap aldı, sessiz müşteri yok.\n`;
  }

  // ═══ TREND KARŞILAŞTIRMASI ═══
  if (yesterdayStats) {
    report += `\n📈 TREND (Dün ile Kıyasla)\n`;
    report += `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    report += `   👥 Müşteri: ${yesterdayStats.totalCustomers} → ${stats.totalCustomers} (${trendArrow(stats.totalCustomers, yesterdayStats.totalCustomers)})\n`;
    report += `   🛍️ Sipariş: ${yesterdayStats.orderIntent} → ${stats.orderIntent} (${trendArrow(stats.orderIntent, yesterdayStats.orderIntent)})\n`;
    report += `   📋 Katalog: ${yesterdayStats.catalogSent} → ${stats.catalogSent} (${trendArrow(stats.catalogSent, yesterdayStats.catalogSent)})\n`;
    report += `   🔄 Devir: ${yesterdayStats.escalatedUnique} → ${stats.escalatedUnique} (${trendArrow(stats.escalatedUnique, yesterdayStats.escalatedUnique)})\n`;
    
    if (stats.negativeUnique !== undefined && yesterdayStats.negativeUnique !== undefined) {
      report += `   😤 Şikayet: ${yesterdayStats.negativeUnique} → ${stats.negativeUnique} (${trendArrow(stats.negativeUnique, yesterdayStats.negativeUnique)})\n`;
    }
  }

  report += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  report += `🕘 Rapor saati: ${new Date().toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul' })}`;

  return report;
}

/**
 * Günlük raporu üret ve Telegram'a gönder
 */
async function sendDailyReport() {
  try {
    const todayStr = getTurkeyDateStr();
    log.info(`[daily_report] Günlük rapor üretiliyor: ${todayStr}`);

    const reportText = await generateDailyReport(todayStr);
    await sendTelegramReport(reportText);

    log.info(`[daily_report] Rapor Telegram'a gönderildi`);
  } catch (err) {
    log.error('[daily_report] Rapor üretme/gönderme hatası', err);
  }
}

module.exports = { generateDailyReport, sendDailyReport, getTurkeyDateStr };
