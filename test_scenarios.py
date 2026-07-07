import urllib.request
import urllib.error
import json
import time
import uuid

scenarios = [
    {"name": "1. Genel Ürün İsteği", "input": "Ürünlerinizi görebilir miyim?"},
    {"name": "2. Renk/Beden/Fiyat Detay", "input": "Bu modelin kırmızısı var mı? M bedeni ne kadar?"},
    {"name": "3. Katalog Link Sorunu", "input": "Attığınız link açılmadı, göremedim."},
    {"name": "4. Bilinmeyen Konu", "input": "Şirketiniz ne zaman kuruldu, kurucunuzun adı nedir?"},
    {"name": "5. Ödeme (Kredi Kartı)", "input": "Kredi kartı geçiyor mu acaba, kullanabilir miyiz?"},
    {"name": "6. Minimum Sipariş (MOQ)", "input": "Minimum kaç adet almalıyız?"},
    {"name": "7. Perakende / Numune (1 Adet)", "input": "Ben toptan değil de 1 adet numune görmek istiyorum alabilir miyim?"},
    {"name": "8. Konum / Lokasyon", "input": "Yeriniz tam olarak neresi, hangi şehirdesiniz?"},
    {"name": "9. Kargo Ücreti", "input": "Kargoyu kim karşılıyor, kargo ücreti var mı?"},
    {"name": "10. Sinirli / Yapay Zeka İstemeyen", "input": "Ben robotla konuşmak istemiyorum, derhal beni gerçeğe bağla!"},
    {"name": "11. Güven Problemi", "input": "Sizin dolandırıcı olmadığınızı nereden bileyim, size nasıl güveneceğim?"},
    {"name": "12. Başka Ürün Sorusu", "input": "Katalogdakiler dışında başka ürün yok mu?"},
    {"name": "13. Yüksek Adetli Alım", "input": "Merhaba, ben 1000 adetlik büyük bir sipariş vermek istiyorum."},
    {"name": "14. Özel Üretim / Fason", "input": "Kendi markama ürün ürettirmek istiyorum, şu modeli yapar mısınız?"},
    {"name": "15. Pazarlık / Fiyat Yüksek", "input": "Fiyatlarınız çok yüksekmiş, bize biraz indirim yapmaz mısınız?"}
]

URL = "https://musteri-hizmetleri-ai-production-f980.up.railway.app/autoresponder"

def send_post(payload):
    req = urllib.request.Request(URL, data=json.dumps(payload).encode('utf-8'), headers={'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            return response.status, json.loads(response.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf-8')
    except Exception as e:
        return 500, str(e)

def run_tests():
    print("=== OTONOM TEST BAŞLIYOR ===\n")
    results = []
    
    for i, s in enumerate(scenarios):
        print(f"Test {i+1}/{len(scenarios)}: {s['name']} ...")
        sender_id = f"test_user_{uuid.uuid4().hex[:8]}"
        payload_correct = { "sender": sender_id, "message": s['input'] }
        
        try:
            # Send 'Sıfırla'
            send_post({"sender": sender_id, "message": "Sıfırla"})
            
            status_code, data = send_post(payload_correct)
            if status_code == 200 and isinstance(data, dict):
                if "replies" in data and len(data["replies"]) > 0:
                    bot_reply = data["replies"][0]["message"]
                    if len(data["replies"]) > 1:
                        bot_reply = data["replies"][1]["message"]
                else:
                    bot_reply = data.get("reply", str(data))
                results.append(f"## {s['name']}\n**Müşteri:** {s['input']}\n**Bot:** {bot_reply}\n")
            else:
                results.append(f"## {s['name']}\n**Müşteri:** {s['input']}\n**Bot:** [HATA] {status_code} - {data}\n")
        except Exception as e:
            results.append(f"## {s['name']}\n**Müşteri:** {s['input']}\n**Bot:** [İSTİSNA] {str(e)}\n")
        
        time.sleep(2)
        
    with open('test_raporu.md', 'w', encoding='utf-8') as f:
        f.write('\n'.join(results))
        
    print("\n=== OTONOM TEST TAMAMLANDI ===")
    print("Sonuçlar 'test_raporu.md' dosyasına kaydedildi.")

if __name__ == "__main__":
    run_tests()
