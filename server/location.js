'use strict';

// In-memory cache: "lat_round,lon_round" -> { state, district, matched }
const cache = new Map();

// Throttle queue: ensure at least 1000ms between Nominatim requests
let lastRequestTime = 0;
const MIN_INTERVAL_MS = 1050;

// State normalization alias map (API spelling: Chattisgarh)
const STATE_ALIASES = {
  'chhattisgarh': 'Chattisgarh',
  'chattisgarh': 'Chattisgarh',
  'छत्तीसगढ़': 'Chattisgarh'
};

const SYNCED_DISTRICTS = ['raipur'];

function round2(num) {
  return (Math.round(num * 100) / 100).toFixed(2);
}

async function throttle() {
  const now = Date.now();
  const timeSinceLast = now - lastRequestTime;
  if (timeSinceLast < MIN_INTERVAL_MS) {
    await new Promise(r => setTimeout(r, MIN_INTERVAL_MS - timeSinceLast));
  }
  lastRequestTime = Date.now();
}

/**
 * Reverse geocode lat/lon to State and District using Nominatim
 */
async function resolveLocation(lat, lon) {
  if (typeof lat !== 'number' || typeof lon !== 'number' || isNaN(lat) || isNaN(lon)) {
    return getFallback();
  }

  // Key rounded to 2 decimals (~1.1 km precision)
  const key = `${round2(lat)},${round2(lon)}`;
  if (cache.has(key)) {
    return cache.get(key);
  }

  try {
    await throttle();
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=10&addressdetails=1`;
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'KrishiMitra/1.0 (krishi-mitra-agricultural-app; contact@krishimitra.local)',
        'Accept': 'application/json'
      },
      signal: AbortSignal.timeout(10000)
    });

    if (!resp.ok) {
      console.warn(`[location] Nominatim HTTP ${resp.status}`);
      return getFallback();
    }

    const data = await resp.json();
    const addr = data.address || {};

    const rawState = addr.state || '';
    const rawDistrict = addr.state_district || addr.district || addr.county || addr.city || '';

    // Normalize state
    const normalizedState = STATE_ALIASES[rawState.toLowerCase()] || rawState;
    const districtName = rawDistrict.replace(/ district/i, '').trim();

    // Check if synced
    const isMatched = normalizedState.toLowerCase() === 'chattisgarh' &&
      SYNCED_DISTRICTS.includes(districtName.toLowerCase());

    const result = {
      state: isMatched ? 'Chhattisgarh' : rawState,
      state_api: normalizedState,
      district: isMatched ? 'Raipur' : districtName,
      matched: isMatched,
      source: 'gps'
    };

    cache.set(key, result);
    return result;
  } catch (err) {
    console.warn(`[location] Geocoding error: ${err.message}`);
    return getFallback();
  }
}

function getFallback() {
  return {
    state: 'Chhattisgarh',
    state_api: 'Chattisgarh',
    district: 'Raipur',
    matched: false,
    source: 'fallback'
  };
}

module.exports = {
  resolveLocation,
  getFallback,
  round2
};
