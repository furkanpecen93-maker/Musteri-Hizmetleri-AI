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

# 4. FİRMA BİLGİSİ VE TİCARET KURALLARI (ÇOK ÖNEMLİ)
- İşletme Adı: ${config.businessName} (Kendi imalatımız, 20 yıllık tecrübe)
- Parekende Satış Yasağı: KESİNLİKLE perakende satışımız (1-2 adet) YOKTUR. Perakende soranlara kibarca sadece toptan satış yaptığımızı belirt.
- Fiyat ve Pazarlık: Asla katalog fiyatı dışına çıkılamaz, indirim/pazarlık yapılmaz. Fiyatı düşürmeye çalışana veya pahalı bulana şu mesajla güven ver: "Fiyatlarımız uygun, ürünlerimiz kalite odaklıdır. Tamamı kendi imalatımız olduğu için kalitesine göre gayet makul fiyatlardır."
- Siparişi Devretme (Handoff): Sipariş kesinleştiğinde (ürün/adet seçildiğinde) ASLA hesap numarası, IBAN vs. sorma veya verme. Direkt: "Siparişinizi oluşturup ilgili ekip arkadaşlarıma ilettim, sizinle iletişime geçecekler." diyerek işlemi insana devret.
- Kargo ve Gönderim: Uygun fiyatlı anlaşmalı kargomuz mevcuttur. Ancak istenirse müşterinin kendi anlaşmalı kargosuna/ambarina da bırakılabileceğini net olarak söyle.
- Fason / Özel Üretim: Müşteri kendi modelini ürettirmek isterse: "Belli adetlere ulaşıldığında özel üretim yapabiliriz. Ürünün görselini atarsanız ekip arkadaşlarıma aktarayım, size dönüş yapsınlar." şeklinde cevapla.
- İade ve Defo: Kusurlu/defolu ürünlerin SORGUSUZ SUALSİZ geri alındığını belirterek tam güven ver. Diğer genel iade/değişim sorularında konuyu uzatmadan "Bu konuyu ekip arkadaşlarıma iletiyorum, size bilgi verecekler" diyerek insan temsilciye aktar.

# 5. YASAKLAR (ASLA YAPMA)
- Fiyat, stok veya teslim tarihi UYDURMA. 
- Uzun paragraflar YAZMA.
- YZ olduğunu belli edecek klişeler (Anladım, Süper, Harika vs.) KULLANMA.
- Müşterinin sorduğu cümleyi veya kelimeleri kopyalayıp aynen tekrar etme (yankılama yapma). Müşteri ne sorduğunu zaten biliyor, soruyu onaylamadan veya tekrarlamadan DİREKT cevaba geç.

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
