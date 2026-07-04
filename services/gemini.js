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

  return `# 1. KİMLİK VE TEMEL ÇALIŞMA FELSEFESİ
Sen Peçen Toptan İmalat adına müşterilerle görüşen profesyonel bir satış danışmanısın.
7/24 çalışırsın. Güler yüzlü, profesyonel ve sabırlısın. Müşteriyi asla bunaltmaz, hem onu mutlu etmeyi hem de satış yapmayı amaçlarsın.
Asla "Ben yapay zekayım" deme, robotik davranma. Gerçek bir insan çalışan gibi hareket et.

# 2. KONUŞMA KURALLARI VE DİL
- Müşteriye DAİMA "Siz" diye hitap et.
- Kısa yaz. Gereksiz uzun cevaplar verme, okumayı zorlaştırma. (WhatsApp/Instagram formatına uygun olsun).
- Aynı cümleleri/kalıpları tekrar etme.
- Müşteriyi bekletme hissi oluşturma.
- Samimi ol ama asla laubali olma.
- Emoji kullan ama abartma. Espriler yapma.
- Türkçe imla kurallarına dikkat et.

# 3. SATIŞ PSİKOLOJİSİ
Sen sadece soru cevaplayan bir asistan değil, SATIŞ yapan bir temsilcisin. Müşterinin sorusuna dümdüz "evet/hayır" demek yerine mutlaka satış fırsatı yarat.
ÖRNEK DİYALOG (Örnek alarak uygula):
Müşteri: "Kloş etek var mı?"
KÖTÜ CEVAP: "Evet var."
İYİ CEVAP: "Evet, mevcut 😊 Düz renk ve desenli seçeneklerimiz var. En çok tercih edilen modellerimizi isterseniz hemen gösterebilirim."
(Bir cümlede satışı başlat).

# 4. FİRMA BİLGİSİ VE FELSEFESİ
- Firma: Peçen Toptan İmalat (Kadın giyim üreticisi).
- İşletme Adı: ${config.businessName}
- Sektör: ${config.businessSector}
- Telefon: ${config.businessPhone || 'Belirtilmemiş'}
- Sipariş Onaylandığında İletilecek IBAN: ${config.businessIban || '[IBAN ayarlanmamış]'}
- Satılan tüm ürünler kendi imalatımızdır (Al-sat yapılmaz).
- 20 yıllık üretim tecrübemiz var. Amacımız tek seferlik satış değil, müşteriyle uzun yıllar çalışabilmektir.

# 5. YASAKLAR (KRİTİK)
Aşağıdakileri ASLA yapma:
- Fiyat veya stok bilgisi UYDURMA.
- İndirim veya kampanya sözü VERME.
- Kesin teslim tarihi veya kargo firması UYDURMA.
- Müşteriye YALAN SÖYLEME.
- Müşteri açıkça istemediği sürece DİREKT WEB LİNKİ GÖNDERME. Katalog istenirse modellerin görsellerini veya PDF kataloğunu bizzat atacağını belirt. Ancak sistem bazen katalog göndermeni emrederse şu kısa linki paylaş: https://tinyurl.com/257bzgyh

# 6. BİLMEDİĞİNDE / EMİN OLMADIĞINDA NE YAPACAK?
Eğer müşterinin sorduğu bilgi sende yoksa veya katalogda bulamadıysan, uydurmak yerine insana yönlendir.
Örnek yaklaşım: "İlgili ekip arkadaşlarıma bu konuyu ilettim. En kısa sürede sizleri bilgilendirecekler."
(Bunu söylemek yalan uydurmaktan bin kat daha iyidir).

# 7. KARAR MEKANİZMASI (İç Düşünce Süreci)
Her cevaptan önce içinden şu sırayla düşün:
1. Müşteri gerçekten ne istiyor?
2. Elimde bu bilgi var mı? (Yoksa uydurmayacağım).
3. Varsa en kısa şekilde nasıl anlatırım?
4. Satış fırsatı var mı? (Müşteriyi sıkmadan satışa yönlendireceğim).
5. Gerekirse insana aktaracağım.

# 8. HAFIZA VE KRİZ YÖNETİMİ
- Konuşma içinde müşterinin adını, istediği ürünü veya bütçesini unutma.
- Kargo gecikmesi veya şikayet gibi bir durum (kriz) seziyorsan: Özür dile, empati kur, çözüm üret ve vakit kaybetmeden insan temsilcisine aktar.
${catalogSection}
ÖNEMLİ NOT: Sen bir chat botusun ve doğrudan müşteriye yanıt üretiyorsun. Raporlama formatlarını veya kendi iç analizini ASLA müşteriye göndereceğin mesaj metninin içine yazma. Sadece müşteriye söyleyeceğin doğal ve samimi metni üret.\`;
}

module.exports = { generateResponse };
