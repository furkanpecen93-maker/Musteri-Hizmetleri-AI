# ManyChat Instagram Yapay Zeka Entegrasyon Rehberi

Bu rehber, Instagram DM'lerinizi hiçbir onay süreci olmadan sunucumuzdaki Yapay Zeka (Gemini) motoruna bağlamak için ManyChat üzerinde yapmanız gereken adımları içerir.

---

## 1. Hazırlık ve Bağlantı
1. [ManyChat.com](https://manychat.com) adresine gidin ve bir hesap oluşturun.
2. Yönlendirmeleri takip ederek **Instagram Profesyonel (İşletme)** hesabınızı ManyChat'e bağlayın. (Saniyeler içinde otomatik olarak bağlanacaktır).

---

## 2. Otomasyon Akışının (Flow) Oluşturulması
1. ManyChat sol menüsünden **Automation** (Otomasyon) sekmesine gidin.
2. Sağ üstteki **"New Flow"** (Yeni Akış) butonuna tıklayın.
3. Açılan şablonlardan **"Start from Scratch"** (Sıfırdan Başla) seçeneğini seçin.

---

## 3. Tetikleyici (Trigger) Tanımlama
Müşteriler mesaj attığında bu akışın çalışması için tetikleyici ekleyeceğiz:
1. **"Add Trigger"** butonuna tıklayın.
2. Listeden **"Instagram"** altındaki **"User sends a direct message"** (Kullanıcı mesaj gönderir) seçeneğini seçin.
3. Seçeneklerde **"Message contains"** yerine **"Every message"** (Her mesaj) veya **"Default Reply"** (Varsayılan Yanıt) olarak ayarlayın. Böylece her mesaj sunucumuza iletilir.

---

## 4. Yapay Zeka İstek Kartının Eklenmesi (External Request)
1. Tetikleyiciden sonraki adıma (yeşil yuvarlağı sürükleyerek) yeni bir kart ekleyin ve listeden **"Action"** (Eylem) seçeneğini seçin.
2. Sol paneldeki eylem listesinden **"External Request"** (Harici İstek) seçeneğini seçin. (Not: Bu özellik ManyChat Pro sürümü gerektirebilir).
3. **External Request Ayarlarını Yapılandırın:**
   * **Request Type:** `POST` yapın.
   * **Request URL:** `https://musteri-hizmetleri-ai-production-f980.up.railway.app/webhook/manychat?platform=instagram` yazın. (Not: WhatsApp için `?platform=whatsapp` kullanabilirsiniz).
   * **Headers (Başlıklar):**
     * Key: `Content-Type` | Value: `application/json` ekleyin.
   * **Body (Gönderilecek Veri):**
     * **"Full Contact Data"** (veya **"Full Subscriber Data"**) seçeneğini işaretleyin.
     * *(Not: "Custom JSON" seçeneği yerine "Full Contact Data" seçilmesi, ManyChat test simülatöründeki "Variables are not defined" hatasını kalıcı olarak önler. Sunucumuz bu formattaki veriyi de okuyacak hibrit desteğe zaten sahiptir, bu nedenle ek bir sunucu değişikliği gerekmez).*
   * **Response:**
     * En üstteki **"Dynamic Block"** switch'ini (açma/kapama düğmesini) aktif edin. (Bu sayede sunucumuzun döndüğü yapay zeka cevabı otomatik olarak kullanıcıya mesaj olarak iletilir).
   * **Test:**
     * Sağ alttaki **"Test Request"** butonuna tıklayarak sunucumuzla olan bağlantıyı test edebilirsiniz. Başarılı ise `Dynamic Block parsed successfully` uyarısı alırsınız.

---

## 5. Akışı Canlıya Alma
1. Sağ üst köşedeki mavi **"Publish"** (Yayınla) butonuna tıklayın.
2. Tebrikler! Instagram hesabınız artık tamamen yapay zeka entegrasyonuna bağlandı.

Herhangi bir yabancı hesap Instagram'dan mesaj attığı an ManyChat bunu sunucumuza gönderecek, Gemini cevabı üretecek ve anında müşteriye yanıt olarak dönecektir.
