// The timing section of a take's report: what pulse the playing implied, how
// each note sat against it, and where the tempo went.
//
// One canvas, two lanes over a shared time axis — the tempo curve on top,
// per-note deviation bars below. Unlike the pitch chart above it this is always
// the whole take at container width, so it stays a summary you can take in at
// a glance rather than something else to scroll.

import { rhythmReport } from '../analysis/rhythm.js';
import { palette, onThemeChange } from './theme.js';

const PAD = { top: 14, right: 10, bottom: 16, left: 40 };
const FONT = '11px -apple-system, "Segoe UI", Roboto, sans-serif';
const CURVE_SHARE = 0.44;  // how much of the height the tempo lane takes
const DEV_CEILING = 0.12;  // deviation axis: ±120 ms, or the worst note if larger

function ordinal(n) {
  const rest = n % 100;
  if (rest >= 11 && rest <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

function drawTiming(canvas, report) {
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 600;
  const cssH = canvas.clientHeight || 150;
  canvas.width = cssW * dpr;
  canvas.height = cssH * dpr;
  const ctx = canvas.getContext('2d');
  const c = palette();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  ctx.font = FONT;
  ctx.textBaseline = 'middle';

  const times = report.notes.map((n) => n.start);
  const t0 = Math.min(...times);
  const t1 = Math.max(...times, t0 + 1);
  const w = cssW - PAD.left - PAD.right;
  const x = (t) => PAD.left + ((t - t0) / (t1 - t0)) * w;

  const curveH = (cssH - PAD.top - PAD.bottom) * CURVE_SHARE;
  const devTop = PAD.top + curveH + 14;
  const devH = cssH - PAD.bottom - devTop;
  const mid = devTop + devH / 2;

  // --- tempo lane ---
  if (report.curve.length > 1) {
    const centre = report.bpm;
    // A single fumbled note throws the local tempo estimate a long way, and
    // scaling the axis to that would squash the shape everyone came to see. The
    // axis covers the bulk of the curve (and never less than ±6%); outliers are
    // clamped to the edge instead of stretching it.
    const offsets = report.curve.map((p) => Math.abs(p.bpm - centre)).sort((a, b) => a - b);
    const bulk = offsets[Math.floor(offsets.length * 0.9)] ?? 0;
    const spread = Math.max(centre * 0.06, bulk);
    const yBpm = (bpm) => {
      const clamped = Math.max(centre - spread, Math.min(centre + spread, bpm));
      return PAD.top + curveH * (1 - (clamped - (centre - spread)) / (2 * spread));
    };

    ctx.strokeStyle = c.grid;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(PAD.left, yBpm(centre));
    ctx.lineTo(cssW - PAD.right, yBpm(centre));
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = c.muted;
    ctx.textAlign = 'right';
    ctx.fillText(`${Math.round(centre)}`, PAD.left - 6, yBpm(centre));
    ctx.fillText(`${Math.round(centre + spread)}`, PAD.left - 6, PAD.top + 4);

    ctx.strokeStyle = c.primary;
    ctx.lineWidth = 2;
    ctx.beginPath();
    report.curve.forEach((p, i) => {
      const px = x(p.time);
      const py = yBpm(p.bpm);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.fillStyle = c.muted;
    ctx.fillText('tempo', PAD.left + 2, PAD.top - 4);
  }

  // --- deviation lane ---
  const worstDev = Math.max(DEV_CEILING, ...report.notes.map((n) => Math.abs(n.deviationMs) / 1000));
  const msLabel = Math.round(worstDev * 800);
  const yDev = (seconds) => mid - (seconds / worstDev) * (devH / 2);

  ctx.strokeStyle = c.gridStrong;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD.left, mid);
  ctx.lineTo(cssW - PAD.right, mid);
  ctx.stroke();

  ctx.fillStyle = c.muted;
  ctx.textAlign = 'right';
  ctx.fillText(`+${msLabel}`, PAD.left - 6, yDev(worstDev * 0.8));
  ctx.fillText(`−${msLabel}`, PAD.left - 6, yDev(-worstDev * 0.8));
  ctx.textAlign = 'left';
  ctx.fillText('late / early (ms)', PAD.left + 2, devTop - 4);

  const barW = Math.max(1.5, Math.min(7, w / Math.max(1, report.notes.length) - 1));
  for (const n of report.notes) {
    const dev = n.deviationMs / 1000;
    ctx.fillStyle = n.verdict === 'on' ? c.good : n.verdict === 'late' ? c.off : c.primary;
    const top = dev >= 0 ? yDev(dev) : mid;
    const height = Math.max(1.5, Math.abs(yDev(dev) - mid));
    ctx.fillRect(x(n.start) - barW / 2, top, barW, height);
  }
}

// Fills the timing block for one take. `onPickNote(note)` wires a flagged note
// back to the chart above, so a timing mistake can be played straight away.
export function renderTiming(root, notes, { onPickNote } = {}) {
  const section = root.querySelector('#timing');
  if (!section) return null;

  const report = rhythmReport(notes);
  if (!report) {
    section.hidden = true;
    return null;
  }
  section.hidden = false;

  const set = (id, text) => { const el = root.querySelector(id); if (el) el.textContent = text; };
  set('#tm-bpm', String(Math.round(report.bpm)));
  set('#tm-error', `${Math.round(report.meanAbsMs)}ms`);
  set('#tm-even', `${Math.round(report.evenness * 100)}%`);
  const driftPct = report.drift * 100;
  set('#tm-drift', `${driftPct > 0 ? '+' : ''}${driftPct.toFixed(1)}%`);

  const verdictEl = root.querySelector('#timing-verdict');
  const WORDS = {
    steady: 'steady',
    rushing: 'rushing',
    dragging: 'dragging',
    uneven: 'uneven',
  };
  verdictEl.textContent = WORDS[report.verdict] ?? report.verdict;
  verdictEl.dataset.verdict = report.verdict;

  const worstBox = root.querySelector('#timing-worst');
  worstBox.replaceChildren();
  for (const w of report.worst) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = `tm-chip ${w.verdict}`;
    const ms = Math.round(Math.abs(w.deviationMs));
    chip.textContent = `${ordinal(w.index + 1)} note · ${ms}ms ${w.verdict}`;
    chip.addEventListener('click', () => onPickNote?.(notes[w.index]));
    worstBox.append(chip);
  }

  const hint = root.querySelector('#timing-hint');
  if (hint) {
    const grid = report.grid >= report.tactus * 0.99
      ? 'the beat itself'
      : `${Math.round(report.tactus / report.grid)} per beat`;
    const base = `Pulse read from your playing — no metronome needed (grid: ${grid}).`;
    hint.textContent = report.drifting
      ? `${base} The tempo moved through this take, so no single note is called early or late — see where it went in the curve above.`
      : report.worst.length
        ? `${base} Each note is measured against the pulse around it, so drift isn't counted as a mistake. Tap a chip to hear one.`
        : `${base} Every note landed on the beat.`;
  }

  const canvas = root.querySelector('#timing-chart');
  if (canvas) {
    drawTiming(canvas, report);
    // The canvas outlives every take rendered into it, so the previous take's
    // repaint handler has to go before this one is registered — otherwise every
    // review leaves another listener behind, all drawing stale reports.
    canvas._themeOff?.();
    canvas._themeOff = onThemeChange(() => drawTiming(canvas, report));
  }
  return report;
}

export function hideTiming(root) {
  const section = root.querySelector('#timing');
  if (section) section.hidden = true;
}
