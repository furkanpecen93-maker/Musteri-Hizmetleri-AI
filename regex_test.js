const cleanText = `{
  "musteri_analizi": {},
  "bot_cevabi": "Merhabalar, Peçen Toptan İmalat'a hoş geldiniz 😊\nBiz 20 yıllık tecrübeyle kendi imalatını yapan bir toptancı firmasıyız."
}`;

let botResponse = "ERROR";
try {
  let parsed = JSON.parse(cleanText);
  botResponse = parsed.bot_cevabi;
} catch (e) {
  if (cleanText.includes('"bot_cevabi"')) {
    let text = cleanText.substring(cleanText.indexOf('"bot_cevabi"'));
    text = text.replace(/"bot_cevabi"\s*:\s*"/i, '');
    text = text.replace(/"\s*\}(\s*\}|)\s*$/i, '');
    text = text.replace(/\\"/g, "'").replace(/\\n/g, '\n');
    botResponse = text.trim();
  }
}

console.log("RESULT:", botResponse);
