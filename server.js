// server.js — Müşteri Hizmetleri AI Ana Sunucu
// Instagram DM + Facebook Messenger + WhatsApp (AutoResponder)
const express = require('express');
const crypto = require('crypto');
const { config } = require('./config/env');
const log = require('./utils/logger');
const { generateResponse } = require('./services/gemini');
const { sendInstagramMessage, sendMessengerMessage } = require('./services/meta_api');
const { getCatalog } = require('./services/catalog');
const { addMessage, getHistory, isDuplicate } = require('./services/memory');

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

const path = require('path');
// Statik dosyaları dışa aç (Katalog PDF'leri ve arayüzü)
app.use(express.static(path.join(__dirname, 'public')));
app.get('/katalog', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

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

// Per-sender processing lock (burst coalesce)
const processingLock = new Map();
const COALESCE_INITIAL_MS = 2000;
const COALESCE_STRAGGLER_MS = 1000;
const COALESCE_MAX_ITER = 3;

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
        // Sadece text mesajları işle (echo'ları atla)
        if (!event.message || !event.message.text || event.message.is_echo) continue;

        const senderId = event.sender.id;
        const messageText = event.message.text.trim();

        if (!senderId || !messageText) continue;

        log.info(`[webhook] ${platform} mesaj alındı`, { senderId, len: messageText.length });

        // Duplicate kontrolü
        if (isDuplicate(senderId, messageText)) {
          log.info(`[webhook] Duplicate mesaj atlandı`, { senderId });
          continue;
        }

        // Burst coalesce — aynı kişi art arda mesaj atarsa birleştir
        const existingLock = processingLock.get(senderId);
        if (existingLock) {
          existingLock.queue.push(messageText);
          log.info(`[webhook] Burst kuyruğa eklendi`, { senderId, queueLen: existingLock.queue.length });
          continue;
        }

        // Yeni mesaj işleme başlat
        processMessage(senderId, messageText, platform).catch(err => {
          log.error(`[webhook] İşleme hatası`, err);
        });
      }
    }
  } catch (err) {
    log.error('[webhook] Genel hata', err);
  }
});

/**
 * Mesajı işle: burst coalesce → AI cevap üret → gönder
 */
async function processMessage(senderId, initialMessage, platform) {
  const lockEntry = { queue: [] };
  processingLock.set(senderId, lockEntry);

  try {
    let pending = [initialMessage];

    for (let iter = 0; iter < COALESCE_MAX_ITER; iter++) {
      await sleep(iter === 0 ? COALESCE_INITIAL_MS : COALESCE_STRAGGLER_MS);

      if (lockEntry.queue.length > 0) {
        pending = pending.concat(lockEntry.queue.splice(0));
        continue;
      }

      // Mesajları birleştir
      const combinedMessage = pending.length === 1 ? pending[0] : pending.join('\n');
      if (pending.length > 1) {
        log.info(`[process] ${pending.length} mesaj birleştirildi`, { senderId });
      }

      // Kullanıcı mesajını kaydet
      addMessage(senderId, 'user', combinedMessage);

      // Katalog ve geçmişi al
      const [catalog, history] = await Promise.all([
        getCatalog(),
        Promise.resolve(getHistory(senderId))
      ]);

      // AI cevap üret
      const aiResponse = await generateResponse(combinedMessage, history, catalog);

      // AI cevabını kaydet
      addMessage(senderId, 'assistant', aiResponse);

      // Platforma göre gönder
      if (platform === 'instagram') {
        await sendInstagramMessage(senderId, aiResponse);
      } else {
        await sendMessengerMessage(senderId, aiResponse);
      }

      // Straggler kontrolü
      if (lockEntry.queue.length === 0) break;
      pending = lockEntry.queue.splice(0);
    }

    log.info(`[process] İşlem tamamlandı`, { senderId, platform });
  } finally {
    processingLock.delete(senderId);
  }
}

// ══════════════════════════════════════════════
// 3. WHATSAPP AUTORESPONDER WEBHOOK
// Android AutoResponder uygulaması buraya POST atar
let lastWaPayload = {};
app.get('/debug-wa', (req, res) => res.json(lastWaPayload));

app.post('/webhook/whatsapp', async (req, res) => {
  try {
    const rawBody = typeof req.body === 'string' ? req.body : '';
    lastWaPayload = { headers: req.headers, rawBody, query: req.query };
    
    let payload = {};
    try {
      payload = JSON.parse(rawBody);
    } catch (e) {
      log.warn('[whatsapp] JSON parse hatasi', rawBody);
    }
    
    log.info('[whatsapp] Gelen raw payload', payload);
    
    // AutoResponder bazen 'query' bazen 'message' olarak gönderir
    const message = payload.message || payload.query || rawBody;
    const senderId = payload.phone || payload.sender || 'unknown_wa';
    const messageText = (message || '').trim();

    if (!messageText) {
      log.warn('[whatsapp] Mesaj bos geldi', rawBody);
      // AutoResponder'in hata vermesini engellemek icin 200 donuyoruz
      return res.json({ reply: 'Sistem baglantisi basarili! Bot hazir.' });
    }

    // Güvenlik kontrolü (opsiyonel)
    if (config.whatsappWebhookSecret) {
      const provided = req.headers['x-webhook-secret'];
      if (provided !== config.whatsappWebhookSecret) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
    }

    log.info('[whatsapp] Mesaj alındı', { senderId, len: messageText.length });

    // Duplicate kontrolü
    if (isDuplicate(senderId, messageText)) {
      return res.json({ reply: '' });
    }

    // Mesajı kaydet
    addMessage(senderId, 'user', messageText);

    // Katalog ve geçmişi al
    const [catalog, history] = await Promise.all([
      getCatalog(),
      Promise.resolve(getHistory(senderId))
    ]);

    // AI cevap üret
    const aiResponse = await generateResponse(messageText, history, catalog);

    // Cevabı kaydet
    addMessage(senderId, 'assistant', aiResponse);

    log.info('[whatsapp] Cevap üretildi', { senderId, len: aiResponse.length });

    // AutoResponder cevabı body'den okur
    return res.json({ reply: aiResponse });
  } catch (err) {
    log.error('[whatsapp] Hata', err);
    return res.status(500).json({ reply: 'Teknik sorun yaşıyoruz, lütfen tekrar deneyin.' });
  }
});

// ══════════════════════════════════════════════
// 3.5. MANYCHAT DYNAMIC BLOCK WEBHOOK
// ManyChat "External Request" adımı buraya POST atar
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
    const senderId = (payload.subscriber_id || payload.id) ? String(payload.subscriber_id || payload.id) : 'unknown_mc';
    const messageText = (payload.message || payload.last_input || payload.last_input_text || '').trim();
    const channelType = req.query.platform || 'instagram';

    if (!messageText) {
      return res.status(400).json({ error: 'Mesaj boş' });
    }

    log.info('[manychat] Mesaj alındı', { senderId, len: messageText.length });

    // Duplicate kontrolü
    if (isDuplicate(senderId, messageText)) {
      return res.json({
        version: "v2",
        content: {
          type: channelType,
          messages: [] // Boş içerik dönerek duplicate cevabı engelle
        }
      });
    }

    // Mesajı kaydet
    addMessage(senderId, 'user', messageText);

    // Katalog ve geçmişi al
    const [catalog, history] = await Promise.all([
      getCatalog(),
      Promise.resolve(getHistory(senderId))
    ]);

    // AI cevap üret
    const aiResponse = await generateResponse(messageText, history, catalog);

    // Cevabı kaydet
    addMessage(senderId, 'assistant', aiResponse);

    log.info('[manychat] Cevap üretildi', { senderId, len: aiResponse.length });

    // ManyChat Dynamic Block v2 formatında cevap dön
    return res.json({
      version: "v2",
      content: {
        type: channelType,
        messages: [
          {
            type: "text",
            text: aiResponse
          }
        ]
      }
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
// 3.8. AUTORESPONDER YENİ YAPI (DÜZ METİN)
// ══════════════════════════════════════════════
app.all(['/autoresponder', '/webhook/whatsapp/autoresponder'], async (req, res) => {
  try {
    let parsedBody = {};
    if (typeof req.body === 'string' && req.body.trim()) {
      try {
        parsedBody = JSON.parse(req.body);
      } catch (e) {
        // Parse error ignore - Might be x-www-form-urlencoded
        try {
          const params = new URLSearchParams(req.body);
          for (const [key, value] of params.entries()) {
            parsedBody[key] = value;
          }
        } catch (err) {}
      }
    } else if (typeof req.body === 'object') {
      parsedBody = req.body;
    }

    const arQuery = parsedBody.query || {};

    const messageText = (
      req.query.message || req.query.text || req.query.msg ||
      parsedBody.message || parsedBody.text || parsedBody.msg ||
      arQuery.message || arQuery.text || arQuery.msg || ''
    ).trim();

    let senderId = String(
      req.query.sender || req.query.phone || req.query.number ||
      parsedBody.sender || parsedBody.phone || parsedBody.number ||
      arQuery.sender || arQuery.phone || arQuery.number || 'unknown'
    ).trim();

    // Clean [test] from sender
    senderId = senderId.replace(/\[test\]/g, '');

    res.set('Content-Type', 'text/plain; charset=utf-8');

    if (!messageText) {
      log.warn('[autoresponder] Mesaj boş geldi. Payload incelemesi:', { 
        rawBody: typeof req.body === 'string' ? req.body : JSON.stringify(req.body),
        query: req.query,
        parsedBody
      });
      return res.status(400).send('Message is required');
    }

    log.info('[autoresponder] Mesaj alındı', { senderId, len: messageText.length });

    if (isDuplicate(senderId, messageText)) {
      return res.send(''); 
    }

    addMessage(senderId, 'user', messageText);

    const [catalog, history] = await Promise.all([
      getCatalog(),
      Promise.resolve(getHistory(senderId))
    ]);

    const aiResponse = await generateResponse(messageText, history, catalog);

    addMessage(senderId, 'assistant', aiResponse);

    log.info('[autoresponder] Cevap üretildi', { senderId, len: aiResponse.length });

    // AutoResponder expects a JSON response with a "replies" array
    res.set('Content-Type', 'application/json; charset=utf-8');
    return res.json({ replies: [{ message: aiResponse }] });
  } catch (err) {
    log.error('[autoresponder] Hata', err);
    res.set('Content-Type', 'application/json; charset=utf-8');
    return res.status(500).json({ replies: [{ message: 'Teknik sorun yaşıyoruz, lütfen tekrar deneyin.' }] });
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
      whatsapp: true // AutoResponder her zaman aktif
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
// 5. SUNUCUYU BAŞLAT
// ══════════════════════════════════════════════
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

app.listen(config.port, '0.0.0.0', () => {
  log.info(`[server] ${config.businessName} Müşteri Hizmetleri AI başlatıldı`, {
    port: config.port,
    gemini: config.geminiApiKey ? '✅' : '❌',
    meta: config.metaPageAccessToken ? '✅' : '❌',
    sheets: config.googleSheetsId ? '✅' : '❌'
  });
});
