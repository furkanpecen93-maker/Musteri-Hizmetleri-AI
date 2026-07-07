import json
import re

input_file = "katalog_verileri.json"
output_file = "temiz_katalog.json"

with open(input_file, "r", encoding="utf-8") as f:
    data = json.load(f)

cleaned_data = []

for item in data:
    # 1. Skip cover pages / messy titles
    fiyat_raw = item.get("fiyat", "")
    urun_tam = item.get("urun_kodu_ve_adi", "")
    
    if "FIRFIRLI GECE ELBİSESİ FIRFIRLI GECE ELBİSESİ" in urun_tam:
        continue
        
    if "ÜRÜNLERİ KEŞFET" in urun_tam:
        continue

    # 2. Split Kod and Ad
    kod = ""
    ad = urun_tam
    
    # Try to find a code format like 23-B1 or S-400 or E-105 before a dash
    match = re.match(r"^([A-Z0-9]+-[A-Z0-9]+)\s*-\s*(.+)$", urun_tam)
    if match:
        kod = match.group(1).strip()
        ad = match.group(2).strip()
    
    # Capitalize appropriately (Title Case)
    ad = ad.title()
    
    # 3. Rename gorsel_aciklamasi to renk and standardize
    renk = item.get("gorsel_aciklamasi", "").title()
    
    # 4. Clean up price (remove ₺, space)
    fiyat = fiyat_raw.replace("₺", "").replace(" ", "").strip()
    
    # Build clean item
    clean_item = {
        "katalog": item.get("katalog_kaynagi", "").replace(".pdf", ""),
        "urun_kodu": kod,
        "urun_adi": ad,
        "fiyat_tl": fiyat,
        "bedenler": item.get("bedenler", "").upper(),
        "kumas": item.get("kumas_icerigi", "").title(),
        "renk": renk
    }
    
    cleaned_data.append(clean_item)

with open(output_file, "w", encoding="utf-8") as f:
    json.dump(cleaned_data, f, ensure_ascii=False, indent=2)

print(f"Başarıyla temizlendi. Toplam {len(cleaned_data)} ürün kaydedildi.")
