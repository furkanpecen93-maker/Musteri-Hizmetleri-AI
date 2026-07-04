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
  
  const systemPrompt = `Sen acımasız ve son derece zeki bir Satış Müdürü / Müfettişisin (Audit Agent). Görevin, müşteri temsilcisi (bot) ile müşteri arasındaki konuşmayı okumak ve botun performansını değerlendirmektir.
Özellikle şu noktalara dikkat et:
1. Müşteri fiyat sorduğunda bot hemen rakam verip kestirip attı mı? Yoksa randevu/görüntülü arama satmaya çalıştı mı?
2. Müşteri kaba saba konuştuğunda bot saçmaladı mı?
3. Bot aynı soruyu tekrar tekrar sordu mu?

Bana SADECE JSON formatında cevap ver:
{
  "hata_var_mi": true/false,
  "elestiri_ve_tavsiye": "Bot şu noktada hata yaptı, müşteri kaçmak üzere. Bir dahaki mesaja acilen şu şekilde girmeli: '...' " // Sadece hata varsa kısa ve öz bir taktik ver. Yoksa boş bırak.
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
