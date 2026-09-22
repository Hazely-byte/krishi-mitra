// ============================================================
// Krishi Mitra — main.js
// Common initialization, language switching, farmer profile
// persistence, toast notifications, and home dashboard init.
// Loaded on every page, after i18n.js.
// ============================================================

// ===== STATE =====
let currentLang = localStorage.getItem('language') || 'hi';

const DEFAULT_PROFILE = { name: '', village: '', land: '', crop: '', irrigation: '', phone: '' };

// ===== FARMER PROFILE (shared across pages via localStorage) =====
function getFarmerProfile() {
  try {
    const stored = JSON.parse(localStorage.getItem('farmerProfile'));
    return stored ? Object.assign({}, DEFAULT_PROFILE, stored) : Object.assign({}, DEFAULT_PROFILE);
  } catch (e) {
    return Object.assign({}, DEFAULT_PROFILE);
  }
}

function saveFarmerProfile(profile) {
  localStorage.setItem('farmerProfile', JSON.stringify(profile));
}

function clearFarmerProfile() {
  localStorage.removeItem('farmerProfile');
}

// ===== LANGUAGE =====
function setLanguage(lang) {
  currentLang = lang;
  localStorage.setItem('language', lang);

  document.querySelectorAll('.lang-btn').forEach(b => b.classList.remove('selected'));
  const langBtn = document.getElementById('lang-' + lang);
  if (langBtn) langBtn.classList.add('selected');

  applyTranslations();

  // Update small toggles
  document.querySelectorAll('.lang-toggle-small').forEach(el => {
    el.textContent = lang === 'hi' ? 'EN' : 'हि';
  });

  // Let page-specific scripts (market.js, buyers.js, etc.) re-render
  // any dynamically-built content that depends on language.
  if (typeof onLanguageChange === 'function') onLanguageChange();
}

function toggleLang() {
  setLanguage(currentLang === 'hi' ? 'en' : 'hi');
}

function applyTranslations() {
  const t = i18n[currentLang];
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (t[key]) el.textContent = t[key];
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    if (t[key]) el.placeholder = t[key];
  });
}

// ===== TOAST =====
function showToast(msg) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2500);
}

// A toast can be queued right before a full-page navigation (since a
// redirect reloads the document) and is shown once the next page loads.
function queueToast(msg) {
  sessionStorage.setItem('pendingToast', msg);
}

function showQueuedToastIfAny() {
  const msg = sessionStorage.getItem('pendingToast');
  if (msg) {
    sessionStorage.removeItem('pendingToast');
    showToast(msg);
  }
}

// ===== LOGOUT (available from any page that shows the nav) =====
function logout() {
  clearFarmerProfile();
  queueToast(currentLang === 'hi' ? '👋 लॉगआउट हो गया' : '👋 Logged out');
  window.location.href = 'index.html';
}

// ===== HOME DASHBOARD GREETING =====
function updateGreeting() {
  const greetingEl = document.getElementById('greeting-name');
  if (!greetingEl) return;
  const profile = getFarmerProfile();
  const greetPrefix = currentLang === 'hi' ? 'नमस्ते' : 'Namaste';
  const name = profile.name || (currentLang === 'hi' ? 'किसान' : 'Farmer');
  greetingEl.textContent = `${greetPrefix}, ${name} 👋`;
}

// ===== AUTOFILL USER ADDRESS (AI Tool & Global Helper) =====
function autofillUserAddress(addressToFill) {
  let addr = addressToFill;
  if (!addr && window.KrishiLocation && typeof window.KrishiLocation.getUserAddress === 'function') {
    addr = window.KrishiLocation.getUserAddress();
  }
  if (!addr) addr = 'Raipur, Chhattisgarh';

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
      el.value = addr;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      filledCount++;
    }
  });

  try {
    let profile = getFarmerProfile();
    profile.village = addr;
    profile.address = addr;
    saveFarmerProfile(profile);
  } catch (e) {}

  const displayLoc = document.getElementById('profile-display-location');
  if (displayLoc) {
    displayLoc.textContent = '📍 ' + addr;
  }

  if (typeof showToast === 'function') {
    const tMsg = currentLang === 'hi' ? `पता स्वतः भरा गया: ${addr}` : `Address autofilled: ${addr}`;
    showToast(tMsg);
  }

  return { success: true, address: addr, fieldsUpdated: filledCount };
}
window.autofillUserAddress = autofillUserAddress;

// ===== COMMON INIT =====
document.addEventListener('DOMContentLoaded', () => {
  // Sync language toggle UI on load
  document.querySelectorAll('.lang-toggle-small').forEach(el => {
    el.textContent = currentLang === 'hi' ? 'EN' : 'हि';
  });
  const langBtn = document.getElementById('lang-' + currentLang);
  if (langBtn) langBtn.classList.add('selected');

  applyTranslations();
  updateGreeting();
  showQueuedToastIfAny();
});
