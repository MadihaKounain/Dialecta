/**
 * DIALECTA — Shared Utility Functions
 */

// ── Toast Notifications ──────────────────────
function showToast(message, type = 'error') {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4500);
}

// ── Sleep Helper ──────────────────────────────
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Argument Strength Helpers ─────────────────
function getStrengthClass(score) {
  if (score >= 75) return 'strength-high';
  if (score >= 50) return 'strength-mid';
  return 'strength-low';
}

function getStrengthLabel(score) {
  if (score >= 75) return 'Strong';
  if (score >= 50) return 'Moderate';
  return 'Weak';
}

// ── Session Storage for Debate State ─────────
const DebateStore = {
  set(key, value) {
    try {
      sessionStorage.setItem(`dialecta_${key}`, JSON.stringify(value));
    } catch(e) {}
  },
  get(key, fallback = null) {
    try {
      const v = sessionStorage.getItem(`dialecta_${key}`);
      return v ? JSON.parse(v) : fallback;
    } catch(e) { return fallback; }
  },
  clear() {
    Object.keys(sessionStorage)
      .filter(k => k.startsWith('dialecta_'))
      .forEach(k => sessionStorage.removeItem(k));
  }
};

// ── API Helpers ────────────────────────────────
async function apiPost(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || `HTTP ${response.status}`);
  }
  return data;
}

async function apiGet(url) {
  const response = await fetch(url);
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || `HTTP ${response.status}`);
  }
  return data;
}
