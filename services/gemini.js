// services/gemini.js — Gemini AI ile müşteri cevabı üretme
const fetch = require('node-fetch');
const { config } = require('../config/env');
const log = require('../utils/logger');
const { isGenericGreeting, saveOrder } = require('./memory');
const { searchProducts } = require('./catalog');

/**
 * AI çıktısını sanitize et — dahili düşünce süreçlerini, İngilizce iç monologları,
 * ve müşteriye gösterilmemesi gereken meta-bilgileri temizle.
 * Bu, son savunma hattıdır; system prompt'taki yasak birincil önlemdir.
 */
function sanitizeAiResponse(text) {
  if (!text || typeof text !== 'string') return text;
  
  let cleaned = text;
  
  // 1. "THOUGHT" / "THINKING" / "REASONING" / "ANALYSIS" bloklarını tamamen sil
  //    Formatlar: "THOUGHT\n...", "THOUGHT:...", "[THOUGHT]...", "*THOUGHT*..."
  //    Hem satır başında hem de metin ortasında yakalansın
  cleaned = cleaned.replace(/(?:^|\n)\s*(?:\[|\*|\()?\s*(?:THOUGHT|THINKING|REASONING|ANALYSIS|DÜŞÜNCE|ANALİZ|İÇ\s*MONOLOG|INTERNAL|NOTE\s*TO\s*SELF|CHAIN\s*OF\s*THOUGHT|COT)\s*(?:\]|\*|\))?\s*[:\-]?\s*[\s\S]*?(?=\n\n|$)/gi, '');
  
  // 2. "Since there's no...", "I should...", "Let me think..." gibi İngilizce iç monolog cümleleri
  cleaned = cleaned.replace(/(?:^|\n)\s*(?:Since|Because|Let me|I (?:should|need|will|must|think|notice|can see|observe|conclude|decide|am going))\s[^\n]*(?:\n(?!\n)[^\n]*)*/gi, (match) => {
    // Sadece açıkça iç monolog olan cümleleri sil (Türkçe müşteri cevabı içinde İngilizce geçebilir)
    const internalPatterns = /(?:I should follow|I need to|I will respond|I notice|I can see|Let me think|rule \d|follow rule|direct them|I'm going to|the user is asking|the customer|this is not|based on the rules|according to)/i;
    if (internalPatterns.test(match)) {
      return '';
    }
    return match;
  });
  
  // 3. JSON artifact kalıntıları ("musteri_analizi", "niyet", "duygu" gibi meta alanlar)
  cleaned = cleaned.replace(/(?:^|\n)\s*"?(?:musteri_analizi|niyet|duygu|confidence|intent|sentiment|action_taken)"?\s*[:\=]\s*[^\n]*/gi, '');
  
  // 4. Markdown olmayan asterisk/hash kalıntıları temizle (### gibi başlıklar değil, tek * gibi)
  // Bunlar zaten sendInstagramMessage'da temizleniyor olabilir ama garanti olsun
  
  // 5. Çoklu boş satırları tek boş satıra indir
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
  
  // 6. Baş ve sondaki boşlukları temizle
  cleaned = cleaned.trim();
  
  // 7. Eğer temizleme sonrası metin tamamen boşaldıysa, fallback döndür
  if (!cleaned || cleaned.length < 5) {
    log.warn('[sanitize] AI cevabı tamamen temizlendi, fallback kullanılıyor', { original: text.substring(0, 200) });
    return 'Mesajınızı aldım efendim. Sizi ilgili ekip arkadaşlarıma yönlendiriyorum, en kısa sürede size dönüş yapacaklar.';
  }
  
  return cleaned;
}

/**
 * Gemini AI'a mesaj gönder ve cevap al
 * @param {string} userMessage - Müşterinin mesajı
 * @param {Array} conversationHistory - Önceki mesajlar [{role, content}]
 * @param {Object} catalogData - Ürün kataloğu verisi (ARTIK KULLANILMIYOR, DİNAMİK)
 * @returns {string} AI cevabı
 */
async function generateResponse(userMessage, conversationHistory = [], catalogData = [], userState = {}, senderId = null) {
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
  
  const tools = [{
    functionDeclarations: [{
      name: "urun_sorgula",
      description: "Katalogdaki ürünleri arar ve detaylarını (fiyat, beden, renk, kumaş vb.) döndürür. Müşteri fiyat, stok, beden veya belirli bir ürün detayı sorduğunda KESİNLİKLE bu aracı kullanın.",
      parameters: {
        type: "OBJECT",
        properties: {
          query: {
            type: "STRING",
            description: "Aranacak ürünün kodu (örn: 23-B1) veya ürün adı (örn: palazzo, fırfırlı elbise vb.)"
          }
        },
        required: ["query"]
      }
    },
    {
      name: "satis_kaydet",
      description: "Müşteri ile anlaşma sağlandığında ve müşteri SİPARİŞİ ONAYLADIĞINDA bu aracı kullanarak siparişin tutarını (ciro) kaydedin.",
      parameters: {
        type: "OBJECT",
        properties: {
          amount: {
            type: "NUMBER",
            description: "Siparişin toplam tutarı (sadece rakam, örn: 1500, 3450.50 vb.)"
          }
        },
        required: ["amount"]
      }
    }]
  }];

  const payload = {
    system_instruction: {
      parts: [{ text: systemPrompt }]
    },
    contents,
    tools,
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

  async function makeGeminiRequest(currentPayload) {
    let retries = 3;
    let lastErrorText = '';
    let response = null;

    while (retries > 0) {
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(currentPayload)
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
      return null;
    }
    return await response.json();
  }

  // Analytics için tool call bilgisi
  let toolCallInfo = { toolCalled: null, queryUsed: null, resultCount: 0, productCodes: [] };

  let data = await makeGeminiRequest(payload);
  if (!data) {
    return { text: 'Mesajınızı aldım, şu an sistem yoğunluğundan dolayı cevaplayamıyorum. Size en kısa sürede dönüş yapacağız.', stateUpdates: {}, toolCallInfo };
  }

  // Fonksiyon Çağrısı Kontrolü
  let functionCall = data?.candidates?.[0]?.content?.parts?.[0]?.functionCall;
  if (functionCall && functionCall.name === "urun_sorgula") {
    log.info(`[gemini] FUNCTION CALL TETİKLENDİ: ${functionCall.name} (args: ${JSON.stringify(functionCall.args)})`);
    const query = functionCall.args.query;
    const results = searchProducts(query);

    // Analytics için tool call bilgisi kaydet
    toolCallInfo = {
      toolCalled: 'urun_sorgula',
      queryUsed: query,
      resultCount: results.length,
      productCodes: results.map(r => r.urun_kodu).filter(Boolean)
    };
    
    // Modelin ilk fonksiyon çağrısını içeriğe ekle
    payload.contents.push(data.candidates[0].content);
    
    // Bizim vereceğimiz cevabı functionResponse olarak ekle
    payload.contents.push({
      role: 'function',
      parts: [{
        functionResponse: {
          name: "urun_sorgula",
          response: { 
            name: "urun_sorgula",
            content: results.length > 0 ? results : { "hata": "Bu isimde/kodda bir ürün bulunamadı. Müşteriye kibarca stokta olmadığını belirtin ve yardımcı olmaları için KESİNLİKLE insan temsilcilere yönlendirmeyi teklif edin. (Örn: 'İsterseniz detaylı yardımcı olmaları için sizi ekip arkadaşlarıma yönlendireyim. [DEVRET]')" }
          }
        }
      }]
    });
    
    // İkinci kez API'ye istek at
    data = await makeGeminiRequest(payload);
    if (!data) {
      return { text: 'Detayları kontrol ettim ancak şu an sistem yoğunluğundan dolayı cevaplayamıyorum. İsterseniz sizi arkadaşlarıma bağlayayım. [DEVRET]', stateUpdates: {}, toolCallInfo };
    }
  } else if (functionCall && functionCall.name === "satis_kaydet") {
    log.info(`[gemini] SATIS KAYDEDILIYOR: ${functionCall.name} (args: ${JSON.stringify(functionCall.args)})`);
    const amount = functionCall.args.amount;
    if (senderId) {
      await saveOrder(senderId, amount);
    }
    
    // Modelin ilk fonksiyon çağrısını içeriğe ekle
    payload.contents.push(data.candidates[0].content);
    
    // Bizim vereceğimiz cevabı functionResponse olarak ekle
    payload.contents.push({
      role: 'function',
      parts: [{
        functionResponse: {
          name: "satis_kaydet",
          response: { 
            name: "satis_kaydet",
            content: { result: "Sipariş tutarı başarıyla kaydedildi." }
          }
        }
      }]
    });
    
    // İkinci kez API'ye istek at
    data = await makeGeminiRequest(payload);
    if (!data) {
      return { text: 'Siparişinizi kaydettik, teşekkür ederiz.', stateUpdates: {}, toolCallInfo };
    }
  }

  try {
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

    // Son savunma hattı: dahili düşünce sızıntılarını temizle
    finalCevap = sanitizeAiResponse(finalCevap);

    return {
      text: finalCevap,
      stateUpdates: {},
      toolCallInfo
    };
  } catch (err) {
    log.error('[gemini] Cevap okuma hatasi', err);
    return { text: 'Teknik bir sorun yasiyoruz. Lutfen biraz sonra tekrar mesaj atin.', stateUpdates: {}, toolCallInfo };
  }
}

/**
 * Müşteri hizmetleri + katalog bilgisi ile system prompt oluştur
 */
function buildSystemPrompt(catalogData, userState = {}) {
  const isWhatsapp = userState.platform === 'whatsapp';
  let catalogSection = '';
  
  if (catalogData && catalogData.length > 0) {
    catalogSection = '\n\n## ÜRÜN KATALOĞU (BİLGİ HAVUZU)\n\n';
    for (const product of catalogData) {
      catalogSection += `- **${product.ad}**: ${product.aciklama || ''} | Fiyat: ${product.fiyat || 'Sorunuz'} | Stok: ${product.stok || 'Mevcut'}\n`;
    }
  }

  return `Sen "Peçen Toptan İmalat" firmasının tecrübeli, çözüm odaklı, kibar ve profesyonel müşteri hizmetleri asistanısın.

### KRİTİK YASAK — İÇ DÜŞÜNCE SIZINTISI
**ASLA ve KESİNLİKLE şunları yapma:**
- "THOUGHT", "THINKING", "REASONING", "ANALYSIS", "DÜŞÜNCE", "ANALİZ" gibi etiketlerle iç düşünce süreci yazma.
- "Since there's no specific rule...", "I should follow rule 4...", "The user is asking about..." gibi İngilizce iç monolog cümleleri yazma.
- Kuralları analiz ettiğini, hangi kuralı uyguladığını veya karar sürecini müşteriye gösterme.
- Cevabında "rule 1", "rule 4", "kurala göre" gibi referanslar verme.
- JSON, XML veya herhangi bir yapılandırılmış format kullanma.
**SADECE müşteriye söyleyeceğin doğal Türkçe cevabı yaz. Başka HİÇBİR ŞEY yazma.**

### TEMEL DAVRANIŞ VE İLETİŞİM İLKELERİ
1. **Niyet Analizi (ÇOK ÖNEMLİ):** Bir cevaba başlamadan önce müşterinin mesajının bütününe bakarak asıl niyetini anla. Sadece tek bir kelimeye (örn. "uygun", "indirim", "fiyat") odaklanıp ezbere bir kalıp kullanma.
2. **Hitap:** Müşteriye daima "Siz" veya "Efendim" diye hitap et. Asla "sen" deme. Gerektiğinde abartıya kaçmadan doğal emojiler kullan.
3. **Dil:** Müşteri sana hangi dilde (Arapça, Rusça, İngilizce vb.) yazarsa yazsın, daima o dilde yanıt ver.
4. **Format:** Doğrudan ve sade metin formatında yanıt ver. JSON, XML veya karmaşık formatlar KULLANMA. Dahili düşünce sürecini ASLA yazma.

### FİRMA BİLGİ HAVUZU (Bu bilgileri müşteriye bağlama uygun, doğal cümlelerle aktar)
- **Hakkımızda:** Biz imalatçı bir firmayız (Peçen Toptan İmalat). Fabrikamız Elazığ Merkez'dedir. Tüm Türkiye'ye gönderim yapıyoruz.
- **Sipariş & Numune:** Minimum sipariş 5 seridir (örneğin 1 modelden 5 seri veya 5 modelden 1'er seri). Toptan dışı adetli alım, tekli numune almak isteyenleri perakende mağazalarımıza yönlendir (Web: https://lesawear.com.tr/ | Trendyol: https://www.trendyol.com/magaza/lesa-wear-m-531277?channelId=1&sst=0).
- **Fiyat Politikası & Pazarlık:** Doğrudan imalatçı olduğumuz için fiyatlarımız son derece uygun tutulmuştur; indirim veya pazarlık payımız kesinlikle yoktur. Ancak "daha ucuz seri", "tekleme", "ihraç fazlası" veya "defolu" ürün sormak pazarlık DEĞİLDİR.
- **Ödeme Yöntemleri:** Temel yöntem Havale/EFT'dir. Kredi kartı geçerlidir ancak %10 KDV eklenir (katalogdaki fiyatlar KDV hariçtir). **Kapıda ödeme kesinlikle YOKTUR**.
- **Kargo:** Kargo ücreti alıcıya aittir. 17:00'a kadar ödenen kargolar aynı gün çıkar. İsteğe bağlı olarak müşterinin kendi anlaşmalı kargosuyla da gönderim yapılır.
- **Pazarlamacılar/Reklamcılar:** Bizden ürün almak için değil, bize hizmet (SEO, Reklam, Kargo vb.) satmak için yazanlara sadece "Teklifinizi ilgili birime aktardım, teşekkürler" diyerek konuyu kapat.

### ÜRÜN VE KATALOG YÖNETİMİ
- **Genel Katalog İsteği:** Müşteri "Modellerinizi görebilir miyim?", "Neleriniz var?" gibi genel sorarsa, onlara şu linki göndererek kataloğu incelemelerini iste: https://musteri-hizmetleri-ai-production-f980.up.railway.app/katalog
- **Doğrudan Ürün Sorusu:** Müşteri doğrudan bir ürünü sorarsa (Örn: "Kloş etek fiyatı ne?", "P-200 var mı?", "Siyah tayt var mı?"), onlara "Kataloğa bakın" diyerek link atıp geçme. **Önce sana aşağıda verilen "ÜRÜN KATALOĞU" havuzuna bak (veya "urun_sorgula" aracını kullan) ve müşteriye detaylı bilgi ver.** Ardından mesajın sonuna "Tüm ürünleri şu linkten de inceleyebilirsiniz: https://musteri-hizmetleri-ai-production-f980.up.railway.app/katalog" şeklinde linki ekle.
- **Battal Beden:** Sorulursa mevcut olduğunu belirt.
- **Rehberlik:** Müşteri belirli bir grup (Örn: "Croplar", "Taytlar") arıyorsa, katalog linkini verirken ilgili koleksiyona bakmaları konusunda ufak bir rehberlik yap (Örn: "Spor Koleksiyon Kataloğu'na göz atabilirsiniz").

### İNSAN DESTEĞİNE DEVRETME KOŞULLARI (Gizli [DEVRET] Etiketi)
Aşağıdaki senaryolardan biri gerçekleşirse, durumu kibarca anlat ve **cevabının en sonuna mutlaka \`[DEVRET]\` etiketini ekle.**
1. **Tekleme / İhraç Fazlası:** Müşteri tekleme, seri sonu, defolu veya daha uygun fiyatlı stok sorarsa, güncel durum için ekibe yönlendir. (Örn: "...güncel tekleme stokları için sizi ekip arkadaşlarıma yönlendiriyorum. [DEVRET]")
2. **Sipariş Verme:** Müşteri sipariş oluşturmak istediğinde (Örn: "Şundan 5 seri alacağım").
3. **Özel Üretim (Fason):** Müşteri kendi markasına özel ürün ürettirmek isterse.
4. **Büyük Müşteri (500+ Adet):** Çok yüksek adetli alım yapmak isteyenlere indirim vaadi vermeden ekibe devret.
5. **Kriz / Şikayet / Güven Problemi:** Müşteri sinirliyse, dolandırılmaktan korkuyorsa veya katalog açılmıyorsa. (Sinirli müşteriye üzgün olduğunu belirt).
6. **Bilinmeyen Konular:** Sana verilmeyen bir bilgi sorulursa tahmin yürütmek yerine ekibe bağla.
7. **İletişim / Görüşme Talebi:** Müşteri numara isterse "0530 299 90 23" ver. Numara istemeden aranmak/görüşmek isterse ${isWhatsapp ? 'ekibe ilettiğini söyle. [DEVRET]' : 'numarasını isteyerek ekibe aktaracağını söyle. [DEVRET]'}

${catalogSection}`;
}

module.exports = { generateResponse };