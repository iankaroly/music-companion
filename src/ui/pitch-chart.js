import { midiToName } from '../analysis/note-utils.js';

// Two views over the same pitch data, one renderer:
// - Overview: the whole session as a pitch contour with each detected
//   note's span tinted by how in-tune it was. Shown as soon as a report
//   opens — no click needed.
// - Note zoom: cents deviation around one clicked note.
// Both return a controller whose setPlayhead(recordingTime|null) draws a
// sweeping cursor during playback, so you can see exactly when the note
// you're studying is sounding.

const INK = '#ece7df';
const MUTED = '#8d8578';
const GRID = '#2e2a25';
const GOOD = '#7fc98f';
const SPAN_GOOD = 'rgba(127, 201, 143, 0.10)';
const SPAN_OFF = 'rgba(224, 164, 88, 0.16)';
const PAD = { top: 10, right: 8, bottom: 14, left: 34 };

function toMidiFloat(r, a4) {
  return 69 + 12 * Math.log2(r.frequency / a4);
}

function makeController(canvas, drawFn) {
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 440;
  const cssH = canvas.clientHeight || 110;
  canvas.width = cssW * dpr;
  canvas.height = cssH * dpr;

  let hoverPt = null;
  let playhead = null;
  let highlight = null;
  const draw = () => drawFn(canvas, dpr, cssW, cssH, hoverPt, playhead, highlight);
  draw();

  return {
    cssW,
    setHover(pt) { hoverPt = pt; draw(); },
    setPlayhead(t) { playhead = t; draw(); },
    setHighlight(note) { highlight = note; draw(); },
  };
}

function drawPlayhead(ctx, x, top, height) {
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, top);
  ctx.lineTo(x, top + height);
  ctx.stroke();
}

// --- per-note zoom ---------------------------------------------------------

export function renderNoteChart(canvas, { readings, note, a4, contextSec = 1.2 }) {
  const CLAMP = 150;
  const t0 = note.start - contextSec;
  const t1 = note.end + contextSec;
  const pts = [];
  for (const r of readings) {
    if (r.time < t0 || r.time > t1) continue;
    if (r.frequency === null || r.confidence < 0.6) { pts.push({ time: r.time, dev: null }); continue; }
    const dev = Math.max(-CLAMP, Math.min(CLAMP, (toMidiFloat(r, a4) - note.midi) * 100));
    pts.push({ time: r.time, dev, inTarget: r.time >= note.start && r.time <= note.end });
  }

  const controller = makeController(canvas, (cv, dpr, cssW, cssH, hoverPt, playhead, _highlight) => {
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    const w = cssW - PAD.left - PAD.right;
    const h = cssH - PAD.top - PAD.bottom;
    const x = (t) => PAD.left + ((t - t0) / (t1 - t0)) * w;
    const y = (dev) => PAD.top + (1 - (dev + CLAMP) / (2 * CLAMP)) * h;

    ctx.fillStyle = 'rgba(236, 231, 223, 0.06)';
    ctx.fillRect(x(note.start), PAD.top, x(note.end) - x(note.start), h);

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

    if (playhead !== null && playhead >= t0 && playhead <= t1) {
      drawPlayhead(ctx, x(playhead), PAD.top, h);
    }

    if (hoverPt) {
      ctx.fillStyle = INK;
      ctx.beginPath();
      ctx.arc(x(hoverPt.time), y(hoverPt.dev), 3, 0, 2 * Math.PI);
      ctx.fill();
      ctx.textAlign = x(hoverPt.time) > cssW / 2 ? 'right' : 'left';
      const dx = x(hoverPt.time) > cssW / 2 ? -8 : 8;
      ctx.fillText(`${hoverPt.dev >= 0 ? '+' : ''}${hoverPt.dev.toFixed(0)}¢`,
        x(hoverPt.time) + dx, Math.max(PAD.top + 8, y(hoverPt.dev) - 10));
    }
  });

  attachHover(canvas, controller, pts, t0, t1);
  return controller;
}

// --- session overview ------------------------------------------------------

export function renderOverviewChart(canvas, { readings, notes, a4 }) {
  if (notes.length === 0) return { setPlayhead() {}, setHover() {}, setHighlight() {} };
  const padT = 0.4;
  const t0 = notes[0].start - padT;
  const t1 = notes.at(-1).end + padT;
  const midis = notes.map((n) => n.midi);
  const yMin = Math.min(...midis) - 1;
  const yMax = Math.max(...midis) + 1;

  const pts = [];
  for (const r of readings) {
    if (r.time < t0 || r.time > t1) continue;
    if (r.frequency === null || r.confidence < 0.6) { pts.push({ time: r.time, mf: null }); continue; }
    const mf = toMidiFloat(r, a4);
    if (mf < yMin - 0.5 || mf > yMax + 0.5) { pts.push({ time: r.time, mf: null }); continue; }
    pts.push({ time: r.time, mf });
  }

  const controller = makeController(canvas, (cv, dpr, cssW, cssH, hoverPt, playhead, highlight) => {
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    const w = cssW - PAD.left - PAD.right;
    const h = cssH - PAD.top - PAD.bottom;
    const x = (t) => PAD.left + ((t - t0) / (t1 - t0)) * w;
    const y = (mf) => PAD.top + (1 - (mf - yMin) / (yMax - yMin)) * h;

    // note spans, tinted by intonation; a hovered box's span lights up
    for (const n of notes) {
      ctx.fillStyle = Math.abs(n.cents) < 8 ? SPAN_GOOD : SPAN_OFF;
      ctx.fillRect(x(n.start), PAD.top, Math.max(2, x(n.end) - x(n.start)), h);
      if (n === highlight) {
        ctx.strokeStyle = INK;
        ctx.lineWidth = 1;
        ctx.strokeRect(x(n.start), PAD.top, Math.max(2, x(n.end) - x(n.start)), h);
      }
    }

    // semitone gridlines; label sparsely when the range is wide
    ctx.font = '10px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    const range = yMax - yMin;
    for (let m = Math.ceil(yMin); m <= Math.floor(yMax); m++) {
      ctx.strokeStyle = GRID;
      ctx.beginPath();
      ctx.moveTo(PAD.left, y(m));
      ctx.lineTo(cssW - PAD.right, y(m));
      ctx.stroke();
      if (range <= 13 || m % 12 === 0 || m % 12 === 2 || m % 12 === 7) {
        ctx.fillStyle = MUTED;
        ctx.textAlign = 'right';
        ctx.fillText(midiToName(m), PAD.left - 5, y(m));
      }
    }

    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    let prev = null;
    for (const p of pts) {
      if (p.mf === null) { prev = null; continue; }
      if (prev) {
        ctx.strokeStyle = INK;
        ctx.beginPath();
        ctx.moveTo(x(prev.time), y(prev.mf));
        ctx.lineTo(x(p.time), y(p.mf));
        ctx.stroke();
      }
      prev = p;
    }

    if (playhead !== null && playhead >= t0 && playhead <= t1) {
      drawPlayhead(ctx, x(playhead), PAD.top, h);
    }

    if (hoverPt) {
      ctx.fillStyle = INK;
      ctx.beginPath();
      ctx.arc(x(hoverPt.time), y(hoverPt.mf), 3, 0, 2 * Math.PI);
      ctx.fill();
      const nearest = Math.round(hoverPt.mf);
      const cents = (hoverPt.mf - nearest) * 100;
      ctx.textAlign = x(hoverPt.time) > cssW / 2 ? 'right' : 'left';
      const dx = x(hoverPt.time) > cssW / 2 ? -8 : 8;
      ctx.fillText(`${midiToName(nearest)} ${cents >= 0 ? '+' : ''}${cents.toFixed(0)}¢`,
        x(hoverPt.time) + dx, Math.max(PAD.top + 8, y(hoverPt.mf) - 10));
    }
  });

  attachHover(canvas, controller, pts, t0, t1, 'mf');
  return controller;
}

function attachHover(canvas, controller, pts, t0, t1, key = 'dev') {
  canvas.onmousemove = (e) => {
    const rect = canvas.getBoundingClientRect();
    const w = controller.cssW - PAD.left - PAD.right;
    const time = t0 + ((e.clientX - rect.left - PAD.left) / w) * (t1 - t0);
    let nearest = null;
    for (const p of pts) {
      if (p[key] === null || p[key] === undefined) continue;
      if (!nearest || Math.abs(p.time - time) < Math.abs(nearest.time - time)) nearest = p;
    }
    controller.setHover(nearest);
  };
  canvas.onmouseleave = () => controller.setHover(null);
}
