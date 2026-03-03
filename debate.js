/**
 * DIALECTA — Debate Arena Logic
 * Orchestrates the full debate flow, renders arguments, updates UI
 */

// ── State ─────────────────────────────────────
const state = {
  debateId:    null,
  phases:      [],
  phaseLabels: {},
  topic:       '',
  proScore:    0,
  conScore:    0,
  proScoreHistory: [],
  conScoreHistory: [],
  proFallacies: 0,
  conFallacies: 0,
  roundNum:    0,
  miniChart:   null,
};

// ── Boot ──────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  state.debateId    = DebateStore.get('debate_id');
  state.phases      = DebateStore.get('phases', []);
  state.phaseLabels = DebateStore.get('phase_labels', {});
  state.topic       = DebateStore.get('topic', '');

  if (!state.debateId || !state.phases.length) {
    window.location.href = '/';
    return;
  }

  // Update stances
  const shortTopic = state.topic.length > 45
    ? state.topic.substring(0, 45) + '...'
    : state.topic;
  document.getElementById('pro-stance').textContent = `In favor: "${shortTopic}"`;
  document.getElementById('con-stance').textContent = `Against: "${shortTopic}"`;
  document.getElementById('header-status').textContent = '● LIVE';
  document.getElementById('header-status').classList.add('live');

  // Build round progress pips
  buildRoundPips();

  // Init mini chart
  initMiniChart();

  // Run the debate
  await runDebate();
});


// ── Build Round Pips ─────────────────────────
function buildRoundPips() {
  const container = document.getElementById('round-pips');
  const html = state.phases.map((phase, i) =>
    `<div class="pip" id="pip-${i}" data-label="${state.phaseLabels[phase] || phase}"></div>`
  ).join('');
  container.innerHTML = html;
}

function updateRoundPip(activeIndex) {
  state.phases.forEach((_, i) => {
    const pip = document.getElementById(`pip-${i}`);
    if (!pip) return;
    pip.className = 'pip';
    if (i < activeIndex)  pip.classList.add('done');
    if (i === activeIndex) pip.classList.add('active');
  });
}


// ── Mini Chart ───────────────────────────────
function initMiniChart() {
  const ctx = document.getElementById('mini-chart').getContext('2d');
  state.miniChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {
          label: 'Pro',
          data: [],
          borderColor: '#1a3a5c',
          backgroundColor: 'rgba(26,58,92,0.05)',
          tension: 0.4,
          pointRadius: 3,
          borderWidth: 2,
        },
        {
          label: 'Con',
          data: [],
          borderColor: '#5c1a1a',
          backgroundColor: 'rgba(92,26,26,0.05)',
          tension: 0.4,
          pointRadius: 3,
          borderWidth: 2,
        }
      ]
    },
    options: {
      responsive: true,
      animation: false,
      plugins: {
        legend: {
          labels: {
            font: { family: 'IBM Plex Mono', size: 9 },
            boxWidth: 12,
            padding: 6,
          }
        }
      },
      scales: {
        y: {
          min: 0, max: 100,
          ticks: { font: { family: 'IBM Plex Mono', size: 8 }, maxTicksLimit: 5 },
          grid: { color: 'rgba(0,0,0,0.05)' }
        },
        x: {
          ticks: { font: { family: 'IBM Plex Mono', size: 7 }, maxRotation: 0 },
          grid: { display: false }
        }
      }
    }
  });
}

function updateMiniChart(label, proScore, conScore) {
  const chart = state.miniChart;
  chart.data.labels.push(label);
  chart.data.datasets[0].data.push(proScore);
  chart.data.datasets[1].data.push(conScore);
  chart.update();
}


// ── Main Debate Runner ───────────────────────
async function runDebate() {
  let lastProClaim = null;
  let lastConClaim = null;

  for (let i = 0; i < state.phases.length; i++) {
    const phase = state.phases[i];
    const phaseLabel = state.phaseLabels[phase] || phase;
    state.roundNum = i + 1;

    updateRoundPip(i);
    document.getElementById('round-banner').textContent =
      `${phaseLabel.toUpperCase()} · ROUND ${state.roundNum} OF ${state.phases.length}`;
    document.getElementById('current-phase').textContent = phaseLabel;

    addPhaseSeparator(phaseLabel);

    // ── PRO argument ──
    try {
      showTyping('pro');
      await sleep(700);
      const proArg = await apiPost('/api/generate-argument', {
        debate_id: state.debateId,
        agent: 'pro',
        phase,
        opponent_claim: lastConClaim,
      });
      removeTyping();
      const proScore = proArg.overall_score;
      renderArgCard('pro', proArg, phaseLabel, state.roundNum);
      state.proScore += proScore;
      state.proScoreHistory.push(proScore);
      if (proArg.fallacy) {
        state.proFallacies++;
        appendFallacyLog('pro', proArg.fallacy, proArg.fallacy_explanation);
      }
      if (proArg.bias_type) {
        appendBiasLog('pro', proArg.bias_type, proArg.bias_explanation);
      }
      lastProClaim = proArg.claim;
      updateScoreDisplay();
    } catch (err) {
      removeTyping();
      showToast('Error generating Pro argument: ' + err.message);
      break;
    }

    await sleep(500);

    // ── CON argument ──
    try {
      showTyping('con');
      await sleep(700);
      const conArg = await apiPost('/api/generate-argument', {
        debate_id: state.debateId,
        agent: 'con',
        phase,
        opponent_claim: lastProClaim,
      });
      removeTyping();
      const conScore = conArg.overall_score;
      renderArgCard('con', conArg, phaseLabel, state.roundNum);
      state.conScore += conScore;
      state.conScoreHistory.push(conScore);
      if (conArg.fallacy) {
        state.conFallacies++;
        appendFallacyLog('con', conArg.fallacy, conArg.fallacy_explanation);
      }
      if (conArg.bias_type) {
        appendBiasLog('con', conArg.bias_type, conArg.bias_explanation);
      }
      lastConClaim = conArg.claim;
      updateScoreDisplay();
    } catch (err) {
      removeTyping();
      showToast('Error generating Con argument: ' + err.message);
      break;
    }

    // Update mini chart after each round
    const lastProScore = state.proScoreHistory[state.proScoreHistory.length - 1] || 0;
    const lastConScore = state.conScoreHistory[state.conScoreHistory.length - 1] || 0;
    updateMiniChart(phaseLabel.substring(0, 6), lastProScore, lastConScore);

    await sleep(400);
  }

  // ── Finalize ──
  document.getElementById('header-status').textContent = 'CONCLUDED';
  document.getElementById('header-status').classList.remove('live');
  document.getElementById('round-banner').textContent = 'DEBATE CONCLUDED — GENERATING ANALYTICS...';
  updateRoundPip(state.phases.length);

  try {
    const finalData = await apiPost('/api/finalize-debate', { debate_id: state.debateId });
    DebateStore.set('final_data', finalData);
    DebateStore.set('score_history', {
      pro: state.proScoreHistory,
      con: state.conScoreHistory,
      labels: state.phases.map(p => state.phaseLabels[p] || p),
    });

    await sleep(1200);
    window.location.href = `/results?id=${state.debateId}`;
  } catch (err) {
    showToast('Failed to finalize debate: ' + err.message);
    document.getElementById('round-banner').textContent = 'DEBATE COMPLETE';
  }
}


// ── Render Argument Card ─────────────────────
function renderArgCard(agent, arg, phaseLabel, roundNum) {
  const feed  = document.getElementById('debate-feed');
  const score = arg.overall_score;
  const sClass = getStrengthClass(score);
  const sLabel = getStrengthLabel(score);
  const agentLabel = agent === 'pro' ? 'ADVOCATE (Pro)' : 'CHALLENGER (Con)';
  const meterColor = agent === 'pro' ? 'var(--pro)' : 'var(--con)';

  const card = document.createElement('div');
  card.className = `arg-card ${agent}`;
  card.innerHTML = `
    <div class="arg-header">
      <div>
        <div class="arg-agent-label">${agentLabel}</div>
        <div class="arg-round-label">${phaseLabel} · Round ${roundNum}</div>
      </div>
      <span class="strength-badge ${sClass}">${sLabel} · ${score}/100</span>
    </div>

    <div class="arg-body">
      <div class="arg-claim">${escapeHtml(arg.claim)}</div>

      <div class="arg-section">
        <div class="arg-section-label">Reasoning</div>
        <div class="arg-section-text">${escapeHtml(arg.reasoning)}</div>
      </div>

      <div class="arg-section">
        <div class="arg-section-label">Evidence &amp; Examples</div>
        <div class="arg-section-text">${escapeHtml(arg.evidence)}</div>
      </div>

      <div class="arg-validity">${escapeHtml(arg.validity)}</div>
    </div>

    <div class="score-meter">
      <span class="meter-label">Logic</span>
      <div class="meter-track">
        <div class="meter-fill" style="width:${arg.logical_score}%;background:${meterColor}"></div>
      </div>
      <span class="meter-val">${arg.logical_score}</span>
    </div>
    <div class="score-meter">
      <span class="meter-label">Clarity</span>
      <div class="meter-track">
        <div class="meter-fill" style="width:${arg.clarity_score}%;background:${meterColor}"></div>
      </div>
      <span class="meter-val">${arg.clarity_score}</span>
    </div>
    <div class="score-meter">
      <span class="meter-label">Evidence</span>
      <div class="meter-track">
        <div class="meter-fill" style="width:${arg.evidence_score}%;background:${meterColor}"></div>
      </div>
      <span class="meter-val">${arg.evidence_score}</span>
    </div>

    <div class="analysis-tags">
      ${arg.fallacy
        ? `<span class="tag tag-fallacy">⚠ ${escapeHtml(arg.fallacy)}</span>`
        : '<span class="tag tag-clean">✓ No Fallacy</span>'
      }
      ${arg.bias_type
        ? `<span class="tag tag-bias">◈ ${arg.bias_type.replace(/_/g,' ')}</span>`
        : ''
      }
    </div>
  `;

  feed.appendChild(card);
  scrollToBottom();
}


// ── Typing Indicator ─────────────────────────
function showTyping(agent) {
  removeTyping();
  const label = agent === 'pro' ? 'ADVOCATE formulating argument...' : 'CHALLENGER formulating argument...';
  const feed = document.getElementById('debate-feed');
  const el = document.createElement('div');
  el.className = 'typing-card';
  el.id = 'typing-ind';
  el.innerHTML = `
    <div class="typing-dots">
      <div class="dot"></div><div class="dot"></div><div class="dot"></div>
    </div>
    <div class="typing-text">${label}</div>
  `;
  feed.appendChild(el);
  scrollToBottom();
}

function removeTyping() {
  const el = document.getElementById('typing-ind');
  if (el) el.remove();
}


// ── Phase Separator ───────────────────────────
function addPhaseSeparator(label) {
  const feed = document.getElementById('debate-feed');
  const el = document.createElement('div');
  el.className = 'phase-sep';
  el.innerHTML = `
    <div class="phase-sep-line"></div>
    <div class="phase-sep-label">${label}</div>
    <div class="phase-sep-line"></div>
  `;
  feed.appendChild(el);
}


// ── Score Display ─────────────────────────────
function updateScoreDisplay() {
  document.getElementById('pro-score').textContent = state.proScore.toFixed(1);
  document.getElementById('con-score').textContent = state.conScore.toFixed(1);

  const total = state.proScore + state.conScore || 1;
  document.getElementById('pro-bar').style.width = `${(state.proScore / total) * 100}%`;
  document.getElementById('con-bar').style.width = `${(state.conScore / total) * 100}%`;

  document.getElementById('pro-fallacies').textContent = `Fallacies detected: ${state.proFallacies}`;
  document.getElementById('con-fallacies').textContent = `Fallacies detected: ${state.conFallacies}`;
}


// ── Fallacy / Bias Logs ───────────────────────
function appendFallacyLog(agent, fallacy, explanation) {
  const log = document.getElementById('fallacy-log');
  const empty = log.querySelector('.empty-note');
  if (empty) empty.remove();

  const el = document.createElement('div');
  el.className = 'fallacy-entry';
  el.innerHTML = `
    <div class="fallacy-name">${escapeHtml(fallacy)} <span style="font-weight:400;color:var(--muted)">(${agent.toUpperCase()})</span></div>
    <div class="fallacy-expl">${escapeHtml(explanation || '')}</div>
  `;
  log.appendChild(el);
}

function appendBiasLog(agent, biasType, explanation) {
  const log = document.getElementById('bias-log');
  const empty = log.querySelector('.empty-note');
  if (empty) empty.remove();

  const el = document.createElement('div');
  el.className = 'fallacy-entry';
  el.innerHTML = `
    <div class="bias-name">${biasType.replace(/_/g,' ')} <span style="font-weight:400;color:var(--muted)">(${agent.toUpperCase()})</span></div>
    <div class="fallacy-expl">${escapeHtml(explanation || '')}</div>
  `;
  log.appendChild(el);
}


// ── Helpers ───────────────────────────────────
function scrollToBottom() {
  document.getElementById('scroll-anchor').scrollIntoView({ behavior: 'smooth', block: 'end' });
}

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
