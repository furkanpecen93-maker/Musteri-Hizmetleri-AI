// server.js — Müşteri Hizmetleri AI Ana Sunucu
// Instagram DM + Facebook Messenger + WhatsApp (ManyChat)
const express = require('express');
const crypto = require('crypto');
const cron = require('node-cron');
const { config } = require('./config/env');
const log = require('./utils/logger');
const { sendTelegramNotification, sendTelegramReport, setPauseCallback, startPolling, handleCallbackQuery } = require('./utils/telegram');
const { generateResponse } = require('./services/gemini');
const { sendInstagramMessage, sendMessengerMessage } = require('./services/meta_api');
const { getCatalog } = require('./services/catalog');
const { addMessage, getHistory, isDuplicate, getState, updateState, clearHistory, hasUserBeenGreeted, markUserAsGreeted } = require('./services/memory');
const { trackEvent, analyzeAndTrack } = require('./services/analytics');
const { enqueueFollowup, completeFollowup, cancelFollowup, processReminders } = require('./services/followup');
const { sendDailyReport, generateDailyReport } = require('./services/daily_report');
const debounce = require('./services/debounce');
const fetch = require('node-fetch');

function processAiResponseWithTelegram(aiResponseText, senderId, userMessage) {
  const devretRegex = /\[DEVRET\]|\(DEVRET\)|\[SİPARİŞ\]|\(SİPARİŞ\)|\[SIPARIS\]|\(SIPARIS\)/gi;
  let cleanedText = aiResponseText.replace(devretRegex, '').trim();
  
  if (cleanedText !== aiResponseText.trim()) {
    // The tag was found and removed, so we should notify telegram
    sendTelegramNotification(senderId, userMessage);
    // Ekibe devredilen müşteriye hatırlatma gönderilmemeli
    cancelFollowup(senderId).catch(() => {});
  }
  
  // ═══ DAHİLİ DÜŞÜNCE SIZINTISI TEMİZLEME (tüm platformlar) ═══
  // THOUGHT/THINKING/REASONING blokları
  cleanedText = cleanedText.replace(/(?:^|\n)\s*(?:\[|\*|\()?\s*(?:THOUGHT|THINKING|REASONING|ANALYSIS|DÜŞÜNCE|ANALİZ|İÇ\s*MONOLOG|INTERNAL|NOTE\s*TO\s*SELF)\s*(?:\]|\*|\))?\s*[:\-]?\s*[\s\S]*?(?=\n\n|$)/gi, '');
  
  // İngilizce iç monolog cümleleri (rule referansları dahil)
  cleanedText = cleanedText.replace(/(?:^|\n)\s*(?:Since there'?s|I should|I need to|The user is|The customer is|Based on the rules|According to|Let me think|I will respond|I notice that|I can see that|rule \d)[^\n]*(?:\n(?!\n)[^\n]*)*/gi, '');
  
  // ═══ YAPAY ZEKA KİMLİĞİ SIZINTISI TEMİZLEME ═══
  cleanedText = cleanedText.replace(/[^\n]*(?:ben\s*bir\s*(?:yapay\s*zeka|bot|sanal\s*asistan|dijital\s*asistan|AI)\s*(?:olduğum|olarak)|ruh\s*halim\s*(?:yok|bulunmamaktadır|olmadığı)|duygu\s*durumum\s*(?:yok|bulunmamaktadır)|programlandığım|bir\s*makine\s*olarak)[^\n]*/gi, '');
  
  // Çoklu boş satırları temizle
  cleanedText = cleanedText.replace(/\n{3,}/g, '\n\n').trim();
  
  // Fallback: tamamen boşaldıysa
  if (!cleanedText || cleanedText.length < 5) {
    log.warn('[process] ⚠️ THOUGHT LEAK tespit edildi ve engellendi!', { senderId, original: aiResponseText.substring(0, 200) });
    cleanedText = 'Mesajınızı aldım efendim. Sizi ilgili ekip arkadaşlarıma yönlendiriyorum, en kısa sürede size dönüş yapacaklar.';
  }
  
  return cleanedText;
}

function triggerAudit(senderId) {
  // Teftiş botu (Auditor), mesajların yarım gitmesine sebep olabileceği şüphesiyle kullanıcı talebi üzerine iptal edilmiştir.
  return;
}

const GREETING_MESSAGE = `Merhabalar, Peçen Toptan İmalat'a hoş geldiniz.

Peçen Toptan İmalat olarak 22 yılı aşkın süredir kadın giyim alanında üretim yapan köklü bir imalat firmasıyız. Kadın spor giyim, gündelik giyim ve iç giyim koleksiyonlarımızla güncel moda trendlerini kaliteli üretim ve doğru fiyat anlayışıyla bir araya getiriyoruz.

Toptan ihtiyaçlarınız için size en uygun ürünleri sunmaktan memnuniyet duyarız.

Size nasıl yardımcı olabiliriz?`;

const CATALOG_MESSAGE = `Tabii ki efendim! 😊 Tüm ürünlerimizi fiyatlarıyla birlikte aşağıdaki katalog linkinden inceleyebilirsiniz:

👉 https://musteri-hizmetleri-ai-production-f980.up.railway.app/katalog

Beğendiğiniz ürünler hakkında detaylı bilgi almak isterseniz bana yazabilirsiniz.`;

/**
 * Müşterinin mesajının genel bir katalog/ürün görme talebi olup olmadığını kontrol et.
 * Belirli bir ürün adı/kodu soranları (örn: "P-200 fiyatı", "siyah tayt") yakalamaz,
 * sadece genel "ürünleri görmek istiyorum" tarzı mesajları yakalar.
 */
function isCatalogRequest(message) {
  const normalized = message
    .toLowerCase()
    .replace(/[ıİ]/g, 'i')
    .replace(/[şŞ]/g, 's')
    .replace(/[çÇ]/g, 'c')
    .replace(/[ğĞ]/g, 'g')
    .replace(/[üÜ]/g, 'u')
    .replace(/[öÖ]/g, 'o')
    .replace(/[?!.,;:'"]/g, '')
    .trim();

  const catalogPatterns = [
    /urunler/,
    /urunleri\s*(gorebilir|gormek|gorsem|goreyim|gosterir|bakmak|bakabilir)/,
    /urun\s*(hakkinda|icin)\s*(bilgi|detay)/,
    /urunleriniz/,
    /modelleriniz/,
    /modelleri\s*(gorebilir|gormek|gorsem)/,
    /neleriniz\s*var/,
    /ne\s*(satiyorsunuz|uretiyorsunuz)/,
    /katalog/,
    /urun\s*katalogu/,
    /fiyat\s*listesi/,
    /toptan\s*fiyat/,
    /koleksiyonunuz/,
    /koleksiyonu\s*(gorebilir|gormek|gorsem)/,
    /cesitleriniz/,
    /ne\s*gibi\s*urunler/,
    /urun\s*cesitleri/,
    /^urunler$/,
    /^katalog$/,
    /^fiyatlar$/,
  ];

  return catalogPatterns.some(pattern => pattern.test(normalized));
}

const fs = require('fs');
const path = require('path');

const app = express();

// Raw body for signature verification and debugging
app.use((req, res, next) => {
  log.info(`[GELEN ISTEK] ${req.method} ${req.url}`);
  next();
});
app.use(express.text({
  limit: '5mb',
  type: '*/*'
}));

// CRM Yetkilendirme (Basic Auth)
const crmAuth = (req, res, next) => {
  if (req.path.startsWith('/crm') || req.path.startsWith('/api/crm')) {
    const b64auth = (req.headers.authorization || '').split(' ')[1] || '';
    const [login, password] = Buffer.from(b64auth, 'base64').toString().split(':');
    
    // Kullanıcı adı: admin, Şifre: admin (Basit koruma)
    if (login === 'admin' && password === 'admin') {
      return next();
    }
    res.set('WWW-Authenticate', 'Basic realm="401"');
    return res.status(401).send('Authentication required.');
  }
  next();
};
app.use(crmAuth);

// Statik dosyaları dışa aç (Katalog PDF'leri ve arayüzü)
app.use(express.static(path.join(__dirname, 'public')));
app.get('/katalog', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

// Health check endpoint for monitoring (GitHub Actions)
app.get('/health', (req, res) => res.status(200).json({ status: 'ok', time: new Date().toISOString(), version: '2026-07-08-revert-clean' }));

// ══════════════════════════════════════════════
// 1. META WEBHOOK VERIFICATION (GET)
// Instagram + Messenger aynı endpoint'i kullanır
// ══════════════════════════════════════════════
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === config.metaVerifyToken) {
    log.info('[webhook] Meta doğrulama başarılı ✅');
    return res.status(200).send(challenge);
  }

  log.warn('[webhook] Meta doğrulama başarısız', { mode, token });
  return res.status(403).send('Forbidden');
});

// ══════════════════════════════════════════════
// 2. META WEBHOOK HANDLER (POST)
// Instagram DM + Messenger mesajları burada gelir
// ══════════════════════════════════════════════

// Per-sender processing lock (AI üretimi sırasında yeni debounce başlatmayı engellemek için)
const aiProcessingLock = new Set();

// ── İnsan Devralma (Human Takeover) Sistemi ──
// İnsan ekip bir müşteriye yazdığında bot 15 dk susar
const TAKEOVER_DURATION_MS = 15 * 60 * 1000; // 15 dakika
const humanTakeover = new Map(); // senderId → { pauseUntil: timestamp, reason: string }

function pauseBotForSender(senderId, reason = 'echo') {
  const pauseUntil = Date.now() + TAKEOVER_DURATION_MS;
  humanTakeover.set(senderId, { pauseUntil, reason });
  log.info(`[takeover] Bot ${Math.round(TAKEOVER_DURATION_MS / 60000)} dk duraklatıldı`, { senderId, reason });
}
// Telegram üzerinden manuel susturma talebi gelirse bu fonksiyonu çağır
if (setPauseCallback) setPauseCallback((senderId) => pauseBotForSender(senderId, 'Telegram manuel devralma'));

// Telegram webhook/polling başlatma — sunucu dinlemeye başladıktan sonra yapılacak
// (Aşağıda app.listen callback'i içinde)

function isBotPaused(senderId) {
  const entry = humanTakeover.get(senderId);
  if (!entry) return false;
  if (Date.now() > entry.pauseUntil) {
    humanTakeover.delete(senderId); // Süre doldu, temizle
    log.info(`[takeover] Bot tekrar aktif`, { senderId });
    return false;
  }
  return true;
}

function resumeBot(senderId) {
  humanTakeover.delete(senderId);
  log.info(`[takeover] Bot manuel olarak devam ettirildi`, { senderId });
}

app.post('/webhook', async (req, res) => {
  // Meta 20 saniye timeout uyguluyor — hemen 200 dön
  res.status(200).send('EVENT_RECEIVED');

  try {
    let body = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch (e) {
        log.error('[webhook] JSON parse hatası', req.body);
        return res.status(400).send('Invalid JSON');
      }
    }

    if (body.object !== 'page' && body.object !== 'instagram') {
      log.warn('[webhook] Bilinmeyen object tipi', { object: body.object });
      return;
    }

    // Platformu belirle
    const platform = body.object === 'instagram' ? 'instagram' : 'messenger';

    for (const entry of (body.entry || [])) {
      const messaging = entry.messaging || [];

      for (const event of messaging) {
        if (!event.message || !event.message.text) continue;

        // ── İNSAN DEVRALMA: Echo mesajı = insan ekip yazdı ──
        if (event.message.is_echo) {
          // Echo'daki recipient.id müşterinin ID'sidir
          const customerId = event.recipient?.id;
          if (customerId) {
            pauseBotForSender(customerId, 'echo');
            log.info(`[takeover] İnsan ekip mesaj gönderdi, bot duraklatıldı`, { customerId, platform });
          }
          continue;
        }

        const senderId = event.sender.id;
        const messageText = event.message.text.trim();

        if (!senderId || !messageText) continue;

        // ── İNSAN DEVRALMA: Bot duraklatılmış mı kontrol et ──
        if (isBotPaused(senderId)) {
          log.info(`[takeover] Bot duraklatılmış, mesaj atlanıyor`, { senderId, platform });
          continue;
        }

        log.info(`[webhook] ${platform} mesaj alındı`, { senderId, len: messageText.length });

        // Duplicate kontrolü
        if (await isDuplicate(senderId, messageText)) {
          log.info(`[webhook] Duplicate mesaj atlandı`, { senderId });
          continue;
        }

        // ── DEBOUNCE: Mesajı kuyruğa al ──
        // AI zaten bu sender için çalışıyorsa mesajı yine kuyruğa at (sonraki cycle'da işlenir)
        if (aiProcessingLock.has(senderId)) {
          log.info(`[webhook] AI çalışıyor, mesaj bir sonraki debounce cycle'ında işlenecek`, { senderId });
          // Mesajı hafızaya ekle ki kaybolmasın
          addMessage(senderId, 'user', messageText).catch(() => {});
          continue;
        }

        debounce.enqueue(senderId, messageText).then(result => {
          if (result) {
            // Debounce süresi doldu, birleştirilmiş mesajları işle
            processMessage(senderId, result.combined, platform, result.messages.length).catch(err => {
              log.error(`[webhook] İşleme hatası`, err);
            });
          }
          // null = mesaj kuyruğa eklendi, ilk çağrı zaten bekliyor
        });
      }
    }
  } catch (err) {
    log.error('[webhook] Genel hata', err);
  }
});

/**
 * Mesajı işle: debounce sonrası birleştirilmiş mesaj → AI cevap üret → gönder
 * @param {string} senderId
 * @param {string} combinedMessage - Debounce tarafından birleştirilmiş mesaj(lar)
 * @param {string} platform
 * @param {number} messageCount - Kaç mesaj birleştirildi
 */
async function processMessage(senderId, combinedMessage, platform, messageCount = 1) {
  aiProcessingLock.add(senderId);

  try {
    // Müşteri mesaj attı — mevcut followup'ı kapat (müşteri döndü)
    completeFollowup(senderId).catch(() => {});

    // Yeni müşteri mi kontrol et (analytics için)
    const isNewCustomer = !(await hasUserBeenGreeted(senderId));

    // Analytics: mesaj alındı
    trackEvent(senderId, 'message_received', platform, {
      message_length: combinedMessage.length,
      is_new_customer: isNewCustomer,
      debounced_count: messageCount
    }).catch(() => {});

    if (messageCount > 1) {
      log.info(`[process] ${messageCount} mesaj debounce ile birleştirildi`, { senderId });
    }

    if (/^s[ıi]f[ıi]rla$/i.test(combinedMessage.trim())) {
      clearHistory(senderId);
      const wipeMsg = 'Hafıza başarıyla sıfırlandı. Teste baştan başlayabilirsiniz.';
      if (platform === 'instagram') {
        await sendInstagramMessage(senderId, wipeMsg);
      } else {
        await sendMessengerMessage(senderId, wipeMsg);
      }
      return;
    }

    // Kullanıcı mesajını kaydet
    await addMessage(senderId, 'user', combinedMessage);

    // Katalog ve geçmişi al
    const [catalog, history] = await Promise.all([
      getCatalog(),
      Promise.resolve(getHistory(senderId))
    ]);

    // İlk mesaj kontrolü ve Karşılama
    const isFirstMessageEver = !(await hasUserBeenGreeted(senderId));
    if (isFirstMessageEver) {
      await markUserAsGreeted(senderId);
      await addMessage(senderId, 'assistant', GREETING_MESSAGE);
      if (platform === 'instagram') {
        await sendInstagramMessage(senderId, GREETING_MESSAGE);
      } else {
        await sendMessengerMessage(senderId, GREETING_MESSAGE);
      }
    }

    // ═══ KATALOG TALEBİ BYPASS: AI'ya gitmeden direkt katalog linki gönder ═══
    if (isCatalogRequest(combinedMessage)) {
      log.info('[process] Katalog talebi tespit edildi, direkt katalog linki gönderiliyor', { senderId, platform });
      const catalogResponse = CATALOG_MESSAGE;
      addMessage(senderId, 'assistant', catalogResponse);

      // Analytics
      trackEvent(senderId, 'catalog_request_bypass', platform, {
        original_message: combinedMessage
      }).catch(() => {});

      // Followup kuyruğuna ekle
      enqueueFollowup(senderId, platform).catch(() => {});

      if (platform === 'instagram') {
        await sendInstagramMessage(senderId, catalogResponse);
      } else {
        await sendMessengerMessage(senderId, catalogResponse);
      }

      log.info('[process] Katalog linki gönderildi', { senderId, platform });
      return;
    }

    // AI cevap üret (süre ölç)
    const aiStartTime = Date.now();
    const currentState = await getState(senderId);
    currentState.platform = platform;
    const aiResponseObj = await generateResponse(combinedMessage, history, catalog, currentState, senderId);
    const responseTimeMs = Date.now() - aiStartTime;
    const aiResponse = processAiResponseWithTelegram(aiResponseObj.text, senderId, combinedMessage);

    if (aiResponseObj.stateUpdates) {
      await updateState(senderId, aiResponseObj.stateUpdates);
    }

    // KESİN ÇÖZÜM (Foolproof check): Eğer yapay zeka JSON'da true yapmayı unutursa metinden yakala
    const lowerResp = aiResponse.toLowerCase();
    if (lowerResp.includes('nerede') || lowerResp.includes('hangi platform')) {
      updateState(senderId, { hasAskedLocation: true });
    }

    // AI cevabını kaydet
    addMessage(senderId, 'assistant', aiResponse);
    triggerAudit(senderId);

    // Analytics: bot cevabını ve AI davranışını takip et
    analyzeAndTrack(senderId, combinedMessage, aiResponseObj.text, platform, {
      responseTimeMs,
      toolCalled: aiResponseObj.toolCallInfo?.toolCalled,
      queryUsed: aiResponseObj.toolCallInfo?.queryUsed,
      resultCount: aiResponseObj.toolCallInfo?.resultCount,
      productCodes: aiResponseObj.toolCallInfo?.productCodes
    }).catch(() => {});

    // Followup kuyruğuna ekle (bot cevap verdi, müşteri cevap verecek mi?)
    enqueueFollowup(senderId, platform).catch(() => {});

    // Platforma göre gönder
    if (platform === 'instagram') {
      await sendInstagramMessage(senderId, aiResponse);
    } else {
      await sendMessengerMessage(senderId, aiResponse);
    }

    log.info(`[process] İşlem tamamlandı`, { senderId, platform, debounced: messageCount });
  } finally {
    aiProcessingLock.delete(senderId);
  }
}

/**
 * Senkron (HTTP Response bekleyen) Webhook'lar için Debounce (WhatsApp / ManyChat)
 * Debounce modülü ile mesajları birleştirip handler'a verir.
 */
async function processSyncWebhook(senderId, initialMessage, handler) {
  // Debounce kuyruğuna ekle
  const result = await debounce.enqueue(senderId, initialMessage);

  if (!result) {
    // Bu mesaj kuyruğa eklendi, ilk çağrı zaten bekliyor
    return null;
  }

  // Debounce süresi doldu, birleştirilmiş mesajlarla devam et
  const { combined: combinedMessage, messages } = result;

  if (messages.length > 1) {
    log.info(`[sync-webhook] ${messages.length} mesaj debounce ile birleştirildi`, { senderId });
  }

  if (/^s[ıi]f[ıi]rla$/i.test(combinedMessage.trim())) {
    await clearHistory(senderId);
    return "Hafıza başarıyla sıfırlandı. Teste baştan başlayabilirsiniz.";
  }

  return await handler(combinedMessage);
}


// ══════════════════════════════════════════════
// 2.5. TELEGRAM CALLBACK WEBHOOK (Polling'e yedek)
// Telegram webhook set edilirse callback_query'ler buraya gelir
// ══════════════════════════════════════════════
app.post('/webhook/telegram', (req, res) => {
  try {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch(e) { body = {}; }
    }
    
    log.info('[telegram-webhook] Update alındı', { 
      hasCallbackQuery: !!body.callback_query,
      updateId: body.update_id 
    });
    
    // Callback query (buton tıklaması) işle
    if (body.callback_query) {
      handleCallbackQuery(body.callback_query);
    }
    
    res.status(200).json({ ok: true });
  } catch (err) {
    log.error('[telegram-webhook] Hata', err);
    res.status(200).json({ ok: true }); // Telegram'a her zaman 200 dön
  }
});



// ══════════════════════════════════════════════
// 3. MANYCHAT DYNAMIC BLOCK WEBHOOK (Instagram + WhatsApp)
// ManyChat "External Request" adımı buraya POST atar
// Instagram: ?platform=instagram (varsayılan)
// WhatsApp:  ?platform=whatsapp
// AutoResponder ile bağlantı gerekirse: templates/autoresponder_template.js
// ══════════════════════════════════════════════
app.post('/webhook/manychat', async (req, res) => {
  try {
    const rawBody = typeof req.body === 'string' ? req.body : '';
    let parsedBody = {};
    try {
      parsedBody = JSON.parse(rawBody);
    } catch (e) {
      log.warn('[manychat] JSON parse hatasi', rawBody);
    }

    // Hem dogrudan body'yi hem de { data: Full Contact Data } paketini destekle
    const payload = parsedBody.data || parsedBody;
    const senderId = (payload.subscriber_id || payload.id || payload.wa_phone) ? String(payload.subscriber_id || payload.id || payload.wa_phone) : 'unknown_mc';
    // ManyChat WhatsApp: last_input_text, Instagram: last_input veya message
    const messageText = (payload.last_input_text || payload.message || payload.last_input || '').trim();
    const channelType = req.query.platform || 'instagram';

    if (!messageText) {
      log.warn('[manychat] Mesaj boş geldi, debug mesaji donuluyor', { senderId });
      return res.json({
        version: "v2",
        content: { type: channelType, messages: [{ type: "text", text: "HATA: ManyChat sunucuya mesaj metnini (last_input_text) bos gonderdi. Lutfen ManyChat ayarlarinda 'Full Contact Data' yerine 'Custom JSON' kullanin." }] },
        text: "HATA: ManyChat sunucuya mesaj metnini boş gönderdi. (Sistem hatası tespiti)"
      });
    }

    log.info('[manychat] Mesaj alındı', { senderId, len: messageText.length, cooldown: debounce.isInCooldown(senderId) });

    // İnsan devralma kontrolü
    if (isBotPaused(senderId)) {
      log.info(`[takeover] Bot duraklatılmış, ManyChat mesajı atlanıyor`, { senderId, platform: channelType });
      return res.json({
        version: "v2",
        content: { type: channelType, messages: [] }
      });
    }

    // Duplicate kontrolü
    if (await isDuplicate(senderId, messageText)) {
      return res.json({
        version: "v2",
        content: {
          type: channelType,
          messages: []
        }
      });
    }

    // Analytics & followup: müşteri mesaj attı
    completeFollowup(senderId).catch(() => {});
    const isNewMc = !(await hasUserBeenGreeted(senderId));
    trackEvent(senderId, 'message_received', channelType, { message_length: messageText.length, is_new_customer: isNewMc }).catch(() => {});

    // ═══ DEBOUNCE: Mesajı kuyruğa al ═══
    // ManyChat sıralı (sequential) çalıştığı için, enqueue her mesaj için 
    // yeni promise döner (concurrent mesaj gelmez). Ama cooldown sayesinde
    // ardışık mesajlar arasında bağlantı kurulur.
    const result = await debounce.enqueue(senderId, messageText);

    if (!result) {
      // Concurrent durumda: mesaj kuyruğa eklendi, ilk çağrı bekliyor
      return res.json({
        version: "v2",
        content: { type: channelType, messages: [] }
      });
    }

    // Debounce süresi doldu — birleştirilmiş mesajlarla AI cevabı üret
    const { combined: combinedMsg, messages: debouncedMsgs } = result;

    if (debouncedMsgs.length > 1) {
      log.info(`[manychat] ${debouncedMsgs.length} mesaj debounce ile birleştirildi`, { senderId });
    }

    if (/^s[ıi]f[ıi]rla$/i.test(combinedMsg.trim())) {
      await clearHistory(senderId);
      return res.json({
        version: "v2",
        content: { type: channelType, messages: [{ type: "text", text: "Hafıza başarıyla sıfırlandı. Teste baştan başlayabilirsiniz." }] },
        text: "Hafıza başarıyla sıfırlandı."
      });
    }

    // ═══ AI İŞLEME ═══
    const isFirstMessageEver = !(await hasUserBeenGreeted(senderId));
    
    await addMessage(senderId, 'user', combinedMsg);

    // ═══ KATALOG TALEBİ BYPASS (ManyChat) ═══
    if (isCatalogRequest(combinedMsg)) {
      log.info('[manychat] Katalog talebi tespit edildi, direkt katalog linki gönderiliyor', { senderId });
      trackEvent(senderId, 'catalog_request_bypass', channelType, { original_message: combinedMsg }).catch(() => {});
      enqueueFollowup(senderId, channelType).catch(() => {});
      if (isFirstMessageEver) {
        await markUserAsGreeted(senderId);
        await addMessage(senderId, 'assistant', GREETING_MESSAGE);
      }
      await addMessage(senderId, 'assistant', CATALOG_MESSAGE);
      const aiResponse = isFirstMessageEver ? [GREETING_MESSAGE, CATALOG_MESSAGE] : CATALOG_MESSAGE;
      const messages = Array.isArray(aiResponse) 
        ? aiResponse.map(msg => ({ type: "text", text: msg })) 
        : [{ type: "text", text: aiResponse }];
      return res.json({
        version: "v2",
        content: { type: channelType, messages },
        text: Array.isArray(aiResponse) ? aiResponse.join('\n\n') : aiResponse
      });
    }

    const currentState = await getState(senderId);
    currentState.platform = channelType;
    const [catalog, history] = await Promise.all([
      getCatalog(),
      getHistory(senderId)
    ]);
    const aiStartTime = Date.now();
    const respObj = await generateResponse(combinedMsg, history, catalog, currentState, senderId);
    const responseTimeMs = Date.now() - aiStartTime;
    const aiResponseText = processAiResponseWithTelegram(respObj.text, senderId, combinedMsg);
    if (respObj.stateUpdates) {
      await updateState(senderId, respObj.stateUpdates);
    }

    // Analytics tracking
    analyzeAndTrack(senderId, combinedMsg, respObj.text, channelType, {
      responseTimeMs,
      toolCalled: respObj.toolCallInfo?.toolCalled,
      queryUsed: respObj.toolCallInfo?.queryUsed,
      resultCount: respObj.toolCallInfo?.resultCount,
      productCodes: respObj.toolCallInfo?.productCodes
    }).catch(() => {});

    // Followup kuyruğuna ekle
    enqueueFollowup(senderId, channelType).catch(() => {});
    
    if (isFirstMessageEver) {
      await markUserAsGreeted(senderId);
      await addMessage(senderId, 'assistant', GREETING_MESSAGE);
    }
    
    await addMessage(senderId, 'assistant', aiResponseText);
    triggerAudit(senderId);
    const aiResponse = isFirstMessageEver ? [GREETING_MESSAGE, aiResponseText] : aiResponseText;

    log.info('[manychat] Cevap üretildi', { senderId, msgCount: debouncedMsgs.length, len: typeof aiResponse === 'string' ? aiResponse.length : aiResponse.length });

    // ManyChat Dynamic Block v2 formatında cevap dön
    const messages = Array.isArray(aiResponse) 
      ? aiResponse.map(msg => ({ type: "text", text: msg })) 
      : [{ type: "text", text: aiResponse }];

    // Response mapping için: tüm mesajları birleştirilmiş tek metin
    const allText = Array.isArray(aiResponse) 
      ? aiResponse.join('\n\n') 
      : aiResponse;

    return res.json({
      version: "v2",
      content: {
        type: channelType,
        messages: messages
      },
      text: allText
    });
  } catch (err) {
    log.error('[manychat] Hata', err);
    const channelType = req.query.platform || 'instagram';
    return res.json({
      version: "v2",
      content: {
        type: channelType,
        messages: [
          {
            type: "text",
            text: 'Teknik sorun yaşıyoruz, lütfen tekrar deneyin.'
          }
        ]
      }
    });
  }
});



// ══════════════════════════════════════════════
// 4. ADMIN ENDPOINTS
// ══════════════════════════════════════════════
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    business: config.businessName,
    timestamp: new Date().toISOString(),
    platforms: {
      instagram: !!config.metaPageAccessToken,
      messenger: !!config.metaPageAccessToken,
      whatsapp: true // ManyChat üzerinden aktif
    }
  });
});

app.get('/admin/catalog', async (req, res) => {
  try {
    const catalog = await getCatalog();
    res.json({ products: catalog, count: catalog.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/admin/catalog/refresh', (req, res) => {
  const { clearCache } = require('./services/catalog');
  clearCache();
  res.json({ status: 'Cache temizlendi, bir sonraki istekte güncel katalog çekilecek.' });
});

// ══════════════════════════════════════════════
// 5. ADMIN — İNSAN DEVRALMA (TAKEOVER) & CRM ENDPOINTLERİ
// ══════════════════════════════════════════════

// --- CRM API ---
const { createClient } = require('@supabase/supabase-js');
const crmSupabase = createClient(config.supabaseUrl, config.supabaseKey);

app.get('/api/crm/dashboard', async (req, res) => {
  try {
    const now = new Date();
    
    // Start of Day, Week, Month
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const startOfWeek = new Date(now.setDate(now.getDate() - now.getDay() + 1)).toISOString();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    // Fetch all orders to calculate revenue
    const { data: orders } = await crmSupabase.from('orders').select('amount, created_at');
    let totalRevenue = 0, dailyRev = 0, weeklyRev = 0, monthlyRev = 0;
    
    if (orders) {
      orders.forEach(o => {
        const amt = Number(o.amount) || 0;
        totalRevenue += amt;
        if (o.created_at >= startOfDay) dailyRev += amt;
        if (o.created_at >= startOfWeek) weeklyRev += amt;
        if (o.created_at >= startOfMonth) monthlyRev += amt;
      });
    }

    // Fetch message counts
    const { count: dailyMsgs } = await crmSupabase.from('conversations').select('*', { count: 'exact', head: true }).gte('timestamp', startOfDay);
    const { count: weeklyMsgs } = await crmSupabase.from('conversations').select('*', { count: 'exact', head: true }).gte('timestamp', startOfWeek);
    const { count: monthlyMsgs } = await crmSupabase.from('conversations').select('*', { count: 'exact', head: true }).gte('timestamp', startOfMonth);

    const { count: totalCustomers } = await crmSupabase.from('customer_profiles').select('*', { count: 'exact', head: true });
    const { count: hotCustomers } = await crmSupabase.from('customer_profiles').select('*', { count: 'exact', head: true }).eq('status', 'Sıcak Müşteri (Sordu Almadı)');
    const { count: pendingOrders } = await crmSupabase.from('customer_profiles').select('*', { count: 'exact', head: true }).eq('status', 'Sipariş Aşamasında');
    
    res.json({
      totalRevenue,
      totalCustomers: totalCustomers || 0,
      hotCustomers: hotCustomers || 0,
      pendingOrders: pendingOrders || 0,
      reports: {
        daily: { rev: dailyRev, msgs: dailyMsgs || 0 },
        weekly: { rev: weeklyRev, msgs: weeklyMsgs || 0 },
        monthly: { rev: monthlyRev, msgs: monthlyMsgs || 0 }
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Dashboard data error' });
  }
});

app.post('/api/crm/manual_customer', async (req, res) => {
  try {
    const { senderId, status, priority } = req.body;
    if (!senderId) return res.status(400).json({ error: 'Müşteri numarası gerekli' });
    
    // Profili oluştur veya güncelle
    await crmSupabase.from('customer_profiles').upsert({
      sender_id: senderId,
      status: status || 'Yeni Müşteri',
      priority: priority || 'Normal',
      tags: ['Manuel Kayıt']
    }, { onConflict: 'sender_id' });
    
    // Sistemde boş bir mesaj atalım ki activeChats listesinde görünsün
    await crmSupabase.from('conversations').insert({
      sender_id: senderId,
      content: 'Manuel müşteri kaydı açıldı.',
      role: 'system',
      timestamp: new Date().toISOString()
    });
    
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Veritabanı hatası' });
  }
});

app.get('/api/crm/chats', async (req, res) => {
  try {
    const { data, error } = await crmSupabase
      .from('conversations')
      .select('sender_id, content, timestamp, role')
      .order('timestamp', { ascending: false })
      .limit(1000);
      
    if (error) throw error;
    
    const chatsMap = new Map();
    for (const row of data) {
      if (!chatsMap.has(row.sender_id)) {
        chatsMap.set(row.sender_id, row);
      }
    }
    
    // Ayrıca aktif susturmaları (takeover) da dön
    const activeTakeovers = {};
    for (const [sId, entry] of humanTakeover.entries()) {
      if (Date.now() < entry.pauseUntil) {
        activeTakeovers[sId] = true;
      }
    }

    const chatsArray = Array.from(chatsMap.values());
    const senderIds = chatsArray.map(c => c.sender_id);
    
    let profilesMap = new Map();
    if (senderIds.length > 0) {
        const { data: profilesData, error: profilesError } = await crmSupabase
            .from('customer_profiles')
            .select('sender_id, tags, status, priority')
            .in('sender_id', senderIds);
            
        if (profilesData && !profilesError) {
            for (const p of profilesData) {
                profilesMap.set(p.sender_id, p);
            }
        }
    }
    
    for (const chat of chatsArray) {
        const p = profilesMap.get(chat.sender_id);
        chat.profile = p ? { tags: p.tags || [], status: p.status || 'Yeni Müşteri', priority: p.priority || 'Normal' } : { tags: [], status: 'Yeni Müşteri', priority: 'Normal' };
    }

    res.json({ chats: chatsArray, activeTakeovers });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/crm/messages/:senderId', async (req, res) => {
  try {
    const { data, error } = await crmSupabase
      .from('conversations')
      .select('role, content, timestamp')
      .eq('sender_id', req.params.senderId)
      .order('timestamp', { ascending: true })
      .limit(50);
      
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/crm/pause/:senderId', (req, res) => {
  const senderId = req.params.senderId;
  const isPaused = isBotPaused(senderId);
  
  if (isPaused) {
    resumeBot(senderId);
    res.json({ status: 'resumed' });
  } else {
    pauseBotForSender(senderId, 'CRM Paneli manuel devralma');
    res.json({ status: 'paused' });
  }
});

app.post('/api/crm/messages/:senderId', express.json(), async (req, res) => {
  const senderId = req.params.senderId;
  const { text } = req.body;
  
  if (!text || !text.trim()) {
      return res.status(400).json({ error: 'Mesaj boş olamaz.' });
  }

  try {
      // Platform tespiti yap
      const { data, error } = await crmSupabase
          .from('customer_events')
          .select('platform')
          .eq('sender_id', senderId)
          .order('created_at', { ascending: false })
          .limit(1);
          
      let platform = 'instagram'; // Fallback
      if (data && data.length > 0 && data[0].platform) {
          platform = data[0].platform;
      } else {
          // Alternatif: Followup kuyruğuna bak
          const { data: fData } = await crmSupabase
            .from('followup_queue')
            .select('platform')
            .eq('sender_id', senderId)
            .order('created_at', { ascending: false })
            .limit(1);
          if (fData && fData.length > 0 && fData[0].platform) {
              platform = fData[0].platform;
          }
      }

      if (platform === 'whatsapp') {
          return res.status(400).json({ error: 'WhatsApp için CRM\'den doğrudan mesaj gönderilemez. ManyChat panelinden veya telefondan yanıtlayabilirsiniz.' });
      }

      let success = false;
      if (platform === 'instagram') {
          success = await sendInstagramMessage(senderId, text);
      } else if (platform === 'messenger') {
          success = await sendMessengerMessage(senderId, text);
      } else {
          // Bilinmiyorsa önce insta, sonra messenger dene
          success = await sendInstagramMessage(senderId, text);
          if (!success) {
              success = await sendMessengerMessage(senderId, text);
          }
      }

      if (!success) {
          return res.status(500).json({ error: 'Mesaj Meta API üzerinden gönderilemedi. Müşterinin son mesajının üzerinden 24 saat geçmiş olabilir.' });
      }

      // Veritabanına kaydet ve botu sustur
      await addMessage(senderId, 'assistant', text);
      pauseBotForSender(senderId, 'CRM üzerinden manuel yanıt');
      
      res.json({ success: true, platform });
  } catch (err) {
      log.error('[crm] Send message error', err);
      res.status(500).json({ error: err.message });
  }
});

app.get('/api/crm/profile/:senderId', async (req, res) => {
  try {
    const { data, error } = await crmSupabase
      .from('customer_profiles')
      .select('*')
      .eq('sender_id', req.params.senderId)
      .single();
    
    // If not found, return default empty profile
    if (error && error.code === 'PGRST116') {
      return res.json({ sender_id: req.params.senderId, tags: [], notes: '', status: 'Yeni', priority: 'Normal' });
    }
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/crm/ai-analyze/:senderId', async (req, res) => {
  try {
    const senderId = req.params.senderId;
    const { getHistory } = require('./services/memory');
    const fetch = require('node-fetch');
    
    if (!config.geminiApiKey) {
        return res.status(500).json({ error: 'Gemini API anahtarı ayarlanmamış.' });
    }

    const history = await getHistory(senderId);
    if (!history || history.length === 0) {
        return res.json({ status: 'Yeni Müşteri', priority: 'Normal' });
    }

    // Son 20 mesaja göre analiz et
    const chatText = history.slice(-20).map(m => `${m.role === 'user' ? 'Müşteri' : 'Bot'}: ${m.content}`).join('\n');

    const prompt = `Aşağıdaki konuşma geçmişine bakarak müşterinin mevcut durumunu, önceliğini, yaşadığı şehri ve satış şeklini analiz et.

Konuşma Geçmişi:
${chatText}

Kurallar:
- status: "Yeni Müşteri", "Eski Müşteri", "Sıcak Müşteri (Sordu Almadı)", "Sipariş Aşamasında", "Kargo Bekliyor", "Tamamlandı"
- priority: "Düşük", "Normal", "Orta", "Yüksek"
- city: Müşteri konuşmada bir şehir ismi verdiyse (Örn: Elazığ, İstanbul) onu yaz. Eğer şehir bilgisi yoksa boş bırak ("").
- sales_type: "Toptan", "Perakende", "Fason", "Bilinmiyor"

Sadece saf JSON formatında cevap dön. Markdown kullanma:
{"status": "...", "priority": "...", "city": "...", "sales_type": "..."}`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${config.geminiApiKey}`;
    
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.1 }
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error('Gemini API Error: ' + errorText);
    }

    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        res.json(parsed);
    } else {
        throw new Error('AI geçerli bir JSON dönmedi: ' + text);
    }
  } catch (err) {
    log.error('[crm] AI Analysis Hatası:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/crm/profile/:senderId', async (req, res) => {
  try {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch(e) { body = {}; }
    }
    const tags = Array.isArray(body.tags) ? body.tags : [];
    const notes = body.notes || '';
    const status = body.status || 'Yeni';
    const priority = body.priority || 'Normal';

    const { data, error } = await crmSupabase
      .from('customer_profiles')
      .upsert({
        sender_id: req.params.senderId,
        tags,
        notes,
        status,
        priority,
        updated_at: new Date().toISOString()
      }, { onConflict: 'sender_id' });

    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// Bot'u belirli bir müşteri için durdur (WhatsApp veya herhangi bir platform)
app.post('/admin/takeover', (req, res) => {
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch(e) { body = {}; }
  }
  const senderId = body.sender_id || req.query.sender_id;
  const action = body.action || req.query.action || 'pause'; // 'pause' veya 'resume'
  const durationMin = parseInt(body.duration || req.query.duration || '15', 10);

  if (!senderId) {
    return res.status(400).json({ error: 'sender_id gerekli' });
  }

  if (action === 'resume') {
    resumeBot(senderId);
    return res.json({ status: 'ok', message: `Bot ${senderId} için devam ettirildi.` });
  }

  // Pause
  const pauseUntil = Date.now() + durationMin * 60 * 1000;
  humanTakeover.set(senderId, { pauseUntil, reason: 'manual' });
  log.info(`[takeover] Bot manuel olarak ${durationMin} dk duraklatıldı`, { senderId });
  return res.json({ status: 'ok', message: `Bot ${senderId} için ${durationMin} dk duraklatıldı.` });
});

// Aktif takeover'ları listele
app.get('/admin/takeover', (req, res) => {
  const active = [];
  const now = Date.now();
  for (const [senderId, entry] of humanTakeover.entries()) {
    if (now < entry.pauseUntil) {
      active.push({
        senderId,
        reason: entry.reason,
        remainingMin: Math.round((entry.pauseUntil - now) / 60000),
        pauseUntil: new Date(entry.pauseUntil).toISOString()
      });
    }
  }
  res.json({ activeTakeovers: active, count: active.length });
});

// ══════════════════════════════════════════════
// 6. ADMIN — TEST RAPOR ENDPOINTİ
// ══════════════════════════════════════════════
app.get('/admin/report/test', async (req, res) => {
  try {
    log.info('[admin] Test raporu tetiklendi');
    const { getTurkeyDateStr } = require('./services/daily_report');
    const dateStr = req.query.date || getTurkeyDateStr();
    const reportText = await generateDailyReport(dateStr);
    await sendTelegramReport(reportText);
    res.json({ status: 'ok', message: 'Test raporu Telegram\'a gönderildi', date: dateStr });
  } catch (err) {
    log.error('[admin] Test raporu hatası', err);
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════
// 6. SUNUCUYU BAŞLAT + CRON JOB'LARI KAYDET
// ══════════════════════════════════════════════
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

app.listen(config.port, '0.0.0.0', async () => {
  log.info(`[server] ${config.businessName} Müşteri Hizmetleri AI başlatıldı`, {
    port: config.port,
    gemini: config.geminiApiKey ? '✅' : '❌',
    meta: config.metaPageAccessToken ? '✅' : '❌',
    sheets: config.googleSheetsId ? '✅' : '❌'
  });

  // ── Telegram: Webhook set et, başarısız olursa polling'e düş ──
  try {
    const railwayUrl = process.env.RAILWAY_PUBLIC_DOMAIN 
      ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
      : (process.env.RAILWAY_STATIC_URL 
        ? `https://${process.env.RAILWAY_STATIC_URL}` 
        : (process.env.PORT ? 'https://musteri-hizmetleri-ai-production-f980.up.railway.app' : null));
    
    if (railwayUrl) {
      const webhookUrl = `${railwayUrl}/webhook/telegram`;
      const { TELEGRAM_BOT_TOKEN } = require('./utils/telegram');
      const setUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook`;
      
      const resp = await fetch(setUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          url: webhookUrl,
          allowed_updates: ['callback_query'] // Sadece buton tıklamalarını al
        })
      });
      const result = await resp.json();
      
      if (result.ok) {
        log.info(`[telegram] ✅ Webhook başarıyla set edildi: ${webhookUrl}`);
        // Webhook aktifken polling kullanma (Telegram kuralı: ikisi aynı anda çalışmaz)
      } else {
        log.warn(`[telegram] ❌ Webhook set edilemedi, polling'e geçiliyor`, result);
        if (startPolling) startPolling();
      }
    } else {
      log.info(`[telegram] Railway URL bulunamadı, polling kullanılıyor`);
      if (startPolling) startPolling();
    }
  } catch (err) {
    log.error(`[telegram] Webhook kurulumu hatası, polling'e geçiliyor`, err.message);
    if (startPolling) startPolling();
  }

  // ── Cron Job: Günlük Rapor (her gün saat 21:00 Türkiye saati = 18:00 UTC) ──
  if (config.dailyReportEnabled) {
    const utcHour = (config.dailyReportHour - 3 + 24) % 24; // Türkiye → UTC dönüşümü
    const cronExpr = `0 ${utcHour} * * *`;
    cron.schedule(cronExpr, () => {
      log.info('[cron] Günlük rapor tetiklendi');
      sendDailyReport().catch(err => log.error('[cron] Rapor hatası', err));
    });
    log.info(`[cron] Günlük rapor zamanlandı: her gün saat ${config.dailyReportHour}:00 (TR) / ${utcHour}:00 (UTC)`);
  }

  // ── Cron Job: Hatırlatma Kontrolü (her 10 dakikada bir) ──
  if (config.followupReminder1hEnabled || config.followupReminder24hEnabled) {
    const intervalMin = config.followupCheckIntervalMin || 10;
    cron.schedule(`*/${intervalMin} * * * *`, () => {
      processReminders().catch(err => log.error('[cron] Hatırlatma hatası', err));
    });
    log.info(`[cron] Hatırlatma kontrolü zamanlandı: her ${intervalMin} dakikada bir`);
  }
});
