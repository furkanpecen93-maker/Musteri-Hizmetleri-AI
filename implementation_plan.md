# Implementation Plan

## Hedef
Botun mesajlarının neden yarıda kesildiğini kesin olarak tespit etmek ve onaylı bir çözüm üretmek.

## Sorun Analizi & İhtimaller
Kullanıcının şikayeti: "Mesajlar eksik gidiyor, tahmini bütçe filan diyor, SIFIRLA çalışmıyor, neden?"

Tüm ihtimalleri değerlendiriyorum:

1. **Yapay Zekanın Json Kalıntıları Üretmesi (Tahmini Bütçe vs):**
   - **Neden oldu:** Dün sisteme test için koyulan "müşteri analizini json formatında yap" kuralı, kullanıcının WhatsApp mesaj geçmişinde (Memory) kaldı. Bot bu geçmiş mesajlara bakarak inatla JSON formatında ve "tahmini bütçe" gibi kelimelerle yanıt vermeye devam etti.
   - **Bunun için ne yaptım:** Sunucuya 23:31'de bir "Parser (Ayıklayıcı)" yükledim. Artık bot json üretse bile sadece "bot_cevabi" kısmını alacak.
   - **Peki neden kullanıcı 23:41'de SIFIRLA yazdığında çalışmadı?** SIFIRLA kuralını saat 23:38'de (lokal saatle) kodlara ekledim ve yükledim. Fakat kullanıcının mesajı 23:41'de gitmiş. Demek ki sunucu o anda yeniden başlıyordu veya SIFIRLA kelimesini tanımadı (büyük/küçük harf veya boşluk karakteri vs. yüzünden). 

2. **Mesajların Ortadan Kesilmesi İhtimali:**
   - EĞER yapay zeka hala JSON üretiyorsa, `bot_cevabi: "Merhabalar, Peçen Toptan İmalat'a hoş geldiniz 😊 Size nasıl"` deyip mesajın devamında hata yapıyorsa veya benim yazdığım "Agresif Ayıklayıcı Regex" metnin yarısını siliyorsa mesaj kesiliyor olabilir.
   - VEYA Gemini API gerçekten kelimenin ortasında üretmeyi bırakıyor. (Nadir bir durum ama "maxOutputTokens" kısıtlaması yoksa tek sebep "stop sequences" veya "Safety Filters" olabilir).
   - VEYA ManyChat/AutoResponder'ın kendisinde bir sınır var. (Fakat 400 karakterlik kesilmeyen mesaj da var, demek ki sınır yok).
   - VEYA, kodumdaki şu satır: `finalCevap.match(/^"([^"\\]*(?:\\.[^"\\]*)*)"/)` hatalı bir eşleşme yapıyor ve metnin sadece bir kısmını alıyor.

## Doğrulama Adımları (User Onayı Bekleyen İşlemler)
1. `SIFIRLA` komutunun neden tetiklenmediğini `server.js`'deki büyük/küçük harf kontrolünden bakacağım (`trim().toUpperCase()` yapıldığı için çalışması lazımdı, demek ki sunucu daha aktif olmamıştı).
2. Botun verdiği gerçek, çiğ API yanıtını görmek için küçük bir yerel test (test_gemini.js) yapacağım ve neden kesildiğini %100 anlayacağım.
3. Kullanıcıya: "Agresif ayıklayıcımda ufak bir regex hatası olabilir veya API'den gelen mesajda bir güvenlik filtresi tetikleniyor olabilir. Kesin çözümü bulmak için loglardan okuma yapacağım. İzin veriyor musunuz?" diye soracağım.

## User Review Required
> [!IMPORTANT]
> Kullanıcıdan "Her şeyi sıfırdan incele ve benden onay almadan bir şey yapma" kuralına uymak için, bu planı kullanıcıya sunacak ve onay isteyeceğim. Hiçbir koda dokunmuyorum. Sadece okuma yapacağım.
