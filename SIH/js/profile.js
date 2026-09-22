// ============================================================
// Krishi Mitra — profile.js
// Farmer profile setup (profile-setup.html) and profile
// display / logout (profile.html).
// ============================================================

function goBack() {
  window.location.href = 'index.html';
}

function saveProfile() {
  const profile = getFarmerProfile();
  profile.name = document.getElementById('input-name').value || (currentLang === 'hi' ? 'किसान' : 'Farmer');
  profile.village = document.getElementById('input-village').value || (currentLang === 'hi' ? 'गाँव' : 'Village');
  profile.land = document.getElementById('input-land').value || '2-5';
  profile.crop = document.getElementById('input-crop').value || 'soybean';
  profile.irrigation = document.getElementById('input-irrigation').value || 'tube-well';

  saveFarmerProfile(profile);

  queueToast(currentLang === 'hi' ? '✅ प्रोफ़ाइल सहेजा गया!' : '✅ Profile saved!');
  window.location.href = 'home.html';
}

// ===== PROFILE DISPLAY (profile.html) =====
function updateProfileDisplay() {
  const nameEl = document.getElementById('profile-display-name');
  if (!nameEl) return; // Not on the profile page

  const profile = getFarmerProfile();
  document.getElementById('profile-display-name').textContent = profile.name;
  document.getElementById('profile-display-location').textContent = '📍 ' + profile.village;
  document.getElementById('profile-display-land').textContent = profile.land + ' Acres';
  document.getElementById('profile-display-crop').textContent = profile.crop;
  document.getElementById('profile-display-irrigation').textContent = profile.irrigation;
  document.getElementById('profile-display-phone').textContent = '+91 ' + profile.phone;
  document.getElementById('profile-display-lang').textContent = currentLang === 'hi' ? 'हिंदी' : 'English';
}

document.addEventListener('DOMContentLoaded', updateProfileDisplay);
