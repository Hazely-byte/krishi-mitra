/**
 * ============================================================
 * Krishi Mitra — voice.js
 * Real-time bidirectional Live Audio Streaming via Gemini Live Proxy (/live)
 * Extracted directly from public/index.html (benchmarked working implementation)
 * ============================================================
 *
 * MAPPING TO SOURCE IN public/index.html:
 * 1. Audio / Session State Variables       -> public/index.html lines 667-696
 * 2. start(options)                         -> public/index.html lines 765-837 (startLiveSession)
 * 3. stop()                                 -> public/index.html lines 1203-1240 (stopLiveSession)
 * 4. mute(val)                              -> public/index.html mediaStream track controls
 * 5. performClockSync(totalPings)           -> public/index.html lines 840-883
 * 6. setupAudioWorkletProcessor()           -> public/index.html lines 899-994
 * 7. downsampleFloat32(buf, inRate, outRate)-> public/index.html lines 996-1016
 * 8. arrayBufferToBase64(buf)               -> public/index.html lines 1018-1025
 * 9. handleServerMessage(messageData)       -> public/index.html lines 1028-1092
 * 10. queueAudioChunk(base64Pcm24k)         -> public/index.html lines 1095-1151
 * 11. cancelQueuedAudio()                   -> public/index.html lines 1153-1165
 * ============================================================
 */

(function (window) {
  'use strict';

  let ws = null;
  let isLive = false;
  let isMuted = false;

  // Audio Input (Capture via AudioWorklet with JS Resampling to 16kHz)
  let inputAudioContext = null;
  let mediaStream = null;
  let audioWorkletNode = null;
  let micPcmAccumulator = [];

  // Audio Output (24kHz PCM Playback with 80ms Jitter Buffer)
  let playbackAudioContext = null;
  let nextPlaybackTime = 0;
  let activeAudioSources = [];
  const JITTER_BUFFER_MS = 80; // 80ms balanced jitter buffer

  // Telemetry & Timing (performance.now())
  let clockOffsetMs = 0;
  let clientRttMs = 0;
  let isSpeaking = false;
  let silenceStartTime = 0;
  let tSpeechStart = 0;
  let tSpeechEnd = 0;
  let tLastSpeechChunkSent = 0;
  let tFirstAudioReceived = 0;
  let tFirstAudioScheduled = 0;
  let tPlaybackAudible = 0;
  let audioChunksInTurn = 0;
  let setupReceived = false;

  // Callbacks registered by UI
  let callbacks = {
    onState: null,
    onTranscript: null,
    onError: null,
    onToolStatus: null,
    onVisualizer: null
  };

  function setState(state) {
    if (typeof callbacks.onState === 'function') {
      try { callbacks.onState(state); } catch (e) { console.error('[voice] onState error:', e); }
    }
  }

  function emitTranscript(data) {
    if (typeof callbacks.onTranscript === 'function') {
      try { callbacks.onTranscript(data); } catch (e) { console.error('[voice] onTranscript error:', e); }
    }
  }

  function emitError(err) {
    if (typeof callbacks.onError === 'function') {
      try { callbacks.onError(err); } catch (e) { console.error('[voice] onError error:', e); }
    }
  }

  function emitToolStatus(status) {
    if (typeof callbacks.onToolStatus === 'function') {
      try { callbacks.onToolStatus(status); } catch (e) { console.error('[voice] onToolStatus error:', e); }
    }
  }

  /**
   * 10 Ping-Pong Clock Synchronization (Approximate Offset)
   * Extracted from public/index.html lines 840-883
   */
  function performClockSync(totalPings = 10) {
    const offsets = [];
    const rtts = [];
    let currentPing = 0;

    function sendPing() {
      if (currentPing >= totalPings || !ws || ws.readyState !== WebSocket.OPEN) {
        offsets.sort((a, b) => a - b);
        rtts.sort((a, b) => a - b);
        clockOffsetMs = offsets[Math.floor(offsets.length / 2)] || 0;
        clientRttMs = rtts[Math.floor(rtts.length / 2)] || 0;

        ws.send(JSON.stringify({
          type: 'sync_complete',
          offsetMs: clockOffsetMs,
          rttMs: clientRttMs
        }));
        return;
      }

      const tClient = performance.now();
      ws.send(JSON.stringify({
        type: 'sync_ping',
        id: currentPing,
        tClient
      }));
    }

    window._handleVoiceSyncPong = (pong) => {
      const tRecv = performance.now();
      const rtt = tRecv - pong.tClient;
      const offset = (pong.tServer + rtt / 2) - tRecv;
      rtts.push(rtt);
      offsets.push(offset);
      currentPing++;
      setTimeout(sendPing, 30);
    };

    sendPing();
  }

  /**
   * Downsample Float32 audio buffer from inRate to outRate
   * Extracted from public/index.html lines 996-1016
   */
  function downsampleFloat32(buffer, inRate, outRate) {
    if (inRate === outRate) return buffer;
    const ratio = inRate / outRate;
    const newLen = Math.round(buffer.length / ratio);
    const res = new Float32Array(newLen);
    let offsetResult = 0;
    let offsetBuffer = 0;

    while (offsetResult < res.length) {
      const nextOffset = Math.round((offsetResult + 1) * ratio);
      let sum = 0, count = 0;
      for (let i = offsetBuffer; i < nextOffset && i < buffer.length; i++) {
        sum += buffer[i];
        count++;
      }
      res[offsetResult] = count > 0 ? sum / count : 0;
      offsetResult++;
      offsetBuffer = nextOffset;
    }
    return res;
  }

  /**
   * Convert ArrayBuffer to Base64
   * Extracted from public/index.html lines 1018-1025
   */
  function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
  }

  /**
   * AudioWorklet Microphone Capture with 20ms JS Resampling to 16kHz
   * Extracted from public/index.html lines 899-994
   */
  async function setupAudioWorkletProcessor() {
    await inputAudioContext.audioWorklet.addModule('/audio-processor.js');
    const micSource = inputAudioContext.createMediaStreamSource(mediaStream);
    audioWorkletNode = new AudioWorkletNode(inputAudioContext, 'audio-input-processor');

    const TARGET_SAMPLE_RATE = 16000;
    const CHUNK_DURATION_SEC = 0.02; // 20ms target chunk duration
    const TARGET_CHUNK_SAMPLES = Math.round(TARGET_SAMPLE_RATE * CHUNK_DURATION_SEC); // 320 samples

    audioWorkletNode.port.onmessage = (event) => {
      try {
        if (!isLive || !ws || ws.readyState !== WebSocket.OPEN) return;

        const { audioData } = event.data;
        if (!audioData || audioData.length === 0) return;

        // Energy calculation for VAD & visualizer
        let sumSquares = 0;
        for (let i = 0; i < audioData.length; i++) {
          sumSquares += audioData[i] * audioData[i];
        }
        const rms = Math.sqrt(sumSquares / audioData.length);

        if (typeof callbacks.onVisualizer === 'function') {
          try { callbacks.onVisualizer(rms); } catch (e) {}
        }

        if (isMuted) return; // Discard mic samples when muted

        // Downsample input data to 16kHz
        const downsampled = downsampleFloat32(audioData, inputAudioContext.sampleRate, TARGET_SAMPLE_RATE);
        for (let i = 0; i < downsampled.length; i++) {
          micPcmAccumulator.push(downsampled[i]);
        }

        const now = performance.now();
        const SPEECH_THRESHOLD = 0.012;

        if (rms > SPEECH_THRESHOLD) {
          silenceStartTime = 0;
          if (!isSpeaking) {
            isSpeaking = true;
            tSpeechStart = now;
            tFirstAudioReceived = 0;
            tFirstAudioScheduled = 0;
            tPlaybackAudible = 0;
            audioChunksInTurn = 0;

            setState('listening');

            ws.send(JSON.stringify({
              type: 'speech_event',
              event: 'speech_start',
              tSpeechStart
            }));
          }
        } else if (isSpeaking) {
          if (silenceStartTime === 0) {
            silenceStartTime = now;
          } else if (now - silenceStartTime >= 1500) {
            isSpeaking = false;
            tSpeechEnd = silenceStartTime;
            tLastSpeechChunkSent = now;

            ws.send(JSON.stringify({
              type: 'speech_event',
              event: 'speech_end',
              tSpeechStart,
              tSpeechEnd,
              tLastSpeechChunkSent
            }));
          }
        }

        // Flush 20ms chunks (320 samples)
        while (micPcmAccumulator.length >= TARGET_CHUNK_SAMPLES) {
          const chunkSamples = micPcmAccumulator.splice(0, TARGET_CHUNK_SAMPLES);
          const pcm16 = new Int16Array(chunkSamples.length);
          for (let i = 0; i < chunkSamples.length; i++) {
            let s = chunkSamples[i];
            if (!Number.isFinite(s)) s = 0;
            s = Math.max(-1, Math.min(1, s));
            pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
          }

          const b64 = arrayBufferToBase64(pcm16.buffer);
          ws.send(JSON.stringify({
            realtimeInput: {
              audio: {
                mimeType: "audio/pcm;rate=16000",
                data: b64
              }
            }
          }));
        }
      } catch (err) {
        console.error('[voice] Audio processing error:', err);
      }
    };

    micSource.connect(audioWorkletNode);
  }

  /**
   * Seamless 24kHz PCM Playback Scheduler with 80ms Jitter Buffer
   * Extracted from public/index.html lines 1095-1151
   */
  function queueAudioChunk(base64Pcm24k) {
    setState('speaking');

    const binaryString = window.atob(base64Pcm24k);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    const pcm16 = new Int16Array(bytes.buffer);
    const float32 = new Float32Array(pcm16.length);
    for (let i = 0; i < pcm16.length; i++) {
      float32[i] = pcm16[i] / 32768.0;
    }

    const audioBuffer = playbackAudioContext.createBuffer(1, float32.length, 24000);
    audioBuffer.copyToChannel(float32, 0);

    const source = playbackAudioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(playbackAudioContext.destination);

    const currentTime = playbackAudioContext.currentTime;
    const jitterMarginSec = JITTER_BUFFER_MS / 1000.0;

    if (nextPlaybackTime < currentTime) {
      nextPlaybackTime = currentTime + jitterMarginSec;
    }

    const now = performance.now();
    if (!tFirstAudioScheduled) {
      tFirstAudioScheduled = now;
      const delayUntilPlaySec = Math.max(0, nextPlaybackTime - currentTime);
      const hardwareLatencySec = playbackAudioContext.outputLatency || 0.02;
      tPlaybackAudible = now + (delayUntilPlaySec + hardwareLatencySec) * 1000;
    }

    source.start(nextPlaybackTime);
    nextPlaybackTime += audioBuffer.duration;
    activeAudioSources.push(source);

    source.onended = () => {
      const idx = activeAudioSources.indexOf(source);
      if (idx !== -1) activeAudioSources.splice(idx, 1);

      if (activeAudioSources.length === 0 && nextPlaybackTime <= playbackAudioContext.currentTime) {
        setState('listening');
      }
    };
  }

  /**
   * Cancel queued audio immediately upon user interruption
   * Extracted from public/index.html lines 1153-1165
   */
  function cancelQueuedAudio() {
    activeAudioSources.forEach(source => {
      try { source.stop(); } catch (e) {}
    });
    activeAudioSources = [];
    if (playbackAudioContext) {
      nextPlaybackTime = playbackAudioContext.currentTime;
    }
    setState('listening');
  }

  /**
   * Handle incoming messages from the /live WebSocket proxy
   * Extracted from public/index.html lines 1028-1092
   */
  function handleServerMessage(messageData) {
    try {
      const payload = JSON.parse(messageData);

      if (payload.type === 'sync_pong' && window._handleVoiceSyncPong) {
        window._handleVoiceSyncPong(payload);
        return;
      }

      if (payload.type === 'setupComplete' || payload.type === 'session_initialized' || payload.setupComplete) {
        setupReceived = true;
        setState('online');
        return;
      }

      if (payload.type === 'interrupted') {
        cancelQueuedAudio();
        setState('interrupted');
        return;
      }

      if (payload.type === 'audio' && payload.data) {
        const now = performance.now();
        if (!tFirstAudioReceived) {
          tFirstAudioReceived = now;
        }
        audioChunksInTurn++;
        queueAudioChunk(payload.data);
      }

      if (payload.type === 'user_transcript' && payload.text) {
        emitTranscript({ role: 'user', text: payload.text, isFinal: false });
        if (window.KrishiTemplates && typeof window.KrishiTemplates.selectOption === 'function') {
          window.KrishiTemplates.selectOption(payload.text);
        }
      }

      if (payload.type === 'transcript' && payload.text) {
        emitTranscript({ role: 'model', text: payload.text, isFinal: false });
      }

      if (payload.type === 'tool_status') {
        emitToolStatus({
          name: payload.name,
          status: payload.status,
          result: payload.result
        });
      }

      // Client-side Tool Call dispatched from Gemini Live via Server
      if (payload.type === 'toolCall') {
        if (window.KrishiDevConsole && typeof window.KrishiDevConsole.log === 'function') {
          window.KrishiDevConsole.log('toolCall', `Tool Call: ${payload.name}`, payload, 'pending');
        }
        handleClientToolCall(payload);
        return;
      }

      if (payload.type === 'crop_vision_result') {
        if (window.KrishiTemplates && typeof window.KrishiTemplates.handleCropVisionResult === 'function') {
          window.KrishiTemplates.handleCropVisionResult(payload);
        }
        return;
      }

      if (payload.type === 'turnComplete') {
        emitTranscript({ role: 'model', text: '', isFinal: true });
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'client_turn_metrics',
            tSpeechStart,
            tSpeechEnd: tSpeechEnd > 0 ? tSpeechEnd : tLastSpeechChunkSent,
            tLastSpeechChunkSent,
            tFirstAudioReceived,
            tFirstAudioScheduled,
            tPlaybackAudible
          }));
        }
      }

      if (payload.type === 'error') {
        emitError(new Error(payload.error || 'Live proxy error'));
      }

    } catch (err) {
      console.error('[voice] Error parsing server message:', err);
    }
  }

  /**
   * Handle client-side tool calls (e.g. autofill_user_address, compare_markets_ui)
   */
  function handleClientToolCall(toolCall) {
    const { callId, name, args, templateData } = toolCall;

    if (name === 'render_comparison_ui' || name === 'compare_markets_ui') {
      emitToolStatus({ name, status: 'running' });
      const canvas = document.getElementById('voice-interactive-canvas');
      const dataToRender = templateData || (args && args.templateData) || args;
      if (canvas && dataToRender) {
        if (window.KrishiGenerativeRenderer && typeof window.KrishiGenerativeRenderer.renderComparison === 'function') {
          window.KrishiGenerativeRenderer.renderComparison(canvas, dataToRender);
        } else if (window.KrishiTemplates && typeof window.KrishiTemplates.renderComparison === 'function') {
          window.KrishiTemplates.renderComparison(canvas, dataToRender);
        }
      }
      emitToolStatus({ name, status: 'completed' });
      return;
    }

    if (name === 'close_ui_template' || name === 'close_all_ui') {
      emitToolStatus({ name, status: 'running' });
      if (window.KrishiGenerativeRenderer && typeof window.KrishiGenerativeRenderer.closeAll === 'function') {
        window.KrishiGenerativeRenderer.closeAll();
      }
      if (window.KrishiTemplates && typeof window.KrishiTemplates.closeAllUI === 'function') {
        window.KrishiTemplates.closeAllUI(true);
      } else if (window.KrishiTemplates && typeof window.KrishiTemplates.closeTemplate === 'function') {
        window.KrishiTemplates.closeTemplate(args?.template_name || 'two_way_comparison', args?.selected_option_id);
      }
      emitToolStatus({ name, status: 'completed' });
      return;
    }

    const dataToRender = templateData || (args && args.templateData) || args;
    const isDetailPrimitive = (dataToRender && dataToRender.primitive === 'detail_card') ||
      name === 'render_detail_card_ui' ||
      name === 'show_single_rate_ui' ||
      name === 'show_location_ui' ||
      name === 'show_detail_window' ||
      name === 'analyze_inventory_gap_ui';

    if (isDetailPrimitive) {
      emitToolStatus({ name, status: 'running' });
      const canvas = document.getElementById('voice-interactive-canvas');
      if (canvas && dataToRender) {
        if (window.KrishiGenerativeRenderer && typeof window.KrishiGenerativeRenderer.renderDetailCard === 'function') {
          window.KrishiGenerativeRenderer.renderDetailCard(canvas, dataToRender);
        } else if (window.KrishiTemplates && typeof window.KrishiTemplates.renderDetailWindow === 'function') {
          window.KrishiTemplates.renderDetailWindow(canvas, dataToRender);
        }
      }
      emitToolStatus({ name, status: 'completed' });
      return;
    }

    if (name === 'render_selector_menu_ui' || name === 'show_commodity_list_ui' || name === 'show_options_menu' || name === 'find_buyers_ui') {
      emitToolStatus({ name, status: 'running' });
      const canvas = document.getElementById('voice-interactive-canvas');
      if (canvas && dataToRender) {
        if (window.KrishiGenerativeRenderer && typeof window.KrishiGenerativeRenderer.renderSelectorMenu === 'function') {
          window.KrishiGenerativeRenderer.renderSelectorMenu(canvas, dataToRender);
        } else if (window.KrishiTemplates && typeof window.KrishiTemplates.renderOptionsMenu === 'function') {
          window.KrishiTemplates.renderOptionsMenu(canvas, dataToRender);
        }
      }
      emitToolStatus({ name, status: 'completed' });
      return;
    }


    if (name === 'go_back_to_options') {
      emitToolStatus({ name: 'go_back_to_options', status: 'running' });
      const resetVisited = Boolean(args && args.reset_visited);
      if (window.KrishiTemplates && typeof window.KrishiTemplates.goBackToOptionsMenu === 'function') {
        window.KrishiTemplates.goBackToOptionsMenu(true, resetVisited);
      }
      emitToolStatus({ name: 'go_back_to_options', status: 'completed' });
      return;
    }

    if (name === 'open_sell_crop_form') {
      emitToolStatus({ name: 'open_sell_crop_form', status: 'running' });
      const canvas = document.getElementById('voice-interactive-canvas');
      if (canvas && window.KrishiTemplates && typeof window.KrishiTemplates.renderSellCropForm === 'function') {
        window.KrishiTemplates.renderSellCropForm(canvas, args || {});
      }
      emitToolStatus({ name: 'open_sell_crop_form', status: 'completed' });
      return;
    }

    if (name === 'autofill_crop_form') {
      emitToolStatus({ name: 'autofill_crop_form', status: 'running' });
      const fields = (args && args.fields) ? args.fields : (args || {});
      if (window.KrishiTemplates && typeof window.KrishiTemplates.autofillCropForm === 'function') {
        window.KrishiTemplates.autofillCropForm(fields);
      }
      emitToolStatus({ name: 'autofill_crop_form', status: 'completed' });
      return;
    }

    if (name === 'submit_crop_form') {
      emitToolStatus({ name: 'submit_crop_form', status: 'running' });
      if (window.KrishiTemplates && typeof window.KrishiTemplates.submitCropForm === 'function') {
        window.KrishiTemplates.submitCropForm();
      }
      emitToolStatus({ name: 'submit_crop_form', status: 'completed' });
      return;
    }

    if (name === 'trigger_camera' || name === 'trigger_camera_capture') {
      emitToolStatus({ name: 'trigger_camera', status: 'running' });
      if (window.KrishiTemplates && typeof window.KrishiTemplates.triggerCamera === 'function') {
        window.KrishiTemplates.triggerCamera();
      } else if (window.KrishiTemplates && typeof window.KrishiTemplates.openCropCamera === 'function') {
        window.KrishiTemplates.openCropCamera();
      }
      emitToolStatus({ name: 'trigger_camera', status: 'completed' });
      return;
    }

    if (name === 'paginate_options') {
      emitToolStatus({ name: 'paginate_options', status: 'running' });
      const dir = (args && args.direction) ? args.direction : 'NEXT';
      const canvas = document.getElementById('voice-interactive-canvas');
      const isDetailActive = canvas && (canvas.querySelector('.DetailCardPrimitive') || canvas.querySelector('.gen-detail-wrap'));
      if (isDetailActive && window.KrishiTemplates && typeof window.KrishiTemplates.goBackToOptionsMenu === 'function') {
        window.KrishiTemplates.goBackToOptionsMenu(true, false);
      } else if (window.KrishiGenerativeRenderer && typeof window.KrishiGenerativeRenderer.paginateMenu === 'function') {
        window.KrishiGenerativeRenderer.paginateMenu(dir);
      } else if (window.KrishiTemplates && typeof window.KrishiTemplates.paginateMenu === 'function') {
        window.KrishiTemplates.paginateMenu(dir);
      }
      emitToolStatus({ name: 'paginate_options', status: 'completed' });
      return;
    }

    if (name === 'autofill_user_address') {
      emitToolStatus({ name: 'autofill_user_address', status: 'running' });

      // Determine address to fill
      let addressToFill = args && args.address;
      if (!addressToFill && window.KrishiLocation && typeof window.KrishiLocation.getUserAddress === 'function') {
        addressToFill = window.KrishiLocation.getUserAddress();
      }
      if (!addressToFill) {
        addressToFill = 'Raipur, Chhattisgarh';
      }

      // Update DOM inputs across screens
      const targetSelectors = [
        '#analysis-location',
        '#setup-village',
        '#input-village',
        'input[name="village"]',
        'input[name="location"]',
        '[data-autofill="address"]'
      ];

      let filledCount = 0;
      targetSelectors.forEach(sel => {
        const el = document.querySelector(sel);
        if (el) {
          el.value = addressToFill;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          filledCount++;
        }
      });

      // Update farmerProfile in localStorage
      try {
        let profile = {};
        const raw = localStorage.getItem('farmerProfile');
        if (raw) profile = JSON.parse(raw);
        profile.village = addressToFill;
        profile.address = addressToFill;
        localStorage.setItem('farmerProfile', JSON.stringify(profile));
      } catch (e) {
        console.warn('[voice] Failed to update farmerProfile localStorage:', e);
      }

      // Update profile display location if present
      const displayLoc = document.getElementById('profile-display-location');
      if (displayLoc) {
        displayLoc.textContent = '📍 ' + addressToFill;
      }

      // Show toast if available
      if (typeof window.showToast === 'function') {
        const tMsg = (typeof currentLang !== 'undefined' && currentLang === 'hi')
          ? `पता स्वतः भरा गया: ${addressToFill}`
          : `Address autofilled: ${addressToFill}`;
        window.showToast(tMsg);
      }

      emitToolStatus({
        name: 'autofill_user_address',
        status: 'completed',
        result: { success: true, address: addressToFill, fieldsUpdated: filledCount }
      });

      // Send toolResponse back to server proxy to relay to Gemini
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'toolResponse',
          callId,
          name,
          response: {
            success: true,
            address: addressToFill,
            message: `User address successfully autofilled into form: ${addressToFill}`
          }
        }));
      }
    }
  }

  /**
   * Start Live Audio Streaming Session
   * Extracted from public/index.html lines 765-837
   */
  async function start(options = {}) {
    if (isLive) return;

    callbacks = {
      onState: options.onState || null,
      onTranscript: options.onTranscript || null,
      onError: options.onError || null,
      onToolStatus: options.onToolStatus || null,
      onVisualizer: options.onVisualizer || null
    };

    const googleToken = localStorage.getItem('krishi_google_token') || '';
    if (!googleToken) {
      emitError(new Error('CUDA is not available'));
      return;
    }

    try {
      setState('connecting');

      // 1. Playback Context (Gemini native 24kHz)
      playbackAudioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
      if (playbackAudioContext.state === 'suspended') {
        await playbackAudioContext.resume();
      }
      nextPlaybackTime = playbackAudioContext.currentTime;

      // 2. Microphone Stream
      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      // 3. Input Context
      inputAudioContext = new (window.AudioContext || window.webkitAudioContext)();
      if (inputAudioContext.state === 'suspended') {
        await inputAudioContext.resume();
      }

      // 4. WebSocket connection with explicit handshake await
      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${wsProtocol}//${window.location.host}/live?token=${encodeURIComponent(googleToken)}`;
      setupReceived = false;

      await new Promise((resolve, reject) => {
        let settled = false;
        ws = new WebSocket(wsUrl);

        ws.onopen = async () => {
          if (settled) return;
          settled = true;
          try {
            const locationPayload = Object.assign({}, options.location || {});
            if (!locationPayload.address && window.KrishiLocation && typeof window.KrishiLocation.getUserAddress === 'function') {
              locationPayload.address = window.KrishiLocation.getUserAddress();
            }

            // Send session_init
            ws.send(JSON.stringify({
              type: 'session_init',
              client_id: options.clientId || 'anonymous',
              session_id: options.sessionId || null,
              language: options.language || 'hi',
              location: locationPayload,
              profile: options.profile || {}
            }));

            // Calibrate clock
            performClockSync(10);

            // 5. Initialize AudioWorklet ONLY after WebSocket connection is established
            await setupAudioWorkletProcessor();

            isLive = true;
            isMuted = false;
            setState('listening');
            resolve();
          } catch (initErr) {
            reject(initErr);
          }
        };

        ws.onmessage = (event) => {
          handleServerMessage(event.data);
        };

        ws.onerror = (err) => {
          console.error('[DEBUG-MIC] client ws onerror:', err);
          if (!settled) {
            settled = true;
            reject(new Error('CUDA is not available'));
          } else {
            emitError(err);
          }
        };

        ws.onclose = (evt) => {
          if (!settled) {
            settled = true;
            reject(new Error('CUDA is not available'));
          } else if (!setupReceived) {
            emitError(new Error('CUDA is not available'));
          } else if (evt && evt.code !== 1000) {
            const reasonText = evt.reason || `Connection lost (code ${evt.code})`;
            emitError(new Error(reasonText));
          }
          stop();
        };
      });

    } catch (err) {
      console.error('[voice] Failed to start live session:', err);
      emitError(err && err.message === 'CUDA is not available' ? err : new Error('CUDA is not available'));
      stop();
    }
  }

  /**
   * Stop Live Audio Streaming Session
   * Extracted from public/index.html lines 1203-1240
   */
  function stop() {
    if (!isLive && !ws) return;
    isLive = false;
    cancelQueuedAudio();

    if (audioWorkletNode) {
      try { audioWorkletNode.disconnect(); } catch (e) {}
      audioWorkletNode = null;
    }
    if (mediaStream) {
      try { mediaStream.getTracks().forEach(t => t.stop()); } catch (e) {}
      mediaStream = null;
    }
    if (inputAudioContext) {
      try { inputAudioContext.close(); } catch (e) {}
      inputAudioContext = null;
    }
    if (playbackAudioContext) {
      try { playbackAudioContext.close(); } catch (e) {}
      playbackAudioContext = null;
    }
    if (ws) {
      try { ws.close(); } catch (e) {}
      ws = null;
    }

    micPcmAccumulator = [];
    isSpeaking = false;
    setState('offline');
  }

  /**
   * Mute or Unmute Microphone
   */
  function mute(val) {
    if (typeof val === 'boolean') {
      isMuted = val;
    } else {
      isMuted = !isMuted;
    }
    if (mediaStream) {
      mediaStream.getAudioTracks().forEach(t => {
        t.enabled = !isMuted;
      });
    }
    return isMuted;
  }

  window.KrishiVoice = {
    start,
    stop,
    mute,
    isRunning: () => isLive,
    isMuted: () => isMuted,
    sendSelection: function (text) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'user_selection',
          text: text
        }));
      }
    },
    sendMenuSelection: function (optionId, market = 'Raipur APMC', commodity = 'Paddy') {
      if (ws && ws.readyState === WebSocket.OPEN) {
        let text = `Show me ${optionId} for ${market}`;
        if (optionId === 'trends') {
          text = `Show me rates and trends for ${market}`;
        } else if (optionId === 'map') {
          text = `Show me the map and route for ${market}`;
        } else if (optionId === 'contact') {
          text = `Show me contact information for ${market}`;
        }
        ws.send(JSON.stringify({
          type: 'user_selection',
          text: text
        }));
      }
    },
    sendScreenStateUpdate: function (view, activeEntity = null, visibleData = {}) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'screen_state_update',
          view,
          active_entity: activeEntity,
          visible_data: visibleData
        }));
      }
    },
    sendUIVerification: function (data) {
      if (window.KrishiDevConsole && typeof window.KrishiDevConsole.log === 'function') {
        let summary = '';
        if (data.status === 'success') {
          summary = `Verified: ${data.view || 'UI'} (${data.rendered_items ?? 0} items)`;
        } else if (data.status === 'empty') {
          summary = `Empty: ${data.view || 'UI'} (0 items)`;
        } else {
          summary = `FAILED: ${data.view || 'UI'} - ${data.error || 'Render exception'}`;
        }
        window.KrishiDevConsole.log('ui_verification', summary, data, data.status);
      }
      if (ws && ws.readyState === WebSocket.OPEN) {
        const { type: cardType, ...rest } = (data || {});
        ws.send(JSON.stringify({
          ...rest,
          card_type: cardType,
          type: 'ui_verification'
        }));
      }
    },
    sendClientSelection: function (payload) {
      if (window.KrishiDevConsole && typeof window.KrishiDevConsole.log === 'function') {
        window.KrishiDevConsole.log('client_selection', `User tapped: ${payload.label || payload.selected_id}`, payload, 'info');
      }
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'client_selection',
          ...payload
        }));
      }
    },
    sendVoiceCommand: function (cmd) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'user_selection',
          text: cmd
        }));
      }
    },
    closeAllUI: function () {
      if (window.KrishiGenerativeRenderer && typeof window.KrishiGenerativeRenderer.closeAll === 'function') {
        window.KrishiGenerativeRenderer.closeAll();
      }
      if (window.KrishiTemplates && typeof window.KrishiTemplates.closeAllUI === 'function') {
        window.KrishiTemplates.closeAllUI(false);
      }
    },
    sendCropImage: function (base64Data) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'crop_image_upload',
          image: base64Data
        }));
      }
    },
    openSellCropForm: function (data = {}) {
      handleClientToolCall({ callId: 'manual_' + Date.now(), name: 'open_sell_crop_form', args: data });
    },
    autofillCropForm: function (fields = {}) {
      handleClientToolCall({ callId: 'manual_' + Date.now(), name: 'autofill_crop_form', args: { fields } });
    },
    submitCropForm: function () {
      handleClientToolCall({ callId: 'manual_' + Date.now(), name: 'submit_crop_form', args: {} });
    },
    triggerCamera: function () {
      handleClientToolCall({ callId: 'manual_' + Date.now(), name: 'trigger_camera', args: {} });
    },
    paginateOptions: function (direction = 'NEXT') {
      handleClientToolCall({ callId: 'manual_' + Date.now(), name: 'paginate_options', args: { direction } });
    },
    autofillUserAddress: (address) => handleClientToolCall({ callId: 'manual_' + Date.now(), name: 'autofill_user_address', args: { address } })
  };

})(window);
