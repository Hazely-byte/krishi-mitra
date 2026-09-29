/**
 * ============================================================
 * Krishi Mitra — templates/generative-renderer.js
 * Generative Semantic State Machine & Universal Renderer
 * 
 * Implements the 3 Universal Semantic Primitives:
 * 1. renderComparison(container, data)   [Entity A vs Entity B]
 * 2. renderSelectorMenu(container, data) [1 to 6 choice rectangles]
 * 3. renderDetailCard(container, data)   [Enlarged modal: recipes, single rates, crisis relief]
 *
 * Fully equipped with:
 * - Agentic UI Verification (Two-way handshake on mount/crash)
 * - Closed-Loop Interactive Intent Routing (dispatches client_selection turns to Gemini Live)
 * - Transition animations (animate__zoomOut -> animate__zoomIn)
 * ============================================================
 */

(function (window) {
  'use strict';

  // Inject Self-Contained Styles
  function injectStyles() {
    if (document.getElementById('krishi-generative-styles')) return;
    const style = document.createElement('style');
    style.id = 'krishi-generative-styles';
    style.textContent = `
      /* Generative Primitives Shared Container */
      .gen-root-container {
        width: 100%;
        max-width: 440px;
        margin: 0 auto;
        display: flex;
        flex-direction: column;
        gap: 12px;
        box-sizing: border-box;
      }

      /* Primitive 1: Comparison */
      .gen-comparison-wrap {
        display: flex;
        flex-direction: column;
        gap: 10px;
        width: 100%;
      }
      .gen-comparison-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 4px 6px;
      }
      .gen-comparison-title {
        font-size: 17px;
        font-weight: 700;
        color: #0f172a;
      }
      .gen-category-badge {
        font-size: 11px;
        font-weight: 600;
        background: #e0f2fe;
        color: #0369a1;
        padding: 3px 8px;
        border-radius: 999px;
      }
      .gen-comparison-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
      }
      .gen-card {
        background: #ffffff;
        border: 1px solid #e2e8f0;
        border-radius: 14px;
        padding: 12px;
        display: flex;
        flex-direction: column;
        gap: 8px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
        cursor: pointer;
        transition: all 0.22s ease;
        position: relative;
        text-align: left;
      }
      .gen-card:hover {
        border-color: #10b981;
        transform: translateY(-2px);
      }
      .gen-card.selected {
        border-color: #10b981;
        box-shadow: 0 0 0 2px #10b981, 0 8px 20px rgba(16, 185, 129, 0.18);
        background: #f0fdf4;
      }
      .gen-card.dimmed {
        opacity: 0.55;
        transform: scale(0.98);
      }
      .gen-card-top {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .gen-card-badge {
        font-size: 10px;
        font-weight: 700;
        padding: 2px 6px;
        border-radius: 6px;
        display: inline-block;
        width: fit-content;
        margin-bottom: 4px;
        background: #f1f5f9;
        color: #475569;
      }
      .gen-card-badge.highlight {
        background: #dcfce7;
        color: #15803d;
      }
      .gen-card-name {
        font-size: 14px;
        font-weight: 700;
        color: #1e293b;
        line-height: 1.25;
      }
      .gen-card-sub {
        font-size: 11px;
        color: #64748b;
      }
      .gen-card-metric {
        font-size: 17px;
        font-weight: 800;
        color: #10b981;
        margin: 4px 0 2px 0;
      }
      .gen-card-attrs {
        display: flex;
        flex-direction: column;
        gap: 4px;
        font-size: 11px;
        border-top: 1px dashed #e2e8f0;
        padding-top: 6px;
      }
      .gen-attr-row {
        display: flex;
        justify-content: space-between;
        color: #475569;
      }
      .gen-attr-row.highlight {
        font-weight: 700;
        color: #0f172a;
      }
      .gen-card-select-btn {
        margin-top: 6px;
        padding: 6px 10px;
        font-size: 12px;
        font-weight: 600;
        background: #f8fafc;
        border: 1px solid #cbd5e1;
        border-radius: 8px;
        color: #334155;
        cursor: pointer;
        text-align: center;
        transition: all 0.2s ease;
      }
      .gen-card-select-btn:hover {
        background: #10b981;
        color: white;
        border-color: #10b981;
      }
      .gen-recom-box {
        background: #f8fafc;
        border-left: 3px solid #10b981;
        padding: 8px 12px;
        border-radius: 6px;
        font-size: 12px;
        color: #334155;
        line-height: 1.4;
      }

      /* Primitive 2: Selector Menu */
      .gen-selector-wrap {
        display: flex;
        flex-direction: column;
        gap: 8px;
        width: 100%;
      }
      .gen-selector-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0 4px;
      }
      .gen-selector-title {
        font-size: 17px;
        font-weight: 700;
        color: #0f172a;
      }
      .gen-selector-sub {
        font-size: 12px;
        color: #64748b;
      }
      .gen-close-btn {
        background: none;
        border: none;
        font-size: 16px;
        color: #94a3b8;
        cursor: pointer;
        padding: 4px 8px;
        border-radius: 6px;
      }
      .gen-close-btn:hover {
        background: #f1f5f9;
        color: #334155;
      }
      .gen-selector-list {
        display: flex;
        flex-direction: column;
        gap: 7px;
      }
      .gen-selector-item {
        background: #ffffff;
        border: 1px solid #e2e8f0;
        border-radius: 12px;
        padding: 10px 14px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        cursor: pointer;
        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.04);
        transition: all 0.18s ease;
        box-sizing: border-box;
        width: 100%;
        max-width: 100%;
        overflow: hidden;
      }
      .gen-selector-item:hover {
        border-color: #10b981;
        background: #f0fdf4;
        transform: translateX(3px);
      }
      .gen-selector-item.selected {
        border-color: #10b981;
        background: #ecfdf5;
        box-shadow: 0 0 0 2px #10b981;
      }
      .gen-item-left {
        display: flex;
        align-items: center;
        gap: 10px;
        min-width: 0;
        flex: 1;
        overflow: hidden;
      }
      .gen-item-icon {
        font-size: 20px;
        width: 32px;
        height: 32px;
        background: #f1f5f9;
        border-radius: 8px;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }
      .gen-item-info {
        display: flex;
        flex-direction: column;
        gap: 2px;
        text-align: left;
        min-width: 0;
        flex: 1;
        overflow: hidden;
      }
      .gen-item-label {
        font-size: 14px;
        font-weight: 700;
        color: #1e293b;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .gen-item-desc {
        font-size: 11px;
        color: #64748b;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .gen-item-badge {
        font-size: 10px;
        font-weight: 600;
        padding: 2px 6px;
        border-radius: 4px;
        background: #f1f5f9;
        color: #475569;
        flex-shrink: 0;
        white-space: nowrap;
        margin-left: 8px;
      }
      .gen-pagination-bar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 6px 4px;
        font-size: 12px;
        color: #64748b;
      }
      .gen-page-btn {
        padding: 5px 12px;
        border-radius: 8px;
        border: 1px solid #cbd5e1;
        background: white;
        cursor: pointer;
        font-weight: 600;
      }
      .gen-page-btn:disabled {
        opacity: 0.4;
        cursor: not-allowed;
      }

      /* Primitive 3: Detail Card */
      .gen-detail-wrap {
        display: flex;
        flex-direction: column;
        gap: 10px;
        width: 100%;
        background: #ffffff;
        border: 1px solid #e2e8f0;
        border-radius: 16px;
        padding: 16px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.08);
        box-sizing: border-box;
      }
      .gen-detail-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        border-bottom: 1px solid #f1f5f9;
        padding-bottom: 8px;
      }
      .gen-detail-header-left {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .gen-detail-icon {
        font-size: 26px;
        width: 44px;
        height: 44px;
        background: #f8fafc;
        border-radius: 12px;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .gen-detail-title-box {
        display: flex;
        flex-direction: column;
        gap: 2px;
        text-align: left;
      }
      .gen-detail-title {
        font-size: 17px;
        font-weight: 700;
        color: #0f172a;
      }
      .gen-detail-sub {
        font-size: 12px;
        color: #64748b;
      }

      /* Hero Banner Archetypes */
      .gen-hero-banner {
        border-radius: 12px;
        padding: 12px 14px;
        display: flex;
        flex-direction: column;
        gap: 3px;
        text-align: left;
      }
      .gen-hero-banner.market {
        background: #f0fdf4;
        border: 1px solid #bbf7d0;
      }
      .gen-hero-banner.crisis {
        background: #fff1f2;
        border: 1px solid #fecdd3;
      }
      .gen-hero-banner.recipe {
        background: #fffbeb;
        border: 1px solid #fde68a;
      }
      .gen-hero-banner.location {
        background: #f0f9ff;
        border: 1px solid #bae6fd;
      }
      .gen-hero-banner.guide {
        background: #f8fafc;
        border: 1px solid #e2e8f0;
      }
      .gen-hero-banner.entertainment {
        background: #faf5ff;
        border: 1px solid #e9d5ff;
      }
      .gen-hero-banner.contact {
        background: #f0fdf4;
        border: 1px solid #bbf7d0;
      }
      .gen-hero-banner.scheme {
        background: #fffbeb;
        border: 1px solid #fef08a;
      }
      .gen-hero-banner.demo-mock-hero {
        background: #fffbeb !important;
        border: 1px solid #fde68a !important;
      }

      .gen-hero-badge {
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin-bottom: 2px;
      }
      .gen-hero-badge.demo-mock-badge {
        color: #b45309 !important;
        background: #fef3c7 !important;
        padding: 2px 6px !important;
        border-radius: 4px !important;
        border: 1px solid #fde68a !important;
        display: inline-block !important;
        width: fit-content !important;
      }
      .gen-hero-banner.market .gen-hero-badge { color: #16a34a; }
      .gen-hero-banner.crisis .gen-hero-badge { color: #e11d48; }
      .gen-hero-banner.recipe .gen-hero-badge { color: #d97706; }
      .gen-hero-banner.location .gen-hero-badge { color: #0284c7; }
      .gen-hero-banner.guide .gen-hero-badge { color: #475569; }
      .gen-hero-banner.entertainment .gen-hero-badge { color: #9333ea; }
      .gen-hero-banner.contact .gen-hero-badge { color: #15803d; }
      .gen-hero-banner.scheme .gen-hero-badge { color: #b45309; }

      .gen-detail-title-box .gen-hero-badge {
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin-bottom: 2px;
      }
      .gen-detail-title-box .gen-hero-badge.entertainment { color: #9333ea; }
      .gen-detail-title-box .gen-hero-badge.contact { color: #15803d; }
      .gen-detail-title-box .gen-hero-badge.scheme { color: #b45309; }
      .gen-detail-title-box .gen-hero-badge.recipe { color: #d97706; }
      .gen-detail-title-box .gen-hero-badge.guide { color: #16a34a; }

      .gen-hero-value {
        font-size: 20px;
        font-weight: 800;
        color: #0f172a;
        line-height: 1.2;
      }
      .gen-hero-subvalue {
        font-size: 11px;
        color: #64748b;
      }

      /* Detail Sections */
      .gen-sections-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
        text-align: left;
      }
      .gen-section-box {
        background: #f8fafc;
        border-radius: 10px;
        padding: 10px 12px;
      }
      .gen-section-title {
        font-size: 12px;
        font-weight: 700;
        color: #334155;
        margin-bottom: 6px;
      }
      .gen-section-items {
        margin: 0;
        padding-left: 18px;
        display: flex;
        flex-direction: column;
        gap: 4px;
        font-size: 12px;
        color: #475569;
        line-height: 1.35;
      }

      /* Action Buttons */
      .gen-actions-bar {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-top: 4px;
      }
      .gen-action-btn {
        width: 100%;
        padding: 10px 14px;
        font-size: 13px;
        font-weight: 700;
        border-radius: 10px;
        border: none;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        transition: all 0.2s ease;
      }
      .gen-action-btn.primary {
        background: #10b981;
        color: white;
      }
      .gen-action-btn.primary:hover {
        background: #059669;
      }
      .gen-action-btn.crisis {
        background: #e11d48;
        color: white;
      }
      .gen-action-btn.crisis:hover {
        background: #be123c;
      }
      .gen-action-btn.secondary {
        background: #f1f5f9;
        color: #334155;
        border: 1px solid #cbd5e1;
      }
      .gen-action-btn.secondary:hover {
        background: #e2e8f0;
      }


      /* Empty State Notice */
      .empty-state-notice {
        padding: 16px 20px;
        margin: 8px 0;
        background: #f8fafc;
        border: 1.5px dashed #cbd5e1;
        border-radius: 12px;
        color: #64748b;
        font-size: 13px;
        font-weight: 500;
        text-align: center;
        line-height: 1.4;
        width: 100%;
        box-sizing: border-box;
      }

      /* Structured Specs Grid */
      .gen-specs-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
        margin: 6px 0;
        width: 100%;
        box-sizing: border-box;
      }
      .gen-spec-item {
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        padding: 8px 10px;
        display: flex;
        flex-direction: column;
        gap: 2px;
        text-align: left;
      }
      .gen-spec-label {
        font-size: 10px;
        font-weight: 600;
        text-transform: uppercase;
        color: #64748b;
      }
      .gen-spec-val {
        font-size: 13px;
        font-weight: 700;
        color: #1e293b;
      }
    `;
    document.head.appendChild(style);
  }

  function escapeHtml(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function resolveContentEmoji(name) {
    const n = (name || '').toLowerCase();
    // 1. Entertainment, Anime & Media
    if (n.includes('titan') || n.includes('claymore') || n.includes('anime') || n.includes('manga') || n.includes('naruto') || n.includes('goku') || n.includes('jujutsu') || n.includes('death note') || n.includes('bleach') || n.includes('one piece')) return '🎬';
    if (n.includes('movie') || n.includes('cinema') || n.includes('film') || n.includes('hollywood') || n.includes('bollywood') || n.includes('series') || n.includes('show') || n.includes('episode')) return '🍿';
    if (n.includes('music') || n.includes('song') || n.includes('audio')) return '🎵';
    if (n.includes('game') || n.includes('gaming')) return '🎮';

    // 2. Tech, Science & Software
    if (n.includes('tech') || n.includes('code') || n.includes('python') || n.includes('software') || n.includes('programming') || n.includes('algorithm')) return '💻';
    if (n.includes('science') || n.includes('physics') || n.includes('chemistry') || n.includes('biology')) return '🔬';

    // 3. Contact & Directory
    if (n.includes('contact') || n.includes('phone') || n.includes('call') || n.includes('secretary') || n.includes('helpline') || n.includes('संपर्क') || n.includes('फोन')) return '📞';

    // 4. Schemes & Official
    if (n.includes('scheme') || n.includes('yojana') || n.includes('subsidy') || n.includes('policy') || n.includes('योजना') || n.includes('अनुदान')) return '📜';

    // 5. Food & Recipes
    if (n.includes('recipe') || n.includes('food') || n.includes('cook') || n.includes('dish') || n.includes('halwa') || n.includes('salad') || n.includes('soup') || n.includes('curry')) return '🍲';

    // 6. Crops & Mandis
    if (n.includes('paddy') || n.includes('rice') || n.includes('धान')) return '🌾';
    if (n.includes('wheat') || n.includes('गेहूं') || n.includes('roti')) return '🌾';
    if (n.includes('tomato') || n.includes('टमाटर')) return '🍅';
    if (n.includes('apple') || n.includes('सेब')) return '🍎';
    if (n.includes('banana') || n.includes('केला')) return '🍌';
    if (n.includes('potato') || n.includes('आलू')) return '🥔';
    if (n.includes('onion') || n.includes('प्याज़')) return '🧅';
    if (n.includes('mango') || n.includes('आम')) return '🥭';
    if (n.includes('orange') || n.includes('संतरा')) return '🍊';
    if (n.includes('grape') || n.includes('अंगूर')) return '🍇';
    if (n.includes('maize') || n.includes('मक्का')) return '🌽';
    if (n.includes('elephant') || n.includes('हाथी')) return '🐘';
    if (n.includes('crisis') || n.includes('relief') || n.includes('emergency')) return '⚠️';
    if (n.includes('location') || n.includes('pin') || n.includes('gps')) return '📍';
    if (n.includes('map') || n.includes('route') || n.includes('navigate')) return '🗺️';
    if (n.includes('mandi') || n.includes('market') || n.includes('apmc')) return '🏪';
    if (n.includes('company') || n.includes('fpo') || n.includes('corp') || n.includes('cluster')) return '🏢';
    if (n.includes('trader') || n.includes('merchant') || n.includes('person') || n.includes('agent')) return '👤';
    if (n.includes('farming') || n.includes('agriculture') || n.includes('crop') || n.includes('soil') || n.includes('seed') || n.includes('fertilizer') || n.includes('खाद') || n.includes('फसल')) return '🌱';

    // Generic fallback: NOT sprout emoji unless farming
    return '✨';
  }

  function resolveEmoji(icon, fallbackText = '') {
    const str = (icon || '').trim();
    if (str) {
      // If it contains non-ASCII characters (e.g. real emoji or unicode symbol) and is short, use as-is
      const hasNonAscii = /[^\u0000-\u007F]/.test(str);
      if (hasNonAscii && str.length <= 4) {
        return str;
      }
      return resolveContentEmoji(str);
    }
    return resolveContentEmoji(fallbackText);
  }

  // Module-level state tracking for generative renderer
  let lastSelectorPayload = null;
  let activePrimitiveType = null; // 'selector', 'detail', 'comparison', null
  let closeTimeoutId = null;
  const legacyGoBackToOptionsMenu = (window.KrishiTemplates && typeof window.KrishiTemplates.goBackToOptionsMenu === 'function')
    ? window.KrishiTemplates.goBackToOptionsMenu
    : null;

  function cancelCloseTimer() {
    if (closeTimeoutId) {
      clearTimeout(closeTimeoutId);
      closeTimeoutId = null;
    }
    if (window._krishiCloseAllTimer) {
      clearTimeout(window._krishiCloseAllTimer);
      window._krishiCloseAllTimer = null;
    }
  }

  // Restore Idle Voice Prompt inside container
  function restoreIdlePrompt(container) {
    if (!container) return;
    if (container.querySelector('.voice-idle-prompt')) return;
    const idleWrap = document.createElement('div');
    idleWrap.className = 'voice-idle-prompt animate__animated animate__fadeIn';
    idleWrap.innerHTML = `
      <div class="idle-illustration">
        <svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="32" cy="32" r="30" fill="var(--green-50)" stroke="var(--green-200)" stroke-width="2"/>
          <path d="M32 18C29.24 18 27 20.24 27 23V33C27 35.76 29.24 38 32 38C34.76 38 37 35.76 37 33V23C37 20.24 34.76 18 32 18Z" fill="var(--green-500)"/>
          <path d="M41 33C41 37.97 36.97 42 32 42C27.03 42 23 37.97 23 33H21C21 39.08 25.84 43.92 31 44.89V48H33V44.89C38.16 43.92 43 39.08 43 33H41Z" fill="var(--green-600)"/>
        </svg>
      </div>
      <div class="idle-title" data-i18n="voice_tap_to_speak">Tap to speak</div>
      <div class="idle-subtitle" data-i18n="voice_prompt_hint">Speak in Hindi or English, e.g.: "What is the paddy price in Raipur?"</div>
    `;
    container.insertBefore(idleWrap, container.firstChild);
    container.classList.remove('tpl-active');
  }

  let lastPrimitiveMountTime = 0;

  // Smooth View Transition Handler
  function mountWithTransition(container, newElement, onComplete) {
    lastPrimitiveMountTime = Date.now();
    cancelCloseTimer();
    // Purge any existing idle prompt immediately so it never lingers under cards
    container.querySelectorAll('.voice-idle-prompt').forEach(p => p.remove());

    injectStyles();
    const existing = container.firstElementChild;
    if (existing && container.classList.contains('tpl-active')) {
      existing.classList.remove('animate__zoomIn', 'animate__fadeIn');
      existing.classList.add('animate__animated', 'animate__zoomOut');
      existing.style.setProperty('--animate-duration', '0.2s');
      setTimeout(() => {
        container.innerHTML = '';
        container.classList.add('tpl-active');
        newElement.classList.add('animate__animated', 'animate__zoomIn');
        newElement.style.setProperty('--animate-duration', '0.35s');
        container.appendChild(newElement);
        if (onComplete) onComplete();
      }, 200);
    } else {
      container.innerHTML = '';
      container.classList.add('tpl-active');
      newElement.classList.add('animate__animated', 'animate__zoomIn');
      newElement.style.setProperty('--animate-duration', '0.35s');
      container.appendChild(newElement);
      if (onComplete) onComplete();
    }
  }

  /**
   * ============================================================
   * PRIMITIVE 1: renderComparison (Entity A vs Entity B)
   * ============================================================
   */
  function renderComparison(container, data) {
    try {
      if (!container || !data) {
        throw new Error('Invalid comparison data: missing container or data');
      }
      activePrimitiveType = 'comparison';

      // Defensive normalization for legacy / variant keys
      if (!data.entity_a) {
        data.entity_a = data.left || data.market1 || data.market_a || data.option_a;
      }
      if (!data.entity_b) {
        data.entity_b = data.right || data.market2 || data.market_b || data.option_b;
      }
      if (data.entity_a) {
        if (!data.entity_a.name && data.entity_a.title) data.entity_a.name = data.entity_a.title;
        if (!data.entity_a.name && typeof data.entity_a === 'string') data.entity_a = { name: data.entity_a };
      }
      if (data.entity_b) {
        if (!data.entity_b.name && data.entity_b.title) data.entity_b.name = data.entity_b.title;
        if (!data.entity_b.name && typeof data.entity_b === 'string') data.entity_b = { name: data.entity_b };
      }
      if (!data.recommendation && (data.takeaway || data.summary)) {
        data.recommendation = data.takeaway || data.summary;
      }

      if (!data.entity_a || !data.entity_b) {
        throw new Error('Invalid comparison data: missing entity_a or entity_b');
      }

      const wrap = document.createElement('div');
      wrap.className = 'gen-root-container gen-comparison-wrap ComparisonPrimitive';

      const header = document.createElement('div');
      header.className = 'gen-comparison-header';
      header.innerHTML = `
        <div class="gen-comparison-title">${escapeHtml(data.title || 'Comparison')}</div>
        <div style="display:flex;align-items:center;gap:8px;">
          <span class="gen-category-badge">${escapeHtml(data.category || 'Overview')}</span>
          <button class="gen-close-btn" type="button" aria-label="Close">✕</button>
        </div>
      `;
      header.querySelector('.gen-close-btn').addEventListener('click', () => {
        closeAll(container);
      });
      wrap.appendChild(header);

      const grid = document.createElement('div');
      grid.className = 'gen-comparison-grid';

      // Card A
      const cardA = buildComparisonCard(data.entity_a, 'entity_a', 'render_comparison_ui');
      // Card B
      const cardB = buildComparisonCard(data.entity_b, 'entity_b', 'render_comparison_ui');

      grid.appendChild(cardA);
      grid.appendChild(cardB);
      wrap.appendChild(grid);

      // Top-level specs_grid or rows if provided on data
      const topSpecs = (Array.isArray(data.specs_grid) && data.specs_grid.length > 0)
        ? data.specs_grid
        : (Array.isArray(data.rows) && data.rows.length > 0 ? data.rows : []);

      if (topSpecs.length > 0) {
        const topGrid = document.createElement('div');
        topGrid.className = 'gen-specs-grid';
        topSpecs.forEach(spec => {
          const item = document.createElement('div');
          item.className = 'gen-spec-item';
          const label = typeof spec === 'string' ? '' : (spec.label || spec.name || '');
          const val = typeof spec === 'string' ? spec : (spec.value || spec.val || '');
          item.innerHTML = `
            ${label ? `<span class="gen-spec-label">${escapeHtml(label)}</span>` : ''}
            <span class="gen-spec-val">${escapeHtml(val)}</span>
          `;
          topGrid.appendChild(item);
        });
        wrap.appendChild(topGrid);
      }

      // Recommendation Banner if present
      if (data.recommendation) {
        const recom = document.createElement('div');
        recom.className = 'gen-recom-box';
        recom.innerHTML = `💡 <strong>Key Takeaway:</strong> ${escapeHtml(data.recommendation)}`;
        wrap.appendChild(recom);
      }

      const hasRealA = Boolean(data.entity_a && data.entity_a.highlight_metric && data.entity_a.highlight_metric !== 'No verified price available');
      const hasRealB = Boolean(data.entity_b && data.entity_b.highlight_metric && data.entity_b.highlight_metric !== 'No verified price available');
      const hasRealData = data.has_real_data !== false && (data.is_grounded ? (hasRealA || hasRealB) : true);

      mountWithTransition(container, wrap, () => {
        // Agentic UI Verification Handshake: Success only if at least one side has real verified data
        if (window.KrishiVoice && typeof window.KrishiVoice.sendUIVerification === 'function') {
          window.KrishiVoice.sendUIVerification({
            status: hasRealData ? 'success' : 'no_data',
            view: 'render_comparison_ui',
            primitive: 'comparison',
            title: data.title,
            entity_a: data.entity_a?.title || data.market_a || data.left?.title,
            entity_b: data.entity_b?.title || data.market_b || data.right?.title,
            rendered_items: hasRealData ? 2 : 0,
            has_real_data: hasRealData,
            is_grounded: Boolean(data.is_grounded)
          });
        }
      });

    } catch (err) {
      console.error('[KrishiGenerativeRenderer] renderComparison failed:', err);
      restoreIdlePrompt(container);
      if (window.KrishiVoice && typeof window.KrishiVoice.sendUIVerification === 'function') {
        window.KrishiVoice.sendUIVerification({
          status: 'failed',
          view: 'render_comparison_ui',
          primitive: 'comparison',
          error: err.message || 'Comparison render failed'
        });
      }
    }
  }

  function buildComparisonCard(entity, sideKey, contextView) {
    const card = document.createElement('div');
    card.className = 'gen-card';
    card.dataset.id = entity.id || sideKey;

    const isHighlight = Boolean(entity.badge && (entity.badge.includes('Highest') || entity.badge.includes('Recommended') || entity.badge.includes('Best')));

    const rawAttrs = (Array.isArray(entity.attributes) && entity.attributes.length > 0)
      ? entity.attributes
      : (Array.isArray(entity.rows) && entity.rows.length > 0
        ? entity.rows
        : (Array.isArray(entity.specs_grid) && entity.specs_grid.length > 0 ? entity.specs_grid : (Array.isArray(entity.specs) ? entity.specs : [])));

    let attrsHtml = '';
    if (rawAttrs.length > 0) {
      attrsHtml = rawAttrs.map(attr => {
        if (typeof attr === 'string') {
          return `<div class="gen-attr-row"><span>${escapeHtml(attr)}</span></div>`;
        }
        return `
          <div class="gen-attr-row ${attr.highlight ? 'highlight' : ''}">
            <span>${escapeHtml(attr.label || attr.name || '')}</span>
            <span>${escapeHtml(attr.value || attr.val || '')}</span>
          </div>
        `;
      }).join('');
    }

    const hasData = Boolean(entity.highlight_metric || (rawAttrs && rawAttrs.length > 0));
    const emptyNotice = !hasData ? `<div class="empty-state-notice">No data currently available for this query.</div>` : '';

    card.innerHTML = `
      <div class="gen-card-top">
        ${entity.badge ? `<span class="gen-card-badge ${isHighlight ? 'highlight' : ''}">${escapeHtml(entity.badge)}</span>` : ''}
        <div class="gen-card-name">${escapeHtml(entity.name || entity.title || 'Entity')}</div>
        ${entity.subtitle ? `<div class="gen-card-sub">${escapeHtml(entity.subtitle)}</div>` : ''}
      </div>
      ${entity.highlight_metric ? `<div class="gen-card-metric">${escapeHtml(entity.highlight_metric)}</div>` : ''}
      ${emptyNotice}
      ${attrsHtml ? `<div class="gen-card-attrs">${attrsHtml}</div>` : ''}
      <button class="gen-card-select-btn" type="button">Select ${escapeHtml(entity.name || entity.title || '')}</button>
    `;

    // Closed-Loop Interactive Tap: dispatches client_selection synthetic turn to Gemini
    card.addEventListener('click', (e) => {
      e.stopPropagation();
      const parentGrid = card.parentElement;
      if (parentGrid) {
        parentGrid.querySelectorAll('.gen-card').forEach(c => {
          if (c === card) {
            c.classList.add('selected');
            c.classList.remove('dimmed');
          } else {
            c.classList.add('dimmed');
            c.classList.remove('selected');
          }
        });
      }

      if (window.KrishiVoice && typeof window.KrishiVoice.sendClientSelection === 'function') {
        window.KrishiVoice.sendClientSelection({
          selected_id: entity.id || sideKey,
          label: entity.name || sideKey,
          context: contextView,
          highlight_metric: entity.highlight_metric
        });
      }
    });

    return card;
  }

  /**
   * ============================================================
   * PRIMITIVE 2: renderSelectorMenu (1 to 6 choice rectangles)
   * ============================================================
   */
  function renderSelectorMenu(container, data) {
    try {
      if (!container || !data) {
        throw new Error('Invalid selector menu data');
      }

      lastSelectorPayload = data;
      activePrimitiveType = 'selector';

      const allChoices = (Array.isArray(data.allOptions) && data.allOptions.length > 0)
        ? data.allOptions
        : (Array.isArray(data.all_commodities) && data.all_commodities.length > 0
          ? data.all_commodities
          : (Array.isArray(data.options) ? data.options : []));

      const pageSize = 6;
      const totalPages = data.total_pages || Math.ceil(allChoices.length / pageSize) || 1;
      let page = typeof data.page === 'number' ? Math.max(0, Math.min(data.page, totalPages - 1)) : 0;
      data.page = page;
      data.total_pages = totalPages;
      data.allOptions = allChoices;

      const startIndex = page * pageSize;
      const visibleOptions = allChoices.slice(startIndex, startIndex + pageSize);

      const wrap = document.createElement('div');
      wrap.className = 'gen-root-container gen-selector-wrap SelectorMenuPrimitive';

      let subtitleText = data.subtitle || '';
      if (subtitleText && /\(Page \d+ of \d+\)/.test(subtitleText)) {
        subtitleText = subtitleText.replace(/\(Page \d+ of \d+\)/, `(Page ${page + 1} of ${totalPages})`);
      } else if (!subtitleText) {
        subtitleText = (allChoices.length > pageSize
          ? `Showing ${startIndex + 1}–${Math.min(startIndex + pageSize, allChoices.length)} of ${allChoices.length}`
          : (visibleOptions.length > 0 ? `Showing ${visibleOptions.length} choices` : ''));
      }

      const header = document.createElement('div');
      header.className = 'gen-selector-header';
      header.innerHTML = `
        <div>
          <div class="gen-selector-title">${escapeHtml(data.title || 'Choose an Option')}</div>
          <div class="gen-selector-sub">${escapeHtml(subtitleText)}</div>
        </div>
        <button class="gen-close-btn" type="button" aria-label="Close">✕</button>
      `;
      header.querySelector('.gen-close-btn').addEventListener('click', () => {
        closeAll(container);
      });
      wrap.appendChild(header);

      if (data.disclaimer || data.has_mock_data) {
        const disclaimerBox = document.createElement('div');
        disclaimerBox.className = 'gen-mock-disclaimer';
        disclaimerBox.style.cssText = 'background:#fffbeb; border:1px solid #fde68a; border-radius:8px; padding:6px 10px; font-size:11px; color:#92400e; display:flex; align-items:center; gap:6px;';
        disclaimerBox.innerHTML = `<span>⚠️</span><span><strong>Demo Listings:</strong> ${escapeHtml(data.disclaimer || 'Example test fixtures for demonstration; not verified real buyers.')}</span>`;
        wrap.appendChild(disclaimerBox);
      }

      if (visibleOptions.length === 0) {
        const emptyNotice = document.createElement('div');
        emptyNotice.className = 'empty-state-notice';
        emptyNotice.textContent = data.empty_message || 'No data currently available for this query.';
        wrap.appendChild(emptyNotice);

        mountWithTransition(container, wrap, () => {
          if (window.KrishiVoice && typeof window.KrishiVoice.sendUIVerification === 'function') {
            window.KrishiVoice.sendUIVerification({
              status: 'empty',
              view: 'render_selector_menu_ui',
              primitive: 'selector_menu',
              title: data.title,
              rendered_items: 0,
              has_real_data: false,
              page: 0,
              total_pages: 1,
              is_grounded: Boolean(data.is_grounded)
            });
          }
        });
        return;
      }

      const list = document.createElement('div');
      list.className = 'gen-selector-list';

      visibleOptions.forEach((opt, idx) => {
        const item = document.createElement('div');
        item.className = 'gen-selector-item';
        item.dataset.id = opt.id || `choice_${startIndex + idx + 1}`;

        const emoji = resolveEmoji(opt.icon, opt.label);

        const isOptMock = Boolean(opt.isMockData || (opt.badge && opt.badge.includes('Demo Listing')));
        const badgeStyle = isOptMock ? 'background:#fef3c7; color:#b45309; border:1px solid #fde68a; font-weight:700;' : '';

        item.innerHTML = `
          <div class="gen-item-left">
            <div class="gen-item-icon">${emoji}</div>
            <div class="gen-item-info">
              <div class="gen-item-label">${escapeHtml(opt.label || 'Choice')}</div>
              ${opt.desc ? `<div class="gen-item-desc">${escapeHtml(opt.desc)}</div>` : ''}
            </div>
          </div>
          ${opt.badge ? `<span class="gen-item-badge" style="${badgeStyle}">${escapeHtml(opt.badge)}</span>` : '<span style="color:#94a3b8; font-size:14px;">➔</span>'}
        `;

        // Closed-Loop Interactive Tap: Dispatches client_selection turn to Gemini
        item.addEventListener('click', (e) => {
          e.stopPropagation();
          list.querySelectorAll('.gen-selector-item').forEach(it => it.classList.remove('selected'));
          item.classList.add('selected');

          if (window.KrishiVoice && typeof window.KrishiVoice.sendClientSelection === 'function') {
            window.KrishiVoice.sendClientSelection({
              selected_id: opt.id || `choice_${startIndex + idx + 1}`,
              label: opt.label,
              context: 'render_selector_menu_ui',
              desc: opt.desc
            });
          }
        });

        list.appendChild(item);
      });

      wrap.appendChild(list);

      // Pagination bar if multi-page
      if (totalPages > 1) {
        const pageBar = document.createElement('div');
        pageBar.className = 'gen-pagination-bar';
        const currPage = page + 1;
        pageBar.innerHTML = `
          <button class="gen-page-btn" id="btn-gen-prev" ${page <= 0 ? 'disabled' : ''}>← Previous</button>
          <span>Page ${currPage} of ${totalPages}</span>
          <button class="gen-page-btn" id="btn-gen-next" ${page >= totalPages - 1 ? 'disabled' : ''}>Next →</button>
        `;

        pageBar.querySelector('#btn-gen-prev').addEventListener('click', (e) => {
          e.preventDefault();
          paginateMenu('PREV');
        });
        pageBar.querySelector('#btn-gen-next').addEventListener('click', (e) => {
          e.preventDefault();
          paginateMenu('NEXT');
        });
        wrap.appendChild(pageBar);
      }

      mountWithTransition(container, wrap, () => {
        // Agentic UI Verification Handshake: Success
        if (window.KrishiVoice && typeof window.KrishiVoice.sendUIVerification === 'function') {
          window.KrishiVoice.sendUIVerification({
            status: 'success',
            view: 'render_selector_menu_ui',
            primitive: 'selector_menu',
            title: data.title,
            items: visibleOptions.map(o => o.label || o.id || o.name),
            rendered_items: visibleOptions.length,
            page: page + 1,
            total_pages: totalPages,
            is_grounded: Boolean(data.is_grounded)
          });
        }
      });

    } catch (err) {
      console.error('[KrishiGenerativeRenderer] renderSelectorMenu failed:', err);
      restoreIdlePrompt(container);
      if (window.KrishiVoice && typeof window.KrishiVoice.sendUIVerification === 'function') {
        window.KrishiVoice.sendUIVerification({
          status: 'failed',
          view: 'render_selector_menu_ui',
          primitive: 'selector_menu',
          error: err.message || 'Selector menu render failed'
        });
      }
    }
  }

  /**
   * ============================================================
   * PRIMITIVE 3: renderDetailCard (Enlarged Modal / Deep-Dive / Crisis)
   * ============================================================
   */
  function renderDetailCard(container, data) {
    try {
      if (!container || !data) {
        throw new Error('Invalid detail card data');
      }

      activePrimitiveType = 'detail';

      const typeKey = (data.type || 'guide').toLowerCase();
      const domainKey = (data.domain || '').toLowerCase();
      const isCrisis = typeKey.includes('crisis') || Boolean(data.title && (data.title.includes('Damage') || data.title.includes('RBC')));
      const isCreative = typeKey.includes('entertainment') || typeKey.includes('anime') || domainKey === 'entertainment' || domainKey === 'anime' ||
        Boolean(data.title && (/anime|manga|titan|claymore|movie|film|series|show|game/i.test(data.title)));
      const isContact = typeKey.includes('contact') || domainKey === 'contact' || Boolean(data.title && (/contact|phone|helpline|secretary|संपर्क/i.test(data.title)));
      const isScheme = typeKey.includes('scheme') || typeKey.includes('yojana') || domainKey === 'scheme' || Boolean(data.title && (/scheme|yojana|subsidy|योजना/i.test(data.title)));

      const themeClass = isCrisis ? 'crisis' :
        (isCreative ? 'entertainment' :
        (isContact ? 'contact' :
        (isScheme ? 'scheme' :
        (typeKey.includes('rate') ? 'market' :
        (typeKey.includes('recipe') ? 'recipe' :
        (typeKey.includes('location') ? 'location' : 'guide'))))));

      const wrap = document.createElement('div');
      wrap.className = `gen-root-container gen-detail-wrap DetailCardPrimitive ${themeClass}`;

      const iconEmoji = resolveEmoji(data.icon, isCrisis ? 'crisis' : (data.title || 'details'));

      // Header
      const header = document.createElement('div');
      header.className = 'gen-detail-header';
      header.innerHTML = `
        <div class="gen-detail-header-left">
          <div class="gen-detail-icon">${iconEmoji}</div>
          <div class="gen-detail-title-box">
            ${data.hero_badge && !data.hero_metric ? `<div class="gen-hero-badge ${themeClass}">${escapeHtml(data.hero_badge)}</div>` : ''}
            <div class="gen-detail-title">${escapeHtml(data.title || 'Details')}</div>
            ${data.subtitle ? `<div class="gen-detail-sub">${escapeHtml(data.subtitle)}</div>` : ''}
          </div>
        </div>
        <button class="gen-close-btn" type="button" aria-label="Close">✕</button>
      `;
      header.querySelector('.gen-close-btn').addEventListener('click', () => {
        closeAll(container);
      });
      wrap.appendChild(header);

      // Hero Banner
      if (data.hero_metric) {
        const hero = document.createElement('div');
        const isMockCard = Boolean(data.has_mock_data || data.isMockData || (data.hero_badge && data.hero_badge.includes('Demo Listing')));
        hero.className = `gen-hero-banner ${themeClass}${isMockCard ? ' demo-mock-hero' : ''}`;
        const metric = data.hero_metric;
        hero.innerHTML = `
          ${data.hero_badge || metric.label ? `<div class="gen-hero-badge${isMockCard ? ' demo-mock-badge' : ''}">${escapeHtml(data.hero_badge || metric.label)}</div>` : ''}
          <div class="gen-hero-value">${escapeHtml(metric.value || '')}</div>
          ${metric.subvalue ? `<div class="gen-hero-subvalue">${escapeHtml(metric.subvalue)}</div>` : ''}
        `;
        wrap.appendChild(hero);
      }

      // Specs Grid / Attributes / Rows
      let rawSpecs = (Array.isArray(data.specs_grid) && data.specs_grid.length > 0)
        ? data.specs_grid
        : (Array.isArray(data.rows) && data.rows.length > 0
          ? data.rows
          : (Array.isArray(data.attributes) && data.attributes.length > 0 ? data.attributes : []));

      // If rawSpecs is still empty, normalize data.data dictionary (e.g. location, mandi specs)
      if (rawSpecs.length === 0 && data.data && typeof data.data === 'object' && !Array.isArray(data.data)) {
        rawSpecs = Object.entries(data.data).map(([k, v]) => ({ label: k, value: String(v) }));
      }

      if (rawSpecs.length > 0) {
        const grid = document.createElement('div');
        grid.className = 'gen-specs-grid';
        rawSpecs.forEach(spec => {
          const item = document.createElement('div');
          item.className = 'gen-spec-item';
          const label = typeof spec === 'string' ? '' : (spec.label || spec.name || '');
          const val = typeof spec === 'string' ? spec : (spec.value || spec.val || '');
          item.innerHTML = `
            ${label ? `<span class="gen-spec-label">${escapeHtml(label)}</span>` : ''}
            <span class="gen-spec-val">${escapeHtml(val)}</span>
          `;
          grid.appendChild(item);
        });
        wrap.appendChild(grid);
      }

      // Real Substantive Content Detection
      const hasSections = Array.isArray(data.sections) && data.sections.length > 0;
      const hasHero = Boolean(data.hero_metric && data.hero_metric.value && data.hero_metric.value !== data.title && !data.hero_metric.value.toLowerCase().includes('no data'));
      const hasSpecs = rawSpecs.length > 0;
      const hasRealContent = !data.empty_data && (hasSections || hasSpecs || hasHero);

      if (!hasRealContent || data.empty_data) {
        const emptyNotice = document.createElement('div');
        emptyNotice.className = 'empty-state-notice';
        emptyNotice.textContent = data.empty_message || 'No data currently available for this query.';
        wrap.appendChild(emptyNotice);
      }

      // Sections List
      if (Array.isArray(data.sections) && data.sections.length > 0) {
        const secList = document.createElement('div');
        secList.className = 'gen-sections-list';

        data.sections.forEach(sec => {
          const box = document.createElement('div');
          box.className = 'gen-section-box';
          let itemsHtml = '';
          if (Array.isArray(sec.items)) {
            itemsHtml = sec.items.map(it => `<li>${escapeHtml(it)}</li>`).join('');
          }
          box.innerHTML = `
            <div class="gen-section-title">${escapeHtml(sec.title || 'Information')}</div>
            <ul class="gen-section-items">${itemsHtml}</ul>
          `;
          secList.appendChild(box);
        });
        wrap.appendChild(secList);
      }

      // Action Buttons
      if (Array.isArray(data.action_buttons) && data.action_buttons.length > 0) {
        const actionsBar = document.createElement('div');
        actionsBar.className = 'gen-actions-bar';

        data.action_buttons.forEach((btn, idx) => {
          const actionBtn = document.createElement('button');
          actionBtn.className = `gen-action-btn ${isCrisis && idx === 0 ? 'crisis' : (idx === 0 ? 'primary' : 'secondary')}`;
          actionBtn.type = 'button';
          actionBtn.innerHTML = escapeHtml(btn.label || 'Action');

          // Closed-Loop Interactive Tap: dispatches client_selection turn to Gemini
          actionBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (btn.type === 'tel' && btn.payload) {
              window.location.href = btn.payload;
            } else if (btn.type === 'link' && btn.payload) {
              window.open(btn.payload, '_blank');
            }

            if (window.KrishiVoice && typeof window.KrishiVoice.sendClientSelection === 'function') {
              window.KrishiVoice.sendClientSelection({
                selected_id: btn.id || `action_${idx + 1}`,
                label: btn.label,
                context: 'render_detail_card_ui',
                type: data.type,
                payload: btn.payload
              });
            }
          });

          actionsBar.appendChild(actionBtn);
        });
        wrap.appendChild(actionsBar);
      }

      mountWithTransition(container, wrap, () => {
        // Agentic UI Verification Handshake: Success only if real substantive content is present
        if (window.KrishiVoice && typeof window.KrishiVoice.sendUIVerification === 'function') {
          window.KrishiVoice.sendUIVerification({
            status: hasRealContent ? 'success' : 'empty',
            view: 'render_detail_card_ui',
            primitive: 'detail_card',
            card_type: data.type || 'TECHNICAL_GUIDE',
            title: data.title,
            isMockData: Boolean(data.isMockData || data.has_mock_data),
            rendered_items: hasRealContent ? 1 : 0,
            has_real_data: hasRealContent,
            is_grounded: Boolean(data.is_grounded)
          });
        }
      });

    } catch (err) {
      console.error('[KrishiGenerativeRenderer] renderDetailCard failed:', err);
      restoreIdlePrompt(container);
      if (window.KrishiVoice && typeof window.KrishiVoice.sendUIVerification === 'function') {
        window.KrishiVoice.sendUIVerification({
          status: 'failed',
          view: 'render_detail_card_ui',
          primitive: 'detail_card',
          error: err.message || 'Detail card render failed'
        });
      }
    }
  }

  let closeOperationId = 0;

  function closeAll(container, callback) {
    if (!container) container = document.getElementById('voice-interactive-canvas');
    if (!container) return;

    if (closeTimeoutId) {
      clearTimeout(closeTimeoutId);
      closeTimeoutId = null;
    }

    const currentCloseId = ++closeOperationId;
    activePrimitiveType = null;

    const activePrimitives = Array.from(container.querySelectorAll('.ComparisonPrimitive, .SelectorMenuPrimitive, .DetailCardPrimitive, .gen-root-container, .tpl-sell-crop-container, .tpl-detail-window, .tpl-menu-container'));

    const finishClose = () => {
      closeTimeoutId = null;
      // If a new primitive mounted during the 300ms transition, don't clear the new primitive!
      if (closeOperationId !== currentCloseId || activePrimitiveType !== null) {
        return;
      }

      activePrimitives.forEach(el => {
        if (el && typeof el.remove === 'function') el.remove();
      });

      // Restore idle prompt cleanly once closed
      restoreIdlePrompt(container);
      const prompts = container.querySelectorAll('.voice-idle-prompt');
      prompts.forEach((p, idx) => { if (idx > 0) p.remove(); });
      container.classList.remove('tpl-active');

      if (window.KrishiVoice && typeof window.KrishiVoice.sendUIVerification === 'function') {
        window.KrishiVoice.sendUIVerification({
          type: 'ui_verification',
          status: 'success',
          view: 'IDLE',
          primitive: 'none',
          rendered_items: 0
        });
      }
      if (typeof callback === 'function') callback();
    };

    if (activePrimitives.length > 0) {
      activePrimitives.forEach(el => {
        el.classList.remove('gen-root-container', 'animate__zoomIn', 'animate__fadeIn');
        el.classList.add('animate__animated', 'animate__zoomOut');
        el.style.setProperty('--animate-duration', '0.28s');
      });
      closeTimeoutId = setTimeout(finishClose, 300);
    } else {
      finishClose();
    }
  }

  function paginateMenu(direction = 'NEXT') {
    if (!lastSelectorPayload) return false;
    const allChoices = (Array.isArray(lastSelectorPayload.allOptions) && lastSelectorPayload.allOptions.length > 0)
      ? lastSelectorPayload.allOptions
      : (Array.isArray(lastSelectorPayload.all_commodities) && lastSelectorPayload.all_commodities.length > 0
        ? lastSelectorPayload.all_commodities
        : (Array.isArray(lastSelectorPayload.options) ? lastSelectorPayload.options : []));

    const pageSize = 6;
    const totalPages = lastSelectorPayload.total_pages || Math.ceil(allChoices.length / pageSize) || 1;
    let page = typeof lastSelectorPayload.page === 'number' ? lastSelectorPayload.page : 0;

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

    lastSelectorPayload.page = page;
    const container = document.getElementById('voice-interactive-canvas');
    if (!container) return false;

    renderSelectorMenu(container, lastSelectorPayload);

    // Notify server of new visible options on screen
    const startIndex = page * pageSize;
    const visible = allChoices.slice(startIndex, startIndex + pageSize);
    if (window.KrishiVoice && typeof window.KrishiVoice.sendScreenStateUpdate === 'function') {
      window.KrishiVoice.sendScreenStateUpdate('OPTIONS_MENU', lastSelectorPayload.market || lastSelectorPayload.district || 'Commodities', {
        page: page + 1,
        total_pages: totalPages,
        visible_options: visible.map(o => o.label || o.id)
      });
    }

    return true;
  }

  function goBackToOptionsMenu(isVoice = false, resetVisited = false) {
    const canvas = document.getElementById('voice-interactive-canvas');
    if (canvas && (canvas.querySelector('.DetailCardPrimitive') || canvas.querySelector('.gen-detail-wrap') || activePrimitiveType === 'detail')) {
      if (lastSelectorPayload) {
        renderSelectorMenu(canvas, lastSelectorPayload);
        return true;
      } else {
        closeAll(canvas);
        return true;
      }
    }
    if (typeof legacyGoBackToOptionsMenu === 'function') {
      return legacyGoBackToOptionsMenu(isVoice, resetVisited);
    }
    return false;
  }

  // Export to window
  window.KrishiGenerativeRenderer = {
    renderComparison,
    renderSelectorMenu,
    renderDetailCard,
    paginateMenu,
    goBackToOptionsMenu,
    closeAll,
    cancelCloseTimer,
    injectStyles
  };

  // Augment window.KrishiTemplates so voice.js and legacy harness can call either
  window.KrishiTemplates = window.KrishiTemplates || {};
  window.KrishiTemplates.renderComparisonUi = renderComparison;
  window.KrishiTemplates.renderSelectorMenuUi = renderSelectorMenu;
  window.KrishiTemplates.renderDetailCardUi = renderDetailCard;
  window.KrishiTemplates.paginateMenu = paginateMenu;
  window.KrishiTemplates.goBackToOptionsMenu = goBackToOptionsMenu;

})(window);
