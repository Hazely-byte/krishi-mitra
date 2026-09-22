// ============================================================
// Krishi Mitra — auth.js
// Phone number entry + mock OTP verification for index.html.
// ============================================================

function showOTP() {
  const phone = document.getElementById('phone-input').value;
  if (phone.length < 10) {
    showToast(currentLang === 'hi' ? 'कृपया 10 अंकों का नंबर दर्ज करें' : 'Please enter a 10-digit number');
    return;
  }
  const profile = getFarmerProfile();
  profile.phone = phone;
  saveFarmerProfile(profile);

  document.getElementById('login-phone-step').classList.add('hidden');
  document.getElementById('login-otp-step').classList.remove('hidden');
  // Auto-focus first OTP input
  document.querySelector('[data-otp]').focus();
}

function verifyOTP() {
  const otps = document.querySelectorAll('[data-otp]');
  let code = '';
  otps.forEach(o => code += o.value);
  if (code.length < 4) {
    showToast(currentLang === 'hi' ? 'कृपया 4 अंकों का OTP दर्ज करें' : 'Please enter the 4-digit OTP');
    return;
  }
  // Mock verification — this is a frontend prototype only.
  window.location.href = 'profile-setup.html';
}

// ===== OTP AUTO-ADVANCE =====
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('[data-otp]').forEach((input, i, arr) => {
    input.addEventListener('input', () => {
      if (input.value.length === 1 && i < arr.length - 1) {
        arr[i + 1].focus();
      }
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !input.value && i > 0) {
        arr[i - 1].focus();
      }
    });
  });
});
