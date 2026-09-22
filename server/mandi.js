'use strict';

const fs = require('fs');
const path = require('path');
const db = require('./db');

/**
 * DATA SOURCE & HISTORICAL ARCHIVE INVESTIGATION NOTE:
 * Genuine investigation into data.gov.in revealed that the Directorate of Marketing & Inspection (DMI)
 * exposes only a single live daily-snapshot resource (9ef84268-d588-465a-a308-a864a43d0070).
 * No separate historical/archival API resource with an arrival_date filter is published by the ministry.
 * Therefore, historical depth is accumulated locally in data/krishi.db across scheduled daily runs
 * via the ON CONFLICT(state, district, market, commodity, variety, grade, arrival_date) DO UPDATE pattern.
 * Historical records are never deleted, allowing Tier 2 lookback to grow naturally over time.
 */
const RESOURCE_ID = '9ef84268-d588-465a-a308-a864a43d0070';
const API_BASE = 'https://api.data.gov.in/resource';
const PAGE_SIZE = 10000;
const TIMEOUT_MS = 15000;
const MAX_RETRIES = 3;
const SYNC_INTERVAL_MS = 3 * 60 * 60 * 1000; // 3 hours (per user decision)
const REFRESH_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes

let lastRefreshTime = 0;
let isSyncing = false;

// Canonical Commodity Dictionary
const COMMODITY_MAP = {
  'Wheat': { en: 'Wheat', hi: 'गेहूं', category: 'Cereal' },
  'Rice': { en: 'Rice', hi: 'चावल', category: 'Cereal' },
  'Paddy(Dhan)(Common)': { en: 'Paddy (Common)', hi: 'धान (सामान्य)', category: 'Cereal' },
  'Paddy(Common)': { en: 'Paddy (Common)', hi: 'धान (सामान्य)', category: 'Cereal' },
  'Paddy (Common)': { en: 'Paddy (Common)', hi: 'धान (सामान्य)', category: 'Cereal' },
  'Paddy(Dhan)(Basmati)': { en: 'Paddy (Basmati)', hi: 'धान (बासमती)', category: 'Cereal' },
  'Maize': { en: 'Maize', hi: 'मक्का', category: 'Cereal' },
  'Jowar(Sorghum)': { en: 'Sorghum', hi: 'ज्वार', category: 'Cereal' },
  'Bajra(Pearl Millet/Cumbu)': { en: 'Pearl Millet', hi: 'बाजरा', category: 'Cereal' },
  'Ragi (Finger Millet)': { en: 'Finger Millet', hi: 'रागी', category: 'Cereal' },
  'Barley (Jau)': { en: 'Barley', hi: 'जौ', category: 'Cereal' },

  'Soyabean': { en: 'Soybean', hi: 'सोयाबीन', category: 'Oilseed' },
  'Mustard': { en: 'Mustard', hi: 'सरसों', category: 'Oilseed' },
  'Groundnut': { en: 'Groundnut', hi: 'मूंगफली', category: 'Oilseed' },
  'Sesamum(Sesame,Gingelly,Til)': { en: 'Sesame', hi: 'तिल', category: 'Oilseed' },
  'Linseed': { en: 'Linseed', hi: 'अलसी', category: 'Oilseed' },
  'Sunflower': { en: 'Sunflower', hi: 'सूरजमुखी', category: 'Oilseed' },

  'Gram Dal(Chana Dal)': { en: 'Chana Dal', hi: 'चना दाल', category: 'Pulse' },
  'Bengal Gram(Gram)(Whole)': { en: 'Chickpea (Whole)', hi: 'चना (साबुत)', category: 'Pulse' },
  'Gram Raw(Chholia)': { en: 'Green Chickpea', hi: 'छोलिया', category: 'Pulse' },
  'Arhar (Tur/Red Gram)(Whole)': { en: 'Toor Dal', hi: 'अरहर/तूर दाल', category: 'Pulse' },
  'Arhar Dal(Tur Dal)': { en: 'Toor Dal (Split)', hi: 'अरहर दाल', category: 'Pulse' },
  'Masoor Dal': { en: 'Masoor Dal', hi: 'मसूर दाल', category: 'Pulse' },
  'Moong Dal(Moong Dal)': { en: 'Moong Dal', hi: 'मूंग दाल', category: 'Pulse' },
  'Moong(Green Gram)(Whole)': { en: 'Green Gram (Whole)', hi: 'मूंग (साबुत)', category: 'Pulse' },
  'Urad (Blackgram)(Whole)': { en: 'Black Gram (Whole)', hi: 'उड़द (साबुत)', category: 'Pulse' },
  'Urad Dal(Blackgram Dal)': { en: 'Urad Dal', hi: 'उड़द दाल', category: 'Pulse' },
  'Lentil (Masur)(Whole)': { en: 'Lentil (Whole)', hi: 'मसूर (साबुत)', category: 'Pulse' },
  'Lak(Teora)': { en: 'Lak / Teora (Grass Pea)', hi: 'लाख / तिवड़ा दाल', category: 'Pulse' },
  'Ambady/Mesta/Patson': { en: 'Mesta / Patson', hi: 'पटसन / मेस्ता', category: 'Fibre' },
  'Patson': { en: 'Mesta / Patson', hi: 'पटसन / मेस्ता', category: 'Fibre' },

  'Tomato': { en: 'Tomato', hi: 'टमाटर', category: 'Vegetable' },
  'Onion': { en: 'Onion', hi: 'प्याज', category: 'Vegetable' },
  'Potato': { en: 'Potato', hi: 'आलू', category: 'Vegetable' },
  'Green Chilli': { en: 'Green Chilli', hi: 'हरी मिर्च', category: 'Vegetable' },
  'Brinjal': { en: 'Brinjal', hi: 'बैंगन', category: 'Vegetable' },
  'Cabbage': { en: 'Cabbage', hi: 'पत्ता गोभी', category: 'Vegetable' },
  'Cauliflower': { en: 'Cauliflower', hi: 'फूल गोभी', category: 'Vegetable' },
  'Bottle gourd': { en: 'Bottle Gourd', hi: 'लौकी', category: 'Vegetable' },
  'Bitter gourd': { en: 'Bitter Gourd', hi: 'करेला', category: 'Vegetable' },
  'Pumpkin': { en: 'Pumpkin', hi: 'कद्दू', category: 'Vegetable' },
  'Pointed gourd (Parval)': { en: 'Pointed Gourd', hi: 'परवल', category: 'Vegetable' },
  'Okra(Ladies Finger)': { en: 'Okra', hi: 'भिंडी', category: 'Vegetable' },
  'Guar': { en: 'Cluster Bean', hi: 'ग्वार', category: 'Vegetable' },
  'Peas(Green)': { en: 'Green Peas', hi: 'हरी मटर', category: 'Vegetable' },
  'Garlic': { en: 'Garlic', hi: 'लहसुन', category: 'Vegetable' },
  'Ginger(Green)': { en: 'Ginger', hi: 'अदरक', category: 'Vegetable' },
  'Carrot': { en: 'Carrot', hi: 'गाजर', category: 'Vegetable' },
  'Radish': { en: 'Radish', hi: 'मूली', category: 'Vegetable' },
  'Spinach': { en: 'Spinach', hi: 'पालक', category: 'Vegetable' },
  'Coriander(Leaves)': { en: 'Coriander', hi: 'धनिया पत्ता', category: 'Vegetable' },
  'Methi(Fenugreek Leaves)': { en: 'Fenugreek Leaves', hi: 'मेथी', category: 'Vegetable' },
  'Capsicum': { en: 'Capsicum', hi: 'शिमला मिर्च', category: 'Vegetable' },
  'Sweet Potato': { en: 'Sweet Potato', hi: 'शकरकंद', category: 'Vegetable' },
  'Elephant Yam (Suran)': { en: 'Elephant Yam', hi: 'सूरन', category: 'Vegetable' },
  'Drumstick': { en: 'Drumstick', hi: 'सहजन', category: 'Vegetable' },

  'Banana': { en: 'Banana', hi: 'केला', category: 'Fruit' },
  'Apple': { en: 'Apple', hi: 'सेब', category: 'Fruit' },
  'Mango': { en: 'Mango', hi: 'आम', category: 'Fruit' },
  'Papaya': { en: 'Papaya', hi: 'पपीता', category: 'Fruit' },
  'Guava': { en: 'Guava', hi: 'अमरूद', category: 'Fruit' },
  'Orange': { en: 'Orange', hi: 'संतरा', category: 'Fruit' },
  'Lemon': { en: 'Lemon', hi: 'नींबू', category: 'Fruit' },
  'Watermelon': { en: 'Watermelon', hi: 'तरबूज', category: 'Fruit' },
  'Pomegranate': { en: 'Pomegranate', hi: 'अनार', category: 'Fruit' },
  'Grapes': { en: 'Grapes', hi: 'अंगूर', category: 'Fruit' },

  'Turmeric': { en: 'Turmeric', hi: 'हल्दी', category: 'Spice' },
  'Dry Chillies': { en: 'Dry Chillies', hi: 'सूखी मिर्च', category: 'Spice' },
  'Coriander Seed': { en: 'Coriander Seed', hi: 'धनिया बीज', category: 'Spice' },
  'Cumin Seed(Jeera)': { en: 'Cumin', hi: 'जीरा', category: 'Spice' },
  'Black Pepper': { en: 'Black Pepper', hi: 'काली मिर्च', category: 'Spice' },

  'Cotton': { en: 'Cotton', hi: 'कपास', category: 'Fibre' },
  'Sugarcane': { en: 'Sugarcane', hi: 'गन्ना', category: 'Cash Crop' },
  'Jaggery': { en: 'Jaggery', hi: 'गुड़', category: 'Cash Crop' },
  'Gur(Jaggery)': { en: 'Jaggery', hi: 'गुड़', category: 'Cash Crop' },
  'Sugar': { en: 'Sugar', hi: 'चीनी', category: 'Cash Crop' },
  'Tobacco': { en: 'Tobacco', hi: 'तंबाकू', category: 'Cash Crop' },

  'Amla(Nelli Kai)': { en: 'Amla', hi: 'आंवला', category: 'Fruit' },
  'Arecanut(Betelnut/Supari)': { en: 'Betelnut (Supari)', hi: 'सुपारी', category: 'Other' },
  'Ashgourd': { en: 'Ash Gourd', hi: 'पेठा', category: 'Vegetable' },
  'Baby Corn': { en: 'Baby Corn', hi: 'बेबी कॉर्न', category: 'Vegetable' },
  'Beetroot': { en: 'Beetroot', hi: 'चुकंदर', category: 'Vegetable' },
  'Cowpea (Lobia/Karamani)': { en: 'Cowpea (Lobia)', hi: 'लोबिया', category: 'Pulse' },
  'Cowpea(Veg)': { en: 'Cowpea (Lobia)', hi: 'लोबिया', category: 'Vegetable' },
  'Fenugreek Seeds': { en: 'Fenugreek Seeds', hi: 'मेथी दाना', category: 'Spice' },
  'Tamarind Fruit': { en: 'Tamarind', hi: 'इमली', category: 'Fruit' },
  'Colocasia': { en: 'Arbi (Colocasia)', hi: 'अरबी', category: 'Vegetable' },
  'Mint(Pudina)': { en: 'Mint', hi: 'पुदीना', category: 'Vegetable' },
  'Mushroom': { en: 'Mushroom', hi: 'मशरूम', category: 'Vegetable' },
  'Custard Apple (Sharifa)': { en: 'Custard Apple', hi: 'शरीफा', category: 'Fruit' },
  'Coconut': { en: 'Coconut', hi: 'नारियल', category: 'Fruit' },
  'Pineapple': { en: 'Pineapple', hi: 'अनानास', category: 'Fruit' },
};

const COMMODITY_EMOJI = {
  'Cereal': '🌾', 'Oilseed': '🫘', 'Pulse': '🫘',
  'Vegetable': '🥬', 'Fruit': '🍎', 'Spice': '🌶️',
  'Fibre': '🧶', 'Cash Crop': '🎋', 'Other': '📦',
  'Tomato': '🍅', 'Onion': '🧅', 'Potato': '🥔',
  'Maize': '🌽', 'Banana': '🍌', 'Mango': '🥭',
  'Apple': '🍎', 'Watermelon': '🍉', 'Grapes': '🍇',
  'Orange': '🍊', 'Lemon': '🍋', 'Garlic': '🧄',
  'Carrot': '🥕', 'Pumpkin': '🎃', 'Lak(Teora)': '🫘',
  'Ambady/Mesta/Patson': '🧶', 'Patson': '🧶'
};

function getEmoji(commodity, category) {
  return COMMODITY_EMOJI[commodity] || COMMODITY_EMOJI[category] || '📦';
}

function parseArrivalDate(raw) {
  if (!raw) return null;
  const clean = raw.replace(/\\\//g, '/');
  const parts = clean.split('/');
  if (parts.length !== 3) return null;
  const [dd, mm, yyyy] = parts;
  const d = parseInt(dd, 10);
  const m = parseInt(mm, 10);
  const y = parseInt(yyyy, 10);
  if (!d || !m || !y || d > 31 || m > 12 || y < 2000) return null;
  return `${yyyy}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function normalizeRecord(raw) {
  const date = parseArrivalDate(raw.arrival_date);
  if (!date) return null;

  const minPrice = parseFloat(raw.min_price);
  const maxPrice = parseFloat(raw.max_price);
  const modalPrice = parseFloat(raw.modal_price);

  if (isNaN(modalPrice) || modalPrice <= 0) return null;

  return {
    state: (raw.state || '').trim(),
    district: (raw.district || '').trim(),
    market: (raw.market || '').trim(),
    commodity: (raw.commodity || '').trim(),
    variety: (raw.variety || '').trim(),
    grade: (raw.grade || '').trim(),
    arrival_date: date,
    min_price: isNaN(minPrice) ? modalPrice : minPrice,
    max_price: isNaN(maxPrice) ? modalPrice : maxPrice,
    modal_price: modalPrice
  };
}

async function fetchPage(apiKey, { offset = 0, limit = PAGE_SIZE, filters = {} } = {}, retries = MAX_RETRIES) {
  const url = new URL(`${API_BASE}/${RESOURCE_ID}`);
  url.searchParams.set('api-key', apiKey);
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('offset', String(offset));
  for (const [key, val] of Object.entries(filters)) {
    if (val !== undefined && val !== null && val !== '') {
      url.searchParams.set(`filters[${key}]`, String(val));
    }
  }

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
      const resp = await fetch(url.toString(), { signal: controller.signal });
      clearTimeout(timeout);

      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      }
      const data = await resp.json();
      if (data.status !== 'ok') {
        throw new Error(`API error: ${data.status} - ${data.message || ''}`);
      }
      return data;
    } catch (err) {
      if (attempt === retries) throw err;
      const delay = Math.min(1000 * Math.pow(2, attempt - 1), 6000);
      console.log(`  [mandi] Fetch attempt ${attempt} failed: ${err.message}. Retrying in ${delay}ms...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

/**
 * Fetch targeted feed by filters (e.g. { state: 'Chattisgarh' } or { district: 'Raipur' })
 */
async function fetchTargetFeed(apiKey, filters = { state: 'Chattisgarh' }) {
  const allRecords = [];
  let offset = 0;
  const limit = 500;
  let total = null;

  while (true) {
    const data = await fetchPage(apiKey, { offset, limit, filters });
    if (total === null) total = data.total;
    if (!data.records || data.records.length === 0) break;
    allRecords.push(...data.records);
    offset += data.records.length;
    if (offset >= total) break;
    await new Promise(r => setTimeout(r, 100));
  }

  return { records: allRecords, total: total || allRecords.length };
}

/**
 * Directly sync Chhattisgarh records (including Raipur APMC, Arang, Abhanpur)
 * Guaranteed to fetch in 1 request without risk of pagination cutoffs.
 */
async function syncChattisgarh(apiKey) {
  try {
    console.log('[mandi] Fetching targeted Chhattisgarh feed from data.gov.in...');
    const { records, total } = await fetchTargetFeed(apiKey, { state: 'Chattisgarh' });
    console.log(`[mandi] Received ${records.length} Chhattisgarh records from data.gov.in (total: ${total})`);

    const normalized = [];
    let raipurCount = 0;
    for (const raw of records) {
      const norm = normalizeRecord(raw);
      if (norm) {
        normalized.push(norm);
        if ((norm.district || '').toLowerCase() === 'raipur') raipurCount++;
      }
    }

    if (normalized.length > 0) {
      populateCommodities(normalized);
      const upserted = db.upsertPriceMany(normalized);
      console.log(`[mandi] Successfully upserted ${upserted} targeted Chhattisgarh records into DB (Raipur: ${raipurCount})`);
      return { success: true, count: upserted, raipur_count: raipurCount };
    }
    return { success: true, count: 0, raipur_count: 0 };
  } catch (err) {
    console.warn('[mandi] Targeted Chhattisgarh sync failed:', err.message);
    return { success: false, error: err.message };
  }
}

async function fetchNationalFeed(apiKey) {
  const allRecords = [];
  const limit = 5000;
  let offset = 0;
  let total = null;
  const MAX_RECORDS = 25000;

  while (offset < MAX_RECORDS) {
    const fetchLimit = Math.min(limit, MAX_RECORDS - offset);
    if (fetchLimit <= 0) break;
    const data = await fetchPage(apiKey, { offset, limit: fetchLimit });
    if (total === null) total = data.total;
    if (!data.records || data.records.length === 0) break;
    allRecords.push(...data.records);
    offset += data.records.length;
    if (offset >= total) break;
    await new Promise(r => setTimeout(r, 200));
  }

  return { records: allRecords, total };
}

function populateCommodities(records) {
  const seen = new Set();
  const unmapped = [];

  for (const r of records) {
    const commodity = r.commodity;
    if (seen.has(commodity)) continue;
    seen.add(commodity);

    const mapping = COMMODITY_MAP[commodity];
    if (mapping) {
      db.upsertCommodity({
        name_api: commodity,
        name_en: mapping.en,
        name_hi: mapping.hi,
        category: mapping.category
      });
    } else {
      unmapped.push(commodity);
      db.upsertCommodity({
        name_api: commodity,
        name_en: commodity,
        name_hi: commodity,
        category: 'Other'
      });
    }
  }

  // Update data/commodity_names.json
  try {
    const all = db.getDb().prepare(`SELECT * FROM commodities ORDER BY name_api`).all();
    const filePath = path.join(__dirname, '..', 'data', 'commodity_names.json');
    fs.writeFileSync(filePath, JSON.stringify(all, null, 2), 'utf-8');
  } catch (e) {
    console.error('Failed to write commodity_names.json:', e.message);
  }

  return unmapped;
}

/**
 * Execute national sync run and log telemetry
 */
async function syncNational(apiKey) {
  if (isSyncing) {
    console.log('[mandi] Sync already in progress, skipping.');
    return { success: false, reason: 'in_progress' };
  }
  isSyncing = true;
  const startedAt = new Date().toISOString();

  const logEntry = {
    started_at: startedAt,
    state: 'National',
    district: 'All',
    status: 'running',
    rows_fetched: 0,
    rows_upserted: 0,
    total_feed_rows: 0,
    raipur_rows: 0,
    chhattisgarh_rows: 0,
    raipur_commodities: 0,
    error: null
  };
  const logResult = db.addSyncLog(logEntry);
  const logId = logResult.lastInsertRowid;

  try {
    console.log(`[mandi] Starting national sync at ${startedAt}...`);

    // 1. ALWAYS sync targeted Chhattisgarh first so local data is guaranteed immediately!
    await syncChattisgarh(apiKey);

    const { records, total } = await fetchNationalFeed(apiKey);
    console.log(`[mandi] Received ${records.length} records from national feed (total in API: ${total})`);

    const normalized = [];
    let raipurCount = 0;
    let cgCount = 0;
    const raipurCommoditiesSet = new Set();

    for (const raw of records) {
      const norm = normalizeRecord(raw);
      if (!norm) continue;
      normalized.push(norm);

      if (norm.state === 'Chattisgarh' || norm.state === 'Chhattisgarh') {
        cgCount++;
        if (norm.district.toLowerCase() === 'raipur') {
          raipurCount++;
          raipurCommoditiesSet.add(norm.commodity);
        }
      }
    }

    // Populate commodities catalog
    populateCommodities(normalized);

    // Upsert into SQLite database
    const upserted = db.upsertPriceMany(normalized);
    console.log(`[mandi] Upserted ${upserted} rows into DB (Raipur: ${raipurCount}, CG: ${cgCount}, Raipur Commodities: ${raipurCommoditiesSet.size})`);

    db.updateSyncLog(logId, {
      status: 'success',
      rows_fetched: records.length,
      rows_upserted: upserted,
      total_feed_rows: total,
      raipur_rows: raipurCount,
      chhattisgarh_rows: cgCount,
      raipur_commodities: raipurCommoditiesSet.size,
      error: null
    });

    lastRefreshTime = Date.now();
    isSyncing = false;
    return {
      success: true,
      total_feed_rows: total,
      rows_fetched: records.length,
      rows_upserted: upserted,
      raipur_rows: raipurCount,
      chhattisgarh_rows: cgCount,
      raipur_commodities: raipurCommoditiesSet.size
    };
  } catch (err) {
    console.error('[mandi] National sync failed:', err.message);
    db.updateSyncLog(logId, {
      status: 'error',
      rows_fetched: 0,
      rows_upserted: 0,
      total_feed_rows: 0,
      raipur_rows: 0,
      chhattisgarh_rows: 0,
      raipur_commodities: 0,
      error: err.message
    });
    isSyncing = false;
    return { success: false, error: err.message };
  }
}

function needsSync() {
  const last = db.getLastSync();
  if (!last) return true;
  const elapsed = Date.now() - new Date(last.finished_at + 'Z').getTime();
  if (elapsed > SYNC_INTERVAL_MS) return true;
  const meta = db.getSyncMeta('Raipur');
  if (!meta || meta.row_count === 0) return true;
  return false;
}

async function manualRefresh(apiKey) {
  const now = Date.now();
  if (now - lastRefreshTime < REFRESH_COOLDOWN_MS) {
    const meta = db.getSyncMeta('Raipur');
    return {
      refreshed: false,
      reason: 'recent',
      last_updated: meta.last_updated,
      cooldown_remaining_s: Math.ceil((REFRESH_COOLDOWN_MS - (now - lastRefreshTime)) / 1000)
    };
  }
  const result = await syncNational(apiKey);
  const meta = db.getSyncMeta('Raipur');
  return {
    refreshed: result.success,
    result,
    last_updated: meta.last_updated
  };
}

function startPeriodicSync(apiKey) {
  setInterval(async () => {
    if (needsSync()) {
      console.log('[mandi] 3-hour periodic sync triggered');
      await syncNational(apiKey).catch(err => console.error('[mandi] Periodic sync error:', err.message));
    }
  }, SYNC_INTERVAL_MS);
}

module.exports = {
  syncNational, syncAll: syncNational, syncChattisgarh, needsSync, manualRefresh,
  startPeriodicSync, COMMODITY_MAP, COMMODITY_EMOJI, getEmoji,
  parseArrivalDate, normalizeRecord, populateCommodities,
  get lastRefreshTime() { return lastRefreshTime; }
};
