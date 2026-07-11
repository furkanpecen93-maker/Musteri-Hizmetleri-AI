// test_sanitize.js — sanitizeAiResponse fonksiyonunun doğrulama testleri

// gemini.js'deki sanitizeAiResponse'u simüle et
function sanitizeAiResponse(text) {
  if (!text || typeof text !== 'string') return text;
  
  let cleaned = text;
  
  // 1. "THOUGHT" / "THINKING" / "REASONING" / "ANALYSIS" bloklarını tamamen sil
  cleaned = cleaned.replace(/(?:^|\n)\s*(?:\[|\*|\()?\s*(?:THOUGHT|THINKING|REASONING|ANALYSIS|DÜŞÜNCE|ANALİZ|İÇ\s*MONOLOG|INTERNAL|NOTE\s*TO\s*SELF|CHAIN\s*OF\s*THOUGHT|COT)\s*(?:\]|\*|\))?\s*[:\-]?\s*[\s\S]*?(?=\n\n|$)/gi, '');
  
  // 2. İngilizce iç monolog cümleleri
  cleaned = cleaned.replace(/(?:^|\n)\s*(?:Since|Because|Let me|I (?:should|need|will|must|think|notice|can see|observe|conclude|decide|am going))\s[^\n]*(?:\n(?!\n)[^\n]*)*/gi, (match) => {
    const internalPatterns = /(?:I should follow|I need to|I will respond|I notice|I can see|Let me think|rule \d|follow rule|direct them|I'm going to|the user is asking|the customer|this is not|based on the rules|according to)/i;
    if (internalPatterns.test(match)) {
      return '';
    }
    return match;
  });
  
  // 3. JSON artifact kalıntıları
  cleaned = cleaned.replace(/(?:^|\n)\s*"?(?:musteri_analizi|niyet|duygu|confidence|intent|sentiment|action_taken)"?\s*[:\=]\s*[^\n]*/gi, '');
  
  // 5. Çoklu boş satırları tek boş satıra indir
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
  
  // 6. Baş ve sondaki boşlukları temizle
  cleaned = cleaned.trim();
  
  // 7. Eğer temizleme sonrası metin tamamen boşaldıysa, fallback döndür
  if (!cleaned || cleaned.length < 5) {
    return 'Mesajınızı aldım efendim. Sizi ilgili ekip arkadaşlarıma yönlendiriyorum, en kısa sürede size dönüş yapacaklar.';
  }
  
  return cleaned;
}

// ═══ TEST CASES ═══
const tests = [
  {
    name: "Ekran görüntüsündeki gerçek hata — THOUGHT bloğu",
    input: `Ödeme yöntemlerimiz Havale/EFT şeklindedir efendim.

THOUGHT
The user is asking about the return policy. This is not explicitly covered by the provided rules, but rule 4 states: "Eğer müşterinin sorduğu konu hakkında bir bilgin yoksa, onlara mutlaka 'Sizi ilgili ekip arkadaşlarıma yönlendireyim, müsaitseniz görüntülü veya sesli arama yapmaları için randevu oluşturalım mı? ' diyerek randevu teklif et." Since there's no specific rule for returns, I should follow rule 4 and direct them to a human.`,
    expectedContains: "Ödeme yöntemlerimiz Havale/EFT",
    expectedNotContains: ["THOUGHT", "rule 4", "I should follow"]
  },
  {
    name: "THOUGHT: formatı",
    input: `Merhaba efendim, nasıl yardımcı olabilirim?

THOUGHT: The customer seems to be asking about prices. I need to check the catalog.`,
    expectedContains: "Merhaba efendim",
    expectedNotContains: ["THOUGHT", "I need to check"]
  },
  {
    name: "[THINKING] formatı",
    input: `[THINKING] Let me think about what the user wants. I should follow rule 2.

Tabii efendim, ürünlerimizin fiyatlarını size hemen ileteyim.`,
    expectedContains: "ürünlerimizin fiyatlarını",
    expectedNotContains: ["THINKING", "Let me think"]
  },
  {
    name: "Sadece İngilizce iç monolog",
    input: `Toptan satış yapmaktayız efendim. Since there's no minimum order mentioned, I should follow rule 3 and tell the customer about minimum orders. Minimum siparişimiz 5 seridir.`,
    expectedContains: "Toptan satış",
    expectedNotContains: ["Since there's", "I should follow"]
  },
  {
    name: "Temiz metin — dokunulmamalı",
    input: `Merhaba efendim, Peçen Toptan İmalat olarak 22 yıldır hizmet vermekteyiz. Size nasıl yardımcı olabiliriz?`,
    expectedContains: "Merhaba efendim",
    expectedNotContains: []
  },
  {
    name: "JSON kalıntısı — musteri_analizi",
    input: `Tabii efendim, palazzo pantolonlarımız mevcuttur.
"musteri_analizi": "Müşteri ürün arıyor"
"niyet": "satın alma"`,
    expectedContains: "palazzo pantolonlarımız",
    expectedNotContains: ["musteri_analizi", "niyet"]
  },
  {
    name: "Tamamen THOUGHT — fallback dönmeli",
    input: `THOUGHT
The user is asking about something I don't know. I should direct them to a human agent according to rule 6.`,
    expectedContains: "ekip arkadaşlarıma",
    expectedNotContains: ["THOUGHT", "rule 6"]
  }
];

let passed = 0;
let failed = 0;

for (const test of tests) {
  const result = sanitizeAiResponse(test.input);
  let testPassed = true;
  let failReasons = [];
  
  if (test.expectedContains && !result.includes(test.expectedContains)) {
    testPassed = false;
    failReasons.push(`Beklenen metin bulunamadı: "${test.expectedContains}"`);
  }
  
  for (const notExpected of (test.expectedNotContains || [])) {
    if (result.includes(notExpected)) {
      testPassed = false;
      failReasons.push(`İstenmeyen metin bulundu: "${notExpected}"`);
    }
  }
  
  if (testPassed) {
    console.log(`✅ GEÇTI: ${test.name}`);
    passed++;
  } else {
    console.log(`❌ BAŞARISIZ: ${test.name}`);
    for (const reason of failReasons) {
      console.log(`   → ${reason}`);
    }
    console.log(`   → Sonuç: "${result}"`);
    failed++;
  }
}

console.log(`\n════════════════════════════`);
console.log(`Toplam: ${tests.length} | Geçen: ${passed} | Başarısız: ${failed}`);
if (failed === 0) {
  console.log('🎉 TÜM TESTLER GEÇTİ!');
} else {
  console.log('⚠️ BAZI TESTLER BAŞARISIZ!');
}
