/**
 * ============================================================
 * Krishi Mitra — templates/menu-detail.js
 * Multi-Option Menu & Expanding Detail Window Templates.
 * Mounts inside #voice-interactive-canvas when triggered.
 * Fully synchronized with Gemini Live voice intents.
 * ============================================================
 */
(function (window) {
  'use strict';

  let currentMenuData = null;
  let currentDetailData = null;
  let activeView = null; // 'menu' | 'detail' | 'idle'
  let visitedOptionIds = new Set();

  function escapeHtml(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  const CROP_EMOJI_DICT = {
    'paddy': '🌾', 'rice': '🌾', 'धान': '🌾', 'चावल': '🌾',
    'wheat': '🌾', 'गेहूं': '🌾',
    'gram': '🧆', 'chana': '🧆', 'चना': '🧆', 'chickpea': '🧆', 'bengal gram': '🧆',
    'tomato': '🍅', 'टमाटर': '🍅',
    'potato': '🥔', 'आलू': '🥔',
    'onion': '🧅', 'प्याज़': '🧅', 'प्याज': '🧅',
    'eggplant': '🍆', 'brinjal': '🍆', 'बैंगन': '🍆', 'baingan': '🍆',
    'maize': '🌽', 'corn': '🌽', 'मक्का': '🌽',
    'soybean': '🌱', 'सोयाबीन': '🌱',
    'mustard': '🌼', 'sarson': '🌼', 'सरसों': '🌼', 'rai': '🌼',
    'cotton': '☁️', 'कपास': '☁️',
    'garlic': '🧄', 'लहसुन': '🧄',
    'chili': '🌶️', 'chilli': '🌶️', 'mirch': '🌶️', 'मिर्च': '🌶️',
    'ginger': '🫚', 'adrak': '🫚', 'अदरक': '🫚',
    'turmeric': '🫚', 'haldi': '🫚', 'हल्दी': '🫚',
    'mango': '🥭', 'आम': '🥭',
    'banana': '🍌', 'केला': '🍌',
    'apple': '🍎', 'सेब': '🍎',
    'orange': '🍊', 'संतरा': '🍊',
    'lemon': '🍋', 'नींबू': '🍋',
    'pea': '🫛', 'matar': '🫛', 'मटर': '🫛',
    'groundnut': '🥜', 'peanut': '🥜', 'मूंगफली': '🥜',
    'sunflower': '🌻', 'सूरजमुखी': '🌻',
    'patson': '🌿', 'mesta': '🌿', 'jute': '🌿', 'ambady': '🌿', 'पटसन': '🌿',
    'teora': '🌿', 'lak': '🌿', 'तिवड़ा': '🌿',
    'coriander': '🌿', 'धनिया': '🌿',
    'methi': '🌿', 'मेथी': '🌿'
  };

  const KNOWN_MATERIAL_SYMBOLS = new Set([
    'restaurant_menu', 'grain', 'grass', 'spa', 'eco', 'local_florist',
    'agriculture', 'inventory_2', 'payments', 'store', 'schedule', 'call',
    'map', 'trending_up', 'analytics', 'directions', 'navigation', 'info',
    'shield', 'verified', 'speed', 'distance', 'explore', 'local_shipping',
    'support_agent', 'help', 'search', 'tune', 'filter_alt', 'category',
    'bar_chart', 'pin_drop', 'place', 'location_on', 'phone', 'receipt_long'
  ]);

  function getCropEmoji(commodity = '') {
    if (!commodity) return '🌾';
    const c = String(commodity).toLowerCase();
    for (const [key, emoji] of Object.entries(CROP_EMOJI_DICT)) {
      if (c.includes(key)) return emoji;
    }
    return '🌾';
  }

  function getOptionIcon(iconName, defaultEmoji = '📌') {
    if (!iconName) return defaultEmoji;
    const str = String(iconName).trim();
    if (!str) return defaultEmoji;

    // 1. If it's already an emoji (or contains emojis)
    if (/\p{Extended_Pictographic}/u.test(str)) {
      return str;
    }

    const lower = str.toLowerCase();

    // 2. Action / Navigation Keywords
    if (lower.includes('map') || lower.includes('nav') || lower.includes('route') || lower.includes('दिशा')) return '🗺️';
    if (lower.includes('phone') || lower.includes('contact') || lower.includes('call') || lower.includes('संपर्क')) return '📞';
    if (lower.includes('trend') || lower.includes('rate') || lower.includes('price') || lower.includes('chart') || lower.includes('भाव')) return '📊';
    if (lower.includes('truck') || lower.includes('transport') || lower.includes('वाहन')) return '🚚';
    if (lower.includes('camera') || lower.includes('photo') || lower.includes('तस्वीर')) return '📷';
    if (lower.includes('buyer') || lower.includes('खरीदार')) return '🤝';

    // 3. Agricultural Commodity Matching (e.g. "eggplant", "mustard", "bengal gram")
    for (const [cropKey, emoji] of Object.entries(CROP_EMOJI_DICT)) {
      if (lower.includes(cropKey)) {
        return emoji;
      }
    }

    // 4. Known Material Symbols or standard identifier words
    if (KNOWN_MATERIAL_SYMBOLS.has(lower) || /^[a-z0-9_]+$/i.test(lower)) {
      return `<span class="material-symbols-outlined">${escapeHtml(lower)}</span>`;
    }

    return defaultEmoji;
  }

  function normalizeOptionItem(opt, idx) {
    if (!opt) {
      return { id: `opt_${idx}`, rawId: `opt_${idx}`, label: `Option ${idx + 1}`, icon: '📌', desc: '' };
    }

    if (typeof opt === 'string') {
      const cleanLabel = opt.trim();
      const cleanId = cleanLabel.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || `opt_${idx}`;
      return {
        id: cleanId,
        rawId: cleanLabel,
        label: cleanLabel,
        icon: getOptionIcon(cleanLabel, '🌾'),
        desc: ''
      };
    }

    if (typeof opt === 'object') {
      const rawLabel = String(opt.label || opt.name || opt.commodity || opt.title || opt.id || `Option ${idx + 1}`).trim();
      const rawId = String(opt.id || opt.commodity || opt.name || rawLabel).trim();
      const cleanId = rawId.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || `opt_${idx}`;
      const icon = opt.icon ? getOptionIcon(opt.icon, getOptionIcon(rawLabel, '📌')) : getOptionIcon(rawLabel, '📌');
      const desc = opt.desc || opt.subtitle || (rawId === 'map' ? 'Driving distance & navigation' : rawId === 'contact' ? 'Phone, address & office hours' : rawId === 'trends' ? 'Latest rate range & trend' : '');

      return {
        id: cleanId,
        rawId: rawId,
        label: rawLabel,
        icon: icon,
        desc: desc
      };
    }

    return {
      id: `opt_${idx}`,
      rawId: `opt_${idx}`,
      label: `Option ${idx + 1}`,
      icon: '📌',
      desc: ''
    };
  }

  let googleMapsLoadedPromise = null;

  function ensureGoogleMapsSDK() {
    if (window.google && window.google.maps && window.google.maps.Map) {
      return Promise.resolve(window.google.maps);
    }
    if (googleMapsLoadedPromise) {
      return googleMapsLoadedPromise;
    }

    googleMapsLoadedPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector('script[src*="maps.googleapis.com/maps/api/js"]');
      if (existing) {
        if (window.google && window.google.maps) {
          return resolve(window.google.maps);
        }
        existing.addEventListener('load', () => resolve(window.google.maps));
        existing.addEventListener('error', (e) => reject(new Error('Google Maps script tag failed')));
        return;
      }

      const apiKey = (window.GOOGLE_MAPS_CONFIG && window.GOOGLE_MAPS_CONFIG.apiKey) || '';

      const script = document.createElement('script');
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=geometry,places`;
      script.async = true;
      script.defer = true;

      script.onload = () => {
        if (window.google && window.google.maps) {
          resolve(window.google.maps);
        } else {
          reject(new Error('Google Maps loaded but window.google.maps is undefined'));
        }
      };

      script.onerror = (err) => {
        console.warn('[Krishi Maps] Google Maps SDK network load failed:', err);
        reject(err);
      };

      document.head.appendChild(script);
    });

    return googleMapsLoadedPromise;
  }

  // ============================================================
  // TEMPLATE 1: MULTI-OPTION MENU
  // ============================================================

  /**
   * Render Multi-Option Menu into container with 8-Item Pagination support.
   */
  function renderOptionsMenu(container, data) {
    try {
      if (!container || !data) return;
      if (data.reset || data.reset_visited || (data.market && currentMenuData?.market && data.market !== currentMenuData.market)) {
        visitedOptionIds.clear();
      }

      const rawList = (Array.isArray(data.allOptions) && data.allOptions.length > 0)
        ? data.allOptions
        : (Array.isArray(data.options) && data.options.length > 0)
          ? data.options
          : (Array.isArray(data.commodities) && data.commodities.length > 0)
            ? data.commodities
            : (Array.isArray(data.items) && data.items.length > 0)
              ? data.items
              : [
                  { id: 'map', label: 'Map & Navigation', icon: 'map', desc: 'Driving distance & navigation' },
                  { id: 'contact', label: 'Contact Info', icon: 'phone', desc: 'Phone, address & office hours' },
                  { id: 'trends', label: 'Rates & Trends', icon: 'trends', desc: 'Latest rate range & trend' }
                ];

      let allOptions = rawList.map((item, idx) => normalizeOptionItem(item, idx));

      const pageSize = 6;
      let page = typeof data.page === 'number' ? data.page : 0;
      if (page === 1 && allOptions.length <= pageSize) {
        page = 0;
      } else if (page > 0 && page * pageSize >= allOptions.length) {
        page = 0;
      }
      const totalPages = Math.max(1, Math.ceil(allOptions.length / pageSize));
      const startIndex = page * pageSize;
      const visibleOptions = allOptions.slice(startIndex, startIndex + pageSize);

      data.allOptions = allOptions;
      data.page = page;
      currentMenuData = data;
      if (window.KrishiGenerativeRenderer && typeof window.KrishiGenerativeRenderer.cancelCloseTimer === 'function') {
        window.KrishiGenerativeRenderer.cancelCloseTimer();
      }
      if (window._krishiCloseAllTimer) {
        clearTimeout(window._krishiCloseAllTimer);
        window._krishiCloseAllTimer = null;
      }
      container.querySelectorAll('.voice-idle-prompt').forEach(p => p.remove());

      container.innerHTML = '';
      container.classList.add('tpl-active');

      const root = document.createElement('div');
      root.className = 'tpl-menu-container';

      // 1. Header with Title, Subtitle, and Top-Right "✕" Close Button
      const header = document.createElement('div');
      header.className = 'tpl-menu-header animate__animated animate__fadeInDown';
      header.style.setProperty('--animate-duration', '0.35s');

      const subtitleText = data.subtitle || (allOptions.length > pageSize
        ? `Showing ${startIndex + 1}–${Math.min(startIndex + pageSize, allOptions.length)} of ${allOptions.length}`
        : (data.market ? `📍 ${data.market}` : 'Select an option'));

      header.innerHTML = `
        <div class="tpl-menu-header-left">
          <div class="tpl-menu-title">${escapeHtml(data.title || 'Choose an Option')}</div>
          <div class="tpl-menu-subtitle">${escapeHtml(subtitleText)}</div>
        </div>
        <button class="tpl-menu-close-btn" type="button" aria-label="Close menu" title="Close">✕</button>
      `;

      header.querySelector('.tpl-menu-close-btn').addEventListener('click', (e) => {
        e.preventDefault();
        closeAllUI(false);
      });

      root.appendChild(header);

      // 2. Options List Container (up to 8 items)
      const list = document.createElement('div');
      list.className = 'tpl-menu-list';
      const isCompact = visibleOptions.length > 4;

      let isSelected = false;

      visibleOptions.forEach((opt, idx) => {
        const btn = document.createElement('button');
        btn.className = `tpl-menu-btn animate__animated animate__zoomIn ${isCompact ? 'compact' : ''}`;
        btn.style.setProperty('--animate-duration', '0.32s');
        btn.style.animationDelay = `${idx * 30}ms`;
        btn.dataset.id = opt.id;
        btn.type = 'button';
        btn.setAttribute('role', 'option');
        btn.setAttribute('aria-label', opt.label);

        const iconHtml = opt.icon || getOptionIcon(opt.label || opt.id);
        const descText = opt.desc || '';

        btn.innerHTML = `
          <div class="tpl-menu-btn-icon-wrap">${iconHtml}</div>
          <div class="tpl-menu-btn-content">
            <div class="tpl-menu-btn-label">${escapeHtml(opt.label)}</div>
            ${descText ? `<div class="tpl-menu-btn-desc">${escapeHtml(descText)}</div>` : ''}
          </div>
          <div class="tpl-menu-btn-arrow">➔</div>
        `;

        btn.addEventListener('click', (e) => {
          e.preventDefault();
          if (isSelected) return;
          selectMenuOption(opt.id, btn, false);
        });

        list.appendChild(btn);
      });

      root.appendChild(list);

      // 3. Pagination Controls (Only shown if total items > 8)
      if (allOptions.length > pageSize) {
        const pagination = document.createElement('div');
        pagination.className = 'tpl-menu-pagination animate__animated animate__fadeIn';
        pagination.style.setProperty('--animate-duration', '0.35s');

        pagination.innerHTML = `
          <button class="tpl-pagination-btn" type="button" id="btn-menu-prev" ${page === 0 ? 'disabled' : ''}>
            <span>⬅</span>
            <span>Previous</span>
          </button>
          <span class="tpl-pagination-chip">Page ${page + 1} of ${totalPages}</span>
          <button class="tpl-pagination-btn" type="button" id="btn-menu-next" ${page >= totalPages - 1 ? 'disabled' : ''}>
            <span>Next</span>
            <span>➡</span>
          </button>
        `;

        pagination.querySelector('#btn-menu-prev').addEventListener('click', (e) => {
          e.preventDefault();
          paginateMenu('PREV', false);
        });

        pagination.querySelector('#btn-menu-next').addEventListener('click', (e) => {
          e.preventDefault();
          paginateMenu('NEXT', false);
        });

        root.appendChild(pagination);
      }

      container.appendChild(root);

      // Inform server about current screen state
      if (window.KrishiVoice && typeof window.KrishiVoice.sendScreenStateUpdate === 'function') {
        window.KrishiVoice.sendScreenStateUpdate('OPTIONS_MENU', data.market || 'Commodities', {
          page: page + 1,
          total_pages: totalPages,
          visible_options: visibleOptions.map(o => o.label || o.id)
        });
      }

      // Agentic UI Verification Handshake: Confirmed DOM successfully mounted
      if (window.KrishiVoice && typeof window.KrishiVoice.sendUIVerification === 'function') {
        window.KrishiVoice.sendUIVerification({
          status: 'success',
          view: 'OPTIONS_MENU',
          rendered_items: visibleOptions.length,
          title: data.title || 'Choose an Option',
          market: data.market || '',
          page: page + 1,
          total_pages: totalPages
        });
      }
    } catch (err) {
      console.error('[Krishi UI Error Boundary] Failed to render options menu:', err);
      try {
        container.innerHTML = '';
        container.classList.remove('tpl-active');
        activeView = 'idle';
        currentMenuData = null;
        if (window.KrishiTemplates && typeof window.KrishiTemplates.restoreIdlePrompt === 'function') {
          window.KrishiTemplates.restoreIdlePrompt(container);
        } else {
          const prompt = document.getElementById('idle-voice-prompt');
          if (prompt) prompt.style.display = 'flex';
        }
      } catch (cleanErr) {
        console.error('[Krishi UI Error Boundary] Cleanup error:', cleanErr);
      }
      if (window.KrishiVoice && typeof window.KrishiVoice.sendScreenStateUpdate === 'function') {
        window.KrishiVoice.sendScreenStateUpdate('IDLE', null, { error: err.message, failed_template: 'multi_option_menu' });
      }
      // Agentic UI Verification Handshake: Report failure to server
      if (window.KrishiVoice && typeof window.KrishiVoice.sendUIVerification === 'function') {
        window.KrishiVoice.sendUIVerification({
          status: 'failed',
          view: 'OPTIONS_MENU',
          error: err.message || 'Render exception',
          failed_template: 'multi_option_menu'
        });
      }
    }
  }

  /**
   * Paginate Multi-Option Menu (Next / Previous page)
   */
  function paginateMenu(direction = 'NEXT', isVoice = false) {
    if (!currentMenuData || !currentMenuData.allOptions) return false;
    const allOptions = currentMenuData.allOptions;
    const pageSize = 6;
    const totalPages = Math.ceil(allOptions.length / pageSize);
    let page = typeof currentMenuData.page === 'number' ? currentMenuData.page : 0;

    const dir = String(direction).toUpperCase();
    if (dir === 'NEXT') {
      if (page >= totalPages - 1) {
        if (typeof window.showToast === 'function') window.showToast('You are on the last page.');
        return false;
      }
      page++;
    } else if (dir === 'PREV') {
      if (page <= 0) {
        if (typeof window.showToast === 'function') window.showToast('You are on the first page.');
        return false;
      }
      page--;
    } else {
      return false;
    }

    currentMenuData.page = page;
    const canvas = document.getElementById('voice-interactive-canvas');
    if (!canvas) return false;

    // Zoom out current list
    const list = canvas.querySelector('.tpl-menu-list');
    if (list) {
      list.classList.remove('animate__zoomIn');
      list.classList.add('animate__animated', 'animate__zoomOut');
      list.style.setProperty('--animate-duration', '0.22s');
    }

    setTimeout(() => {
      renderOptionsMenu(canvas, currentMenuData);

      const startIndex = page * pageSize;
      const visible = allOptions.slice(startIndex, startIndex + pageSize);

      // Notify server of new visible options on screen
      if (window.KrishiVoice && typeof window.KrishiVoice.sendScreenStateUpdate === 'function') {
        window.KrishiVoice.sendScreenStateUpdate('OPTIONS_MENU', currentMenuData.market || 'Commodities', {
          page: page + 1,
          total_pages: totalPages,
          visible_options: visible.map(o => o.label || o.id)
        });
      }

      document.dispatchEvent(new CustomEvent('krishi:menu-paginated', {
        detail: { page: page + 1, totalPages, direction: dir, isVoice },
        bubbles: true
      }));
    }, 220);

    return true;
  }

  /**
   * Programmatic / Touch Selection for Menu Options
   */
  function selectMenuOption(optionId, originBtn = null, isVoice = false) {
    const root = document.querySelector('.tpl-menu-container');
    if (!root) return false;

    const buttons = root.querySelectorAll('.tpl-menu-btn');
    if (!buttons || buttons.length === 0) return false;

    let targetBtn = originBtn;
    if (!targetBtn) {
      const query = String(optionId || '').trim().toLowerCase();
      buttons.forEach(btn => {
        const id = (btn.dataset.id || '').toLowerCase();
        const text = (btn.textContent || '').toLowerCase();
        if (id === query || query.includes(id) || id.includes(query) || text.includes(query)) {
          targetBtn = btn;
        }
      });
      if (!targetBtn) targetBtn = buttons[0];
    }

    // 1. Visual selection feedback
    buttons.forEach(btn => {
      if (btn === targetBtn) {
        btn.classList.add('selected');
        btn.classList.remove('dimmed');
      } else {
        btn.classList.add('dimmed', 'animate__animated', 'animate__zoomOut');
        btn.style.setProperty('--animate-duration', '0.35s');
      }
    });

    const chosenId = targetBtn.dataset.id;
    if (chosenId) visitedOptionIds.add(chosenId.toLowerCase());
    const market = currentMenuData?.market || 'Raipur APMC';
    const commodity = currentMenuData?.commodity || 'Paddy (Common)';

    // Dispatch custom event
    document.dispatchEvent(new CustomEvent('krishi:template-action', {
      detail: { action: 'menu_select', optionId: chosenId, isVoice, market, commodity },
      bubbles: true
    }));

    const isVoiceRunning = window.KrishiVoice && typeof window.KrishiVoice.isRunning === 'function' && window.KrishiVoice.isRunning();

    if (isVoice || !isVoiceRunning) {
      // Triggered by Gemini Live voice tool OR running in offline/dev mode without active voice:
      // Render detail window after smooth 280ms zoomOut transition
      setTimeout(() => {
        const canvas = document.getElementById('voice-interactive-canvas');
        if (!canvas) return;
        const detailData = buildDefaultDetailData(chosenId, currentMenuData);
        renderDetailWindow(canvas, detailData);
      }, 280);
    } else {
      // Triggered by farmer's touch tap during active live voice session:
      // Send synthetic user turn to Gemini Live WebSocket:
      // e.g. "Show me rates and trends for Raipur APMC"
      if (window.KrishiVoice && typeof window.KrishiVoice.sendMenuSelection === 'function') {
        window.KrishiVoice.sendMenuSelection(chosenId, market, commodity);
      }

      // Safety Fallback Watchdog: If Gemini Live doesn't invoke show_detail_window within 2000ms,
      // expand into the detail window locally so the farmer is NEVER left waiting.
      const fallbackTimer = setTimeout(() => {
        const canvas = document.getElementById('voice-interactive-canvas');
        if (!canvas) return;
        if (!canvas.querySelector('.tpl-detail-window')) {
          console.log('[menu-detail] Safety watchdog fallback: mounting detail window locally');
          const detailData = buildDefaultDetailData(chosenId, currentMenuData);
          renderDetailWindow(canvas, detailData);
        }
      }, 2000);

      window._krishiMenuFallbackTimer = fallbackTimer;
    }

    return true;
  }

  /**
   * Build default detail data for an option using current menu context
   */
  function buildDefaultDetailData(optionId, menuContext = {}) {
    const market = menuContext?.market || 'Raipur APMC';
    const commodity = menuContext?.commodity || 'Paddy (Common)';
    const district = 'Raipur';
    const state = 'Chhattisgarh';

    const optId = String(optionId || 'map').toLowerCase();
    const isStandardOption = ['map', 'contact', 'trends', 'saved_crop', 'single_rate', 'location'].includes(optId);

    const matchingOpt = (menuContext?.allOptions || menuContext?.options || []).find(o => (o.id === optionId || o.rawId === optionId));
    const displayLabel = matchingOpt?.label || optionId.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

    if (!isStandardOption && (menuContext?.title?.toLowerCase().includes('commodit') || menuContext?.title?.toLowerCase().includes('crop') || menuContext?.commodity || matchingOpt)) {
      return {
        template: 'detail_window',
        type: 'SINGLE_RATE',
        view: 'single_rate',
        title: `${displayLabel} Rate`,
        subtitle: `📍 ${market}`,
        market,
        commodity: displayLabel,
        data: {
          'Modal Price': '₹3,000 / qtl',
          'Price Range': '₹2,800 — ₹3,150',
          'Market': market,
          'Arrival Date': 'Today',
          'Status': 'Active Trading'
        }
      };
    }

    return {
      template: 'detail_window',
      view: optionId || 'map',
      market,
      commodity,
      district,
      state,
      driving_mode: {
        distance_km: 2.5,
        duration_mins: 6,
        user_coords: { lat: 21.2514, lng: 81.6296 },
        mandi_coords: { lat: 21.2612, lng: 81.6508 },
        coords: { lat: 21.2612, lng: 81.6508 },
        nav_url: `https://www.google.com/maps/dir/?api=1&origin=21.2514,81.6296&destination=21.2612,81.6508&travelmode=driving`
      },
      contact: {
        phone: '0771-2582845',
        hours: 'Mon - Sat: 8:00 AM - 6:00 PM (Sunday Closed)',
        address: `${market}, Mandi Parisar, Pandri, ${district}, ${state} 492004`,
        kisan_helpline: '1800-180-1551'
      },
      trends: {
        modal_price: 3000,
        min_price: 2800,
        max_price: 3150,
        arrival_date: new Date().toISOString().slice(0, 10),
        arrival_volume: '450 Quintals',
        trend_status: 'High Demand • Rates up ₹120 this week',
        insight: 'Current demand is higher than average due to strong mill buying in Raipur district. Excellent window to sell.'
      }
    };
  }

  // ============================================================
  // TEMPLATE 2: ENLARGED DETAIL WINDOW
  // ============================================================

  function handleDetailWindowError(container, err) {
    console.error('[Krishi UI Error Boundary] Failed to render detail window:', err);
    try {
      container.innerHTML = '';
      container.classList.remove('tpl-active');
      activeView = 'idle';
      currentDetailData = null;
      if (window.KrishiTemplates && typeof window.KrishiTemplates.restoreIdlePrompt === 'function') {
        window.KrishiTemplates.restoreIdlePrompt(container);
      } else {
        const prompt = document.getElementById('idle-voice-prompt');
        if (prompt) prompt.style.display = 'flex';
      }
    } catch (cleanErr) {
      console.error('[Krishi UI Error Boundary] Cleanup error:', cleanErr);
    }
    if (window.KrishiVoice && typeof window.KrishiVoice.sendScreenStateUpdate === 'function') {
      window.KrishiVoice.sendScreenStateUpdate('IDLE', null, { error: err.message, failed_template: 'detail_window' });
    }
    // Agentic UI Verification Handshake: Report failure to server
    if (window.KrishiVoice && typeof window.KrishiVoice.sendUIVerification === 'function') {
      window.KrishiVoice.sendUIVerification({
        status: 'failed',
        view: 'DETAIL_WINDOW',
        error: err.message || 'Render exception',
        failed_template: 'detail_window'
      });
    }
  }

  /**
   * Render Enlarged Detail Window into container with Error Boundary.
   */
  function renderDetailWindow(container, data) {
    try {
      if (!container || !data) return;
      if (window._krishiMenuFallbackTimer) {
        clearTimeout(window._krishiMenuFallbackTimer);
        window._krishiMenuFallbackTimer = null;
      }
      if (window.KrishiGenerativeRenderer && typeof window.KrishiGenerativeRenderer.cancelCloseTimer === 'function') {
        window.KrishiGenerativeRenderer.cancelCloseTimer();
      }
      if (window._krishiCloseAllTimer) {
        clearTimeout(window._krishiCloseAllTimer);
        window._krishiCloseAllTimer = null;
      }
      container.querySelectorAll('.voice-idle-prompt').forEach(p => p.remove());

      currentDetailData = data;
      const viewType = (data.view || 'map').toLowerCase();
      visitedOptionIds.add(viewType);
      activeView = 'detail';

      const existingWindow = container.querySelector('.tpl-detail-window');

      // Direct Switching: If a detail window is already open, animate out existing and animate in new
      if (existingWindow) {
        existingWindow.classList.remove('animate__zoomIn');
        existingWindow.classList.add('animate__animated', 'animate__zoomOut');
        existingWindow.style.setProperty('--animate-duration', '0.3s');

        setTimeout(() => {
          try {
            existingWindow.remove();
            mountDetailWindow(container, data, viewType);
          } catch (innerErr) {
            handleDetailWindowError(container, innerErr);
          }
        }, 280);
        return;
      }

      container.innerHTML = '';
      container.classList.add('tpl-active');
      mountDetailWindow(container, data, viewType);
    } catch (err) {
      handleDetailWindowError(container, err);
    }
  }

  function mountDetailWindow(container, data, viewType) {
    try {
      const win = document.createElement('div');
      win.className = 'tpl-detail-window animate__animated animate__zoomIn';
      win.style.setProperty('--animate-duration', '0.45s');
      win.dataset.view = viewType;

      const isSavedCrop = (data.type === 'SAVED_CROP' || viewType === 'saved_crop' || (data.data && data.title && data.title.toLowerCase().includes('crop')));
      const isSingleRate = (data.type === 'SINGLE_RATE' || viewType === 'single_rate');
      const isLocation = (data.type === 'LOCATION' || viewType === 'location');

      let displayTitle = data.title || data.commodity || 'Details';
      let displaySubtitle = data.subtitle || (data.market ? `📍 ${data.market}` : 'Information');
      let cropEmoji = getCropEmoji(displayTitle);

      if (isSavedCrop) {
        displayTitle = data.title || data.commodity || 'Saved Crop Details';
        displaySubtitle = data.subtitle || 'Ready for Sale • Saved in session';
        cropEmoji = getCropEmoji(displayTitle);
      } else if (isSingleRate) {
        displayTitle = data.title || `${data.commodity || 'Crop'} Rate`;
        displaySubtitle = data.subtitle || `📍 ${data.market || 'Raipur APMC'}`;
        cropEmoji = getCropEmoji(data.commodity || displayTitle);
      } else if (isLocation) {
        displayTitle = data.title || 'Your Current Location';
        displaySubtitle = data.subtitle || 'GPS Verified Coordinates';
        cropEmoji = '📍';
      }

      // 1. Header (Info + Close Button)
      const header = document.createElement('div');
      header.className = 'tpl-detail-header';
      header.innerHTML = `
        <div class="tpl-detail-header-info">
          <div class="tpl-detail-crop-emoji">${cropEmoji}</div>
          <div class="tpl-detail-title-wrap">
            <div class="tpl-detail-title">${escapeHtml(displayTitle)}</div>
            <div class="tpl-detail-subtitle">
              <span class="tpl-detail-mandi-tag">${escapeHtml(displaySubtitle)}</span>
            </div>
          </div>
        </div>
        <button class="tpl-detail-close-btn" type="button" aria-label="Close detail window" title="Close">✕</button>
      `;

      const closeBtn = header.querySelector('.tpl-detail-close-btn');
      closeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        closeAllUI(false);
      });

      win.appendChild(header);

      // 2. Body (Render universal data views)
      const body = document.createElement('div');
      body.className = 'tpl-detail-body';
      win.appendChild(body);
      container.appendChild(win);

      if (isSavedCrop) {
        renderSavedCropView(body, data);
      } else if (isSingleRate) {
        renderSingleRateView(body, data);
      } else if (isLocation) {
        renderLocationView(body, data);
      } else if (data.data && typeof data.data === 'object' && Object.keys(data.data).length > 0) {
        renderGenericDataView(body, data);
      } else if (viewType === 'map') {
        renderMapView(body, data);
      } else if (viewType === 'contact') {
        renderContactView(body, data);
      } else if (viewType === 'trends') {
        renderTrendsView(body, data);
      } else {
        renderMapView(body, data);
      }

      // Agentic UI Verification Handshake: Confirmed Detail Window successfully mounted
      if (window.KrishiVoice && typeof window.KrishiVoice.sendUIVerification === 'function') {
        window.KrishiVoice.sendUIVerification({
          status: 'success',
          view: 'DETAIL_WINDOW',
          type: data.type || viewType,
          title: displayTitle,
          subtitle: displaySubtitle
        });
      }
    } catch (err) {
      handleDetailWindowError(container, err);
    }
  }

  /**
   * VIEW: Saved Crop Details
   */
  function renderSavedCropView(container, data) {
    const specs = data.data || {
      'Quantity': '6 Quintals',
      'Harvested': '3 days ago',
      'Status': 'Ready for Sale'
    };

    const wrap = document.createElement('div');
    wrap.className = 'tpl-saved-crop-body';

    let gridHtml = '';
    const iconMap = {
      'quantity': '⚖️',
      'harvested': '📅',
      'status': '🏷️',
      'commodity': '🌾',
      'variety': '🏷️',
      'age': '📅',
      'price': '💰',
      'location': '📍',
      'market': '🏢'
    };

    for (const [key, val] of Object.entries(specs)) {
      const lowerKey = key.toLowerCase();
      let icon = '📌';
      for (const [k, ic] of Object.entries(iconMap)) {
        if (lowerKey.includes(k)) {
          icon = ic;
          break;
        }
      }
      gridHtml += `
        <div class="tpl-spec-item">
          <div class="tpl-spec-label">${icon} ${escapeHtml(key)}</div>
          <div class="tpl-spec-val">${escapeHtml(String(val))}</div>
        </div>
      `;
    }

    wrap.innerHTML = `
      <div class="tpl-spec-grid">
        ${gridHtml}
      </div>

      <div class="tpl-crop-action-row">
        <button class="tpl-btn-edit-crop" type="button" id="btn-edit-saved-crop">
          <span>✏️</span>
          <span>Edit Details</span>
        </button>
        <button class="tpl-btn-find-buyers" type="button" id="btn-find-crop-buyers">
          <span>🔍</span>
          <span>Find Buyers</span>
        </button>
      </div>
    `;

    // Wire Edit Button -> Opens SellCropForm pre-filled
    wrap.querySelector('#btn-edit-saved-crop').addEventListener('click', (e) => {
      e.preventDefault();
      const canvas = document.getElementById('voice-interactive-canvas');
      if (canvas && window.KrishiTemplates && typeof window.KrishiTemplates.renderSellCropForm === 'function') {
        const cropTitle = data.title || data.commodity || '';
        const qtyVal = specs['Quantity'] || specs['quantity'] || '';
        const ageVal = specs['Harvested'] || specs['age'] || '';
        window.KrishiTemplates.renderSellCropForm(canvas, {
          commodity: cropTitle,
          quantity: qtyVal,
          age: ageVal
        });
      }
    });

    // Wire Find Buyers Button -> Dispatches voice command
    wrap.querySelector('#btn-find-crop-buyers').addEventListener('click', (e) => {
      e.preventDefault();
      if (window.KrishiVoice && typeof window.KrishiVoice.sendVoiceCommand === 'function') {
        const cropName = data.title || data.commodity || 'crop';
        window.KrishiVoice.sendVoiceCommand(`Find nearby buyers for ${cropName}`);
      }
      if (typeof window.showToast === 'function') {
        window.showToast('Searching for verified local buyers...');
      }
    });

    container.appendChild(wrap);
  }

  /**
   * VIEW: Single Commodity Rate Focused Modal
   */
  function renderSingleRateView(container, data) {
    const rawRate = data.data || {};
    const modalPrice = rawRate['Modal Price'] || rawRate.modal_price || '₹3,000 / qtl';
    const priceRange = rawRate['Price Range'] || rawRate.price_range || '₹2,800 — ₹3,150';
    const market = rawRate['Market'] || data.market || 'Raipur APMC';
    const arrivalDate = rawRate['Arrival Date'] || rawRate.arrival_date || 'Today';

    const wrap = document.createElement('div');
    wrap.className = 'tpl-single-rate-body';

    wrap.innerHTML = `
      <div class="tpl-trends-hero">
        <div class="tpl-trends-label">Today's Modal Rate</div>
        <div class="tpl-trends-price">${escapeHtml(String(modalPrice))}</div>
        <div class="tpl-trends-range">Price Range: ${escapeHtml(String(priceRange))}</div>
      </div>

      <div class="tpl-trends-stats-grid">
        <div class="tpl-trends-stat-box">
          <div class="tpl-trends-stat-title">Mandi / Market</div>
          <div class="tpl-trends-stat-val">📍 ${escapeHtml(market)}</div>
        </div>
        <div class="tpl-trends-stat-box">
          <div class="tpl-trends-stat-title">Reporting Date</div>
          <div class="tpl-trends-stat-val">📅 ${escapeHtml(arrivalDate)}</div>
        </div>
      </div>

      <div class="tpl-crop-action-row">
        <button class="tpl-btn-edit-crop" type="button" id="btn-rate-directions">
          <span>🚗</span>
          <span>View Route</span>
        </button>
        <button class="tpl-btn-find-buyers" type="button" id="btn-rate-contact">
          <span>📞</span>
          <span>Contact Mandi</span>
        </button>
      </div>
    `;

    wrap.querySelector('#btn-rate-directions').addEventListener('click', () => {
      const canvas = document.getElementById('voice-interactive-canvas');
      renderDetailWindow(canvas, { ...data, view: 'map', type: 'map' });
    });

    wrap.querySelector('#btn-rate-contact').addEventListener('click', () => {
      const canvas = document.getElementById('voice-interactive-canvas');
      renderDetailWindow(canvas, { ...data, view: 'contact', type: 'contact' });
    });

    container.appendChild(wrap);
  }

  /**
   * VIEW: Detected Location Modal
   */
  function renderLocationView(container, data) {
    const loc = data.data || {};
    const address = loc['Address'] || loc.address || 'Raipur, Chhattisgarh';
    const coords = loc['Coordinates'] || loc.coordinates || '21.2514° N, 81.6296° E';
    const district = loc['District'] || 'Raipur';
    const state = loc['State'] || 'Chhattisgarh';

    const wrap = document.createElement('div');
    wrap.className = 'tpl-location-body';

    wrap.innerHTML = `
      <div class="tpl-contact-card">
        <div class="tpl-contact-row">
          <div class="tpl-contact-icon">📍</div>
          <div class="tpl-contact-info">
            <div class="tpl-contact-label">Verified Location</div>
            <div class="tpl-contact-val">${escapeHtml(address)}</div>
          </div>
        </div>

        <div class="tpl-contact-row">
          <div class="tpl-contact-icon">🌐</div>
          <div class="tpl-contact-info">
            <div class="tpl-contact-label">GPS Coordinates</div>
            <div class="tpl-contact-val">${escapeHtml(coords)}</div>
          </div>
        </div>

        <div class="tpl-contact-row">
          <div class="tpl-contact-icon">🏛️</div>
          <div class="tpl-contact-info">
            <div class="tpl-contact-label">District & State</div>
            <div class="tpl-contact-val">${escapeHtml(district)}, ${escapeHtml(state)}</div>
          </div>
        </div>
      </div>

      <a class="tpl-btn-call" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}" target="_blank" rel="noopener noreferrer">
        <span>🗺️</span>
        <span>Open in Google Maps</span>
      </a>
    `;

    container.appendChild(wrap);
  }

  /**
   * VIEW: Generic Key-Value Cards
   */
  function renderGenericDataView(container, data) {
    const specs = data.data || {};
    const wrap = document.createElement('div');
    wrap.className = 'tpl-saved-crop-body';

    let gridHtml = '';
    for (const [key, val] of Object.entries(specs)) {
      gridHtml += `
        <div class="tpl-spec-item">
          <div class="tpl-spec-label">📌 ${escapeHtml(key)}</div>
          <div class="tpl-spec-val">${escapeHtml(String(val))}</div>
        </div>
      `;
    }

    wrap.innerHTML = `
      <div class="tpl-spec-grid">
        ${gridHtml}
      </div>
    `;

    container.appendChild(wrap);
  }

  /**
   * VIEW: Map & Navigation with Real Google Maps SDK Integration
   */
  function renderMapView(container, data) {
    const driving = data.driving_mode || {};
    const mandiName = data.market || 'Raipur APMC';
    const distText = driving.distance_km ? `~${driving.distance_km} km` : '~2.5 km';
    const durText = driving.duration_mins ? `~${driving.duration_mins} mins` : '~6 mins';

    // User coords
    const userCoords = driving.user_coords
      || (window.KrishiUserLocation && window.KrishiUserLocation.lat ? { lat: Number(window.KrishiUserLocation.lat), lng: Number(window.KrishiUserLocation.lng) } : { lat: 21.2514, lng: 81.6296 });

    // Mandi coords
    const mandiCoords = driving.mandi_coords
      || driving.coords
      || { lat: 21.2612, lng: 81.6508 };

    const navUrl = driving.nav_url
      || `https://www.google.com/maps/dir/?api=1&origin=${userCoords.lat},${userCoords.lng}&destination=${mandiCoords.lat},${mandiCoords.lng}&travelmode=driving`;

    const wrap = document.createElement('div');
    wrap.style.display = 'flex';
    wrap.style.flexDirection = 'column';
    wrap.style.height = '100%';

    wrap.innerHTML = `
      <!-- Route / Distance summary -->
      <div class="tpl-route-summary">
        <div class="tpl-route-mode">
          <span>🚗</span>
          <span>Driving Mode</span>
        </div>
        <div class="tpl-route-metrics">
          <span id="tpl-route-dist">${escapeHtml(distText)}</span>
          <span>•</span>
          <span id="tpl-route-dur">${escapeHtml(durText)}</span>
        </div>
      </div>

      <!-- Real Google Maps Canvas -->
      <div class="tpl-map-wrapper" style="width: 100%; height: 250px; border-radius: 12px; margin-bottom: 12px; position: relative; overflow: hidden; background: #e5e7eb;">
        <div id="dynamic-map-canvas" style="width: 100%; height: 100%;"></div>
        <div id="map-loading-indicator" style="position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(243, 244, 246, 0.9); font-size: 13px; color: #4b5563; font-weight: 500; transition: opacity 0.3s ease;">
          <span style="display: inline-flex; align-items: center; gap: 8px;">
            <span>🗺️</span>
            <span>Loading driving route & map...</span>
          </span>
        </div>
      </div>

      <!-- Start Navigation Action -->
      <div class="tpl-nav-action-area">
        <a class="tpl-btn-start-nav" href="${navUrl}" target="_blank" rel="noopener noreferrer">
          <span>🚗</span>
          <span>Start Navigation</span>
        </a>
      </div>
    `;

    container.appendChild(wrap);

    const mapDiv = wrap.querySelector('#dynamic-map-canvas');
    const loadingEl = wrap.querySelector('#map-loading-indicator');
    const distEl = wrap.querySelector('#tpl-route-dist');
    const durEl = wrap.querySelector('#tpl-route-dur');

    setTimeout(() => {
      ensureGoogleMapsSDK().then((maps) => {
        if (!mapDiv) return;

        const map = new maps.Map(mapDiv, {
          center: mandiCoords,
          zoom: 13,
          mapTypeId: 'roadmap',
          disableDefaultUI: false,
          zoomControl: true,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false
        });

        // Directions Service & Renderer
        const directionsService = new maps.DirectionsService();
        const directionsRenderer = new maps.DirectionsRenderer({
          map: map,
          suppressMarkers: false,
          polylineOptions: {
            strokeColor: '#16A34A',
            strokeWeight: 5
          }
        });

        directionsService.route({
          origin: userCoords,
          destination: mandiCoords,
          travelMode: maps.TravelMode.DRIVING
        }, (result, status) => {
          if (loadingEl) {
            loadingEl.style.opacity = '0';
            setTimeout(() => loadingEl.remove(), 250);
          }

          if (status === maps.DirectionsStatus.OK && result) {
            directionsRenderer.setDirections(result);
            const leg = result.routes?.[0]?.legs?.[0];
            if (leg) {
              if (distEl && leg.distance?.text) distEl.textContent = leg.distance.text;
              if (durEl && leg.duration?.text) durEl.textContent = leg.duration.text;
            }
          } else {
            console.warn('[Krishi Maps] DirectionsService returned status:', status, 'drawing direct route fallback');
            // Draw direct polyline connecting user and mandi
            new maps.Polyline({
              path: [userCoords, mandiCoords],
              geodesic: true,
              strokeColor: '#16A34A',
              strokeOpacity: 0.9,
              strokeWeight: 5,
              map: map
            });

            new maps.Marker({
              position: userCoords,
              map: map,
              title: 'Your Location',
              icon: 'https://maps.google.com/mapfiles/ms/icons/blue-dot.png'
            });
            new maps.Marker({
              position: mandiCoords,
              map: map,
              title: mandiName,
              icon: 'https://maps.google.com/mapfiles/ms/icons/red-dot.png'
            });

            const bounds = new maps.LatLngBounds();
            bounds.extend(userCoords);
            bounds.extend(mandiCoords);
            map.fitBounds(bounds, 40);
          }
        });

        // Re-trigger layout resize after zoomIn animation completes
        const recenter = () => {
          if (window.google?.maps && map) {
            maps.event.trigger(map, 'resize');
            map.setCenter(mandiCoords);
          }
        };
        setTimeout(recenter, 300);
        setTimeout(recenter, 600);

      }).catch((err) => {
        console.warn('[Krishi Maps] Google Maps init error, displaying fallback canvas:', err);
        if (loadingEl) {
          loadingEl.innerHTML = `
            <div style="text-align: center; padding: 12px;">
              <div style="font-size: 20px; margin-bottom: 4px;">🗺️</div>
              <div style="font-weight: 600; color: #1f2937;">Google Map Navigation</div>
              <div style="font-size: 11px; color: #6b7280; margin-top: 2px;">Distance: ${distText} • ${durText}</div>
            </div>
          `;
        }
      });
    }, 80);
  }

  /**
   * VIEW: Contact Information
   */
  function renderContactView(container, data) {
    const contact = data.contact || {
      phone: '0771-2582845',
      hours: 'Mon - Sat: 8:00 AM - 6:00 PM',
      address: `${data.market || 'Raipur APMC'}, Raipur, Chhattisgarh`,
      kisan_helpline: '1800-180-1551'
    };

    const wrap = document.createElement('div');
    wrap.className = 'tpl-contact-body';

    wrap.innerHTML = `
      <div class="tpl-contact-card">
        <div class="tpl-contact-row">
          <div class="tpl-contact-icon">📍</div>
          <div class="tpl-contact-info">
            <div class="tpl-contact-label">Address</div>
            <div class="tpl-contact-val">${escapeHtml(contact.address)}</div>
          </div>
        </div>

        <div class="tpl-contact-row">
          <div class="tpl-contact-icon">🕒</div>
          <div class="tpl-contact-info">
            <div class="tpl-contact-label">Operating Hours</div>
            <div class="tpl-contact-val">${escapeHtml(contact.hours)}</div>
          </div>
        </div>

        <div class="tpl-contact-row">
          <div class="tpl-contact-icon">📞</div>
          <div class="tpl-contact-info">
            <div class="tpl-contact-label">Mandi Office Phone</div>
            <div class="tpl-contact-val">
              <a href="tel:${escapeHtml(contact.phone)}">${escapeHtml(contact.phone)}</a>
            </div>
          </div>
        </div>
      </div>

      <div class="tpl-helpline-box">
        <span style="font-size: 20px;">🌾</span>
        <div>
          <div class="tpl-helpline-title">Kisan Call Centre (Toll-Free Helpline)</div>
          <div class="tpl-helpline-number">${escapeHtml(contact.kisan_helpline || '1800-180-1551')}</div>
        </div>
      </div>

      <a class="tpl-btn-call" href="tel:${escapeHtml(contact.phone)}">
        <span>📞</span>
        <span>Call Mandi Office</span>
      </a>
    `;

    container.appendChild(wrap);
  }

  /**
   * VIEW: Rates & Price Trends
   */
  function renderTrendsView(container, data) {
    const trends = data.trends || {
      modal_price: 3000,
      min_price: 2800,
      max_price: 3150,
      arrival_date: new Date().toISOString().slice(0, 10),
      arrival_volume: '450 Quintals',
      trend_status: 'High Demand • Steady rates',
      insight: 'Strong buyer turnout reported at mandi gates today.'
    };

    const wrap = document.createElement('div');
    wrap.className = 'tpl-trends-body';

    wrap.innerHTML = `
      <div class="tpl-trends-hero">
        <div class="tpl-trends-label">Today's Modal Price</div>
        <div class="tpl-trends-price">₹${Number(trends.modal_price).toLocaleString('en-IN')} / qtl</div>
        <div class="tpl-trends-range">Price Range: ₹${Number(trends.min_price).toLocaleString('en-IN')} — ₹${Number(trends.max_price).toLocaleString('en-IN')}</div>
      </div>

      <div class="tpl-trends-stats-grid">
        <div class="tpl-trends-stat-box">
          <div class="tpl-trends-stat-title">Arrival Volume</div>
          <div class="tpl-trends-stat-val">${escapeHtml(trends.arrival_volume)}</div>
        </div>
        <div class="tpl-trends-stat-box">
          <div class="tpl-trends-stat-title">Reporting Date</div>
          <div class="tpl-trends-stat-val">📅 ${escapeHtml(trends.arrival_date)}</div>
        </div>
      </div>

      <div class="tpl-trends-badge-box">
        <span>📈</span>
        <span>${escapeHtml(trends.trend_status)}</span>
      </div>

      <div style="font-size: 12px; color: var(--gray-600); line-height: 1.45; background: var(--gray-50); padding: 10px 12px; border-radius: var(--radius-md); border: 1px solid var(--gray-200);">
        💡 <strong>Selling Advice:</strong> ${escapeHtml(trends.insight)}
      </div>
    `;

    container.appendChild(wrap);
  }

  // ============================================================
  // NAVIGATION & BACK ANIMATION
  // ============================================================

  /**
   * Reverse animation: Detail Window zooms out, MultiOptionMenu zooms in.
   */
  /**
   * Reverse animation: Detail Window zooms out, MultiOptionMenu zooms in.
   * Dynamically filters out visited options so the menu is consumed progressively.
   * If all options are exhausted, automatically closes to idle state.
   */
  function goBackToOptionsMenu(isVoice = false, resetVisited = false) {
    const canvas = document.getElementById('voice-interactive-canvas');
    if (!canvas) return false;

    if (resetVisited) {
      visitedOptionIds.clear();
    }

    const detailWin = canvas.querySelector('.tpl-detail-window');

    // Base options (from currentMenuData or standard default 3 options)
    const baseOptions = (currentMenuData && Array.isArray(currentMenuData.options) && currentMenuData.options.length > 0)
      ? currentMenuData.options
      : [
          { id: 'map', label: 'Map & Navigation', icon: '🗺️', desc: 'Driving distance & navigation' },
          { id: 'contact', label: 'Contact Info', icon: '📞', desc: 'Phone, address & office hours' },
          { id: 'trends', label: 'Rates & Trends', icon: '📊', desc: 'Latest rate range & trend' }
        ];

    // Filter out visited options
    const remainingOptions = baseOptions.filter(opt => !visitedOptionIds.has(opt.id.toLowerCase()));

    // If all options have been visited, auto-close and restore idle state (no empty canvas!)
    if (remainingOptions.length === 0) {
      console.log('[menu-detail] All options consumed. Auto-closing to idle state.');
      closeAllUI(isVoice);
      return true;
    }

    // Zoom out Detail Window
    if (detailWin) {
      detailWin.classList.remove('animate__zoomIn');
      detailWin.classList.add('animate__animated', 'animate__zoomOut');
      detailWin.style.setProperty('--animate-duration', '0.35s');
    }

    // Dispatch event
    document.dispatchEvent(new CustomEvent('krishi:template-action', {
      detail: { action: 'go_back', isVoice, remainingOptions: remainingOptions.map(o => o.id) },
      bubbles: true
    }));

    // If user tapped physical button, inform live voice session
    if (!isVoice && window.KrishiVoice) {
      if (typeof window.KrishiVoice.sendScreenStateUpdate === 'function') {
        window.KrishiVoice.sendScreenStateUpdate('OPTIONS_MENU', currentMenuData?.market || 'Raipur APMC', {
          remaining_options: remainingOptions.map(o => o.label)
        });
      }
      if (typeof window.KrishiVoice.sendVoiceCommand === 'function') {
        window.KrishiVoice.sendVoiceCommand('go back to options');
      }
    }

    // 2. On animationend, remove detail window and re-enter MultiOptionMenu with zoomIn
    setTimeout(() => {
      if (detailWin) detailWin.remove();
      const updatedMenuData = {
        ...(currentMenuData || {}),
        template: 'multi_option_menu',
        title: 'What would you like to know next?',
        subtitle: currentMenuData?.subtitle || `📍 ${currentMenuData?.market || 'Raipur APMC'}`,
        market: currentMenuData?.market || 'Raipur APMC',
        commodity: currentMenuData?.commodity || 'Paddy (Common)',
        options: remainingOptions
      };
      renderOptionsMenu(canvas, updatedMenuData);
    }, 320);

    return true;
  }

  /**
   * Helper to re-render default menu options
   */
  function renderDefaultOptionsMenu(container) {
    renderOptionsMenu(container, {
      template: 'multi_option_menu',
      title: 'What would you like to know next?',
      subtitle: '📍 Raipur APMC',
      market: 'Raipur APMC',
      commodity: 'Paddy (Common)',
      options: [
        { id: 'map', label: 'Map & Navigation', icon: '🗺️', desc: 'Driving distance & navigation' },
        { id: 'contact', label: 'Contact Info', icon: '📞', desc: 'Phone, address & office hours' },
        { id: 'trends', label: 'Rates & Trends', icon: '📊', desc: 'Latest rate range & trend' }
      ]
    });
  }

  /**
   * Completely dismiss all active templates and restore idle "Tap to speak" state.
   * Resets visited options and restores server screen state to IDLE.
   */
  function closeAllUI(isVoice = false) {
    const canvas = document.getElementById('voice-interactive-canvas');
    if (!canvas) return false;

    if (window._krishiMenuFallbackTimer) {
      clearTimeout(window._krishiMenuFallbackTimer);
      window._krishiMenuFallbackTimer = null;
    }

    if (window._krishiCloseAllTimer) {
      clearTimeout(window._krishiCloseAllTimer);
      window._krishiCloseAllTimer = null;
    }

    activeView = 'idle';
    visitedOptionIds.clear();

    // Dispatch custom event
    document.dispatchEvent(new CustomEvent('krishi:template-action', {
      detail: { action: 'close_all', isVoice },
      bubbles: true
    }));

    // If user tapped physical 'X' button or closed locally, notify live voice session
    if (!isVoice && window.KrishiVoice) {
      if (typeof window.KrishiVoice.sendScreenStateUpdate === 'function') {
        window.KrishiVoice.sendScreenStateUpdate('IDLE', null, {});
      }
      if (typeof window.KrishiVoice.sendVoiceCommand === 'function') {
        window.KrishiVoice.sendVoiceCommand('closed screen');
      }
    }

    // Agentic UI Verification Handshake: Confirmed all UI closed
    // Avoid duplicate verification if generative-renderer is handling closeAll
    const isGenerativeActive = Boolean(window.KrishiGenerativeRenderer && typeof window.KrishiGenerativeRenderer.closeAll === 'function');
    if (!isGenerativeActive && window.KrishiVoice && typeof window.KrishiVoice.sendUIVerification === 'function') {
      window.KrishiVoice.sendUIVerification({
        status: 'success',
        view: 'IDLE',
        closed_all: true
      });
    }

    const visibleElements = canvas.querySelectorAll('.tpl-detail-window, .tpl-menu-container, .tpl-comparison-container, .tpl-sell-crop-container, .tpl-success-checkmark-wrap, .ComparisonPrimitive, .SelectorMenuPrimitive, .DetailCardPrimitive, .gen-root-container');
    if (visibleElements.length > 0) {
      visibleElements.forEach(el => {
        el.classList.remove('animate__zoomIn', 'animate__fadeIn', 'animate__fadeInDown');
        el.classList.add('animate__animated', 'animate__zoomOut');
        el.style.setProperty('--animate-duration', '0.3s');
      });

      window._krishiCloseAllTimer = setTimeout(() => {
        window._krishiCloseAllTimer = null;
        canvas.classList.remove('tpl-active');
        visibleElements.forEach(el => {
          if (el && typeof el.remove === 'function') el.remove();
        });
        if (window.KrishiTemplates && typeof window.KrishiTemplates.restoreIdlePrompt === 'function') {
          window.KrishiTemplates.restoreIdlePrompt(canvas);
        }
      }, 300);
    } else {
      canvas.classList.remove('tpl-active');
      canvas.innerHTML = '';
      if (window.KrishiTemplates && typeof window.KrishiTemplates.restoreIdlePrompt === 'function') {
        window.KrishiTemplates.restoreIdlePrompt(canvas);
      }
    }

    return true;
  }

  // ============================================================
  // DEV TEST HARNESS FUNCTIONS
  // ============================================================

  function triggerTestOptionsMenu() {
    if (typeof window.setAIMode === 'function') {
      window.setAIMode('voice');
    }
    const canvas = document.getElementById('voice-interactive-canvas');
    if (!canvas) return;
    renderDefaultOptionsMenu(canvas);
    console.log('[DEV] MultiOptionMenu rendered.');
  }

  function triggerTestDetailWindow(viewType = 'map') {
    if (typeof window.setAIMode === 'function') {
      window.setAIMode('voice');
    }
    const canvas = document.getElementById('voice-interactive-canvas');
    if (!canvas) return;
    const data = buildDefaultDetailData(viewType);
    data.view = viewType;
    renderDetailWindow(canvas, data);
    console.log(`[DEV] DetailWindow rendered for: ${viewType}`);
  }

  function triggerTestSavedCrop() {
    if (typeof window.setAIMode === 'function') {
      window.setAIMode('voice');
    }
    const canvas = document.getElementById('voice-interactive-canvas');
    if (!canvas) return;
    renderDetailWindow(canvas, {
      template: 'detail_window',
      type: 'SAVED_CROP',
      view: 'saved_crop',
      title: 'Tomatoes (Hybrid)',
      data: {
        'Quantity': '5 Quintals',
        'Harvested': '2 days ago',
        'Variety': 'Hybrid Grade A',
        'Status': 'Listed for Sale'
      }
    });
    console.log('[DEV] Saved Crop DetailWindow rendered.');
  }

  function triggerTestCommodityList() {
    if (typeof window.setAIMode === 'function') {
      window.setAIMode('voice');
    }
    const canvas = document.getElementById('voice-interactive-canvas');
    if (!canvas) return;
    const commodities = [
      'Paddy (Dhan)', 'Wheat', 'Maize', 'Soyabean',
      'Mustard', 'Gram (Chana)', 'Tomato', 'Onion',
      'Potato', 'Green Chilli', 'Brinjal', 'Cotton',
      'Groundnut', 'Turmeric'
    ];
    const options = commodities.map((c, i) => ({
      id: `comm_${i + 1}`,
      label: c,
      icon: '🌾',
      desc: 'Tap or speak to see mandi rates'
    }));
    renderOptionsMenu(canvas, {
      template: 'multi_option_menu',
      title: 'Select Commodity (Raipur APMC)',
      subtitle: '14 commodities available',
      market: 'Raipur APMC',
      options: options
    });
    console.log('[DEV] Commodity List Options Menu rendered (14 items, paginated).');
  }

  // Export
  window.KrishiTemplates = window.KrishiTemplates || {};
  window.KrishiTemplates.renderOptionsMenu = renderOptionsMenu;
  window.KrishiTemplates.renderDetailWindow = renderDetailWindow;
  window.KrishiTemplates.selectMenuOption = selectMenuOption;
  window.KrishiTemplates.paginateMenu = paginateMenu;
  window.KrishiTemplates.goBackToOptionsMenu = goBackToOptionsMenu;
  window.KrishiTemplates.closeDetailWindow = closeAllUI;
  window.KrishiTemplates.closeAllUI = closeAllUI;

  window.triggerTestOptionsMenu = triggerTestOptionsMenu;
  window.triggerTestDetailWindow = triggerTestDetailWindow;
  window.triggerTestSavedCrop = triggerTestSavedCrop;
  window.triggerTestCommodityList = triggerTestCommodityList;
  window.triggerTestPaginate = (dir = 'NEXT') => paginateMenu(dir, false);
  window.triggerTestGoBack = goBackToOptionsMenu;
  window.triggerTestCloseAll = closeAllUI;

})(window);
