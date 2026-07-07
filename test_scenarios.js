const { generateResponse } = require('./services/gemini');

const scenarios = [
  { name: "1. Genel Ürün İsteği", input: "Ürünlerinizi görebilir miyim?" },
  { name: "2. Renk/Beden/Fiyat Detay", input: "Bu modelin kırmızısı var mı? M bedeni ne kadar?" },
  { name: "3. Katalog Link Sorunu", input: "Attığınız link açılmadı, göremedim." },
  { name: "4. Bilinmeyen Konu", input: "Şirketiniz ne zaman kuruldu, kurucunuzun adı nedir?" },
  { name: "5. Ödeme (Kredi Kartı)", input: "Kredi kartı geçiyor mu acaba, kullanabilir miyiz?" },
  { name: "6. Minimum Sipariş (MOQ)", input: "Minimum kaç adet almalıyız?" },
  { name: "7. Perakende / Numune (1 Adet)", input: "Ben toptan değil de 1 adet numune görmek istiyorum alabilir miyim?" },
  { name: "8. Konum / Lokasyon", input: "Yeriniz tam olarak neresi, hangi şehirdesiniz?" },
  { name: "9. Kargo Ücreti", input: "Kargoyu kim karşılıyor, kargo ücreti var mı?" },
  { name: "10. Sinirli / Yapay Zeka İstemeyen", input: "Ben robotla konuşmak istemiyorum, derhal beni gerçeğe bağla!" },
  { name: "11. Güven Problemi", input: "Sizin dolandırıcı olmadığınızı nereden bileyim, size nasıl güveneceğim?" },
  { name: "12. Başka Ürün Sorusu", input: "Katalogdakiler dışında başka ürün yok mu?" },
  { name: "13. Yüksek Adetli Alım", input: "Merhaba, ben 1000 adetlik büyük bir sipariş vermek istiyorum." },
  { name: "14. Özel Üretim / Fason", input: "Kendi markama ürün ürettirmek istiyorum, şu modeli yapar mısınız?" },
  { name: "15. Pazarlık / Fiyat Yüksek", input: "Fiyatlarınız çok yüksekmiş, bize biraz indirim yapmaz mısınız?" }
];

async function runAllTests() {
  console.log("=== OTONOM TEST BAŞLIYOR ===\n");
  const results = [];
  
  for (let i = 0; i < scenarios.length; i++) {
    const s = scenarios[i];
    console.log(`Test ${i+1}/${scenarios.length}: ${s.name} ...`);
    try {
      const response = await generateResponse(s.input, [], [], { hasAskedLocation: true });
      results.push(`## ${s.name}\n**Müşteri:** ${s.input}\n**Bot:** ${response.text}\n`);
    } catch (e) {
      results.push(`## ${s.name}\n**Müşteri:** ${s.input}\n**Bot:** [HATA] ${e.message}\n`);
    }
    // Rate limit'e takılmamak için kısa bir bekleme
    await new Promise(resolve => setTimeout(resolve, 1500));
  }

  const fs = require('fs');
  fs.writeFileSync('test_raporu.md', results.join('\n'));
  console.log("\n=== OTONOM TEST TAMAMLANDI ===");
  console.log("Sonuçlar 'test_raporu.md' dosyasına kaydedildi.");
}

runAllTests();
