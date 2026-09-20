'use strict';

const express = require('express');
const crypto = require('crypto');
const db = require('./db');
const tools = require('./tools');

const router = express.Router();

let activeModelName = process.env.GEMINI_TEXT_MODEL || 'gemini-3.8-flash';

/**
 * Validate active text model on startup
 */
async function validateTextModel(apiKey) {
  const preferred = process.env.GEMINI_TEXT_MODEL || 'gemini-3.8-flash';
  const candidates = [preferred, 'gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-flash-latest'];
  
  for (const model of candidates) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: 'hi' }] }]
        }),
        signal: AbortSignal.timeout(10000)
      });
      if (res.ok) {
        activeModelName = model;
        console.log(`[chat] Verified Gemini text model: ${activeModelName}`);
        return activeModelName;
      }
    } catch (e) {}
  }
  console.warn(`[chat] Could not verify models, falling back to: ${activeModelName}`);
  return activeModelName;
}

/**
 * Build dynamic system instruction per session
 */
function buildSystemInstruction({ language = 'hi', location = {}, profile = {} } = {}) {
  const today = new Date().toISOString().slice(0, 10);
  const userLoc = `${location.district || 'Raipur'}, ${location.state || 'Chhattisgarh'}`;
  const farmerName = (profile.name || '').slice(0, 50);
  const mainCrop = (profile.crop || '').slice(0, 50);
  const landArea = (profile.land || '').slice(0, 50);
  const village = (profile.village || '').slice(0, 50);
  const irrigation = (profile.irrigation || '').slice(0, 50);

  const meta = db.getSyncMeta(location.district || 'Raipur');
  const lastUpdated = meta.last_updated || 'today';

  return `You are Krishi Mitra's (कृषि मित्र) agricultural advisory assistant for farmers.
Current Date: ${today}
Farmer Location: ${userLoc}
Farmer Profile: ${farmerName ? `Name: ${farmerName}, ` : ''}${mainCrop ? `Main Crop: ${mainCrop}, ` : ''}${landArea ? `Land: ${landArea}, ` : ''}${village ? `Village: ${village}, ` : ''}${irrigation ? `Irrigation: ${irrigation}` : ''}
UI Language: ${language === 'hi' ? 'Hindi (हिंदी)' : 'English'}
Database Freshness: Last updated at ${lastUpdated} from data.gov.in (Department of Agriculture & Farmers Welfare).

CRITICAL RULES:
1. MANDI PRICES & RATES: For ANY price, rate, market or selling question, you MUST call the database tools (get_mandi_prices, compare_markets, get_price_history, list_available_commodities). Quote ONLY their returned numbers, arrival dates, and market names. NEVER invent, extrapolate, or use general training memory for crop prices. If a tool returns no data, explicitly state that you do not have price data for that crop in the database.
2. SCOPE TRANSPARENCY: Every price tool result includes a 'scope' ('raipur', 'chhattisgarh', or 'other_state').
   - If scope is 'raipur', quote it directly as the local Raipur mandi rate.
   - If scope is 'chhattisgarh' or 'other_state', you MUST state clearly: "Raipur has no data for [Crop] today; the nearest reported rate is ₹[Price]/quintal from [Market], [District], [State] on [Date]." NEVER present a non-Raipur price as a Raipur price!
3. USER LOCATION: You already know the farmer is in ${userLoc}. NEVER ask "Where are you located?" or "Which district?".
4. COMPARISONS & ADVICE:
   - "Which market gives the best price?" -> Call compare_markets and compare available mandis.
   - "Should I sell now or wait?" -> Call get_price_history, provide balanced reasoning (seasonal trends, weather risk, storage feasibility), mention uncertainty, and NEVER guarantee profits.
5. LANGUAGE & TONE: Answer in ${language === 'hi' ? 'natural, respectful Hindi (हिंदी)' : 'clear English'}. Keep farming advice grounded, practical, and empathetic.
6. OFF-TOPIC: General farming queries (soil, pests, weather) may use general knowledge labeled as general guidance. Politely decline non-agricultural topics.
7. FORMATTING: Chat answers should be structured with concise paragraphs, bullet points, and small markdown tables for price comparisons.`;
}

/**
 * POST /api/chat/stream
 * NDJSON streaming endpoint for real-time AI conversation
 */
router.post('/stream', async (req, res) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Server GEMINI_API_KEY not configured' });
  }

  const clientId = req.headers['x-client-id'];
  if (!clientId) {
    return res.status(400).json({ error: 'Missing X-Client-Id header' });
  }

  const { session_id, message, language = 'hi', location = {}, profile = {} } = req.body || {};
  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'Message cannot be empty' });
  }

  const trimmedMessage = message.trim().slice(0, 2000);

  // Get or create session
  let sessionId = session_id;
  if (!sessionId) {
    sessionId = crypto.randomUUID();
    const title = trimmedMessage.slice(0, 40);
    db.createSession({
      id: sessionId,
      client_id: clientId,
      mode: 'chat',
      title,
      language
    });
    db.pruneOldSessions(clientId, 100);
  } else {
    // Verify ownership
    const existing = db.getSession(sessionId, clientId);
    if (!existing) {
      return res.status(404).json({ error: 'Session not found' });
    }
    db.touchSession(sessionId);
  }

  // Load existing session messages from DB
  const historyRows = db.getMessages(sessionId);
  const contents = [];

  for (const h of historyRows) {
    contents.push({
      role: h.role === 'user' ? 'user' : 'model',
      parts: [{ text: h.content }]
    });
  }

  // Append new user message
  contents.push({
    role: 'user',
    parts: [{ text: trimmedMessage }]
  });

  // Save user message to database
  const userMsgId = crypto.randomUUID();
  db.addMessage({
    id: userMsgId,
    session_id: sessionId,
    role: 'user',
    content: trimmedMessage
  });

  // Set up NDJSON streaming response
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Transfer-Encoding', 'chunked');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no');

  function sendEvent(evt) {
    if (!res.writableEnded) {
      res.write(JSON.stringify(evt) + '\n');
    }
  }

  sendEvent({ type: 'session', session_id: sessionId });

  const systemInstruction = buildSystemInstruction({ language, location, profile });
  const MAX_ROUNDS = 4;
  let rounds = 0;
  let accumulatedAiText = '';
  const accumulatedSources = [];

  try {
    while (rounds < MAX_ROUNDS) {
      rounds++;

      const url = `https://generativelanguage.googleapis.com/v1beta/models/${activeModelName}:streamGenerateContent?alt=sse&key=${apiKey}`;
      const payload = {
        contents,
        systemInstruction: { parts: [{ text: systemInstruction }] },
        tools: [{ functionDeclarations: tools.toolDeclarations }],
        generationConfig: {
          temperature: 0.3
        }
      };

      const geminiRes = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(20000)
      });

      if (!geminiRes.ok) {
        const errBody = await geminiRes.text();
        throw new Error(`Gemini API HTTP ${geminiRes.status}: ${errBody.slice(0, 200)}`);
      }

      // Read SSE stream
      const reader = geminiRes.body.getReader();
      const decoder = new TextDecoder();
      let sseBuffer = '';
      let currentTurnFunctionCalls = [];
      let modelTurnParts = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        sseBuffer += decoder.decode(value, { stream: true });
        const lines = sseBuffer.split('\n');
        sseBuffer = lines.pop();

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const jsonStr = line.slice(6).trim();
          if (!jsonStr) continue;

          try {
            const chunk = JSON.parse(jsonStr);
            const candidate = chunk.candidates?.[0];
            const parts = candidate?.content?.parts || [];

            for (const p of parts) {
              modelTurnParts.push(p);

              if (p.text) {
                accumulatedAiText += p.text;
                sendEvent({ type: 'token', text: p.text });
              }

              if (p.functionCall) {
                currentTurnFunctionCalls.push(p.functionCall);
              }
            }
          } catch (e) {}
        }
      }

      // If no function call was made, model finished generating response
      if (currentTurnFunctionCalls.length === 0) {
        break;
      }

      // Model requested tool execution
      sendEvent({
        type: 'status',
        text: language === 'hi' ? 'मंडी भाव देख रहे हैं...' : 'Checking mandi prices...'
      });

      // Append model turn to conversation history
      contents.push({
        role: 'model',
        parts: modelTurnParts
      });

      // Execute each function call and accumulate responses
      const functionResponseParts = [];
      for (const fc of currentTurnFunctionCalls) {
        console.log(`[chat] Executing tool: ${fc.name}(${JSON.stringify(fc.args)})`);
        const result = await tools.executeTool(fc.name, fc.args);

        // Track sources if price rows are present
        if (result && result.records && Array.isArray(result.records)) {
          for (const r of result.records) {
            accumulatedSources.push({
              market: r.market,
              district: r.district,
              state: r.state,
              date: r.arrival_date || r.date,
              price: r.modal_price_quintal || r.modal_price,
              scope: r.scope
            });
          }
        }

        functionResponseParts.push({
          functionResponse: {
            name: fc.name,
            response: { result }
          }
        });
      }

      // Append tool responses with role 'user' (per Gemini v1beta schema)
      contents.push({
        role: 'user',
        parts: functionResponseParts
      });

      // Loop back for next model turn to synthesize tool results
    }

    // Save final AI message to SQLite database
    const aiMsgId = crypto.randomUUID();
    db.addMessage({
      id: aiMsgId,
      session_id: sessionId,
      role: 'assistant',
      content: accumulatedAiText,
      sources_json: accumulatedSources.length > 0 ? JSON.stringify(accumulatedSources) : null
    });

    // Send sources and done event
    if (accumulatedSources.length > 0) {
      sendEvent({ type: 'sources', data: accumulatedSources });
    }
    sendEvent({ type: 'done' });
    res.end();
  } catch (err) {
    console.error('[chat] Stream generation error:', err);
    sendEvent({ type: 'error', text: err.message });
    res.end();
  }
});

module.exports = {
  router,
  validateTextModel,
  buildSystemInstruction,
  get activeModelName() { return activeModelName; }
};
