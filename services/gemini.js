// services/gemini.js — Gemini AI ile müşteri cevabı üretme
const fetch = require('node-fetch');
const { config } = require('../config/env');
const log = require('../utils/logger');

/**
 * Gemini AI'a mesaj gönder ve cevap al
 * @param {string} userMessage - Müşterinin mesajı
 * @param {Array} conversationHistory - Önceki mesajlar [{role, content}]
 * @param {Object} catalogData - Ürün kataloğu verisi
 * @returns {string} AI cevabı
 */
async function generateResponse(userMessage, conversationHistory = [], catalogData = null) {
  if (!config.geminiApiKey) {
    log.error('[gemini] GEMINI_API_KEY tanımlı değil!');
    return 'Şu an teknik bir sorun yaşıyoruz. Lütfen biraz sonra tekrar deneyin.';
  }

  const systemPrompt = buildSystemPrompt(catalogData);
  
  // Gemini API formatına çevir
  const contents = [];
  
  // Conversation history
  for (const msg of conversationHistory.slice(-10)) { // Son 10 mesaj
    contents.push({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }]
    });
  }
  
  // Yeni mesaj
  contents.push({
    role: 'user',
    parts: [{ text: userMessage }]
  });

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.geminiModel}:generateContent?key=${config.geminiApiKey}`;
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: {
          parts: [{ text: systemPrompt }]
        },
        contents,
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 1024,
          topP: 0.9
        },
        safetySettings: [
          { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }
        ]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      log.error(`[gemini] API hatası: ${response.status}`, errText);
      return 'Üzgünüm, şu an cevap oluşturamıyorum. Lütfen biraz sonra tekrar deneyin.';
    }

    const data = await response.json();
    const aiText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (!aiText) {
      log.warn('[gemini] Boş cevap döndü', data);
      return 'Mesajınızı aldım, size en kısa sürede dönüş yapacağız.';
    }

    log.info('[gemini] Cevap üretildi', { len: aiText.length });
    return aiText.trim();
  } catch (err) {
    log.error('[gemini] İstek hatası', err);
    return 'Teknik bir sorun yaşıyoruz. Lütfen biraz sonra tekrar mesaj atın.';
  }
}

/**
 * Satıcı kişiliği + katalog bilgisi ile system prompt oluştur
 */
function buildSystemPrompt(catalogData) {
  let catalogSection = '';
  
  if (catalogData && catalogData.length > 0) {
    catalogSection = '\n\n## ÜRÜN KATALOĞU\n\n';
    for (const product of catalogData) {
      catalogSection += `- **${product.ad}**: ${product.aciklama || ''} | Fiyat: ${product.fiyat || 'Sorunuz'} | Stok: ${product.stok || 'Mevcut'}\n`;
    }
  }

  return `Sen ${config.businessName} işletmesinin profesyonel yapay zeka satış asistanısın.

## ROLÜN
- Müşterilere samimi, profesyonel ve yardımsever bir şekilde cevap ver
- Ürünleri tanıt, fiyat bilgisi ver, sipariş al
- Sipariş tutarını hesapla ve IBAN bilgisini paylaş
- Karmaşık taleplerde "Ekibimiz size en kısa sürede dönecek" de

## KURALLARIN
1. Her zaman Türkçe cevap ver (müşteri başka dilde yazarsa bile)
2. Kısa ve öz cevaplar ver — WhatsApp/Instagram mesajı formatında
3. Emoji kullan ama aşırıya kaçma (mesaj başına 1-2 emoji yeterli)
4. ASLA fiyat uydurma — katalogda yoksa "Fiyat bilgisi için ekibimize soralım" de
5. ASLA stokta olmayan ürünü satma
6. Sipariş onaylandığında IBAN bilgisini paylaş: ${config.businessIban || '[IBAN bilgisi ayarlanmamış]'}
7. Mesajları 500 karakteri geçmesin
8. Müşteriye "siz" diye hitap et

## İŞLETME BİLGİLERİ
- İşletme: ${config.businessName}
- Sektör: ${config.businessSector}
- Telefon: ${config.businessPhone || 'Belirtilmemiş'}
${catalogSection}

## SİPARİŞ AKIŞI
1. Müşteri ürün sorar → Katalogdan bilgi ver
2. Müşteri sipariş vermek ister → Ürün ve adet onayla
3. Tutar hesapla ve IBAN paylaş
4. "Ödeme dekontu gönderdikten sonra siparişiniz onaylanacaktır" de

## ÖNEMLİ
- "Yapay zeka" olduğunu söyleme, "müşteri temsilcisi" olarak tanıt
- Tehdit, hakaret içeren mesajlara nazik ama kararlı cevap ver
- Rakip firmaları kötüleme`;
}

module.exports = { generateResponse };
