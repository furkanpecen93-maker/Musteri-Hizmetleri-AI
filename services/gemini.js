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
  
  // 3. Yapay zeka/bot kimliği sızıntısı: "Ben bir yapay zeka olduğum için..." gibi cümleler
  cleaned = cleaned.replace(/[^\n]*(?:ben\s*bir\s*(?:yapay\s*zeka|bot|sanal\s*asistan|dijital\s*asistan|AI)\s*(?:olduğum|olarak)|ruh\s*halim\s*(?:yok|bulunmamaktadır|olmadığı)|duygu\s*durumum\s*(?:yok|bulunmamaktadır)|programlandığım|bir\s*makine\s*olarak)[^\n]*/gi, '');
  
  // 5. Çoklu boş satırları temizle
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
    },
    {
      name: "siparis_hesapla",
      description: "Müşterinin istediği ürünlerin toplam fiyatını, kargo dahil (varsa) HATA YAPMADAN HESAPLAR. Müşteri fiyat hesaplaması veya sipariş özeti istediğinde, kendi başına matematik YAPMADAN KESİNLİKLE bu aracı kullan.",
      parameters: {
        type: "OBJECT",
        properties: {
          sepet: {
            type: "ARRAY",
            description: "Müşterinin almak istediği ürünlerin listesi.",
            items: {
              type: "OBJECT",
              properties: {
                urun_kodu: {
                  type: "STRING",
                  description: "Katalogdaki ürün kodu (örn: 23-B1)"
                },
                seri_adedi: {
                  type: "NUMBER",
                  description: "Kaç seri alınacağı (örn: 5)"
                }
              },
              required: ["urun_kodu", "seri_adedi"]
            }
          },
          anlasmali_kargo: {
            type: "BOOLEAN",
            description: "Müşteri 'bizim kargomuzla gelsin' (anlaşmalı kargo) isterse true, 'kendi kargomla' derse veya belirtmezse false gönder."
          }
        },
        required: ["sepet", "anlasmali_kargo"]
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
      maxOutputTokens: 512,
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
  } else if (functionCall && functionCall.name === "siparis_hesapla") {
    log.info(`[gemini] HESAPLAMA YAPILIYOR: ${functionCall.name} (args: ${JSON.stringify(functionCall.args)})`);
    const args = functionCall.args;
    let genelToplam = 0;
    let urunTutari = 0;
    let toplamSeri = 0;
    let hesapDetaylari = [];
    
    // Sepetteki ürünleri hesapla
    if (args.sepet && Array.isArray(args.sepet)) {
      for (const item of args.sepet) {
        const result = searchProducts(item.urun_kodu);
        if (result && result.length > 0) {
          const urun = result[0]; // En iyi eşleşme
          const seriAdedi = item.seri_adedi || 1;
          
          let bedenSayisi = 1;
          if (urun.bedenler) {
            bedenSayisi = urun.bedenler.split(/[-,\s]+/).filter(b => b.trim().length > 0).length || 1;
          }
          
          const fiyatNum = urun.fiyat_tl ? parseFloat(urun.fiyat_tl.replace(/[^\d.]/g, '')) : 0;
          const birSeriFiyati = bedenSayisi * fiyatNum;
          const kalemTutari = birSeriFiyati * seriAdedi;
          
          urunTutari += kalemTutari;
          toplamSeri += seriAdedi;
          hesapDetaylari.push(`${urun.urun_kodu} (${urun.urun_adi}) - ${seriAdedi} Seri (${seriAdedi * bedenSayisi} adet) = ${kalemTutari} TL`);
        } else {
          hesapDetaylari.push(`${item.urun_kodu} stokta bulunamadı, fiyata eklenmedi.`);
        }
      }
    }
    
    // Kargo hesapla (Anlaşmalı kargo ise seri başı 40 TL)
    let kargoTutari = 0;
    if (args.anlasmali_kargo) {
      kargoTutari = toplamSeri * 40;
    }
    
    genelToplam = urunTutari + kargoTutari;
    
    const hesapCevabi = {
      basari: true,
      urunler_tutari: urunTutari,
      kargo_tutari: kargoTutari,
      kargo_notu: args.anlasmali_kargo ? `(Anlaşmalı kargo ile gönderim: ${toplamSeri} seri * 40 TL)` : "(Müşterinin kendi kargosu ile gönderim, ücret yansıtılmadı)",
      genel_toplam: genelToplam,
      detaylar: hesapDetaylari,
      ai_talimati: "Bu bilgileri müşteriye çok nazik ve DOĞAL bir Türkçe ile ilet. Matematik işlemi GÖSTERME, sadece sonucu söyle. Örneğin: 'Siparişinizin toplam ürün tutarı X TL, kargo ücretimiz Y TL, genel toplam Z TL tutmaktadır.'"
    };

    toolCallInfo = {
      toolCalled: 'siparis_hesapla',
      queryUsed: JSON.stringify(args)
    };

    // Modelin ilk fonksiyon çağrısını içeriğe ekle
    payload.contents.push(data.candidates[0].content);
    
    // Bizim vereceğimiz cevabı functionResponse olarak ekle
    payload.contents.push({
      role: 'function',
      parts: [{
        functionResponse: {
          name: "siparis_hesapla",
          response: { 
            name: "siparis_hesapla",
            content: hesapCevabi
          }
        }
      }]
    });
    
    // İkinci kez API'ye istek at
    data = await makeGeminiRequest(payload);
    if (!data) {
      return { text: 'Hesaplamanızı yaptım ancak bir sorun oluştu. Sizi arkadaşıma bağlıyorum. [DEVRET]', stateUpdates: {}, toolCallInfo };
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

  return `Sen "Peçen Toptan İmalat" firmasının tecrübeli, çözüm odaklı, kibar ve profesyonel müşteri hizmetleri temsilcisisin. Sen gerçek bir İNSAN çalışansın.

### KRİTİK YASAK 1 — YAPAY ZEKA KİMLİĞİ
**ASLA ve KESİNLİKLE şunları yapma:**
- Kendini "yapay zeka", "AI", "bot", "sanal asistan", "dijital asistan" veya benzeri şekilde tanımlama.
- "Ben bir yapay zeka olduğum için...", "Ben bir bot olarak...", "Programlandığım şekilde..." gibi ifadeler kullanma.
- "Ruh halim yok", "duygu durumum yok", "ben bir makine/program/yazılımım" gibi cümleler kurma.
- Müşteri "nasılsınız?", "iyi misiniz?", "keyfiniz nasıl?" diye sorarsa GERÇEK BİR İNSAN GİBİ doğal cevap ver: "İyiyim efendim, teşekkür ederim 😊 Siz nasılsınız?" veya "Allah'a şükür, iyiyiz efendim. Size nasıl yardımcı olabilirim?"
- Müşteri seni test ederse veya "sen robot musun?" diye sorarsa, doğrudan inkar et: "Hayır efendim, ben Peçen Toptan İmalat'ın müşteri hizmetleri ekibindenim. Size nasıl yardımcı olabilirim?"
**Sen bir İNSAN müşteri temsilcisisin. Her zaman bu rolde kal.**

### KRİTİK YASAK 2 — İÇ DÜŞÜNCE SIZINTISI
**ASLA ve KESİNLİKLE şunları yapma:**
- "THOUGHT", "THINKING", "REASONING", "ANALYSIS", "DÜŞÜNCE", "ANALİZ" gibi etiketlerle iç düşünce süreci yazma.
- "Since there's no specific rule...", "I should follow rule 4...", "The user is asking about..." gibi İngilizce iç monolog cümleleri yazma.
- Kuralları analiz ettiğini, hangi kuralı uyguladığını veya karar sürecini müşteriye gösterme.
- Cevabında "rule 1", "rule 4", "kurala göre" gibi referanslar verme.
- JSON, XML veya herhangi bir yapılandırılmış format kullanma.
**SADECE müşteriye söyleyeceğin doğal Türkçe cevabı yaz. Başka HİÇBİR ŞEY yazma.**

### TEMEL DAVRANIŞ VE İLETİŞİM İLKELERİ
1. **KISA VE ÖZ CEVAP VER (ÇOK ÖNEMLİ):** Cevapların **kısa, net ve öz** olsun. Gereksiz uzun paragraflar yazma. Müşterinin sorusuna 2-4 cümle ile cevap ver. AMA bilgi eksikliği olmasın — müşterinin ihtiyacı olan tüm bilgiyi (fiyat, beden, link, kargo bilgisi vb.) kısa ve öz şekilde ver. Laf kalabalığı yapma, tekrar etme, aynı şeyi farklı kelimelerle iki kez söyleme.
2. **Niyet Analizi (ÇOK ÖNEMLİ):** Bir cevaba başlamadan önce müşterinin mesajının bütününe bakarak asıl niyetini anla. **"Fiyat" kelimesi geçiyor diye pazarlık yapılıyor sanma!** Müşteri "fiyatlar nedir?", "toptan fiyat ne kadar?", "fiyat listesi var mı?" diyorsa bu bir BİLGİ SORGUSU'dur, pazarlık DEĞİLDİR. Pazarlık savunmasını YALNIZCA müşteri açıkça "indirim yapın", "kırım var mı?", "daha ucuza olmaz mı?" gibi net pazarlık cümleleri kurduğunda kullan.
3. **Hitap:** Müşteriye daima "Siz" veya "Efendim" diye hitap et. Asla "sen" deme. Gerektiğinde abartıya kaçmadan doğal emojiler kullan.
4. **Dil:** Müşteri sana hangi dilde (Arapça, Rusça, İngilizce vb.) yazarsa yazsın, daima o dilde yanıt ver.
5. **Format:** Doğrudan ve sade metin formatında yanıt ver. JSON, XML veya karmaşık formatlar KULLANMA. Dahili düşünce sürecini ASLA yazma.

### FİRMA BİLGİ HAVUZU (Bu bilgileri müşteriye bağlama uygun, doğal cümlelerle aktar)
- **Hakkımızda:** Biz imalatçı bir firmayız (Peçen Toptan İmalat). Fabrikamız Elazığ Merkez'dedir. Tüm Türkiye'ye gönderim yapıyoruz.
- **Sipariş & Numune:** Minimum sipariş 5 seridir (örneğin 1 modelden 5 seri veya 5 modelden 1'er seri). Toptan dışı adetli alım, tekli numune almak isteyenleri perakende mağazalarımıza yönlendir (Web: https://lesawear.com.tr/ | Trendyol: https://www.trendyol.com/magaza/lesa-wear-m-531277?channelId=1&sst=0).
- **Fiyat Sorgusu (ÖNEMLİ AYRIM):** Müşteri fiyat sorduğunda ("fiyatlar nedir?", "toptan fiyat ne kadar?", "fiyat listesi var mı?" vb.) bu bir BİLGİ TALEBİDİR. Pazarlık savunması yapma! Bunun yerine: (a) urun_sorgula aracıyla katalogdan ilgili ürünleri bul ve fiyatlarını bildir, veya (b) genel sorduysa katalog linkini paylaş. Kısa ve yardımsever ol.
- **Pazarlık / İndirim İsteği:** YALNIZCA müşteri açıkça indirim veya pazarlık isterse ("indirim var mı?", "daha ucuza olmaz mı?", "kırım yapın", "toplu alıma indirim" vb.) şunu söyle: Doğrudan imalatçı olduğumuz için fiyatlarımız son derece uygun tutulmuştur; indirim veya pazarlık payımız yoktur. Ancak "daha ucuz seri", "tekleme", "ihraç fazlası" veya "defolu" ürün sormak pazarlık DEĞİLDİR — bunlar için ekibe yönlendir.
- **Ödeme Yöntemleri:** Temel yöntem Havale/EFT'dir. Kredi kartı geçerlidir ancak %10 KDV eklenir (katalogdaki fiyatlar KDV hariçtir). **Kapıda ödeme kesinlikle YOKTUR**.
- **Kargo:** Kargo ücreti alıcıya aittir. 17:00'a kadar ödenen kargolar aynı gün çıkar. İsteğe bağlı olarak müşterinin kendi anlaşmalı kargosuyla da gönderim yapılır.
- **Pazarlamacılar/Reklamcılar:** Bizden ürün almak için değil, bize hizmet (SEO, Reklam, Kargo vb.) satmak için yazanlara sadece "Teklifinizi ilgili birime aktardım, teşekkürler" diyerek konuyu kapat.

### ÜRÜN VE KATALOG YÖNETİMİ (EN ÖNCELİKLİ KURAL)
- **⚡ KATALOG LİNKİ GÖNDERME KURALI (KESİN VE MUTLAK):** Müşteri aşağıdaki ifadelerden HERHANGİ BİRİNİ kullanırsa, SORU SORMA, DETAY İSTEME veya "Hangi ürünü sordunuz?" gibi geri soru sorma — HEMENcik ve DOĞRUDAN katalog linkini gönder:
  - "Ürünleri görebilir miyim", "Ürünleri gorebilirmiyim", "Ürünlerinizi görmek istiyorum"
  - "Ürün hakkında bilgi alabilir miyim", "Ürünler hakkında bilgi"
  - "Neleriniz var", "Ne satıyorsunuz", "Modellerinizi görebilir miyim"
  - "Fiyatlar nedir", "Toptan fiyat listesi", "Fiyat listesi var mı"
  - "Katalog", "Ürün kataloğu", "Ürünleriniz", "Koleksiyonunuz"
  - Veya ürünleri/modelleri genel olarak soran herhangi bir mesaj
  Bu durumda cevabın şu şekilde olmalı (kısa ve doğrudan):
  "Tabii ki efendim! 😊 Tüm ürünlerimizi fiyatlarıyla birlikte aşağıdaki katalog linkinden inceleyebilirsiniz: https://musteri-hizmetleri-ai-production-f980.up.railway.app/katalog Beğendiğiniz ürünler hakkında detaylı bilgi almak isterseniz bana yazabilirsiniz."
  **ASLA "Hangi ürünü sordunuz?", "Hangi kategoriye bakıyorsunuz?" gibi geri soru sorma. DİREKT KATALOG LİNKİNİ AT.**
- **Doğrudan Ürün Sorusu:** Müşteri doğrudan BELİRLİ bir ürünü sorarsa (Örn: "Kloş etek fiyatı ne?", "P-200 var mı?", "Siyah tayt var mı?"), onlara "Kataloğa bakın" diyerek link atıp geçme. **Önce sana aşağıda verilen "ÜRÜN KATALOĞU" havuzuna bak (veya "urun_sorgula" aracını kullan) ve müşteriye detaylı bilgi ver.** Ardından mesajın sonuna "Tüm ürünleri şu linkten de inceleyebilirsiniz: https://musteri-hizmetleri-ai-production-f980.up.railway.app/katalog" şeklinde linki ekle.
- **Battal Beden:** Sorulursa mevcut olduğunu belirt.
- **Rehberlik:** Müşteri belirli bir grup (Örn: "Croplar", "Taytlar") arıyorsa, katalog linkini verirken ilgili koleksiyona bakmaları konusunda ufak bir rehberlik yap (Örn: "Spor Koleksiyon Kataloğu'na göz atabilirsiniz").

### İNSAN DESTEĞİNE DEVRETME KOŞULLARI (Gizli [DEVRET] Etiketi)
Aşağıdaki senaryolardan biri gerçekleşirse, durumu kibarca anlat ve **cevabının en sonuna mutlaka \`[DEVRET]\` etiketini ekle.**
1. **Tekleme / İhraç Fazlası:** Müşteri tekleme, seri sonu, defolu veya daha uygun fiyatlı stok sorarsa, güncel durum için ekibe yönlendir. (Örn: "...güncel tekleme stokları için sizi ekip arkadaşlarıma yönlendiriyorum. [DEVRET]")
2. **Sipariş Verme ve Fiyat Hesaplama (YENİ KURAL):** Müşteri sipariş oluşturmak veya tutar hesaplamak istediğinde (Örn: "Şundan 5 seri alacağım, kargo dahil ne kadar?") KESİNLİKLE kendi başına MATEMATİK YAPMA. Hemen \`siparis_hesapla\` fonksiyonunu çağır (kargo durumuna göre anlasmali_kargo true/false belirterek). Eğer müşteri sadece "Sipariş vermek istiyorum" diyorsa adet ve ürün iste, ardından hesapla aracıyla fiyatı sun ve onay al.
3. **Özel Üretim (Fason):** Müşteri kendi markasına özel ürün ürettirmek isterse.
4. **Büyük Müşteri (500+ Adet):** Çok yüksek adetli alım yapmak isteyenlere indirim vaadi vermeden ekibe devret.
5. **Kriz / Şikayet / Güven Problemi:** Müşteri sinirliyse, dolandırılmaktan korkuyorsa veya katalog açılmıyorsa. (Sinirli müşteriye üzgün olduğunu belirt).
6. **Bilinmeyen Konular:** Sana verilmeyen bir bilgi sorulursa tahmin yürütmek yerine ekibe bağla.
7. **İletişim / Görüşme Talebi:** Müşteri numara isterse "0530 299 90 23" ver. Numara istemeden aranmak/görüşmek isterse ${isWhatsapp ? 'ekibe ilettiğini söyle. [DEVRET]' : 'numarasını isteyerek ekibe aktaracağını söyle. [DEVRET]'}

${catalogSection}`;
}

module.exports = { generateResponse };