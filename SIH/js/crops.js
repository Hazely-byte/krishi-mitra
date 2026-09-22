// ============================================================
// Krishi Mitra — crops.js
// "My Crops" page (crops.html). This screen did not exist as a
// dedicated screen in the original single-file prototype, so this
// is a simple prototype built with the existing design system and
// the farmer's own profile crop, plus a couple of illustrative
// crop entries reusing the market-crop-card component styling.
// ============================================================

function getMyCrops() {
  const profile = getFarmerProfile();
  const mainCropKey = profile.crop || 'soybean';

  const catalog = {
    wheat:     { emoji: '🌾', nameHi: 'गेहूं',   nameEn: 'Wheat' },
    rice:      { emoji: '🌾', nameHi: 'चावल',   nameEn: 'Rice' },
    soybean:   { emoji: '🫘', nameHi: 'सोयाबीन', nameEn: 'Soybean' },
    cotton:    { emoji: '🧶', nameHi: 'कपास',   nameEn: 'Cotton' },
    sugarcane: { emoji: '🎋', nameHi: 'गन्ना',   nameEn: 'Sugarcane' },
    maize:     { emoji: '🌽', nameHi: 'मक्का',   nameEn: 'Maize' },
    onion:     { emoji: '🧅', nameHi: 'प्याज',   nameEn: 'Onion' },
    potato:    { emoji: '🥔', nameHi: 'आलू',    nameEn: 'Potato' },
    tomato:    { emoji: '🍅', nameHi: 'टमाटर',  nameEn: 'Tomato' },
  };

  const main = catalog[mainCropKey] || catalog.soybean;

  return [
    { ...main, production: 48, available: 32, harvest: '15 Nov 2026' },
    { ...catalog.wheat, production: 60, available: 60, harvest: '20 Mar 2027' },
    { ...catalog.onion, production: 25, available: 10, harvest: '05 Jan 2027' },
  ];
}

function renderMyCrops() {
  const list = document.getElementById('crops-list');
  if (!list) return;
  const t = i18n[currentLang];
  const crops = getMyCrops();

  list.innerHTML = crops.map(c => `
    <div class="market-crop-card">
      <div class="crop-row">
        <span class="crop-emoji">${c.emoji}</span>
        <div class="crop-info">
          <div class="crop-name">${currentLang === 'hi' ? c.nameHi : c.nameEn}</div>
          <div class="crop-category">${t.harvest_label}: ${c.harvest}</div>
        </div>
        <div class="crop-price-area">
          <div class="crop-price">${c.available}</div>
          <div class="crop-unit">${t.available_qty.split('(')[0].trim()}</div>
        </div>
      </div>
      <div class="best-market-badge">
        <span class="badge-icon">📦</span>
        <span class="badge-text">${t.production_label}: ${c.production} ${t.per_quintal}</span>
      </div>
    </div>
  `).join('');
}

function onLanguageChange() {
  renderMyCrops();
}

document.addEventListener('DOMContentLoaded', renderMyCrops);
