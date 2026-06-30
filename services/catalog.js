// services/catalog.js — Google Sheets'ten ürün kataloğu okuma
const fetch = require('node-fetch');
const { config } = require('../config/env');
const log = require('../utils/logger');

// Basit cache — 5 dakikada bir yenile
let catalogCache = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 dakika

/**
 * Google Sheets'ten ürün kataloğunu oku
 * Sheets public paylaşılmışsa API key gerekmez — CSV export ile okuruz
 * @returns {Array} [{ad, aciklama, fiyat, stok, kategori}]
 */
async function getCatalog() {
  // Cache kontrolü
  if (catalogCache && (Date.now() - cacheTimestamp < CACHE_TTL_MS)) {
    return catalogCache;
  }

  if (!config.googleSheetsId) {
    log.warn('[catalog] GOOGLE_SHEETS_ID tanımlı değil — boş katalog dönüyor');
    return getHardcodedCatalog();
  }

  try {
    // Google Sheets'i CSV olarak çek (public link)
    const url = `https://docs.google.com/spreadsheets/d/${config.googleSheetsId}/gviz/tq?tqx=out:json`;
    const response = await fetch(url);
    const text = await response.text();
    
    // Google Sheets JSON wrapper'ını temizle
    const jsonStr = text.replace(/^[^(]*\(/, '').replace(/\);?$/, '');
    const data = JSON.parse(jsonStr);
    
    const rows = data.table.rows;
    const cols = data.table.cols;
    
    // İlk satır başlık — geri kalanı ürünler
    const products = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row.c || !row.c[0]) continue;
      
      products.push({
        ad: row.c[0]?.v || '',
        aciklama: row.c[1]?.v || '',
        fiyat: row.c[2]?.v || '',
        stok: row.c[3]?.v || 'Mevcut',
        kategori: row.c[4]?.v || 'Genel'
      });
    }

    catalogCache = products;
    cacheTimestamp = Date.now();
    log.info('[catalog] Katalog güncellendi', { urunSayisi: products.length });
    return products;
  } catch (err) {
    log.error('[catalog] Google Sheets okuma hatası', err);
    return catalogCache || getHardcodedCatalog();
  }
}

/**
 * Sheets bağlanmamışsa kullanılacak örnek katalog
 */
function getHardcodedCatalog() {
  return [
    { ad: 'Örnek Ürün', aciklama: 'Katalog henüz ayarlanmamış', fiyat: 'Belirsiz', stok: '-', kategori: '-' }
  ];
}

/**
 * Ürün ara
 * @param {string} query - Arama terimi
 * @returns {Array} Eşleşen ürünler
 */
async function searchProducts(query) {
  const catalog = await getCatalog();
  const q = query.toLowerCase().trim();
  
  return catalog.filter(p => 
    p.ad.toLowerCase().includes(q) ||
    (p.aciklama && p.aciklama.toLowerCase().includes(q)) ||
    (p.kategori && p.kategori.toLowerCase().includes(q))
  );
}

/**
 * Cache'i temizle (ürün güncellendiğinde)
 */
function clearCache() {
  catalogCache = null;
  cacheTimestamp = 0;
  log.info('[catalog] Cache temizlendi');
}

module.exports = { getCatalog, searchProducts, clearCache };
