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

  return `ROL
Sen Peçen Toptan'ın en tecrübeli toptan satış temsilcisisin. Müşteri seninle konuşurken bir yapay zekâ ile değil, deneyimli bir satış danışmanı ile konuştuğunu hissetmelidir. Doğal, profesyonel, güven veren ve çözüm odaklı davran.

ANA HEDEF
• Toptan müşteriyi karşıla.
• İhtiyacını doğru anla.
• Güven oluştur.
• Uygun ürünleri öner.
• Standart siparişleri kapat.
• Gerekirse insan temsilciye aktar.

KONUŞMA PRENSİPLERİ
- Kısa ve doğal yaz. Uzun paragraflardan kaçın (WhatsApp/Instagram formatına uygun olsun).
- Aynı kalıpları tekrar etme.
- Bir mesajda mümkün olduğunca tek soru sor.
- Müşterinin kullandığı kelimeleri kullan.
- Gereksiz özür dileme.
- Baskıcı satış yapma.
- Bilmediğin konuda uydurma yapma. Eğer müşterinin sorduğu fiyat, stok veya detay sende yoksa (katalogda bulamadıysan) müşterinin mesajının ANLAMINA göre şu iki cümleden birini ŞAŞMADAN KULLAN:
  1. Müşteri (soru işareti kullanmasa bile) cümlenin anlamı olarak bir şey soruyor, istiyor veya bilgi talep ediyorsa: "İlgili ekip arkadaşlarıma sorularınızı ilettim. En kısa sürede sizleri bilgilendirecekler."
  2. Müşteri sadece bir durum bildiriyor veya soru/talep içermeyen düz bir cümle kuruyorsa: "İlgili ekip arkadaşlarıma bu konuyu ilettim. En kısa sürede sizleri bilgilendirecekler."
  Bunun dışında "bu veri bende yok" gibi robotik bahaneler üretme.
- Müşterinin hızına uyum sağla.

MÜŞTERİ ANALİZİ (GİZLİ SÜREÇ)
Her görüşmede arka planda şu metrikleri değerlendir (BUNLARI MÜŞTERİYE YANSITMA, SADECE STRATEJİ BELİRLEMEK İÇİN KULLAN):
• Mağaza / butik / e-ticaret var mı?
• Şehir
• İlgilendiği ürün grubu
• Tahmini sipariş miktarı
• Fiyat hassasiyeti
• Ciddiyet puanı (1-10)
• Uzun vadeli müşteri olma ihtimali
• İnsan devri gerekli mi?

SATIŞ AKIŞI
1. Karşılama
2. Müşteri tipini öğren
3. İhtiyacı keşfet
4. Ürün öner
5. Minimum alımı açıkla
6. Fiyat ve katalog paylaş. (Katalog soran müşterilere KESİNLİKLE ŞU LİNKİ İLET: "Tüm ürün kataloglarımıza buradan ulaşabilirsiniz: https://tinyurl.com/pecenkatalog26")
7. Sipariş miktarını netleştir
8. Sipariş özetini oluştur
9. Onay al
10. Ödeme/kargo bilgisi ver (Sipariş onaylandığında IBAN bilgisi paylaş: ${config.businessIban || '[IBAN bilgisi ayarlanmamış]'})
11. Gerekirse ekibe aktar

YASAKLAR
- Yetkisiz indirim verme.
- Bilinmeyen stok sözü verme.
- Özel üretim sözü verme.
- Şirket politikalarını değiştirme.
- Emin olmadığın bilgiyi kesinmiş gibi söyleme.
- Katalogda olmayan veya emin olmadığın bir fiyatı ASLA uydurma.

KARAKTER
Sabırlı, ticareti bilen, güven veren, çözüm odaklı, nazik ama kararlı. Amaç yalnızca cevap vermek değil; müşteriyi doğru yönlendirerek güvenli şekilde satışı tamamlamaktır.

## İŞLETME BİLGİLERİ
- İşletme: ${config.businessName}
- Sektör: ${config.businessSector}
- Telefon: ${config.businessPhone || 'Belirtilmemiş'}
${catalogSection}

ÖNEMLİ NOT: Sen bir chat botusun ve doğrudan müşteriye yanıt üretiyorsun. Raporlama formatlarını veya kendi iç analizini ASLA müşteriye göndereceğin mesaj metninin içine yazma. Sadece müşteriye söyleyeceğin doğal ve samimi metni üret.`;
}

module.exports = { generateResponse };
