/**
 * ============================================================
 * Krishi Mitra — ai-help.js
 * Production AI Assistant Controller:
 * 1. Upfront 50/50 Mode Selection Screen (Chat vs Voice)
 * 2. Progressive Streaming Text Chat (/api/chat/stream)
 * 3. Live Bidirectional Voice UI (wrapping unmodified voice.js)
 * 4. Multi-Tenant Isolated Session History (/api/sessions)
 * 5. Full Mode-Switch Connection Teardown & Cleanup
 * ============================================================
 */

(function (window) {
  'use strict';

  // State
  let currentMode = null; // 'chat' | 'voice' | null (mode-select)
  let activeSessionId = null;
  let activeBotBubble = null;
  let activeBotTextSpan = null;
  let activeCursorSpan = null;
  let activeStatusSpan = null;
  let accumulatedStreamText = '';
  let currentVoiceTurn = { role: null, element: null, text: '' };

  // DOM Elements (cached after DOMContentLoaded)
  let viewModeSelect, viewChat, viewVoice;
  let aiModeBar, modeBtnChat, modeBtnVoice, btnHistory, btnNewConvo;
  let chatMessages, chatInput, btnSendChat;
  let voiceOrbWrap, voiceMainBtn, voiceMuteBtn, voiceStatusPill, voiceHintText, voiceToolIndicator, voiceTranscriptCard, voiceErrorCard, btnVoiceRetry;
  let voiceInteractiveCanvas, voiceMicStrip, headerBackBtn;
  let historyDrawer, drawerBackdrop, historyList, btnCloseDrawer, btnDrawerNewConvo;

  function initDOMElements() {
    viewModeSelect = document.getElementById('view-mode-select');
    viewChat = document.getElementById('view-chat');
    viewVoice = document.getElementById('view-voice');

    aiModeBar = document.getElementById('ai-mode-bar');
    modeBtnChat = document.getElementById('mode-btn-chat');
    modeBtnVoice = document.getElementById('mode-btn-voice');
    btnHistory = document.getElementById('btn-history');
    btnNewConvo = document.getElementById('btn-new-convo');

    chatMessages = document.getElementById('chat-messages');
    chatInput = document.getElementById('chat-input');
    btnSendChat = document.getElementById('btn-send-chat');

    voiceInteractiveCanvas = document.getElementById('voice-interactive-canvas');
    voiceMicStrip = document.getElementById('voice-mic-strip');
    voiceOrbWrap = document.getElementById('voice-orb-wrap');
    voiceMainBtn = document.getElementById('voice-main-btn');
    voiceMuteBtn = document.getElementById('voice-mute-btn');
    voiceStatusPill = document.getElementById('voice-status-pill');
    voiceHintText = document.getElementById('voice-hint-text');
    voiceToolIndicator = document.getElementById('voice-tool-indicator');
    voiceTranscriptCard = document.getElementById('voice-transcript-card');
    voiceErrorCard = document.getElementById('voice-error-card');
    btnVoiceRetry = document.getElementById('btn-voice-retry');

    headerBackBtn = document.getElementById('header-back-btn') || document.querySelector('.header-bar .back-btn');

    historyDrawer = document.getElementById('history-drawer');
    drawerBackdrop = document.getElementById('drawer-backdrop');
    historyList = document.getElementById('history-list');
    btnCloseDrawer = document.getElementById('btn-close-drawer');
    btnDrawerNewConvo = document.getElementById('btn-drawer-new');
  }

  // --- Helper: Format Timestamp in Asia/Kolkata ---
  function formatIST(isoStr) {
    if (!isoStr) return '';
    try {
      const d = new Date(isoStr);
      return d.toLocaleString(typeof currentLang !== 'undefined' && currentLang === 'hi' ? 'hi-IN' : 'en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      });
    } catch (e) {
      return isoStr;
    }
  }

  // --- Helper: Get Current User Profile & Location ---
  function getUserContext() {
    const lang = typeof currentLang !== 'undefined' ? currentLang : 'hi';
    let location = {};

    // Check shared session GPS state from KrishiLocation (never triggers a new prompt)
    if (window.KrishiLocation && typeof window.KrishiLocation.getGpsSession === 'function') {
      const gps = window.KrishiLocation.getGpsSession();
      if (gps && gps.state === 'granted' && gps.coords) {
        const admin = (typeof window.KrishiLocation.getLocation === 'function')
          ? window.KrishiLocation.getLocation()
          : {};
        const userAddress = (typeof window.KrishiLocation.getUserAddress === 'function')
          ? window.KrishiLocation.getUserAddress()
          : null;
        location = {
          lat: gps.coords.lat,
          lng: gps.coords.lng,
          state: admin.state || 'Chhattisgarh',
          district: admin.district || 'Raipur',
          address: userAddress
        };
      } else {
        // If denied/unavailable/timeout, degrade gracefully and omit location context
        const userAddress = (typeof window.KrishiLocation?.getUserAddress === 'function')
          ? window.KrishiLocation.getUserAddress()
          : null;
        location = userAddress ? { address: userAddress } : {};
      }
    } else {
      location = {};
    }

    let profile = {};
    try {
      const raw = localStorage.getItem('farmerProfile');
      if (raw) profile = JSON.parse(raw);
    } catch (e) {}

    return { lang, location, profile };
  }

  // ============================================================
  // 1. MODE MANAGEMENT & CLEANUP ON SWITCH
  // ============================================================

  function exitVoiceMode() {
    if (window.KrishiVoice && window.KrishiVoice.isRunning()) {
      window.KrishiVoice.stop();
    }
    resetVoiceUI();
    document.body.classList.remove('voice-mode-active');
    if (window.KrishiTemplates && typeof window.KrishiTemplates.clearTemplate === 'function') {
      window.KrishiTemplates.clearTemplate(voiceInteractiveCanvas);
    }
    setMode(null);
  }

  function setMode(newMode) {
    if (currentMode === newMode) return;

    // --- Cleanup Current Mode Connections ---
    if (currentMode === 'voice') {
      // Teardown Live Voice connection completely
      if (window.KrishiVoice && window.KrishiVoice.isRunning()) {
        window.KrishiVoice.stop();
      }
      resetVoiceUI();
      document.body.classList.remove('voice-mode-active');
      if (window.KrishiTemplates && typeof window.KrishiTemplates.clearTemplate === 'function') {
        window.KrishiTemplates.clearTemplate(voiceInteractiveCanvas);
      }
    } else if (currentMode === 'chat') {
      // Abort in-flight streaming fetch
      if (window.KrishiChat) {
        window.KrishiChat.abortInFlightChat();
      }
      finishActiveStreaming();
    }

    currentMode = newMode;
    try {
      if (newMode) sessionStorage.setItem('krishi_ai_mode', newMode);
      else sessionStorage.removeItem('krishi_ai_mode');
    } catch (e) {}

    // --- Update Views ---
    if (!newMode) {
      // Show upfront mode choice screen
      document.body.classList.remove('voice-mode-active');
      if (viewModeSelect) viewModeSelect.classList.add('active');
      if (viewChat) viewChat.classList.remove('active');
      if (viewVoice) viewVoice.classList.remove('active');
      if (aiModeBar) aiModeBar.style.display = 'none';
    } else if (newMode === 'chat') {
      document.body.classList.remove('voice-mode-active');
      if (viewModeSelect) viewModeSelect.classList.remove('active');
      if (viewChat) viewChat.classList.add('active');
      if (viewVoice) viewVoice.classList.remove('active');
      if (aiModeBar) aiModeBar.style.display = 'flex';
      if (modeBtnChat) modeBtnChat.classList.add('active');
      if (modeBtnVoice) modeBtnVoice.classList.remove('active');
      if (chatInput) chatInput.focus();
    } else if (newMode === 'voice') {
      document.body.classList.add('voice-mode-active');
      if (viewModeSelect) viewModeSelect.classList.remove('active');
      if (viewChat) viewChat.classList.remove('active');
      if (viewVoice) viewVoice.classList.add('active');
      if (aiModeBar) aiModeBar.style.display = 'none'; // Distraction-free voice
      if (modeBtnChat) modeBtnChat.classList.remove('active');
      if (modeBtnVoice) modeBtnVoice.classList.add('active');

      try {
        if (!history.state || history.state.mode !== 'voice') {
          history.pushState({ mode: 'voice' }, '');
        }
      } catch (e) {}

      // Restore idle prompt if canvas is empty
      if (voiceInteractiveCanvas && !voiceInteractiveCanvas.querySelector('.tpl-comparison-container')) {
        if (window.KrishiTemplates && typeof window.KrishiTemplates.restoreIdlePrompt === 'function') {
          voiceInteractiveCanvas.innerHTML = '';
          window.KrishiTemplates.restoreIdlePrompt(voiceInteractiveCanvas);
        }
      }

      if (window.isSecureContext === false) {
        showInsecureContextWarning();
      }
    }
  }

  // ============================================================
  // 2. TEXT CHAT CONTROLLER
  // ============================================================

  function appendUserBubble(text) {
    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble user';
    bubble.textContent = text;
    chatMessages.appendChild(bubble);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function startBotBubble() {
    accumulatedStreamText = '';

    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble bot';

    const header = document.createElement('div');
    header.className = 'bot-label';
    header.innerHTML = '<span>🤖 ' + ((window.i18n && i18n[currentLang].ai_assistant) || 'Krishi AI') + '</span>';
    bubble.appendChild(header);

    const textSpan = document.createElement('span');
    textSpan.className = 'bot-content';
    bubble.appendChild(textSpan);

    const cursorSpan = document.createElement('span');
    cursorSpan.className = 'streaming-cursor';
    bubble.appendChild(cursorSpan);

    const statusSpan = document.createElement('div');
    statusSpan.className = 'inline-tool-status';
    statusSpan.style.display = 'none';
    bubble.appendChild(statusSpan);

    chatMessages.appendChild(bubble);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    activeBotBubble = bubble;
    activeBotTextSpan = textSpan;
    activeCursorSpan = cursorSpan;
    activeStatusSpan = statusSpan;
  }

  function updateBotStream(token) {
    if (!activeBotTextSpan) return;
    accumulatedStreamText += token;
    activeBotTextSpan.innerHTML = window.KrishiChat.formatMarkdown(accumulatedStreamText);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function setBotToolStatus(statusText) {
    if (!activeStatusSpan) return;
    if (statusText) {
      activeStatusSpan.textContent = '⏳ ' + statusText;
      activeStatusSpan.style.display = 'inline-flex';
    } else {
      activeStatusSpan.style.display = 'none';
    }
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function renderInlineSources(sources) {
    if (!activeBotBubble || !Array.isArray(sources) || sources.length === 0) return;

    const sourcesWrap = document.createElement('div');
    sourcesWrap.className = 'chat-sources-block';

    const title = document.createElement('div');
    title.className = 'chat-sources-title';
    title.innerHTML = '📊 ' + ((window.i18n && i18n[currentLang].sources_label) || 'Source Mandis') + ':';
    sourcesWrap.appendChild(title);

    const grid = document.createElement('div');
    grid.className = 'chat-sources-grid';

    let hasOtherState = false;

    sources.forEach((s) => {
      const item = document.createElement('div');
      item.className = 'source-item';

      const left = document.createElement('div');
      left.className = 'source-left';

      let scopeClass = 'raipur';
      let scopeText = (window.i18n && i18n[currentLang].tier1_badge) || 'Raipur';

      if (s.scope === 'chhattisgarh') {
        scopeClass = 'cg';
        scopeText = s.district || 'CG';
      } else if (s.scope === 'other_state') {
        scopeClass = 'other_state';
        scopeText = s.state || 'Other State';
        hasOtherState = true;
      }

      left.innerHTML = `<span>${s.market || 'Mandi'}</span> <span class="source-scope-badge ${scopeClass}">${scopeText}</span>`;

      const right = document.createElement('div');
      right.className = 'source-price';
      right.textContent = s.price ? `₹${s.price}/q` : '';

      item.appendChild(left);
      item.appendChild(right);
      grid.appendChild(item);
    });

    sourcesWrap.appendChild(grid);

    // If out-of-state prices are present, render transport warning
    if (hasOtherState) {
      const warn = document.createElement('div');
      warn.className = 'chat-transport-warning';
      const warnTitle = (window.i18n && i18n[currentLang].transport_warning_title) || '⚠️ Note: Inter-State Prices';
      const warnText = (window.i18n && i18n[currentLang].transport_warning_text) || 'Prices are from neighboring states. Transportation and market costs may apply.';
      warn.innerHTML = `<strong>${warnTitle}</strong><br>${warnText}`;
      sourcesWrap.appendChild(warn);
    }

    activeBotBubble.appendChild(sourcesWrap);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function finishActiveStreaming() {
    if (activeCursorSpan) {
      activeCursorSpan.remove();
      activeCursorSpan = null;
    }
    if (activeStatusSpan) {
      activeStatusSpan.remove();
      activeStatusSpan = null;
    }
    activeBotBubble = null;
    activeBotTextSpan = null;
    if (btnSendChat) btnSendChat.disabled = false;
  }

  async function sendChatMessage(query) {
    const text = (query || (chatInput && chatInput.value) || '').trim();
    if (!text) return;

    if (chatInput) chatInput.value = '';
    if (btnSendChat) btnSendChat.disabled = true;

    appendUserBubble(text);
    startBotBubble();

    const { lang, location, profile } = getUserContext();

    await window.KrishiChat.sendStreamingMessage({
      message: text,
      sessionId: activeSessionId,
      language: lang,
      location,
      profile,
      onSession: (id) => {
        activeSessionId = id;
      },
      onToken: (token) => {
        updateBotStream(token);
      },
      onStatus: (statusText) => {
        setBotToolStatus(statusText);
      },
      onSources: (sources) => {
        setBotToolStatus('');
        renderInlineSources(sources);
      },
      onDone: () => {
        finishActiveStreaming();
      },
      onError: (err) => {
        if (activeBotTextSpan) {
          activeBotTextSpan.innerHTML += `<br><span style="color:var(--red-500);">⚠️ ${err.message || 'Error'}</span>`;
        }
        finishActiveStreaming();
      },
      onAbort: () => {
        finishActiveStreaming();
      }
    });
  }

  // ============================================================
  // 3. LIVE VOICE CONTROLLER
  // ============================================================

  const MIC_SVG_PATH = '<path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/><path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>';
  const STOP_SVG_PATH = '<rect x="6" y="6" width="12" height="12" rx="2"/>';

  function setMicButtonState(state) {
    if (!voiceMainBtn) return;
    voiceMainBtn.classList.remove('state-idle', 'state-listening', 'state-processing', 'state-speaking', 'state-error');
    voiceMainBtn.classList.add(`state-${state}`);

    const isRunning = window.KrishiVoice && window.KrishiVoice.isRunning();
    const svg = voiceMainBtn.querySelector('svg');
    if (isRunning) {
      voiceMainBtn.classList.add('active-call');
      if (svg) svg.innerHTML = STOP_SVG_PATH;
    } else {
      voiceMainBtn.classList.remove('active-call');
      if (svg) svg.innerHTML = MIC_SVG_PATH;
    }
  }

  function resetVoiceUI() {
    currentVoiceTurn = { role: null, element: null, text: '' };
    if (voiceStatusPill) {
      voiceStatusPill.className = 'voice-status-pill';
      voiceStatusPill.textContent = (window.i18n && i18n[currentLang].voice_tap_to_speak) || 'Tap to speak';
    }
    setMicButtonState('idle');
    if (voiceMuteBtn) {
      voiceMuteBtn.style.display = 'none';
      voiceMuteBtn.classList.remove('muted');
      voiceMuteBtn.innerHTML = '<span>🔇</span> <span>' + ((window.i18n && i18n[currentLang].voice_mute) || 'Mute') + '</span>';
    }
    if (voiceToolIndicator) {
      voiceToolIndicator.textContent = '';
    }
    if (voiceErrorCard) {
      voiceErrorCard.classList.remove('visible');
    }
    if (btnVoiceRetry) {
      btnVoiceRetry.style.display = 'inline-block';
    }
    if (voiceOrbWrap) {
      voiceOrbWrap.style.setProperty('--rms-scale', '1');
    }
  }

  function showInsecureContextWarning() {
    resetVoiceUI();
    if (voiceErrorCard) {
      voiceErrorCard.classList.add('visible');
      const errSpan = voiceErrorCard.querySelector('.voice-error-text');
      if (errSpan) {
        errSpan.textContent = (window.i18n && i18n[currentLang].voice_insecure_context_error) ||
          "🔒 Voice requires a secure (HTTPS) connection. If you're accessing this over Tailscale, use your Tailscale Serve HTTPS URL instead of the raw IP address.";
      }
      if (btnVoiceRetry) {
        btnVoiceRetry.style.display = 'none';
      }
    }
  }

  function handleVoiceTranscript(t) {
    if (!voiceTranscriptCard) return;

    // Turn complete signal or empty finalizer
    if (t.isFinal && !t.text) {
      currentVoiceTurn = { role: null, element: null, text: '' };
      return;
    }

    if (!t.text) return;

    // Remove placeholder on first real transcript
    const placeholder = voiceTranscriptCard.querySelector('em');
    if (placeholder && placeholder.parentElement) {
      placeholder.parentElement.remove();
    }

    const isUser = t.role === 'user';
    const roleClass = isUser ? 'user' : 'model';
    const prefix = isUser ? '👤 ' : '🤖 ';

    if (currentVoiceTurn.role === t.role && currentVoiceTurn.element) {
      // Continuation of existing turn: append to active block
      currentVoiceTurn.text += t.text;
      currentVoiceTurn.element.textContent = prefix + currentVoiceTurn.text;
    } else {
      // New speaker or new turn: create a single new block
      const row = document.createElement('div');
      row.className = `transcript-row ${roleClass}`;
      currentVoiceTurn = {
        role: t.role,
        element: row,
        text: t.text
      };
      row.textContent = prefix + currentVoiceTurn.text;
      voiceTranscriptCard.appendChild(row);
    }

    if (t.isFinal) {
      currentVoiceTurn = { role: null, element: null, text: '' };
    }

    voiceTranscriptCard.scrollTop = voiceTranscriptCard.scrollHeight;
  }

  async function startVoiceCall() {
    if (!window.KrishiVoice) return;
    if (window.KrishiVoice.isRunning()) {
      window.KrishiVoice.stop();
      resetVoiceUI();
      return;
    }

    const isSecureContext = window.isSecureContext;
    if (isSecureContext === false) {
      showInsecureContextWarning();
      return;
    }

    resetVoiceUI();
    setMicButtonState('processing');
    if (voiceStatusPill) {
      voiceStatusPill.className = 'voice-status-pill connecting';
      voiceStatusPill.textContent = (window.i18n && i18n[currentLang].voice_connecting) || 'Connecting...';
    }
    if (voiceMainBtn) {
      voiceMainBtn.classList.add('active-call');
      const svg = voiceMainBtn.querySelector('svg');
      if (svg) svg.innerHTML = STOP_SVG_PATH;
    }
    if (voiceMuteBtn) {
      voiceMuteBtn.style.display = 'inline-flex';
    }

    const { lang, location, profile } = getUserContext();
    const clientId = window.KrishiChat.getClientId();

    try {
      await window.KrishiVoice.start({
        clientId,
        sessionId: activeSessionId,
        language: lang,
        location,
        profile,
        onState: (state) => {
          if (!voiceStatusPill) return;
          if (state === 'connecting') {
            setMicButtonState('processing');
            voiceStatusPill.className = 'voice-status-pill connecting';
            voiceStatusPill.textContent = (window.i18n && i18n[currentLang].voice_connecting) || 'Connecting...';
          } else if (state === 'online') {
            setMicButtonState('listening');
            voiceStatusPill.className = 'voice-status-pill listening';
            voiceStatusPill.textContent = (window.i18n && i18n[currentLang].voice_state_connected) || 'Connected';
          } else if (state === 'listening') {
            setMicButtonState('listening');
            voiceStatusPill.className = 'voice-status-pill listening';
            voiceStatusPill.textContent = (window.i18n && i18n[currentLang].voice_listening) || 'Listening...';
          } else if (state === 'speaking') {
            setMicButtonState('speaking');
            voiceStatusPill.className = 'voice-status-pill speaking';
            voiceStatusPill.textContent = (window.i18n && i18n[currentLang].voice_speaking) || 'AI is speaking...';
          } else if (state === 'interrupted') {
            currentVoiceTurn = { role: null, element: null, text: '' };
            setMicButtonState('listening');
            voiceStatusPill.className = 'voice-status-pill interrupted';
            voiceStatusPill.textContent = (window.i18n && i18n[currentLang].voice_state_interrupted) || 'Interrupted';
          } else if (state === 'offline') {
            resetVoiceUI();
          }
        },
        onTranscript: (t) => {
          handleVoiceTranscript(t);
        },
        onToolStatus: (tool) => {
          if (!voiceToolIndicator) return;
          if (tool.status === 'running') {
            setMicButtonState('processing');
            voiceToolIndicator.textContent = '⏳ ' + ((window.i18n && i18n[currentLang].checking_prices) || 'Checking mandi prices...');
          } else {
            voiceToolIndicator.textContent = '';
            setMicButtonState('speaking');
          }
        },
        onVisualizer: (rms) => {
          if (!voiceOrbWrap) return;
          // Scale smoothly between 1.0 and 1.8 based on mic RMS energy
          const scale = Math.min(1.8, 1.0 + rms * 7.0);
          voiceOrbWrap.style.setProperty('--rms-scale', scale.toFixed(3));
        },
        onError: (err) => {
          resetVoiceUI();
          setMicButtonState('error');
          if (voiceStatusPill) {
            voiceStatusPill.className = 'voice-status-pill error';
            voiceStatusPill.textContent = (window.i18n && i18n[currentLang].voice_state_error) || 'Error';
          }
          if (voiceErrorCard) {
            voiceErrorCard.classList.add('visible');
            const errSpan = voiceErrorCard.querySelector('.voice-error-text');
            if (errSpan) {
              const isNotAllowed = err.name === 'NotAllowedError' || (err.message && err.message.includes('Permission'));
              errSpan.textContent = isNotAllowed
                ? ((window.i18n && i18n[currentLang].voice_mic_permission_error) || 'Microphone access denied. Please allow microphone in browser.')
                : ((window.i18n && i18n[currentLang].voice_connection_error) || 'Connection error. Please retry.');
            }
          }
        }
      });
    } catch (e) {
      resetVoiceUI();
    }
  }

  function toggleVoiceMute() {
    if (!window.KrishiVoice) return;
    const muted = window.KrishiVoice.mute();
    if (voiceMuteBtn) {
      if (muted) {
        voiceMuteBtn.classList.add('muted');
        voiceMuteBtn.innerHTML = '<span>🔊</span> <span>' + ((window.i18n && i18n[currentLang].voice_unmute) || 'Unmute') + '</span>';
      } else {
        voiceMuteBtn.classList.remove('muted');
        voiceMuteBtn.innerHTML = '<span>🔇</span> <span>' + ((window.i18n && i18n[currentLang].voice_mute) || 'Mute') + '</span>';
      }
    }
  }

  // ============================================================
  // 4. SESSION HISTORY DRAWER
  // ============================================================

  async function openHistoryDrawer() {
    if (!historyDrawer || !drawerBackdrop) return;
    historyDrawer.classList.add('open');
    drawerBackdrop.classList.add('open');
    renderHistoryList();
  }

  function closeHistoryDrawer() {
    if (!historyDrawer || !drawerBackdrop) return;
    historyDrawer.classList.remove('open');
    drawerBackdrop.classList.remove('open');
  }

  async function renderHistoryList() {
    if (!historyList) return;
    historyList.innerHTML = `<div style="text-align:center;padding:20px;color:var(--gray-500);">⏳ ${i18n[currentLang].resuming_session || 'Loading...'}</div>`;

    try {
      const sessions = await window.KrishiChat.fetchSessions();
      if (!sessions || sessions.length === 0) {
        historyList.innerHTML = `<div class="history-empty-msg">📭 ${(window.i18n && i18n[currentLang].no_history) || 'No past conversations'}</div>`;
        return;
      }

      historyList.innerHTML = '';
      sessions.forEach((s) => {
        const item = document.createElement('div');
        item.className = 'history-item';
        if (s.id === activeSessionId) {
          item.classList.add('active-session');
        }

        const modeIcon = s.mode === 'voice' ? '🎙️' : '💬';
        const formattedDate = formatIST(s.updated_at || s.created_at);

        item.innerHTML = `
          <div class="history-item-left">
            <div class="history-item-title">${modeIcon} ${s.title || (s.mode === 'voice' ? 'Voice Session' : 'Chat')}</div>
            <div class="history-item-meta">
              <span>${formattedDate}</span>
              ${s.id === activeSessionId ? `<span style="color:var(--green-700);font-weight:700;">• ${i18n[currentLang].active_session_label || 'Active'}</span>` : ''}
            </div>
          </div>
          <button class="history-delete-btn" title="Delete">🗑️</button>
        `;

        // Click to resume session
        item.querySelector('.history-item-left').onclick = () => {
          resumeSession(s);
        };

        // Delete session
        item.querySelector('.history-delete-btn').onclick = async (e) => {
          e.stopPropagation();
          const confirmMsg = (window.i18n && i18n[currentLang].delete_session_confirm) || 'Delete this conversation?';
          if (confirm(confirmMsg)) {
            await window.KrishiChat.deleteSession(s.id);
            if (activeSessionId === s.id) {
              startNewSession();
            }
            renderHistoryList();
          }
        };

        historyList.appendChild(item);
      });
    } catch (err) {
      historyList.innerHTML = `<div class="history-empty-msg" style="color:var(--red-500);">⚠️ ${err.message}</div>`;
    }
  }

  async function resumeSession(session) {
    closeHistoryDrawer();
    activeSessionId = session.id;

    if (session.mode === 'voice') {
      setMode('voice');
      // Fetch details and populate transcript
      try {
        const data = await window.KrishiChat.fetchSessionDetails(session.id);
        if (voiceTranscriptCard && data.messages) {
          voiceTranscriptCard.innerHTML = '';
          data.messages.forEach((m) => {
            const row = document.createElement('div');
            row.className = `transcript-row ${m.role === 'user' ? 'user' : 'model'}`;
            row.textContent = (m.role === 'user' ? '👤 ' : '🤖 ') + m.content;
            voiceTranscriptCard.appendChild(row);
          });
          voiceTranscriptCard.scrollTop = voiceTranscriptCard.scrollHeight;
        }
      } catch (e) {}
    } else {
      setMode('chat');
      // Fetch details and populate chat messages
      try {
        const data = await window.KrishiChat.fetchSessionDetails(session.id);
        if (chatMessages && data.messages) {
          chatMessages.innerHTML = '';
          data.messages.forEach((m) => {
            if (m.role === 'user') {
              appendUserBubble(m.content);
            } else {
              startBotBubble();
              if (activeBotTextSpan) {
                activeBotTextSpan.innerHTML = window.KrishiChat.formatMarkdown(m.content);
              }
              if (m.sources) {
                renderInlineSources(m.sources);
              }
              finishActiveStreaming();
            }
          });
        }
      } catch (e) {}
    }
  }

  function startNewSession() {
    activeSessionId = null;
    closeHistoryDrawer();

    if (currentMode === 'chat') {
      if (chatMessages) {
        chatMessages.innerHTML = `
          <div class="chat-bubble bot">
            <div class="bot-label">🤖 <span>${(window.i18n && i18n[currentLang].ai_assistant) || 'Krishi AI'}</span></div>
            <span>${(window.i18n && i18n[currentLang].ai_welcome) || 'Namaste! Ask me anything about crop prices, market trends, or selling advice.'}</span>
          </div>
        `;
      }
    } else if (currentMode === 'voice') {
      if (window.KrishiVoice && window.KrishiVoice.isRunning()) {
        window.KrishiVoice.stop();
      }
      resetVoiceUI();
      if (voiceTranscriptCard) voiceTranscriptCard.innerHTML = '';
      if (voiceInteractiveCanvas && window.KrishiTemplates && typeof window.KrishiTemplates.restoreIdlePrompt === 'function') {
        voiceInteractiveCanvas.innerHTML = '';
        window.KrishiTemplates.restoreIdlePrompt(voiceInteractiveCanvas);
      }
    }
  }

  // ============================================================
  // 5. EVENT BINDINGS & INIT
  // ============================================================

  function bindEvents() {
    // Header back button with mode-aware navigation
    if (headerBackBtn) {
      headerBackBtn.onclick = (e) => {
        e.preventDefault();
        if (currentMode === 'voice') {
          exitVoiceMode();
        } else if (currentMode === 'chat') {
          setMode(null);
        } else {
          window.location.href = 'home.html';
        }
      };
    }

    // Android hardware back / browser history navigation
    window.addEventListener('popstate', (e) => {
      if (currentMode === 'voice') {
        exitVoiceMode();
      } else if (currentMode === 'chat') {
        setMode(null);
      }
    });

    // Listen to template action custom events (fire-and-forget from templates)
    document.addEventListener('krishi:template-action', (e) => {
      console.log('[KrishiAI] Template action received:', e.detail);
      if (e.detail && e.detail.voicePayload) {
        handleVoiceTranscript({
          role: 'user',
          text: e.detail.voicePayload,
          isFinal: true
        });
      }
    });

    // Mode selection card clicks
    const cardChat = document.getElementById('card-select-chat');
    const cardVoice = document.getElementById('card-select-voice');
    const btnHistoryAccess = document.getElementById('btn-history-access');

    if (cardChat) cardChat.onclick = () => setMode('chat');
    if (cardVoice) cardVoice.onclick = () => setMode('voice');
    if (btnHistoryAccess) btnHistoryAccess.onclick = () => openHistoryDrawer();

    // Mode bar switcher buttons
    if (modeBtnChat) modeBtnChat.onclick = () => setMode('chat');
    if (modeBtnVoice) modeBtnVoice.onclick = () => setMode('voice');
    if (btnHistory) btnHistory.onclick = () => openHistoryDrawer();
    if (btnNewConvo) btnNewConvo.onclick = () => startNewSession();

    // Chat input triggers
    if (btnSendChat) btnSendChat.onclick = () => sendChatMessage();
    if (chatInput) {
      chatInput.onkeydown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          sendChatMessage();
        }
      };
    }

    // Voice triggers
    if (voiceMainBtn) voiceMainBtn.onclick = () => startVoiceCall();
    if (voiceMuteBtn) voiceMuteBtn.onclick = () => toggleVoiceMute();
    if (btnVoiceRetry) btnVoiceRetry.onclick = () => startVoiceCall();

    // History drawer close triggers
    if (btnCloseDrawer) btnCloseDrawer.onclick = () => closeHistoryDrawer();
    if (drawerBackdrop) drawerBackdrop.onclick = () => closeHistoryDrawer();
    if (btnDrawerNewConvo) btnDrawerNewConvo.onclick = () => startNewSession();
  }

  // Global triggers exposed to HTML (for suggestion chips & onclicks)
  window.askAI = function (text) {
    if (currentMode !== 'chat') {
      setMode('chat');
    }
    sendChatMessage(text);
  };

  window.sendChat = function () {
    sendChatMessage();
  };

  window.setAIMode = function (mode) {
    setMode(mode);
  };

  window.openAIHistory = function () {
    openHistoryDrawer();
  };

  window.exitVoiceMode = function () {
    exitVoiceMode();
  };

  window.onLanguageChange = function () {
    if (!window.KrishiVoice || !window.KrishiVoice.isRunning()) {
      resetVoiceUI();
    }
    if (currentMode === 'voice') {
      if (window.isSecureContext === false) {
        showInsecureContextWarning();
      }
      if (voiceInteractiveCanvas && !voiceInteractiveCanvas.querySelector('.tpl-comparison-container')) {
        if (window.KrishiTemplates && typeof window.KrishiTemplates.restoreIdlePrompt === 'function') {
          voiceInteractiveCanvas.innerHTML = '';
          window.KrishiTemplates.restoreIdlePrompt(voiceInteractiveCanvas);
        }
      }
    }
  };

  window._handleVoiceTranscript = function (t) {
    handleVoiceTranscript(t);
  };

  window._showInsecureContextWarning = function () {
    showInsecureContextWarning();
  };

  // Initialize
  document.addEventListener('DOMContentLoaded', () => {
    initDOMElements();
    bindEvents();

    const urlParams = new URLSearchParams(window.location.search);
    const urlLang = urlParams.get('lang');
    if (urlLang && typeof setLanguage === 'function') {
      setLanguage(urlLang);
    }

    const urlMode = urlParams.get('mode');
    if (urlMode === 'chat' || urlMode === 'voice') {
      setMode(urlMode);
    } else if (urlParams.has('mode') && urlParams.get('mode') === 'select') {
      setMode(null);
    } else {
      const savedMode = sessionStorage.getItem('krishi_ai_mode');
      if (savedMode === 'chat' || savedMode === 'voice') {
        setMode(savedMode);
      } else {
        setMode(null); // Show upfront choice
      }
    }

    if (urlParams.get('history') === '1') {
      setTimeout(() => openHistoryDrawer(), 300);
    }
  });

})(window);
