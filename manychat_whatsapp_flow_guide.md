# ManyChat WhatsApp Yapay Zeka Entegrasyon Rehberi

Bu rehber, WhatsApp Business hesabınızı ManyChat üzerinden sunucumuzdaki Yapay Zeka (Gemini) motoruna bağlamak için yapmanız gereken adımları içerir.

> **Not:** Instagram entegrasyonu için ayrıca [manychat_flow_guide.md](./manychat_flow_guide.md) dosyasına bakın.

---

## 1. Ön Koşullar

- **WhatsApp Business API** erişimi (Meta Business Suite üzerinden)
- **ManyChat Pro** hesabı (External Request özelliği Pro gerektirir)
- WhatsApp Business numaranızın ManyChat'e bağlı olması

---

## 2. ManyChat'e WhatsApp Bağlama

1. [ManyChat.com](https://manychat.com) hesabınıza giriş yapın.
2. Sol menüden **Settings** (Ayarlar) → **Channels** (Kanallar) bölümüne gidin.
3. **WhatsApp** kanalını seçin ve **Connect** (Bağla) butonuna tıklayın.
4. Meta Business Suite hesabınızla yetkilendirme yapın.
5. Bağlamak istediğiniz WhatsApp Business numarasını seçin.
6. Bağlantı tamamlandığında yeşil ✅ işareti göreceksiniz.

---

## 3. Otomasyon Akışının (Flow) Oluşturulması

1. Sol menüden **Automation** (Otomasyon) sekmesine gidin.
2. Sağ üstteki **"New Flow"** (Yeni Akış) butonuna tıklayın.
3. **"Start from Scratch"** (Sıfırdan Başla) seçeneğini seçin.

---

## 4. Tetikleyici (Trigger) Tanımlama

1. **"Add Trigger"** butonuna tıklayın.
2. Listeden **"WhatsApp"** altındaki **"A contact sends a message"** seçeneğini seçin.
3. Koşulu **"Any message"** (Her mesaj) veya **"Default Reply"** olarak ayarlayın.
   - Bu sayede her gelen WhatsApp mesajı sunucumuza iletilir.

---

## 5. Yapay Zeka İstek Kartının Eklenmesi (External Request)

1. Tetikleyiciden sonraki adıma yeni bir kart ekleyin → **"Action"** (Eylem) seçin.
2. Eylem listesinden **"External Request"** (Harici İstek) seçin.
3. **External Request ayarları:**

   | Ayar | Değer |
   |------|-------|
   | **Request Type** | `POST` |
   | **Request URL** | `https://musteri-hizmetleri-ai-production-f980.up.railway.app/webhook/manychat?platform=whatsapp` |
   | **Headers** | `Content-Type: application/json` |
   | **Body** | ✅ **"Full Contact Data"** seçin |
   | **Response** | ✅ **"Dynamic Block"** switch'ini aktif edin |

   > **ÖNEMLİ:** URL'deki `?platform=whatsapp` parametresi kritiktir. Bu parametre sunucumuza mesajın WhatsApp'tan geldiğini bildirir.

4. **"Test Request"** butonuyla bağlantıyı test edin → `Dynamic Block parsed successfully` mesajı almalısınız.

---

## 6. Akışı Canlıya Alma

1. Sağ üst köşedeki **"Publish"** (Yayınla) butonuna tıklayın.
2. Tebrikler! WhatsApp Business hesabınız artık yapay zeka entegrasyonuna bağlandı.

---

## Instagram ile Farklar

| Özellik | Instagram | WhatsApp |
|---------|-----------|----------|
| Trigger | "User sends a direct message" | "A contact sends a message" |
| URL parametresi | `?platform=instagram` | `?platform=whatsapp` |
| Karakter limiti | 1000 karakter | 4096 karakter |
| Proaktif mesaj | Mümkün (24h penceresi) | ManyChat API ile mümkün |

---

## Sorun Giderme

- **"Variables are not defined" hatası:** Body ayarlarında "Custom JSON" yerine "Full Contact Data" seçili olduğundan emin olun.
- **Mesajlar gelmiyor:** ManyChat'te WhatsApp kanalının bağlı ve aktif olduğunu kontrol edin.
- **Bot cevap vermiyor:** `?platform=whatsapp` parametresinin URL'de olduğundan emin olun.
- **Grup mesajları:** ManyChat WhatsApp entegrasyonu grup mesajlarını zaten filtreliyor, ekstra bir şey yapmanıza gerek yok.
