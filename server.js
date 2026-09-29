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
const auth = require('./server/auth');

const app = express();
app.set('trust proxy', 1);
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
app.use(auth.authRouter);

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
function getMapsApiKey() {
  return (process.env.GOOGLE_MAPS_API_KEY && process.env.GOOGLE_MAPS_API_KEY.trim())
    || (process.env.GOOGLE_MAP_API_KEY && process.env.GOOGLE_MAP_API_KEY.trim())
    || (process.env.MAPS_API_KEY && process.env.MAPS_API_KEY.trim())
    || '';
}

app.get(['/js/maps-config.js', '/SIH/js/maps-config.js', '/maps-config.js', /.*maps-config\.js$/], (req, res) => {
  res.type('application/javascript');
  const apiKey = getMapsApiKey();
  res.send(`window.GOOGLE_MAPS_CONFIG = { apiKey: '${apiKey}' };\n`);
});

// REST config endpoint for maps
app.get('/api/config/maps', (req, res) => {
  res.json({ apiKey: getMapsApiKey() });
});

/**
 * Gemini Vision Analysis with Agricultural Guardrails
 */
async function analyzeCropImage(base64Data) {
  try {
    let pureBase64 = base64Data;
    let mimeType = 'image/jpeg';
    const match = base64Data.match(/^data:([^;]+);base64,(.+)$/);
    if (match) {
      mimeType = match[1];
      pureBase64 = match[2];
    }

    const prompt = `You are an expert Indian agricultural botanist and computer vision system for Krishi Mitra.
Analyze this image submitted by a farmer who wants to sell their crop.

STRICT INSTRUCTIONS & GUARDRAILS:
1. Determine if the image contains an agricultural crop, fruit, vegetable, grain, pulse, cash crop, or harvestable produce (e.g. Mango, Paddy, Wheat, Tomato, Potato, Onion, Cotton, Maize, Mustard, Chili, etc.).
2. TROLL / GUARDRAIL CHECK: If the image is NOT an agricultural crop (for example: a human selfie, a computer screen, a document, a wall, an animal, a car, furniture, weeds, illicit/harmful plant, random household object, or unidentifiable blur), you MUST return is_crop: false with a clear, polite explanation in rejection_reason.
3. If it IS an agricultural crop:
   - Identify the primary crop / commodity name in standard English (e.g. "Mango", "Paddy", "Wheat", "Tomato", "Potato").
   - Identify the variety if discernible (e.g. "Dasheri", "Langra", "Basmati", "Hybrid"). If uncertain or not discernible, leave as empty string or give most likely variety.
   - Assess visual quality / health (e.g. "Fresh, Good Quality", "Ripe", "Harvest Ready").
   - Provide a concise note summarizing the findings.

Respond ONLY with valid JSON matching this schema:
{
  "is_crop": boolean,
  "commodity": string,
  "variety": string,
  "health": string,
  "note": string,
  "rejection_reason": string
}`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${API_KEY}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType,
                  data: pureBase64
                }
              }
            ]
          }
        ],
        generationConfig: {
          responseMimeType: 'application/json'
        }
      }),
      signal: AbortSignal.timeout(15000)
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('[Vision API Error]', res.status, errText);
      throw new Error(`Gemini Vision API error: ${res.status}`);
    }

    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      throw new Error('Empty response from Gemini Vision');
    }
    const result = JSON.parse(text);
    return result;
  } catch (err) {
    console.error('[analyzeCropImage] Error:', err.message);
    throw err;
  }
}

// Route for crop image analysis with 10MB payload support
app.post('/api/analyze-crop', express.json({ limit: '10mb' }), async (req, res) => {
  try {
    const { image } = req.body || {};
    if (!image) {
      return res.status(400).json({ error: 'No image data provided' });
    }
    console.log('[API /api/analyze-crop] Analyzing crop image...');
    const result = await analyzeCropImage(image);
    console.log('[API /api/analyze-crop] Analysis result:', result);
    res.json(result);
  } catch (err) {
    console.error('[API /api/analyze-crop] Failure:', err.message);
    res.status(500).json({
      is_crop: false,
      rejection_reason: 'Unable to analyze image. Please try again with a clearer photo.'
    });
  }
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

// Master tool declarations registered with Gemini Live API (guaranteed unique by name)
const rawToolDeclarations = [
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

const uniqueToolsMap = new Map();
for (const tool of rawToolDeclarations) {
  uniqueToolsMap.set(tool.name, tool);
}
const allToolDeclarations = Array.from(uniqueToolsMap.values());

// Default setup payload (used as fallback and sandbox sessions)
function createDefaultSetupPayload() {
  return createPersonalizedSetupPayload({ language: 'hi', location: {} });
}

// Personalized setup payload (used by Krishi Mitra SIH live voice session)
function createPersonalizedSetupPayload({ language = 'hi', location = {}, profile = {} } = {}) {
  const today = new Date().toISOString().slice(0, 10);
  const extractedAddress = location.address || (location.district ? `${location.district}, ${location.state || 'Chhattisgarh'}` : 'Raipur, Chhattisgarh');
  const userLoc = `${location.district || 'Raipur'}, ${location.state || 'Chhattisgarh'}`;
  const meta = db.getSyncMeta(location.district || 'Raipur');

  const voiceSystemInstruction = `You are Krishi Mitra's (कृषि मित्र) generative voice assistant for farmers.
Current Date: ${today}
Location: ${userLoc}
Language: ${language === 'hi' ? 'Hindi' : 'English'}
Last Data Update: ${meta.last_updated || 'today'}
The user you are speaking to is currently located at: ${extractedAddress}. Prioritize this location for all logistical and market advice.

VOICE & CONVERSATIONAL RULES:
1. CRITICAL CURRENCY INSTRUCTION: NEVER use the word "dollars", "cents", or the "$" symbol. All prices are in Indian Rupees. When speaking English, ALWAYS say "Rupees" (e.g. "2200 Rupees per quintal"). When speaking Hindi, ALWAYS say "रुपये" (e.g. "2200 रुपये प्रति क्विंटल"). Hallucinating dollars is strictly prohibited under all circumstances.
2. Speak natural, conversational ${language === 'hi' ? 'Hindi (हिंदी)' : 'English'}.
3. STRICT SPOKEN CONCISENESS & PROACTIVE FOLLOW-UPS (MANDATORY):
   - YOU MUST NEVER REMAIN SILENT after executing any tool or rendering any card.
   - Summarize the key takeaway or insight in AT MOST 1 TO 2 SHORT CONCISE SENTENCES (~15-25 words max). NEVER give long spoken monologues; let the visual card display the detailed text while you speak only the core answer.
   - ALWAYS conclude your spoken turn with a proactive, relevant follow-up question (e.g. "आप कौन सा विकल्प चुनना चाहेंगे?", "Would you like me to check transport costs or nearby mandis?", "क्या आप इसके जैविक उपाय जानना चाहते हैं?"). Never leave the farmer hanging.
4. HEURISTIC RESTRAINT (AUDIO-ONLY FOR CASUAL & EMOTIONAL TALK):
   - High-density visual cards, comparisons, and menus must ONLY be invoked when structured visual data helps the farmer make decisions.
   - Reserve audio-only responses STRICTLY for emotional venting (e.g., 'Farming is exhausting today', 'खेती बहुत कठिन हो गई है'), greetings, or single-sentence factual clarifications. Never suppress a UI tool if the user explicitly asked for a comparison or a list.
   - If an existing card is on screen when the farmer shifts to casual talk or signals conclusion, call 'close_all_ui' to clear the screen!

STEP 0: INTENT SHAPE CLASSIFICATION (CRITICAL PRE-TOOL REASONING):
Classify the user's request into one of 5 canonical answer shapes before selecting a tool:
1. DIRECT_ANSWER (Superlative or single fact: "which is the closest mandi?", "where can I get the highest price for wheat?"):
   - The user seeks ONE decisive fact, entity, or superlative. NEVER emit a 6-item selector menu!
   - For closest mandi / nearest buyer: call 'find_buyers_ui' with answer_mode='DIRECT_ANSWER' (or type='market'). Renders a single-result card with distance and navigation.
   - For highest crop rate / superlative price: call 'render_detail_card_ui' with superlative='highest' and commodity='...'. Renders a focused single rate card highlighting the top-paying market.
2. BROWSABLE_LIST (Exploration / multiple choices: "show me nearby buyers", "list crops in Durg", "browse mandis"):
   - Call 'find_buyers_ui' with answer_mode='BROWSABLE_LIST', or call 'render_selector_menu_ui'. Renders a 6-item rectangular menu.
3. COMPARISON (Side-by-side evaluation: "Raipur vs Durg", "Drip vs Sprinkler", creative comparisons):
   - Call 'render_comparison_ui' with 'entity_a' and 'entity_b'. Renders side-by-side comparison.
4. DERIVED_ANALYSIS (Cross-dataset computation / set differences: "What does Raipur lack compared to Durg?"):
   - Call 'analyze_inventory_gap_ui' with source_district and target_district.
   - For unsupported multi-year regressions across unindexed historical variables: decline verbally via audio clearly and offer current live market data instead. Never hallucinate fake econometric data.
5. CLARIFICATION_NEEDED (Ambiguous prompts: "Tell me about mandis"):
   - DO NOT call any tool prematurely. Ask a focused clarifying audio question.

UNIVERSAL SEMANTIC VISUAL TOOLS & INTENT ROUTING:
5. PRIMITIVE 1: COMPARISON UI ('render_comparison_ui'):
   - Use when comparing ANY two entities: Mandis (Raipur vs Durg), crop varieties, farming techniques, foods/nutrition, or creative/pop culture topics.
   - Grounding Shield: If comparing mandis or market rates, pass commodity, market_a, and market_b. Automatically injects verified SQLite prices and distances.
   - Creative comparisons: Pass entity_a and entity_b with custom attributes and recommendations.
   - Spoken response: Highlight key trade-off in 1-2 short sentences, then proactively ask which option the farmer prefers.
6. PRIMITIVE 2: SELECTOR MENU UI ('render_selector_menu_ui'):
   - Use when displaying a choice menu of 1 to 6 rectangular options: browsing mandi commodities, picking crop varieties, selecting fertilizers, or government schemes.
   - Grounding Shield: If browsing mandi crops, pass district. Automatically injects verified local crops and modal rates.
   - Spoken response: Announce top items in 1-2 short sentences, then proactively invite farmer to select an option or say 'next'.
7. PRIMITIVE 3: DETAIL CARD UI ('render_detail_card_ui'):
   - Use for focused enlarged cards or modal views: single crop rates, recipes, technical guides, user location, driving directions, saved crops, and CRISIS RELIEF.
   - Single Crop Rate: Pass type='SINGLE_RATE', commodity, and location. For highest price queries, pass superlative='highest'. Grounding Shield injects real SQLite modal prices.
   - Driving Directions & Map Navigation: When the farmer asks for directions, route, navigation, or map for any mandi or destination, IMMEDIATELY call 'render_detail_card_ui' with type='LOCATION', location='[Destination]', title='Driving Directions to [Destination]'. Grounding Shield computes road distance, drive time, and Google Maps link. NEVER call 'open_sell_crop_form' for directions!
   - Mandi Contact Info: Pass type='CONTACT', market='...', title='... Contact Details'. If tool result indicates demo mock data (has_mock_data: true), verbally state that office phone numbers are demonstration examples, not verified real lines, and highlight the National Kisan Call Center helpline (1800-180-1551).
   - Recipes: Pass type='RECIPE', title, hero_metric (e.g. prep time), and sections (Ingredients, Steps).
   - Creative & Pop Culture Deep-Dives: Pass type='ANIME', type='ENTERTAINMENT', or type='TECHNICAL_GUIDE'.
   - Strict Grounding of Spoken Narration: Speak ONLY numbers, prices, and names present in the data returned by the tool.
7.5. BUYERS & MARKETS TOOL ('find_buyers_ui'):
   - Use to find buyers, traders, FPOs, or mandis within 300km. Set answer_mode='DIRECT_ANSWER' for single closest/nearest; answer_mode='BROWSABLE_LIST' for browsing. If results contain demo mock data, verbally state the demonstration disclaimer.
7.6. INVENTORY GAP ANALYSIS TOOL ('analyze_inventory_gap_ui'):
   - Use for cross-market set differences (e.g. "What does Raipur lack compared to Durg?"). Pass source_district and target_district.

EMPATHETIC CRISIS ROUTING:
8. WILDLIFE CROP DAMAGE & EMERGENCY DISASTERS:
   - When farmer reports crop destruction by wildlife (elephants / हाथी, wild boar, nilgai) or natural disasters:
     * IMMEDIATELY call 'render_detail_card_ui' with:
       type: 'CRISIS_RELIEF',
       title: 'Wildlife Crop Damage Compensation (RBC 6-4)',
       subtitle: 'Chhattisgarh Revenue & Forest Dept Guidelines',
       hero_badge: 'Emergency Relief',
       hero_metric: { label: 'MAX COMPENSATION', value: 'Up to ₹25,000 / ha', subvalue: 'Under RBC 6-4 Norms' },
       sections: [
         { title: 'Eligibility & 72-Hour Rule', items: ['Must report within 72 hours of damage to Patwari or Forest Guard', 'Field inspection by Joint Committee', 'Valid for all registered farmers & sharecroppers'] },
         { title: 'Documents Required', items: ['B-1 Khasra / Land Record Copy', 'Aadhaar Card & Bank Passbook', 'Photographs of damaged crop', 'Panchnama signed by Sarpanch & Patwari'] },
         { title: 'Emergency Helplines', items: ['Forest Dept Emergency: 1926', 'Kisan Call Center: 1800-180-1551'] }
       ],
       action_buttons: [
         { id: 'call_forest', label: '📞 Call 1926 (Forest Dept)', type: 'tel', payload: 'tel:1926' },
         { id: 'call_kisan', label: '📞 Call 1800-180-1551 (Kisan Helpline)', type: 'tel', payload: 'tel:18001801551' }
       ]
     * Spoken response: Express deep sympathy, state the strict 72-hour reporting rule, mention compensation up to ₹25,000/ha under RBC 6-4, and proactively ask if they want emergency contact details.

CLOSED-LOOP INTERACTIVE INTENT ROUTING:
9. INTERACTIVE TAPS & SELECTIONS (RULE: VISUAL PROGRESSION):
   - When receiving a 'client_selection' event (user tapped a button/card), advance the visual state with 'render_detail_card_ui' or clear with 'close_all_ui'. Validate selection warmly in 1 short sentence.

SELL CROP WORKFLOW & HARDWARE CONTROL:
10. SELL CROP INTENT:
    - When farmer states they want to sell produce ("I want to sell my crop", "मुझे फसल बेचनी है"):
      * Call 'open_sell_crop_form' immediately.
      * Ask step-by-step: Step 1 (Crop), Step 2 (Variety), Step 3 (Quantity), Step 4 (Harvest Freshness). Ask only ONE question at a time.
      * Silently call 'autofill_crop_form' as the farmer speaks answers.
      * Call 'submit_crop_form' when they say "save it", "done", or "jama karo".
11. VOICE-TRIGGERED CAMERA:
    - When requested ("open camera", "take photo", "camera kholo"), IMMEDIATELY call 'trigger_camera'. Spoken response: "I need your permission to open the camera. Please tap the pulsing button on your screen."

IMPLICIT DISMISSAL & AGENTIC VERIFICATION:
12. CLOSE SCREEN ON CONCLUSION OR TOPIC SHIFT (AUDIO-ONLY TRANSITIONS ONLY):
    - Call 'close_all_ui' ONLY when transitioning to AUDIO-ONLY talk (small talk, general questions, emotional venting) or explicit dismiss ("close", "band karo", "hata do").
    - NEVER call 'close_all_ui' when calling ANY visual UI tool ('render_selector_menu_ui', 'render_detail_card_ui', 'render_comparison_ui', 'find_buyers_ui', etc.). Opening a new visual card automatically mounts and cleanly replaces whatever was previously on screen.
    - NEVER claim you cleared the screen unless 'close_all_ui' was executed in that turn or latest verified screen fact is IDLE.
13. STRICT CONTINUOUS SCREEN GROUNDING (NEVER NARRATE FROM MEMORY):
    - HARD RULE: NEVER narrate or assume screen state from memory. Speak ONLY from the latest verified screen fact: "[System: Screen currently shows: ...]". If IDLE, screen is clear. If isMockData is true, verbally state demo disclaimer.
14. AGENTIC RADIUS FALLBACK:
    - If a specific crop in a location has no database records, do not show an empty card. Search nearest location with data and proactively inform the farmer.`;

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
      contextWindowCompression: {
        triggerTokens: 25000,
        slidingWindow: { targetTokens: 15000 }
      },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      realtimeInputConfig: {
        automaticActivityDetection: {
          endOfSpeechSensitivity: 'END_SENSITIVITY_LOW',
          silenceDurationMs: 700
        }
      }
    }
  };
}

const wss = new WebSocket.Server({ noServer: true });

// Strictly intercept WebSocket upgrade requests for /live
// Verify Google ID token and enforce allowed owner email before WebSocket upgrades
server.on('upgrade', async (request, socket, head) => {
  try {
    const reqUrl = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    const pathname = (reqUrl.pathname || '').replace(/\/+$/, '') || '/';
    if (pathname === '/live') {
      // Extract token from query param (?token=), Authorization header, or sec-websocket-protocol
      let token = reqUrl.searchParams.get('token');
      if (!token && request.headers.authorization && request.headers.authorization.startsWith('Bearer ')) {
        token = request.headers.authorization.slice(7);
      }
      if (!token && request.headers['sec-websocket-protocol']) {
        token = request.headers['sec-websocket-protocol'];
      }

      const authResult = await auth.verifyGoogleIdToken(token);

      if (!authResult.authorized) {
        console.warn(`[AUTH] unauthorized email attempted /live connection: ${authResult.email || 'unauthenticated'} (reason: ${authResult.reason})`);
        socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Type: text/plain\r\nContent-Length: 12\r\n\r\nUnauthorized');
        return;
      }

      console.log('[AUTH] Authorized owner connected to /live:', authResult.email);
      wss.handleUpgrade(request, socket, head, (clientWs) => {
        clientWs.userEmail = authResult.email;
        wss.emit('connection', clientWs, request);
      });
    } else {
      socket.destroy();
    }
  } catch (err) {
    console.error('[AUTH] WebSocket upgrade error:', err.message);
    socket.destroy();
  }
});

const hrMs = () => Number(process.hrtime.bigint()) / 1e6;
const jsonlLogPath = path.resolve(__dirname, 'latency-log.jsonl');

const appendLog = (entry) => {
  try {
    fs.appendFileSync(jsonlLogPath, JSON.stringify(entry) + '\n');
  } catch (err) {
    console.error('[LOGGER ERROR]:', err.message);
  }
};

// =============================================================
// CONTINUOUS SCREEN GROUNDING ENGINE (SINGLE CHOKE POINT)
// Generates a compact, one-line ground truth fact for Gemini Live
// =============================================================
function buildVerifiedScreenFact(parsed = {}, screenState = {}, lastSelector = {}) {
  const isFailed = parsed.status === 'failed' || parsed.status === 'error';
  const isIdle = parsed.view === 'IDLE' || (!isFailed && parsed.rendered_items === 0 && (!parsed.view || parsed.view === 'IDLE'));

  if (isFailed) {
    const errorMsg = parsed.error || 'DOM render error';
    return `[System: Screen currently shows: IDLE - Component "${parsed.view || 'UI'}" failed to render (${errorMsg}). Screen is clear.]`;
  }

  if (isIdle) {
    return `[System: Screen currently shows: IDLE - Screen is clear, no visual cards or menus open]`;
  }

  const view = parsed.view || screenState.view || 'render_detail_card_ui';
  const primitive = parsed.primitive || screenState.primitive || '';
  const title = parsed.title || screenState.title || lastSelector?.title || 'Screen Content';

  // 1. Selector Menu Primitive (render_selector_menu_ui, OPTIONS_MENU, show_commodity_list_ui, find_buyers_ui list)
  if (primitive === 'selector_menu' || view === 'render_selector_menu_ui' || view === 'OPTIONS_MENU' || view === 'show_commodity_list_ui') {
    const rawItems = parsed.items || parsed.options || screenState.options || lastSelector?.options || [];
    const itemNames = (Array.isArray(rawItems) ? rawItems : []).map(item => {
      if (typeof item === 'string') return item;
      return item?.label || item?.id || item?.name || '';
    }).filter(Boolean);
    const count = typeof parsed.rendered_items === 'number' && parsed.rendered_items > 0 ? parsed.rendered_items : (itemNames.length || 6);
    const itemsStr = itemNames.length > 0 ? `: ${itemNames.slice(0, 6).join(', ')}` : '';
    return `[System: Screen currently shows: render_selector_menu_ui - '${title}' - ${count} items${itemsStr}]`;
  }

  // 2. Detail Card Primitive (render_detail_card_ui, DETAIL_WINDOW, SINGLE_RATE, LOCATION, BUYER, CONTACT, CRISIS_RELIEF, etc.)
  if (primitive === 'detail_card' || view === 'render_detail_card_ui' || view === 'DETAIL_WINDOW' || view === 'SINGLE_RATE' || view === 'LOCATION') {
    const cardType = (parsed.card_type || parsed.type || screenState.type || 'DETAIL').toUpperCase();
    const isMock = Boolean(parsed.isMockData !== undefined ? parsed.isMockData : (parsed.has_mock_data !== undefined ? parsed.has_mock_data : (screenState.isMockData || screenState.has_mock_data)));
    const mockStr = isMock ? ', isMockData: true' : '';
    return `[System: Screen currently shows: detail_card - '${title}' - ${cardType} type${mockStr}]`;
  }

  // 3. Comparison Primitive (render_comparison_ui, TWO_WAY_COMPARISON, compare_markets_ui)
  if (primitive === 'comparison' || view === 'render_comparison_ui' || view === 'TWO_WAY_COMPARISON' || view === 'compare_markets_ui') {
    const entA = parsed.entity_a || parsed.market_a || screenState.entity_a || screenState.market_a;
    const entB = parsed.entity_b || parsed.market_b || screenState.entity_b || screenState.market_b;
    const entStr = (entA && entB) ? ` - Comparison between ${entA} vs ${entB}` : ' - Comparison view';
    return `[System: Screen currently shows: render_comparison_ui - '${title}'${entStr}]`;
  }

  // 4. Sell Crop Form (SELL_CROP_FORM, open_sell_crop_form, autofill_crop_form)
  if (view === 'SELL_CROP_FORM' || view === 'open_sell_crop_form' || view === 'autofill_crop_form') {
    const comm = parsed.commodity || screenState.commodity || screenState.fields?.commodity;
    const commStr = comm ? ` (crop: ${comm})` : '';
    return `[System: Screen currently shows: SELL_CROP_FORM - '${title || 'Sell Your Crop'}' - Form open${commStr}]`;
  }

  // 5. Default Universal Fallback for any other current or future UI view
  const count = parsed.rendered_items ?? screenState.rendered_items ?? 1;
  return `[System: Screen currently shows: ${view} - '${title}' - ${count} items rendered]`;
}

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
  let turnHasCloseAllUi = false;

  // Session metadata if initialized by SIH voice mode
  let isSihVoiceSession = false;
  let voiceSessionId = null;
  let voiceClientId = null;
  let sessionLocation = null;
  let setupSent = false;

  // Pre-initialize sessionSetupPayload with full tool declarations and instructions
  let sessionSetupPayload = createPersonalizedSetupPayload({ language: 'hi', location: {} });

  // Log the registered tool names right before connecting
  const toolNames = allToolDeclarations.map(t => t.name);
  console.log(`[GEMINI LIVE SETUP] Registering ${toolNames.length} tools with Gemini API:`, JSON.stringify(toolNames));

  // Live Bidirectional Screen State Ledger
  let currentScreenState = {
    view: 'IDLE',
    active_entity: null,
    visible_data: {}
  };
  let lastSelectorScreenState = null;
  const verifiedScreenHistory = [];
  let lastInjectedScreenFact = null;
  let lastVisualToolMountTimestamp = 0;
  let lastMountedVisualToolName = null;
  let lastMountedVisualToolArgs = null;
  let lastCloseRequestedTimestamp = 0;

  function injectVerifiedScreenFact(factText, source = 'ui_verification') {
    if (!factText) return;
    if (factText === lastInjectedScreenFact) {
      // Deduplicate identical screen fact to prevent ballooning prompt tokens
      return;
    }
    const nowIso = new Date().toISOString();
    const entry = {
      timestamp: Date.now(),
      iso: nowIso,
      fact: factText,
      source,
      state: { ...currentScreenState }
    };
    verifiedScreenHistory.push(entry);
    lastInjectedScreenFact = factText;

    console.log(`[VERIFIED SCREEN LOG] [${nowIso}] ${factText}`);

    // Relay verified screen state update to frontend for test assertions & UI sync
    if (clientWs && clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(JSON.stringify({
        type: 'verified_screen_update',
        timestamp: entry.timestamp,
        iso: entry.iso,
        fact: factText,
        state: entry.state
      }));
    }

    // Continuously ground Gemini Live with verified ground truth
    if (geminiWs && geminiWs.readyState === WebSocket.OPEN) {
      const factTurn = {
        clientContent: {
          turns: [
            {
              role: 'user',
              parts: [{ text: factText }]
            }
          ],
          turnComplete: false
        }
      };
      geminiWs.send(JSON.stringify(factTurn));
      console.log(`[AGENTIC SCREEN GROUNDING] 📡 Injected verified screen fact to Gemini Live: ${factText}`);
    }
  }

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
    sendSetupIfReady();
  });

  // Agentic UI Verification handshake tracker for active session
  const pendingUIVerifications = new Map();

  function waitForUIVerification(expectedView, timeoutMs = 2500) {
    return new Promise((resolve) => {
      const id = Date.now() + '_' + Math.random().toString(36).slice(2, 7);
      const timer = setTimeout(() => {
        pendingUIVerifications.delete(id);
        console.warn(`[AGENTIC UI VERIFICATION] ⚠️ Timeout waiting for verification of "${expectedView}" after ${timeoutMs}ms`);
        resolve({ status: 'timeout', view: expectedView, rendered_items: 0 });
      }, timeoutMs);

      pendingUIVerifications.set(id, {
        expectedView,
        resolve: (data) => {
          clearTimeout(timer);
          pendingUIVerifications.delete(id);
          resolve(data);
        }
      });
    });
  }

  // Relay messages from Gemini Live -> Browser
  geminiWs.on('message', async (data) => {
    const now = hrMs();
    try {
      const parsed = JSON.parse(data.toString());
      if (parsed.error) {
        console.error('[GEMINI ERROR]:', JSON.stringify(parsed.error));
      }

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
        const visualToolNames = [
          'render_comparison_ui', 'render_selector_menu_ui', 'render_detail_card_ui',
          'find_buyers_ui', 'analyze_inventory_gap_ui', 'show_commodity_list_ui',
          'show_single_rate_ui', 'show_location_ui', 'compare_markets_ui',
          'show_options_menu', 'show_detail_window', 'open_sell_crop_form'
        ];
        const hasVisualToolInBatch = parsed.toolCall.functionCalls.some(fc => visualToolNames.includes(fc.name));
        let activeVisualToolMountedInBatch = false;

        for (const fc of parsed.toolCall.functionCalls) {
          if (fc.name === 'close_all_ui' || fc.name === 'close_ui_template') {
            turnHasCloseAllUi = true;
          }
          const isVisual = visualToolNames.includes(fc.name);

          // 1. General In-Batch Redundancy Guard: If batch contains multiple visual tools, allow only the first
          if (isVisual) {
            if (activeVisualToolMountedInBatch) {
              console.log(`[RACE CONDITION SHIELD] 🛡️ Suppressed redundant visual tool "${fc.name}" because visual tool "${lastMountedVisualToolName}" already mounted in this turn.`);
              const toolResponse = {
                toolResponse: {
                  functionResponses: [
                    {
                      id: fc.id,
                      name: fc.name,
                      response: {
                        result: {
                          status: 'success',
                          note: `Superseded by active visual tool (${lastMountedVisualToolName}) in same turn batch`
                        }
                      }
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
                result: { success: true, suppressed_redundant: true }
              }));
              continue;
            }

            // 2. Cross-Turn Rapid Duplicate Debounce (< 1500ms for exact duplicate call)
            const isDuplicateRapidCall = (Date.now() - (lastVisualToolMountTimestamp || 0)) < 1500 &&
              lastMountedVisualToolName === fc.name &&
              JSON.stringify(lastMountedVisualToolArgs) === JSON.stringify(fc.args);

            if (isDuplicateRapidCall) {
              console.log(`[RACE CONDITION SHIELD] 🛡️ Debounced rapid duplicate visual tool "${fc.name}" (${Date.now() - lastVisualToolMountTimestamp}ms since last call).`);
              const toolResponse = {
                toolResponse: {
                  functionResponses: [
                    {
                      id: fc.id,
                      name: fc.name,
                      response: {
                        result: {
                          status: 'success',
                          note: 'Canvas already displays requested view (debounced)'
                        }
                      }
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
                result: { success: true, debounced: true }
              }));
              continue;
            }

            activeVisualToolMountedInBatch = true;
            lastVisualToolMountTimestamp = Date.now();
            lastMountedVisualToolName = fc.name;
            lastMountedVisualToolArgs = fc.args;
          }

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

          // Client-side Dismissal Tool: triggers outro animation & unmounting for visual templates
          if (fc.name === 'close_ui_template' || fc.name === 'close_all_ui') {
            // ONLY suppress close_all_ui if another visual tool is mounting in the EXACT SAME turn batch!
            // Standalone close_all_ui must NEVER be suppressed under any circumstances!
            if (hasVisualToolInBatch) {
              console.log(`[RACE CONDITION SHIELD] 🛡️ Suppressed redundant ${fc.name} because a new visual tool is mounting in the same turn batch.`);
              const toolResponse = {
                toolResponse: {
                  functionResponses: [
                    {
                      id: fc.id,
                      name: fc.name,
                      response: {
                        result: {
                          status: 'superseded',
                          closed_all: false,
                          note: 'Canvas will show active visual tool rendered in this turn'
                        }
                      }
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
                result: { success: true, suppressed_redundant: true, closed_all: false }
              }));
              continue;
            }

            lastCloseRequestedTimestamp = Date.now();
            console.log(`[CLIENT TOOL CALL] Relaying ${fc.name} to frontend clientWs:`, fc.args);
            clientWs.send(JSON.stringify({
              type: 'toolCall',
              callId: fc.id,
              name: fc.name,
              args: fc.args
            }));

            // Wait for client to actually remove the DOM elements and send verified IDLE
            const verification = await waitForUIVerification('IDLE', 1200);
            const isClosed = verification && verification.status === 'success' && verification.view === 'IDLE';

            if (isClosed) {
              currentScreenState = {
                view: 'IDLE',
                active_entity: null,
                visible_data: {},
                rendered_items: 0,
                verified: true,
                timestamp: Date.now()
              };
            }

            const toolResponse = {
              toolResponse: {
                functionResponses: [
                  {
                    id: fc.id,
                    name: fc.name,
                    response: {
                      result: {
                        status: isClosed ? 'success' : 'completed',
                        closed_all: true,
                        closed: fc.args?.template_name || 'all_ui',
                        selected: fc.args?.selected_option_id || 'unknown',
                        currently_visible_on_screen: currentScreenState,
                        spoken_summary_hint: 'I have closed the screen. What else would you like to know?'
                      }
                    }
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
              result: { success: true, closed_all: true }
            }));
            continue;
          }

          const toolContext = {
            clientWs,
            geminiWs,
            setScreenState: (state) => { currentScreenState = state; },
            getScreenState: () => currentScreenState,
            getLastSelectorState: () => lastSelectorScreenState,
            waitForUIVerification
          };

          // Universal Semantic Visual Tools: render_comparison_ui, render_selector_menu_ui, render_detail_card_ui, find_buyers_ui, analyze_inventory_gap_ui
          if (fc.name === 'render_comparison_ui' || fc.name === 'render_selector_menu_ui' || fc.name === 'render_detail_card_ui' || fc.name === 'find_buyers_ui' || fc.name === 'analyze_inventory_gap_ui') {
            console.log(`[GENERATIVE UI TOOL CALL] ${fc.name} invoked with:`, fc.args);
            const toolResult = await tools.executeTool(fc.name, fc.args, sessionLocation, toolContext);
            if (toolResult.currently_visible_on_screen) {
              currentScreenState = toolResult.currently_visible_on_screen;
            }

            if ((fc.name === 'render_selector_menu_ui' || fc.name === 'find_buyers_ui') && toolResult.status === 'success') {
              const td = toolResult.templateData || {};
              lastSelectorScreenState = {
                view: toolResult.currently_visible_on_screen?.view || 'render_selector_menu_ui',
                primitive: 'selector_menu',
                title: toolResult.title || td.title,
                district: toolResult.district || td.district,
                market: toolResult.market || td.market,
                options: toolResult.options || td.options?.map(o => o.label || o.id),
                total_items: toolResult.total_items || td.total_items
              };
            }

            const { templateData, ...geminiResult } = toolResult;
            const toolResponse = {
              toolResponse: {
                functionResponses: [
                  {
                    id: fc.id,
                    name: fc.name,
                    response: { result: geminiResult }
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
              result: geminiResult
            }));
            continue;
          }

          // 1. Unified Commodity List UI Tool: queries SQLite, slices 6 items, renders options menu & verifies render
          if (fc.name === 'show_commodity_list_ui' || fc.name === 'show_options_menu') {
            console.log(`[UNIFIED UI TOOL CALL] ${fc.name} invoked with:`, fc.args);
            const toolResult = await tools.executeTool('show_commodity_list_ui', fc.args, sessionLocation, toolContext);
            if (toolResult.currently_visible_on_screen) {
              currentScreenState = toolResult.currently_visible_on_screen;
              const td = toolResult.templateData || {};
              lastSelectorScreenState = {
                view: 'OPTIONS_MENU',
                primitive: 'selector_menu',
                title: toolResult.title || td.title,
                district: toolResult.district || td.district,
                market: toolResult.market || td.market,
                options: toolResult.options || td.options?.map(o => o.label || o.id),
                total_items: toolResult.total_items || td.total_items
              };
            }

            const { templateData, ...geminiResult } = toolResult;
            const toolResponse = {
              toolResponse: {
                functionResponses: [
                  {
                    id: fc.id,
                    name: fc.name,
                    response: { result: geminiResult }
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
              result: geminiResult
            }));
            continue;
          }

          // 2. Unified Single Rate UI Tool: queries SQLite, renders focused rate card & verifies render
          if (fc.name === 'show_single_rate_ui') {
            console.log(`[UNIFIED UI TOOL CALL] show_single_rate_ui invoked with:`, fc.args);
            const toolResult = await tools.executeTool('show_single_rate_ui', fc.args, sessionLocation, toolContext);
            if (toolResult.currently_visible_on_screen) {
              currentScreenState = toolResult.currently_visible_on_screen;
            }

            const { templateData, ...geminiResult } = toolResult;
            const toolResponse = {
              toolResponse: {
                functionResponses: [
                  {
                    id: fc.id,
                    name: fc.name,
                    response: { result: geminiResult }
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
              result: geminiResult
            }));
            continue;
          }

          // 3. Unified Location UI Tool: renders verified location card & verifies render
          if (fc.name === 'show_location_ui') {
            console.log(`[UNIFIED UI TOOL CALL] show_location_ui invoked with:`, fc.args);
            if (fc.args?.address) {
              sessionLocation = sessionLocation || {};
              sessionLocation.address = fc.args.address;
              if (fc.args.district) sessionLocation.district = fc.args.district;
              if (fc.args.state) sessionLocation.state = fc.args.state;
            }
            const toolResult = await tools.executeTool('show_location_ui', fc.args, sessionLocation, toolContext);
            if (toolResult.currently_visible_on_screen) {
              currentScreenState = toolResult.currently_visible_on_screen;
            }

            const { templateData, ...geminiResult } = toolResult;
            const toolResponse = {
              toolResponse: {
                functionResponses: [
                  {
                    id: fc.id,
                    name: fc.name,
                    response: { result: geminiResult }
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
              result: geminiResult
            }));
            continue;
          }

          // 4. UI Comparison Tool: renders two-way comparison on frontend DOM & returns trade-off summary to Gemini
          if (fc.name === 'compare_markets_ui') {
            console.log(`[UI TOOL CALL] compare_markets_ui invoked with:`, fc.args);
            const toolResult = await tools.executeTool(fc.name, fc.args, sessionLocation, toolContext);
            if (toolResult.currently_visible_on_screen) {
              currentScreenState = toolResult.currently_visible_on_screen;
            }

            const { templateData, ...geminiResult } = toolResult;
            const toolResponse = {
              toolResponse: {
                functionResponses: [
                  {
                    id: fc.id,
                    name: fc.name,
                    response: { result: geminiResult }
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
              result: geminiResult
            }));
            continue;
          }

          // Enlarged Detail Window: renders map, contact, or trends on frontend DOM
          if (fc.name === 'show_detail_window') {
            console.log(`[UI TOOL CALL] show_detail_window invoked with:`, fc.args);
            const toolResult = await tools.executeTool(fc.name, fc.args, sessionLocation);
            // Mark state as PENDING until frontend confirms successful DOM rendering
            currentScreenState = {
              view: 'PENDING',
              requested_view: 'DETAIL_WINDOW',
              type: fc.args?.type || fc.args?.option_id || 'DETAIL',
              timestamp: Date.now()
            };
            console.log(`[AGENTIC UI VERIFICATION] Screen state set to PENDING for show_detail_window`);

            // Sync sessionLocation if user verbally updated location details
            if ((fc.args?.type === 'LOCATION' || fc.args?.option_id === 'location') && fc.args?.data) {
              const updatedAddr = fc.args.data.Address || fc.args.data.address;
              if (updatedAddr) {
                sessionLocation = sessionLocation || {};
                sessionLocation.address = updatedAddr;
                if (fc.args.data.District || fc.args.data.district) {
                  sessionLocation.district = fc.args.data.District || fc.args.data.district;
                }
                if (fc.args.data.State || fc.args.data.state) {
                  sessionLocation.state = fc.args.data.State || fc.args.data.state;
                }
                console.log('[LOCATION SYNC] Updated sessionLocation to:', sessionLocation);
              }
            }

            clientWs.send(JSON.stringify({
              type: 'toolCall',
              callId: fc.id,
              name: fc.name,
              args: fc.args,
              templateData: toolResult.templateData
            }));

            const { templateData, ...geminiResult } = toolResult;
            const toolResponse = {
              toolResponse: {
                functionResponses: [
                  {
                    id: fc.id,
                    name: fc.name,
                    response: { result: geminiResult }
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
              result: geminiResult
            }));
            continue;
          }



          // Go Back To Options: reverses zoom into multi-option menu
          if (fc.name === 'go_back_to_options') {
            console.log(`[CLIENT TOOL CALL] Relaying go_back_to_options to frontend clientWs:`, fc.args);
            clientWs.send(JSON.stringify({
              type: 'toolCall',
              callId: fc.id,
              name: fc.name,
              args: fc.args
            }));

            const resetVisited = Boolean(fc.args && fc.args.reset_visited);
            let spokenHint = '';

            if (lastSelectorScreenState) {
              const title = lastSelectorScreenState.title || 'Options Menu';
              const district = lastSelectorScreenState.district || lastSelectorScreenState.market || '';
              const isCommodities = title.toLowerCase().includes('commodit') || title.toLowerCase().includes('crop') || title.toLowerCase().includes('फसल');
              const isBuyers = title.toLowerCase().includes('buyer') || title.toLowerCase().includes('खरीदार') || title.toLowerCase().includes('व्यापारी');

              if (isCommodities) {
                spokenHint = `Taking you back to the commodities list${district ? ` for ${district}` : ''}. Which crop would you like to check?`;
              } else if (isBuyers) {
                spokenHint = `Taking you back to the buyers list${district ? ` in ${district}` : ''}. Which buyer would you like to view?`;
              } else {
                spokenHint = `Taking you back to ${title}. What would you like to explore?`;
              }

              currentScreenState = {
                view: lastSelectorScreenState.view || 'OPTIONS_MENU',
                primitive: 'selector_menu',
                title,
                district: lastSelectorScreenState.district,
                market: lastSelectorScreenState.market,
                options: Array.isArray(lastSelectorScreenState.options) ? lastSelectorScreenState.options : [],
                reset_visited: resetVisited
              };
            } else {
              currentScreenState = {
                view: 'OPTIONS_MENU',
                title: 'What would you like to know next?',
                reset_visited: resetVisited,
                options: ['Map & Navigation', 'Contact Info', 'Rates & Trends']
              };
              spokenHint = resetVisited
                ? 'Here are all the options again. What would you like to see?'
                : 'Okay, we are back at the options menu. What else would you like to see?';
            }

            const toolResponse = {
              toolResponse: {
                functionResponses: [
                  {
                    id: fc.id,
                    name: fc.name,
                    response: {
                      result: {
                        status: 'success',
                        navigated_back: true,
                        reset_visited: resetVisited,
                        currently_visible_on_screen: currentScreenState,
                        spoken_summary_hint: spokenHint
                      }
                    }
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
              result: { navigated_back: true, reset_visited: resetVisited }
            }));
            continue;
          }

          // Get Current Screen Context: ground Gemini on active screen visual
          if (fc.name === 'get_current_screen_context') {
            console.log(`[SCREEN CONTEXT TOOL CALL] Grounding Gemini on current screen:`, currentScreenState);
            const geminiResult = {
              status: 'success',
              currently_visible_on_screen: currentScreenState
            };
            const toolResponse = {
              toolResponse: {
                functionResponses: [
                  {
                    id: fc.id,
                    name: fc.name,
                    response: { result: geminiResult }
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
              result: geminiResult
            }));
            continue;
          }

          // Sell Crop Form: opens crop selling form on frontend DOM
          if (fc.name === 'open_sell_crop_form') {
            console.log(`[UI TOOL CALL] open_sell_crop_form invoked with:`, fc.args);
            const toolResult = await tools.executeTool(fc.name, fc.args, sessionLocation);
            // Mark state as PENDING until frontend confirms successful DOM rendering
            currentScreenState = {
              view: 'PENDING',
              requested_view: 'SELL_CROP_FORM',
              timestamp: Date.now()
            };
            console.log(`[AGENTIC UI VERIFICATION] Screen state set to PENDING for open_sell_crop_form`);

            clientWs.send(JSON.stringify({
              type: 'toolCall',
              callId: fc.id,
              name: fc.name,
              args: fc.args
            }));

            const { templateData, ...geminiResult } = toolResult;
            const toolResponse = {
              toolResponse: {
                functionResponses: [
                  {
                    id: fc.id,
                    name: fc.name,
                    response: { result: geminiResult }
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
              result: geminiResult
            }));
            continue;
          }

          // Autofill Crop Form: dynamically updates fields in Sell Crop Form
          if (fc.name === 'autofill_crop_form') {
            console.log(`[UI TOOL CALL] autofill_crop_form invoked with:`, fc.args);
            const toolResult = await tools.executeTool(fc.name, fc.args, sessionLocation);
            if (toolResult.currently_visible_on_screen) {
              currentScreenState = toolResult.currently_visible_on_screen;
            }

            clientWs.send(JSON.stringify({
              type: 'toolCall',
              callId: fc.id,
              name: fc.name,
              args: fc.args
            }));

            const { templateData, ...geminiResult } = toolResult;
            const toolResponse = {
              toolResponse: {
                functionResponses: [
                  {
                    id: fc.id,
                    name: fc.name,
                    response: { result: geminiResult }
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
              result: geminiResult
            }));
            continue;
          }

          // Submit Crop Form: triggers outro animation & success checkmark sequence
          if (fc.name === 'submit_crop_form') {
            console.log(`[UI TOOL CALL] submit_crop_form invoked with:`, fc.args);
            const toolResult = await tools.executeTool(fc.name, fc.args, sessionLocation);
            currentScreenState = {
              view: 'IDLE',
              active_entity: null,
              visible_data: {}
            };

            clientWs.send(JSON.stringify({
              type: 'toolCall',
              callId: fc.id,
              name: fc.name,
              args: fc.args
            }));

            const { templateData, ...geminiResult } = toolResult;
            const toolResponse = {
              toolResponse: {
                functionResponses: [
                  {
                    id: fc.id,
                    name: fc.name,
                    response: { result: geminiResult }
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
              result: geminiResult
            }));
            continue;
          }

          // Trigger Camera: programmatically opens camera overlay on frontend
          if (fc.name === 'trigger_camera') {
            console.log(`[UI TOOL CALL] trigger_camera invoked with:`, fc.args);
            const toolResult = await tools.executeTool(fc.name, fc.args, sessionLocation);
            // Mark state as PENDING until frontend confirms camera prompt/modal rendered
            currentScreenState = {
              view: 'PENDING',
              requested_view: 'CAMERA_MODAL',
              timestamp: Date.now()
            };
            console.log(`[AGENTIC UI VERIFICATION] Screen state set to PENDING for trigger_camera`);

            clientWs.send(JSON.stringify({
              type: 'toolCall',
              callId: fc.id,
              name: fc.name,
              args: fc.args
            }));

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
            continue;
          }

          // Paginate Options: navigates pages of rectangular option cards
          if (fc.name === 'paginate_options') {
            console.log(`[UI TOOL CALL] paginate_options invoked with:`, fc.args);
            const toolResult = await tools.executeTool(fc.name, fc.args, sessionLocation, toolContext);
            if (toolResult.status !== 'failed') {
              clientWs.send(JSON.stringify({
                type: 'toolCall',
                callId: fc.id,
                name: fc.name,
                args: fc.args
              }));
              if (toolResult.currently_visible_on_screen) {
                currentScreenState = toolResult.currently_visible_on_screen;
                if (lastSelectorScreenState) {
                  lastSelectorScreenState.page = toolResult.page;
                  lastSelectorScreenState.total_pages = toolResult.total_pages;
                  lastSelectorScreenState.options = toolResult.options;
                }
              }
            }

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
              status: toolResult.status === 'failed' ? 'failed' : 'completed',
              result: toolResult
            }));
            continue;
          }

          if (fc.name === 'get_current_screen_context') {
            fc.args = {
              ...(fc.args || {}),
              screenState: currentScreenState,
              verified_screen_fact: lastInjectedScreenFact
            };
          }

          const toolResult = await tools.executeTool(fc.name, fc.args, sessionLocation);

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
        console.log(`${getRelPrefix()} [SPEECH TEXT: USER] "${userText.trim()}"`);
        clientWs.send(JSON.stringify({
          type: 'user_transcript',
          text: userText
        }));
      }

      // Assistant Speech Transcription (from outputAudioTranscription)
      if (parsed.serverContent?.outputAudioTranscription?.text || parsed.serverContent?.outputTranscription?.text) {
        const text = parsed.serverContent.outputAudioTranscription?.text || parsed.serverContent.outputTranscription?.text;
        speechTextAccum += text;
        console.log(`${getRelPrefix()} [SPEECH TEXT: GEMINI] "${text.trim()}"`);
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
        if (speechTextAccum.trim()) {
          console.log(`[TURN #${turnIndex} ASSISTANT TRANSCRIPT] "${speechTextAccum.trim()}"`);
        }

        // --- ENFORCEMENT SHIELD: VERIFY CLOSURE CLAIMS AGAINST ACTUAL TOOL CALLS ---
        const transcriptLower = speechTextAccum.toLowerCase();
        const closureRegex = /(?:cleared|closed|dismissed|removed|taken off)\s+(?:the\s+)?(?:screen|card)|screen\s+(?:hata\s+di|band\s+kar\s+di|close\s+kar\s+di|saaf\s+kar\s+di)|(?:hata|band)\s+kar\s+di\s+hai/i;
        const claimsClosure = closureRegex.test(transcriptLower);

        if (claimsClosure && !turnHasCloseAllUi && currentScreenState && currentScreenState.view !== 'IDLE') {
          const matchPhrase = transcriptLower.match(closureRegex)?.[0] || 'closure claim';
          console.warn(`[ENFORCEMENT SHIELD] ⚠️ Gemini verbally claimed screen closure ("${matchPhrase}") without calling close_all_ui! Auto-enforcing DOM closure.`);
          lastCloseRequestedTimestamp = Date.now();
          clientWs.send(JSON.stringify({
            type: 'toolCall',
            callId: 'auto_close_' + Date.now(),
            name: 'close_all_ui',
            args: { reason: `Auto-enforcing verbal closure claim ("${matchPhrase}")` }
          }));
          currentScreenState = {
            view: 'IDLE',
            active_entity: null,
            visible_data: {},
            rendered_items: 0,
            verified: true,
            timestamp: Date.now()
          };
          const screenFact = buildVerifiedScreenFact({ view: 'IDLE', status: 'success', rendered_items: 0 });
          injectVerifiedScreenFact(screenFact, 'enforcement_shield_close');
        }

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
    console.error('[DEBUG-MIC] [GEMINI ERROR]:', err.message);
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(JSON.stringify({ type: 'error', error: err.message }));
    }
  });

  geminiWs.on('close', (code, reason) => {
    const reasonStr = reason ? reason.toString() : '';
    console.log(`[GEMINI] Connection closed (${code}: ${reasonStr})`);
    if (clientWs.readyState === WebSocket.OPEN) {
      if (code !== 1000) {
        clientWs.send(JSON.stringify({
          type: 'error',
          error: reasonStr ? `Gemini disconnected (${code}: ${reasonStr})` : `Gemini disconnected (${code})`
        }));
      }
      clientWs.close(code === 1000 ? 1000 : 1011, reasonStr || 'Gemini connection closed');
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

      sessionLocation = parsed.location || {};
      sessionSetupPayload = createPersonalizedSetupPayload({
        language: parsed.language || 'hi',
        location: parsed.location || {},
        profile: parsed.profile || {}
      });

      if (!setupSent) {
        sendSetupIfReady();
      } else if (geminiWs.readyState === WebSocket.OPEN && parsed.location) {
        const locStr = parsed.location.address || (parsed.location.district ? `${parsed.location.district}, ${parsed.location.state || 'Chhattisgarh'}` : 'Raipur, Chhattisgarh');
        const initTurn = {
          clientContent: {
            turns: [
              {
                role: 'user',
                parts: [{ text: `[System Notification: User profile loaded. Location: "${locStr}", Language: "${parsed.language === 'en' ? 'English' : 'Hindi'}". Prioritize this location for all advice.]` }]
              }
            ],
            turnComplete: false
          }
        };
        geminiWs.send(JSON.stringify(initTurn));
      }

      clientWs.send(JSON.stringify({ type: 'session_initialized', session_id: voiceSessionId }));
      return;
    }

    // 0.3 Crop Image Upload via WebSocket
    if (parsed && parsed.type === 'crop_image_upload' && parsed.image) {
      console.log('[WS CROP IMAGE] Received crop image upload from client. Analyzing with Gemini Vision...');
      analyzeCropImage(parsed.image)
        .then((visionResult) => {
          console.log('[WS CROP IMAGE] Vision result:', visionResult);
          clientWs.send(JSON.stringify({
            type: 'crop_vision_result',
            ...visionResult
          }));

          // Ground Gemini Live conversational session with the vision result
          if (geminiWs.readyState === WebSocket.OPEN) {
            let promptText = '';
            if (visionResult.is_crop) {
              promptText = `[System Notification: The farmer uploaded a photo. Gemini Vision analysis identified crop: "${visionResult.commodity}"${visionResult.variety ? ', variety: "' + visionResult.variety + '"' : ''}, condition: "${visionResult.health || 'Fresh'}". The form has been updated. Confirm this crop identification to the farmer warmly in 1 short sentence, and ask how much quantity they have to sell.]`;
            } else {
              promptText = `[System Notification: The farmer uploaded a photo, but Gemini Vision rejected it: "${visionResult.rejection_reason || 'Not a valid agricultural crop'}". Inform the farmer in 1 polite, firm sentence that the photo does not show a recognizable crop, and ask them to take a clear photo of their agricultural produce.]`;
            }

            const clientContentMsg = {
              clientContent: {
                turns: [
                  {
                    role: 'user',
                    parts: [{ text: promptText }]
                  }
                ],
                turnComplete: true
              }
            };
            geminiWs.send(JSON.stringify(clientContentMsg));
          }
        })
        .catch((err) => {
          console.error('[WS CROP IMAGE] Analysis error:', err.message);
          clientWs.send(JSON.stringify({
            type: 'crop_vision_result',
            is_crop: false,
            rejection_reason: 'Failed to analyze crop photo. Please try again with a clearer image.'
          }));
        });
      return;
    }

    // 0.35 Agentic UI Verification Handshake from Client
    if (parsed && parsed.type === 'ui_verification') {
      const { status, view, rendered_items, error, metadata } = parsed;

      // Resolve any pending tool verification promises
      for (const [id, item] of pendingUIVerifications.entries()) {
        const matches = !item.expectedView
          || item.expectedView === view
          || (item.expectedView === 'IDLE' && (view === 'IDLE' || view === 'close_all_ui'))
          || (item.expectedView === 'render_comparison_ui' && (view === 'render_comparison_ui' || view === 'TWO_WAY_COMPARISON'))
          || (item.expectedView === 'render_selector_menu_ui' && (view === 'render_selector_menu_ui' || view === 'OPTIONS_MENU'))
          || (item.expectedView === 'render_detail_card_ui' && (view === 'render_detail_card_ui' || view === 'DETAIL_WINDOW' || view === 'SINGLE_RATE' || view === 'LOCATION' || view === 'SAVED_CROP'))
          || (item.expectedView === 'OPTIONS_MENU' && (view === 'OPTIONS_MENU' || view === 'render_selector_menu_ui'))
          || (item.expectedView === 'DETAIL_WINDOW' && (view === 'SINGLE_RATE' || view === 'LOCATION' || view === 'SAVED_CROP' || view === 'DETAIL_WINDOW' || view === 'render_detail_card_ui'))
          || (item.expectedView === 'SINGLE_RATE' && (view === 'SINGLE_RATE' || view === 'DETAIL_WINDOW' || view === 'render_detail_card_ui'))
          || (item.expectedView === 'LOCATION' && (view === 'LOCATION' || view === 'DETAIL_WINDOW' || view === 'render_detail_card_ui'))
          || (item.expectedView === 'TWO_WAY_COMPARISON' && (view === 'TWO_WAY_COMPARISON' || view === 'render_comparison_ui'));
        if (matches) {
          item.resolve(parsed);
          pendingUIVerifications.delete(id);
          break;
        }
      }

      const isIdle = view === 'IDLE';
      const isFormOrModal = view === 'SELL_CROP_FORM' || view === 'CAMERA_MODAL' || view === 'SAVED_CROP';

      // 1. If screen returned to IDLE (normal closure/dismissal)
      if (isIdle) {
        const isDeliberateClose = (Date.now() - (lastCloseRequestedTimestamp || 0)) < 3000;
        // If an active card was recently mounted and verified, ignore trailing IDLE packet UNLESS a close was explicitly requested
        if (!isDeliberateClose && currentScreenState && currentScreenState.verified && currentScreenState.view !== 'IDLE' && (Date.now() - (currentScreenState.timestamp || 0) < 1500)) {
          console.log(`[AGENTIC UI VERIFICATION] ℹ️ Ignored trailing IDLE verification because active view "${currentScreenState.view}" is mounted.`);
          return;
        }
        currentScreenState = {
          view: 'IDLE',
          active_entity: null,
          visible_data: {},
          rendered_items: 0,
          verified: true,
          timestamp: Date.now()
        };
        console.log(`[AGENTIC UI VERIFICATION] ✅ Screen reset to IDLE.`);
        const screenFact = buildVerifiedScreenFact(parsed, currentScreenState, lastSelectorScreenState);
        injectVerifiedScreenFact(screenFact, 'ui_verification_idle');
        return;
      }

      // 2. Active Render Verification
      const isRealSuccess = status === 'success' && 
        (isFormOrModal || (typeof rendered_items === 'number' ? rendered_items > 0 : true)) && 
        parsed.has_real_data !== false;

      if (isRealSuccess) {
        currentScreenState = {
          view: view || 'ACTIVE',
          primitive: parsed.primitive || '',
          title: parsed.title,
          options: parsed.items || parsed.options,
          card_type: parsed.card_type || parsed.type,
          isMockData: parsed.isMockData !== undefined ? parsed.isMockData : parsed.has_mock_data,
          rendered_items: typeof rendered_items === 'number' ? rendered_items : 1,
          verified: true,
          timestamp: Date.now(),
          ...(metadata || {})
        };
        if (parsed.primitive === 'selector_menu' || view === 'render_selector_menu_ui' || view === 'OPTIONS_MENU') {
          lastSelectorScreenState = {
            view,
            primitive: 'selector_menu',
            title: parsed.title,
            options: parsed.items || parsed.options,
            rendered_items: currentScreenState.rendered_items
          };
        }
        console.log(`[AGENTIC UI VERIFICATION] ✅ Frontend verified view "${view}" (${rendered_items ?? 1} items rendered)`);
        const screenFact = buildVerifiedScreenFact(parsed, currentScreenState, lastSelectorScreenState);
        injectVerifiedScreenFact(screenFact, 'ui_verification_success');
      } else {
        currentScreenState = {
          view: 'IDLE',
          active_entity: null,
          visible_data: {},
          error: error || 'DOM rendering failed',
          verified: false,
          timestamp: Date.now()
        };
        console.error(`[AGENTIC UI VERIFICATION] ❌ Frontend reported render failure for "${view}":`, error);
        const screenFact = buildVerifiedScreenFact({ ...parsed, status: 'failed' }, currentScreenState, lastSelectorScreenState);
        injectVerifiedScreenFact(screenFact, 'ui_verification_failed');

        // Ground Gemini Live immediately so it knows the visual card failed and can apologize (NEVER for IDLE)
        if (geminiWs.readyState === WebSocket.OPEN && view !== 'IDLE') {
          const failureTurn = {
            clientContent: {
              turns: [
                {
                  role: 'user',
                  parts: [{
                    text: `[System Notification: The visual component "${view}" failed to render on the farmer's screen (Error: ${error || 'DOM render exception'}). Please apologize to the farmer warmly and explain the details verbally.]`
                  }]
                }
              ],
              turnComplete: true
            }
          };
          geminiWs.send(JSON.stringify(failureTurn));
          console.log(`[AGENTIC UI VERIFICATION] Dispatched failure notification turn to Gemini Live.`);
        }
      }
      return;
    }

    // 0.4 Close All / Screen State Update from Client (e.g. user manually clicks 'X' or closes template)
    if (parsed && (parsed.type === 'close_all_ui' || parsed.type === 'screen_state_update')) {
      if (parsed.type === 'close_all_ui' || parsed.view === 'IDLE') {
        lastCloseRequestedTimestamp = Date.now();
        currentScreenState = {
          view: 'IDLE',
          active_entity: null,
          visible_data: {},
          rendered_items: 0,
          verified: true,
          timestamp: Date.now()
        };
        console.log(`[SCREEN STATE UPDATE] Client closed all UI. Screen view reset to IDLE`);
        const screenFact = buildVerifiedScreenFact({ view: 'IDLE', status: 'success', rendered_items: 0 });
        injectVerifiedScreenFact(screenFact, 'close_all_ui');
        return;
      }
      currentScreenState = {
        view: parsed.view || currentScreenState.view,
        active_entity: parsed.active_entity !== undefined ? parsed.active_entity : currentScreenState.active_entity,
        visible_data: parsed.visible_data || currentScreenState.visible_data,
        verified: true,
        timestamp: Date.now()
      };
      console.log(`[SCREEN STATE UPDATE] Client updated screen view to: ${currentScreenState.view}`);
      const screenFact = buildVerifiedScreenFact({ ...parsed, status: 'success' }, currentScreenState, lastSelectorScreenState);
      injectVerifiedScreenFact(screenFact, 'screen_state_update');
      return;
    }

    // 0.5 User Selection / Action from Interactive UI Template or Closed-Loop Generative Selection
    if (parsed && (parsed.type === 'client_selection' || parsed.type === 'user_selection' || parsed.type === 'client_text')) {
      let selectedText = parsed.text || parsed.voiceTurn;
      if (!selectedText && parsed.type === 'client_selection') {
        if (parsed.label) {
          selectedText = `I chose ${parsed.label}`;
        } else if (parsed.selected_id) {
          selectedText = `Selected ${parsed.selected_id}`;
        } else {
          selectedText = 'Option selected';
        }
      }
      console.log(`[USER SELECTION] Relaying user choice to Gemini Live: "${selectedText}"`);
      turnIndex++;
      inTurn = true;
      tSpeechStart = now;
      tSpeechEnd = now;
      tGeminiTurnStart = now;
      tGeminiFirstRecv = 0;
      tGeminiFirstThought = 0;
      tGeminiFirstAudio = 0;
      tGeminiTurnComplete = 0;
      thoughtTextAccum = '';
      speechTextAccum = '';
      userSpeechAccum = selectedText;
      audioChunkCount = 0;
      totalAudioBytes = 0;
      turnHasCloseAllUi = false;
      console.log(`\n======================================================`);
      console.log(`🎙️ [TURN #${turnIndex} STARTED] User Input: "${selectedText}"`);
      console.log(`======================================================`);

      // Notify frontend transcript so user sees their selection
      clientWs.send(JSON.stringify({
        type: 'user_transcript',
        text: selectedText
      }));

      // Send to Gemini as a user text turn with explicit Visual Progression instruction
      const promptText = (parsed.type === 'client_selection')
        ? `[client_selection: "${selectedText}"] (User tapped this on screen. Advance visual state with a detail card or close_all_ui.)`
        : selectedText;

      const clientContentMsg = {
        clientContent: {
          turns: [
            {
              role: 'user',
              parts: [{ text: promptText }]
            }
          ],
          turnComplete: true
        }
      };

      if (geminiWs.readyState === WebSocket.OPEN) {
        geminiWs.send(JSON.stringify(clientContentMsg));
      }
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
        turnHasCloseAllUi = false;
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

    // Audio stream packet forward to Gemini (strictly gate on realtimeInput)
    if (!parsed || !parsed.realtimeInput) {
      if (parsed) {
        console.warn('[SERVER] Dropping unhandled internal client message to prevent Gemini 1007 abort:', parsed.type || Object.keys(parsed));
      }
      return;
    }

    const audioBlob = parsed.realtimeInput.audio || (parsed.realtimeInput.mediaChunks && parsed.realtimeInput.mediaChunks[0]);
    if (!audioBlob) return;

    const outgoingMsg = JSON.stringify({
      realtimeInput: {
        audio: {
          mimeType: audioBlob.mimeType || 'audio/pcm;rate=16000',
          data: audioBlob.data
        }
      }
    });

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

  clientWs.on('close', (code, reason) => {
    console.log(`[CLIENT] Browser disconnected (code: ${code}, reason: ${reason ? reason.toString() : 'none'})`);
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
