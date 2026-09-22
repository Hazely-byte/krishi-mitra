/**
 * ============================================================
 * Krishi Mitra — buyers.js
 * Production Buyers & Markets Controller:
 * 1. 300km Radius Haversine Filtering (/api/buyers)
 * 2. Nearest-First Distance Sorting
 * 3. 4-Tab Detail Modal (Map & Nav, Contact, Demands, Trust)
 * 4. Google Maps & Places Integration with Fallbacks
 * 5. Vehicle Mode Selection & Navigation Deep-linking
 * ============================================================
 */

(function (window) {
  'use strict';

  // State
  let buyersData = [];
  let currentBuyerFilter = 'all';
  let activeBuyer = null;
  let activeTransportMode = 'driving';

  // Map state
  let mapInstance = null;
  let directionsService = null;
  let directionsRenderer = null;
  let userMarker = null;
  let targetMarker = null;
  let googleMapsLoaded = false;
  let googleMapsPromise = null;
  let googleMapsLoadError = false;

  // DOM Elements cache
  let buyersListEl;
  let modalBackdrop, modalPanel, modalCloseBtn;
  let tabNav, tabContact, tabDemands, tabTrust;
  let panelNav, panelContact, panelDemands, panelTrust;
  let vehicleBackdrop, vehicleSheet, vehicleCloseBtn;

  // --- Google Maps Loader ---
  async function loadGoogleMapsApi() {
    if (googleMapsLoaded && window.google?.maps) {
      return Promise.resolve(window.google.maps);
    }
    if (googleMapsPromise) return googleMapsPromise;

    let apiKey = (window.GOOGLE_MAPS_CONFIG && window.GOOGLE_MAPS_CONFIG.apiKey)
      ? window.GOOGLE_MAPS_CONFIG.apiKey.trim()
      : '';

    if (!apiKey) {
      try {
        const res = await fetch('/api/config/maps');
        if (res.ok) {
          const cfg = await res.json();
          if (cfg && cfg.apiKey) {
            window.GOOGLE_MAPS_CONFIG = window.GOOGLE_MAPS_CONFIG || {};
            window.GOOGLE_MAPS_CONFIG.apiKey = cfg.apiKey;
            apiKey = cfg.apiKey.trim();
          }
        }
      } catch (e) {}
    }

    if (!apiKey) {
      console.warn('[buyers] No Google Maps API key provided. Maps unavailable.');
      googleMapsLoadError = true;
      return Promise.reject(new Error('MISSING_API_KEY'));
    }

    googleMapsPromise = new Promise((resolve, reject) => {
      if (document.querySelector('script[src*="maps.googleapis.com"]')) {
        let attempts = 0;
        const interval = setInterval(() => {
          attempts++;
          if (window.google?.maps) {
            clearInterval(interval);
            googleMapsLoaded = true;
            resolve(window.google.maps);
          } else if (attempts > 50) {
            clearInterval(interval);
            googleMapsLoadError = true;
            reject(new Error('MAPS_LOAD_TIMEOUT'));
          }
        }, 100);
        return;
      }

      const script = document.createElement('script');
      script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places,geometry`;
      script.async = true;
      script.defer = true;
      script.onload = () => {
        googleMapsLoaded = true;
        resolve(window.google.maps);
      };
      script.onerror = (e) => {
        googleMapsLoadError = true;
        reject(e);
      };
      document.head.appendChild(script);
    });

    return googleMapsPromise;
  }

  // --- Fetch Buyers from Live Backend (/api/buyers) ---
  async function fetchBuyers() {
    const list = document.getElementById('buyers-list');
    if (list) {
      list.innerHTML = `
        <div style="text-align:center; padding:36px 16px; color:var(--gray-500);">
          <div class="skeleton-spinner" style="margin:0 auto 12px;"></div>
          <div style="font-size:14px; font-weight:600;">${(window.i18n && i18n[currentLang]?.loading_prices) || 'Loading buyers & markets within 300km...'}</div>
        </div>
      `;
    }

    let lat = null;
    let lng = null;

    if (window.KrishiLocation && typeof window.KrishiLocation.getGpsSession === 'function') {
      const gps = window.KrishiLocation.getGpsSession();
      if (gps && gps.state === 'granted' && gps.coords) {
        lat = gps.coords.lat;
        lng = gps.coords.lng;
      }
    }

    let url = `/api/buyers?radius=300&type=${encodeURIComponent(currentBuyerFilter)}`;
    if (typeof lat === 'number' && typeof lng === 'number') {
      url += `&lat=${lat}&lng=${lng}`;
    }

    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      buyersData = Array.isArray(data) ? data : [];
      renderBuyersList();
    } catch (err) {
      console.error('[buyers] Failed to fetch buyers:', err);
      if (list) {
        list.innerHTML = `
          <div style="text-align:center; padding:36px 16px; color:var(--gray-500);">
            <div style="font-size:24px; margin-bottom:8px;">⚠️</div>
            <div style="font-size:14px; font-weight:600;">Failed to load nearby buyers</div>
            <button class="status-retry-btn" onclick="window.fetchBuyers()" style="margin-top:12px;">🔄 Retry</button>
          </div>
        `;
      }
    }
  }

  // --- Render Buyers Card List ---
  function renderBuyersList() {
    const list = document.getElementById('buyers-list');
    if (!list) return;

    if (buyersData.length === 0) {
      list.innerHTML = `
        <div style="text-align:center; padding:48px 16px; color:var(--gray-500);">
          <div style="font-size:32px; margin-bottom:8px;">🤝</div>
          <div style="font-size:15px; font-weight:700; color:var(--gray-700);">No buyers found in this category</div>
          <div style="font-size:12.5px; margin-top:4px;">Try selecting "All" or expanding your radius.</div>
        </div>
      `;
      return;
    }

    const t = (window.i18n && i18n[currentLang]) || {};

    list.innerHTML = buyersData.map(b => {
      const displayName = currentLang === 'hi' ? (b.nameHi || b.name) : b.name;
      const displayCat = currentLang === 'hi' ? (b.categoryHi || b.category) : b.category;
      const avatarIcon = b.type === 'market' ? '🏪' : (b.type === 'company' ? '🏢' : '👤');

      // Primary Demand Preview
      let demandPreviewHtml = '';
      if (Array.isArray(b.activeDemands) && b.activeDemands.length > 0) {
        const topDemand = b.activeDemands[0];
        const cropName = currentLang === 'hi' ? (topDemand.cropHi || topDemand.crop) : topDemand.crop;
        demandPreviewHtml = `
          <div class="buyer-demand-preview">
            <span>🌾</span>
            <span><strong>${cropName}</strong>: <span style="color:var(--green-700); font-weight:700;">${topDemand.price}</span> (${topDemand.grade} • ${topDemand.minQty})</span>
          </div>
        `;
      }

      return `
        <div class="buyer-card" data-type="${b.type}" data-id="${b.id}">
          <div class="buyer-header">
            <div class="buyer-avatar ${b.type}">
              ${avatarIcon}
            </div>
            <div style="flex:1; min-width:0;">
              <div class="buyer-name" style="font-size:15px; font-weight:700; color:var(--gray-800);">${displayName}</div>
              <div class="buyer-type" style="font-size:12px; color:var(--gray-500); font-weight:500;">${displayCat}</div>
              <span class="buyer-distance-badge">📍 ${b.distanceDisplay || (b.distanceKm + ' km')} (${b.district})</span>
            </div>
          </div>

          <div class="buyer-details" style="margin-top:10px;">
            <div class="detail-item">
              <span class="detail-icon">📍</span>
              <span style="font-size:12.5px; color:var(--gray-700);">${b.contact?.address || `${b.district}, ${b.state}`}</span>
            </div>
            ${demandPreviewHtml}
          </div>

          <button class="btn-view-details" onclick="window.openBuyerDetailModal('${b.id}')" style="margin-top:12px;">
            👁️ ${t.view_details || 'View Details'}
          </button>
        </div>
      `;
    }).join('');
  }

  // --- Filter Handler ---
  function filterBuyers(btn, type) {
    currentBuyerFilter = type;
    document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
    if (btn) btn.classList.add('active');
    fetchBuyers();
  }

  // ============================================================
  // 4-Tab Detail Modal Implementation
  // ============================================================

  function initModalElements() {
    modalBackdrop = document.getElementById('buyer-modal-backdrop');
    modalPanel = document.getElementById('buyer-modal-panel');
    modalCloseBtn = document.getElementById('buyer-modal-close');

    tabNav = document.getElementById('buyer-tab-nav');
    tabContact = document.getElementById('buyer-tab-contact');
    tabDemands = document.getElementById('buyer-tab-demands');
    tabTrust = document.getElementById('buyer-tab-trust');

    panelNav = document.getElementById('buyer-panel-nav');
    panelContact = document.getElementById('buyer-panel-contact');
    panelDemands = document.getElementById('buyer-panel-demands');
    panelTrust = document.getElementById('buyer-panel-trust');

    vehicleBackdrop = document.getElementById('buyer-vehicle-picker-backdrop');
    vehicleSheet = document.getElementById('buyer-vehicle-picker-sheet');
    vehicleCloseBtn = document.getElementById('buyer-vehicle-picker-close');

    if (modalCloseBtn) modalCloseBtn.onclick = closeBuyerDetailModal;
    if (modalBackdrop) modalBackdrop.onclick = closeBuyerDetailModal;

    if (tabNav) tabNav.onclick = () => switchBuyerTab('nav');
    if (tabContact) tabContact.onclick = () => switchBuyerTab('contact');
    if (tabDemands) tabDemands.onclick = () => switchBuyerTab('demands');
    if (tabTrust) tabTrust.onclick = () => switchBuyerTab('trust');

    if (vehicleCloseBtn) vehicleCloseBtn.onclick = closeVehiclePicker;
    if (vehicleBackdrop) vehicleBackdrop.onclick = closeVehiclePicker;

    // Hook vehicle mode options
    document.querySelectorAll('#buyer-vehicle-picker-sheet .vehicle-option-item').forEach(btn => {
      btn.onclick = () => {
        const mode = btn.getAttribute('data-mode') || 'driving';
        selectVehicleMode(mode);
      };
    });

    // Hook transport mode selector badge on Tab 1
    const modeBtn = document.getElementById('buyer-route-mode-btn');
    if (modeBtn) modeBtn.onclick = openVehiclePicker;

    // Keyboard support: Escape closes modal
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (vehicleSheet?.classList.contains('open')) {
          closeVehiclePicker();
        } else if (modalPanel?.classList.contains('open')) {
          closeBuyerDetailModal();
        }
      }
    });
  }

  function switchBuyerTab(targetTab) {
    const tabs = ['nav', 'contact', 'demands', 'trust'];
    tabs.forEach(tab => {
      const btn = document.getElementById(`buyer-tab-${tab}`);
      const panel = document.getElementById(`buyer-panel-${tab}`);
      const isActive = tab === targetTab;

      if (btn) {
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
      }
      if (panel) {
        panel.classList.toggle('active', isActive);
      }
    });

    if (targetTab === 'nav' && mapInstance && window.google?.maps) {
      setTimeout(() => {
        google.maps.event.trigger(mapInstance, 'resize');
        if (activeBuyer?.coords) {
          mapInstance.setCenter(activeBuyer.coords);
        }
      }, 80);
    }
  }

  async function openBuyerDetailModal(buyerId) {
    const buyer = buyersData.find(b => b.id === buyerId);
    if (!buyer) return;
    activeBuyer = buyer;

    initModalElements();

    // Populate Modal Header
    const iconEl = document.getElementById('buyer-modal-icon');
    const titleEl = document.getElementById('buyer-modal-title');
    const badgeEl = document.getElementById('buyer-modal-badge');
    const locEl = document.getElementById('buyer-modal-location');
    const distEl = document.getElementById('buyer-modal-distance');

    const displayName = currentLang === 'hi' ? (buyer.nameHi || buyer.name) : buyer.name;
    const displayCat = currentLang === 'hi' ? (buyer.categoryHi || buyer.category) : buyer.category;
    const avatarIcon = buyer.type === 'market' ? '🏪' : (buyer.type === 'company' ? '🏢' : '👤');

    if (iconEl) iconEl.textContent = avatarIcon;
    if (titleEl) titleEl.textContent = displayName;
    if (badgeEl) badgeEl.textContent = displayCat;
    if (locEl) locEl.textContent = `📍 ${buyer.district}, ${buyer.state}`;
    if (distEl) distEl.textContent = `📍 ${buyer.distanceDisplay || (buyer.distanceKm + ' km')}`;

    // Switch to Tab 1 (Map & Nav)
    switchBuyerTab('nav');

    // Open Modal Panel & Backdrop
    if (modalBackdrop) {
      modalBackdrop.classList.add('open');
      modalBackdrop.setAttribute('aria-hidden', 'false');
    }
    if (modalPanel) {
      modalPanel.classList.add('open');
    }

    // Render Tab 1 (Map & Nav)
    renderMapTab(buyer);

    // Render Tab 2 (Contact)
    renderContactTab(buyer);

    // Render Tab 3 (Active Demands)
    renderDemandsTab(buyer);

    // Render Tab 4 (Trust & Payment)
    renderTrustTab(buyer);
  }

  function closeBuyerDetailModal() {
    activeBuyer = null;
    if (modalBackdrop) {
      modalBackdrop.classList.remove('open');
      modalBackdrop.setAttribute('aria-hidden', 'true');
    }
    if (modalPanel) {
      modalPanel.classList.remove('open');
    }
    closeVehiclePicker();
  }

  // --- Tab 1: Map & Navigation Rendering ---
  async function renderMapTab(buyer) {
    const mapContainer = document.getElementById('buyer-mandi-map');
    const skeleton = document.getElementById('buyer-map-skeleton');
    const unavailBox = document.getElementById('buyer-map-unavailable-box');
    const startNavBtn = document.getElementById('buyer-start-nav-btn');
    const navUnavailHint = document.getElementById('buyer-nav-unavailable-hint');
    const routeDistEl = document.getElementById('buyer-route-distance');
    const routeDurEl = document.getElementById('buyer-route-duration');
    const gpsNoticeBox = document.getElementById('buyer-gps-notice-box');
    const t = (window.i18n && i18n[currentLang]) || {};

    const targetCoords = buyer.coords;

    // Check GPS session
    let userCoords = null;
    if (window.KrishiLocation && typeof window.KrishiLocation.getGpsSession === 'function') {
      const gps = window.KrishiLocation.getGpsSession();
      if (gps && gps.state === 'granted' && gps.coords) {
        userCoords = gps.coords;
      }
    }

    if (gpsNoticeBox) {
      if (userCoords) {
        gpsNoticeBox.classList.add('hidden');
      } else {
        gpsNoticeBox.classList.remove('hidden');
        const retryBtn = document.getElementById('buyer-gps-retry-btn');
        if (retryBtn) {
          retryBtn.onclick = async () => {
            if (window.KrishiLocation) {
              const res = await window.KrishiLocation.requestUserLocationOnce(true);
              if (res.state === 'granted') {
                renderMapTab(buyer);
                fetchBuyers();
              }
            }
          };
        }
      }
    }

    // Configure "Start Navigation" button
    if (startNavBtn) {
      if (targetCoords && typeof targetCoords.lat === 'number' && typeof targetCoords.lng === 'number') {
        startNavBtn.disabled = false;
        startNavBtn.classList.remove('disabled');
        startNavBtn.onclick = () => openVehiclePicker();
        if (navUnavailHint) navUnavailHint.classList.add('hidden');
      } else {
        startNavBtn.disabled = true;
        startNavBtn.classList.add('disabled');
        startNavBtn.onclick = null;
        if (navUnavailHint) navUnavailHint.classList.remove('hidden');
      }
    }

    // Initialize Map
    if (skeleton) skeleton.classList.remove('hidden');
    if (unavailBox) unavailBox.classList.add('hidden');

    try {
      await loadGoogleMapsApi();

      if (!targetCoords) {
        if (skeleton) skeleton.classList.add('hidden');
        if (unavailBox) unavailBox.classList.remove('hidden');
        return;
      }

      const mapOptions = {
        zoom: 13,
        center: targetCoords,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        zoomControl: true
      };

      if (!mapInstance && mapContainer) {
        mapInstance = new google.maps.Map(mapContainer, mapOptions);
        directionsService = new google.maps.DirectionsService();
        directionsRenderer = new google.maps.DirectionsRenderer({
          map: mapInstance,
          suppressMarkers: false,
          polylineOptions: {
            strokeColor: '#16a34a',
            strokeWeight: 5
          }
        });
      } else if (mapInstance) {
        mapInstance.setCenter(targetCoords);
        mapInstance.setZoom(13);
      }

      if (skeleton) skeleton.classList.add('hidden');

      // Clear existing markers if not using directions
      if (targetMarker) targetMarker.setMap(null);
      if (userMarker) userMarker.setMap(null);

      // Directions request if user coords granted
      if (userCoords && directionsService && directionsRenderer) {
        const reqTravelMode = activeTransportMode === 'transit'
          ? google.maps.TravelMode.TRANSIT
          : (activeTransportMode === 'walking'
            ? google.maps.TravelMode.WALKING
            : google.maps.TravelMode.DRIVING);

        directionsService.route({
          origin: userCoords,
          destination: targetCoords,
          travelMode: reqTravelMode
        }, (res, status) => {
          if (status === google.maps.DirectionsStatus.OK && res) {
            directionsRenderer.setDirections(res);
            const leg = res.routes[0]?.legs[0];
            if (leg) {
              if (routeDistEl) routeDistEl.textContent = leg.distance?.text || `${buyer.distanceKm} km`;
              if (routeDurEl) routeDurEl.textContent = leg.duration?.text || '-- mins';
            }
          } else {
            console.warn('[buyers] Directions failed, falling back to straight-line marker:', status);
            fallbackTargetMarker(targetCoords, buyer.name);
            if (routeDistEl) routeDistEl.textContent = `${buyer.distanceKm} km`;
            if (routeDurEl) routeDurEl.textContent = '--';
          }
        });
      } else {
        fallbackTargetMarker(targetCoords, buyer.name);
        if (routeDistEl) routeDistEl.textContent = `${buyer.distanceKm} km`;
        if (routeDurEl) routeDurEl.textContent = '--';
      }

    } catch (err) {
      console.warn('[buyers] Maps rendering error:', err);
      if (skeleton) skeleton.classList.add('hidden');
      if (unavailBox) unavailBox.classList.remove('hidden');
      if (routeDistEl) routeDistEl.textContent = `${buyer.distanceKm} km`;
      if (routeDurEl) routeDurEl.textContent = '--';
    }
  }

  function fallbackTargetMarker(coords, title) {
    if (directionsRenderer) directionsRenderer.set('directions', null);
    if (mapInstance && window.google?.maps) {
      targetMarker = new google.maps.Marker({
        position: coords,
        map: mapInstance,
        title: title || 'Buyer Location',
        animation: google.maps.Animation.DROP
      });
      mapInstance.setCenter(coords);
    }
  }

  // --- Tab 2: Contact Info Rendering ---
  function renderContactTab(buyer) {
    const addrEl = document.getElementById('buyer-contact-address');
    const hoursEl = document.getElementById('buyer-contact-hours');
    const phoneEl = document.getElementById('buyer-contact-phone');
    const fallbackEl = document.getElementById('buyer-kisan-fallback');

    const contact = buyer.contact || {};
    const address = contact.address || `${buyer.district}, ${buyer.state}`;
    const hours = contact.hours || '09:00 AM – 06:00 PM (Mon–Sat)';
    const phone = contact.phone || null;

    if (addrEl) addrEl.textContent = address;
    if (hoursEl) hoursEl.textContent = hours;

    if (phoneEl) {
      if (phone && phone !== '1800-180-1551') {
        phoneEl.innerHTML = `<a href="tel:${phone.replace(/[^0-9+]/g, '')}">📞 ${phone}</a>`;
      } else if (phone === '1800-180-1551') {
        phoneEl.innerHTML = `<a href="tel:18001801551">📞 1800-180-1551 (Toll-Free)</a>`;
      } else {
        phoneEl.textContent = 'Contact details via Kisan Helpline';
      }
    }

    if (fallbackEl) {
      // Always keep helpline accessible for farmer reassurance
      fallbackEl.classList.remove('hidden');
    }
  }

  // --- Tab 3: Active Demands Rendering ---
  function renderDemandsTab(buyer) {
    const listEl = document.getElementById('buyer-demands-list');
    if (!listEl) return;

    const demands = Array.isArray(buyer.activeDemands) ? buyer.activeDemands : [];
    if (demands.length === 0) {
      listEl.innerHTML = `
        <div style="text-align:center; padding:24px; color:var(--gray-500); font-size:13px;">
          No specific crop quotas currently listed. Contact buyer directly for spot procurement.
        </div>
      `;
      return;
    }

    listEl.innerHTML = demands.map(d => {
      const cropName = currentLang === 'hi' ? (d.cropHi || d.crop) : d.crop;
      return `
        <div class="demand-item-card">
          <div class="demand-card-header">
            <span class="demand-crop-title">🌾 ${cropName}</span>
            <span class="demand-price-pill">${d.price}</span>
          </div>
          <div class="demand-meta-row">
            <span class="demand-badge grade">Quality: ${d.grade}</span>
            <span class="demand-badge qty">Min Lot: ${d.minQty}</span>
          </div>
        </div>
      `;
    }).join('');
  }

  // --- Tab 4: Trust & Payment Terms Rendering ---
  function renderTrustTab(buyer) {
    const badgeEl = document.getElementById('buyer-trust-badge');
    const licenseEl = document.getElementById('buyer-trust-license');
    const paymentEl = document.getElementById('buyer-trust-payment');
    const amenitiesEl = document.getElementById('buyer-trust-amenities');

    const trust = buyer.trustPayment || {};
    const verifiedBadge = trust.verifiedBadge || 'Verified Procurement Partner';
    const licenseNo = buyer.licenseNo || 'Verified Registered Entity';
    const paymentTerms = trust.paymentTerms || 'Direct Bank Transfer / Account Payee Cheque within 24-48 hours upon weighment.';
    const amenities = Array.isArray(trust.amenities) ? trust.amenities : [
      'Electronic Weighbridge',
      'Covered Loading Bay',
      'Farmer Rest Area',
      'Moisture Testing Facility'
    ];

    if (badgeEl) badgeEl.textContent = `🛡️ ${verifiedBadge}`;
    if (licenseEl) licenseEl.textContent = `License: ${licenseNo}`;
    if (paymentEl) paymentEl.textContent = paymentTerms;

    if (amenitiesEl) {
      amenitiesEl.innerHTML = amenities.map(am => `
        <div class="trust-amenity-item">
          <span class="trust-amenity-icon">✓</span>
          <span>${am}</span>
        </div>
      `).join('');
    }
  }

  // ============================================================
  // Vehicle Mode Selection & Navigation Deep-linking
  // ============================================================

  function openVehiclePicker() {
    if (vehicleBackdrop) {
      vehicleBackdrop.classList.add('open');
      vehicleBackdrop.setAttribute('aria-hidden', 'false');
    }
    if (vehicleSheet) {
      vehicleSheet.classList.add('open');
    }
  }

  function closeVehiclePicker() {
    if (vehicleBackdrop) {
      vehicleBackdrop.classList.remove('open');
      vehicleBackdrop.setAttribute('aria-hidden', 'true');
    }
    if (vehicleSheet) {
      vehicleSheet.classList.remove('open');
    }
  }

  function selectVehicleMode(mode) {
    activeTransportMode = mode;
    closeVehiclePicker();

    // Update transport mode UI badge
    const modeLabelEl = document.getElementById('buyer-route-mode-label');
    const modeIconEl = document.getElementById('buyer-route-mode-icon');
    const startNavIconEl = document.getElementById('buyer-start-nav-icon');

    const modeMeta = {
      driving: { icon: '🚗', label: 'Driving' },
      two_wheeler: { icon: '🏍️', label: 'Two-wheeler' },
      transit: { icon: '🚌', label: 'Transit' },
      walking: { icon: '🚶', label: 'Walking' }
    }[mode] || { icon: '🚗', label: 'Driving' };

    if (modeLabelEl) modeLabelEl.textContent = modeMeta.label;
    if (modeIconEl) modeIconEl.textContent = modeMeta.icon;
    if (startNavIconEl) startNavIconEl.textContent = modeMeta.icon;

    // Trigger navigation deep-link or re-route map
    if (activeBuyer?.coords) {
      const coords = activeBuyer.coords;
      let userCoords = null;
      if (window.KrishiLocation && typeof window.KrishiLocation.getGpsSession === 'function') {
        const gps = window.KrishiLocation.getGpsSession();
        if (gps && gps.state === 'granted' && gps.coords) {
          userCoords = gps.coords;
        }
      }

      // Re-render map route with selected mode
      renderMapTab(activeBuyer);

      // Open Google Maps Universal Deep Link
      const gMapsMode = (mode === 'transit' ? 'transit' : (mode === 'walking' ? 'walking' : 'driving'));
      let navUrl = `https://www.google.com/maps/dir/?api=1&destination=${coords.lat},${coords.lng}&travelmode=${gMapsMode}`;
      if (userCoords) {
        navUrl = `https://www.google.com/maps/dir/?api=1&origin=${userCoords.lat},${userCoords.lng}&destination=${coords.lat},${coords.lng}&travelmode=${gMapsMode}`;
      }

      window.open(navUrl, '_blank', 'noopener,noreferrer');
    }
  }

  // --- Location Notice Banner ---
  async function updateLocationBanner(force = false) {
    const banner = document.getElementById('buysell-gps-banner');
    const bannerText = document.getElementById('buysell-gps-text');
    const bannerBtn = document.getElementById('buysell-gps-btn');
    const t = (window.i18n && i18n[currentLang]) || {};

    if (!window.KrishiLocation) return;

    const res = await window.KrishiLocation.requestUserLocationOnce(force);
    if (!banner) return;

    if (res.state === 'granted') {
      banner.classList.add('hidden');
      fetchBuyers();
    } else if (res.state === 'denied') {
      banner.classList.remove('hidden');
      if (bannerText) {
        bannerText.textContent = t.gps_denied_notice || 'Location permission denied. Showing all buyers.';
      }
      if (bannerBtn) {
        bannerBtn.textContent = t.gps_enable_btn || 'Enable';
        bannerBtn.onclick = () => updateLocationBanner(true);
      }
      fetchBuyers();
    } else {
      banner.classList.remove('hidden');
      if (bannerText) {
        bannerText.textContent = t.gps_buysell_prompt || 'Enable location to see nearby buyers and markets';
      }
      if (bannerBtn) {
        bannerBtn.textContent = t.gps_enable_btn || 'Enable';
        bannerBtn.onclick = () => updateLocationBanner(true);
      }
      fetchBuyers();
    }
  }

  // --- Language Change Handler ---
  function onLanguageChange() {
    renderBuyersList();
    if (activeBuyer) {
      openBuyerDetailModal(activeBuyer.id);
    }
    updateLocationBanner(false);
  }

  // --- Initializer ---
  document.addEventListener('DOMContentLoaded', () => {
    initModalElements();
    updateLocationBanner(false);
  });

  // Global Exports
  window.filterBuyers = filterBuyers;
  window.openBuyerDetailModal = openBuyerDetailModal;
  window.closeBuyerDetailModal = closeBuyerDetailModal;
  window.fetchBuyers = fetchBuyers;
  window.onLanguageChange = onLanguageChange;

})(window);
