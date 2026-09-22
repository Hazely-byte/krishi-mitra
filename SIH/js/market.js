// ============================================================
// Krishi Mitra — market.js
// Real-time Mandi price data from /api/mandi (market.html).
// Strictly Raipur district data, no hardcoded or fabricated prices.
// ============================================================

(function () {
  'use strict';

  let cachedRecords = [];
  let marketLocation = { state: 'Chhattisgarh', district: 'Raipur', market: '' };
  let lastUpdated = null;
  let latestDataDate = null;
  let isUpdating = false;
  let isLoading = false;
  let loadError = false;

  // Phase 1: Modal & Google Maps State
  let currentModalRecord = null;
  let activeModalTab = 'nav';
  let googleMapsPromise = null;
  let googleMapsLoaded = false;
  let googleMapsLoadError = false;
  let mapInstance = null;
  let mandiMarker = null;
  let userMarker = null;

  // HTML5 Geolocation State (once per session)
  let userLocationState = 'unrequested'; // 'unrequested' | 'requesting' | 'granted' | 'denied' | 'unavailable' | 'timeout'
  let userCoords = null; // { lat, lng }
  let userLocPrompted = false;

  // Known Mandi and District Coordinates for Chhattisgarh & neighboring hubs
  const MANDI_COORDINATES = {
    // Raipur District
    'Neora APMC': { lat: 21.5540, lng: 81.7610 },
    'Kharora APMC': { lat: 21.4394, lng: 81.9328 },
    'Raipur APMC': { lat: 21.2514, lng: 81.6296 },
    'Tilda Neora APMC': { lat: 21.5540, lng: 81.7610 },
    'Abhanpur APMC': { lat: 21.0543, lng: 81.7485 },
    'Arang APMC': { lat: 21.1963, lng: 81.9688 },
    // Durg & Bhilai
    'Durg APMC': { lat: 21.1904, lng: 81.2849 },
    'Dhamdha APMC': { lat: 21.4429, lng: 81.3128 },
    'Patan APMC': { lat: 21.0402, lng: 81.5366 },
    // Bilaspur
    'Bilaspur APMC': { lat: 22.0797, lng: 82.1409 },
    'Kota APMC': { lat: 22.2965, lng: 82.0286 },
    // Rajnandgaon
    'Rajnandgaon APMC': { lat: 21.0974, lng: 81.0336 },
    'Dongargarh APMC': { lat: 21.1895, lng: 80.7604 },
    // Dhamtari & Mahasamund
    'Dhamtari APMC': { lat: 20.7071, lng: 81.5497 },
    'Kurud APMC': { lat: 20.8252, lng: 81.7144 },
    'Mahasamund APMC': { lat: 21.1090, lng: 82.0970 },
    'Saraipali APMC': { lat: 21.3283, lng: 83.0039 },
    'Bagbahara APMC': { lat: 21.0487, lng: 82.3831 },
    // Baloda Bazar & Bemetara
    'Baloda Bazar APMC': { lat: 21.6617, lng: 82.1607 },
    'Bhatapara APMC': { lat: 21.7346, lng: 81.9392 },
    'Bemetara APMC': { lat: 21.7042, lng: 81.5434 },
    'Balod APMC': { lat: 20.7301, lng: 81.2064 },
    // Other CG Districts
    'Korba APMC': { lat: 22.3595, lng: 82.7501 },
    'Raigarh APMC': { lat: 21.8974, lng: 83.3950 },
    'Janjgir APMC': { lat: 22.0069, lng: 82.5714 },
    'Champa APMC': { lat: 22.0392, lng: 82.6586 },
    'Kanker APMC': { lat: 20.2719, lng: 81.4925 },
    'Jagdalpur APMC': { lat: 19.0740, lng: 82.0094 },
    'Ambikapur APMC': { lat: 23.1189, lng: 83.1979 },
    // District Fallback Coordinates
    'Raipur': { lat: 21.2514, lng: 81.6296 },
    'Durg': { lat: 21.1904, lng: 81.2849 },
    'Bilaspur': { lat: 22.0797, lng: 82.1409 },
    'Rajnandgaon': { lat: 21.0974, lng: 81.0336 },
    'Dhamtari': { lat: 20.7071, lng: 81.5497 },
    'Mahasamund': { lat: 21.1090, lng: 82.0970 },
    'Baloda Bazar': { lat: 21.6617, lng: 82.1607 },
    'Bemetara': { lat: 21.7042, lng: 81.5434 },
    'Balod': { lat: 20.7301, lng: 81.2064 },
    'Korba': { lat: 22.3595, lng: 82.7501 },
    'Raigarh': { lat: 21.8974, lng: 83.3950 },
    'Janjgir-Champa': { lat: 22.0069, lng: 82.5714 },
    'Kabirdham': { lat: 22.0163, lng: 81.2468 },
    'Kanker': { lat: 20.2719, lng: 81.4925 },
    'Bastar': { lat: 19.0734, lng: 82.0308 },
    'Surguja': { lat: 23.1189, lng: 83.1979 },
    // Inter-State Hubs
    'Nagpur': { lat: 21.1458, lng: 79.0882 },
    'Bhandara': { lat: 21.1711, lng: 79.6548 },
    'Gondia': { lat: 21.4588, lng: 80.1961 },
    'Jabalpur': { lat: 23.1815, lng: 79.9864 },
    'Mandla': { lat: 22.5982, lng: 80.3707 },
    'Balaghat': { lat: 21.8129, lng: 80.1838 },
    'Bargarh': { lat: 21.3323, lng: 83.6217 },
    'Sambalpur': { lat: 21.4669, lng: 83.9812 },
    'Nuapada': { lat: 20.8415, lng: 82.5317 },
    'Jharsuguda': { lat: 21.8554, lng: 84.0062 }
  };

  const CROP_EMOJIS = {
    'Cereal': '🌾',
    'Oilseed': '🫘',
    'Pulse': '🫘',
    'Vegetable': '🥬',
    'Fruit': '🍎',
    'Spice': '🌶️',
    'Fibre': '🧶',
    'Fiber': '🧶',
    'Cash Crop': '🎋',
    'Other': '📦',
    'Paddy(Common)': '🌾',
    'Paddy (Common)': '🌾',
    'Paddy': '🌾',
    'Rice': '🌾',
    'Wheat': '🌾',
    'Maize': '🌽',
    'Tomato': '🍅',
    'Onion': '🧅',
    'Potato': '🥔',
    'Cotton': '🧶',
    'Sugarcane': '🎋',
    'Soybean': '🫘',
    'Banana': '🍌',
    'Mango': '🥭',
    'Apple': '🍎',
    'Garlic': '🧄'
  };

  function getCropEmoji(commodity, category) {
    return CROP_EMOJIS[commodity] || CROP_EMOJIS[category] || '🌾';
  }

  // Normalize Hindi: treats chandrabindu (ँ) and anusvara (ं) as equivalent
  function normalizeSearch(s) {
    if (!s) return '';
    return s.normalize('NFC').toLowerCase().replace(/[\u0901\u0902]/g, '\u0902');
  }

  function formatTimestamp(isoStr) {
    if (!isoStr) return '';
    try {
      const normalized = (isoStr.endsWith('Z') || isoStr.includes('+'))
        ? isoStr
        : (isoStr.includes('T') ? isoStr + 'Z' : isoStr.replace(' ', 'T') + 'Z');
      const d = new Date(normalized);
      if (isNaN(d.getTime())) return isoStr;
      const locale = (typeof currentLang !== 'undefined' && currentLang === 'hi') ? 'hi-IN' : 'en-IN';
      return d.toLocaleTimeString(locale, {
        timeZone: 'Asia/Kolkata',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      });
    } catch (e) {
      return isoStr;
    }
  }

  function formatDate(isoDate) {
    if (!isoDate) return '';
    const parts = isoDate.split('-');
    if (parts.length === 3) {
      return `${parts[2]}/${parts[1]}/${parts[0]}`;
    }
    return isoDate;
  }

  let activeQuery = '';
  let activeAbortController = null;

  /**
   * Fetch live prices from backend API with cascading fallback.
   * When query is specified, backend queries all four tiers unconditionally.
   */
  async function fetchMarketPrices(query = '', bustCache = false) {
    activeQuery = query;
    isLoading = true;
    loadError = false;
    renderSkeletons();

    if (activeAbortController) {
      activeAbortController.abort();
    }
    activeAbortController = new AbortController();

    try {
      const qParam = query && query.trim() ? `&q=${encodeURIComponent(query.trim())}` : '';
      let lat = 21.2514;
      let lng = 81.6296;
      if (window.KrishiLocation) {
        const sess = window.KrishiLocation.getGpsSession();
        if (sess && sess.coords) {
          lat = sess.coords.lat;
          lng = sess.coords.lng;
        }
      }
      const coordsParam = `&lat=${lat}&lng=${lng}`;
      const refreshParam = bustCache ? '&refresh=1' : '';

      const res = await fetch(`/api/mandi?district=Raipur${coordsParam}${refreshParam}${qParam}`, {
        headers: { 'Accept': 'application/json' },
        signal: activeAbortController.signal
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const data = await res.json();
      cachedRecords = data.records || [];
      marketLocation = data.location || { state: 'Chhattisgarh', district: 'Raipur', market: '' };
      lastUpdated = data.last_updated;
      latestDataDate = data.latest_data_date;
      isLoading = false;

      renderInfoBanner();
      renderMarket();
    } catch (err) {
      if (err.name === 'AbortError') return;
      console.error('[market] Failed to fetch prices:', err);
      isLoading = false;
      loadError = true;
      renderErrorState();
    }
  }

  /**
   * Trigger manual refresh: refreshes GPS, busts cache, re-fetches prices
   */
  async function refreshPrices() {
    if (isUpdating) return;
    isUpdating = true;
    const t = i18n[currentLang] || {};

    const btn = document.getElementById('banner-update-btn');
    if (btn) {
      btn.classList.add('loading');
      btn.textContent = t.updating || 'Updating...';
    }

    if (typeof showToast === 'function') {
      showToast(t.updating || 'Refreshing location & prices...');
    }

    try {
      // 1. Refresh GPS coordinates
      if (window.KrishiLocation && typeof window.KrishiLocation.refreshLocation === 'function') {
        await window.KrishiLocation.refreshLocation();
      }

      // 2. Call server refresh
      await fetch('/api/mandi/refresh', {
        method: 'POST',
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(15000)
      });

      // 3. Re-fetch prices with cache busted
      await fetchMarketPrices(activeQuery, true);

      if (typeof showToast === 'function') {
        showToast(t.updated_success || 'Prices updated successfully');
      }
    } catch (err) {
      console.warn('[market] Refresh request error:', err);
      if (typeof showToast === 'function') {
        showToast(t.error_loading || 'Failed to update prices');
      }
    } finally {
      isUpdating = false;
      renderInfoBanner();
    }
  }

  /**
   * Render Top Information Banner
   */
  function renderInfoBanner() {
    const banner = document.getElementById('market-info-banner');
    if (!banner) return;
    const t = i18n[currentLang] || {};

    const locName = currentLang === 'hi'
      ? `${marketLocation.district === 'Raipur' ? 'रायपुर' : marketLocation.district}, छत्तीसगढ़`
      : `${marketLocation.district || 'Raipur'}, Chhattisgarh`;

    const bannerTitle = currentLang === 'hi'
      ? `${locName} के 300 किमी दायरे के भाव`
      : `${t.showing_prices_for || 'Markets within 300km of'} ${locName}`;

    const timeStr = formatTimestamp(lastUpdated);
    const dateStr = formatDate(latestDataDate);

    // Check user location fallback status
    const userLoc = window.KrishiLocation ? window.KrishiLocation.getLocation() : null;
    const isFallback = userLoc && !userLoc.matched && userLoc.source === 'fallback';

    banner.innerHTML = `
      <div class="banner-card">
        <div class="banner-left">
          <span class="banner-pin">📍</span>
          <div class="banner-text-group">
            <div class="banner-location">${bannerTitle}</div>
            <div class="banner-updated">
              ${dateStr ? `📅 ${dateStr}` : ''} ${timeStr ? `• ⏰ ${timeStr}` : ''}
            </div>
          </div>
        </div>
        <button class="banner-update-btn ${isUpdating ? 'loading' : ''}" id="banner-update-btn">
          ${isUpdating ? (t.updating || 'Updating...') : (t.update_btn || '🔄 Update')}
        </button>
      </div>

      ${isFallback ? `
        <div class="location-notice">
          <span class="location-notice-text">
            ℹ️ ${t.location_fallback_notice || "Showing Raipur, Chhattisgarh. Data for your area isn't available yet."}
          </span>
          <button class="location-btn-link" id="refresh-gps-btn">${t.use_my_location || 'Use my location'}</button>
        </div>
      ` : ''}
    `;

    const updateBtn = document.getElementById('banner-update-btn');
    if (updateBtn) updateBtn.onclick = refreshPrices;

    const gpsBtn = document.getElementById('refresh-gps-btn');
    if (gpsBtn && window.KrishiLocation) {
      gpsBtn.onclick = async () => {
        if (typeof showToast === 'function') showToast(t.loading_prices || 'Locating...');
        await window.KrishiLocation.refreshLocation();
        await fetchMarketPrices(activeQuery, true);
        renderInfoBanner();
      };
    }
  }

  /**
   * Render Multi-Mandi 300km Radius Market Crop Cards (Nearest First)
   * Eliminates duplicate date badge bug.
   */
  function renderMarket() {
    const list = document.getElementById('market-list');
    if (!list) return;
    const t = i18n[currentLang] || {};

    if (isLoading) return;

    if (loadError) {
      renderErrorState();
      return;
    }

    const isSearching = Boolean(activeQuery && activeQuery.trim().length > 0);
    const searchTerm = isSearching ? activeQuery.trim() : '';

    if (cachedRecords.length === 0) {
      const dateStr = formatDate(latestDataDate);
      const emptyTitle = isSearching
        ? (t.search_no_results_for || 'No current or recent listings found for "{term}"').replace('{term}', searchTerm)
        : (t.no_prices_today || 'No prices reported recently');

      const emptySub = isSearching
        ? (t.search_try_different || 'Try searching for a different crop name or clear filters.')
        : (currentLang === 'hi'
            ? 'रायपुर व निकटवर्ती मंडियों से आज कोई ताजा भाव दर्ज नहीं हुआ है।'
            : 'No price records published recently.');

      list.innerHTML = `
        <div class="market-status-card">
          <span class="status-card-icon">${isSearching ? '🔍' : '🌾'}</span>
          <div class="status-card-title">${emptyTitle}</div>
          <div class="status-card-sub">${emptySub}</div>
          ${dateStr ? `<div class="status-card-date">${t.last_available_date || 'Last available date:'} ${dateStr}</div>` : ''}
        </div>
        <div class="data-credit-footer">${t.data_source_credit || 'Data source: data.gov.in & MandiPulse'}</div>
      `;
      return;
    }

    // Sort cachedRecords by distance ASC (Nearest First)
    cachedRecords.sort((a, b) => {
      const distA = a.distance_km !== undefined && a.distance_km !== null ? a.distance_km : 999;
      const distB = b.distance_km !== undefined && b.distance_km !== null ? b.distance_km : 999;
      if (distA !== distB) return distA - distB;
      return (b.arrival_date || '').localeCompare(a.arrival_date || '');
    });

    // Group records by market, preserving distance order
    const marketGroupsMap = new Map();
    cachedRecords.forEach(r => {
      const key = `${r.market}::${r.district}`;
      if (!marketGroupsMap.has(key)) {
        marketGroupsMap.set(key, {
          market: r.market,
          district: r.district,
          state: r.state,
          state_display: r.state_display,
          distance_km: r.distance_km,
          transport_warning: r.transport_warning,
          records: []
        });
      }
      marketGroupsMap.get(key).records.push(r);
    });

    const groups = Array.from(marketGroupsMap.values());
    let html = '';
    const flatRenderedRecords = [];

    groups.forEach(group => {
      const distStr = group.distance_km !== undefined && group.distance_km !== null
        ? (group.distance_km === 0 ? (currentLang === 'hi' ? '0 किमी' : '0 km') : `${group.distance_km} km`)
        : '';

      const groupLocationText = currentLang === 'hi'
        ? `${group.market}, ${group.district === 'Raipur' ? 'रायपुर' : group.district}`
        : `${group.market}, ${group.district}`;

      html += `
        <div class="market-tier-section">
          <div class="market-tier-header">
            <div class="tier-header-left">
              <span class="tier-header-icon">📍</span>
              <span class="tier-header-title">${groupLocationText}</span>
              ${distStr ? `<span class="tier-header-dist">📍 ${distStr}</span>` : ''}
            </div>
            <span class="tier-header-count">${group.records.length} ${currentLang === 'hi' ? 'फसलें' : (group.records.length === 1 ? 'crop' : 'crops')}</span>
          </div>
      `;

      // Render transport cost warning banner for inter-state mandis
      if (group.transport_warning) {
        html += `
          <div class="transport-warning-box">
            <div class="transport-warning-header">
              ${t.transport_warning_title || '⚠️ Note: Inter-State Prices'}
            </div>
            <div class="transport-warning-desc">
              ${t.transport_warning_text || 'Prices are from neighboring states. Transportation, mandi taxes, and logistics costs will affect your actual returns.'}
            </div>
          </div>
        `;
      }

      // Render cards in this mandi group
      html += group.records.map(m => {
        const recordIdx = flatRenderedRecords.length;
        flatRenderedRecords.push(m);

        const cropName = currentLang === 'hi' ? (m.name_hi || m.commodity) : (m.name_en || m.commodity);
        const emoji = getCropEmoji(m.commodity, m.category);
        const priceStr = Math.round(m.modal).toLocaleString();
        const hasTrend = m.trend_pct !== null && m.trend_pct !== undefined && !isNaN(m.trend_pct);
        const trendClass = hasTrend ? (m.trend_pct > 0 ? 'up' : m.trend_pct < 0 ? 'down' : 'stable') : '';
        const trendIcon = hasTrend ? (m.trend_pct > 0 ? '⬆' : m.trend_pct < 0 ? '⬇' : '➡') : '';
        const trendText = hasTrend ? `${trendIcon} ${Math.abs(m.trend_pct)}%` : '';

        // Generate ONE Clean Date Badge (Fixes the duplicate date badge bug!)
        let dateBadgeHtml = '';
        if (m.days_old === 0) {
          dateBadgeHtml = `<span class="tier-badge tier-badge-1">📅 ${t.tier1_badge || 'Today'}</span>`;
        } else {
          const daysText = (t.tier2_badge_days || '{days} days old').replace('{days}', m.days_old);
          dateBadgeHtml = `<span class="tier-badge tier-badge-2">📅 ${formatDate(m.arrival_date)} (${daysText})</span>`;
        }

        const cardDistStr = m.distance_km !== undefined && m.distance_km !== null
          ? (m.distance_km === 0 ? (currentLang === 'hi' ? '0 किमी' : '0 km') : `${m.distance_km} km`)
          : '';

        const stateSuffix = m.transport_warning ? ` (${currentLang === 'hi' ? (m.state_display || m.state) : m.state})` : '';
        const locationBadgeText = `${m.market}, ${m.district}${stateSuffix}`;

        const sourceBadgeHtml = m.source === 'mandipulse'
          ? `<span class="card-source-badge" title="Source: MandiPulse">🌐 MandiPulse</span>`
          : '';

        return `
          <div class="market-crop-card" data-record-index="${recordIdx}" role="button" tabindex="0" aria-label="${cropName}, ₹${priceStr} ${t.per_quintal || 'per quintal'}">
            <div class="crop-row">
              <span class="crop-emoji">${emoji}</span>
              <div class="crop-info">
                <div class="crop-name">${cropName}</div>
                <div class="crop-category">${m.category || 'Cereal'}${m.variety ? ` • ${m.variety}` : ''}</div>
              </div>
              <div class="crop-price-area">
                <div class="crop-price">₹${priceStr}</div>
                <div class="crop-unit">${t.per_quintal || 'per quintal'}</div>
                ${hasTrend ? `
                  <div class="price-change ${trendClass}">
                    ${trendText}
                  </div>
                ` : ''}
              </div>
            </div>
            <div class="card-badges-row">
              ${cardDistStr ? `<span class="card-distance-badge">📍 ${cardDistStr}</span>` : ''}
              <span class="card-location-badge">📍 ${locationBadgeText}</span>
              ${dateBadgeHtml}
              ${sourceBadgeHtml}
            </div>
          </div>
        `;
      }).join('');

      html += `</div>`; // Close .market-tier-section
    });

    html += `
      <div class="data-credit-footer">
        ${t.data_source_credit || 'Data source: data.gov.in & MandiPulse (Ministry of Agriculture & Farmers Welfare)'}
      </div>
    `;

    list.innerHTML = html;

    // Attach click and keyboard handlers to cards
    list.querySelectorAll('.market-crop-card').forEach((cardEl) => {
      const handler = () => {
        const idx = Number(cardEl.getAttribute('data-record-index'));
        const rec = flatRenderedRecords[idx];
        if (rec) openCommodityModal(rec);
      };
      cardEl.addEventListener('click', handler);
      cardEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handler();
        }
      });
    });
  }

  function renderSkeletons() {
    const list = document.getElementById('market-list');
    if (!list) return;
    list.innerHTML = `
      <div class="market-skeleton-card">
        <div class="skeleton-row">
          <div class="skeleton-circle"></div>
          <div class="skeleton-lines">
            <div class="skeleton-line medium"></div>
            <div class="skeleton-line short"></div>
          </div>
        </div>
      </div>
      <div class="market-skeleton-card">
        <div class="skeleton-row">
          <div class="skeleton-circle"></div>
          <div class="skeleton-lines">
            <div class="skeleton-line medium"></div>
            <div class="skeleton-line short"></div>
          </div>
        </div>
      </div>
    `;
  }

  function renderErrorState() {
    const list = document.getElementById('market-list');
    if (!list) return;
    const t = i18n[currentLang] || {};
    list.innerHTML = `
      <div class="market-status-card">
        <span class="status-card-icon">⚠️</span>
        <div class="status-card-title">${t.error_loading || 'Failed to load mandi prices'}</div>
        <div class="status-card-sub">${currentLang === 'hi' ? 'इंटरनेट कनेक्शन जांचें या पुनः प्रयास करें।' : 'Check connection or try again.'}</div>
        <button class="status-retry-btn" id="market-retry-btn">${t.retry_btn || '🔄 Retry'}</button>
      </div>
    `;
    const retryBtn = document.getElementById('market-retry-btn');
    if (retryBtn) retryBtn.onclick = () => fetchMarketPrices(activeQuery);
  }

  let filterTimeout = null;
  function filterMarket() {
    clearTimeout(filterTimeout);
    filterTimeout = setTimeout(() => {
      const input = document.getElementById('market-search-input');
      const q = input ? input.value : '';
      fetchMarketPrices(q);
    }, 180);
  }

  function onLanguageChange() {
    renderInfoBanner();
    renderMarket();
    if (currentModalRecord) {
      updateModalI18n(currentModalRecord);
    }
  }

  // ============================================================
  // Phase 1: Location & Google Maps Integration
  // ============================================================

  function calculateHaversineDistanceKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  async function requestUserLocationOnce(force = false) {
    if (window.KrishiLocation && typeof window.KrishiLocation.requestUserLocationOnce === 'function') {
      const res = await window.KrishiLocation.requestUserLocationOnce(force);
      userLocationState = res.state;
      userCoords = res.coords;
      userLocPrompted = true;
      return res;
    }

    if (!force && userLocPrompted) {
      return { state: userLocationState, coords: userCoords };
    }
    userLocPrompted = true;
    userLocationState = 'requesting';

    if (!navigator.geolocation) {
      userLocationState = 'unavailable';
      return { state: 'unavailable', coords: null };
    }

    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          userLocationState = 'granted';
          userCoords = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude
          };
          resolve({ state: 'granted', coords: userCoords });
        },
        (err) => {
          if (err.code === 1) { // PERMISSION_DENIED
            userLocationState = 'denied';
          } else if (err.code === 2) { // POSITION_UNAVAILABLE
            userLocationState = 'unavailable';
          } else if (err.code === 3) { // TIMEOUT
            userLocationState = 'timeout';
          } else {
            userLocationState = 'unavailable';
          }
          resolve({ state: userLocationState, coords: null });
        },
        {
          timeout: 8000,
          maximumAge: 1000 * 60 * 30, // 30 mins
          enableHighAccuracy: false
        }
      );
    });
  }

  function initGoogleMapsBootstrap(apiKey) {
    ((g) => {
      var h, a, k, p = "The Google Maps JavaScript API", c = "google", l = "importLibrary", q = "__ib__", m = document, b = window;
      b[c] = b[c] || {};
      var d = b[c].maps = b[c].maps || {}, r = new Set, e = new URLSearchParams, u = () => h || (h = new Promise(async (f, n) => {
        await (a = m.createElement("script"));
        e.set("libraries", [...r] + "");
        for (k in g) e.set(k.replace(/[A-Z]/g, t => "_" + t[0].toLowerCase()), g[k]);
        e.set("callback", c + ".maps." + q);
        a.src = `https://maps.${c}apis.com/maps/api/js?` + e;
        d[q] = f;
        a.onerror = () => h = n(Error(p + " could not load."));
        a.nonce = m.querySelector("script[nonce]")?.nonce || "";
        m.head.append(a);
      }));
      d[l] ? console.warn(p + " only loads once. Ignoring:", g) : d[l] = (f, ...n) => r.add(f) && u().then(() => d[l](f, ...n));
    })({
      key: apiKey,
      v: "weekly"
    });
  }

  function loadGoogleMapsApi() {
    if (googleMapsLoaded && window.google && window.google.maps) {
      return Promise.resolve(window.google.maps);
    }
    if (googleMapsPromise) return googleMapsPromise;

    const apiKey = (window.GOOGLE_MAPS_CONFIG && window.GOOGLE_MAPS_CONFIG.apiKey)
      ? window.GOOGLE_MAPS_CONFIG.apiKey.trim()
      : '';

    if (!apiKey) {
      console.warn('[market] No Google Maps API key provided in window.GOOGLE_MAPS_CONFIG.apiKey. Treating as Maps-unavailable.');
      googleMapsLoadError = true;
      return Promise.reject(new Error('MISSING_API_KEY'));
    }

    googleMapsPromise = (async () => {
      initGoogleMapsBootstrap(apiKey);
      await safeImportLibrary('maps');
      googleMapsLoaded = true;
      googleMapsLoadError = false;
      return window.google.maps;
    })().catch((err) => {
      console.error('[market] Failed to load Google Maps JS API:', err);
      googleMapsLoadError = true;
      googleMapsPromise = null;
      throw err;
    });

    return googleMapsPromise;
  }

  async function safeImportLibrary(name) {
    if (window.google?.maps?.importLibrary) {
      try {
        return await window.google.maps.importLibrary(name);
      } catch (err) {
        console.warn(`[market] importLibrary("${name}") call failed, checking global fallback:`, err);
      }
    }
    if (window.google?.maps) {
      if (name === 'maps') return { Map: window.google.maps.Map };
      if (name === 'marker') return {
        AdvancedMarkerElement: window.google.maps.marker?.AdvancedMarkerElement,
        PinElement: window.google.maps.marker?.PinElement
      };
      if (name === 'routes') return {
        DirectionsService: window.google.maps.DirectionsService,
        DirectionsRenderer: window.google.maps.DirectionsRenderer
      };
      if (name === 'places') return {
        Place: window.google.maps.places?.Place,
        PlacesService: window.google.maps.places?.PlacesService
      };
      if (name === 'core') return {
        LatLng: window.google.maps.LatLng,
        LatLngBounds: window.google.maps.LatLngBounds
      };
    }
    throw new Error(`Google Maps library "${name}" is unavailable`);
  }

  // ============================================================
  // Commodity Detail Modal Management
  // ============================================================

  async function openCommodityModal(record) {
    currentModalRecord = record;
    const backdrop = document.getElementById('commodity-modal-backdrop');
    const modal = document.getElementById('commodity-modal');
    const cropEmojiEl = document.getElementById('modal-crop-emoji');
    const cropNameEl = document.getElementById('modal-crop-name');
    const cropCatEl = document.getElementById('modal-crop-category');
    const mandiTagEl = document.getElementById('modal-mandi-tag');

    const cropName = currentLang === 'hi' ? (record.name_hi || record.commodity) : (record.name_en || record.commodity);
    const emoji = getCropEmoji(record.commodity, record.category);
    const varietyText = record.variety ? ` • ${record.variety}` : '';

    if (cropEmojiEl) cropEmojiEl.textContent = emoji;
    if (cropNameEl) cropNameEl.textContent = cropName;
    if (cropCatEl) cropCatEl.textContent = `${record.category || 'Other'}${varietyText}`;
    if (mandiTagEl) mandiTagEl.textContent = `📍 ${record.market}, ${record.district}`;

    // Switch to Tab 1 (Map & Nav)
    switchModalTab('nav');

    // Show modal
    if (backdrop) {
      backdrop.classList.add('open');
      backdrop.setAttribute('aria-hidden', 'false');
    }
    if (modal) {
      modal.classList.add('open');
    }

    // Resolve initial Mandi coordinates from dictionary
    let mandiCoords = MANDI_COORDINATES[record.market] || MANDI_COORDINATES[record.district] || null;

    // Trigger GPS request once per session in background
    await requestUserLocationOnce();

    // Render Tab 1 (Map & Navigation)
    renderMapTab(mandiCoords, record);

    // Render Tab 2 (Contact Info)
    renderContactTab(mandiCoords, record);

    // Render Tab 3 (Rates & Trends)
    renderRatesTab(record);
  }

  function closeCommodityModal() {
    const backdrop = document.getElementById('commodity-modal-backdrop');
    const modal = document.getElementById('commodity-modal');
    if (backdrop) {
      backdrop.classList.remove('open');
      backdrop.setAttribute('aria-hidden', 'true');
    }
    if (modal) {
      modal.classList.remove('open');
    }
    closeVehiclePicker();
  }

  // ============================================================
  // Vehicle Mode Picker Modal / Bottom Sheet
  // ============================================================
  let activeVehiclePickerMandi = null;

  function openVehiclePicker(mandiCoords, mandiRecord) {
    if (!mandiCoords) return;
    activeVehiclePickerMandi = { coords: mandiCoords, record: mandiRecord };
    const backdrop = document.getElementById('vehicle-picker-backdrop');
    const sheet = document.getElementById('vehicle-picker-sheet');
    if (backdrop) {
      backdrop.classList.add('open');
      backdrop.setAttribute('aria-hidden', 'false');
    }
    if (sheet) {
      sheet.classList.add('open');
    }
  }

  function closeVehiclePicker() {
    activeVehiclePickerMandi = null;
    const backdrop = document.getElementById('vehicle-picker-backdrop');
    const sheet = document.getElementById('vehicle-picker-sheet');
    if (backdrop) {
      backdrop.classList.remove('open');
      backdrop.setAttribute('aria-hidden', 'true');
    }
    if (sheet) {
      sheet.classList.remove('open');
    }
  }

  function selectVehicleMode(mode) {
    if (!activeVehiclePickerMandi || !activeVehiclePickerMandi.coords) {
      closeVehiclePicker();
      return;
    }
    const coords = activeVehiclePickerMandi.coords;

    // Universal Google Maps URL scheme travelmode mapping:
    // Driving: 'driving'
    // Two-wheeler: 'driving' (mapped to driving per Google Maps universal URL spec)
    // Transit: 'transit'
    // Walking: 'walking'
    let travelMode = 'driving';
    if (mode === 'transit') travelMode = 'transit';
    else if (mode === 'walking') travelMode = 'walking';
    else travelMode = 'driving';

    let url = `https://www.google.com/maps/dir/?api=1&destination=${coords.lat},${coords.lng}&travelmode=${travelMode}`;
    if (userLocationState === 'granted' && userCoords) {
      url = `https://www.google.com/maps/dir/?api=1&origin=${userCoords.lat},${userCoords.lng}&destination=${coords.lat},${coords.lng}&travelmode=${travelMode}`;
    }

    window.open(url, '_blank', 'noopener,noreferrer');
    closeVehiclePicker();
  }

  function switchModalTab(targetTab) {
    activeModalTab = targetTab;
    const tabs = ['nav', 'contact', 'trends'];
    tabs.forEach((tab) => {
      const tabBtn = document.getElementById(`modal-tab-${tab}`);
      const panel = document.getElementById(`panel-tab-${tab}`);
      const isActive = tab === targetTab;

      if (tabBtn) {
        tabBtn.classList.toggle('active', isActive);
        tabBtn.setAttribute('aria-selected', isActive ? 'true' : 'false');
      }
      if (panel) {
        panel.classList.toggle('active', isActive);
      }
    });

    if (targetTab === 'nav' && mapInstance && window.google && window.google.maps) {
      setTimeout(() => {
        google.maps.event.trigger(mapInstance, 'resize');
        if (currentModalRecord) {
          const coords = MANDI_COORDINATES[currentModalRecord.market] || MANDI_COORDINATES[currentModalRecord.district] || null;
          if (coords) mapInstance.setCenter(coords);
        }
      }, 60);
    }
  }

  function updateModalI18n(record) {
    if (!record) return;
    const cropName = currentLang === 'hi' ? (record.name_hi || record.commodity) : (record.name_en || record.commodity);
    const cropNameEl = document.getElementById('modal-crop-name');
    if (cropNameEl) cropNameEl.textContent = cropName;

    // Refresh active tabs
    const coords = MANDI_COORDINATES[record.market] || MANDI_COORDINATES[record.district] || null;
    renderMapTab(coords, record);
    renderContactTab(coords, record);
    renderRatesTab(record);
  }

  // ============================================================
  // TAB 1: Map & Navigation Rendering
  // ============================================================

  async function renderMapTab(mandiCoords, mandiRecord) {
    const mapContainer = document.getElementById('mandi-map');
    const skeleton = document.getElementById('map-skeleton');
    const unavailBox = document.getElementById('map-unavailable-box');
    const startNavBtn = document.getElementById('start-nav-btn');
    const navUnavailHint = document.getElementById('nav-unavailable-hint');
    const routeDistEl = document.getElementById('route-distance');
    const routeDurEl = document.getElementById('route-duration');
    const gpsNoticeBox = document.getElementById('gps-notice-box');
    const gpsNoticeText = document.getElementById('gps-notice-text');
    const t = i18n[currentLang] || {};

    // 1. Configure "Start Navigation" button
    if (startNavBtn) {
      if (mandiCoords && typeof mandiCoords.lat === 'number' && typeof mandiCoords.lng === 'number') {
        startNavBtn.disabled = false;
        startNavBtn.classList.remove('disabled');
        startNavBtn.onclick = () => openVehiclePicker(mandiCoords, mandiRecord);
        if (navUnavailHint) navUnavailHint.classList.add('hidden');
      } else {
        startNavBtn.disabled = true;
        startNavBtn.classList.add('disabled');
        startNavBtn.onclick = null;
        if (navUnavailHint) {
          navUnavailHint.textContent = t.location_unavailable_mandi || 'Location unavailable for this mandi';
          navUnavailHint.classList.remove('hidden');
        }
      }
    }

    // 2. Load Maps API and initialize map
    if (skeleton) skeleton.classList.remove('hidden');
    if (unavailBox) unavailBox.classList.add('hidden');

    try {
      await loadGoogleMapsApi();

      if (!mandiCoords) {
        if (skeleton) skeleton.classList.add('hidden');
        if (unavailBox) {
          unavailBox.classList.remove('hidden');
          const title = unavailBox.querySelector('.map-unavail-title');
          if (title) title.textContent = t.location_unavailable_mandi || 'Location unavailable for this mandi';
        }
        return;
      }

      const { Map } = await safeImportLibrary('maps');
      const { AdvancedMarkerElement, PinElement } = await safeImportLibrary('marker');

      // Initialize map instance if not existing
      if (!mapInstance) {
        mapInstance = new Map(mapContainer, {
          zoom: 13,
          center: mandiCoords,
          mapId: '884cdf8ccec29a5374874467', // Cloud-styled Map ID for Krishi Mitra
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          internalUsageAttributionIds: ['gmp_git_agentskills_v1']
        });
      } else {
        mapInstance.setCenter(mandiCoords);
        mapInstance.setZoom(13);
      }

      google.maps.event.trigger(mapInstance, 'resize');

      // Clear previous mandi marker
      if (mandiMarker) {
        mandiMarker.map = null;
        mandiMarker = null;
        window.mandiMarker = null;
      }

      const mandiPin = new PinElement({
        glyphText: '🌾',
        background: '#16a34a',
        borderColor: '#14532d'
      });

      mandiMarker = new AdvancedMarkerElement({
        map: mapInstance,
        position: mandiCoords,
        title: `${mandiRecord.market}, ${mandiRecord.district}`,
        content: mandiPin
      });
      window.mandiMarker = mandiMarker;

      // Clear previous user marker
      if (userMarker) {
        userMarker.map = null;
        userMarker = null;
        window.userMarker = null;
      }

      // If user GPS granted, place user marker and calculate route
      if (userLocationState === 'granted' && userCoords) {
        const userPin = new PinElement({
          glyphText: '📍',
          background: '#2563eb',
          borderColor: '#1d4ed8'
        });

        userMarker = new AdvancedMarkerElement({
          map: mapInstance,
          position: userCoords,
          title: t.my_crops || 'My Location',
          content: userPin
        });
        window.userMarker = userMarker;

        // Fit bounds
        const { LatLngBounds } = await safeImportLibrary('core');
        const bounds = new LatLngBounds();
        bounds.extend(mandiCoords);
        bounds.extend(userCoords);
        mapInstance.fitBounds(bounds, { top: 40, bottom: 40, left: 40, right: 40 });

        if (gpsNoticeBox) gpsNoticeBox.classList.add('hidden');
        if (routeDistEl) routeDistEl.textContent = t.distance_calculating || 'Calculating...';
        if (routeDurEl) routeDurEl.textContent = '';

        try {
          const routesLib = await safeImportLibrary('routes');
          let distanceText = '';
          let durationText = '';

          // Prefer modern Routes API: Route.computeRoutes
          if (routesLib.Route && typeof routesLib.Route.computeRoutes === 'function') {
            try {
              const res = await routesLib.Route.computeRoutes({
                origin: userCoords,
                destination: mandiCoords,
                travelMode: 'DRIVING',
                fields: ['distanceMeters', 'durationMillis']
              });
              if (res && res.routes && res.routes.length > 0) {
                const route = res.routes[0];
                if (typeof route.distanceMeters === 'number') {
                  const km = (route.distanceMeters / 1000).toFixed(1);
                  distanceText = `${km} km`;
                }
                if (typeof route.durationMillis === 'number') {
                  const totalMins = Math.round(route.durationMillis / 60000);
                  if (totalMins >= 60) {
                    const hrs = Math.floor(totalMins / 60);
                    const remMins = totalMins % 60;
                    durationText = remMins > 0 ? `${hrs} hr ${remMins} min` : `${hrs} hr`;
                  } else {
                    durationText = `${totalMins} min`;
                  }
                }
              }
            } catch (computeErr) {
              console.warn('[market] Route.computeRoutes error, falling back to DirectionsService:', computeErr);
            }
          }

          if (distanceText && durationText) {
            if (routeDistEl) routeDistEl.textContent = distanceText;
            if (routeDurEl) routeDurEl.textContent = durationText;
          } else if (routesLib.DirectionsService) {
            // Fallback to DirectionsService
            const directionsService = new routesLib.DirectionsService();
            const travelModeDriving = (window.google?.maps?.TravelMode?.DRIVING) || 'DRIVING';

            directionsService.route({
              origin: userCoords,
              destination: mandiCoords,
              travelMode: travelModeDriving
            }, (result, status) => {
              if (status === 'OK' && result && result.routes && result.routes.length > 0) {
                const leg = result.routes[0].legs[0];
                if (routeDistEl) routeDistEl.textContent = leg.distance.text;
                if (routeDurEl) routeDurEl.textContent = leg.duration.text;
              } else {
                const km = calculateHaversineDistanceKm(userCoords.lat, userCoords.lng, mandiCoords.lat, mandiCoords.lng);
                if (routeDistEl) routeDistEl.textContent = `~${Math.round(km)} km`;
                if (routeDurEl) routeDurEl.textContent = `~${Math.round(km * 1.5)} mins`;
              }
            });
          } else {
            const km = calculateHaversineDistanceKm(userCoords.lat, userCoords.lng, mandiCoords.lat, mandiCoords.lng);
            if (routeDistEl) routeDistEl.textContent = `~${Math.round(km)} km`;
            if (routeDurEl) routeDurEl.textContent = `~${Math.round(km * 1.5)} mins`;
          }
        } catch (dirErr) {
          console.warn('[market] DirectionsService error:', dirErr);
          const km = calculateHaversineDistanceKm(userCoords.lat, userCoords.lng, mandiCoords.lat, mandiCoords.lng);
          if (routeDistEl) routeDistEl.textContent = `~${Math.round(km)} km`;
          if (routeDurEl) routeDurEl.textContent = `~${Math.round(km * 1.5)} mins`;
        }
      } else {
        // User location not granted
        mapInstance.setCenter(mandiCoords);
        mapInstance.setZoom(13);

        if (routeDistEl) routeDistEl.textContent = '-- km';
        if (routeDurEl) routeDurEl.textContent = '-- mins';

        if (gpsNoticeBox) {
          gpsNoticeBox.classList.remove('hidden');
          if (gpsNoticeText) {
            if (userLocationState === 'denied') {
              gpsNoticeText.textContent = t.location_permission_denied || 'Location permission denied. Showing mandi location.';
            } else if (userLocationState === 'timeout') {
              gpsNoticeText.textContent = 'Location timed out. Showing mandi location.';
            } else {
              gpsNoticeText.textContent = t.gps_required_for_distance || 'Enable location for distance and duration';
            }
          }
        }
      }

      if (skeleton) skeleton.classList.add('hidden');
    } catch (err) {
      console.warn('[market] Maps tab error / API key empty:', err.message);
      if (skeleton) skeleton.classList.add('hidden');
      if (unavailBox) {
        unavailBox.classList.remove('hidden');
        const title = unavailBox.querySelector('.map-unavail-title');
        const desc = unavailBox.querySelector('.map-unavail-desc');
        if (title) title.textContent = t.maps_unavailable || 'Google Maps is currently unavailable';
        if (desc) desc.textContent = t.maps_unavailable_desc || 'Map service could not be loaded. Please try again later.';
      }
    }
  }

  // ============================================================
  // TAB 2: Contact Info Rendering
  // ============================================================

  async function renderContactTab(mandiCoords, mandiRecord) {
    const contactSkeleton = document.getElementById('contact-skeleton');
    const contactContent = document.getElementById('contact-details-content');
    const kisanFallback = document.getElementById('kisan-call-fallback');
    const addressEl = document.getElementById('contact-address');
    const hoursEl = document.getElementById('contact-hours');
    const phoneEl = document.getElementById('contact-phone');
    const t = i18n[currentLang] || {};

    if (contactSkeleton) contactSkeleton.style.display = 'flex';
    if (contactContent) contactContent.style.display = 'none';
    if (kisanFallback) kisanFallback.style.display = 'none';

    let placeFound = null;

    try {
      if (window.google && window.google.maps) {
        const { Place } = await safeImportLibrary('places');
        const query = `${mandiRecord.market} APMC ${mandiRecord.district} ${mandiRecord.state}`;
        const res = await Place.searchByText({
          textQuery: query,
          fields: ['displayName', 'formattedAddress', 'nationalPhoneNumber', 'regularOpeningHours', 'location']
        });

        if (res && res.places && res.places.length > 0) {
          placeFound = res.places[0];
          // If we got coordinates from Places API and didn't have them, update
          if (!mandiCoords && placeFound.location) {
            mandiCoords = {
              lat: typeof placeFound.location.lat === 'function' ? placeFound.location.lat() : placeFound.location.lat,
              lng: typeof placeFound.location.lng === 'function' ? placeFound.location.lng() : placeFound.location.lng
            };
          }
        }
      }
    } catch (placeErr) {
      console.warn('[market] Places API Place Details error:', placeErr);
    }

    if (contactSkeleton) contactSkeleton.style.display = 'none';
    if (contactContent) contactContent.style.display = 'flex';

    const defaultAddress = `${mandiRecord.market}, District ${mandiRecord.district}, ${mandiRecord.state}, India`;
    const defaultHours = currentLang === 'hi'
      ? 'सोमवार - शनिवार: सुबह 8:00 - शाम 6:00 (रविवार बंद)'
      : 'Mon - Sat: 8:00 AM - 6:00 PM (Sunday Closed)';
    const exactFallbackMessage = currentLang === 'hi'
      ? 'सीधा संपर्क उपलब्ध नहीं है। सहायता के लिए किसान कॉल सेंटर से संपर्क करें: 1800-180-1551।'
      : 'Direct contact unavailable. For assistance, contact the Kisan Call Centre: 1800-180-1551.';

    if (placeFound) {
      if (addressEl) addressEl.textContent = placeFound.formattedAddress || defaultAddress;

      if (hoursEl) {
        if (placeFound.regularOpeningHours && placeFound.regularOpeningHours.weekdayDescriptions) {
          hoursEl.textContent = placeFound.regularOpeningHours.weekdayDescriptions.slice(0, 2).join(' • ');
        } else {
          hoursEl.textContent = defaultHours;
        }
      }

      if (placeFound.nationalPhoneNumber) {
        const phone = placeFound.nationalPhoneNumber.trim();
        if (phoneEl) phoneEl.innerHTML = `<a href="tel:${phone}">${phone}</a>`;
        if (kisanFallback) kisanFallback.style.display = 'none';
      } else {
        if (phoneEl) phoneEl.textContent = currentLang === 'hi' ? 'सीधा संपर्क फोन नंबर उपलब्ध नहीं है' : 'Direct phone number unavailable';
        if (kisanFallback) {
          kisanFallback.style.display = 'flex';
          const msgEl = kisanFallback.querySelector('.fallback-message');
          if (msgEl) msgEl.textContent = exactFallbackMessage;
        }
      }
    } else {
      if (addressEl) addressEl.textContent = defaultAddress;
      if (hoursEl) hoursEl.textContent = defaultHours;
      if (phoneEl) phoneEl.textContent = currentLang === 'hi' ? 'सीधा संपर्क फोन नंबर उपलब्ध नहीं है' : 'Direct phone number unavailable';
      if (kisanFallback) {
        kisanFallback.style.display = 'flex';
        const msgEl = kisanFallback.querySelector('.fallback-message');
        if (msgEl) msgEl.textContent = exactFallbackMessage;
      }
    }
  }

  // ============================================================
  // TAB 3: Rates & Trends Rendering
  // ============================================================

  // TODO (Phase 3): Implement historical trend calculation based on multi-day mandi records.
  // Currently, single-day snapshots do not contain sufficient historical depth for statistical trend modeling.
  function calculateHistoricalTrend(mandiRecord) {
    // Phase 3 placeholder: will calculate multi-day price delta, moving average, and volatility index.
    return null;
  }

  function renderRatesTab(mandiRecord) {
    const modalRateEl = document.getElementById('modal-rate-price');
    const rangeEl = document.getElementById('modal-rate-range');
    const dateEl = document.getElementById('modal-rate-date');
    const trendResultCard = document.getElementById('trend-result-card');
    const trendNodataCard = document.getElementById('trend-nodata-card');
    const t = i18n[currentLang] || {};

    if (modalRateEl) modalRateEl.textContent = `₹${Math.round(mandiRecord.modal || 0).toLocaleString()}`;
    if (rangeEl) {
      const minVal = Math.round(mandiRecord.min || mandiRecord.modal || 0).toLocaleString();
      const maxVal = Math.round(mandiRecord.max || mandiRecord.modal || 0).toLocaleString();
      rangeEl.textContent = `₹${minVal} — ₹${maxVal}`;
    }
    if (dateEl) {
      dateEl.textContent = `📅 ${formatDate(mandiRecord.arrival_date)}`;
    }

    // Reset trend analysis area
    if (trendResultCard) trendResultCard.classList.add('hidden');
    if (trendNodataCard) trendNodataCard.classList.add('hidden');

    const btnAiTrend = document.getElementById('btn-ai-trend');
    if (btnAiTrend) {
      btnAiTrend.innerHTML = `<span>📈</span> <span>${currentLang === 'hi' ? 'हालिया रुझान' : 'AI Trend Analysis'}</span>`;
      btnAiTrend.onclick = () => {
        // Phase 2: No simulated trends. Always show "Not enough data yet" / "पर्याप्त डेटा उपलब्ध नहीं है"
        // Phase 3 will populate real historical trends via calculateHistoricalTrend(mandiRecord)
        if (trendResultCard) trendResultCard.classList.add('hidden');
        if (trendNodataCard) {
          const textEl = trendNodataCard.querySelector('.nodata-text');
          if (textEl) {
            textEl.textContent = t.not_enough_data || (currentLang === 'hi' ? 'पर्याप्त डेटा उपलब्ध नहीं है' : 'Not enough data yet');
          }
          trendNodataCard.classList.remove('hidden');
        }
      };
    }
  }

  // Expose global hooks for main.js and HTML
  window.renderMarket = renderMarket;
  window.filterMarket = filterMarket;
  window.onLanguageChange = onLanguageChange;
  window.openCommodityModal = openCommodityModal;
  window.closeCommodityModal = closeCommodityModal;
  window.openVehiclePicker = openVehiclePicker;
  window.closeVehiclePicker = closeVehiclePicker;
  window.selectVehicleMode = selectVehicleMode;
  window.calculateHistoricalTrend = calculateHistoricalTrend;
  window.__resetMapsStateForTesting = () => {
    googleMapsLoaded = false;
    googleMapsPromise = null;
    googleMapsLoadError = false;
    mapInstance = null;
    if (mandiMarker) { mandiMarker.map = null; mandiMarker = null; window.mandiMarker = null; }
    if (userMarker) { userMarker.map = null; userMarker = null; window.userMarker = null; }
    const container = document.getElementById('mandi-map');
    if (container) container.innerHTML = '';
  };

  function checkUrlLang() {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const urlLang = urlParams.get('lang');
      if (urlLang && (urlLang === 'en' || urlLang === 'hi')) {
        if (typeof setLanguage === 'function') {
          setLanguage(urlLang);
        } else {
          currentLang = urlLang;
          localStorage.setItem('language', urlLang);
        }
      }
    } catch (e) {}
  }

  function setupModalListeners() {
    const closeBtn = document.getElementById('modal-close-btn');
    if (closeBtn) closeBtn.onclick = closeCommodityModal;

    const backdrop = document.getElementById('commodity-modal-backdrop');
    if (backdrop) {
      backdrop.onclick = (e) => {
        if (e.target === backdrop) closeCommodityModal();
      };
    }

    const vehicleCloseBtn = document.getElementById('vehicle-picker-close');
    if (vehicleCloseBtn) vehicleCloseBtn.onclick = closeVehiclePicker;

    const vehicleBackdrop = document.getElementById('vehicle-picker-backdrop');
    if (vehicleBackdrop) {
      vehicleBackdrop.onclick = (e) => {
        if (e.target === vehicleBackdrop) closeVehiclePicker();
      };
    }

    document.querySelectorAll('.vehicle-option-item').forEach((item) => {
      item.onclick = () => {
        const mode = item.getAttribute('data-mode');
        selectVehicleMode(mode);
      };
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const vehicleSheet = document.getElementById('vehicle-picker-sheet');
        if (vehicleSheet && vehicleSheet.classList.contains('open')) {
          closeVehiclePicker();
          return;
        }
        closeCommodityModal();
      }
    });

    const tabNav = document.getElementById('modal-tab-nav');
    const tabContact = document.getElementById('modal-tab-contact');
    const tabTrends = document.getElementById('modal-tab-trends');

    if (tabNav) tabNav.onclick = () => switchModalTab('nav');
    if (tabContact) tabContact.onclick = () => switchModalTab('contact');
    if (tabTrends) tabTrends.onclick = () => switchModalTab('trends');

    const gpsRetryBtn = document.getElementById('gps-retry-btn');
    if (gpsRetryBtn) {
      gpsRetryBtn.onclick = async () => {
        await requestUserLocationOnce(true);
        if (currentModalRecord) {
          const coords = MANDI_COORDINATES[currentModalRecord.market] || MANDI_COORDINATES[currentModalRecord.district] || null;
          renderMapTab(coords, currentModalRecord);
        }
      };
    }
  }

  // Initialize data on page load
  function init() {
    checkUrlLang();
    setupModalListeners();
    fetchMarketPrices();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
