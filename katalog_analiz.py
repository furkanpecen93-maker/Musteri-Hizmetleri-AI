import os
import fitz
import re
import pandas as pd
import json

kataloglar_dir = "kataloglar"
pdf_files = [f for f in os.listdir(kataloglar_dir) if f.lower().endswith(".pdf")]

all_products = []

for pdf_file in pdf_files:
    file_path = os.path.join(kataloglar_dir, pdf_file)
    print(f"\n[{pdf_file}] İşleniyor...")
    
    try:
        doc = fitz.open(file_path)
        
        # We will parse each page looking for structured data
        for page_num in range(len(doc)):
            text = doc[page_num].get_text()
            lines = text.split("\n")
            
            # Simple heuristic variables
            urun = {}
            ad_adaylari = []
            
            for line in lines:
                line = line.strip()
                if not line:
                    continue
                
                # Fiyat
                if "FİYAT:" in line.upper() or "FIYAT:" in line.upper():
                    urun["fiyat"] = line.split(":", 1)[1].strip()
                elif "₺" in line:
                    # Sometimes price is just "450₺"
                    urun["fiyat"] = line.strip()
                
                # Kod
                elif "KOD:" in line.upper():
                    urun["urun_kodu_ve_adi"] = line.split(":", 1)[1].strip()
                    
                # Beden
                elif "BEDEN" in line.upper():
                    if ":" in line:
                        urun["bedenler"] = line.split(":", 1)[1].strip()
                    else:
                        urun["bedenler"] = line.replace("BEDEN", "").strip()
                
                # Kumaş
                elif "KUMAŞ" in line.upper() or "KUMAS" in line.upper():
                    if ":" in line:
                        urun["kumas_icerigi"] = line.split(":", 1)[1].strip()
                    else:
                        urun["kumas_icerigi"] = line.replace("KUMAŞ", "").replace("KUMAS", "").strip()
                
                # Renk
                elif "RENK" in line.upper():
                    urun["gorsel_aciklamasi"] = line.split(":", 1)[1].strip() if ":" in line else line.replace("RENK", "").strip()
                
                # Catch-all for product name (if not a known key and is mostly uppercase/letters)
                elif line.isupper() and len(line) > 5 and not any(k in line for k in ["PEÇEN", "TOPTAN", "İMALAT", "2026", "YENİ", "SEZON"]):
                    ad_adaylari.append(line)
            
            # If we found at least a code or price, let's treat it as a product
            if "urun_kodu_ve_adi" in urun or "fiyat" in urun or "bedenler" in urun:
                # Format name and code
                isim = " ".join(ad_adaylari)
                if "urun_kodu_ve_adi" in urun:
                    urun["urun_kodu_ve_adi"] = f"{urun['urun_kodu_ve_adi']} - {isim}".strip(" -")
                else:
                    urun["urun_kodu_ve_adi"] = isim
                    
                urun["katalog_kaynagi"] = pdf_file
                
                # Fill missing keys
                for key in ["urun_kodu_ve_adi", "fiyat", "bedenler", "kumas_icerigi", "gorsel_aciklamasi"]:
                    if key not in urun:
                        urun[key] = ""
                        
                # Only add if it's not empty string dump
                if urun["urun_kodu_ve_adi"] or urun["fiyat"]:
                    all_products.append(urun)

    except Exception as e:
        print(f"[{pdf_file}] Hata: {e}")

if all_products:
    print(f"\nToplam {len(all_products)} ürün bulundu (sayfalardan parse edildi). Kaydediliyor...")
    
    with open("katalog_verileri.json", "w", encoding="utf-8") as f:
        json.dump(all_products, f, ensure_ascii=False, indent=2)
        
    df = pd.DataFrame(all_products)
    cols = ["katalog_kaynagi", "urun_kodu_ve_adi", "fiyat", "bedenler", "kumas_icerigi", "gorsel_aciklamasi"]
    
    # Filter duplicates (sometimes a product spans multiple pages or we parse the same thing twice)
    # Let's remove exact duplicates based on code/name and catalog
    df.drop_duplicates(subset=["katalog_kaynagi", "urun_kodu_ve_adi", "fiyat"], inplace=True)
    
    df = df.reindex(columns=cols)
    df.to_excel("katalog_verileri.xlsx", index=False)
    df.to_csv("katalog_verileri.csv", index=False, encoding="utf-8-sig")
    
    print(f"Filtrelendikten sonra {len(df)} ürün kaydedildi.")
    print("katalog_verileri.json, katalog_verileri.xlsx ve katalog_verileri.csv başarıyla oluşturuldu!")
else:
    print("Hiç ürün çıkarılamadı.")
