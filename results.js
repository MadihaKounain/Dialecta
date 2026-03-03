/**
 * DIALECTA — Results / Analytics Dashboard
 */

document.addEventListener('DOMContentLoaded', async () => {
  // Get debate ID from URL or session
  const urlParams  = new URLSearchParams(window.location.search);
  const debateId   = urlParams.get('id') || DebateStore.get('debate_id');

  if (!debateId) {
    window.location.href = '/';
    return;
  }

  // Try to get cached data first, else fetch
  let record;
  try {
    record = await apiGet(`/api/debate/${debateId}`);
  } catch (err) {
    showToast('Could not load debate results.');
    return;
  }

  if (!record.winner_data) {
    showToast('Results not yet available.');
    return;
  }

  renderPage(record);
});


function renderPage(record) {
  const wd = record.winner_data;

  // Topic
  document.getElementById('results-topic').textContent =
    `"${record.topic}" · ${record.tone} · ${record.phases.length} rounds`;

  // Winner banner
  const winnerBanner = document.getElementById('winner-banner');
  const winnerColor  = wd.winner === 'pro' ? 'var(--pro)' : wd.winner === 'con' ? 'var(--con)' : '#6b6460';
  winnerBanner.innerHTML = `
    <div class="winner-tag">Debate Winner · By Reasoning Quality</div>
    <div class="winner-name" style="color:${winnerColor}">${escapeHtml(wd.winner_label)}</div>
    <div class="winner-scores">
      PRO Total: ${wd.pro_total} pts | CON Total: ${wd.con_total} pts
      (Fallacy penalty: -5 pts each)
    </div>
    <div class="winner-reason">${escapeHtml(wd.reasoning)}</div>
  `;

  // Score history from record
  const proScores  = record.pro_scores || [];
  const conScores  = record.con_scores || [];
  const phaseLabels = record.phases.map(p => {
    const map = { opening: 'Opening', rebuttal: 'Rebuttal', cross: 'Cross', closing: 'Closing' };
    return map[p] || p;
  });

  // Argument log
  renderArgLog(record.arguments, phaseLabels);

  // Charts (after DOM ready)
  setTimeout(() => {
    renderStrengthChart(proScores, conScores, phaseLabels);
    renderRadarChart(wd, record);
    renderBarChart(wd, record);
    renderFallacySummary(record);
  }, 100);
}


// ── Argument Log ──────────────────────────────
function renderArgLog(args, phaseLabels) {
  const container = document.getElementById('arg-log');
  if (!args || !args.length) {
    container.innerHTML = '<p style="color:var(--muted);font-size:0.8rem">No arguments recorded.</p>';
    return;
  }

  args.forEach((arg, i) => {
    const card = document.createElement('div');
    card.className = `log-card ${arg.agent}`;
    const agentLabel = arg.agent === 'pro' ? 'ADVOCATE (Pro)' : 'CHALLENGER (Con)';
    const score = arg.overall_score || 0;
    const sClass = getStrengthClass(score);
    card.innerHTML = `
      <div class="log-card-head">
        <span class="log-agent">${agentLabel} · ${escapeHtml(arg.phase_label || '')}</span>
        <span class="log-score"><span class="strength-badge ${sClass}">${score}/100</span></span>
      </div>
      <div class="log-card-body">
        <div class="log-claim">${escapeHtml(arg.claim)}</div>
        <div class="log-text">${escapeHtml(arg.reasoning)}</div>
        ${arg.fallacy ? `<div style="margin-top:0.4rem;font-family:var(--font-mono);font-size:0.62rem;color:var(--fallacy-color)">⚠ ${escapeHtml(arg.fallacy)}: ${escapeHtml(arg.fallacy_explanation || '')}</div>` : ''}
      </div>
    `;
    container.appendChild(card);
  });
}


// ── Strength Line Chart ───────────────────────
function renderStrengthChart(proScores, conScores, labels) {
  const ctx = document.getElementById('strength-chart').getContext('2d');
  new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Pro (Advocate)',
          data: proScores,
          borderColor: '#1a3a5c',
          backgroundColor: 'rgba(26,58,92,0.08)',
          tension: 0.4,
          pointRadius: 5,
          pointBackgroundColor: '#1a3a5c',
          borderWidth: 2,
          fill: true,
        },
        {
          label: 'Con (Challenger)',
          data: conScores,
          borderColor: '#5c1a1a',
          backgroundColor: 'rgba(92,26,26,0.08)',
          tension: 0.4,
          pointRadius: 5,
          pointBackgroundColor: '#5c1a1a',
          borderWidth: 2,
          fill: true,
        }
      ]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { labels: { font: { family: 'IBM Plex Mono', size: 10 }, boxWidth: 14 } }
      },
      scales: {
        y: {
          min: 0, max: 100,
          ticks: { font: { family: 'IBM Plex Mono', size: 9 }, stepSize: 25 },
          grid: { color: 'rgba(0,0,0,0.06)' }
        },
        x: {
          ticks: { font: { family: 'IBM Plex Mono', size: 9 } },
          grid: { display: false }
        }
      }
    }
  });
}


// ── Radar Chart ───────────────────────────────
function renderRadarChart(wd, record) {
  const ctx = document.getElementById('radar-chart').getContext('2d');

  const proScores = record.pro_scores || [];
  const conScores = record.con_scores || [];
  const proAvg = proScores.length ? proScores.reduce((a,b)=>a+b,0)/proScores.length : 0;
  const conAvg = conScores.length ? conScores.reduce((a,b)=>a+b,0)/conScores.length : 0;

  const proConsistency = proScores.length > 1
    ? Math.max(0, 100 - (Math.max(...proScores) - Math.min(...proScores)))
    : 75;
  const conConsistency = conScores.length > 1
    ? Math.max(0, 100 - (Math.max(...conScores) - Math.min(...conScores)))
    : 75;

  new Chart(ctx, {
    type: 'radar',
    data: {
      labels: ['Avg Score', 'Consistency', 'Fallacy Control', 'Evidence', 'Clarity'],
      datasets: [
        {
          label: 'Pro',
          data: [
            Math.round(proAvg),
            Math.round(proConsistency),
            Math.max(0, Math.round(100 - record.pro_fallacies * 20)),
            Math.round(proAvg * 0.95),
            Math.round(proAvg * 1.05),
          ].map(v => Math.min(100, v)),
          borderColor: '#1a3a5c',
          backgroundColor: 'rgba(26,58,92,0.12)',
          pointBackgroundColor: '#1a3a5c',
          borderWidth: 2,
        },
        {
          label: 'Con',
          data: [
            Math.round(conAvg),
            Math.round(conConsistency),
            Math.max(0, Math.round(100 - record.con_fallacies * 20)),
            Math.round(conAvg * 0.95),
            Math.round(conAvg * 1.05),
          ].map(v => Math.min(100, v)),
          borderColor: '#5c1a1a',
          backgroundColor: 'rgba(92,26,26,0.12)',
          pointBackgroundColor: '#5c1a1a',
          borderWidth: 2,
        }
      ]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { labels: { font: { family: 'IBM Plex Mono', size: 10 }, boxWidth: 14 } }
      },
      scales: {
        r: {
          min: 0, max: 100,
          ticks: { font: { family: 'IBM Plex Mono', size: 8 }, stepSize: 25, backdropColor: 'transparent' },
          grid: { color: 'rgba(0,0,0,0.08)' },
          angleLines: { color: 'rgba(0,0,0,0.08)' },
          pointLabels: { font: { family: 'IBM Plex Mono', size: 9 } }
        }
      }
    }
  });
}


// ── Bar Chart ─────────────────────────────────
function renderBarChart(wd, record) {
  const ctx = document.getElementById('bar-chart').getContext('2d');

  const proScores = record.pro_scores || [];
  const conScores = record.con_scores || [];
  const proAvg = proScores.length ? proScores.reduce((a,b)=>a+b,0)/proScores.length : 0;
  const conAvg = conScores.length ? conScores.reduce((a,b)=>a+b,0)/conScores.length : 0;
  const proTotal = proScores.reduce((a,b)=>a+b,0);
  const conTotal = conScores.reduce((a,b)=>a+b,0);

  new Chart(ctx, {
    type: 'bar',
    data: {
      labels: ['Total Score', 'Average/Round', 'Penalty-Adjusted'],
      datasets: [
        {
          label: 'Pro',
          data: [
            Math.round(proTotal),
            Math.round(proAvg),
            Math.round(wd.pro_total),
          ],
          backgroundColor: 'rgba(26,58,92,0.75)',
          borderColor: '#1a3a5c',
          borderWidth: 1,
        },
        {
          label: 'Con',
          data: [
            Math.round(conTotal),
            Math.round(conAvg),
            Math.round(wd.con_total),
          ],
          backgroundColor: 'rgba(92,26,26,0.75)',
          borderColor: '#5c1a1a',
          borderWidth: 1,
        }
      ]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { labels: { font: { family: 'IBM Plex Mono', size: 10 }, boxWidth: 14 } }
      },
      scales: {
        y: {
          ticks: { font: { family: 'IBM Plex Mono', size: 9 } },
          grid: { color: 'rgba(0,0,0,0.06)' }
        },
        x: {
          ticks: { font: { family: 'IBM Plex Mono', size: 9 } },
          grid: { display: false }
        }
      }
    }
  });
}


// ── Fallacy Summary ───────────────────────────
function renderFallacySummary(record) {
  const container = document.getElementById('fallacy-summary');
  const fallacyLog = record.fallacy_log || [];
  const biasLog    = record.bias_log || [];

  let html = `
    <div class="fallacy-compare">
      <div class="fallacy-agent-box">
        <div class="fab-label pro">PRO</div>
        <div class="fab-count pro">${record.pro_fallacies || 0}</div>
        <div style="font-family:var(--font-mono);font-size:0.6rem;color:var(--muted)">fallacies</div>
      </div>
      <div class="fallacy-agent-box">
        <div class="fab-label con">CON</div>
        <div class="fab-count con">${record.con_fallacies || 0}</div>
        <div style="font-family:var(--font-mono);font-size:0.6rem;color:var(--muted)">fallacies</div>
      </div>
    </div>
  `;

  if (fallacyLog.length > 0) {
    html += fallacyLog.map(f => `
      <div class="fallacy-detail-item">
        <div class="fdi-name">${escapeHtml(f.fallacy)}
          <span style="font-weight:400;color:var(--muted);font-size:0.55rem">(${f.agent.toUpperCase()})</span>
        </div>
        <div class="fdi-exp">${escapeHtml(f.explanation || '')}</div>
      </div>
    `).join('');
  } else {
    html += '<div class="no-fallacies">✓ No major fallacies detected</div>';
  }

  if (biasLog.length > 0) {
    html += `<div style="margin-top:0.8rem;padding-top:0.6rem;border-top:1px solid rgba(0,0,0,0.08);">
      <div style="font-family:var(--font-mono);font-size:0.6rem;letter-spacing:0.15em;color:var(--bias-color);text-transform:uppercase;margin-bottom:0.4rem;">Bias Detected</div>
      ${biasLog.map(b => `
        <div class="fallacy-detail-item">
          <div class="fdi-name" style="color:var(--bias-color)">${b.type.replace(/_/g,' ')}
            <span style="font-weight:400;color:var(--muted);font-size:0.55rem">(${b.agent.toUpperCase()})</span>
          </div>
          <div class="fdi-exp">${escapeHtml(b.explanation || '')}</div>
        </div>
      `).join('')}
    </div>`;
  }

  container.innerHTML = html;
}


// ── Utility ───────────────────────────────────
function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
