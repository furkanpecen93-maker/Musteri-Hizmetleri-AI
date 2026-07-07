const { generateResponse } = require('./services/gemini');

async function runTests() {
  console.log("TEST 1: Müşteri kataloğa giremediğini söylüyor (link hatası)");
  
  const history = [
    { role: 'user', content: 'Merhaba' },
    { role: 'assistant', content: 'Merhabalar, Peçen Toptan İmalat\'a hoş geldiniz 😊 Biz 20 yıllık tecrübeyle kendi imalatını yapan bir toptancı firmasıyız. Siz nerede satış yapıyorsunuz acaba?' },
    { role: 'user', content: 'İstanbul. Fiyatlar nedir?' },
    { role: 'assistant', content: 'Memnun olduk 😊 Sizlere detaylı kataloğumuzu iletiyorum, modellerimizi inceleyebilirsiniz: https://musteri-hizmetleri-ai-production-f980.up.railway.app/katalog' }
  ];

  const userMessage = "Linke bağlanamadım, katalog açılmıyor hata veriyor";
  
  try {
    const response = await generateResponse(userMessage, history, [], { hasAskedLocation: true });
    console.log("Yapay Zeka Yanıtı:");
    console.log("------------------");
    console.log(response.text);
    console.log("------------------");
    
    // Satır başı kontrolü
    if (response.text.includes('\n') || response.text.includes('\r')) {
      console.error("HATA: Yanıtta satır başı (\\n veya \\r) tespit edildi!");
    } else {
      console.log("BAŞARILI: Yanıtta hiçbir satır başı yok (Tek parça).");
    }
    
    // İçerik kontrolü
    if (response.text.toLowerCase().includes("ekip") || response.text.toLowerCase().includes("iletiyorum")) {
      console.log("BAŞARILI: Mesaj başarılı bir şekilde insana devredildi.");
    } else {
      console.warn("DİKKAT: Mesaj insana devredilmiş gibi görünmüyor. Çıktıyı kontrol edin.");
    }
  } catch (error) {
    console.error("Test sırasında hata:", error);
  }
}

runTests();
