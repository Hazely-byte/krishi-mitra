// ============================================================
// Krishi Mitra — auth.js
// Real Google Sign-In flow (GIS + OAuth 2.0 Web Redirect fallback)
// ============================================================

(function () {
  'use strict';

  let googleClientId = '';

  /**
   * Fetch configured Google OAuth Client ID from server
   */
  async function loadClientId() {
    try {
      const res = await fetch('/api/auth/client-id');
      if (res.ok) {
        const data = await res.json();
        googleClientId = data.clientId || '';
      }
    } catch (e) {
      console.warn('[auth] Could not load client ID from server:', e.message);
    }
  }

  /**
   * Parse JWT payload safely without external libraries
   */
  function parseJwt(token) {
    try {
      const base64Url = token.split('.')[1];
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
      const jsonPayload = decodeURIComponent(
        atob(base64)
          .split('')
          .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
          .join('')
      );
      return JSON.parse(jsonPayload);
    } catch (e) {
      return null;
    }
  }

  /**
   * Handle credential response from Google Identity Services (One Tap / Popup)
   */
  window.handleGoogleCredentialResponse = function (response) {
    if (!response || !response.credential) {
      console.error('[auth] Empty credential received from Google');
      return;
    }

    const token = response.credential;
    const payload = parseJwt(token);

    if (payload) {
      try {
        localStorage.setItem('krishi_google_token', token);
        localStorage.setItem('krishi_user_email', (payload.email || '').toLowerCase().trim());
        localStorage.setItem('krishi_user_name', payload.name || '');
        localStorage.setItem('krishi_user_picture', payload.picture || '');

        // Update profile in localStorage for app display
        const profile = typeof window.getFarmerProfile === 'function' ? window.getFarmerProfile() : {};
        profile.name = payload.name || profile.name || 'Farmer';
        profile.email = payload.email || '';
        if (typeof window.saveFarmerProfile === 'function') {
          window.saveFarmerProfile(profile);
        }
      } catch (e) {}

      if (typeof window.showToast === 'function') {
        const isHi = (window.currentLang || 'hi') === 'hi';
        window.showToast(isHi ? 'सफलतापूर्वक साइन इन किया गया' : 'Signed in successfully');
      }

      setTimeout(() => {
        window.location.href = 'home.html';
      }, 300);
    }
  };

  /**
   * Initialize Google Identity Services
   */
  function initGSI() {
    if (!window.google || !window.google.accounts || !window.google.accounts.id) {
      return false;
    }
    if (!googleClientId) return false;

    try {
      window.google.accounts.id.initialize({
        client_id: googleClientId,
        callback: window.handleGoogleCredentialResponse,
        auto_select: false,
        cancel_on_tap_outside: true
      });

      // Render a hidden button to trigger standard prompt if needed
      const hiddenContainer = document.getElementById('g_id_signin_hidden');
      if (hiddenContainer) {
        window.google.accounts.id.renderButton(hiddenContainer, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          text: 'signin_with'
        });
      }
      return true;
    } catch (err) {
      console.warn('[auth] GSI init error:', err.message);
      return false;
    }
  }

  /**
   * Initiate Google Login
   * Uses GIS One-Tap prompt if available, or redirects to /auth/google
   */
  window.initiateGoogleLogin = function () {
    const btn = document.getElementById('google-signin-btn');
    if (btn) {
      btn.style.opacity = '0.7';
      btn.style.pointerEvents = 'none';
    }

    if (typeof window.showToast === 'function') {
      const isHi = (window.currentLang || 'hi') === 'hi';
      window.showToast(isHi ? 'Google से कनेक्ट हो रहा है...' : 'Connecting to Google...');
    }

    // Attempt GIS prompt
    if (window.google && window.google.accounts && window.google.accounts.id && googleClientId) {
      window.google.accounts.id.prompt((notification) => {
        if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
          // If One-Tap prompt is dismissed, not displayed, or third-party cookies blocked,
          // seamlessly fall back to standard web OAuth redirect flow
          window.location.href = '/auth/google';
        }
      });
      // Safety timeout: if prompt doesn't resolve in 1.5s, redirect
      setTimeout(() => {
        if (!localStorage.getItem('krishi_google_token')) {
          window.location.href = '/auth/google';
        }
      }, 1500);
    } else {
      // Standard OAuth 2.0 Web Redirect Flow
      window.location.href = '/auth/google';
    }
  };

  /**
   * Log out user and clear stored tokens
   */
  window.krishiLogout = function () {
    try {
      localStorage.removeItem('krishi_google_token');
      localStorage.removeItem('krishi_user_email');
      localStorage.removeItem('krishi_user_name');
      localStorage.removeItem('krishi_user_picture');
    } catch (e) {}

    if (window.google && window.google.accounts && window.google.accounts.id) {
      try { window.google.accounts.id.disableAutoSelect(); } catch (e) {}
    }

    window.location.href = '/';
  };

  // On page load
  document.addEventListener('DOMContentLoaded', async () => {
    await loadClientId();

    // Check if GSI is ready
    let gsiCheckCount = 0;
    const gsiInterval = setInterval(() => {
      gsiCheckCount++;
      if (initGSI() || gsiCheckCount > 15) {
        clearInterval(gsiInterval);
      }
    }, 200);

    // If already on index.html with a valid token, user can proceed to home
    if (window.location.pathname.endsWith('index.html') || window.location.pathname === '/') {
      const existingToken = localStorage.getItem('krishi_google_token');
      if (existingToken) {
        const parsed = parseJwt(existingToken);
        // If not expired, auto-redirect to home
        if (parsed && parsed.exp && parsed.exp * 1000 > Date.now()) {
          window.location.replace('home.html');
        } else {
          // Token expired, clear it
          localStorage.removeItem('krishi_google_token');
        }
      }
    }
  });

  // Global Auth helper
  window.KrishiAuth = {
    getToken: () => localStorage.getItem('krishi_google_token') || '',
    getEmail: () => (localStorage.getItem('krishi_user_email') || '').toLowerCase().trim(),
    getName: () => localStorage.getItem('krishi_user_name') || '',
    getPicture: () => localStorage.getItem('krishi_user_picture') || '',
    logout: window.krishiLogout,
    isLoggedIn: () => {
      const token = localStorage.getItem('krishi_google_token');
      if (!token) return false;
      const p = parseJwt(token);
      return Boolean(p && p.exp && p.exp * 1000 > Date.now());
    }
  };
})();
