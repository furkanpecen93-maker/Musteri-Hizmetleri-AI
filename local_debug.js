require('dotenv').config({ path: '../../_knowledge/credentials/master.env' });
const { generateResponse } = require('./services/gemini');

async function runExtendedTestsLocal() {
  console.log("=== LOKAL KAPSAMLI SOHBET TESTİ ===\n");
  const catalog = [{ ad: 'Kloş Etek', aciklama: 'Siyah renk, pamuklu', fiyat: '150 TL', stok: 'Mevcut' }, { ad: 'Tayt', aciklama: 'Toparlayıcı', fiyat: '130 TL', stok: 'Mevcut' }];

  const s = {
      name: "Senaryo 1",
      messages: [
        "Merhaba",
        "İstanbul merter",
        "Siyah toparlayıcı tayt almak istiyorum"
      ]
  };

  let history = [];
  let state = { hasAskedLocation: false, profile: {} };

  for (let i = 0; i < s.messages.length; i++) {
    const userMsg = s.messages[i];
    console.log(`[MÜŞTERİ]: ${userMsg}`);
    try {
      const respObj = await generateResponse(userMsg, history, catalog, state);
      console.log(`[BOT]: ${respObj.text}\n`);
      history.push({ role: 'user', content: userMsg });
      history.push({ role: 'assistant', content: respObj.text });
      if (respObj.stateUpdates) Object.assign(state, respObj.stateUpdates);
    } catch (err) {
      console.log(`[BOT - HATA (Local Throw)]: ${err.stack}\n`);
    }
  }
}

runExtendedTestsLocal();
