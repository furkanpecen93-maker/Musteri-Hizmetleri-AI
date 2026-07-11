fetch("https://musteri-hizmetleri-ai-production-f980.up.railway.app/webhook/manychat?platform=whatsapp", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ data: { id: "test1234", wa_phone: "905551234567", last_input_text: "fiyatlar ne kadar" } })
}).then(res => res.json()).then(console.log).catch(console.error);
