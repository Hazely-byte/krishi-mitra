'use strict';

const db = require('./db');

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

const toolDeclarations = [
  {
    name: 'get_mandi_prices',
    description: 'Get the latest mandi price(s) for a commodity. Prioritizes Raipur markets, then Chhattisgarh, then neighboring states. Every result includes market, district, state, arrival_date, modal_price, and scope.',
    parameters: {
      type: 'OBJECT',
      properties: {
        commodity: {
          type: 'STRING',
          description: 'Name of the crop/commodity in Hindi (e.g. धान, गेहूं, टमाटर) or English (e.g. Paddy, Wheat, Tomato).'
        },
        market: {
          type: 'STRING',
          description: 'Optional specific market name to filter (e.g. Neora APMC, Kharora APMC).'
        }
      },
      required: ['commodity']
    }
  },
  {
    name: 'list_available_commodities',
    description: 'List commodities with active mandi prices in the database, optionally filtered by category (Cereal, Vegetable, Fruit, Pulse, Oilseed, Spice, Other).',
    parameters: {
      type: 'OBJECT',
      properties: {
        category: {
          type: 'STRING',
          description: 'Optional category filter: Cereal, Vegetable, Fruit, Pulse, Oilseed, Spice, Other.'
        }
      }
    }
  },
  {
    name: 'get_price_history',
    description: 'Get daily price history for a commodity up to 30 days. Prioritizes Raipur, falling back to Chhattisgarh or neighboring states. Indicates if history is short.',
    parameters: {
      type: 'OBJECT',
      properties: {
        commodity: {
          type: 'STRING',
          description: 'Name of the crop/commodity in Hindi or English.'
        },
        days: {
          type: 'INTEGER',
          description: 'Number of past days of history to retrieve (1 to 30, default 7).'
        }
      },
      required: ['commodity']
    }
  },
  {
    name: 'compare_markets',
    description: 'Compare prices for the same commodity across different markets on the latest available date to find which market offers the highest rate.',
    parameters: {
      type: 'OBJECT',
      properties: {
        commodity: {
          type: 'STRING',
          description: 'Name of the crop/commodity in Hindi or English.'
        }
      },
      required: ['commodity']
    }
  },
  {
    name: 'get_data_status',
    description: 'Get the data freshness status, last sync timestamp, and latest arrival date available in the database.',
    parameters: {
      type: 'OBJECT',
      properties: {}
    }
  }
];

/**
 * Execute a tool call against the SQLite database
 */
async function executeTool(name, args = {}) {
  switch (name) {
    case 'get_mandi_prices': {
      const rawCommodity = (args.commodity || '').trim();
      if (!rawCommodity) {
        return { error: 'Please specify a commodity name.' };
      }

      // Resolve commodity name (English/Hindi/alias)
      let resolution = db.resolveCommodity(rawCommodity);
      let targetApiName = rawCommodity;
      let displayNameEn = rawCommodity;
      let displayNameHi = rawCommodity;

      if (resolution.match === 'exact' || resolution.match === 'fuzzy') {
        targetApiName = resolution.commodity.name_api;
        displayNameEn = resolution.commodity.name_en;
        displayNameHi = resolution.commodity.name_hi;
      } else if (resolution.match === 'ambiguous') {
        // Disambiguate: prioritize candidate that has records in Raipur district
        const withRaipurData = resolution.candidates.filter(c => {
          return !!db.getDb().prepare(`SELECT 1 FROM mandi_prices WHERE commodity = ? AND district = 'Raipur' LIMIT 1`).get(c.name_api || c.api_name);
        });
        if (withRaipurData.length === 1) {
          targetApiName = withRaipurData[0].name_api || withRaipurData[0].api_name;
          displayNameEn = withRaipurData[0].name_en || withRaipurData[0].en || targetApiName;
          displayNameHi = withRaipurData[0].name_hi || withRaipurData[0].hi || targetApiName;
        } else {
          const withData = resolution.candidates.filter(c => {
            return !!db.getDb().prepare(`SELECT 1 FROM mandi_prices WHERE commodity = ? LIMIT 1`).get(c.name_api || c.api_name);
          });
          if (withData.length === 1) {
            targetApiName = withData[0].name_api || withData[0].api_name;
            displayNameEn = withData[0].name_en || withData[0].en || targetApiName;
            displayNameHi = withData[0].name_hi || withData[0].hi || targetApiName;
          } else {
            return {
              ambiguous: true,
              message: `Multiple matching commodities found for "${rawCommodity}". Did you mean: ${resolution.candidates.map(c => `${c.name_hi || c.hi} (${c.name_en || c.en})`).join(', ')}?`,
              candidates: resolution.candidates.map(c => ({ api_name: c.name_api || c.api_name, en: c.name_en || c.en, hi: c.name_hi || c.hi }))
            };
          }
        }
      }

      const records = db.getMandiPricesScoped(targetApiName, args.market || null);
      if (!records || records.length === 0) {
        return {
          found: false,
          commodity_en: displayNameEn,
          commodity_hi: displayNameHi,
          message: `No price data found in the database for ${displayNameHi} (${displayNameEn}).`
        };
      }

      const scope = records[0].scope; // 'raipur' | 'chhattisgarh' | 'other_state'
      return {
        found: true,
        commodity_en: displayNameEn,
        commodity_hi: displayNameHi,
        scope,
        scope_note: scope === 'raipur'
          ? 'Data is from Raipur district mandi.'
          : scope === 'chhattisgarh'
            ? 'Raipur has no data today. Reported price is from another mandi in Chhattisgarh, not Raipur.'
            : 'Prices come from other states, possibly far from Raipur, and are not Raipur prices.',
        count: records.length,
        records: records.map(r => ({
          market: r.market,
          district: r.district,
          state: r.state,
          state_display: getStateDisplay(r.state),
          variety: r.variety,
          arrival_date: r.arrival_date,
          price_date: r.arrival_date,
          min_price_quintal: r.min_price,
          max_price_quintal: r.max_price,
          modal_price_quintal: r.modal_price,
          modal_price: r.modal_price,
          scope: r.scope
        }))
      };
    }

    case 'list_available_commodities': {
      const category = (args.category || '').trim();
      const all = db.getDistinctCommodities('Raipur');
      const filtered = category
        ? all.filter(c => (c.category || '').toLowerCase() === category.toLowerCase())
        : all;
      return {
        district: 'Raipur',
        total_in_raipur: filtered.length,
        commodities: filtered.map(c => ({
          commodity: c.commodity,
          name_en: c.name_en || c.commodity,
          name_hi: c.name_hi || c.commodity,
          category: c.category || 'Other'
        }))
      };
    }

    case 'get_price_history': {
      const rawCommodity = (args.commodity || '').trim();
      if (!rawCommodity) {
        return { error: 'Please specify a commodity name.' };
      }

      const resolution = db.resolveCommodity(rawCommodity);
      let targetApiName = rawCommodity;
      if (resolution.match === 'exact' || resolution.match === 'fuzzy') {
        targetApiName = resolution.commodity.name_api;
      } else if (resolution.match === 'ambiguous') {
        const withData = resolution.candidates.filter(c => {
          return !!db.getDb().prepare(`SELECT 1 FROM mandi_prices WHERE commodity = ? LIMIT 1`).get(c.name_api || c.api_name);
        });
        if (withData.length >= 1) targetApiName = withData[0].name_api || withData[0].api_name;
      }

      const days = Math.min(30, Math.max(1, parseInt(args.days, 10) || 7));
      const history = db.getPriceHistoryScoped(targetApiName, days);
      const distinctDates = [...new Set(history.records.map(r => r.arrival_date || r.date))];

      return {
        commodity: targetApiName,
        days_requested: days,
        days_available: distinctDates.length,
        scope: history.scope,
        scope_note: history.scope === 'raipur'
          ? 'Data is from Raipur district mandi.'
          : history.scope === 'chhattisgarh'
            ? 'Raipur has no data today. Reported price is from another mandi in Chhattisgarh, not Raipur.'
            : 'Prices come from other states, possibly far from Raipur, and are not Raipur prices.',
        is_short_history: distinctDates.length < 2,
        history_note: `Historical records are currently limited to ${distinctDates.length} day(s) of data in the database (daily history accumulates with ongoing syncs).`,
        count: history.records.length,
        records: history.records.map(r => ({
          market: r.market,
          district: r.district,
          state: r.state,
          state_display: getStateDisplay(r.state),
          variety: r.variety,
          arrival_date: r.arrival_date,
          price_date: r.arrival_date,
          date: r.arrival_date,
          modal_price_quintal: r.modal_price,
          modal_price: r.modal_price,
          scope: r.scope
        }))
      };
    }

    case 'compare_markets': {
      const rawCommodity = (args.commodity || '').trim();
      if (!rawCommodity) {
        return { error: 'Please specify a commodity name.' };
      }

      const resolution = db.resolveCommodity(rawCommodity);
      let targetApiName = rawCommodity;
      if (resolution.match === 'exact' || resolution.match === 'fuzzy') {
        targetApiName = resolution.commodity.name_api;
      } else if (resolution.match === 'ambiguous') {
        const withData = resolution.candidates.filter(c => {
          return !!db.getDb().prepare(`SELECT 1 FROM mandi_prices WHERE commodity = ? LIMIT 1`).get(c.name_api || c.api_name);
        });
        if (withData.length >= 1) targetApiName = withData[0].name_api || withData[0].api_name;
      }

      const records = db.compareMarketsScoped(targetApiName);
      if (!records || records.length === 0) {
        return {
          commodity: targetApiName,
          found: false,
          message: `No market comparison data available for ${targetApiName}.`
        };
      }

      return {
        commodity: targetApiName,
        found: true,
        best_market: records[0].market,
        best_modal_price: records[0].modal_price,
        date: records[0].arrival_date,
        price_date: records[0].arrival_date,
        scope: records[0].scope,
        scope_note: records[0].scope === 'raipur'
          ? 'Data is from Raipur district mandi.'
          : records[0].scope === 'chhattisgarh'
            ? 'Raipur has no data today. Reported price is from another mandi in Chhattisgarh, not Raipur.'
            : 'Prices come from other states, possibly far from Raipur, and are not Raipur prices.',
        comparison: records.map(r => ({
          market: r.market,
          district: r.district,
          state: r.state,
          state_display: getStateDisplay(r.state),
          variety: r.variety,
          arrival_date: r.arrival_date,
          price_date: r.arrival_date,
          modal_price_quintal: r.modal_price,
          modal_price: r.modal_price,
          scope: r.scope
        }))
      };
    }

    case 'get_data_status': {
      const meta = db.getSyncMeta('Raipur');
      return {
        database_status: meta.stale ? 'Stale / Never synced' : 'Fresh',
        last_updated: meta.last_updated,
        latest_data_date: meta.latest_data_date,
        raipur_records: meta.row_count,
        total_national_records: meta.total_db_rows
      };
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}

module.exports = {
  toolDeclarations,
  executeTool,
  getStateDisplay
};
