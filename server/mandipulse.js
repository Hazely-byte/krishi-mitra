'use strict';

/**
 * Krishi Mitra — MandiPulse Fallback & Enrichment Scraper
 * Scrapes live APMC commodity prices from MandiPulse for target Chhattisgarh districts
 * (Durg, Raipur, Bilaspur, Rajnandgaon, Dhamtari) to provide a rich fallback when
 * data.gov.in has sparse records (e.g. only Paddy for Raipur).
 * Caches results in memory for 30 minutes.
 */

const TARGET_MANDIS = [
  { slug: 'chattisgarh-durg-durg-apmc', market: 'Durg APMC', district: 'Durg' },
  { slug: 'chattisgarh-raipur-raipur-apmc', market: 'Raipur APMC', district: 'Raipur' },
  { slug: 'chattisgarh-bilaspur-bilaspur-apmc', market: 'Bilaspur APMC', district: 'Bilaspur' },
  { slug: 'chattisgarh-rajnandgaon-rajnandgaon-apmc', market: 'Rajnandgaon APMC', district: 'Rajnandgaon' },
  { slug: 'chattisgarh-dhamtari-dhamtari-apmc', market: 'Dhamtari APMC', district: 'Dhamtari' }
];

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const FETCH_TIMEOUT_MS = 10000;

// In-memory cache: slug -> { timestamp, data }
const scrapeCache = new Map();

/**
 * Parse MandiPulse HTML page content into normalized commodity records
 */
function parseMandiPulseHtml(html, marketName, districtName) {
  const records = [];
  const blocks = html.split(/class="[^"]*commodity-item[^"]*"/);

  for (let i = 1; i < blocks.length; i++) {
    const b = blocks[i];

    // Ignore internal links section or non-commodity blocks
    if (b.includes('mp-internal-links') || b.includes('mp-news-card')) continue;

    // Commodity Name
    const nameMatch = b.match(/<h3[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i);
    let rawCommodity = nameMatch ? nameMatch[1].trim() : null;
    if (!rawCommodity) continue;

    // If it contains tags (e.g. <span>), strip tags
    rawCommodity = rawCommodity.replace(/<[^>]*>/g, '').trim();

    // Check if it's an SEO headline or link rather than a real crop name
    if (rawCommodity.toLowerCase().includes('price in') ||
        rawCommodity.toLowerCase().includes('mandi bhav') ||
        rawCommodity.toLowerCase().includes('latest modal rate') ||
        rawCommodity.length > 50) {
      continue;
    }

    const commodity = rawCommodity.replace(/&amp;/g, '&').trim();

    // Modal Price
    const modalMatch = b.match(/Modal\s+Price[\s\S]*?₹([\d,]+)/i);
    const modal = modalMatch ? parseFloat(modalMatch[1].replace(/,/g, '')) : null;
    if (!modal || isNaN(modal) || modal <= 0) continue;

    // Min Price
    const minMatch = b.match(/Min:[\s\S]*?₹([\d,]+)/i);
    const min = minMatch ? parseFloat(minMatch[1].replace(/,/g, '')) : modal;

    // Max Price
    const maxMatch = b.match(/Max:[\s\S]*?₹([\d,]+)/i);
    const max = maxMatch ? parseFloat(maxMatch[1].replace(/,/g, '')) : modal;

    // Variety
    const varietyMatch = b.match(/Variety:[\s\S]*?<strong>([\s\S]*?)<\/strong>/i);
    const variety = varietyMatch ? varietyMatch[1].trim() : '';

    // Grade
    const gradeMatch = b.match(/Grade:[\s\S]*?<strong>([\s\S]*?)<\/strong>/i);
    const grade = gradeMatch ? gradeMatch[1].trim() : '';

    // Date (e.g. "22 Sep 2026")
    const dateMatch = b.match(/(\d{1,2}\s+[A-Za-z]{3}\s+\d{4})/);
    let arrivalDate = null;
    if (dateMatch) {
      const d = new Date(dateMatch[1]);
      if (!isNaN(d.getTime())) {
        arrivalDate = d.toISOString().slice(0, 10);
      }
    }
    if (!arrivalDate) {
      arrivalDate = new Date().toISOString().slice(0, 10);
    }

    records.push({
      state: 'Chhattisgarh',
      district: districtName,
      market: marketName,
      commodity,
      variety,
      grade,
      arrival_date: arrivalDate,
      min_price: isNaN(min) ? modal : min,
      max_price: isNaN(max) ? modal : max,
      modal_price: modal,
      source: 'mandipulse'
    });
  }

  return records;
}

/**
 * Scrape a single mandi APMC by slug
 */
async function scrapeMandi(mandiConfig) {
  const { slug, market, district } = mandiConfig;
  const now = Date.now();

  const cached = scrapeCache.get(slug);
  if (cached && (now - cached.timestamp) < CACHE_TTL_MS) {
    return cached.data;
  }

  const url = `https://mandipulse.com/mandi/${slug}`;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (!resp.ok) {
      console.warn(`[mandipulse] HTTP ${resp.status} for ${slug}`);
      return cached ? cached.data : [];
    }

    const html = await resp.text();
    const records = parseMandiPulseHtml(html, market, district);
    scrapeCache.set(slug, { timestamp: now, data: records });
    console.log(`[mandipulse] Scraped ${records.length} records for ${market} (${district})`);
    return records;
  } catch (err) {
    console.warn(`[mandipulse] Fetch failed for ${market}:`, err.message);
    return cached ? cached.data : [];
  }
}

/**
 * Scrape all target Chhattisgarh mandis (Durg, Raipur, Bilaspur, Rajnandgaon, Dhamtari)
 */
async function scrapeAllMandis() {
  const promises = TARGET_MANDIS.map(m => scrapeMandi(m));
  const results = await Promise.all(promises);
  return results.flat();
}

/**
 * Sync MandiPulse records into the SQLite database.
 * Auto-registers unknown commodities in the `commodities` table.
 */
async function syncMandiPulseToDb(db) {
  try {
    const records = await scrapeAllMandis();
    if (!records || records.length === 0) return 0;

    let upsertedCount = 0;
    const dbInst = db.getDb();

    const insertStmt = dbInst.prepare(`
      INSERT INTO mandi_prices (state, district, market, commodity, variety, grade, arrival_date, min_price, max_price, modal_price, fetched_at, source)
      VALUES (@state, @district, @market, @commodity, @variety, @grade, @arrival_date, @min_price, @max_price, @modal_price, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), @source)
      ON CONFLICT(state, district, market, commodity, variety, grade, arrival_date)
      DO UPDATE SET
        min_price = excluded.min_price,
        max_price = excluded.max_price,
        modal_price = excluded.modal_price,
        source = excluded.source,
        fetched_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
    `);

    const { COMMODITY_MAP } = require('./mandi');
    const upsertCommodityStmt = dbInst.prepare(`
      INSERT INTO commodities (name_api, name_en, name_hi, category)
      VALUES (@name_api, @name_en, @name_hi, @category)
      ON CONFLICT(name_api) DO UPDATE SET
        name_en = CASE WHEN excluded.category != 'Other' THEN excluded.name_en ELSE commodities.name_en END,
        name_hi = CASE WHEN excluded.category != 'Other' THEN excluded.name_hi ELSE commodities.name_hi END,
        category = CASE WHEN excluded.category != 'Other' THEN excluded.category ELSE commodities.category END
    `);

    const tx = dbInst.transaction((rows) => {
      for (const row of rows) {
        // Ensure commodity is registered with mapping if available
        const map = COMMODITY_MAP[row.commodity] || COMMODITY_MAP[row.commodity.replace(/\s+/g, '')];
        upsertCommodityStmt.run({
          name_api: row.commodity,
          name_en: map ? map.en : row.commodity,
          name_hi: map ? map.hi : row.commodity,
          category: map ? map.category : 'Other'
        });

        const res = insertStmt.run(row);
        if (res.changes > 0) upsertedCount++;
      }
    });

    tx(records);
    console.log(`[mandipulse] Synced ${upsertedCount} records into database.`);
    return upsertedCount;
  } catch (err) {
    console.error('[mandipulse] DB sync error:', err.message);
    return 0;
  }
}

/**
 * Clear memory cache (useful for explicit refresh)
 */
function bustCache() {
  scrapeCache.clear();
}

module.exports = {
  TARGET_MANDIS,
  scrapeMandi,
  scrapeAllMandis,
  syncMandiPulseToDb,
  bustCache,
  CACHE_TTL_MS
};
