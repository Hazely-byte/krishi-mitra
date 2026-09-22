'use strict';

require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const os = require('os');

// CLI Benchmark Flags Handling
const args = process.argv.slice(2);
if (args.includes('--sweep3')) {
  console.log('[CLI] Running Sweep 3 benchmark...');
  require('./bench/sweep_3.js').runSweep3().then(() => process.exit(0)).catch((err) => {
    console.error(err);
    process.exit(1);
  });
  return;
} else if (args.includes('--sweep2') || args.includes('--turn-sweep')) {
  console.log('[CLI] Running silence sweep 2 (endpointing isolation)...');
  require('./bench/silence_sweep_2.js').runSweep2().then(() => process.exit(0)).catch((err) => {
    console.error(err);
    process.exit(1);
  });
  return;
} else if (args.includes('--sweep') || args.includes('--silence-sweep')) {
  console.log('[CLI] Running trailing-silence sweep benchmark...');
  require('./bench/silence_sweep.js').runSilenceSweep().then(() => process.exit(0)).catch((err) => {
    console.error(err);
    process.exit(1);
  });
  return;
} else if (args.includes('--bench')) {
  console.log('[CLI] Running automated latency benchmark...');
  require('./bench/benchmark.js').runBenchmark().then(() => process.exit(0)).catch((err) => {
    console.error(err);
    process.exit(1);
  });
  return;
}

// Server modules
const db = require('./server/db');
const mandi = require('./server/mandi');
const location = require('./server/location');
const tools = require('./server/tools');
const chat = require('./server/chat');
const mandiRoutes = require('./server/mandi-routes');
const sessionRoutes = require('./server/sessions');
const buyers = require('./server/buyers');
const supabase = require('./server/supabase');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// Body limit 32kb per plan
app.use(express.json({ limit: '32kb' }));

// Rate limiter on /api
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' }
});
app.use('/api/', apiLimiter);

// Same-origin check for state-mutating API requests
app.use('/api', (req, res, next) => {
  if (['POST', 'DELETE', 'PUT', 'PATCH'].includes(req.method)) {
    const origin = req.headers.origin;
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    if (origin) {
      try {
        const originHost = new URL(origin).host;
        if (originHost !== host) {
          return res.status(403).json({ error: 'Cross-origin request forbidden' });
        }
      } catch (e) {
        return res.status(400).json({ error: 'Invalid origin header' });
      }
    }
  }
  next();
});

// REST API Routes
app.use('/api/mandi', mandiRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/chat', chat.router);

app.get('/api/buyers', (req, res) => {
  try {
    const lat = req.query.lat ? parseFloat(req.query.lat) : undefined;
    const lng = req.query.lng ? parseFloat(req.query.lng) : undefined;
    const radius = req.query.radius ? parseFloat(req.query.radius) : 300;
    const type = req.query.type || 'all';

    const results = buyers.getBuyersRadius(lat, lng, radius, type);
    res.json(results);
  } catch (err) {
    console.error('[API /api/buyers] Error:', err);
    res.status(500).json({ error: 'Failed to retrieve buyers' });
  }
});

app.post('/api/location/resolve', async (req, res) => {
  const { lat, lon } = req.body || {};
  const result = await location.resolveLocation(Number(lat), Number(lon));
  res.json(result);
});

// Provide dynamic Google Maps configuration from environment variable
app.get(['/js/maps-config.js', '/SIH/js/maps-config.js'], (req, res) => {
  res.type('application/javascript');
  const apiKey = process.env.GOOGLE_MAPS_API_KEY || '';
  res.send(`window.GOOGLE_MAPS_CONFIG = { apiKey: '${apiKey}' };\n`);
});

// REST config endpoint for maps
app.get('/api/config/maps', (req, res) => {
  res.json({ apiKey: process.env.GOOGLE_MAPS_API_KEY || '' });
});

// Root serves teammates' SIH frontend
app.use(express.static(path.join(__dirname, 'SIH')));

// /lab serves the existing working benchmark & sandbox client
app.use('/lab', express.static(path.join(__dirname, 'public')));

// Serve audio-processor worklet from js or root for convenience
app.get('/audio-processor.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'SIH', 'js', 'audio-processor.js'));
});

// -------------------------------------------------------------
// Gemini Live Multimodal WebSocket Proxy
// -------------------------------------------------------------

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
  console.error('[FATAL] GEMINI_API_KEY is not defined in .env');
  process.exit(1);
}

// Live Model config
const LIVE_MODEL_NAME = process.env.GEMINI_LIVE_MODEL || process.env.GEMINI_MODEL || 'models/gemini-3.1-flash-live-preview';
const is25Model = LIVE_MODEL_NAME.includes('2.5');

const thinkingConfig = is25Model
  ? { thinkingBudget: 0 }
  : { thinkingLevel: 'MINIMAL', includeThoughts: false };

// Default setup payload (used by /lab sandbox and automated benchmarks)
function createDefaultSetupPayload() {
  return {
    setup: {
      model: LIVE_MODEL_NAME,
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: 'Aoede'
            }
          }
        },
        thinkingConfig
      },
      systemInstruction: {
        parts: [
          {
            text: 'You are an agricultural expert. Speak natural Hindi. Answer in at most 2 short sentences unless asked for detail.'
          }
        ]
      },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      realtimeInputConfig: {
        automaticActivityDetection: {
          endOfSpeechSensitivity: 'END_SENSITIVITY_HIGH',
          silenceDurationMs: 300
        }
      }
    }
  };
}

// Personalized setup payload (used by Krishi Mitra SIH live voice session)
function createPersonalizedSetupPayload({ language = 'hi', location = {}, profile = {} } = {}) {
  const today = new Date().toISOString().slice(0, 10);
  const extractedAddress = location.address || (location.district ? `${location.district}, ${location.state || 'Chhattisgarh'}` : 'Raipur, Chhattisgarh');
  const userLoc = `${location.district || 'Raipur'}, ${location.state || 'Chhattisgarh'}`;
  const meta = db.getSyncMeta(location.district || 'Raipur');

  const voiceSystemInstruction = `You are Krishi Mitra's (कृषि मित्र) voice assistant for farmers.
Current Date: ${today}
Location: ${userLoc}
Language: ${language === 'hi' ? 'Hindi' : 'English'}
Last Data Update: ${meta.last_updated || 'today'}
The user you are speaking to is currently located at: ${extractedAddress}. Prioritize this location for all logistical and market advice.

VOICE RULES:
1. Speak natural, conversational ${language === 'hi' ? 'Hindi (हिंदी)' : 'English'}.
2. Keep answers short: AT MOST 2 SHORT SENTENCES unless the user explicitly asks for more detail.
3. For ANY price, rate, or mandi query, you MUST call the database tools (get_mandi_prices, compare_markets, get_price_history) and speak only the returned rates. Never guess or fabricate prices.
4. If a price is from outside Raipur (other_state), state clearly that Raipur has no reported data today and that the rate is from another state, which may be located far from Raipur, and warn that transport costs make it not directly comparable. Never present it as a Raipur price. Never use the word "nearest".
5. If no data exists, clearly say that no mandi rate is available for that crop today.
6. When a user asks for contact information, you are required to clearly speak the phone number, address, and operating hours of the APMC or buyer. Do not just tell them to look at the screen.
7. If the user asks to fill, enter, save, or update their address, village, or location on the form or screen, you MUST call the autofill_user_address tool with their verified location.`;

  const allToolDeclarations = [
    ...tools.toolDeclarations,
    {
      name: 'autofill_user_address',
      description: 'Automatically populates the user\'s current verified GPS/geocoded address into the active registration or analysis form fields on the screen.',
      parameters: {
        type: 'OBJECT',
        properties: {
          address: {
            type: 'STRING',
            description: 'Optional human-readable address to fill in. Defaults to verified device address.'
          }
        }
      }
    }
  ];

  return {
    setup: {
      model: LIVE_MODEL_NAME,
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: 'Aoede'
            }
          }
        },
        thinkingConfig
      },
      systemInstruction: {
        parts: [{ text: voiceSystemInstruction }]
      },
      tools: [{ functionDeclarations: allToolDeclarations }],
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      realtimeInputConfig: {
        automaticActivityDetection: {
          endOfSpeechSensitivity: 'END_SENSITIVITY_HIGH',
          silenceDurationMs: 300
        }
      }
    }
  };
}

const wss = new WebSocket.Server({ server, path: '/live' });

const hrMs = () => Number(process.hrtime.bigint()) / 1e6;
const jsonlLogPath = path.resolve(__dirname, 'latency-log.jsonl');

const appendLog = (entry) => {
  try {
    fs.appendFileSync(jsonlLogPath, JSON.stringify(entry) + '\n');
  } catch (err) {
    console.error('[LOGGER ERROR]:', err.message);
  }
};

wss.on('connection', (clientWs) => {
  console.log('\n[CLIENT] Browser connected to /live WebSocket proxy');

  let clientClockOffsetMs = 0;
  let clientRttMs = 0;

  let turnIndex = 0;
  let inTurn = false;
  let tSpeechStart = 0;
  let tSpeechEnd = 0;
  let tFirstChunkSent = 0;
  let tLastChunkSent = 0;
  let tFirstAudioChunkFwd = 0;
  let tGeminiTurnStart = 0;
  let tGeminiFirstRecv = 0;
  let tGeminiFirstThought = 0;
  let tGeminiFirstAudio = 0;
  let tGeminiTurnComplete = 0;

  let thoughtTextAccum = '';
  let speechTextAccum = '';
  let userSpeechAccum = '';
  let audioChunkCount = 0;
  let totalAudioBytes = 0;
  let usageMetadata = null;

  // Session metadata if initialized by SIH voice mode
  let isSihVoiceSession = false;
  let voiceSessionId = null;
  let voiceClientId = null;
  let sessionSetupPayload = null;
  let setupSent = false;

  function getRelPrefix() {
    const now = hrMs();
    const ref = tSpeechEnd > 0 ? tSpeechEnd : (tGeminiTurnStart > 0 ? tGeminiTurnStart : now);
    const diff = Math.round(now - ref);
    return diff >= 0 ? `+${diff}ms` : `-${Math.abs(diff)}ms`;
  }

  // Connect to Gemini Multimodal Live endpoint
  const geminiEndpoint = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${API_KEY}`;
  const geminiWs = new WebSocket(geminiEndpoint);
  const pendingClientQueue = [];

  function sendSetupIfReady() {
    if (setupSent || geminiWs.readyState !== WebSocket.OPEN) return;
    const payload = sessionSetupPayload || createDefaultSetupPayload();
    console.log(`[GEMINI] Sending setup message (Model: ${LIVE_MODEL_NAME}, Voice: Aoede, isSihSession: ${isSihVoiceSession})...`);
    geminiWs.send(JSON.stringify(payload));
    setupSent = true;

    while (pendingClientQueue.length > 0) {
      geminiWs.send(pendingClientQueue.shift());
    }
  }

  geminiWs.on('open', () => {
    console.log('[GEMINI] Connected to Google Gemini Live WebSocket API');
    if (sessionSetupPayload) {
      sendSetupIfReady();
    } else {
      setTimeout(() => {
        if (!setupSent) {
          sendSetupIfReady();
        }
      }, 150);
    }
  });

  // Relay messages from Gemini Live -> Browser
  geminiWs.on('message', async (data) => {
    const now = hrMs();
    try {
      const parsed = JSON.parse(data.toString());

      if (parsed.setupComplete) {
        console.log('[GEMINI] Setup complete! Live audio session ready.');
        clientWs.send(JSON.stringify({ type: 'setupComplete' }));
        return;
      }

      if (inTurn && !tGeminiFirstRecv) {
        tGeminiFirstRecv = now;
        console.log(`${getRelPrefix()} [EVENT] First response frame received from Gemini`);
      }

      if (parsed.usageMetadata) {
        usageMetadata = parsed.usageMetadata;
      }

      // Tool Call from Gemini Live
      if (parsed.toolCall?.functionCalls) {
        for (const fc of parsed.toolCall.functionCalls) {
          console.log(`[GEMINI LIVE TOOL] Invoking ${fc.name}(${JSON.stringify(fc.args)})`);
          clientWs.send(JSON.stringify({
            type: 'tool_status',
            name: fc.name,
            status: 'running'
          }));

          // Client-side tools (e.g. autofill_user_address executed on frontend DOM)
          if (fc.name === 'autofill_user_address') {
            console.log(`[CLIENT TOOL CALL] Relaying ${fc.name} to frontend clientWs:`, fc.args);
            clientWs.send(JSON.stringify({
              type: 'toolCall',
              callId: fc.id,
              name: fc.name,
              args: fc.args
            }));
            continue;
          }

          const toolResult = await tools.executeTool(fc.name, fc.args);

          const toolResponse = {
            toolResponse: {
              functionResponses: [
                {
                  id: fc.id,
                  name: fc.name,
                  response: { result: toolResult }
                }
              ]
            }
          };

          if (geminiWs.readyState === WebSocket.OPEN) {
            geminiWs.send(JSON.stringify(toolResponse));
          }

          clientWs.send(JSON.stringify({
            type: 'tool_status',
            name: fc.name,
            status: 'completed',
            result: toolResult
          }));
        }
        return;
      }

      // User interrupted model playback
      if (parsed.serverContent?.interrupted) {
        console.log(`${getRelPrefix()} ⚡ [INTERRUPT] User interrupted model playback`);
        clientWs.send(JSON.stringify({ type: 'interrupted' }));
      }

      // User Speech Transcription (from inputAudioTranscription)
      if (parsed.serverContent?.inputAudioTranscription?.text) {
        const userText = parsed.serverContent.inputAudioTranscription.text;
        userSpeechAccum += userText;
        clientWs.send(JSON.stringify({
          type: 'user_transcript',
          text: userText
        }));
      }

      // Assistant Speech Transcription (from outputAudioTranscription)
      if (parsed.serverContent?.outputAudioTranscription?.text || parsed.serverContent?.outputTranscription?.text) {
        const text = parsed.serverContent.outputAudioTranscription?.text || parsed.serverContent.outputTranscription?.text;
        speechTextAccum += text;
        clientWs.send(JSON.stringify({
          type: 'transcript',
          text
        }));
      }

      // ModelTurn Parts
      if (parsed.serverContent?.modelTurn?.parts) {
        for (const part of parsed.serverContent.modelTurn.parts) {
          if (part.thought) {
            if (!tGeminiFirstThought) tGeminiFirstThought = now;
            thoughtTextAccum += part.text || '';
            console.log(`${getRelPrefix()} [THOUGHT] ${part.text.trim()}`);
            clientWs.send(JSON.stringify({
              type: 'thought',
              text: part.text
            }));
          }

          if (part.inlineData) {
            if (!tGeminiFirstAudio) {
              tGeminiFirstAudio = now;
              console.log(`${getRelPrefix()} [SPEECH] First audio packet received (${part.inlineData.data.length} b64 chars)`);
            }
            audioChunkCount++;
            const rawBytes = Buffer.from(part.inlineData.data, 'base64').length;
            totalAudioBytes += rawBytes;

            clientWs.send(JSON.stringify({
              type: 'audio',
              data: part.inlineData.data,
              mimeType: part.inlineData.mimeType || 'audio/pcm;rate=24000',
              tGeminiFirstAudio: tGeminiFirstAudio
            }));
          }

          if (part.text && !part.thought) {
            speechTextAccum += part.text;
            console.log(`${getRelPrefix()} [SPEECH TEXT] ${part.text.trim()}`);
            clientWs.send(JSON.stringify({
              type: 'text',
              text: part.text
            }));
          }
        }
      }

      if (parsed.serverContent?.turnComplete) {
        tGeminiTurnComplete = now;
        console.log(`${getRelPrefix()} [SPEECH] Turn complete from Gemini (Audio chunks: ${audioChunkCount})`);

        clientWs.send(JSON.stringify({
          type: 'turnComplete',
          turnIndex,
          tGeminiTurnStart,
          tGeminiFirstRecv,
          tGeminiFirstThought,
          tGeminiFirstAudio,
          tGeminiTurnComplete
        }));

        // Persist turn messages if SIH voice session
        if (voiceSessionId && (userSpeechAccum.trim() || speechTextAccum.trim())) {
          if (userSpeechAccum.trim()) {
            db.addMessage({
              id: crypto.randomUUID(),
              session_id: voiceSessionId,
              role: 'user',
              content: userSpeechAccum.trim()
            });
            userSpeechAccum = '';
          }
          if (speechTextAccum.trim()) {
            db.addMessage({
              id: crypto.randomUUID(),
              session_id: voiceSessionId,
              role: 'assistant',
              content: speechTextAccum.trim()
            });
          }
        }
      }

    } catch (err) {
      clientWs.send(data);
    }
  });

  geminiWs.on('error', (err) => {
    console.error('[GEMINI ERROR]:', err.message);
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(JSON.stringify({ type: 'error', error: err.message }));
    }
  });

  geminiWs.on('close', (code, reason) => {
    console.log(`[GEMINI] Connection closed (${code}: ${reason.toString()})`);
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.close(1000, 'Gemini connection closed');
    }
  });

  // Relay messages from Browser -> Gemini
  clientWs.on('message', (message) => {
    const now = hrMs();
    let parsed = null;
    try {
      parsed = JSON.parse(message.toString());
    } catch (e) {
      parsed = null;
    }

    // 0. Tool Response from Client-Side Tools (forwarded to Gemini Live)
    if (parsed && parsed.type === 'toolResponse') {
      console.log(`[CLIENT TOOL RESPONSE] Forwarding ${parsed.name} response to Gemini Live:`, parsed.response);
      const toolResponse = {
        toolResponse: {
          functionResponses: [
            {
              id: parsed.callId || parsed.id,
              name: parsed.name,
              response: { result: parsed.response || { success: true } }
            }
          ]
        }
      };
      if (geminiWs.readyState === WebSocket.OPEN) {
        geminiWs.send(JSON.stringify(toolResponse));
      }
      return;
    }

    // Session Initialization Message from SIH voice mode
    if (parsed && parsed.type === 'session_init') {
      isSihVoiceSession = true;
      voiceClientId = parsed.client_id || 'anonymous';
      voiceSessionId = parsed.session_id || crypto.randomUUID();

      // Create session in DB
      try {
        db.createSession({
          id: voiceSessionId,
          client_id: voiceClientId,
          mode: 'voice',
          title: 'Voice Session ' + new Date().toLocaleTimeString(),
          language: parsed.language || 'hi'
        });
        db.pruneOldSessions(voiceClientId, 100);
      } catch (e) {}

      sessionSetupPayload = createPersonalizedSetupPayload({
        language: parsed.language || 'hi',
        location: parsed.location || {},
        profile: parsed.profile || {}
      });

      sendSetupIfReady();
      clientWs.send(JSON.stringify({ type: 'session_initialized', session_id: voiceSessionId }));
      return;
    }

    // 1. Clock Synchronization Protocol
    if (parsed && parsed.type === 'sync_ping') {
      clientWs.send(JSON.stringify({
        type: 'sync_pong',
        id: parsed.id,
        tClient: parsed.tClient,
        tServer: now
      }));
      return;
    }

    if (parsed && parsed.type === 'sync_complete') {
      clientClockOffsetMs = parsed.offsetMs || 0;
      clientRttMs = parsed.rttMs || 0;
      console.log(`[CLOCK SYNC] Offset: ${clientClockOffsetMs.toFixed(2)}ms, Client-Proxy RTT: ${clientRttMs.toFixed(2)}ms`);
      return;
    }

    // 2. Client Speech Events
    if (parsed && parsed.type === 'speech_event') {
      if (parsed.event === 'speech_start') {
        turnIndex++;
        inTurn = true;
        tSpeechStart = parsed.tSpeechStart + clientClockOffsetMs;
        tSpeechEnd = 0;
        tFirstChunkSent = parsed.tFirstChunkSent ? parsed.tFirstChunkSent + clientClockOffsetMs : now;
        tLastChunkSent = 0;
        tFirstAudioChunkFwd = 0;
        tGeminiTurnStart = 0;
        tGeminiFirstRecv = 0;
        tGeminiFirstThought = 0;
        tGeminiFirstAudio = 0;
        tGeminiTurnComplete = 0;
        thoughtTextAccum = '';
        speechTextAccum = '';
        userSpeechAccum = '';
        audioChunkCount = 0;
        totalAudioBytes = 0;
        usageMetadata = null;
        console.log(`\n======================================================`);
        console.log(`🎙️ [TURN #${turnIndex} STARTED] Speech detected by browser VAD`);
        console.log(`======================================================`);
      } else if (parsed.event === 'speech_end') {
        tSpeechEnd = parsed.tSpeechEnd + clientClockOffsetMs;
        tLastChunkSent = parsed.tLastChunkSent ? parsed.tLastChunkSent + clientClockOffsetMs : now;
        console.log(`${getRelPrefix()} [EVENT] User stopped speaking`);
      }
      return;
    }

    // 3. Client Final Turn Metrics Feedback (latency-log.jsonl logging without transcripts)
    if (parsed && parsed.type === 'client_turn_metrics') {
      const tFirstAudioReceived = parsed.tFirstAudioReceived + clientClockOffsetMs;
      const tFirstAudioScheduled = parsed.tFirstAudioScheduled + clientClockOffsetMs;
      const tPlaybackAudible = parsed.tPlaybackAudible + clientClockOffsetMs;

      const speechEndRef = tSpeechEnd > 0 ? tSpeechEnd : tLastChunkSent;
      const turnStartRef = tGeminiTurnStart > 0 ? tGeminiTurnStart : tFirstChunkSent;
      const firstRecvRef = tGeminiFirstRecv > 0 ? tGeminiFirstRecv : tGeminiFirstAudio;

      const endpointingDelay = Math.max(0, firstRecvRef - speechEndRef);
      const thinkingTime = tGeminiFirstAudio > 0 ? Math.max(0, tGeminiFirstAudio - firstRecvRef) : 0;
      const proxyOverhead = Math.max(0, (turnStartRef - tFirstChunkSent) + (tFirstAudioReceived - tGeminiFirstAudio));
      const playbackBuffering = Math.max(0, tPlaybackAudible - tFirstAudioReceived);
      const totalLatency = Math.max(0, tPlaybackAudible - speechEndRef);
      const thoughtDuration = tGeminiFirstThought > 0 && tGeminiFirstAudio > 0 ? Math.max(0, tGeminiFirstAudio - tGeminiFirstThought) : 0;
      const audioDurationSec = Math.round((totalAudioBytes / 48000) * 10) / 10;
      const wordCount = speechTextAccum.trim() ? speechTextAccum.trim().split(/\s+/).length : 0;

      console.log(`\n======================================================`);
      console.log(`📊 TURN #${turnIndex} LATENCY BREAKDOWN`);
      console.log(`------------------------------------------------------`);
      console.log(`⏱️  Endpointing Delay:      ${Math.round(endpointingDelay)} ms`);
      console.log(`⏱️  Thinking / Model Time:  ${Math.round(thinkingTime)} ms`);
      console.log(`⏱️  Proxy Overhead:         ${Math.round(proxyOverhead)} ms`);
      console.log(`⏱️  Playback Buffering:     ${Math.round(playbackBuffering)} ms`);
      console.log(`⏱️  Total Turnaround Time:  ${Math.round(totalLatency)} ms`);
      console.log(`======================================================\n`);

      // Latency log record: NEVER write user transcripts to latency-log.jsonl per user rule
      const logRecord = {
        timestamp: new Date().toISOString(),
        turnIndex,
        model: LIVE_MODEL_NAME,
        endpointingDelay: Math.round(endpointingDelay),
        thinkingTime: Math.round(thinkingTime),
        proxyOverhead: Math.round(proxyOverhead),
        playbackBuffering: Math.round(playbackBuffering),
        totalLatency: Math.round(totalLatency),
        thoughtDuration: Math.round(thoughtDuration),
        audioDurationSec,
        audioChunkCount,
        wordCount,
        usageMetadata: usageMetadata || {}
      };

      appendLog(logRecord);

      clientWs.send(JSON.stringify({
        type: 'turn_summary',
        metrics: logRecord
      }));

      inTurn = false;
      return;
    }

    // Audio stream packet forward to Gemini
    let outgoingMsg = message;
    if (parsed && parsed.realtimeInput) {
      if (is25Model && parsed.realtimeInput.audio) {
        outgoingMsg = JSON.stringify({
          realtimeInput: { mediaChunks: [parsed.realtimeInput.audio] }
        });
      } else if (!is25Model && parsed.realtimeInput.mediaChunks && parsed.realtimeInput.mediaChunks[0]) {
        outgoingMsg = JSON.stringify({
          realtimeInput: { audio: parsed.realtimeInput.mediaChunks[0] }
        });
      }
    }

    if (!tFirstAudioChunkFwd) {
      tFirstAudioChunkFwd = now;
      tGeminiTurnStart = now;
    }

    if (geminiWs.readyState === WebSocket.OPEN && setupSent) {
      geminiWs.send(outgoingMsg);
    } else {
      pendingClientQueue.push(outgoingMsg);
    }
  });

  clientWs.on('close', () => {
    console.log('[CLIENT] Browser disconnected');
    if (geminiWs.readyState === WebSocket.OPEN) {
      geminiWs.close();
    }
  });

  clientWs.on('error', (err) => {
    console.error('[CLIENT ERROR]:', err.message);
    geminiWs.close();
  });
});

// Start Server and background sync
function getTailscaleIPv4() {
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const addr of addrs || []) {
      const family = addr.family === 4 || addr.family === 'IPv4';
      if (family && addr.address.startsWith('100.')) return addr.address;
    }
  }
  return null;
}

if (require.main === module) {
  server.listen(PORT, HOST, async () => {
    const tailscaleIp = getTailscaleIPv4();
    console.log('====================================================');
    console.log('🌾 KRISHI MITRA BACKEND & VOICE PROXY SERVER');
    console.log(`👉 App Frontend:    http://localhost:${PORT}/`);
    if (tailscaleIp) {
      console.log(`🌐 Tailscale:       http://${tailscaleIp}:${PORT}/`);
    }
    console.log(`🧪 Lab Sandbox:     http://localhost:${PORT}/lab/`);
    console.log(`⚡ WebSocket Proxy: ws://localhost:${PORT}/live`);
    console.log(`🤖 Text Chat Model: ${chat.activeModelName}`);
    console.log(`🎙️ Live Voice Model: ${LIVE_MODEL_NAME}`);
    console.log('====================================================');

    // Verify text model at startup
    await chat.validateTextModel(API_KEY);

    // Sync feed on startup if stale, then every 3 hours
    const govKey = process.env.DATA_GOV_API_KEY;
    if (govKey) {
      if (mandi.needsSync()) {
        console.log('[startup] Triggering initial mandi sync...');
        mandi.syncNational(govKey).catch(err => console.error('[startup] Sync failed:', err.message));
      }
      mandi.startPeriodicSync(govKey);
    }
  });
}

module.exports = app;
module.exports.server = server;
