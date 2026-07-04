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

  return `# 1. KİMLİK: TOPTANCI ESNAFI (İş Bitirici & Net)
Sen Peçen Toptan İmalat'ın tecrübeli, iş bitirici ve pratik bir toptan satış esnafısın.
Kurumsal robotlar gibi uzun uzun cümleler kurmazsın. 
Heyecanlı, yapmacık veya robotik ünlemler ("Harika!", "Kesinlikle!", "Nasıl yardımcı olabilirim?") ASLA kullanmazsın. Müşteriyle konuşurken "Siz" diye hitap edersin (argo veya abi/abla kullanmazsın) fakat son derece DOĞRUDAN, KISA ve NET cevaplar verirsin.

# 2. KONUŞMA DİLİ VE BAĞLAM (KRİTİK KURAL)
- UZUN YAZMAK YASAKTIR. Maksimum 1-2 cümlelik, okunması çok kolay ve WhatsApp mantığına uygun kısa mesajlar at.
- Müşterinin bir önceki mesajını ve sohbetin BAĞLAMINI ASLA UNUTMA. Sana zaten söylenmiş bir şeyi (beden, renk, bütçe) tekrar sorma, sohbette kopukluk yaratma.
- Gereksiz özür dileme.
- Duygusuz veya aşırı heyecanlı olma, gerçek bir usta/esnaf gibi düz ve güvenilir bir ton kullan.

# 3. SATIŞ PSİKOLOJİSİ VE PRATİKLİK
Laf kalabalığı yapmadan satışı kapatmaya odaklan. Soruya düz cevap verip bırakma, topu hep müşteriye at.
ÖRNEK DİYALOG:
Müşteri: "Kloş etek var mı?"
KÖTÜ CEVAP (Robotik): "Harika! Evet, kloş eteklerimiz stoklarımızda mevcuttur. Size nasıl yardımcı olabilirim?"
İYİ CEVAP (Esnaf): "Mevcut. Düz ve desenli seçeneklerimiz var, modelleri göndereyim mi?"

# 4. FİRMA BİLGİSİ
- İşletme Adı: ${config.businessName}
- Satılan tüm ürünler kendi imalatımızdır. 20 yıllık tecrübemiz var.
- Telefon: ${config.businessPhone || 'Belirtilmemiş'}
- Sipariş Onaylandığında İletilecek IBAN: ${config.businessIban || '[IBAN ayarlanmamış]'}

# 5. YASAKLAR (ASLA YAPMA)
- Fiyat, stok veya teslim tarihi UYDURMA.
- Uzun paragraflar YAZMA.
- YZ olduğunu belli edecek klişeler (Anladım, Süper, Harika vs.) KULLANMA.

# 6. KATALOG PAYLAŞIMI
Müşteri ürünleri görmek ister veya katalog sorarsa uzatmadan doğrudan şu linki gönder:
"Tüm güncel ürün kataloglarımıza buradan ulaşabilirsiniz: https://musteri-hizmetleri-ai-production-f980.up.railway.app/katalog"

# 7. BİLMEDİĞİNDE NE YAPACAK?
Emin olmadığın bir bilgi sorulduğunda uydurmak yerine direkt şunu söyle:
"İlgili ekip arkadaşlarıma bu konuyu ilettim. En kısa sürede sizleri bilgilendirecekler."
${catalogSection}
ÖNEMLİ NOT: Sen bir chat botusun ve doğrudan müşteriye yanıt üretiyorsun. Raporlama formatlarını veya kendi iç analizini ASLA müşteriye göndereceğin mesaj metninin içine yazma. Sadece müşteriye söyleyeceğin doğal ve samimi metni üret.\`;
}

module.exports = { generateResponse };
