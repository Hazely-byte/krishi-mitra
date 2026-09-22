// ============================================================
// Krishi Mitra — crop-analysis.js
// Crop analysis form + mock analysis results (crop-analysis.html).
// ============================================================

function analyzeCrop() {
  document.getElementById('analysis-form').classList.add('hidden');
  document.getElementById('analysis-results').classList.remove('hidden');
  window.scrollTo(0, 0);
}

function showAnalysisForm() {
  document.getElementById('analysis-form').classList.remove('hidden');
  document.getElementById('analysis-results').classList.add('hidden');
  window.scrollTo(0, 0);
}
