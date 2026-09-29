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
    try {
      if (!container || !data || !data.left || !data.right) {
        throw new Error('Invalid comparison data structure: missing left or right columns');
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

        // Symmetrically stagger header, rows, and buttons per column
        [leftCol, rightCol].forEach(col => {
          const h = col.querySelector('.tpl-card-header');
          if (h) {
            h.classList.add('animate__animated', 'animate__fadeInDown');
            h.style.setProperty('--animate-duration', '0.4s');
            h.style.animationDelay = '150ms';
          }

          col.querySelectorAll('.tpl-card-row').forEach((row, i) => {
            row.classList.add('animate__animated', 'animate__fadeInUp');
            row.style.setProperty('--animate-duration', '0.35s');
            row.style.animationDelay = `${200 + i * 60}ms`;
          });

          const btn = col.querySelector('.tpl-comparison-btn');
          if (btn) {
            btn.classList.add('animate__animated', 'animate__fadeIn');
            btn.style.setProperty('--animate-duration', '0.35s');
            btn.style.animationDelay = '450ms';
          }
        });
      });

      // Agentic UI Verification Handshake: Confirm TWO_WAY_COMPARISON mounted successfully
      if (window.KrishiVoice && typeof window.KrishiVoice.sendUIVerification === 'function') {
        window.KrishiVoice.sendUIVerification({
          status: 'success',
          view: 'TWO_WAY_COMPARISON',
          rendered_items: 2,
          commodity: data.commodity || data.left?.title,
          market_a: data.left?.title,
          market_b: data.right?.title
        });
      }
    } catch (err) {
      console.error('[KrishiTemplates] renderComparison error:', err);
      if (window.KrishiVoice && typeof window.KrishiVoice.sendUIVerification === 'function') {
        window.KrishiVoice.sendUIVerification({
          status: 'failed',
          view: 'TWO_WAY_COMPARISON',
          error: err.message || 'Comparison render failed',
          failed_template: 'two_way_comparison'
        });
      }
    }
  }

  /**
   * Return lightweight SVG icon for a data row based on label.
   */
  function getRowIconSvg(label) {
    const l = (label || '').toLowerCase();
    if (l.includes('price') || l.includes('rate') || l.includes('भाव') || l.includes('दर') || l.includes('modal')) {
      // Indian Rupee SVG
      return `<svg class="tpl-row-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12M6 8h12M6 13l8.5 8M6 13h3a4.5 4.5 0 0 0 0-9H6"/></svg>`;
    }
    if (l.includes('distance') || l.includes('दूरी') || l.includes('km')) {
      // Map pin SVG
      return `<svg class="tpl-row-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`;
    }
    if (l.includes('arrival') || l.includes('आवक') || l.includes('tonnes') || l.includes('qtl')) {
      // Delivery Truck SVG
      return `<svg class="tpl-row-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="3" width="14" height="13"/><polygon points="15 8 19 8 22 11 22 16 15 16 15 8"/><circle cx="5" cy="18.5" r="2.5"/><circle cx="18" cy="18.5" r="2.5"/></svg>`;
    }
    if (l.includes('variety') || l.includes('किस्म') || l.includes('crop')) {
      // Sprout / leaf SVG
      return `<svg class="tpl-row-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/></svg>`;
    }
    if (l.includes('date') || l.includes('दिनांक')) {
      // Calendar SVG
      return `<svg class="tpl-row-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`;
    }
    return '';
  }

  function escapeHtml(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
        const iconSvg = getRowIconSvg(rowData.label);
        if (iconSvg) {
          label.innerHTML = `${iconSvg}<span>${escapeHtml(rowData.label || '')}</span>`;
        } else {
          label.textContent = rowData.label || '';
        }

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

    function handleSelection(targetId, voicePayload, originEl, isVoiceChoice = false) {
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
          voicePayload: voicePayload || '',
          isVoiceChoice: !!isVoiceChoice
        },
        bubbles: true
      }));

      // If user selected by physical tap/click on screen, send choice to live voice assistant
      if (!isVoiceChoice && window.KrishiVoice && typeof window.KrishiVoice.sendSelection === 'function') {
        window.KrishiVoice.sendSelection(voicePayload || `I select ${targetId}`);
      }

      // Trigger Outro Animation after visual feedback
      setTimeout(() => {
        const leftCol = root.querySelector('.tpl-comparison-column[data-side="left"]');
        const rightCol = root.querySelector('.tpl-comparison-column[data-side="right"]');

        // Remove entrance animation classes from child cards to allow smooth column outro
        root.querySelectorAll('.animate__animated').forEach(el => {
          el.classList.remove('animate__backInLeft', 'animate__backInRight', 'animate__fadeInDownBig', 'animate__fadeInUp', 'animate__fadeIn');
        });

        if (leftCol) {
          leftCol.classList.add('animate__animated', 'animate__fadeOutLeft');
          leftCol.style.setProperty('--animate-duration', '0.5s');
        }
        if (rightCol) {
          rightCol.classList.add('animate__animated', 'animate__fadeOutRight');
          rightCol.style.setProperty('--animate-duration', '0.5s');
        }

        let cleanedUp = false;
        function cleanupAndRestore() {
          if (cleanedUp) return;
          cleanedUp = true;
          const container = root.parentElement;
          root.remove();
          if (container) {
            container.classList.remove('tpl-active');
            restoreIdlePrompt(container);
          }
        }

        if (leftCol) {
          leftCol.addEventListener('animationend', cleanupAndRestore, { once: true });
        }
        // Safety fallback timeout
        setTimeout(cleanupAndRestore, 600);
      }, 400);
    }

    root._handleSelection = handleSelection;

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

  /**
   * Manual Dev Trigger: Renders Raipur APMC vs Arang APMC
   * with authentic paddy prices (Raipur ₹3,000 vs Arang ₹2,200).
   * Call from console or DEV button: window.triggerTestComparison()
   */
  function triggerTestComparison() {
    // If not in voice mode, switch to voice mode first
    if (typeof window.setAIMode === 'function') {
      window.setAIMode('voice');
    }

    const canvas = document.getElementById('voice-interactive-canvas');
    if (!canvas) {
      console.error('[DEV HARNESS] #voice-interactive-canvas not found.');
      return;
    }

    const testData = {
      template: 'two_way_comparison',
      left: {
        id: 'raipur_apmc',
        title: 'Raipur APMC',
        badge: 'Best Rate',
        rows: [
          { label: 'Modal Price', value: '₹3,000 / qtl', highlight: true },
          { label: 'Distance', value: '12 km' },
          { label: 'Arrivals', value: '450 tonnes' },
          { label: 'Variety', value: 'Paddy (HMT)' }
        ]
      },
      right: {
        id: 'arang_apmc',
        title: 'Arang APMC',
        badge: 'Nearby',
        rows: [
          { label: 'Modal Price', value: '₹2,200 / qtl', highlight: true },
          { label: 'Distance', value: '34 km' },
          { label: 'Arrivals', value: '180 tonnes' },
          { label: 'Variety', value: 'Paddy (MTU-1010)' }
        ]
      },
      buttons: [
        { targetId: 'raipur_apmc', label: 'Select Raipur (₹3,000)', voiceTurn: 'I choose Raipur Mandi at ₹3000' },
        { targetId: 'arang_apmc', label: 'Select Arang (₹2,200)', voiceTurn: 'I choose Arang Mandi at ₹2200' }
      ]
    };

    renderComparison(canvas, testData);
    console.log('[DEV HARNESS] triggerTestComparison executed: Raipur APMC vs Arang APMC');

    // Also populate transcript with model turn
    const transcriptCard = document.getElementById('voice-transcript-card');
    if (transcriptCard) {
      const placeholder = transcriptCard.querySelector('em');
      if (placeholder && placeholder.parentElement) {
        placeholder.parentElement.remove();
      }
      const modelTurn = document.createElement('div');
      modelTurn.className = 'transcript-row model';
      modelTurn.textContent = '🤖 Raipur APMC is offering ₹3,000/qtl for Paddy (HMT). Arang APMC is at ₹2,200/qtl. Raipur has the better rate.';
      transcriptCard.appendChild(modelTurn);
      transcriptCard.scrollTop = transcriptCard.scrollHeight;
    }
  }

  /**
   * Programmatic selection helper for voice intent matching.
   */
  function selectOption(targetIdOrQuery) {
    const root = document.querySelector('.tpl-comparison-container');
    if (!root) return false;

    const cards = root.querySelectorAll('.tpl-comparison-card');
    if (!cards || cards.length === 0) return false;

    const query = String(targetIdOrQuery || '').trim().toLowerCase();
    let matchedCard = null;

    if (query === '1' || query === 'left' || query.includes('option 1') || query.includes('first') || query.includes('पहला') || query.includes('one')) {
      matchedCard = cards[0];
    } else if (query === '2' || query === 'right' || query.includes('option 2') || query.includes('second') || query.includes('दूसरा') || query.includes('two')) {
      matchedCard = cards[1] || cards[0];
    } else {
      for (const card of cards) {
        const id = (card.dataset.id || '').toLowerCase();
        const title = (card.querySelector('.tpl-card-title')?.textContent || '').toLowerCase();
        if (id.includes(query) || title.includes(query) || query.includes(id) || (title && query.includes(title.replace(/\s+apmc$/i, '')))) {
          matchedCard = card;
          break;
        }
      }
    }

    if (matchedCard) {
      const targetId = matchedCard.dataset.id;
      const matchingBtn = root.querySelector(`.tpl-comparison-btn[data-target-id="${targetId}"]`);
      const voiceTurn = matchingBtn ? matchingBtn.dataset.voiceTurn : '';
      if (typeof root._handleSelection === 'function') {
        root._handleSelection(targetId, voiceTurn, matchedCard, true);
        return true;
      } else {
        matchedCard.click();
        return true;
      }
    }

    return false;
  }

  /**
   * Voice-Triggered Outro / Template Dismissal Tool handler (close_ui_template).
   * 1. Applies active highlight (.selected) to chosen card & .dimmed to other.
   * 2. Waits 400ms.
   * 3. Applies animate__fadeOutLeft to left card and animate__fadeOutRight to right card.
   * 4. On animationend, safely unmounts template and restores idle "Tap to speak" state.
   */
  function closeTemplate(templateName, selectedOptionId) {
    const root = document.querySelector('.tpl-comparison-container');
    if (!root) return false;

    const cards = root.querySelectorAll('.tpl-comparison-card');
    if (!cards || cards.length === 0) return false;

    const query = String(selectedOptionId || '').trim().toLowerCase();
    let matchedCard = null;

    if (query === '1' || query === 'left' || query.includes('option 1') || query.includes('first') || query.includes('पहला') || query.includes('closest') || query.includes('cheapest') || query.includes('best') || query.includes('one')) {
      matchedCard = cards[0];
    } else if (query === '2' || query === 'right' || query.includes('option 2') || query.includes('second') || query.includes('दूसरा') || query.includes('two')) {
      matchedCard = cards[1] || cards[0];
    } else {
      for (const card of cards) {
        const id = (card.dataset.id || '').toLowerCase();
        const title = (card.querySelector('.tpl-card-title')?.textContent || '').toLowerCase();
        if (id.includes(query) || title.includes(query) || query.includes(id) || (title && query.includes(title.replace(/\s+apmc$/i, '')))) {
          matchedCard = card;
          break;
        }
      }
      if (!matchedCard) matchedCard = cards[0];
    }

    // 1. Briefly apply active highlight (green border) to the selected card
    cards.forEach(card => {
      if (card === matchedCard) {
        card.classList.add('selected');
        card.classList.remove('dimmed');
      } else {
        card.classList.add('dimmed');
        card.classList.remove('selected');
      }
    });

    // Disable buttons
    root.querySelectorAll('.tpl-comparison-btn').forEach(btn => {
      btn.disabled = true;
    });

    // 2. Wait 400ms
    setTimeout(() => {
      const leftCol = root.querySelector('.tpl-comparison-column[data-side="left"]');
      const rightCol = root.querySelector('.tpl-comparison-column[data-side="right"]');

      // Remove entrance animation classes to allow clean outro
      root.querySelectorAll('.animate__animated').forEach(el => {
        el.classList.remove('animate__backInLeft', 'animate__backInRight', 'animate__fadeInDownBig', 'animate__fadeInUp', 'animate__fadeIn');
      });

      // 3. Apply animate__fadeOutLeft to left card and animate__fadeOutRight to right card
      if (leftCol) {
        leftCol.classList.add('animate__animated', 'animate__fadeOutLeft');
        leftCol.style.setProperty('--animate-duration', '0.5s');
      }
      if (rightCol) {
        rightCol.classList.add('animate__animated', 'animate__fadeOutRight');
        rightCol.style.setProperty('--animate-duration', '0.5s');
      }

      // 4. On animationend, safely unmount and restore idle "Tap to speak" state
      let cleanedUp = false;
      function cleanupAndRestore() {
        if (cleanedUp) return;
        cleanedUp = true;
        const container = root.parentElement;
        root.remove();
        if (container) {
          container.classList.remove('tpl-active');
          restoreIdlePrompt(container);
        }
      }

      if (leftCol) {
        leftCol.addEventListener('animationend', cleanupAndRestore, { once: true });
      }
      setTimeout(cleanupAndRestore, 650);
    }, 400);

    return true;
  }

  // Export
  window.KrishiTemplates = window.KrishiTemplates || {};
  window.KrishiTemplates.renderComparison = renderComparison;
  window.KrishiTemplates.clearTemplate = clearTemplate;
  window.KrishiTemplates.restoreIdlePrompt = restoreIdlePrompt;
  window.KrishiTemplates.selectOption = selectOption;
  window.KrishiTemplates.closeTemplate = closeTemplate;
  window.renderTestComparison = renderTestComparison;
  window.triggerTestComparison = triggerTestComparison;
  window.KrishiTemplates.triggerTestComparison = triggerTestComparison;

})(window);
