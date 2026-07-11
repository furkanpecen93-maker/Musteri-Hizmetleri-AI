// ═══════════════════════════════════════════════════════════════════════
// AUTORESPONDER WHATSAPP ŞABLONU
// ═══════════════════════════════════════════════════════════════════════
//
// Bu dosya, WhatsApp'ı Android "AutoResponder" uygulaması üzerinden 
// bağlamak isteyen müşteriler için şablon kodlarını içerir.
//
// KULLANIM:
//   Yeni müşteri AutoResponder tercih ederse, aşağıdaki endpoint'leri
//   server.js'e ekleyin. processSyncWebhook, isBotPaused, isDuplicate,
//   completeFollowup, trackEvent, hasUserBeenGreeted, addMessage,
//   isCatalogRequest, getState, getCatalog, getHistory, generateResponse,
//   processAiResponseWithTelegram, updateState, analyzeAndTrack,
//   enqueueFollowup, markUserAsGreeted, triggerAudit fonksiyonları
//   zaten server.js'de mevcut olacaktır.
//
// GEREKLİ ENV DEĞİŞKENLERİ:
//   WHATSAPP_WEBHOOK_SECRET (opsiyonel güvenlik şifresi)
//
// TARİH: 2026-07-11 — Orijinal Peçen Toptan kurulumundan arşivlendi
// ═══════════════════════════════════════════════════════════════════════

// ──────────────────────────────────────────────
// ENDPOINT 1: /webhook/whatsapp
// AutoResponder V1 — JSON body ile mesaj alır, JSON ile cevap döner
// ──────────────────────────────────────────────
/*
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

    // Grup mesajlarını engelle (isGroup bayrağı veya ID'de '@g.us' / '-' kontrolü)
    const isGroup = payload.isGroup || String(senderId).includes('@g.us') || String(senderId).includes('-');
    if (isGroup) {
      log.info('[whatsapp] Grup mesajı atlanıyor', { senderId });
      return res.json({ reply: '', replies: [] });
    }

    if (!messageText) {
      log.warn('[whatsapp] Mesaj bos geldi', rawBody);
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

    // İnsan devralma kontrolü
    if (isBotPaused(senderId)) {
      log.info(`[takeover] ✅ Bot duraklatılmış, WhatsApp mesajı ATLANIYOR`, { senderId, messagePreview: messageText.substring(0, 50) });
      return res.json({ reply: '', replies: [] });
    } else {
      if (humanTakeover.size > 0) {
        const activeKeys = [...humanTakeover.keys()];
        log.info(`[takeover] Bot aktif, mevcut pause kayıtları:`, { senderId, activeKeys });
      }
    }

    // Duplicate kontrolü
    if (await isDuplicate(senderId, messageText)) {
      return res.json({ reply: '', replies: [] });
    }

    // Analytics & followup: müşteri mesaj attı
    completeFollowup(senderId).catch(() => {});
    const isNewCust = !(await hasUserBeenGreeted(senderId));
    trackEvent(senderId, 'message_received', 'whatsapp', { message_length: messageText.length, is_new_customer: isNewCust }).catch(() => {});

    const aiResponse = await processSyncWebhook(senderId, messageText, async (combinedMsg) => {
      const isFirstMessageEver = !(await hasUserBeenGreeted(senderId));
      
      await addMessage(senderId, 'user', combinedMsg);

      // KATALOG TALEBİ BYPASS (WhatsApp)
      if (isCatalogRequest(combinedMsg)) {
        log.info('[whatsapp] Katalog talebi tespit edildi', { senderId });
        trackEvent(senderId, 'catalog_request_bypass', 'whatsapp', { original_message: combinedMsg }).catch(() => {});
        enqueueFollowup(senderId, 'whatsapp').catch(() => {});
        if (isFirstMessageEver) {
          await markUserAsGreeted(senderId);
          await addMessage(senderId, 'assistant', GREETING_MESSAGE);
        }
        await addMessage(senderId, 'assistant', CATALOG_MESSAGE);
        return isFirstMessageEver ? [GREETING_MESSAGE, CATALOG_MESSAGE] : CATALOG_MESSAGE;
      }

      const currentState = await getState(senderId);
      currentState.platform = 'whatsapp';
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

      analyzeAndTrack(senderId, combinedMsg, respObj.text, 'whatsapp', {
        responseTimeMs,
        toolCalled: respObj.toolCallInfo?.toolCalled,
        queryUsed: respObj.toolCallInfo?.queryUsed,
        resultCount: respObj.toolCallInfo?.resultCount,
        productCodes: respObj.toolCallInfo?.productCodes
      }).catch(() => {});

      enqueueFollowup(senderId, 'whatsapp').catch(() => {});

      if (isFirstMessageEver) {
        await markUserAsGreeted(senderId);
        await addMessage(senderId, 'assistant', GREETING_MESSAGE);
      }

      await addMessage(senderId, 'assistant', aiResponseText);
      triggerAudit(senderId);
      return isFirstMessageEver ? [GREETING_MESSAGE, aiResponseText] : aiResponseText;
    });

    if (aiResponse === null) {
      return res.json({ reply: '', replies: [] });
    }

    log.info('[whatsapp] Cevap üretildi', { senderId, len: aiResponse.length });

    // AutoResponder V1 ve V2 formatlarını aynı anda destekle
    return res.json({
      reply: aiResponse,
      replies: [{ message: aiResponse }]
    });
  } catch (err) {
    log.error('[whatsapp] Hata', err);
    return res.status(500).json({ reply: 'Teknik sorun yaşıyoruz, lütfen tekrar deneyin.' });
  }
});
*/

// ──────────────────────────────────────────────
// ENDPOINT 2: /autoresponder  (ve /webhook/whatsapp/autoresponder)
// AutoResponder V2 — Düz metin ve JSON hybrid
// ──────────────────────────────────────────────
/*
let lastWaPayload = {};
app.get('/debug-wa', (req, res) => {
  const activePauses = {};
  const now = Date.now();
  for (const [sId, entry] of humanTakeover.entries()) {
    if (now < entry.pauseUntil) {
      activePauses[sId] = { reason: entry.reason, remainingMin: Math.round((entry.pauseUntil - now) / 60000) };
    }
  }
  res.json({ lastPayload: lastWaPayload, activePauses });
});

app.all(['/autoresponder', '/webhook/whatsapp/autoresponder'], async (req, res) => {
  try {
    let parsedBody = {};
    if (typeof req.body === 'string' && req.body.trim()) {
      try {
        parsedBody = JSON.parse(req.body);
      } catch (e) {
        try {
          const params = new URLSearchParams(req.body);
          for (const [key, value] of params.entries()) {
            parsedBody[key] = value;
          }
        } catch (err) { }
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

    // Grup filtresi
    const isGroupAr = parsedBody.isGroup || arQuery.isGroup
      || String(senderId).includes('@g.us')
      || String(senderId).includes('group')
      || (String(senderId).match(/-/) && String(senderId).length > 15);
    if (isGroupAr) {
      log.info('[autoresponder] Grup mesajı atlanıyor', { senderId });
      res.set('Content-Type', 'application/json; charset=utf-8');
      return res.json({ reply: '', replies: [] });
    }

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

    if (await isDuplicate(senderId, messageText)) {
      return res.send('');
    }

    // Analytics & followup
    completeFollowup(senderId).catch(() => {});
    const isNewAr = !(await hasUserBeenGreeted(senderId));
    trackEvent(senderId, 'message_received', 'whatsapp', { message_length: messageText.length, is_new_customer: isNewAr }).catch(() => {});

    const aiResponse = await processSyncWebhook(senderId, messageText, async (combinedMsg) => {
      const currentState = await getState(senderId);
      currentState.platform = 'whatsapp';
      const isFirstMessageEver = !(await hasUserBeenGreeted(senderId));
      
      await addMessage(senderId, 'user', combinedMsg);

      // KATALOG TALEBİ BYPASS (AutoResponder)
      if (isCatalogRequest(combinedMsg)) {
        log.info('[autoresponder] Katalog talebi tespit edildi', { senderId });
        trackEvent(senderId, 'catalog_request_bypass', 'whatsapp', { original_message: combinedMsg }).catch(() => {});
        enqueueFollowup(senderId, 'whatsapp').catch(() => {});
        if (isFirstMessageEver) {
          await markUserAsGreeted(senderId);
          await addMessage(senderId, 'assistant', GREETING_MESSAGE);
        }
        await addMessage(senderId, 'assistant', CATALOG_MESSAGE);
        return isFirstMessageEver ? [GREETING_MESSAGE, CATALOG_MESSAGE] : CATALOG_MESSAGE;
      }

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

      analyzeAndTrack(senderId, combinedMsg, respObj.text, 'whatsapp', {
        responseTimeMs,
        toolCalled: respObj.toolCallInfo?.toolCalled,
        queryUsed: respObj.toolCallInfo?.queryUsed,
        resultCount: respObj.toolCallInfo?.resultCount,
        productCodes: respObj.toolCallInfo?.productCodes
      }).catch(() => {});

      enqueueFollowup(senderId, 'whatsapp').catch(() => {});
      
      if (isFirstMessageEver) {
        await markUserAsGreeted(senderId);
        await addMessage(senderId, 'assistant', GREETING_MESSAGE);
      }
      
      await addMessage(senderId, 'assistant', aiResponseText);
      triggerAudit(senderId);
      
      return isFirstMessageEver ? [GREETING_MESSAGE, aiResponseText] : aiResponseText;
    });

    if (aiResponse === null) {
      res.set('Content-Type', 'application/json; charset=utf-8');
      return res.json({ replies: [] });
    }

    log.info('[autoresponder] Cevap üretildi', { senderId, len: aiResponse.length });

    const replies = Array.isArray(aiResponse) ? aiResponse.map(msg => ({ message: msg })) : [{ message: aiResponse }];
    res.set('Content-Type', 'application/json; charset=utf-8');
    return res.json({ 
      reply: Array.isArray(aiResponse) ? aiResponse[0] : aiResponse,
      replies: replies 
    });
  } catch (err) {
    log.error('[autoresponder] Hata', err);
    res.set('Content-Type', 'application/json; charset=utf-8');
    return res.status(500).json({ 
      reply: 'Teknik sorun yaşıyoruz, lütfen tekrar deneyin.',
      replies: [{ message: 'Teknik sorun yaşıyoruz, lütfen tekrar deneyin.' }] 
    });
  }
});
*/

// ──────────────────────────────────────────────
// ENTEGRASYON NOTU:
// ──────────────────────────────────────────────
// 
// AutoResponder kullanmak isteyen yeni müşteri için:
// 1. Bu dosyadaki comment'leri kaldırıp server.js'e ekleyin
// 2. .env'ye WHATSAPP_WEBHOOK_SECRET ekleyin (opsiyonel)
// 3. AutoResponder uygulamasını yapılandırın:
//    - URL: https://<domain>/autoresponder?sender=%number%&message=%message%
//    - Method: POST (veya GET)
//    - Response format: JSON
// 
// Detaylı kurulum rehberi: AutoResponder uygulama ayarlarından
// "Custom Reply" > "Web Server" seçeneği ile yapılandırılır.
// ──────────────────────────────────────────────
