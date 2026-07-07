const { generateResponse } = require('./services/gemini');

async function runTests() {
  console.log("=== TEST 1: Genel Katalog İsteği ===");
  const res1 = await generateResponse("Katalog atar mısınız?", [], [], { platform: 'instagram' });
  console.log("Cevap:", res1.text);
  console.log("------------------------------------\n");

  console.log("=== TEST 2: Özel Ürün Sorgusu (Fiyat) ===");
  const res2 = await generateResponse("23-B1 ürününün fiyatı ne kadar?", [], [], { platform: 'instagram' });
  console.log("Cevap:", res2.text);
  console.log("------------------------------------\n");

  console.log("=== TEST 3: Özel Ürün Sorgusu (Beden) ===");
  const res3 = await generateResponse("P-200 eşofmanın stokta xl bedeni var mı?", [], [], { platform: 'instagram' });
  console.log("Cevap:", res3.text);
  console.log("------------------------------------\n");
}

runTests().catch(console.error);
