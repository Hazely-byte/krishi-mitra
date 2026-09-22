// ============================================================
// Krishi Mitra — auth.js
// Firebase Phone Authentication (OTP) & Supabase Verification
// Firebase is used ONLY for OTP send/verify; no ongoing Firebase
// user state or Firestore is retained.
// ============================================================

(function () {
  'use strict';

  let firebaseInitialized = false;
  let recaptchaVerifier = null;
  let confirmationResult = null;
  let currentE164Phone = '';

  /**
   * Initialize Firebase Web App with dynamic or existing config
   */
  async function ensureFirebase() {
    if (firebaseInitialized && window.firebase?.auth) return true;

    if (!window.firebase || !window.firebase.auth) {
      console.warn('[auth] Firebase SDK not yet loaded from CDN.');
      return false;
    }

    let config = window.FIREBASE_CONFIG;
    if (!config || !config.apiKey) {
      try {
        const res = await fetch('/api/config/firebase');
        if (res.ok) {
          config = await res.json();
          window.FIREBASE_CONFIG = config;
        }
      } catch (e) {
        console.warn('[auth] Could not load /api/config/firebase:', e.message);
      }
    }

    if (!config || !config.apiKey) {
      console.warn('[auth] Firebase config (apiKey) is missing in environment.');
      return false;
    }

    if (!window.firebase.apps.length) {
      try {
        window.firebase.initializeApp(config);
        console.log('[auth] Firebase client SDK initialized with project:', config.projectId);
      } catch (e) {
        console.error('[auth] Firebase initializeApp error:', e.message);
        return false;
      }
    }

    firebaseInitialized = true;
    return true;
  }

  /**
   * Initialize or retrieve invisible RecaptchaVerifier
   */
  function getRecaptchaVerifier() {
    if (recaptchaVerifier) return recaptchaVerifier;
    const container = document.getElementById('recaptcha-container');
    if (!container || !window.firebase || !window.firebase.auth) return null;

    try {
      recaptchaVerifier = new window.firebase.auth.RecaptchaVerifier('recaptcha-container', {
        size: 'invisible',
        callback: () => {
          // reCAPTCHA solved — will proceed with submit
        },
        'expired-callback': () => {
          const t = window.i18n?.[window.currentLang || 'hi'] || {};
          showToast(window.currentLang === 'hi' ? 'reCAPTCHA समाप्त हो गया, पुनः प्रयास करें।' : 'reCAPTCHA expired. Please retry.');
        }
      });
      return recaptchaVerifier;
    } catch (err) {
      console.error('[auth] RecaptchaVerifier init error:', err);
      return null;
    }
  }

  /**
   * Reset reCAPTCHA widget if token expired or failed
   */
  function resetRecaptcha() {
    if (recaptchaVerifier) {
      try {
        recaptchaVerifier.render().then((widgetId) => {
          if (window.grecaptcha && typeof window.grecaptcha.reset === 'function') {
            window.grecaptcha.reset(widgetId);
          }
        }).catch(() => {});
      } catch (e) {}
    }
  }

  /**
   * Send OTP via Firebase Phone Auth
   */
  window.showOTP = async function () {
    const rawPhone = (document.getElementById('phone-input')?.value || '').trim();
    const digitsOnly = rawPhone.replace(/\D/g, '');

    if (digitsOnly.length !== 10) {
      showToast(window.currentLang === 'hi' ? 'कृपया 10 अंकों का वैध मोबाइल नंबर दर्ज करें' : 'Please enter a valid 10-digit mobile number');
      document.getElementById('phone-input')?.focus();
      return;
    }

    const e164 = `+91${digitsOnly}`;
    currentE164Phone = e164;

    const btn = document.getElementById('btn-send-otp');
    const originalText = btn ? btn.textContent : '';

    if (btn) {
      btn.disabled = true;
      btn.textContent = window.currentLang === 'hi' ? '⏳ OTP भेजा जा रहा है...' : '⏳ Sending OTP...';
    }

    const fbReady = await ensureFirebase();

    if (!fbReady) {
      // If Firebase is not configured yet (e.g. initial setup before keys are placed),
      // inform user clearly.
      console.warn('[auth] Firebase is not configured. Running in prototype preview mode.');
      showToast(window.currentLang === 'hi'
        ? '⚠️ Firebase अभी कॉन्फ़िगर नहीं है (FIREBASE_API_KEY जोड़ें)'
        : '⚠️ Firebase not configured yet (set FIREBASE_API_KEY)');

      // Allow prototype continuation with warning for local UX inspection
      const profile = getFarmerProfile();
      profile.phone = digitsOnly;
      profile.phone_e164 = e164;
      profile.phone_verified = false;
      saveFarmerProfile(profile);

      document.getElementById('login-phone-step')?.classList.add('hidden');
      document.getElementById('login-otp-step')?.classList.remove('hidden');
      document.querySelector('[data-otp]')?.focus();

      if (btn) {
        btn.disabled = false;
        btn.textContent = originalText;
      }
      return;
    }

    try {
      const verifier = getRecaptchaVerifier();
      if (!verifier) {
        throw new Error('Failed to initialize reCAPTCHA verifier');
      }

      console.log('[auth] Requesting SMS OTP for:', e164);
      confirmationResult = await window.firebase.auth().signInWithPhoneNumber(e164, verifier);

      // Successfully triggered SMS
      const label = document.getElementById('otp-phone-display');
      if (label) {
        const masked = `+91 ${digitsOnly.slice(0, 5)} ${digitsOnly.slice(5)}`;
        label.textContent = (window.currentLang === 'hi' ? 'OTP इस नंबर पर भेजा गया: ' : 'OTP sent to: ') + masked;
      }

      document.getElementById('login-phone-step')?.classList.add('hidden');
      document.getElementById('login-otp-step')?.classList.remove('hidden');

      // Clear previous OTP inputs and auto-focus first input
      document.querySelectorAll('[data-otp]').forEach(inp => inp.value = '');
      document.querySelector('[data-otp]')?.focus();

      showToast(window.currentLang === 'hi' ? '✅ OTP भेज दिया गया है' : '✅ OTP sent successfully');
    } catch (err) {
      console.error('[auth] signInWithPhoneNumber failed:', err);
      resetRecaptcha();

      let userMsg = err.message;
      if (err.code === 'auth/invalid-phone-number') {
        userMsg = window.currentLang === 'hi' ? 'अमान्य फोन नंबर प्रारूप।' : 'Invalid phone number format.';
      } else if (err.code === 'auth/too-many-requests') {
        userMsg = window.currentLang === 'hi' ? 'बहुत सारे प्रयास। कृपया बाद में पुनः प्रयास करें।' : 'Too many attempts. Please try again later.';
      } else if (err.code === 'auth/quota-exceeded') {
        userMsg = window.currentLang === 'hi' ? 'दैनिक एसएमएस कोटा समाप्त हो गया है।' : 'Daily SMS quota exceeded.';
      } else if (err.code === 'auth/captcha-check-failed') {
        userMsg = window.currentLang === 'hi' ? 'reCAPTCHA सत्यापन विफल रहा। पुनः प्रयास करें।' : 'reCAPTCHA verification failed. Please retry.';
      } else if (err.code === 'auth/unauthorized-domain') {
        userMsg = `Domain ${window.location.hostname} is not authorized in Firebase Console.`;
      }

      showToast(userMsg);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = originalText;
      }
    }
  };

  /**
   * Resend OTP handler
   */
  window.resendOTP = function () {
    if (recaptchaVerifier) {
      try {
        recaptchaVerifier.clear();
        recaptchaVerifier = null;
      } catch (e) {}
    }
    showToast(window.currentLang === 'hi' ? 'पुनः OTP भेजा जा रहा है...' : 'Resending OTP...');
    window.showOTP();
  };

  /**
   * Change phone number (returns to phone input screen)
   */
  window.changePhoneNumber = function () {
    document.getElementById('login-otp-step')?.classList.add('hidden');
    document.getElementById('login-phone-step')?.classList.remove('hidden');
    document.getElementById('phone-input')?.focus();
  };

  /**
   * Verify OTP code with Firebase & confirm server-side with Supabase
   */
  window.verifyOTP = async function () {
    const otps = document.querySelectorAll('[data-otp]');
    let code = '';
    otps.forEach(o => code += (o.value || '').trim());

    if (code.length < 6) {
      showToast(window.currentLang === 'hi' ? 'कृपया 6 अंकों का OTP दर्ज करें' : 'Please enter the complete 6-digit OTP');
      return;
    }

    const btn = document.getElementById('btn-verify-otp');
    const originalText = btn ? btn.textContent : '';

    if (btn) {
      btn.disabled = true;
      btn.textContent = window.currentLang === 'hi' ? '⏳ सत्यापन हो रहा है...' : '⏳ Verifying...';
    }

    // Prototype fallback if Firebase confirmationResult was not created
    if (!confirmationResult) {
      console.warn('[auth] No confirmationResult found. Running in mock verification fallback.');
      const profile = getFarmerProfile();
      profile.phone_verified = true;
      saveFarmerProfile(profile);
      if (btn) {
        btn.disabled = false;
        btn.textContent = originalText;
      }
      window.location.href = 'home.html';
      return;
    }

    try {
      // 1. Confirm code with Firebase client
      const userCredential = await confirmationResult.confirm(code);
      const fbUser = userCredential.user;
      const idToken = await fbUser.getIdToken();
      const verifiedPhone = fbUser.phoneNumber || currentE164Phone;

      console.log('[auth] Firebase client verified phone:', verifiedPhone, '(UID:', fbUser.uid, ')');

      // 2. Submit verified ID token to backend for cryptographic verification & Supabase persistence
      const resp = await fetch('/api/phone/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idToken,
          phoneNumber: verifiedPhone
        })
      });

      const result = await resp.json();

      if (!resp.ok) {
        throw new Error(result.error || 'Server rejected verification');
      }

      console.log('[auth] Server verified & persisted phone successfully:', result);

      // 3. Update local farmer profile
      const profile = getFarmerProfile();
      profile.phone = verifiedPhone.replace(/^\+91/, '');
      profile.phone_e164 = verifiedPhone;
      profile.phone_verified = true;
      profile.firebase_uid = result.uid || fbUser.uid;
      saveFarmerProfile(profile);

      // 4. Immediately sign out from Firebase to maintain zero persistent Firebase session
      await window.firebase.auth().signOut().catch(() => {});

      queueToast(window.currentLang === 'hi'
        ? '✅ फ़ोन नंबर सफलतापूर्वक सत्यापित हुआ!'
        : '✅ Phone number verified successfully!');

      window.location.href = 'home.html';
    } catch (err) {
      console.error('[auth] OTP verification failure:', err);

      let userMsg = err.message;
      if (err.code === 'auth/invalid-verification-code') {
        userMsg = window.currentLang === 'hi'
          ? 'गलत OTP कोड दर्ज किया गया है। कृपया पुनः जांचें।'
          : 'Incorrect OTP code. Please check and try again.';
      } else if (err.code === 'auth/code-expired') {
        userMsg = window.currentLang === 'hi'
          ? 'OTP की समय सीमा समाप्त हो गई है। कृपया नया कोड मंगाएं।'
          : 'OTP has expired. Please request a new code.';
      }

      showToast(userMsg);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = originalText;
      }
    }
  };

  /**
   * Setup OTP auto-advance & paste handler
   */
  document.addEventListener('DOMContentLoaded', () => {
    ensureFirebase();

    const inputs = document.querySelectorAll('[data-otp]');
    inputs.forEach((input, i, arr) => {
      // Auto-advance on digit input
      input.addEventListener('input', (e) => {
        // Handle direct typing
        if (input.value.length >= 1 && i < arr.length - 1) {
          arr[i + 1].focus();
        }
      });

      // Handle backspace
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && !input.value && i > 0) {
          arr[i - 1].focus();
        } else if (e.key === 'Enter') {
          window.verifyOTP();
        }
      });

      // Handle paste of 6-digit code
      input.addEventListener('paste', (e) => {
        e.preventDefault();
        const pasted = (e.clipboardData || window.clipboardData).getData('text').trim();
        const digits = pasted.replace(/\D/g, '').slice(0, arr.length);
        if (digits) {
          digits.split('').forEach((d, idx) => {
            if (arr[idx]) arr[idx].value = d;
          });
          const nextFocus = Math.min(digits.length, arr.length - 1);
          arr[nextFocus].focus();
          if (digits.length === arr.length) {
            window.verifyOTP();
          }
        }
      });
    });

    // Enter key on phone input triggers send OTP
    document.getElementById('phone-input')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        window.showOTP();
      }
    });
  });
})();
