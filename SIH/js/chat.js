/**
 * ============================================================
 * Krishi Mitra — chat.js
 * Streaming NDJSON Chat Client with AbortController,
 * Session History Integration, and Unified Client Identity.
 * ============================================================
 */

(function (window) {
  'use strict';

  const CLIENT_ID_KEY = 'krishi_client_id';
  let activeAbortController = null;

  /**
   * Get or initialize unified client ID from localStorage
   */
  function getClientId() {
    try {
      let id = localStorage.getItem(CLIENT_ID_KEY);
      if (!id || typeof id !== 'string' || id.trim().length === 0) {
        if (typeof crypto !== 'undefined' && crypto.randomUUID) {
          id = crypto.randomUUID();
        } else {
          id = 'client_' + Date.now() + '_' + Math.random().toString(36).substring(2, 11);
        }
        localStorage.setItem(CLIENT_ID_KEY, id);
      }
      return id;
    } catch (e) {
      return 'fallback_client_' + Date.now();
    }
  }

  /**
   * Abort any currently running chat stream
   */
  function abortInFlightChat() {
    if (activeAbortController) {
      try {
        activeAbortController.abort();
      } catch (e) {}
      activeAbortController = null;
      return true;
    }
    return false;
  }

  /**
   * Check if a chat stream is actively generating
   */
  function isStreaming() {
    return !!activeAbortController;
  }

  /**
   * Send chat message to /api/chat/stream with progressive NDJSON rendering
   */
  async function sendStreamingMessage(options = {}) {
    const {
      message,
      sessionId = null,
      language = 'hi',
      location = {},
      profile = {},
      onSession = null,
      onToken = null,
      onStatus = null,
      onSources = null,
      onDone = null,
      onError = null,
      onAbort = null
    } = options;

    if (!message || !message.trim()) return;

    // Abort any in-flight stream before starting new one
    abortInFlightChat();

    activeAbortController = new AbortController();
    const clientId = getClientId();

    try {
      const response = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Client-Id': clientId
        },
        body: JSON.stringify({
          session_id: sessionId,
          message: message.trim(),
          language,
          location,
          profile
        }),
        signal: activeAbortController.signal
      });

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        throw new Error(errJson.error || `HTTP ${response.status}: Failed to send message`);
      }

      if (!response.body) {
        throw new Error('ReadableStream not supported by browser environment.');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop(); // keep uncompleted tail in buffer

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          try {
            const evt = JSON.parse(trimmed);

            if (evt.type === 'session' && typeof onSession === 'function') {
              onSession(evt.session_id);
            } else if (evt.type === 'token' && typeof onToken === 'function') {
              onToken(evt.text);
            } else if (evt.type === 'status' && typeof onStatus === 'function') {
              onStatus(evt.text);
            } else if (evt.type === 'sources' && typeof onSources === 'function') {
              onSources(evt.data);
            } else if (evt.type === 'done' && typeof onDone === 'function') {
              onDone();
            } else if (evt.type === 'error') {
              throw new Error(evt.text || 'Server stream error');
            }
          } catch (jsonErr) {
            console.warn('[chat] Could not parse NDJSON line:', trimmed, jsonErr);
          }
        }
      }

      activeAbortController = null;
      if (typeof onDone === 'function') {
        onDone();
      }

    } catch (err) {
      const wasAborted = err.name === 'AbortError' || activeAbortController === null;
      activeAbortController = null;

      if (wasAborted) {
        if (typeof onAbort === 'function') onAbort();
      } else {
        if (typeof onError === 'function') onError(err);
      }
    }
  }

  /**
   * Session REST API helpers
   */
  async function fetchSessions(mode) {
    const clientId = getClientId();
    const url = '/api/sessions' + (mode ? '?mode=' + encodeURIComponent(mode) : '');
    const res = await fetch(url, {
      headers: { 'X-Client-Id': clientId }
    });
    if (!res.ok) throw new Error('Failed to load sessions');
    const data = await res.json();
    return data.sessions || [];
  }

  async function fetchSessionDetails(sessionId) {
    const clientId = getClientId();
    const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, {
      headers: { 'X-Client-Id': clientId }
    });
    if (!res.ok) throw new Error('Failed to load session details');
    return await res.json();
  }

  async function deleteSession(sessionId) {
    const clientId = getClientId();
    const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'DELETE',
      headers: { 'X-Client-Id': clientId }
    });
    if (!res.ok) throw new Error('Failed to delete session');
    return await res.json();
  }

  /**
   * Basic markdown formatter for chat bubbles (escapes HTML safely)
   */
  function formatMarkdown(text) {
    if (!text) return '';

    // 1. Escape raw HTML entities
    let escaped = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // 2. Bold: **text**
    escaped = escaped.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

    // 3. Simple table parsing (detect lines with |)
    const lines = escaped.split('\n');
    let inTable = false;
    let tableHtml = '';
    const output = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith('|') && line.endsWith('|')) {
        const cells = line.slice(1, -1).split('|').map(c => c.trim());
        // Skip separator row (e.g. |---|---|)
        if (cells.every(c => /^[-:]+$/.test(c))) {
          continue;
        }
        if (!inTable) {
          inTable = true;
          tableHtml = '<table>';
          tableHtml += '<tr>' + cells.map(c => `<th>${c}</th>`).join('') + '</tr>';
        } else {
          tableHtml += '<tr>' + cells.map(c => `<td>${c}</td>`).join('') + '</tr>';
        }
      } else {
        if (inTable) {
          tableHtml += '</table>';
          output.push(tableHtml);
          inTable = false;
        }
        // Bullets: - item or * item
        if (line.startsWith('- ') || line.startsWith('* ')) {
          output.push(`• ${line.slice(2)}<br>`);
        } else {
          output.push(line ? line + '<br>' : '<br>');
        }
      }
    }
    if (inTable) {
      tableHtml += '</table>';
      output.push(tableHtml);
    }

    return output.join('').replace(/(<br>)+$/g, '');
  }

  window.KrishiChat = {
    getClientId,
    sendStreamingMessage,
    abortInFlightChat,
    isStreaming,
    fetchSessions,
    fetchSessionDetails,
    deleteSession,
    formatMarkdown
  };

})(window);
