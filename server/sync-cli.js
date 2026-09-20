'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('./db');
const mandi = require('./mandi');

async function main() {
  const apiKey = process.env.DATA_GOV_API_KEY;
  if (!apiKey) {
    console.error('ERROR: DATA_GOV_API_KEY is not set in .env');
    process.exit(1);
  }

  console.log('=== Krishi Mitra Mandi Sync ===');
  console.log(`Starting sync with API key ${apiKey.slice(0, 8)}...`);

  const result = await mandi.syncAll(apiKey);
  console.log('\n--- Sync Results ---');
  console.log(`  Success: ${result.success}`);
  console.log(`  Total in national feed: ${result.total_feed_rows || 0}`);
  console.log(`  Rows fetched: ${result.rows_fetched || 0}`);
  console.log(`  Rows upserted: ${result.rows_upserted || 0}`);
  console.log(`  Raipur rows: ${result.raipur_rows || 0}`);
  console.log(`  Chhattisgarh rows: ${result.chhattisgarh_rows || 0}`);
  console.log(`  Raipur distinct commodities: ${result.raipur_commodities || 0}`);
  if (result.error) console.log(`  Error: ${result.error}`);

  // Generate data/commodity_names.json from the commodities table
  const allCommodities = db.getDb().prepare(`SELECT * FROM commodities ORDER BY name_api`).all();
  const commodityJsonPath = path.join(__dirname, '..', 'data', 'commodity_names.json');
  fs.writeFileSync(commodityJsonPath, JSON.stringify(allCommodities, null, 2), 'utf-8');
  console.log(`\nUpdated ${commodityJsonPath} with ${allCommodities.length} commodities.`);

  // Summary of stored data in Raipur
  const raipurRows = db.getDb().prepare(`SELECT * FROM mandi_prices WHERE district = 'Raipur' ORDER BY arrival_date DESC, modal_price DESC`).all();
  const distinctCommodities = db.getDistinctCommodities('Raipur');
  const distinctMarkets = db.getDistinctMarkets('Raipur');
  const meta = db.getSyncMeta('Raipur');

  console.log('\n--- Raipur Database Summary ---');
  console.log(`Total rows in DB for Raipur: ${raipurRows.length}`);
  console.log(`Distinct commodities (${distinctCommodities.length}):`, distinctCommodities.map(c => `${c.commodity} (${c.name_hi || c.name_en || 'unmapped'})`));
  console.log(`Distinct markets (${distinctMarkets.length}):`, distinctMarkets.map(m => m.market));
  console.log(`Latest arrival date: ${meta.latest_data_date}`);
  console.log(`Last updated: ${meta.last_updated}`);

  console.log('\nSample stored rows:');
  console.table(raipurRows.slice(0, 5).map(r => ({
    market: r.market,
    commodity: r.commodity,
    variety: r.variety,
    date: r.arrival_date,
    modal_price: r.modal_price
  })));

  // GATE check:
  if (distinctCommodities.length < 8) {
    console.log(`\n======================================================`);
    console.log(`GATE TRIGGERED: Only ${distinctCommodities.length} distinct commodities found (< 8 target).`);
    console.log(`Commodity list:`, distinctCommodities.map(c => c.commodity));
    console.log(`Dates available: ${meta.latest_data_date || 'None'}`);
    console.log(`Rows per market:`);
    const byMarket = db.getDb().prepare(`SELECT market, COUNT(*) as cnt FROM mandi_prices WHERE district = 'Raipur' GROUP BY market`).all();
    console.table(byMarket);
    console.log(`======================================================`);
  } else {
    console.log(`\nGATE PASSED: ${distinctCommodities.length} distinct commodities found (>= 8).`);
  }
}

main().catch(err => {
  console.error('Fatal error during sync:', err);
  process.exit(1);
});
