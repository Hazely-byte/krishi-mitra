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
      if (!isLive || !ws || ws.readyState !== WebSocket.OPEN) return;

      const { audioData } = event.data;

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
        } else if (now - silenceStartTime >= 400) {
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
          const s = Math.max(-1, Math.min(1, chunkSamples[i]));
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

      if (payload.type === 'setupComplete' || payload.type === 'session_initialized') {
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
        handleClientToolCall(payload);
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
   * Handle client-side tool calls (e.g. autofill_user_address)
   */
  function handleClientToolCall(toolCall) {
    const { callId, name, args } = toolCall;
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

      // 4. WebSocket connection
      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${wsProtocol}//${window.location.host}/live`;
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
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
      };

      ws.onmessage = (event) => {
        handleServerMessage(event.data);
      };

      ws.onerror = (err) => {
        emitError(err);
      };

      ws.onclose = () => {
        stop();
      };

      // 5. Initialize AudioWorklet
      await setupAudioWorkletProcessor();

      isLive = true;
      isMuted = false;
      setState('listening');

    } catch (err) {
      console.error('[voice] Failed to start live session:', err);
      emitError(err);
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
    autofillUserAddress: (address) => handleClientToolCall({ callId: 'manual_' + Date.now(), name: 'autofill_user_address', args: { address } })
  };

})(window);
