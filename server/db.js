'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const haversine = require('./haversine');

const DB_PATH = path.join(__dirname, '..', 'data', 'krishi.db');

let _db = null;

function getDb() {
  if (_db) return _db;
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  _db.pragma('busy_timeout = 5000');
  initSchema(_db);
  return _db;
}

function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS mandi_prices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      state TEXT NOT NULL,
      district TEXT NOT NULL,
      market TEXT NOT NULL,
      commodity TEXT NOT NULL,
      variety TEXT NOT NULL DEFAULT '',
      grade TEXT NOT NULL DEFAULT '',
      arrival_date TEXT NOT NULL,
      min_price REAL,
      max_price REAL,
      modal_price REAL,
      fetched_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      UNIQUE(state, district, market, commodity, variety, grade, arrival_date)
    );

    CREATE INDEX IF NOT EXISTS idx_district_commodity_date
      ON mandi_prices(district, commodity, arrival_date);

    CREATE INDEX IF NOT EXISTS idx_market_commodity_date
      ON mandi_prices(market, commodity, arrival_date);

    CREATE INDEX IF NOT EXISTS idx_state_commodity_date
      ON mandi_prices(state, commodity, arrival_date);

    CREATE TABLE IF NOT EXISTS commodities (
      name_api TEXT PRIMARY KEY,
      name_en TEXT NOT NULL,
      name_hi TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'Other'
    );

    CREATE TABLE IF NOT EXISTS sync_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      state TEXT,
      district TEXT,
      status TEXT,
      rows_fetched INTEGER DEFAULT 0,
      rows_upserted INTEGER DEFAULT 0,
      total_feed_rows INTEGER DEFAULT 0,
      raipur_rows INTEGER DEFAULT 0,
      chhattisgarh_rows INTEGER DEFAULT 0,
      raipur_commodities INTEGER DEFAULT 0,
      error TEXT
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      mode TEXT NOT NULL CHECK(mode IN ('chat','voice')),
      title TEXT DEFAULT '',
      language TEXT DEFAULT 'hi',
      created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_client
      ON sessions(client_id, mode);

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      sources_json TEXT,
      created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );

    CREATE INDEX IF NOT EXISTS idx_messages_session
      ON messages(session_id);
  `);

  // Migration: add fetch count columns to sync_log if they don't exist
  try {
    const cols = db.prepare(`PRAGMA table_info(sync_log)`).all().map(c => c.name);
    if (!cols.includes('total_feed_rows')) {
      db.exec(`ALTER TABLE sync_log ADD COLUMN total_feed_rows INTEGER DEFAULT 0;`);
      db.exec(`ALTER TABLE sync_log ADD COLUMN raipur_rows INTEGER DEFAULT 0;`);
      db.exec(`ALTER TABLE sync_log ADD COLUMN chhattisgarh_rows INTEGER DEFAULT 0;`);
      db.exec(`ALTER TABLE sync_log ADD COLUMN raipur_commodities INTEGER DEFAULT 0;`);
    }

    const priceCols = db.prepare(`PRAGMA table_info(mandi_prices)`).all().map(c => c.name);
    if (!priceCols.includes('source')) {
      db.exec(`ALTER TABLE mandi_prices ADD COLUMN source TEXT DEFAULT 'data.gov.in';`);
    }
  } catch (e) {
    // Ignore if already migrated
  }

  // Normalize all existing timestamps in DB to ISO-8601 UTC with trailing 'Z'
  try {
    db.exec(`
      UPDATE sync_log SET finished_at = REPLACE(finished_at, ' ', 'T') || 'Z'
      WHERE finished_at IS NOT NULL AND finished_at NOT LIKE '%Z';

      UPDATE sync_log SET started_at = REPLACE(started_at, ' ', 'T') || 'Z'
      WHERE started_at IS NOT NULL AND started_at NOT LIKE '%Z';

      UPDATE mandi_prices SET fetched_at = REPLACE(fetched_at, ' ', 'T') || 'Z'
      WHERE fetched_at IS NOT NULL AND fetched_at NOT LIKE '%Z';

      UPDATE sessions SET created_at = REPLACE(created_at, ' ', 'T') || 'Z'
      WHERE created_at IS NOT NULL AND created_at NOT LIKE '%Z';

      UPDATE sessions SET updated_at = REPLACE(updated_at, ' ', 'T') || 'Z'
      WHERE updated_at IS NOT NULL AND updated_at NOT LIKE '%Z';

      UPDATE messages SET created_at = REPLACE(created_at, ' ', 'T') || 'Z'
      WHERE created_at IS NOT NULL AND created_at NOT LIKE '%Z';
    `);
  } catch (e) {
    // Ignore normalization errors
  }

  // Auto-seed baseline records if table is empty (e.g. cold start on Render)
  try {
    const countRow = db.prepare('SELECT COUNT(*) AS cnt FROM mandi_prices').get();
    if (!countRow || countRow.cnt === 0) {
      const seedFile = path.join(__dirname, 'seed-mandi-prices.json');
      if (fs.existsSync(seedFile)) {
        const seedRaw = JSON.parse(fs.readFileSync(seedFile, 'utf-8'));
        const insertStmt = db.prepare(`
          INSERT OR IGNORE INTO mandi_prices (state, district, market, commodity, variety, grade, arrival_date, min_price, max_price, modal_price, fetched_at, source)
          VALUES (@state, @district, @market, @commodity, @variety, @grade, @arrival_date, @min_price, @max_price, @modal_price, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), 'data.gov.in')
        `);
        const insertCommStmt = db.prepare(`
          INSERT INTO commodities (name_api, name_en, name_hi, category)
          VALUES (@name_api, @name_en, @name_hi, @category)
          ON CONFLICT(name_api) DO NOTHING
        `);

        const insertMany = db.transaction((records) => {
          for (const raw of records) {
            let date = raw.arrival_date;
            if (date && date.includes('/')) {
              const parts = date.split('/');
              if (parts.length === 3) date = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
            }
            const modal = parseFloat(raw.modal_price) || 0;
            const min = parseFloat(raw.min_price) || modal;
            const max = parseFloat(raw.max_price) || modal;
            const comm = (raw.commodity || '').trim();
            if (modal > 0 && date && comm) {
              insertStmt.run({
                state: (raw.state || '').trim(),
                district: (raw.district || '').trim(),
                market: (raw.market || '').trim(),
                commodity: comm,
                variety: (raw.variety || '').trim(),
                grade: (raw.grade || '').trim(),
                arrival_date: date,
                min_price: min,
                max_price: max,
                modal_price: modal
              });
              insertCommStmt.run({
                name_api: comm,
                name_en: comm,
                name_hi: comm,
                category: 'Other'
              });
            }
          }
        });
        insertMany(seedRaw);
        console.log(`[db] Auto-seeded ${seedRaw.length} baseline mandi records from seed-mandi-prices.json`);
      }
    }
  } catch (seedErr) {
    console.warn('[db] Failed to auto-seed baseline mandi records:', seedErr.message);
  }
}

// Prepared statements cache
const _stmts = {};

function stmt(db, name, sql) {
  if (!_stmts[name]) {
    _stmts[name] = db.prepare(sql);
  }
  return _stmts[name];
}

// --- Mandi Prices ---

function upsertPriceMany(rows) {
  const db = getDb();
  const upsert = stmt(db, 'upsertPrice', `
    INSERT INTO mandi_prices (state, district, market, commodity, variety, grade, arrival_date, min_price, max_price, modal_price, fetched_at, source)
    VALUES (@state, @district, @market, @commodity, @variety, @grade, @arrival_date, @min_price, @max_price, @modal_price, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), COALESCE(@source, 'data.gov.in'))
    ON CONFLICT(state, district, market, commodity, variety, grade, arrival_date)
    DO UPDATE SET
      min_price = excluded.min_price,
      max_price = excluded.max_price,
      modal_price = excluded.modal_price,
      source = COALESCE(excluded.source, mandi_prices.source),
      fetched_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
  `);
  const tx = db.transaction((rows) => {
    let upserted = 0;
    for (const row of rows) {
      const rowWithSource = { source: 'data.gov.in', ...row };
      const info = upsert.run(rowWithSource);
      if (info.changes > 0) upserted++;
    }
    return upserted;
  });
  return tx(rows);
}

const MIN_COMMODITIES_THRESHOLD = 5;
const MAX_HISTORICAL_LOOKBACK_DAYS = 49; // 7 weeks

const STATE_NAMES = {
  'Chattisgarh': 'Chhattisgarh / छत्तीसगढ़',
  'Chhattisgarh': 'Chhattisgarh / छत्तीसगढ़',
  'Madhya Pradesh': 'Madhya Pradesh / मध्य प्रदेश',
  'Maharashtra': 'Maharashtra / महाराष्ट्र',
  'Odisha': 'Odisha / ओडिशा',
  'Jharkhand': 'Jharkhand / झारखंड',
  'Uttar Pradesh': 'Uttar Pradesh / उत्तर प्रदेश',
  'Telangana': 'Telangana / तेलंगाना',
  'Andhra Pradesh': 'Andhra Pradesh / आंध्र प्रदेश',
  'Rajasthan': 'Rajasthan / राजस्थान',
  'Gujarat': 'Gujarat / गुजरात',
  'Punjab': 'Punjab / पंजाब',
  'Haryana': 'Haryana / हरियाणा',
  'Karnataka': 'Karnataka / कर्नाटक',
  'Tamil Nadu': 'Tamil Nadu / तमिलनाडु',
  'West Bengal': 'West Bengal / पश्चिम बंगाल',
  'Bihar': 'Bihar / बिहार'
};

function getStateDisplay(state) {
  if (!state) return '';
  const s = state.trim();
  return STATE_NAMES[s] || `${s} / ${s}`;
}

function getTodayDateKolkata() {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  return formatter.format(now); // YYYY-MM-DD
}

function computeDaysOld(arrivalDateStr, todayStr) {
  if (!arrivalDateStr) return 0;
  const t = new Date(todayStr + 'T00:00:00Z').getTime();
  const a = new Date(arrivalDateStr + 'T00:00:00Z').getTime();
  const diffDays = Math.round((t - a) / (1000 * 60 * 60 * 24));
  return Math.max(0, diffDays);
}

function getCutoffDateStr(todayStr, maxDays = MAX_HISTORICAL_LOOKBACK_DAYS) {
  const d = new Date(todayStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - maxDays);
  return d.toISOString().slice(0, 10);
}

/**
 * Get latest prices for Raipur Market Page (Legacy / Uncascaded).
 * Strictly Raipur district: one card per commodity, using the latest arrival_date;
 * among markets on that date, show the one with the highest modal price.
 */
function getLatestPrices({ district = 'Raipur', query = '', category = '' } = {}) {
  const db = getDb();
  let sql = `
    WITH latest AS (
      SELECT commodity, MAX(arrival_date) AS max_date
      FROM mandi_prices
      WHERE district = @district
      GROUP BY commodity
    ),
    best AS (
      SELECT mp.*,
        ROW_NUMBER() OVER (
          PARTITION BY mp.commodity
          ORDER BY mp.modal_price DESC, mp.market ASC
        ) AS rn
      FROM mandi_prices mp
      INNER JOIN latest l ON mp.commodity = l.commodity AND mp.arrival_date = l.max_date
      WHERE mp.district = @district
    )
    SELECT b.*, c.name_en, c.name_hi, c.category
    FROM best b
    LEFT JOIN commodities c ON b.commodity = c.name_api
    WHERE b.rn = 1
  `;

  const params = { district };

  if (category) {
    sql += ` AND c.category = @category`;
    params.category = category;
  }

  sql += ` ORDER BY b.arrival_date DESC, COALESCE(c.name_en, b.commodity) ASC`;

  let results = db.prepare(sql).all(params);

  // Search filter across English, Hindi, category, variety, commodity
  if (query && query.trim()) {
    const q = query.trim().normalize('NFC').toLowerCase();
    // Normalize anusvara/chandrabindu: treat ं and ँ as equivalent
    const normalizeHindi = (s) => s.normalize('NFC').toLowerCase().replace(/[\u0901\u0902]/g, '\u0902');
    const qNorm = normalizeHindi(q);
    results = results.filter(r => {
      const nameEn = (r.name_en || r.commodity).toLowerCase();
      const nameHi = normalizeHindi(r.name_hi || '');
      const cat = (r.category || '').toLowerCase();
      const variety = (r.variety || '').toLowerCase();
      const commodity = r.commodity.toLowerCase();
      return nameEn.includes(q) || nameHi.includes(qNorm) || cat.includes(q) ||
             variety.includes(q) || commodity.includes(q);
    });
  }

  return results;
}

/**
 * Cascading Fallback for Market Page:
 * Prioritizes:
 *   TIER 1 — Today, Raipur district (one card per commodity, highest modal price)
 *   TIER 2 — Historical lookback, Raipur district (≤ 49 days, most recent date per crop)
 *   TIER 3 — Other Chhattisgarh districts (dynamic district list, today or ≤ 49 days)
 *   TIER 4 — Other states (MP, MH, OD, JH, UP, TS, AP, others; highest modal price; transport warning)
 *
 * NOTE ON SEARCH BEHAVIOR:
 * When query (search term) is non-empty, all 4 tiers are queried unconditionally,
 * bypassing MIN_COMMODITIES_THRESHOLD so any available crop in any tier can be found.
 * Results remain strictly ordered by tier priority.
 */
function getMarketPricesCascaded({ district = 'Raipur', query = '', category = '', threshold = MIN_COMMODITIES_THRESHOLD } = {}) {
  const db = getDb();
  const todayKolkata = getTodayDateKolkata();
  const cutoffDate = getCutoffDateStr(todayKolkata, MAX_HISTORICAL_LOOKBACK_DAYS);
  const hasSearch = Boolean(query && query.trim());

  const selectedSet = new Set();
  const records = [];

  // TIER 1: Today, Raipur district
  const tier1Rows = db.prepare(`
    WITH best AS (
      SELECT mp.*, c.name_en, c.name_hi, c.category,
        ROW_NUMBER() OVER (
          PARTITION BY mp.commodity
          ORDER BY mp.modal_price DESC, mp.market ASC
        ) AS rn
      FROM mandi_prices mp
      LEFT JOIN commodities c ON mp.commodity = c.name_api
      WHERE mp.district = @district AND mp.arrival_date = @today
    )
    SELECT * FROM best WHERE rn = 1
    ORDER BY modal_price DESC
  `).all({ district, today: todayKolkata });

  for (const row of tier1Rows) {
    records.push({
      commodity: row.commodity,
      name_en: row.name_en || row.commodity,
      name_hi: row.name_hi || row.commodity,
      category: row.category || 'Other',
      variety: row.variety || '',
      grade: row.grade || '',
      market: row.market,
      district: row.district,
      state: row.state,
      state_display: getStateDisplay(row.state),
      arrival_date: row.arrival_date,
      min_price: row.min_price,
      max_price: row.max_price,
      modal_price: row.modal_price,
      tier: 1,
      tier_name: 'raipur_today',
      days_old: computeDaysOld(row.arrival_date, todayKolkata),
      scope: 'raipur',
      transport_warning: false
    });
    selectedSet.add(row.commodity);
  }

  // TIER 2: Historical lookback, Raipur district (up to 49 days)
  if (hasSearch || records.length < threshold) {
    const tier2Rows = db.prepare(`
      WITH best AS (
        SELECT mp.*, c.name_en, c.name_hi, c.category,
          ROW_NUMBER() OVER (
            PARTITION BY mp.commodity
            ORDER BY mp.arrival_date DESC, mp.modal_price DESC, mp.market ASC
          ) AS rn
        FROM mandi_prices mp
        LEFT JOIN commodities c ON mp.commodity = c.name_api
        WHERE mp.district = @district
          AND mp.arrival_date < @today
          AND mp.arrival_date >= @cutoffDate
      )
      SELECT * FROM best WHERE rn = 1
      ORDER BY arrival_date DESC, modal_price DESC
    `).all({ district, today: todayKolkata, cutoffDate });

    for (const row of tier2Rows) {
      if (selectedSet.has(row.commodity)) continue;
      records.push({
        commodity: row.commodity,
        name_en: row.name_en || row.commodity,
        name_hi: row.name_hi || row.commodity,
        category: row.category || 'Other',
        variety: row.variety || '',
        grade: row.grade || '',
        market: row.market,
        district: row.district,
        state: row.state,
        state_display: getStateDisplay(row.state),
        arrival_date: row.arrival_date,
        min_price: row.min_price,
        max_price: row.max_price,
        modal_price: row.modal_price,
        tier: 2,
        tier_name: 'raipur_history',
        days_old: computeDaysOld(row.arrival_date, todayKolkata),
        scope: 'raipur',
        transport_warning: false
      });
      selectedSet.add(row.commodity);
      if (!hasSearch && records.length >= threshold) break;
    }
  }

  // TIER 3: Other Chhattisgarh districts (today or up to 49 days)
  if (hasSearch || records.length < threshold) {
    const tier3Rows = db.prepare(`
      WITH best AS (
        SELECT mp.*, c.name_en, c.name_hi, c.category,
          ROW_NUMBER() OVER (
            PARTITION BY mp.commodity
            ORDER BY mp.arrival_date DESC, mp.modal_price DESC, mp.market ASC
          ) AS rn
        FROM mandi_prices mp
        LEFT JOIN commodities c ON mp.commodity = c.name_api
        WHERE (mp.state LIKE '%chattisgarh%' OR mp.state LIKE '%chhattisgarh%')
          AND mp.district != @district
          AND mp.arrival_date >= @cutoffDate
      )
      SELECT * FROM best WHERE rn = 1
      ORDER BY arrival_date DESC, modal_price DESC
    `).all({ district, cutoffDate });

    for (const row of tier3Rows) {
      if (selectedSet.has(row.commodity)) continue;
      records.push({
        commodity: row.commodity,
        name_en: row.name_en || row.commodity,
        name_hi: row.name_hi || row.commodity,
        category: row.category || 'Other',
        variety: row.variety || '',
        grade: row.grade || '',
        market: row.market,
        district: row.district,
        state: row.state,
        state_display: 'Chhattisgarh / छत्तीसगढ़',
        arrival_date: row.arrival_date,
        min_price: row.min_price,
        max_price: row.max_price,
        modal_price: row.modal_price,
        tier: 3,
        tier_name: 'cg_districts',
        days_old: computeDaysOld(row.arrival_date, todayKolkata),
        scope: 'chhattisgarh',
        transport_warning: false
      });
      selectedSet.add(row.commodity);
      if (!hasSearch && records.length >= threshold) break;
    }
  }

  // TIER 4: Other states (ALWAYS LAST, neighbor-state priority)
  if (hasSearch || records.length < threshold) {
    const tier4Rows = db.prepare(`
      WITH best AS (
        SELECT mp.*, c.name_en, c.name_hi, c.category,
          ROW_NUMBER() OVER (
            PARTITION BY mp.commodity
            ORDER BY
              CASE mp.state
                WHEN 'Madhya Pradesh' THEN 1
                WHEN 'Maharashtra' THEN 2
                WHEN 'Odisha' THEN 3
                WHEN 'Jharkhand' THEN 4
                WHEN 'Uttar Pradesh' THEN 5
                WHEN 'Telangana' THEN 6
                WHEN 'Andhra Pradesh' THEN 7
                ELSE 8
              END ASC,
              mp.arrival_date DESC,
              mp.modal_price DESC,
              mp.market ASC
          ) AS rn
        FROM mandi_prices mp
        LEFT JOIN commodities c ON mp.commodity = c.name_api
        WHERE NOT (mp.state LIKE '%chattisgarh%' OR mp.state LIKE '%chhattisgarh%')
          AND mp.arrival_date >= @cutoffDate
      )
      SELECT * FROM best WHERE rn = 1
      ORDER BY
        CASE state
          WHEN 'Madhya Pradesh' THEN 1
          WHEN 'Maharashtra' THEN 2
          WHEN 'Odisha' THEN 3
          WHEN 'Jharkhand' THEN 4
          WHEN 'Uttar Pradesh' THEN 5
          WHEN 'Telangana' THEN 6
          WHEN 'Andhra Pradesh' THEN 7
          ELSE 8
        END ASC,
        modal_price DESC
    `).all({ cutoffDate });

    for (const row of tier4Rows) {
      if (selectedSet.has(row.commodity)) continue;
      records.push({
        commodity: row.commodity,
        name_en: row.name_en || row.commodity,
        name_hi: row.name_hi || row.commodity,
        category: row.category || 'Other',
        variety: row.variety || '',
        grade: row.grade || '',
        market: row.market,
        district: row.district,
        state: row.state,
        state_display: getStateDisplay(row.state),
        arrival_date: row.arrival_date,
        min_price: row.min_price,
        max_price: row.max_price,
        modal_price: row.modal_price,
        tier: 4,
        tier_name: 'other_state',
        days_old: computeDaysOld(row.arrival_date, todayKolkata),
        scope: 'other_state',
        transport_warning: true
      });
      selectedSet.add(row.commodity);
      if (!hasSearch && records.length >= threshold) break;
    }
  }

  let filtered = records;

  if (category) {
    filtered = filtered.filter(r => (r.category || '').toLowerCase() === category.toLowerCase());
  }

  if (hasSearch) {
    const q = query.trim().normalize('NFC').toLowerCase();
    const normalizeHindi = (s) => s.normalize('NFC').toLowerCase().replace(/[\u0901\u0902]/g, '\u0902');
    const qNorm = normalizeHindi(q);
    filtered = filtered.filter(r => {
      const nameEn = (r.name_en || r.commodity).toLowerCase();
      const nameHi = normalizeHindi(r.name_hi || '');
      const cat = (r.category || '').toLowerCase();
      const variety = (r.variety || '').toLowerCase();
      const districtName = (r.district || '').toLowerCase();
      const stateName = (r.state || '').toLowerCase();
      const marketName = (r.market || '').toLowerCase();
      const commodity = r.commodity.toLowerCase();
      return nameEn.includes(q) || nameHi.includes(qNorm) || cat.includes(q) ||
             variety.includes(q) || commodity.includes(q) || districtName.includes(q) ||
             stateName.includes(q) || marketName.includes(q);
    });
  }

  return {
    threshold,
    is_search: hasSearch,
    reference_date: todayKolkata,
    tiers_present: [...new Set(filtered.map(r => r.tier))],
    count: filtered.length,
    records: filtered
  };
}

/**
 * 300km Radius Filtering Engine (Option A: Nearest First, Option B: Multi-Mandi Comparison)
 * Retrieves latest price per commodity per mandi within 300km of the user's location.
 * Distance is computed via Haversine formula based on user GPS (defaulting to Raipur if unavailable).
 * Mandis are strictly sorted ascending by distance (Raipur 0km -> Durg ~37km -> Rajnandgaon ~69km -> Bilaspur, etc.).
 * Multi-mandi records are preserved so farmers can compare prices across different nearby markets for arbitrage.
 */
function getMarketPricesRadius({ lat = 21.2514, lng = 81.6296, maxRadiusKm = 300, query = '', category = '' } = {}) {
  const db = getDb();
  const todayKolkata = getTodayDateKolkata();
  const cutoffDate = getCutoffDateStr(todayKolkata, MAX_HISTORICAL_LOOKBACK_DAYS);
  const userLat = Number(lat) || haversine.DEFAULT_COORDS.lat;
  const userLng = Number(lng) || haversine.DEFAULT_COORDS.lng;

  // Retrieve the latest arrival_date record for each commodity at each market within cutoff window
  const sql = `
    WITH latest AS (
      SELECT market, district, commodity, MAX(arrival_date) AS max_date
      FROM mandi_prices
      WHERE arrival_date >= @cutoffDate
      GROUP BY market, district, commodity
    ),
    best AS (
      SELECT mp.*, c.name_en, c.name_hi, c.category,
        ROW_NUMBER() OVER (
          PARTITION BY mp.market, mp.district, mp.commodity
          ORDER BY mp.modal_price DESC
        ) AS rn
      FROM mandi_prices mp
      JOIN latest l ON mp.market = l.market AND mp.district = l.district AND mp.commodity = l.commodity AND mp.arrival_date = l.max_date
      LEFT JOIN commodities c ON mp.commodity = c.name_api
    )
    SELECT * FROM best WHERE rn = 1
  `;

  const rows = db.prepare(sql).all({ cutoffDate });

  const records = [];
  for (const row of rows) {
    const coords = haversine.getMandiCoordinates(row.market, row.district);
    let dist = null;
    if (coords) {
      dist = haversine.calculateHaversineDistanceKm(userLat, userLng, coords.lat, coords.lng);
    } else {
      const isCG = (row.state && (row.state.toLowerCase().includes('chattisgarh') || row.state.toLowerCase().includes('chhattisgarh')));
      dist = isCG ? 180.0 : 350.0;
    }

    // Filter to radius
    if (dist > maxRadiusKm) continue;

    const daysOld = computeDaysOld(row.arrival_date, todayKolkata);
    const isToday = daysOld === 0;
    const isCG = (row.state && (row.state.toLowerCase().includes('chattisgarh') || row.state.toLowerCase().includes('chhattisgarh')));
    const isUserDistrict = row.district && row.district.toLowerCase() === 'raipur';

    let tier = 1;
    let tierName = 'today';
    if (isToday) {
      tier = 1;
      tierName = 'today';
    } else if (daysOld > 0 && isUserDistrict) {
      tier = 2;
      tierName = 'raipur_history';
    } else if (isCG) {
      tier = 3;
      tierName = 'cg_districts';
    } else {
      tier = 4;
      tierName = 'other_state';
    }

    records.push({
      commodity: row.commodity,
      name_en: row.name_en || row.commodity,
      name_hi: row.name_hi || row.commodity,
      category: row.category || 'Other',
      variety: row.variety || '',
      grade: row.grade || '',
      market: row.market,
      district: row.district,
      state: row.state,
      state_display: getStateDisplay(row.state),
      arrival_date: row.arrival_date,
      min_price: row.min_price,
      max_price: row.max_price,
      modal_price: row.modal_price,
      distance_km: dist,
      tier,
      tier_name: tierName,
      days_old: daysOld,
      scope: isUserDistrict ? 'raipur' : (isCG ? 'chhattisgarh' : 'other_state'),
      transport_warning: !isCG,
      source: row.source || 'data.gov.in',
      coordinates: coords
    });
  }

  // Strictly sort ascending by distance (Nearest Mandi First!), then arrival_date DESC, then modal_price DESC
  records.sort((a, b) => {
    if (a.distance_km !== b.distance_km) {
      return a.distance_km - b.distance_km;
    }
    if (a.arrival_date !== b.arrival_date) {
      return b.arrival_date.localeCompare(a.arrival_date);
    }
    return b.modal_price - a.modal_price;
  });

  let filtered = records;

  if (category) {
    filtered = filtered.filter(r => (r.category || '').toLowerCase() === category.toLowerCase());
  }

  if (query && query.trim()) {
    const q = query.trim().normalize('NFC').toLowerCase();
    const normalizeHindi = (s) => s.normalize('NFC').toLowerCase().replace(/[\u0901\u0902]/g, '\u0902');
    const qNorm = normalizeHindi(q);
    filtered = filtered.filter(r => {
      const nameEn = (r.name_en || r.commodity).toLowerCase();
      const nameHi = normalizeHindi(r.name_hi || '');
      const cat = (r.category || '').toLowerCase();
      const variety = (r.variety || '').toLowerCase();
      const districtName = (r.district || '').toLowerCase();
      const stateName = (r.state || '').toLowerCase();
      const marketName = (r.market || '').toLowerCase();
      const commodity = r.commodity.toLowerCase();
      return nameEn.includes(q) || nameHi.includes(qNorm) || cat.includes(q) ||
             variety.includes(q) || commodity.includes(q) || districtName.includes(q) ||
             stateName.includes(q) || marketName.includes(q);
    });
  }

  return {
    radius_km: maxRadiusKm,
    user_coords: { lat: userLat, lng: userLng },
    reference_date: todayKolkata,
    count: filtered.length,
    records: filtered
  };
}

/**
 * Scoped price lookup for Gemini Tools:
 * Looks up in this order:
 * 1. Raipur markets (scope: 'raipur')
 * 2. Other Chhattisgarh markets (scope: 'chhattisgarh')
 * 3. Neighboring states: MP, Maharashtra, Odisha, Jharkhand, UP, Telangana, Andhra (scope: 'other_state')
 */
function getMandiPricesScoped(commodityApiName, marketFilter = null) {
  const db = getDb();
  
  const isDistrictFilter = marketFilter && (marketFilter.toLowerCase() === 'raipur' || marketFilter.toLowerCase() === 'all');

  // 1. Try Raipur district first
  let queryRaipur = `
    WITH latest AS (
      SELECT MAX(arrival_date) AS max_date
      FROM mandi_prices
      WHERE commodity = @commodity AND district = 'Raipur'
    )
    SELECT mp.*, c.name_en, c.name_hi, c.category, 'raipur' AS scope
    FROM mandi_prices mp
    JOIN latest l ON mp.arrival_date = l.max_date
    LEFT JOIN commodities c ON mp.commodity = c.name_api
    WHERE mp.commodity = @commodity AND mp.district = 'Raipur'
  `;
  const paramsRaipur = { commodity: commodityApiName };
  if (marketFilter && !isDistrictFilter) {
    const specificRaipur = db.prepare(queryRaipur + ` AND LOWER(mp.market) LIKE '%' || @market || '%' ORDER BY mp.modal_price DESC`)
      .all({ ...paramsRaipur, market: marketFilter.toLowerCase() });
    if (specificRaipur.length > 0) return specificRaipur;
  }
  queryRaipur += ` ORDER BY mp.modal_price DESC`;
  const raipurResults = db.prepare(queryRaipur).all(paramsRaipur);
  if (raipurResults.length > 0) return raipurResults;

  // 2. Try other Chhattisgarh markets
  let queryCG = `
    WITH latest AS (
      SELECT MAX(arrival_date) AS max_date
      FROM mandi_prices
      WHERE commodity = @commodity AND state IN ('Chattisgarh', 'Chhattisgarh')
    )
    SELECT mp.*, c.name_en, c.name_hi, c.category, 'chhattisgarh' AS scope
    FROM mandi_prices mp
    JOIN latest l ON mp.arrival_date = l.max_date
    LEFT JOIN commodities c ON mp.commodity = c.name_api
    WHERE mp.commodity = @commodity AND mp.state IN ('Chattisgarh', 'Chhattisgarh')
  `;
  const paramsCG = { commodity: commodityApiName };
  if (marketFilter && !isDistrictFilter) {
    const specificCG = db.prepare(queryCG + ` AND LOWER(mp.market) LIKE '%' || @market || '%' ORDER BY mp.modal_price DESC LIMIT 5`)
      .all({ ...paramsCG, market: marketFilter.toLowerCase() });
    if (specificCG.length > 0) return specificCG;
  }
  queryCG += ` ORDER BY mp.modal_price DESC LIMIT 5`;
  const cgResults = db.prepare(queryCG).all(paramsCG);
  if (cgResults.length > 0) return cgResults;

  // 3. Other states ordered by fixed neighbor list:
  // Madhya Pradesh, Maharashtra, Odisha, Jharkhand, Uttar Pradesh, Telangana, Andhra Pradesh, then all others; within each state by highest modal price
  let queryOther = `
    WITH latest AS (
      SELECT state, district, market, MAX(arrival_date) AS max_date
      FROM mandi_prices
      WHERE commodity = @commodity AND state NOT IN ('Chattisgarh', 'Chhattisgarh')
      GROUP BY state, district, market
    )
    SELECT mp.*, c.name_en, c.name_hi, c.category, 'other_state' AS scope
    FROM mandi_prices mp
    JOIN latest l ON mp.state = l.state AND mp.district = l.district AND mp.market = l.market AND mp.arrival_date = l.max_date
    LEFT JOIN commodities c ON mp.commodity = c.name_api
    WHERE mp.commodity = @commodity AND mp.state NOT IN ('Chattisgarh', 'Chhattisgarh')
  `;
  const paramsOther = { commodity: commodityApiName };
  const orderOther = `
    ORDER BY
      CASE mp.state
        WHEN 'Madhya Pradesh' THEN 1
        WHEN 'Maharashtra' THEN 2
        WHEN 'Odisha' THEN 3
        WHEN 'Jharkhand' THEN 4
        WHEN 'Uttar Pradesh' THEN 5
        WHEN 'Telangana' THEN 6
        WHEN 'Andhra Pradesh' THEN 7
        ELSE 8
      END ASC,
      mp.modal_price DESC
    LIMIT 10
  `;
  if (marketFilter && !isDistrictFilter) {
    const specificOther = db.prepare(queryOther + ` AND LOWER(mp.market) LIKE '%' || @market || '%'` + orderOther)
      .all({ ...paramsOther, market: marketFilter.toLowerCase() });
    if (specificOther.length > 0) return specificOther;
  }
  return db.prepare(queryOther + orderOther).all(paramsOther);
}

/**
 * Scoped compare_markets for Gemini Tools
 */
function compareMarketsScoped(commodityApiName) {
  const db = getDb();
  // Try Raipur first
  const raipur = db.prepare(`
    WITH latest AS (
      SELECT MAX(arrival_date) AS max_date
      FROM mandi_prices
      WHERE commodity = @commodity AND district = 'Raipur'
    )
    SELECT mp.market, mp.district, mp.state, mp.variety, mp.min_price, mp.max_price, mp.modal_price, mp.arrival_date, 'raipur' AS scope
    FROM mandi_prices mp, latest l
    WHERE mp.commodity = @commodity AND mp.district = 'Raipur' AND mp.arrival_date = l.max_date
    ORDER BY mp.modal_price DESC
  `).all({ commodity: commodityApiName });

  if (raipur.length >= 2) return raipur;

  // If Raipur has <= 1 market, include other Chhattisgarh markets
  const cg = db.prepare(`
    WITH latest AS (
      SELECT MAX(arrival_date) AS max_date
      FROM mandi_prices
      WHERE commodity = @commodity AND state IN ('Chattisgarh', 'Chhattisgarh')
    )
    SELECT mp.market, mp.district, mp.state, mp.variety, mp.min_price, mp.max_price, mp.modal_price, mp.arrival_date,
      CASE WHEN mp.district = 'Raipur' THEN 'raipur' ELSE 'chhattisgarh' END AS scope
    FROM mandi_prices mp, latest l
    WHERE mp.commodity = @commodity AND mp.state IN ('Chattisgarh', 'Chhattisgarh') AND mp.arrival_date = l.max_date
    ORDER BY mp.modal_price DESC LIMIT 10
  `).all({ commodity: commodityApiName });

  if (cg.length > 0) return cg;

  // Otherwise compare across other states ordered by fixed neighbor list
  return db.prepare(`
    WITH latest AS (
      SELECT state, district, market, MAX(arrival_date) AS max_date
      FROM mandi_prices
      WHERE commodity = @commodity AND state NOT IN ('Chattisgarh', 'Chhattisgarh')
      GROUP BY state, district, market
    )
    SELECT mp.market, mp.district, mp.state, mp.variety, mp.min_price, mp.max_price, mp.modal_price, mp.arrival_date, 'other_state' AS scope
    FROM mandi_prices mp, latest l
    WHERE mp.commodity = @commodity AND mp.state NOT IN ('Chattisgarh', 'Chhattisgarh') AND mp.arrival_date = l.max_date
    ORDER BY
      CASE mp.state
        WHEN 'Madhya Pradesh' THEN 1
        WHEN 'Maharashtra' THEN 2
        WHEN 'Odisha' THEN 3
        WHEN 'Jharkhand' THEN 4
        WHEN 'Uttar Pradesh' THEN 5
        WHEN 'Telangana' THEN 6
        WHEN 'Andhra Pradesh' THEN 7
        ELSE 8
      END ASC,
      mp.modal_price DESC
    LIMIT 10
  `).all({ commodity: commodityApiName });
}

/**
 * Scoped get_price_history for Gemini Tools
 */
function getPriceHistoryScoped(commodityApiName, days = 30) {
  const db = getDb();
  const dateSort = `SUBSTR(arrival_date, 7, 4) || '-' || SUBSTR(arrival_date, 4, 2) || '-' || SUBSTR(arrival_date, 1, 2)`;

  // Try Raipur first
  const raipur = db.prepare(`
    SELECT arrival_date, market, district, state, variety, min_price, max_price, modal_price, 'raipur' AS scope
    FROM mandi_prices
    WHERE commodity = @commodity AND district = 'Raipur'
    ORDER BY ${dateSort} DESC, modal_price DESC
    LIMIT @limit
  `).all({ commodity: commodityApiName, limit: days * 10 });

  if (raipur.length > 0) return { scope: 'raipur', records: raipur };

  // Try Chhattisgarh
  const cg = db.prepare(`
    SELECT arrival_date, market, district, state, variety, min_price, max_price, modal_price, 'chhattisgarh' AS scope
    FROM mandi_prices
    WHERE commodity = @commodity AND state IN ('Chattisgarh', 'Chhattisgarh')
    ORDER BY ${dateSort} DESC, modal_price DESC
    LIMIT 30
  `).all({ commodity: commodityApiName });

  if (cg.length > 0) return { scope: 'chhattisgarh', records: cg };

  // Try other states ordered by fixed neighbor list
  const other = db.prepare(`
    SELECT arrival_date, market, district, state, variety, min_price, max_price, modal_price, 'other_state' AS scope
    FROM mandi_prices
    WHERE commodity = @commodity AND state NOT IN ('Chattisgarh', 'Chhattisgarh')
    ORDER BY
      CASE state
        WHEN 'Madhya Pradesh' THEN 1
        WHEN 'Maharashtra' THEN 2
        WHEN 'Odisha' THEN 3
        WHEN 'Jharkhand' THEN 4
        WHEN 'Uttar Pradesh' THEN 5
        WHEN 'Telangana' THEN 6
        WHEN 'Andhra Pradesh' THEN 7
        ELSE 8
      END ASC,
      ${dateSort} DESC, modal_price DESC
    LIMIT 30
  `).all({ commodity: commodityApiName });

  return { scope: 'other_state', records: other };
}

/**
 * Calculate trend percentage between last 2 available arrival dates.
 * Returns null if fewer than 2 dates exist. Never fake it!
 */
function getTrendPct(commodity, market = null, district = 'Raipur') {
  const db = getDb();
  let sql = `
    SELECT arrival_date, modal_price
    FROM mandi_prices
    WHERE commodity = @commodity AND district = @district
  `;
  const params = { commodity, district };
  if (market) {
    sql += ` AND market = @market`;
    params.market = market;
  }
  sql += ` GROUP BY arrival_date ORDER BY arrival_date DESC LIMIT 2`;

  const rows = db.prepare(sql).all(params);
  if (rows.length < 2 || !rows[0].modal_price || !rows[1].modal_price) return null;
  return Number(((rows[0].modal_price - rows[1].modal_price) / rows[1].modal_price * 100).toFixed(1));
}

function getDistinctCommodities(district = 'Raipur') {
  const db = getDb();
  return db.prepare(`
    SELECT DISTINCT mp.commodity, c.name_en, c.name_hi, c.category
    FROM mandi_prices mp
    LEFT JOIN commodities c ON mp.commodity = c.name_api
    WHERE mp.district = @district
    ORDER BY COALESCE(c.name_en, mp.commodity)
  `).all({ district });
}

function getDistinctMarkets(district = 'Raipur') {
  const db = getDb();
  return db.prepare(`
    SELECT DISTINCT market FROM mandi_prices WHERE district = @district ORDER BY market
  `).all({ district });
}

// --- Commodities ---

function upsertCommodity(row) {
  const db = getDb();
  return stmt(db, 'upsertCommodity', `
    INSERT INTO commodities (name_api, name_en, name_hi, category)
    VALUES (@name_api, @name_en, @name_hi, @category)
    ON CONFLICT(name_api) DO UPDATE SET
      name_en = excluded.name_en,
      name_hi = excluded.name_hi,
      category = excluded.category
  `).run(row);
}

function resolveCommodity(input) {
  const db = getDb();
  if (!input || typeof input !== 'string') return { match: 'none' };

  const normalizeHindi = (s) => (s || '').normalize('NFC').toLowerCase().replace(/[\u0901\u0902]/g, '\u0902');
  const q = input.trim().normalize('NFC').toLowerCase();
  const qHi = normalizeHindi(input.trim());

  // 1. Exact match on name_api or name_en
  let row = db.prepare(`
    SELECT * FROM commodities
    WHERE LOWER(name_api) = @q OR LOWER(name_en) = @q
  `).get({ q });
  if (row) return { match: 'exact', commodity: row };

  // 2. Hindi exact match with anusvara normalization
  const all = db.prepare(`SELECT * FROM commodities`).all();
  for (const c of all) {
    if (normalizeHindi(c.name_hi) === qHi) {
      return { match: 'exact', commodity: c };
    }
  }

  // 3. Fuzzy match: contains query
  const candidates = all.filter(c => {
    return c.name_api.toLowerCase().includes(q) ||
           c.name_en.toLowerCase().includes(q) ||
           normalizeHindi(c.name_hi).includes(qHi);
  });
  if (candidates.length === 1) return { match: 'fuzzy', commodity: candidates[0] };
  if (candidates.length > 1) return { match: 'ambiguous', candidates };
  return { match: 'none' };
}

// --- Sync Log ---

function addSyncLog(entry) {
  const db = getDb();
  return db.prepare(`
    INSERT INTO sync_log (started_at, state, district, status, rows_fetched, rows_upserted, total_feed_rows, raipur_rows, chhattisgarh_rows, raipur_commodities, error)
    VALUES (@started_at, @state, @district, @status, @rows_fetched, @rows_upserted, @total_feed_rows, @raipur_rows, @chhattisgarh_rows, @raipur_commodities, @error)
  `).run({
    started_at: entry.started_at,
    state: entry.state || 'All',
    district: entry.district || 'All',
    status: entry.status || 'running',
    rows_fetched: entry.rows_fetched || 0,
    rows_upserted: entry.rows_upserted || 0,
    total_feed_rows: entry.total_feed_rows || 0,
    raipur_rows: entry.raipur_rows || 0,
    chhattisgarh_rows: entry.chhattisgarh_rows || 0,
    raipur_commodities: entry.raipur_commodities || 0,
    error: entry.error || null
  });
}

function updateSyncLog(id, updates) {
  const db = getDb();
  return db.prepare(`
    UPDATE sync_log SET finished_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
      status = @status,
      rows_fetched = @rows_fetched,
      rows_upserted = @rows_upserted,
      total_feed_rows = @total_feed_rows,
      raipur_rows = @raipur_rows,
      chhattisgarh_rows = @chhattisgarh_rows,
      raipur_commodities = @raipur_commodities,
      error = @error
    WHERE id = @id
  `).run({
    id,
    status: updates.status,
    rows_fetched: updates.rows_fetched || 0,
    rows_upserted: updates.rows_upserted || 0,
    total_feed_rows: updates.total_feed_rows || 0,
    raipur_rows: updates.raipur_rows || 0,
    chhattisgarh_rows: updates.chhattisgarh_rows || 0,
    raipur_commodities: updates.raipur_commodities || 0,
    error: updates.error || null
  });
}

function getLastSync() {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM sync_log
    WHERE status = 'success'
    ORDER BY finished_at DESC LIMIT 1
  `).get();
}

function getSyncMeta(district = 'Raipur') {
  const db = getDb();
  const lastSync = getLastSync();
  const latestDate = db.prepare(`
    SELECT MAX(arrival_date) AS latest_date FROM mandi_prices WHERE district = @district
  `).get({ district });
  const rowCount = db.prepare(`
    SELECT COUNT(*) AS cnt FROM mandi_prices WHERE district = @district
  `).get({ district });
  const totalDbRows = db.prepare(`SELECT COUNT(*) AS cnt FROM mandi_prices`).get().cnt;

  // Recent fetch count logs
  const fetchCountLogs = db.prepare(`
    SELECT id, started_at, finished_at, status, total_feed_rows, raipur_rows, chhattisgarh_rows, raipur_commodities
    FROM sync_log
    WHERE status = 'success'
    ORDER BY finished_at DESC LIMIT 10
  `).all();

  return {
    last_updated: lastSync ? lastSync.finished_at : null,
    latest_data_date: latestDate ? latestDate.latest_date : null,
    row_count: rowCount ? rowCount.cnt : 0,
    total_db_rows: totalDbRows,
    stale: !lastSync,
    fetch_count_log: fetchCountLogs
  };
}

// --- Sessions ---

function createSession({ id, client_id, mode, title, language }) {
  const db = getDb();
  return db.prepare(`
    INSERT INTO sessions (id, client_id, mode, title, language)
    VALUES (@id, @client_id, @mode, @title, @language)
  `).run({ id, client_id, mode, title: title || '', language: language || 'hi' });
}

function getSessions(client_id, mode) {
  const db = getDb();
  let sql = `SELECT * FROM sessions WHERE client_id = @client_id`;
  const params = { client_id };
  if (mode) {
    sql += ` AND mode = @mode`;
    params.mode = mode;
  }
  sql += ` ORDER BY updated_at DESC LIMIT 100`;
  return db.prepare(sql).all(params);
}

function getSession(id, client_id) {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM sessions WHERE id = @id AND client_id = @client_id
  `).get({ id, client_id });
}

function deleteSession(id, client_id) {
  const db = getDb();
  const session = getSession(id, client_id);
  if (!session) return null;
  db.prepare(`DELETE FROM messages WHERE session_id = @id`).run({ id });
  db.prepare(`DELETE FROM sessions WHERE id = @id`).run({ id });
  return session;
}

function touchSession(id) {
  const db = getDb();
  db.prepare(`UPDATE sessions SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = @id`).run({ id });
}

// --- Messages ---

function addMessage({ id, session_id, role, content, sources_json }) {
  const db = getDb();
  return db.prepare(`
    INSERT INTO messages (id, session_id, role, content, sources_json)
    VALUES (@id, @session_id, @role, @content, @sources_json)
  `).run({ id, session_id, role, content, sources_json: sources_json || null });
}

function getMessages(session_id) {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM messages WHERE session_id = @session_id ORDER BY created_at ASC
  `).all({ session_id });
}

function pruneOldSessions(client_id, maxSessions = 100) {
  const db = getDb();
  const count = db.prepare(`SELECT COUNT(*) AS cnt FROM sessions WHERE client_id = @client_id`).get({ client_id });
  if (count.cnt <= maxSessions) return 0;
  const excess = count.cnt - maxSessions;
  const old = db.prepare(`
    SELECT id FROM sessions WHERE client_id = @client_id ORDER BY updated_at ASC LIMIT @excess
  `).all({ client_id, excess });
  const del = db.transaction((ids) => {
    for (const { id } of ids) {
      db.prepare(`DELETE FROM messages WHERE session_id = @id`).run({ id });
      db.prepare(`DELETE FROM sessions WHERE id = @id`).run({ id });
    }
    return ids.length;
  });
  return del(old);
}

module.exports = {
  getDb,
  upsertPriceMany, getLatestPrices, getMarketPricesCascaded, getMarketPricesRadius,
  MIN_COMMODITIES_THRESHOLD, MAX_HISTORICAL_LOOKBACK_DAYS, getStateDisplay,
  getMandiPricesScoped, compareMarketsScoped, getPriceHistoryScoped, getTrendPct,
  getDistinctCommodities, getDistinctMarkets,
  upsertCommodity, resolveCommodity,
  addSyncLog, updateSyncLog, getLastSync, getSyncMeta,
  createSession, getSessions, getSession, deleteSession, touchSession,
  addMessage, getMessages, pruneOldSessions
};
