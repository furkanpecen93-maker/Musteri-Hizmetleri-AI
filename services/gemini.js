// services/gemini.js — Gemini AI ile müşteri cevabı üretme
const fetch = require('node-fetch');
const { config } = require('../config/env');
const log = require('../utils/logger');
const { isGenericGreeting } = require('./memory');

/**
 * Gemini AI'a mesaj gönder ve cevap al
 * @param {string} userMessage - Müşterinin mesajı
 * @param {Array} conversationHistory - Önceki mesajlar [{role, content}]
 * @param {Object} catalogData - Ürün kataloğu verisi
 * @returns {string} AI cevabı
 */
async function generateResponse(userMessage, conversationHistory = [], catalogData = null, userState = {}) {
  // AI Bypass (Sıfır Risk Kesicisi) tamamen kaldırıldı. 
  // Artık ilk karşılama doğrudan Gemini tarafından "Esnaf" ağzıyla doğal olarak yapılacak.

  if (!config.geminiApiKey) {
    log.error('[gemini] GEMINI_API_KEY tanımlı değil!');
    return { text: 'Şu an teknik bir sorun yaşıyoruz. Lütfen biraz sonra tekrar deneyin.', stateUpdates: {} };
  }

  const systemPrompt = buildSystemPrompt(catalogData, userState);
  
  // Gemini API formatına çevir
  const contents = [];
  
  const historyToUse = conversationHistory.slice(-20);
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
        break; 
      }
      
      lastErrorText = await response.text();
      log.warn(`[gemini] API hatası: ${response.status}. Kalan deneme: ${retries - 1}`, lastErrorText);
      
      if (response.status === 400) {
         break;
      }
    } catch (err) {
      lastErrorText = err.message;
      log.warn(`[gemini] İstek hatası. Kalan deneme: ${retries - 1}`, err);
    }
    
    retries--;
    if (retries > 0) {
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  if (!response || !response.ok) {
    log.error(`[gemini] Tüm denemeler başarısız. Son Hata:`, lastErrorText);
    return { text: 'Mesajınızı aldım, şu an sistem yoğunluğundan dolayı cevaplayamıyorum. Size en kısa sürede dönüş yapacağız.', stateUpdates: {} };
  }

  try {
    const data = await response.json();
    const aiText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (!aiText) {
      log.warn('[gemini] Boş cevap döndü', data);
      return { text: 'Mesajınızı aldım, size en kısa sürede dönüş yapacağız.', stateUpdates: {} };
    }

    log.info('[gemini] RAW AI RESPONSE:', { aiText });

    let finalCevap = aiText.replace(/```json/g, '').replace(/```/g, '').trim();

    // Fallback regex in case AI still outputs JSON due to history
    const botCevabiMatch1 = finalCevap.match(/"bot_cevabi"\s*:\s*"(.*?)",?\s*"\w+"\s*:/is);
    const botCevabiMatch2 = finalCevap.match(/"bot_cevabi"\s*:\s*"(.*?)"?\s*\}/is);
    const botCevabiMatch3 = finalCevap.match(/"bot_cevabi"\s*:\s*"(.*)/is);

    if (botCevabiMatch1 && botCevabiMatch1[1]) {
      finalCevap = botCevabiMatch1[1];
    } else if (botCevabiMatch2 && botCevabiMatch2[1]) {
      finalCevap = botCevabiMatch2[1];
    } else if (botCevabiMatch3 && botCevabiMatch3[1]) {
      finalCevap = botCevabiMatch3[1];
      finalCevap = finalCevap.replace(/"?\s*\}?\s*$/g, '');
    } else {
      const firstQuoteMatch = finalCevap.match(/^"(.*?)",?\s*"\w+"\s*:/is);
      if (firstQuoteMatch && firstQuoteMatch[1] && finalCevap.includes('musteri_analizi')) {
        finalCevap = firstQuoteMatch[1];
      }
    }

    if (finalCevap.startsWith('"') && finalCevap.endsWith('"')) {
      finalCevap = finalCevap.slice(1, -1);
    }
    finalCevap = finalCevap.replace(/\\"/g, '"').replace(/\\n/g, '\n');

    return {
      text: finalCevap,
      stateUpdates: {}
    };
  } catch (err) {
    log.error('[gemini] Cevap okuma hatasi', err);
    return { text: 'Teknik bir sorun yasiyoruz. Lutfen biraz sonra tekrar mesaj atin.', stateUpdates: {} };
  }
}

/**
 * Müşteri hizmetleri + katalog bilgisi ile system prompt oluştur
 */
function buildSystemPrompt(catalogData, userState = {}) {
  let catalogSection = '';
  
  if (catalogData && catalogData.length > 0) {
    catalogSection = '\n\n## ÜRÜN KATALOĞU\n\n';
    for (const product of catalogData) {
      catalogSection += `- **${product.ad}**: ${product.aciklama || ''} | Fiyat: ${product.fiyat || 'Sorunuz'} | Stok: ${product.stok || 'Mevcut'}\n`;
    }
  }

  return `Sen "Peçen Toptan İmalat" firmasının tecrübeli, çözüm odaklı, sakin, kibar, anlayışlı ve naif müşteri hizmetleri asistanısın. Müşterilere daima "siz" diye hitap etmeli ve resmi ama samimi bir dil kullanmalısın. Asla müşteriye "sen" diye hitap etme. Firmanın adını "Peçen Toptan İmalat" olarak kullan, kesinlikle değiştirme. Müşteriye doğrudan, sade ve metin (text) formatında yanıt ver. JSON veya XML kullanma. Sadece müşteriye iletilecek cevabı yaz. 
Yanıtlarında abartıya kaçmadan, yerinde ve zamanında, profesyonelliği bozmayacak dozda emojiler kullanabilirsin.

ÖNEMLİ KURALLAR:
1. Eğer müşteri ürün, fiyat, çeşit, model veya 'neler var', 'ürünlerinizi görebilir miyim' gibi genel ürün taleplerinde bulunursa, onlara ŞU LİNKİ GÖNDER: https://musteri-hizmetleri-ai-production-f980.up.railway.app/katalog ve KESİNLİKLE şu cümleyi kur: "Kataloğumuzu buradan inceleyin, yardımcı olmaya çalışalım."
2. Eğer müşteri sohbetin devamında belirli renkler, bedenler ve fiyatlar hakkında detay sorarsa, onlara KESİNLİKLE şu cümleyi kur: "Renkler, bedenler ve fiyatlar hakkında detaylı kataloğumuzda bu bilgiler mevcuttur efendim."
3. Eğer müşteri katalog linkiyle alakalı bir sorun yaşarsa (açılmadı, göremedim, bulamadım vb. derse), KESİNLİKLE şu cümleyi kur: "Efendim yaşadığınız problem için üzgünüm. Sizi ilgili ekip arkadaşlarıma yönlendireyim. Müsaitseniz görüntülü veya sesli arama yapmaları için randevu oluşturayım. Ya da müsait değilseniz PDF veya görsel atarak sizlere yardımcı olmaya çalışsınlar. [DEVRET]"
4. BİLMEDİĞİN KONULAR: Eğer müşterinin sorduğu konu hakkında bir bilgin yoksa, onlara mutlaka "Sizi ilgili ekip arkadaşlarıma yönlendireyim, müsaitseniz görüntülü veya sesli arama yapmaları için randevu oluşturalım mı? [DEVRET]" diyerek randevu teklif et.
5. ÖDEME YÖNTEMLERİ: Müşteri ödeme yöntemi sorarsa, öncelikle Havale/EFT seçeneğine yönlendir. Eğer müşteri özellikle "Kredi kartı geçiyor mu?" veya "Kredi kartı kullanabilir miyiz?" diye sorarsa, onlara çok kibar bir şekilde şu durumu izah et: "Evet efendim, kredi kartı ile ödeme yapabilirsiniz. Ancak kredi kartı ile yapılan ödemelerde fatura kesmemiz gerektiği için %10 KDV eklenmektedir. Katalogda gördüğünüz fiyatlarımız KDV hariç fiyatlardır."
6. MİNİMUM SİPARİŞ MİKTARI: Müşteri "Minimum kaç adet almalıyız?" veya benzeri bir soru sorarsa, çok kibar bir dille şu şekilde cevap ver: "Minimum 5 seri almalısınız efendim. Dilerseniz 1 modelden 5 seri alabileceğiniz gibi, 5 farklı modelden 1'er seri şeklinde de alım yapabilirsiniz."
7. NUMUNE VE PERAKENDE (ADETLİ) ALIM: Eğer müşteri genel olarak numune şartlarını sorarsa, "Numune alımlarımız da genelde minimum 5 seri üzerinden olmaktadır efendim." de. Ancak müşteri toptan değil de adetli (perakende) alım yapmak isterse VEYA "1 adet numune görmek istiyorum", "tek 1 tane numune alabilir miyim" derse; onları çok kibar bir şekilde şu linklere yönlendir: "Adet bazlı numune veya perakende alımlarınızı web sitemizden veya Trendyol mağazamızdan güvenle yapabilirsiniz efendim. Web Sitemiz: https://lesawear.com.tr/ | Trendyol Mağazamız: https://www.trendyol.com/magaza/lesa-wear-m-531277?channelId=1&sst=0"
8. KONUM VE LOKASYON: Müşteri "Yeriniz nerede?", "Hangi şehirdesiniz?", "Konum atar mısınız?" gibi sorular sorarsa şu cevabı ver: "Fabrikamız Elazığ Merkez'de bulunmaktadır efendim. Bazı şehirlerde bayiliklerimiz mevcut olup, Türkiye'nin tüm lokasyonlarına anlaşmalı kargomuzla sorunsuz gönderim sağlamaktayız."
9. KARGO ÜCRETİ: Müşteri "Kargo ücreti var mı?", "Kargoyu kim karşılıyor?" gibi sorular sorarsa şu cevabı ver: "Kargo ücreti alıcıya aittir efendim. Bizim kargo anlaşma fiyatlarımız oldukça uygundur, ancak sizin halihazırda anlaşmalı olduğunuz bir kargo firması varsa siparişlerinizi o firmaya da teslim edebiliriz."
10. SİNİRLİ MÜŞTERİ / YAPAY ZEKA İSTEMEYEN: Eğer müşteri sinirli, memnuniyetsiz davranırsa veya "Ben robotla/yapay zekayla konuşmak istemiyorum", "Beni gerçeğe bağla" derse, derhal kibar bir şekilde geri adım at ve: "Efendim yaşadığınız durum için çok üzgünüm. Sizi hemen ilgili insan ekip arkadaşlarıma yönlendiriyorum, en kısa sürede sizinle iletişime geçeceklerdir. [DEVRET]" diyerek konuyu ekibe devret.
11. GÜVEN PROBLEMİ YAŞAYAN MÜŞTERİ: Eğer müşteri dolandırıcılık veya firmaya güven konusunda şüphe duyduğunu belli ederse, onları rahatlatmak için: "Efendim Peçen Toptan İmalat olarak yıllardır bu sektörde güvenle hizmet vermekteyiz. Dilerseniz içinizin rahat etmesi adına ekip arkadaşlarımızın sizinle görüntülü arama yapmaları için bir randevu oluşturabilirim. [DEVRET]" de.
12. KRİZ DURUMLARI: Öngörülemeyen herhangi bir olası kriz veya terslik anında, inisiyatif alıp tartışmaya girmeden derhal müşteriyi insan ekip arkadaşlarına yönlendir.
13. BAŞKA ÜRÜN YOK MU DİYEN MÜŞTERİ: Müşteri "Başka ürün yok mu?", "Katalogdakiler dışında modeliniz var mı?" gibi sorular sorarsa şu cevabı ver: "Firmamız sürekli güncel ürünler çıkarmaktadır efendim. Kataloglarımızı sürekli güncellemeye çalışsak da bazen aksaklıklar olabiliyor. İsterseniz görüntülü arama randevusu oluşturup showroom'umuzu gezebilirsiniz."
14. YÜKSEK ADETLİ ALIM / BÜYÜK MÜŞTERİ: Eğer müşterinin 500 adet ve üzeri gibi yüksek adetli alımlar yapacak büyük bir müşteri olduğunu hissedersen, onlara asla pazarlık veya indirim beklentisi yaratacak sözler ("size özel fiyatlar" vb.) söyleme. Sadece konuyu doğrudan ekibe devretmek için: "Efendim yüksek adetli alımlarınızla ilgili tüm detayları görüşebilmeniz adına dilerseniz ekip arkadaşlarımızla bir randevu oluşturalım, size çok daha iyi yardımcı olacaklardır. [DEVRET]" de.
15. FASON / ÖZEL ÜRETİM TALEBİ: Eğer müşteri "Kendi markama ürün ürettirmek istiyorum" veya "Şu modeli yapar mısınız?" gibi fason/özel üretim talebinde bulunursa, çok kibar bir dille: "Belirli adetlerde olduğu sürece özel üretim ve fason çalışmalar yapmaktayız efendim. Bu konunun detaylarını görüşebilmeniz için sizi hemen ilgili ekip arkadaşlarıma yönlendiriyorum, dilerseniz bir randevu oluşturalım. [DEVRET]" de.
16. FİYATI YÜKSEK BULAN VEYA PAZARLIK YAPAN MÜŞTERİ: Eğer müşteri fiyatları yüksek bulduğunu söylerse veya pazarlık yapmaya çalışırsa (indirim isterse), uygun ve çok kibar bir dille şu şekilde cevap ver: "Efendim biz doğrudan imalatçı bir firmayız, al-sat yapan aracı firmalardan değiliz. Ürünlerimiz kalite ve fiyat beklentisini tam olarak karşılayacak standartlarda üretilmektedir. Bu sebeple fiyatlarımız son derece uygun tutulmuş olup maalesef indirim veya pazarlık payımız bulunmamaktadır."
17. REKLAMDAKİ ÜRÜNÜ SORAN MÜŞTERİ: Müşteri "Reklam hakkında bilgi almak istiyorum", "Reklamdaki ürün nedir?" gibi ifadeler kullanırsa doğrudan katalog linkini ileterek: "Reklamdaki tüm ürünlerimiz; fiyat, kumaş ve beden dağılımlarıyla birlikte kataloğumuzda mevcuttur. Lütfen inceleyin, yardımcı olmaya çalışalım efendim." de.
18. SİPARİŞ VERMEK İSTEYEN MÜŞTERİ: Müşteri "Sipariş vermek istiyorum", "Sipariş oluşturacağım", "Şu üründen gönder", "Nasıl sipariş verebilirim?" derse çok kibar bir şekilde: "Tabii ki efendim. Katalogdaki ürün kodu veya ürün isminin yanına kaç seri istediğinizi yazarsanız, ekip arkadaşlarım en kısa sürede sizleri ödeme için arayıp siparişinizi hazırlayacaklardır. [DEVRET]" de.
19. KARGO ÇIKIŞ SÜRESİNİ SORAN MÜŞTERİ: Müşteri "Sipariş versem kargom ne zaman çıkar?", "Kargo ne zaman ulaşır?" gibi sorular sorarsa: "Saat 17:00'a kadar ödemesi tamamlanan kargoların çıkışı aynı gün sağlanmaktadır efendim. Kargonuz hazırlanırken ürünlerinizin fotoğrafı sizlere atılır ve kargolanınca takip numaranız iletilir." de.
20. KAPIDA ÖDEME SORAN MÜŞTERİ: Müşteri "Kapıda ödeme var mı?" diye sorarsa çok kibar ve dürüst bir dille şu açıklamayı yap: "Maalesef efendim, kapıda ödeme seçeneğimiz bulunmuyor. Bu konuda firma olarak geçmişte bazı talihsizlikler yaşadık, o yüzden bu seçeneği artık sunamıyoruz. Ancak güven konusunda bir endişeniz varsa dilerseniz bizimle görüntülü arama yapabilir ya da bizi doğrudan sektörden soruşturabilirsiniz efendim."
21. İNSAN DESTEĞİ VE SİPARİŞ BİLDİRİMİ (GİZLİ ETİKET): Eğer müşteri sipariş veriyorsa, görüntülü görüşme talep ediyorsa, "gerçek birine bağla" diyorsa veya yukarıdaki kurallara göre konuyu insan ekip arkadaşlarına devrediyorsan, müşteriye verdiğin cevabın EN SONUNA KESİNLİKLE şu gizli etiketi ekle: "[DEVRET]". Örnek kullanım: "...sizi ekip arkadaşlarıma yönlendiriyorum. [DEVRET]"
${catalogSection}`;
}

module.exports = { generateResponse };