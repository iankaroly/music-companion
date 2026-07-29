// The timing section of a take's report: what pulse the playing implied, how
// each note sat against it, and where the tempo went.
//
// One canvas, two lanes over a shared time axis — the tempo curve on top,
// per-note deviation bars below. Unlike the pitch chart above it this is always
// the whole take at container width, so it stays a summary you can take in at
// a glance rather than something else to scroll.
//
// The pulse can be inferred (the default: no metronome needed, and every take
// already in the library can be read retroactively) or LOCKED to a tempo the
// player names. Those answer different questions. Inferred asks "was that note
// early against what was going on around it"; locked asks "did I hold 92", and
// counts the drift that the inferred reading deliberately forgives.

import { rhythmReport } from '../analysis/rhythm.js';
import { palette, onThemeChange } from './theme.js';

let PAD = { top: 14, right: 10, bottom: 16, left: 40 };
const FONT = '11px -apple-system, "Segoe UI", Roboto, sans-serif';
const CURVE_SHARE = 0.44;  // how much of the height the tempo lane takes
const DEV_CEILING = 0.12;  // deviation axis: ±120 ms, or the worst note if larger

// On a phone the axis gutter is a tenth of the screen. Trimmed there, so the
// data gets the width instead of the labels.
function syncPad() {
  const narrow = (globalThis.innerWidth ?? 900) <= 640;
  PAD = narrow
    ? { top: 12, right: 6, bottom: 15, left: 28 }
    : { top: 14, right: 10, bottom: 16, left: 40 };
}

function ordinal(n) {
  const rest = n % 100;
  if (rest >= 11 && rest <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

// Where each note sits horizontally — shared by the drawing code and the
// tap-a-bar hit test, so they can't drift apart.
function axisOf(canvas, report) {
  const cssW = canvas.clientWidth || 600;
  const times = report.notes.map((n) => n.start);
  const t0 = Math.min(...times);
  const t1 = Math.max(...times, t0 + 1);
  const w = cssW - PAD.left - PAD.right;
  return { cssW, t0, t1, x: (t) => PAD.left + ((t - t0) / (t1 - t0)) * w };
}

function drawTiming(canvas, report) {
  syncPad();
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

  const { t0, t1, x } = axisOf(canvas, report);

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
    ctx.fillText(report.locked ? `tempo · held at ${Math.round(centre)}` : 'tempo',
      PAD.left + 2, PAD.top - 4);
  }

  // --- deviation lane ---
  const worstDev = Math.max(DEV_CEILING, ...report.notes.map((n) => Math.abs(n.deviationMs) / 1000));
  const msLabel = Math.round(worstDev * 800);
  const yDev = (seconds) => mid - (seconds / worstDev) * (devH / 2);

  // With the pulse locked, the beats themselves are a fact worth drawing:
  // the bars are distances from these lines.
  if (report.locked && Number.isFinite(report.phase)) {
    ctx.strokeStyle = c.grid;
    ctx.lineWidth = 1;
    const step = report.tactus;
    const first = Math.ceil((t0 - report.phase) / step);
    const last = Math.floor((t1 - report.phase) / step);
    if (last - first < 400) { // don't hairline the whole lane on a long take
      for (let k = first; k <= last; k++) {
        const px = x(report.phase + k * step);
        ctx.beginPath();
        ctx.moveTo(px, devTop);
        ctx.lineTo(px, devTop + devH);
        ctx.stroke();
      }
    }
  }

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

  const w = cssW - PAD.left - PAD.right;
  const barW = Math.max(2.5, Math.min(9, w / Math.max(1, report.notes.length) - 1));
  for (const n of report.notes) {
    const dev = n.deviationMs / 1000;
    ctx.fillStyle = n.verdict === 'on' ? c.good : n.verdict === 'late' ? c.off : c.primary;
    const top = dev >= 0 ? yDev(dev) : mid;
    const height = Math.max(2, Math.abs(yDev(dev) - mid));
    ctx.fillRect(x(n.start) - barW / 2, top, barW, height);
  }
}

// mm:ss, matching the passage list.
function clock(seconds) {
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}

// The pulse the panel is currently reading against. Persisted, because a
// player working on one étude wants the same tempo next session.
function readPulse() {
  try {
    const raw = JSON.parse(globalThis.localStorage?.getItem('timingPulse') ?? 'null');
    if (raw && Number.isFinite(raw.bpm)) {
      return { bpm: raw.bpm, subdivision: raw.subdivision ?? 1, locked: !!raw.locked };
    }
  } catch { /* fresh install */ }
  return { bpm: 80, subdivision: 1, locked: false };
}

function writePulse(pulse) {
  try {
    globalThis.localStorage?.setItem('timingPulse', JSON.stringify(pulse));
  } catch { /* survivable */ }
}

let filter = 'worst';

// Fills the timing block for one take.
//   onPickNote(note)  — wires a flagged note back to the chart above
//   onClickTrack(grid) — hands over { phase, step, until } to play a click with
//                        the take, or null to stop
export function renderTiming(root, notes, { onPickNote, onClickTrack } = {}) {
  const section = root.querySelector('#timing');
  if (!section) return null;

  const pulse = readPulse();
  let report = null;
  let clicking = false;

  const chipBox = root.querySelector('#timing-worst');
  const canvas = root.querySelector('#timing-chart');
  const set = (id, text) => { const el = root.querySelector(id); if (el) el.textContent = text; };

  const clickGrid = () => (report ? {
    phase: report.phase ?? 0,
    step: report.tactus,
    until: Math.max(...report.notes.map((n) => n.start)) + report.tactus,
  } : null);

  function renderChips() {
    chipBox.replaceChildren();
    const source = filter === 'worst' ? report.worst
      : filter === 'late' ? report.flagged.filter((p) => p.verdict === 'late')
        : filter === 'early' ? report.flagged.filter((p) => p.verdict === 'early')
          : report.flagged;
    const shown = source.slice(0, filter === 'worst' ? 5 : 24);
    for (const w of shown) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = `tm-chip ${w.verdict}`;
      const ms = Math.round(Math.abs(w.deviationMs));
      chip.textContent = `${ordinal(w.index + 1)} · ${w.name ?? ''} ${ms}ms ${w.verdict}`.replace('  ', ' ');
      chip.title = `at ${clock(w.start)}`;
      chip.addEventListener('click', () => onPickNote?.(notes[w.index]));
      chipBox.append(chip);
    }
    if (shown.length === 0) {
      const none = document.createElement('span');
      none.className = 'tm-none';
      none.textContent = report.drifting && !report.locked
        ? 'the tempo moved through this take — lock a pulse to see notes named'
        : 'nothing outside 45 ms here';
      chipBox.append(none);
    }
    if (source.length > shown.length) {
      const more = document.createElement('span');
      more.className = 'tm-none';
      more.textContent = `+${source.length - shown.length} more`;
      chipBox.append(more);
    }
  }

  function paintFilters() {
    for (const b of root.querySelectorAll('#timing-filter button')) {
      b.classList.toggle('active', b.dataset.filter === filter);
    }
  }

  function run() {
    report = rhythmReport(notes, pulse.locked
      ? { bpm: pulse.bpm, subdivision: pulse.subdivision }
      : {});
    if (!report) {
      section.hidden = true;
      return null;
    }
    section.hidden = false;

    set('#tm-bpm', String(Math.round(report.bpm)));
    set('#tm-error', `${Math.round(report.meanAbsMs)}ms`);
    set('#tm-on', `${Math.round(report.onBeat * 100)}%`);
    set('#tm-even', `${Math.round(report.evenness * 100)}%`);
    const driftPct = report.drift * 100;
    set('#tm-drift', `${driftPct > 0 ? '+' : ''}${driftPct.toFixed(1)}%`);

    const verdictEl = root.querySelector('#timing-verdict');
    const WORDS = {
      steady: 'steady', rushing: 'rushing', dragging: 'dragging', uneven: 'uneven',
    };
    verdictEl.textContent = WORDS[report.verdict] ?? report.verdict;
    verdictEl.dataset.verdict = report.verdict;

    renderChips();

    const hint = root.querySelector('#timing-hint');
    if (hint) {
      if (pulse.locked) {
        const per = pulse.subdivision > 1 ? ` (${pulse.subdivision} per beat)` : '';
        hint.textContent = `Measured against a fixed ${pulse.bpm} bpm${per} — drift counts here,`
          + ' unlike the read-from-your-playing pulse. Tap a bar or a chip to hear that note.';
      } else {
        const grid = report.grid >= report.tactus * 0.99
          ? 'the beat itself'
          : `${Math.round(report.tactus / report.grid)} per beat`;
        const base = `Pulse read from your playing — no metronome needed (grid: ${grid}).`;
        hint.textContent = report.drifting
          ? `${base} The tempo moved through this take, so no single note is called early or late — see where it went in the curve above.`
          : report.worst.length
            ? `${base} Each note is measured against the pulse around it, so drift isn't counted as a mistake. Tap a bar or a chip to hear one.`
            : `${base} Every note landed on the beat.`;
      }
    }

    if (canvas) {
      drawTiming(canvas, report);
      // The canvas outlives every take rendered into it, so the previous take's
      // repaint handler has to go before this one is registered — otherwise every
      // review leaves another listener behind, all drawing stale reports.
      canvas._themeOff?.();
      canvas._themeOff = onThemeChange(() => drawTiming(canvas, report));
      // Tapping a bar picks that note: the deviation lane is a map of the take,
      // and the thing you want after seeing a tall bar is to hear it.
      canvas.onclick = (e) => {
        if (!report) return;
        const rect = canvas.getBoundingClientRect();
        const px = ((e.clientX - rect.left) / rect.width) * (canvas.clientWidth || rect.width);
        const { x } = axisOf(canvas, report);
        let best = null;
        for (const n of report.notes) {
          const d = Math.abs(x(n.start) - px);
          if (!best || d < best.d) best = { d, n };
        }
        if (best && best.d < 18) onPickNote?.(notes[best.n.index]);
      };
      canvas.style.cursor = 'pointer';
    }
    if (clicking) onClickTrack?.(clickGrid());
    return report;
  }

  // --- the pulse controls ---------------------------------------------------

  const bpmField = root.querySelector('#timing-bpm');
  const lockBtn = root.querySelector('#timing-lock');
  const divGroup = root.querySelector('#timing-div');
  const clickBtn = root.querySelector('#timing-click');

  const paintPulse = () => {
    lockBtn.classList.toggle('active', pulse.locked);
    lockBtn.textContent = pulse.locked ? 'Pulse: locked' : 'Pulse: auto';
    bpmField.parentElement.hidden = !pulse.locked;
    divGroup.hidden = !pulse.locked;
    bpmField.value = String(pulse.bpm);
    for (const b of divGroup.querySelectorAll('button')) {
      b.classList.toggle('active', Number(b.dataset.div) === pulse.subdivision);
    }
  };

  const commit = () => { writePulse(pulse); paintPulse(); run(); };

  lockBtn.onclick = () => {
    // Locking with nothing chosen yet starts from the tempo the app just read,
    // which is almost always the tempo the player meant.
    if (!pulse.locked && report) pulse.bpm = Math.max(20, Math.min(300, Math.round(report.bpm)));
    pulse.locked = !pulse.locked;
    commit();
  };
  bpmField.oninput = () => {
    const v = Number(bpmField.value);
    if (Number.isFinite(v) && v >= 20 && v <= 300) { pulse.bpm = Math.round(v); commit(); }
  };
  root.querySelector('#timing-bpm-down').onclick = () => {
    pulse.bpm = Math.max(20, pulse.bpm - 1); commit();
  };
  root.querySelector('#timing-bpm-up').onclick = () => {
    pulse.bpm = Math.min(300, pulse.bpm + 1); commit();
  };
  for (const b of divGroup.querySelectorAll('button')) {
    b.onclick = () => { pulse.subdivision = Number(b.dataset.div); commit(); };
  }
  for (const b of root.querySelectorAll('#timing-filter button')) {
    b.onclick = () => { filter = b.dataset.filter; paintFilters(); renderChips(); };
  }
  paintFilters();

  clickBtn.hidden = !onClickTrack;
  clickBtn.classList.remove('active');
  clickBtn.onclick = () => {
    clicking = !clicking;
    clickBtn.classList.toggle('active', clicking);
    onClickTrack?.(clicking ? clickGrid() : null);
  };

  paintPulse();
  return run();
}

export function hideTiming(root) {
  const section = root.querySelector('#timing');
  if (section) section.hidden = true;
}
