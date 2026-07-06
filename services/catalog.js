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
  
  // En alakalı 5 sonucu dön ki payload çok büyümesin
  return matches.slice(0, 5);
}

function clearCache() {
  localCatalog = null;
  log.info('[catalog] Cache temizlendi');
}

module.exports = { getCatalog, searchProducts, clearCache };
