// services/catalog.js — Yerel katalog JSON'dan arama
const fs = require('fs');
const path = require('path');
const log = require('../utils/logger');

let localCatalog = null;

function getLocalCatalog() {
  if (localCatalog) return localCatalog;
  try {
    const filePath = path.join(__dirname, '..', 'temiz_katalog.json');
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf-8');
      localCatalog = JSON.parse(data);
    } else {
      localCatalog = [];
    }
  } catch (err) {
    log.error('[catalog] JSON okuma hatası', err);
    localCatalog = [];
  }
  return localCatalog;
}

/**
 * Sunucu tarafında gereksiz catalog payload'ı göndermemek için boş dizi döner.
 */
async function getCatalog() {
  return [];
}

/**
 * Ürün ara (Gemini Tool/Function tarafından kullanılır)
 * @param {string} query - Arama terimi (ürün kodu veya adı)
 * @returns {Array} Eşleşen ürünler
 */
function searchProducts(query) {
  const catalog = getLocalCatalog();
  if (!query) return [];
  const q = query.toLowerCase().trim();
  
  // Kelime kelime arama (örn: "23-b1 siyah")
  const terms = q.split(' ');
  
  const matches = catalog.filter(p => {
    const targetText = `${p.urun_kodu} ${p.urun_adi} ${p.kumas} ${p.renk} ${p.bedenler}`.toLowerCase();
    return terms.every(term => targetText.includes(term));
  });
  
  // En alakalı 5 sonucu dön ki payload çok büyümesin ve ek bilgileri hesapla
  return matches.slice(0, 5).map(p => {
    // Beden sayısını hesapla (örn: "S-M-L" -> 3)
    let beden_sayisi = 1; // Default
    if (p.bedenler) {
      beden_sayisi = p.bedenler.split(/[-,\s]+/).filter(b => b.trim().length > 0).length || 1;
    }
    
    // Fiyatı sayıya çevir
    const fiyat_num = p.fiyat_tl ? parseFloat(p.fiyat_tl.replace(/[^\d.]/g, '')) : 0;
    
    // Seri fiyatı = beden sayısı * ürün fiyatı
    const bir_seri_fiyati = !isNaN(fiyat_num) && fiyat_num > 0 ? (beden_sayisi * fiyat_num) : "Belirtilmemiş";
    
    return {
      ...p,
      beden_sayisi,
      bir_seri_fiyati,
      seri_bilgisi_notu: `1 seri alındığında ${beden_sayisi} adet alınmış olur.`
    };
  });
}

function clearCache() {
  localCatalog = null;
  log.info('[catalog] Cache temizlendi');
}

module.exports = { getCatalog, searchProducts, clearCache };
