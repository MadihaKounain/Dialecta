/**
 * DIALECTA — Index Page Logic
 * Handles topic input and debate configuration
 */

document.addEventListener('DOMContentLoaded', () => {
  const topicInput = document.getElementById('topic-input');
  const startBtn   = document.getElementById('start-btn');

  // ── Suggestion chips ───────────────────────
  document.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      topicInput.value = chip.dataset.topic;
      topicInput.focus();
    });
  });

  // ── Enter key trigger ───────────────────────
  topicInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') startDebate();
  });

  startBtn.addEventListener('click', startDebate);

  // ── Start debate ────────────────────────────
  async function startDebate() {
    const topic  = topicInput.value.trim();
    const tone   = document.getElementById('tone-select').value;
    const rounds = parseInt(document.getElementById('rounds-select').value);

    if (!topic) {
      showToast('Please enter a debate topic.');
      topicInput.focus();
      return;
    }

    startBtn.disabled = true;
    startBtn.innerHTML = '<div class="spinner"></div> Starting...';

    try {
      const data = await apiPost('/api/start-debate', { topic, tone, rounds });

      // Persist debate config for the debate page
      DebateStore.clear();
      DebateStore.set('debate_id',    data.debate_id);
      DebateStore.set('phases',       data.phases);
      DebateStore.set('phase_labels', data.phase_labels);
      DebateStore.set('topic',        topic);
      DebateStore.set('tone',         tone);

      window.location.href = '/debate';

    } catch (err) {
      showToast('Failed to start debate: ' + err.message);
      startBtn.disabled = false;
      startBtn.innerHTML = '<span class="btn-icon">⚔</span> Commence the Debate';
    }
  }
});
