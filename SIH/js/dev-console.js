/**
 * ============================================================
 * Krishi Mitra — dev-console.js
 * In-memory diagnostic tracker (On-screen UI removed for production)
 * Keeps safe stubs so callers (voice.js etc) never throw errors.
 * ============================================================
 */
(function (window) {
  'use strict';

  const maxLogs = 50;
  const logs = [];

  function initDevConsole() {
    // On-screen UI mounting removed per production requirements
  }

  function log(type, summary, payload, status) {
    const entry = {
      id: Date.now() + Math.random(),
      time: new Date(),
      type: type || 'EVENT',
      summary: summary || '',
      payload: payload,
      status: status || 'info'
    };

    logs.push(entry);
    if (logs.length > maxLogs) logs.shift();
  }

  function clearLogs() {
    logs.length = 0;
  }

  function toggleMinimize() {
    // Safe no-op
  }

  // Safe API export so all existing callers function cleanly
  window.KrishiDevConsole = {
    init: initDevConsole,
    log: log,
    getLogs: () => [...logs],
    clear: clearLogs,
    toggle: toggleMinimize
  };

})(window);
