import { midiToName } from '../analysis/note-utils.js';

// Pitch trace around a replayed note: cents deviation from the target
// pitch over time. Single series — the target span in primary ink, the
// context dimmed, semitone gridlines named, a dashed "in tune" line at 0.
// Hover shows the exact deviation under the cursor.

const INK = '#ece7df';
const MUTED = '#8d8578';
const GRID = '#2e2a25';
const GOOD = '#7fc98f';
const CLAMP_CENTS = 150;
const PAD = { top: 10, right: 8, bottom: 14, left: 34 };

function computePoints({ readings, note, a4, contextSec = 1.2 }) {
  const t0 = note.start - contextSec;
  const t1 = note.end + contextSec;
  const pts = [];
  for (const r of readings) {
    if (r.time < t0 || r.time > t1) continue;
    if (r.frequency === null || r.confidence < 0.6) {
      pts.push({ time: r.time, dev: null });
      continue;
    }
    const midiFloat = 69 + 12 * Math.log2(r.frequency / a4);
    const dev = Math.max(-CLAMP_CENTS, Math.min(CLAMP_CENTS, (midiFloat - note.midi) * 100));
    pts.push({ time: r.time, dev, inTarget: r.time >= note.start && r.time <= note.end });
  }
  return { pts, t0, t1 };
}

export function renderPitchChart(canvas, model) {
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 440;
  const cssH = canvas.clientHeight || 110;
  canvas.width = cssW * dpr;
  canvas.height = cssH * dpr;

  const data = computePoints(model);
  const draw = (hoverPt = null) => drawChart(canvas, model, data, hoverPt, dpr, cssW, cssH);
  draw();

  canvas.onmousemove = (e) => {
    const rect = canvas.getBoundingClientRect();
    const time = xToTime(e.clientX - rect.left, data, cssW);
    let nearest = null;
    for (const p of data.pts) {
      if (p.dev === null) continue;
      if (!nearest || Math.abs(p.time - time) < Math.abs(nearest.time - time)) nearest = p;
    }
    draw(nearest);
  };
  canvas.onmouseleave = () => draw();
}

function xToTime(x, { t0, t1 }, cssW) {
  const w = cssW - PAD.left - PAD.right;
  return t0 + ((x - PAD.left) / w) * (t1 - t0);
}

function drawChart(canvas, model, data, hoverPt, dpr, cssW, cssH) {
  const { note } = model;
  const { pts, t0, t1 } = data;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const w = cssW - PAD.left - PAD.right;
  const h = cssH - PAD.top - PAD.bottom;
  const x = (t) => PAD.left + ((t - t0) / (t1 - t0)) * w;
  const y = (dev) => PAD.top + (1 - (dev + CLAMP_CENTS) / (2 * CLAMP_CENTS)) * h;

  // target span highlight
  ctx.fillStyle = 'rgba(236, 231, 223, 0.06)';
  ctx.fillRect(x(note.start), PAD.top, x(note.end) - x(note.start), h);

  // semitone gridlines, named; zero line dashed in the good color
  ctx.font = '10px system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  for (const dev of [-100, 0, 100]) {
    ctx.strokeStyle = dev === 0 ? GOOD : GRID;
    ctx.setLineDash(dev === 0 ? [4, 4] : []);
    ctx.beginPath();
    ctx.moveTo(PAD.left, y(dev));
    ctx.lineTo(cssW - PAD.right, y(dev));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = MUTED;
    ctx.textAlign = 'right';
    ctx.fillText(midiToName(note.midi + dev / 100), PAD.left - 5, y(dev));
  }

  // the trace, broken at unvoiced gaps, dim outside the target
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  let prev = null;
  for (const p of pts) {
    if (p.dev === null) { prev = null; continue; }
    if (prev) {
      ctx.strokeStyle = p.inTarget && prev.inTarget ? INK : MUTED;
      ctx.beginPath();
      ctx.moveTo(x(prev.time), y(prev.dev));
      ctx.lineTo(x(p.time), y(p.dev));
      ctx.stroke();
    }
    prev = p;
  }

  // hover crosshair + readout (ink, not series color)
  if (hoverPt) {
    ctx.strokeStyle = GRID;
    ctx.beginPath();
    ctx.moveTo(x(hoverPt.time), PAD.top);
    ctx.lineTo(x(hoverPt.time), PAD.top + h);
    ctx.stroke();
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.arc(x(hoverPt.time), y(hoverPt.dev), 3, 0, 2 * Math.PI);
    ctx.fill();
    ctx.textAlign = x(hoverPt.time) > cssW / 2 ? 'right' : 'left';
    const dx = x(hoverPt.time) > cssW / 2 ? -8 : 8;
    ctx.fillText(
      `${hoverPt.dev >= 0 ? '+' : ''}${hoverPt.dev.toFixed(0)}¢`,
      x(hoverPt.time) + dx,
      Math.max(PAD.top + 8, y(hoverPt.dev) - 10),
    );
  }
}
