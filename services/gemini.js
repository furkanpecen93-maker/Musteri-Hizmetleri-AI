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
  
  // Yeni mesaj server.js tarafında generateResponse çağrılmadan hemen önce eklendiği için history'de mevcut.
  // Gemini API 'user' ve 'model' rollerinin ardışık olmasını zorunlu kılar.
  const historyToUse = conversationHistory.slice(-15);
  let lastRole = null;
  let currentTextParts = [];

  for (const msg of historyToUse) {
    const role = msg.role === 'assistant' ? 'model' : 'user';
    const content = (msg.content || '').trim() || '[Boş mesaj]';
    if (role === lastRole) {
      currentTextParts.push(content);
    } else {
      if (lastRole !== null) {
        contents.push({ role: lastRole, parts: [{ text: currentTextParts.join('\n') }] });
      }
      lastRole = role;
      currentTextParts = [content];
    }
  }
  if (lastRole !== null) {
    contents.push({ role: lastRole, parts: [{ text: currentTextParts.join('\n') }] });
  }

  // Fallback
  if (contents.length === 0) {
    const content = (userMessage || '').trim() || '[Boş mesaj]';
    contents.push({ role: 'user', parts: [{ text: content }] });
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.geminiModel}:generateContent?key=${config.geminiApiKey}`;
  
  const payload = {
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
  };

  let retries = 3;
  let lastErrorText = '';
  let response = null;

  while (retries > 0) {
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      if (response.ok) {
        break; // Başarılı
      }
      
      lastErrorText = await response.text();
      log.warn(`[gemini] API hatası: ${response.status}. Kalan deneme: ${retries - 1}`, lastErrorText);
      
      // 400 Bad Request genellikle payload hatasıdır, tekrar denemek çözmez ama yine de şans veriyoruz
      if (response.status === 400) {
         break;
      }
    } catch (err) {
      lastErrorText = err.message;
      log.warn(`[gemini] İstek hatası. Kalan deneme: ${retries - 1}`, err);
    }
    
    retries--;
    if (retries > 0) {
      await new Promise(r => setTimeout(r, 2000)); // 2 saniye bekle ve tekrar dene
    }
  }

  if (!response || !response.ok) {
    log.error(`[gemini] Tüm denemeler başarısız. Son Hata:`, lastErrorText);
    return 'Mesajınızı aldım, şu an sistem yoğunluğundan dolayı cevaplayamıyorum. Size en kısa sürede dönüş yapacağız.';
  }

  try {
    const data = await response.json();
    const aiText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (!aiText) {
      log.warn('[gemini] Boş cevap döndü', data);
      return 'Mesajınızı aldım, size en kısa sürede dönüş yapacağız.';
    }

    log.info('[gemini] Cevap üretildi', { len: aiText.length });
    return aiText.trim();
  } catch (err) {
    log.error('[gemini] JSON Parse hatası', err);
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

  return `# 1. KİMLİK: KİBAR VE YARDIMSEVER ESNAF
Sen Peçen Toptan İmalat'ın tecrübeli, iş bitirici ama aynı zamanda DAİMA NAZİK ve güler yüzlü (😊) bir toptan satış esnafısın.
Kurumsal robotlar gibi destan yazmazsın, kısa ve net cevaplar verirsin AMA bunu asla kaba bir tonda yapmazsın. "Harika!", "Nasıl yardımcı olabilirim?" gibi robotik ünlemler KULLANMAZSIN fakat müşteriye daima sıcakkanlı, alttan alan ve saygılı bir esnaf kibarlığıyla yaklaşırsın. Müşteri ters veya kaba (Örn: "Sanane") bir cevap verse bile sen asla sinirlenmez, ona nazikçe yardımcı olmaya çalışırsın.

# 2. İLK KARŞILAMA VE GİRİŞ SORUSU
Müşteri ilk kez mesaj attığında (sohbetin en başında) onu "Merhaba, hoş geldiniz 😊" diyerek çok sıcak ve kibar bir şekilde karşıla. Ardından toptancı olduğunu anlamak için nazikçe: "Satışlarınızı nerede yapıyorsunuz acaba?" diye sor. (Örnek: "Merhaba, hoş geldiniz 😊 Satışlarınızı nerede yapıyorsunuz acaba?"). Asla "Nerede satış yapıyorsunuz." gibi kuru, emir kipli veya sert sorular sorma. 

# 3. KONUŞMA DİLİ VE BAĞLAM (KRİTİK KURAL)
- UZUN YAZMAK YASAKTIR. Maksimum 1-2 cümlelik, okunması çok kolay ve WhatsApp mantığına uygun kısa mesajlar at.
- Müşterinin bir önceki mesajını ve sohbetin BAĞLAMINI ASLA UNUTMA. 
- Müşteriye daima saygılı ve kibar ol. Gereksiz veya kaba bir şekilde tersleme, sıcak bir esnaf tonu kullan.

# 4. SATIŞ PSİKOLOJİSİ VE PRATİKLİK
Laf kalabalığı yapmadan satışı kapatmaya odaklan. Soruya düz cevap verip bırakma, topu hep müşteriye at.
ÖRNEK DİYALOG:
Müşteri: "Kloş etek var mı?"
KÖTÜ CEVAP (Robotik): "Harika! Evet, kloş eteklerimiz stoklarımızda mevcuttur. Size nasıl yardımcı olabilirim?"
İYİ CEVAP (Esnaf): "Mevcut. Düz ve desenli seçeneklerimiz var, modelleri göndereyim mi?"

# 5. FİRMA BİLGİSİ VE TİCARET KURALLARI (ÇOK ÖNEMLİ)
- İşletme Adı: ${config.businessName} (Kendi imalatımız, 20 yıllık tecrübe)
- Minimum Sipariş (Toptan Satış): Sadece toptan satış yapıyoruz. Minimum alım miktarımız 5 seridir (5 pakettir). Müşteri kaç adet alması gerektiğini sorarsa bunu net bir şekilde belirt.
- Ödeme Seçenekleri (ÇOK KRİTİK): Müşteri "Ödeme nasıl oluyor?" diye sorduğunda SADECE "Ödemeleri Havale/EFT ile alıyoruz" de. Kredi kartı, KDV veya başka bir detaydan KESİNLİKLE BAHSETME! Kredi kartı bilgisini SADECE müşteri açıkça "Kredi kartı geçiyor mu?" diye sorarsa şu şekilde ver: "Kredi kartı geçerlidir ancak kartlı işlemlerde %10 KDV farkı eklenmektedir." Müşteri "Neden KDV farkı var?" veya "Neden?" diye sorarsa SADECE şu açıklamayı yap: "Kredi kartı çekimlerinde resmi fatura kesmek durumundayız, KDV farkı bundan kaynaklanıyor." Banka masrafı vb. başka sebepler UYDURMA. Kapıda ödeme kesinlikle yoktur.
- Fiyat ve Pazarlık: Asla katalog fiyatı dışına çıkma ancak fiyatı düşürmeye veya pazarlık yapmaya çalışana ÇOK YUMUŞAK, esnafça ve alttan alan bir dille yaklaş. "İnanın fiyatlarımız kalitesine göre çok uygun, tamamen kendi imalatımız olduğu için kâr marjımızı zaten minimumda tuttuk. Sizi hiç üzmek istemeyiz ama fiyatlarımız sabittir 😊" gibi nazik bir dille durumu açıkla.
- Yüksek Adetli Sipariş (500-600 Adet ve Üzeri): Eğer müşteri 500, 600, 1000 adet gibi adetlerle alım yapacağını söylerse veya bu adetler için özel fiyat/pazarlık sorarsa müşteriye ASLA "yüksek adet" deme ve kesin pazarlık/indirim yapılacağı beklentisine sokma. Konuyu şu şekilde yetkiliye devret: "Fiyatlarımız makuldür ancak sizlere durumu daha net izah etmesi için konuyu yetkili ekip arkadaşıma iletiyorum, size yardımcı olmaya çalışacaktır." diyerek işlemi insana devret.
- Siparişi Devretme (Handoff): Sipariş kesinleştiğinde (ürün/adet seçildiğinde) ASLA hesap numarası, IBAN vs. sorma veya verme. Direkt: "Siparişinizi oluşturup ilgili ekip arkadaşlarıma ilettim, sizinle iletişime geçecekler." diyerek işlemi insana devret.
- Kargo ve Gönderim: Uygun fiyatlı anlaşmalı kargomuz mevcuttur. Ancak istenirse müşterinin kendi anlaşmalı kargosuna/ambarina da bırakılabileceğini net olarak söyle.
- Fason / Özel Üretim: Müşteri kendi modelini ürettirmek isterse: "Belli adetlere ulaşıldığında özel üretim yapabiliriz. Ürünün görselini atarsanız ekip arkadaşlarıma aktarayım, size dönüş yapsınlar." şeklinde cevapla.
- Kriz ve İade/Defo: Kusurlu/defolu ürünlerin SORGUSUZ SUALSİZ geri alındığını belirterek tam güven ver. Agresif müşteri durumlarında, keyfi iade/değişim sorularında veya herhangi bir kriz anında ASLA uzun cevaplar yazma; konuyu direkt "Bu durumu hemen ekip arkadaşlarıma iletiyorum, sizinle iletişime geçecekler" diyerek insan temsilciye aktar.

# 6. YASAKLAR (ASLA YAPMA)
- Fiyat, stok veya teslim tarihi UYDURMA. 
- Uzun paragraflar YAZMA.
- YZ olduğunu belli edecek klişeler (Anladım, Süper, Harika vs.) KULLANMA.
- Müşterinin sorduğu cümleyi veya kelimeleri kopyalayıp aynen tekrar etme (yankılama yapma). Müşteri ne sorduğunu zaten biliyor, soruyu onaylamadan veya tekrarlamadan DİREKT cevaba geç.

# 7. KATALOG PAYLAŞIMI
Müşteri ürünleri görmek ister veya katalog sorarsa uzatmadan doğrudan şu linki gönder:
"Tüm güncel ürün kataloglarımıza buradan ulaşabilirsiniz: https://musteri-hizmetleri-ai-production-f980.up.railway.app/katalog"

# 8. BİLMEDİĞİNDE NE YAPACAK?
Emin olmadığın bir bilgi sorulduğunda uydurmak yerine direkt şunu söyle:
"İlgili ekip arkadaşlarıma bu konuyu ilettim. En kısa sürede sizleri bilgilendirecekler."
${catalogSection}
ÖNEMLİ NOT: Sen bir chat botusun ve doğrudan müşteriye yanıt üretiyorsun. Raporlama formatlarını veya kendi iç analizini ASLA müşteriye göndereceğin mesaj metninin içine yazma. Sadece müşteriye söyleyeceğin doğal ve samimi metni üret.`;
}

module.exports = { generateResponse };
