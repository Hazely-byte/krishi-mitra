/**
 * ============================================================
 * Krishi Mitra — templates/comparison.js
 * Reusable Two-Way Comparison Template Renderer.
 * Mounts inside #voice-interactive-canvas when triggered.
 * Fully data-driven, generic, and decoupled from backend.
 * ============================================================
 */
(function (window) {
  'use strict';

  /**
   * Render a Two-Way Comparison template into the given container.
   *
   * @param {HTMLElement} container — The mount target (e.g. #voice-interactive-canvas)
   * @param {Object} data — The comparison data contract:
   *   { template: 'two_way_comparison',
   *     left:  { id, title, badge?, rows: [{ label, value, highlight? }] },
   *     right: { id, title, badge?, rows: [{ label, value, highlight? }] },
   *     buttons: [{ targetId, label, voiceTurn }] }
   */
  function renderComparison(container, data) {
    if (!container || !data || !data.left || !data.right) {
      console.error('[KrishiTemplates] Invalid comparison data:', data);
      return;
    }

    // Clear previous content (idle prompt or old template)
    container.innerHTML = '';
    container.classList.add('tpl-active');

    // Build root
    const root = document.createElement('div');
    root.className = 'tpl-comparison-container';

    // Build left and right columns
    const leftCol = buildColumn(data.left, data.buttons, 'left');
    const rightCol = buildColumn(data.right, data.buttons, 'right');

    root.appendChild(leftCol);
    root.appendChild(rightCol);
    container.appendChild(root);

    // Wire interactions
    wireInteractions(root, data);

    // Trigger entrance animations (next frame to ensure DOM is painted)
    requestAnimationFrame(() => {
      const leftCard = leftCol.querySelector('.tpl-comparison-card');
      const rightCard = rightCol.querySelector('.tpl-comparison-card');

      if (leftCard) {
        leftCard.classList.add('animate__animated', 'animate__backInLeft');
        leftCard.style.setProperty('--animate-duration', '0.7s');
      }
      if (rightCard) {
        rightCard.classList.add('animate__animated', 'animate__backInRight');
        rightCard.style.setProperty('--animate-duration', '0.7s');
      }

      // Stagger header animations
      root.querySelectorAll('.tpl-card-header').forEach((h, i) => {
        h.classList.add('animate__animated', 'animate__fadeInDownBig');
        h.style.setProperty('--animate-duration', '0.5s');
        h.style.animationDelay = `${200 + i * 80}ms`;
      });

      // Stagger body row animations
      root.querySelectorAll('.tpl-card-row').forEach((row, i) => {
        row.classList.add('animate__animated', 'animate__fadeInUp');
        row.style.setProperty('--animate-duration', '0.4s');
        row.style.animationDelay = `${350 + i * 100}ms`;
      });

      // Button fade-in after cards
      root.querySelectorAll('.tpl-comparison-btn').forEach((btn, i) => {
        btn.classList.add('animate__animated', 'animate__fadeIn');
        btn.style.setProperty('--animate-duration', '0.4s');
        btn.style.animationDelay = `${700 + i * 100}ms`;
      });
    });
  }

  /**
   * Build a column (card + button) for one side.
   */
  function buildColumn(sideData, buttons, side) {
    const col = document.createElement('div');
    col.className = 'tpl-comparison-column';
    col.dataset.side = side;

    // Card
    const card = document.createElement('div');
    card.className = 'tpl-comparison-card';
    card.dataset.id = sideData.id || side;
    card.setAttribute('role', 'option');
    card.setAttribute('tabindex', '0');

    // Card Header
    const header = document.createElement('div');
    header.className = 'tpl-card-header';

    const title = document.createElement('div');
    title.className = 'tpl-card-title';
    title.textContent = sideData.title || '';
    title.title = sideData.title || '';
    header.appendChild(title);

    if (sideData.badge) {
      const badge = document.createElement('span');
      badge.className = 'tpl-card-badge';
      badge.textContent = sideData.badge;
      header.appendChild(badge);
    }

    card.appendChild(header);

    // Card Body
    const body = document.createElement('div');
    body.className = 'tpl-card-body';

    if (Array.isArray(sideData.rows)) {
      sideData.rows.forEach(rowData => {
        const row = document.createElement('div');
        row.className = 'tpl-card-row';
        if (rowData.highlight) row.classList.add('highlight');

        const label = document.createElement('div');
        label.className = 'tpl-row-label';
        label.textContent = rowData.label || '';

        const value = document.createElement('div');
        value.className = 'tpl-row-value';
        value.textContent = rowData.value || '';
        value.title = rowData.value || '';

        row.appendChild(label);
        row.appendChild(value);
        body.appendChild(row);
      });
    }

    card.appendChild(body);
    col.appendChild(card);

    // Button
    const matchingButton = (buttons || []).find(b => b.targetId === sideData.id);
    if (matchingButton) {
      const btn = document.createElement('button');
      btn.className = 'tpl-comparison-btn';
      btn.textContent = matchingButton.label || 'Select';
      btn.dataset.targetId = matchingButton.targetId;
      btn.dataset.voiceTurn = matchingButton.voiceTurn || '';
      btn.type = 'button';
      btn.setAttribute('aria-label', matchingButton.label || 'Select');
      col.appendChild(btn);
    }

    return col;
  }

  /**
   * Wire click/tap interactions for selection.
   */
  function wireInteractions(root, data) {
    const cards = root.querySelectorAll('.tpl-comparison-card');
    const buttons = root.querySelectorAll('.tpl-comparison-btn');
    let selected = false;

    function handleSelection(targetId, voicePayload, originEl) {
      if (selected) return;
      selected = true;

      // Ripple on button if it was the origin
      if (originEl && originEl.classList.contains('tpl-comparison-btn')) {
        createRipple(originEl);
      }

      // Highlight / dim cards
      cards.forEach(card => {
        if (card.dataset.id === targetId) {
          card.classList.add('selected');
        } else {
          card.classList.add('dimmed');
        }
      });

      // Disable buttons
      buttons.forEach(btn => {
        btn.disabled = true;
      });

      // Dispatch custom event
      document.dispatchEvent(new CustomEvent('krishi:template-action', {
        detail: {
          action: 'select',
          selectedId: targetId,
          voicePayload: voicePayload || ''
        },
        bubbles: true
      }));
    }

    // Button clicks
    buttons.forEach(btn => {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        handleSelection(btn.dataset.targetId, btn.dataset.voiceTurn, btn);
      });
    });

    // Card clicks / taps
    cards.forEach(card => {
      card.addEventListener('click', function () {
        const targetId = card.dataset.id;
        const matchingBtn = root.querySelector(`.tpl-comparison-btn[data-target-id="${targetId}"]`);
        const voiceTurn = matchingBtn ? matchingBtn.dataset.voiceTurn : '';
        handleSelection(targetId, voiceTurn, card);
      });

      // Keyboard accessibility
      card.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          card.click();
        }
      });
    });
  }

  /**
   * Create a ripple effect on a button.
   */
  function createRipple(btn) {
    const ripple = document.createElement('span');
    ripple.className = 'tpl-ripple';
    const rect = btn.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    ripple.style.width = ripple.style.height = size + 'px';
    ripple.style.left = '50%';
    ripple.style.top = '50%';
    ripple.style.marginLeft = -(size / 2) + 'px';
    ripple.style.marginTop = -(size / 2) + 'px';
    btn.appendChild(ripple);
    ripple.addEventListener('animationend', () => ripple.remove());
  }

  /**
   * Clear the active template and restore idle state.
   */
  function clearTemplate(container) {
    if (!container) return;
    container.classList.remove('tpl-active');

    // Fade out existing content
    const existing = container.querySelector('.tpl-comparison-container');
    if (existing) {
      existing.classList.add('animate__animated', 'animate__fadeOut');
      existing.style.setProperty('--animate-duration', '0.3s');
      existing.addEventListener('animationend', () => {
        existing.remove();
        restoreIdlePrompt(container);
      }, { once: true });
    } else {
      restoreIdlePrompt(container);
    }
  }

  /**
   * Restore the idle prompt in the interactive canvas.
   */
  function restoreIdlePrompt(container) {
    if (!container) return;
    // Don't double-insert
    if (container.querySelector('.voice-idle-prompt')) return;

    const lang = typeof currentLang !== 'undefined' ? currentLang : 'en';
    const t = (window.i18n && window.i18n[lang]) || {};

    const idle = document.createElement('div');
    idle.className = 'voice-idle-prompt animate__animated animate__fadeIn';
    idle.style.setProperty('--animate-duration', '0.4s');
    idle.innerHTML = `
      <div class="idle-illustration">
        <svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="32" cy="32" r="30" fill="var(--green-50)" stroke="var(--green-200)" stroke-width="2"/>
          <path d="M32 18C29.24 18 27 20.24 27 23V33C27 35.76 29.24 38 32 38C34.76 38 37 35.76 37 33V23C37 20.24 34.76 18 32 18Z" fill="var(--green-500)"/>
          <path d="M41 33C41 37.97 36.97 42 32 42C27.03 42 23 37.97 23 33H21C21 39.08 25.84 43.92 31 44.89V48H33V44.89C38.16 43.92 43 39.08 43 33H41Z" fill="var(--green-600)"/>
        </svg>
      </div>
      <div class="idle-title">${t.voice_tap_to_speak || 'Tap to speak'}</div>
      <div class="idle-subtitle">${t.voice_prompt_hint || 'Speak in Hindi or English, e.g.: "What is the paddy price in Raipur?"'}</div>
    `;
    container.appendChild(idle);
  }

  // ============================================================
  // TEST HARNESS
  // ============================================================

  /**
   * Dev/test helper: Renders a realistic Raipur APMC vs Neora APMC
   * paddy comparison using authentic data constraints.
   * Call from console: window.renderTestComparison()
   */
  function renderTestComparison() {
    const canvas = document.getElementById('voice-interactive-canvas');
    if (!canvas) {
      console.error('[KrishiTemplates] #voice-interactive-canvas not found. Are you on ai-help.html in voice mode?');
      return;
    }

    const testData = {
      template: 'two_way_comparison',
      left: {
        id: 'raipur_apmc',
        title: 'Raipur APMC',
        badge: 'Nearest',
        rows: [
          { label: 'Modal Price', value: '₹2,180 / qtl', highlight: true },
          { label: 'Distance', value: '12 km' },
          { label: 'Arrivals', value: '450 tonnes' },
          { label: 'Variety', value: 'Paddy (Common)' }
        ]
      },
      right: {
        id: 'neora_apmc',
        title: 'Neora APMC',
        badge: 'Best Rate',
        rows: [
          { label: 'Modal Price', value: '₹2,260 / qtl', highlight: true },
          { label: 'Distance', value: '38 km' },
          { label: 'Arrivals', value: '120 tonnes' },
          { label: 'Variety', value: 'Paddy (Common)' }
        ]
      },
      buttons: [
        { targetId: 'raipur_apmc', label: 'Select Raipur', voiceTurn: 'I choose Raipur Mandi' },
        { targetId: 'neora_apmc', label: 'Select Neora', voiceTurn: 'I choose Neora APMC' }
      ]
    };

    renderComparison(canvas, testData);
    console.log('[KrishiTemplates] Test comparison rendered. Click a card or button to test selection.');

    // Listen for selection
    document.addEventListener('krishi:template-action', function handler(e) {
      console.log('[KrishiTemplates] Selection event:', e.detail);
      document.removeEventListener('krishi:template-action', handler);
    });
  }

  // Export
  window.KrishiTemplates = window.KrishiTemplates || {};
  window.KrishiTemplates.renderComparison = renderComparison;
  window.KrishiTemplates.clearTemplate = clearTemplate;
  window.KrishiTemplates.restoreIdlePrompt = restoreIdlePrompt;
  window.renderTestComparison = renderTestComparison;

})(window);
