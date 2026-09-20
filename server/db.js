'use strict';

const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, '..', 'data', 'krishi.db');

let _db = null;

function getDb() {
  if (_db) return _db;
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
      fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
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
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_client
      ON sessions(client_id, mode);

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      sources_json TEXT,
      created_at TEXT DEFAULT (datetime('now'))
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
  } catch (e) {
    // Ignore if already migrated
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
    INSERT INTO mandi_prices (state, district, market, commodity, variety, grade, arrival_date, min_price, max_price, modal_price, fetched_at)
    VALUES (@state, @district, @market, @commodity, @variety, @grade, @arrival_date, @min_price, @max_price, @modal_price, datetime('now'))
    ON CONFLICT(state, district, market, commodity, variety, grade, arrival_date)
    DO UPDATE SET
      min_price = excluded.min_price,
      max_price = excluded.max_price,
      modal_price = excluded.modal_price,
      fetched_at = datetime('now')
  `);
  const tx = db.transaction((rows) => {
    let upserted = 0;
    for (const row of rows) {
      const info = upsert.run(row);
      if (info.changes > 0) upserted++;
    }
    return upserted;
  });
  return tx(rows);
}

/**
 * Get latest prices for Raipur Market Page.
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
 * Scoped price lookup for Gemini Tools:
 * Looks up in this order:
 * 1. Raipur markets (scope: 'raipur')
 * 2. Other Chhattisgarh markets (scope: 'chhattisgarh')
 * 3. Neighboring states: MP, Maharashtra, Odisha, Jharkhand, UP, Telangana, Andhra (scope: 'other_state')
 */
function getMandiPricesScoped(commodityApiName, marketFilter = null) {
  const db = getDb();
  
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
  if (marketFilter) {
    queryRaipur += ` AND LOWER(mp.market) LIKE '%' || @market || '%'`;
    paramsRaipur.market = marketFilter.toLowerCase();
  }
  queryRaipur += ` ORDER BY mp.modal_price DESC`;
  const raipurResults = db.prepare(queryRaipur).all(paramsRaipur);
  if (raipurResults.length > 0) return raipurResults;

  // 2. Try other Chhattisgarh markets
  let queryCG = `
    WITH latest AS (
      SELECT MAX(arrival_date) AS max_date
      FROM mandi_prices
      WHERE commodity = @commodity AND state = 'Chattisgarh'
    )
    SELECT mp.*, c.name_en, c.name_hi, c.category, 'chhattisgarh' AS scope
    FROM mandi_prices mp
    JOIN latest l ON mp.arrival_date = l.max_date
    LEFT JOIN commodities c ON mp.commodity = c.name_api
    WHERE mp.commodity = @commodity AND mp.state = 'Chattisgarh'
  `;
  const paramsCG = { commodity: commodityApiName };
  if (marketFilter) {
    queryCG += ` AND LOWER(mp.market) LIKE '%' || @market || '%'`;
    paramsCG.market = marketFilter.toLowerCase();
  }
  queryCG += ` ORDER BY mp.modal_price DESC LIMIT 5`;
  const cgResults = db.prepare(queryCG).all(paramsCG);
  if (cgResults.length > 0) return cgResults;

  // 3. Try neighboring states
  const NEIGHBOR_STATES = [
    'Madhya Pradesh', 'Maharashtra', 'Odisha', 'Jharkhand',
    'Uttar Pradesh', 'Telangana', 'Andhra Pradesh'
  ];
  const placeholders = NEIGHBOR_STATES.map(() => '?').join(',');
  const queryNeighbors = `
    WITH latest AS (
      SELECT MAX(arrival_date) AS max_date
      FROM mandi_prices
      WHERE commodity = ? AND state IN (${placeholders})
    )
    SELECT mp.*, c.name_en, c.name_hi, c.category, 'other_state' AS scope
    FROM mandi_prices mp
    JOIN latest l ON mp.arrival_date = l.max_date
    LEFT JOIN commodities c ON mp.commodity = c.name_api
    WHERE mp.commodity = ? AND mp.state IN (${placeholders})
    ORDER BY mp.modal_price DESC LIMIT 5
  `;
  const neighborResults = db.prepare(queryNeighbors).all(commodityApiName, ...NEIGHBOR_STATES, commodityApiName, ...NEIGHBOR_STATES);
  if (neighborResults.length > 0) return neighborResults;

  // 4. Any state anywhere
  const queryAny = `
    WITH latest AS (
      SELECT MAX(arrival_date) AS max_date
      FROM mandi_prices
      WHERE commodity = @commodity
    )
    SELECT mp.*, c.name_en, c.name_hi, c.category, 'other_state' AS scope
    FROM mandi_prices mp
    JOIN latest l ON mp.arrival_date = l.max_date
    LEFT JOIN commodities c ON mp.commodity = c.name_api
    WHERE mp.commodity = @commodity
    ORDER BY mp.modal_price DESC LIMIT 5
  `;
  return db.prepare(queryAny).all({ commodity: commodityApiName });
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
      WHERE commodity = @commodity AND state = 'Chattisgarh'
    )
    SELECT mp.market, mp.district, mp.state, mp.variety, mp.min_price, mp.max_price, mp.modal_price, mp.arrival_date,
      CASE WHEN mp.district = 'Raipur' THEN 'raipur' ELSE 'chhattisgarh' END AS scope
    FROM mandi_prices mp, latest l
    WHERE mp.commodity = @commodity AND mp.state = 'Chattisgarh' AND mp.arrival_date = l.max_date
    ORDER BY mp.modal_price DESC LIMIT 10
  `).all({ commodity: commodityApiName });

  if (cg.length > 0) return cg;

  // Otherwise compare across neighboring states
  const NEIGHBOR_STATES = [
    'Madhya Pradesh', 'Maharashtra', 'Odisha', 'Jharkhand',
    'Uttar Pradesh', 'Telangana', 'Andhra Pradesh'
  ];
  const placeholders = NEIGHBOR_STATES.map(() => '?').join(',');
  return db.prepare(`
    WITH latest AS (
      SELECT MAX(arrival_date) AS max_date
      FROM mandi_prices
      WHERE commodity = ? AND state IN (${placeholders})
    )
    SELECT mp.market, mp.district, mp.state, mp.variety, mp.min_price, mp.max_price, mp.modal_price, mp.arrival_date, 'other_state' AS scope
    FROM mandi_prices mp, latest l
    WHERE mp.commodity = ? AND mp.state IN (${placeholders}) AND mp.arrival_date = l.max_date
    ORDER BY mp.modal_price DESC LIMIT 10
  `).all(commodityApiName, ...NEIGHBOR_STATES, commodityApiName, ...NEIGHBOR_STATES);
}

/**
 * Scoped get_price_history for Gemini Tools
 */
function getPriceHistoryScoped(commodityApiName, days = 30) {
  const db = getDb();
  // Try Raipur first
  const raipur = db.prepare(`
    SELECT arrival_date, market, district, state, variety, min_price, max_price, modal_price, 'raipur' AS scope
    FROM mandi_prices
    WHERE commodity = @commodity AND district = 'Raipur'
      AND arrival_date >= date('now', '-' || @days || ' days')
    ORDER BY arrival_date DESC, modal_price DESC
  `).all({ commodity: commodityApiName, days });

  if (raipur.length > 0) return { scope: 'raipur', records: raipur };

  // Try Chhattisgarh
  const cg = db.prepare(`
    SELECT arrival_date, market, district, state, variety, min_price, max_price, modal_price, 'chhattisgarh' AS scope
    FROM mandi_prices
    WHERE commodity = @commodity AND state = 'Chattisgarh'
      AND arrival_date >= date('now', '-' || @days || ' days')
    ORDER BY arrival_date DESC, modal_price DESC LIMIT 30
  `).all({ commodity: commodityApiName, days });

  if (cg.length > 0) return { scope: 'chhattisgarh', records: cg };

  // Try neighboring / all
  const other = db.prepare(`
    SELECT arrival_date, market, district, state, variety, min_price, max_price, modal_price, 'other_state' AS scope
    FROM mandi_prices
    WHERE commodity = @commodity
      AND arrival_date >= date('now', '-' || @days || ' days')
    ORDER BY arrival_date DESC, modal_price DESC LIMIT 30
  `).all({ commodity: commodityApiName, days });

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
    UPDATE sync_log SET finished_at = datetime('now'),
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
  db.prepare(`UPDATE sessions SET updated_at = datetime('now') WHERE id = @id`).run({ id });
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
  upsertPriceMany, getLatestPrices, getMandiPricesScoped,
  compareMarketsScoped, getPriceHistoryScoped, getTrendPct,
  getDistinctCommodities, getDistinctMarkets,
  upsertCommodity, resolveCommodity,
  addSyncLog, updateSyncLog, getLastSync, getSyncMeta,
  createSession, getSessions, getSession, deleteSession, touchSession,
  addMessage, getMessages, pruneOldSessions
};
