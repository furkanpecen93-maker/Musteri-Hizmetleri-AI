const fetch = require('node-fetch');
const { config } = require('../config/env');
const log = require('../utils/logger');
const { updateState } = require('./memory');

/**
 * Konuşma geçmişini analiz edip hataları/eksikleri bulur.
 */
async function auditConversation(senderId, history) {
  if (!config.geminiApiKey) return;

  log.info('[auditor] Müşteri sohbeti teftiş ediliyor', { senderId, msgCount: history.length });
  
  const systemPrompt = `Sen bir müşteri sohbetini değerlendiren yapay zeka asistanısın. Henüz yeni kuralların yüklenmediği için her şeye "hata yok" şeklinde yanıt vermelisin.

Bana SADECE JSON formatında cevap ver:
{
  "hata_var_mi": false,
  "elestiri_ve_tavsiye": ""
}`;

  const transcript = history.map(m => `${m.role === 'user' ? 'Müşteri' : 'Bot'}: ${m.content}`).join('\n');

  const payload = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: 'user', parts: [{ text: transcript }] }],
    generationConfig: { 
      temperature: 0.2, 
      responseMimeType: "application/json" 
    }
  };

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.geminiModel}:generateContent?key=${config.geminiApiKey}`;
    const response = await fetch(url, { 
      method: 'POST', 
      headers: { 'Content-Type': 'application/json' }, 
      body: JSON.stringify(payload) 
    });
    
    if (!response.ok) return;

    const data = await response.json();
    const aiText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (aiText) {
      const parsed = JSON.parse(aiText);
      if (parsed.hata_var_mi && parsed.elestiri_ve_tavsiye) {
        log.warn(`[auditor] HATA TESPİT EDİLDİ (Müşteri: ${senderId})`, { tavsiye: parsed.elestiri_ve_tavsiye });
        // Bir sonraki sohbette bota gizlice fısıldamak üzere state'e yazıyoruz
        updateState(senderId, { auditFeedback: parsed.elestiri_ve_tavsiye });
      } else {
        // Hata yoksa veya düzeldiyse eski uyarıyı temizle
        updateState(senderId, { auditFeedback: null });
        log.info(`[auditor] Teftiş temiz (Müşteri: ${senderId})`);
      }
    }
  } catch (err) {
    log.error('[auditor] Teftiş sırasında hata', err);
  }
}

module.exports = { auditConversation };
