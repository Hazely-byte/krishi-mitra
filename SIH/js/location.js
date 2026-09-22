/**
 * Krishi Mitra — Location Management Module
 * Handles browser geolocation, reverse geocoding via /api/location/resolve,
 * caching in localStorage, and safe fallback to Raipur, Chhattisgarh.
 * Never stores raw GPS coordinates.
 */

(function (window) {
  'use strict';

  const STORAGE_KEY = 'userLocation';
  const FALLBACK_LOCATION = {
    state: 'Chhattisgarh',
    district: 'Raipur',
    matched: false,
    source: 'fallback'
  };

  // Global Google Maps authentication failure handler
  window.gm_authFailure = function () {
    console.error('[Google Maps] gm_authFailure: RefererNotAllowedMapError or invalid API key.');
    const origin = window.location.origin;
    if (!document.getElementById('gm-suppress-err-style')) {
      const style = document.createElement('style');
      style.id = 'gm-suppress-err-style';
      style.textContent = '.gm-err-container { display: none !important; }';
      document.head.appendChild(style);
    }
    const applyAuthErrorUI = () => {
      document.querySelectorAll('.map-unavailable-box').forEach(box => {
        box.classList.remove('hidden');
        const title = box.querySelector('.map-unavail-title');
        if (title) title.textContent = 'Google Maps Authorization Error';
        const desc = box.querySelector('.map-unavail-desc');
        if (desc) {
          desc.innerHTML = `Domain <code>${origin}</code> is blocked by HTTP Referrer restrictions on this API key.<br><small style="color:var(--gray-600); display:block; margin-top:4px;">Authorize <code>${origin}/*</code> in Google Cloud Console.</small>`;
        }
      });
      document.querySelectorAll('.map-skeleton').forEach(s => s.classList.add('hidden'));
      document.querySelectorAll('.mandi-map').forEach(m => {
        const errBox = m.querySelector('.gm-err-container');
        if (errBox) errBox.style.display = 'none';
      });
    };
    applyAuthErrorUI();
    setTimeout(applyAuthErrorUI, 300);
    setTimeout(applyAuthErrorUI, 1000);
    setTimeout(applyAuthErrorUI, 2500);
  };

  const listeners = [];

  const SESSION_GPS_STATE_KEY = 'krishi_gps_state';
  const SESSION_GPS_COORDS_KEY = 'krishi_gps_coords';
  const STORAGE_ADDRESS_KEY = 'krishi_user_address';
  const SESSION_ADDRESS_KEY = 'krishi_user_address';

  function saveUserAddress(addr) {
    if (!addr || typeof addr !== 'string') return;
    const clean = addr.trim();
    if (!clean) return;
    try {
      sessionStorage.setItem(SESSION_ADDRESS_KEY, clean);
      localStorage.setItem(STORAGE_ADDRESS_KEY, clean);
    } catch (e) {}
  }

  function getUserAddress() {
    try {
      const sess = sessionStorage.getItem(SESSION_ADDRESS_KEY);
      if (sess && sess.trim()) return sess.trim();
      const local = localStorage.getItem(STORAGE_ADDRESS_KEY);
      if (local && local.trim()) return local.trim();
    } catch (e) {}
    const stored = getStoredLocation();
    if (stored && stored.district && stored.state) {
      return `${stored.district}, ${stored.state}`;
    }
    return 'Raipur, Chhattisgarh';
  }

  async function ensureGoogleMapsLoaded() {
    if (window.google?.maps) return window.google.maps;
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

    if (!apiKey) return null;

    if (window._gmapsPromise) return window._gmapsPromise;

    window._gmapsPromise = new Promise((resolve) => {
      if (window.google?.maps) {
        resolve(window.google.maps);
        return;
      }
      if (document.querySelector('script[src*="maps.googleapis.com"]')) {
        let attempts = 0;
        const interval = setInterval(() => {
          attempts++;
          if (window.google?.maps) {
            clearInterval(interval);
            resolve(window.google.maps);
          } else if (attempts > 50) {
            clearInterval(interval);
            resolve(null);
          }
        }, 100);
        return;
      }
      const script = document.createElement('script');
      script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=geocoding,places,marker,geometry`;
      script.async = true;
      script.defer = true;
      script.onload = () => resolve(window.google?.maps || null);
      script.onerror = () => resolve(null);
      document.head.appendChild(script);
    });
    return window._gmapsPromise;
  }

  async function reverseGeocodeGoogle(coords) {
    if (!coords || typeof coords.lat !== 'number' || typeof coords.lng !== 'number') return null;
    try {
      const gmaps = await ensureGoogleMapsLoaded();
      let GeocoderClass = gmaps?.Geocoder || window.google?.maps?.Geocoder;
      if (!GeocoderClass && window.google?.maps?.importLibrary) {
        try {
          const geocodingLib = await window.google.maps.importLibrary('geocoding');
          GeocoderClass = geocodingLib?.Geocoder;
        } catch (e) {}
      }

      if (GeocoderClass) {
        const geocoder = new GeocoderClass();
        return await new Promise((resolve) => {
          geocoder.geocode({ location: { lat: coords.lat, lng: coords.lng } }, (results, status) => {
            if (status === 'OK' && results && results.length > 0) {
              const formatted = results[0].formatted_address;
              if (formatted) {
                saveUserAddress(formatted);
                return resolve(formatted);
              }
            }
            resolve(null);
          });
        });
      }
    } catch (err) {
      console.warn('[location] Google reverse geocode error:', err);
    }
    return null;
  }

  function getStoredLocation() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.district && parsed.state) {
          return parsed;
        }
      }
    } catch (e) {
      console.warn('[location] Failed to read cached location:', e);
    }
    return null;
  }

  function getGpsSession() {
    try {
      const state = sessionStorage.getItem(SESSION_GPS_STATE_KEY) || 'unknown';
      let coords = null;
      const raw = sessionStorage.getItem(SESSION_GPS_COORDS_KEY);
      if (raw) coords = JSON.parse(raw);
      return { state, coords };
    } catch (e) {
      return { state: 'unknown', coords: null };
    }
  }

  function resetSessionState() {
    try {
      sessionStorage.removeItem(SESSION_GPS_STATE_KEY);
      sessionStorage.removeItem(SESSION_GPS_COORDS_KEY);
    } catch (e) {}
  }

  function saveLocation(loc) {
    // Only persist high-level administrative boundaries, never raw lat/lon
    const safeObj = {
      state: loc.state || 'Chhattisgarh',
      district: loc.district || 'Raipur',
      matched: !!loc.matched,
      source: loc.source || 'fallback'
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(safeObj));
    } catch (e) {}
    notifyListeners(safeObj);
    return safeObj;
  }

  function notifyListeners(loc) {
    listeners.forEach((cb) => {
      try {
        cb(loc);
      } catch (e) {
        console.error('[location] Listener error:', e);
      }
    });
  }

  /**
   * Request device geolocation with unified 4-state handling
   * (granted / denied / unavailable / timeout) and sessionStorage caching.
   * If permission was previously denied or granted in this session,
   * it returns the saved state without re-prompting (unless force === true).
   */
  async function requestUserLocationOnce(force = false) {
    if (!force) {
      const sess = getGpsSession();
      if (sess.state === 'granted' && sess.coords) {
        return { state: 'granted', coords: sess.coords, reprompted: false };
      }
      if (sess.state === 'denied') {
        // Respect per-session denial, do not re-prompt
        return { state: 'denied', coords: null, reprompted: false };
      }
      if (sess.state === 'unavailable' || sess.state === 'timeout') {
        return { state: sess.state, coords: null, reprompted: false };
      }
    }

    if (!navigator.geolocation) {
      try { sessionStorage.setItem(SESSION_GPS_STATE_KEY, 'unavailable'); } catch (e) {}
      return { state: 'unavailable', coords: null, reprompted: false };
    }

    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        async (position) => {
          const coords = {
            lat: position.coords.latitude,
            lng: position.coords.longitude
          };
          try {
            sessionStorage.setItem(SESSION_GPS_STATE_KEY, 'granted');
            sessionStorage.setItem(SESSION_GPS_COORDS_KEY, JSON.stringify(coords));
          } catch (e) {}

          // Attempt Google Maps Geocoder reverse geocoding to store human-readable address
          reverseGeocodeGoogle(coords).then((formatted) => {
            if (formatted) saveUserAddress(formatted);
          }).catch(() => {});

          // Attempt background reverse geocoding to store district/state
          try {
            fetch('/api/location/resolve', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ lat: coords.lat, lon: coords.lng })
            }).then((res) => {
              if (res.ok) return res.json();
              return null;
            }).then((data) => {
              if (data) saveLocation(data);
            }).catch(() => {});
          } catch (err) {
            console.warn('[location] Background reverse geocode error:', err);
          }

          resolve({ state: 'granted', coords, reprompted: true });
        },
        (err) => {
          let state = 'unavailable';
          if (err.code === 1) { // PERMISSION_DENIED
            state = 'denied';
          } else if (err.code === 2) { // POSITION_UNAVAILABLE
            state = 'unavailable';
          } else if (err.code === 3) { // TIMEOUT
            state = 'timeout';
          }

          try {
            sessionStorage.setItem(SESSION_GPS_STATE_KEY, state);
          } catch (e) {}

          resolve({ state, coords: null, reprompted: true });
        },
        {
          timeout: 8000,
          maximumAge: 1000 * 60 * 30, // 30 mins
          enableHighAccuracy: false
        }
      );
    });
  }

  /**
   * Get current location (from storage or initiate resolution)
   */
  async function initLocation() {
    const sess = getGpsSession();
    if (sess.state === 'granted' && sess.coords) {
      // If we have coords but no human-readable address cached yet, resolve it in the background
      const currentAddr = sessionStorage.getItem(SESSION_ADDRESS_KEY) || localStorage.getItem(STORAGE_ADDRESS_KEY);
      if (!currentAddr) {
        reverseGeocodeGoogle(sess.coords).then((formatted) => {
          if (formatted) saveUserAddress(formatted);
        }).catch(() => {});
      }
    }

    const cached = getStoredLocation();
    if (cached) {
      notifyListeners(cached);
      // If session doesn't have coords yet and user hasn't denied, check geolocation in background
      if (sess.state !== 'denied' && (!sess.coords || sess.state === 'unknown')) {
        requestUserLocationOnce(false).catch(() => {});
      }
      return cached;
    }
    // Only resolve if session hasn't explicitly denied
    if (sess.state === 'denied') {
      return saveLocation(FALLBACK_LOCATION);
    }
    const res = await requestUserLocationOnce(false);
    if (res.state === 'granted' && res.coords) {
      return getStoredLocation() || FALLBACK_LOCATION;
    }
    return saveLocation(FALLBACK_LOCATION);
  }

  function onLocationChange(callback) {
    if (typeof callback === 'function') {
      listeners.push(callback);
      const current = getStoredLocation() || FALLBACK_LOCATION;
      callback(current);
    }
  }

  window.KrishiLocation = {
    getLocation: () => getStoredLocation() || FALLBACK_LOCATION,
    getGpsSession,
    getUserAddress,
    saveUserAddress,
    resolveHumanReadableAddress: reverseGeocodeGoogle,
    requestUserLocationOnce,
    resetSessionState,
    initLocation,
    refreshLocation: () => requestUserLocationOnce(true),
    onLocationChange
  };

  // Auto-init if DOM is loaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => initLocation());
  } else {
    initLocation();
  }
})(window);
