'use strict';

const express = require('express');
const db = require('./db');
const mandi = require('./mandi');
const mandipulse = require('./mandipulse');
const haversine = require('./haversine');

const router = express.Router();

// Auto-trigger background MandiPulse sync on first request or if sparse
let initialMandiPulseSyncDone = false;

async function ensureMandiPulseData(force = false) {
  if (force || !initialMandiPulseSyncDone) {
    initialMandiPulseSyncDone = true;
    try {
      if (force) mandipulse.bustCache();
      await mandipulse.syncMandiPulseToDb(db);
    } catch (e) {
      console.warn('[mandi-routes] MandiPulse sync error:', e.message);
    }
  }
}

// Background initial sync
ensureMandiPulseData();

/**
 * GET /api/mandi
 * Query mandi prices with 300km Geographic Radius Engine (Option A: Nearest First, Option B: Multi-Mandi)
 * Returns records within 300km radius of user GPS (defaulting to Raipur if denied).
 * Each commodity at each nearby mandi (e.g. Durg ~37km, Rajnandgaon ~69km) is preserved
 * for multi-mandi arbitrage comparison, strictly sorted nearest first.
 */
router.get('/', async (req, res) => {
  const district = req.query.district || 'Raipur';
  const q = req.query.q || '';
  const category = req.query.category || '';
  const lat = req.query.lat ? parseFloat(req.query.lat) : haversine.DEFAULT_COORDS.lat;
  const lng = (req.query.lng || req.query.lon) ? parseFloat(req.query.lng || req.query.lon) : haversine.DEFAULT_COORDS.lng;
  const radius = req.query.radius ? parseFloat(req.query.radius) : 300;
  const forceRefresh = req.query.refresh === '1' || req.query.refresh === 'true';

  if (forceRefresh) {
    await ensureMandiPulseData(true);
  }

  let result = db.getMarketPricesRadius({ lat, lng, maxRadiusKm: radius, query: q, category });

  // If records are sparse (< 5), trigger MandiPulse fallback immediately and re-query
  if (result.count < 5 && !forceRefresh) {
    console.log(`[mandi-routes] Low commodity count (${result.count}), triggering MandiPulse fallback...`);
    await ensureMandiPulseData(true);
    result = db.getMarketPricesRadius({ lat, lng, maxRadiusKm: radius, query: q, category });
  }

  const meta = db.getSyncMeta(district);
  const marketNames = [...new Set(result.records.map(p => p.market))].join(' / ') || `${district} Mandi`;

  const records = result.records.map(p => ({
    commodity: p.commodity,
    name_en: p.name_en || p.commodity,
    name_hi: p.name_hi || p.commodity,
    category: p.category || 'Other',
    variety: p.variety || '',
    grade: p.grade || '',
    market: p.market,
    district: p.district,
    state: p.state,
    state_display: p.state_display,
    arrival_date: p.arrival_date,
    min: p.min_price,
    max: p.max_price,
    modal: p.modal_price,
    unit: 'rupees per quintal',
    distance_km: p.distance_km,
    tier: p.tier,
    tier_name: p.tier_name,
    days_old: p.days_old,
    scope: p.scope,
    transport_warning: Boolean(p.transport_warning),
    source: p.source || 'data.gov.in',
    trend_pct: db.getTrendPct(p.commodity, p.market, p.district)
  }));

  res.json({
    location: {
      state: 'Chhattisgarh',
      district,
      market: marketNames
    },
    user_coords: result.user_coords,
    radius_km: result.radius_km,
    last_updated: meta.last_updated,
    latest_data_date: meta.latest_data_date,
    reference_date: result.reference_date,
    stale: meta.stale,
    is_search: Boolean(q && q.trim()),
    count: records.length,
    records
  });
});

/**
 * POST /api/mandi/refresh
 * Trigger manual refresh: busts cache, scrapes MandiPulse, syncs data.gov.in
 */
router.post('/refresh', async (req, res) => {
  try {
    // 1. Bust and sync MandiPulse
    mandipulse.bustCache();
    const mpCount = await mandipulse.syncMandiPulseToDb(db);

    // 2. Sync data.gov.in if key present
    let govResult = { refreshed: true };
    const apiKey = process.env.DATA_GOV_API_KEY;
    if (apiKey) {
      try {
        govResult = await mandi.manualRefresh(apiKey);
      } catch (err) {
        console.warn('[refresh] data.gov.in sync warning:', err.message);
      }
    }

    const meta = db.getSyncMeta('Raipur');
    res.json({
      refreshed: true,
      mandipulse_synced: mpCount,
      data_gov: govResult,
      last_updated: meta.last_updated
    });
  } catch (err) {
    console.error('[refresh] Refresh error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/mandi/meta
 * Status, row counts, and fetch count log
 */
router.get('/meta', (req, res) => {
  const district = req.query.district || 'Raipur';
  const meta = db.getSyncMeta(district);
  res.json(meta);
});

module.exports = router;
