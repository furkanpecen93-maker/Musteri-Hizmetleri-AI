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
 * Satıcı kişiliği + katalog bilgisi ile system prompt oluştur
 */
function buildSystemPrompt(catalogData, userState = {}) {
  let catalogSection = '';
  
  if (catalogData && catalogData.length > 0) {
    catalogSection = '\n\n## ÜRÜN KATALOĞU\n\n';
    for (const product of catalogData) {
      catalogSection += `- **${product.ad}**: ${product.aciklama || ''} | Fiyat: ${product.fiyat || 'Sorunuz'} | Stok: ${product.stok || 'Mevcut'}\n`;
    }
  }

  let locationRule = '';
  if (!userState.hasAskedLocation) {
    locationRule = `
- İlk Karşılama ve Lokasyon Kontrolü: Müşteri sohbete ilk defa yazıyorsa (sadece selam verse bile), onu çok sıcak ve samimi bir esnaf ağzıyla karşıla (örn: "Merhabalar, Peçen Toptan İmalat'a hoş geldiniz 😊") ve BİR KEREYE MAHSUS cümlenin sonuna şu soruyu ekle: "Nerede satış yapıyorsunuz acaba?". BUNUN DIŞINDA BİLGİ VERME VEYA KATALOG ATMA, CEVABI BEKLE.
- Tekrar Yasağı (ÇOK KRİTİK KURAL): "Nerede satış yapıyorsunuz acaba?" sorusunu tüm sohbet boyunca SADECE VE SADECE 1 KEZ sorabilirsin. Müşteri bu soruya cevap vermese bile, konuyu değiştirse bile, sohbetin ilerleyen kısımlarında bu soruyu ASLA TEKRAR SORMA! Her cümlenin sonuna nokta koyar gibi bu soruyu ekleme, bu kesinlikle YASAKTIR. Sadece bir kere sor, cevap vermezse konuyu uzatma ve müşterinin girdiği konudan devam et.`;
  }

  let auditRule = '';
  if (userState.auditFeedback) {
    auditRule = `\n\n# MÜFETTİŞİN SANA GİZLİ TAVSİYESİ (ÇOK ÖNEMLİ)\nSatış müdürümüz önceki mesajlarını okudu ve sana şu talimatı veriyor: "${userState.auditFeedback}". Bir sonraki cevabını KESİNLİKLE bu tavsiyeye uygun şekilde şekillendir!`;
  }

  return `# 0. YANIT FORMATI
Bana KESİNLİKLE düz metin olarak cevap vereceksin. Hiçbir şekilde JSON, XML veya benzeri bir format KULLANMA. Doğrudan müşteriye gidecek mesajı yaz.
- BİRİNCİ KURAL (ÇOK KRİTİK): ASLA JSON FORMATI KULLANMA. Müşteriye söyleyeceğin cevabı doğrudan DÜZ METİN olarak yaz. Herhangi bir kod bloğu, anahtar kelime, "bot_cevabi" vb. ASLA KULLANMA.
- İKİNCİ KURAL: "tahmini_bütçe", "kısa_not" gibi hayali raporlar veya notlar KESİNLİKLE YAZMA. Sadece gerçek bir esnaf gibi müşteriye cevap ver.`;
}

module.exports = { generateResponse };