'use strict';

const express = require('express');
const db = require('./db');

const router = express.Router();

/**
 * Middleware: validate X-Client-Id header
 */
function requireClientId(req, res, next) {
  const clientId = req.headers['x-client-id'];
  if (!clientId || typeof clientId !== 'string' || clientId.trim().length === 0) {
    return res.status(400).json({ error: 'Missing required X-Client-Id header' });
  }
  req.clientId = clientId.trim();
  next();
}

router.use(requireClientId);

/**
 * GET /api/sessions?mode=chat|voice
 * List sessions for current client and mode
 */
router.get('/', (req, res) => {
  const mode = req.query.mode;
  if (mode && mode !== 'chat' && mode !== 'voice') {
    return res.status(400).json({ error: 'Invalid mode: must be chat or voice' });
  }
  const sessions = db.getSessions(req.clientId, mode);
  res.json({ sessions });
});

/**
 * GET /api/sessions/:id
 * Get single session and its full message history
 */
router.get('/:id', (req, res) => {
  const session = db.getSession(req.params.id, req.clientId);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }
  const messages = db.getMessages(session.id);
  res.json({
    session,
    messages: messages.map(m => ({
      id: m.id,
      role: m.role,
      content: m.content,
      sources: m.sources_json ? JSON.parse(m.sources_json) : null,
      created_at: m.created_at
    }))
  });
});

/**
 * DELETE /api/sessions/:id
 * Delete a session owned by client
 */
router.delete('/:id', (req, res) => {
  const deleted = db.deleteSession(req.params.id, req.clientId);
  if (!deleted) {
    return res.status(404).json({ error: 'Session not found or not owned by client' });
  }
  res.json({ success: true, deleted_id: req.params.id });
});

module.exports = router;
