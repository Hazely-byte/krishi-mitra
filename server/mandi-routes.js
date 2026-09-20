'use strict';

const express = require('express');
const db = require('./db');
const mandi = require('./mandi');

const router = express.Router();

/**
 * GET /api/mandi
 * Query mandi prices with cascading fallback:
 * Tier 1 (Raipur today) -> Tier 2 (Raipur history <= 49d) -> Tier 3 (Other CG districts) -> Tier 4 (Other states)
 * Search query unconditionally queries all four tiers, bypassing MIN_COMMODITIES_THRESHOLD.
 */
router.get('/', (req, res) => {
  const district = req.query.district || 'Raipur';
  const q = req.query.q || '';
  const category = req.query.category || '';

  const cascadeResult = db.getMarketPricesCascaded({ district, query: q, category });
  const meta = db.getSyncMeta(district);

  // Distinct markets present in the result
  const marketNames = [...new Set(cascadeResult.records.map(p => p.market))].join(' / ') || `${district} Mandi`;

  const records = cascadeResult.records.map(p => ({
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
    tier: p.tier,
    tier_name: p.tier_name,
    days_old: p.days_old,
    scope: p.scope,
    transport_warning: Boolean(p.transport_warning),
    trend_pct: db.getTrendPct(p.commodity, p.market, p.district)
  }));

  res.json({
    location: {
      state: 'Chhattisgarh',
      district,
      market: marketNames
    },
    last_updated: meta.last_updated,
    latest_data_date: meta.latest_data_date,
    reference_date: cascadeResult.reference_date,
    stale: meta.stale,
    threshold: cascadeResult.threshold,
    is_search: cascadeResult.is_search,
    tiers_present: cascadeResult.tiers_present,
    count: records.length,
    records
  });
});

/**
 * POST /api/mandi/refresh
 * Trigger manual refresh with 10-minute cooldown
 */
router.post('/refresh', async (req, res) => {
  const apiKey = process.env.DATA_GOV_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'DATA_GOV_API_KEY not configured' });
  }

  try {
    const result = await mandi.manualRefresh(apiKey);
    res.json(result);
  } catch (err) {
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
