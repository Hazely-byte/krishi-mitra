'use strict';

const express = require('express');
const { OAuth2Client } = require('google-auth-library');

const ALLOWED_EMAIL = 'shreyoraon987@gmail.com';

const CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID || '';
const CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET || '';

const oauthClient = new OAuth2Client(CLIENT_ID, CLIENT_SECRET);

/**
 * Determine the exact OAuth redirect URI based on the request host
 */
function getRedirectUri(req) {
  if (process.env.GOOGLE_OAUTH_REDIRECT_URI) {
    return process.env.GOOGLE_OAUTH_REDIRECT_URI;
  }
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000';
  const isHttps = req.headers['x-forwarded-proto'] === 'https' || req.secure || host.includes('onrender.com') || host.includes('.ts.net');
  const proto = isHttps ? 'https' : 'http';
  return `${proto}://${host}/auth/google/callback`;
}

/**
 * Verifies a Google ID Token (JWT) server-side and checks against the single allowed email.
 * Never trusts client assertions.
 * 
 * Returns:
 *   { authorized: true, email: '...', name: '...', picture: '...' }
 * or
 *   { authorized: false, reason: 'missing_token'|'invalid_token'|'unauthorized_email', email: '...'|null }
 */
async function verifyGoogleIdToken(token) {
  if (!token || typeof token !== 'string' || !token.trim()) {
    return { authorized: false, reason: 'missing_token', email: null };
  }

  const cleanToken = token.trim();
  let payload = null;

  // 1. Primary verification: google-auth-library with official Google certificates
  if (CLIENT_ID) {
    try {
      const ticket = await oauthClient.verifyIdToken({
        idToken: cleanToken,
        audience: CLIENT_ID
      });
      payload = ticket.getPayload();
    } catch (err) {
      // Library error (e.g. signature, expiration, audience mismatch)
      // Fall through to secondary check or return invalid
    }
  }

  // 2. Secondary/Fallback verification: Google tokeninfo REST endpoint
  if (!payload) {
    try {
      const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(cleanToken)}`);
      if (res.ok) {
        const info = await res.json();
        // Verify audience if configured
        if (CLIENT_ID && info.aud !== CLIENT_ID) {
          return { authorized: false, reason: 'audience_mismatch', email: info.email || null };
        }
        payload = info;
      }
    } catch (fetchErr) {
      // Network/fetch issue
    }
  }

  if (!payload || !payload.email) {
    return { authorized: false, reason: 'invalid_token', email: null };
  }

  const userEmail = (payload.email || '').toLowerCase().trim();
  const isVerified = payload.email_verified === true || payload.email_verified === 'true';

  if (!isVerified) {
    return { authorized: false, reason: 'unverified_email', email: userEmail };
  }

  // Strict allowlist: Only the owner's exact address is authorized
  if (userEmail !== ALLOWED_EMAIL.toLowerCase()) {
    return {
      authorized: false,
      reason: 'unauthorized_email',
      email: userEmail,
      name: payload.name || '',
      picture: payload.picture || ''
    };
  }

  return {
    authorized: true,
    email: userEmail,
    name: payload.name || '',
    picture: payload.picture || ''
  };
}

/**
 * Express middleware to restrict routes (e.g. /api/chat) to the owner account
 */
async function requireOwner(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = (authHeader && authHeader.startsWith('Bearer ')) 
    ? authHeader.slice(7) 
    : (req.query.token || req.body?.id_token);

  const authResult = await verifyGoogleIdToken(token);

  if (!authResult.authorized) {
    console.warn(`[AUTH] unauthorized email attempted /api/chat connection: ${authResult.email || 'unauthenticated'} (reason: ${authResult.reason})`);
    return res.status(403).json({
      error: 'AI chat is restricted to authorized accounts only.',
      code: 'UNAUTHORIZED_ACCOUNT',
      reason: authResult.reason
    });
  }

  req.user = authResult;
  next();
}

/**
 * Auth Router for Google Sign-In & token management
 */
const authRouter = express.Router();

// Public endpoint providing the Client ID for Google Identity Services frontend widget
// Note: CLIENT_SECRET is NEVER exposed
authRouter.get('/api/auth/client-id', (req, res) => {
  res.json({ clientId: CLIENT_ID });
});

// Current user verification endpoint
authRouter.get('/api/auth/me', async (req, res) => {
  const authHeader = req.headers.authorization;
  const token = (authHeader && authHeader.startsWith('Bearer ')) 
    ? authHeader.slice(7) 
    : req.query.token;

  if (!token) {
    return res.json({ authenticated: false, isOwner: false });
  }

  const result = await verifyGoogleIdToken(token);
  if (!result.email) {
    return res.json({ authenticated: false, isOwner: false });
  }

  res.json({
    authenticated: true,
    isOwner: result.authorized,
    email: result.email,
    name: result.name,
    picture: result.picture
  });
});

// OAuth 2.0 Web Redirect Flow: Step 1 (Redirect user to Google Accounts)
authRouter.get('/auth/google', (req, res) => {
  if (!CLIENT_ID) {
    return res.status(500).send('Google OAuth Client ID is not configured on the server.');
  }

  const redirectUri = getRedirectUri(req);
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` + new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'online',
    prompt: 'select_account'
  });

  res.redirect(authUrl);
});

// OAuth 2.0 Web Redirect Flow: Step 2 (Exchange code with Google for tokens)
authRouter.get('/auth/google/callback', async (req, res) => {
  const code = req.query.code;
  if (!code) {
    return res.redirect('/?error=no_code');
  }

  try {
    const redirectUri = getRedirectUri(req);
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: String(code),
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code'
      })
    });

    const tokenData = await tokenRes.json();
    if (!tokenRes.ok || !tokenData.id_token) {
      console.error('[AUTH] Token exchange failed with Google:', tokenData.error || tokenData);
      return res.redirect('/?error=token_exchange_failed');
    }

    // Verify token server-side immediately
    const verifyResult = await verifyGoogleIdToken(tokenData.id_token);

    // Pass the Google ID token to the client via a secure callback page that writes to localStorage
    const safeToken = encodeURIComponent(tokenData.id_token);
    const safeEmail = encodeURIComponent(verifyResult.email || '');
    const safeName = encodeURIComponent(verifyResult.name || '');
    const safePic = encodeURIComponent(verifyResult.picture || '');

    res.send(`
      <!DOCTYPE html>
      <html>
      <head><title>Authenticating...</title></head>
      <body>
        <p style="font-family:sans-serif; text-align:center; margin-top:50px;">Completing sign in with Google...</p>
        <script>
          try {
            localStorage.setItem('krishi_google_token', decodeURIComponent('${safeToken}'));
            localStorage.setItem('krishi_user_email', decodeURIComponent('${safeEmail}'));
            localStorage.setItem('krishi_user_name', decodeURIComponent('${safeName}'));
            localStorage.setItem('krishi_user_picture', decodeURIComponent('${safePic}'));
          } catch(e) {}
          window.location.replace('/home.html');
        </script>
      </body>
      </html>
    `);
  } catch (err) {
    console.error('[AUTH] OAuth callback error:', err.message);
    res.redirect('/?error=auth_error');
  }
});

module.exports = {
  ALLOWED_EMAIL,
  verifyGoogleIdToken,
  requireOwner,
  authRouter
};
