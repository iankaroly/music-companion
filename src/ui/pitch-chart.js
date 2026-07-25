import { midiToName } from '../analysis/note-utils.js';
import { findNoteAt, intonationStatus } from './chart-utils.js';

// Two synced views: the session overview (pitch contour, notes tinted by
// verdict, click to play in place) and a zoom inset below it showing one
// note's cents-level detail. Both take the playhead during playback.

const INK = '#1c2230';
const MUTED = '#6d7688';
const GRID = '#e3e7ef';
const GOOD = '#2e9e63';
const STATUS_LINE = { good: '#2e9e63', off: '#e08a1e', bad: '#d64545' };
const STATUS_SPAN = {
  good: 'rgba(46, 158, 99, 0.12)',
  off: 'rgba(224, 138, 30, 0.15)',
  bad: 'rgba(214, 69, 69, 0.13)',
};
const PAD = { top: 16, right: 10, bottom: 18, left: 44 };
const FONT = '12px -apple-system, "Segoe UI", Roboto, sans-serif';
const LINE_WIDTH = 2.5;

function toMidiFloat(r, a4) {
  return 69 + 12 * Math.log2(r.frequency / a4);
}

// Map a mouse event to css-pixel x INSIDE the canvas coordinate space the
// chart was drawn in. Uses the live bounding rect, so the cursor and the
// hover dot stay aligned even when the canvas CSS size has changed since
// render.
function canvasX(e, canvas, cssW) {
  const rect = canvas.getBoundingClientRect();
  return ((e.clientX - rect.left) / rect.width) * cssW;
}

function makeController(canvas, drawFn) {
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 900;
  const cssH = canvas.clientHeight || 280;
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

function nearestPoint(pts, time, key) {
  let nearest = null;
  for (const p of pts) {
    if (p[key] === null || p[key] === undefined) continue;
    if (!nearest || Math.abs(p.time - time) < Math.abs(nearest.time - time)) nearest = p;
  }
  return nearest;
}

// --- session overview ------------------------------------------------------

// Fixed time scale: long sessions extend the canvas and scroll
// horizontally instead of squeezing into the viewport.
const PX_PER_SEC = 110;
const MAX_CHART_PX = 24000;

export function renderOverviewChart(canvas, { readings, notes, a4, onNoteClick, onNoteHover }) {
  if (notes.length === 0) return { setPlayhead() {}, setHover() {}, setHighlight() {} };
  const padT = 0.4;
  const starts = notes.map((n) => n.start);
  const ends = notes.map((n) => n.end);
  const t0 = Math.min(...starts) - padT;
  const t1 = Math.max(...ends) + padT;

  const container = canvas.parentElement;
  const fitW = container?.clientWidth || 900;
  canvas.style.width = `${Math.min(Math.max(fitW, (t1 - t0) * PX_PER_SEC), MAX_CHART_PX)}px`;
  const midis = notes.map((n) => n.midi);
  const yMin = Math.min(...midis) - 1;
  const yMax = Math.max(...midis) + 1;

  const pts = [];
  for (const r of readings) {
    if (r.time < t0 || r.time > t1) continue;
    if (r.frequency === null || r.confidence < 0.6) { pts.push({ time: r.time, mf: null }); continue; }
    const mf = toMidiFloat(r, a4);
    if (mf < yMin - 0.5 || mf > yMax + 0.5) { pts.push({ time: r.time, mf: null }); continue; }
    // the trace wears the intonation verdict of the note it belongs to
    const note = findNoteAt(notes, r.time, 0);
    pts.push({ time: r.time, mf, status: note ? intonationStatus(note.cents) : null });
  }

  const controller = makeController(canvas, (cv, dpr, cssW, cssH, hoverPt, playhead, highlight) => {
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    const w = cssW - PAD.left - PAD.right;
    const h = cssH - PAD.top - PAD.bottom;
    const x = (t) => PAD.left + ((t - t0) / (t1 - t0)) * w;
    const y = (mf) => PAD.top + (1 - (mf - yMin) / (yMax - yMin)) * h;

    // note spans, tinted by intonation; the selected/hovered note lights up
    for (const n of notes) {
      const spanW = Math.max(2, x(n.end) - x(n.start));
      ctx.fillStyle = STATUS_SPAN[intonationStatus(n.cents)];
      ctx.fillRect(x(n.start), PAD.top, spanW, h);
      if (n === highlight) {
        ctx.strokeStyle = INK;
        ctx.lineWidth = 1;
        ctx.strokeRect(x(n.start), PAD.top, spanW, h);
      }
    }

    // semitone gridlines; label sparsely when the range is wide
    ctx.font = FONT;
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

    ctx.lineWidth = LINE_WIDTH;
    ctx.lineJoin = 'round';
    let prev = null;
    for (const p of pts) {
      if (p.mf === null) { prev = null; continue; }
      if (prev) {
        ctx.strokeStyle = p.status && p.status === prev.status ? STATUS_LINE[p.status] : MUTED;
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
      ctx.arc(x(hoverPt.time), y(hoverPt.mf), 4, 0, 2 * Math.PI);
      ctx.fill();
      const nearest = Math.round(hoverPt.mf);
      const cents = (hoverPt.mf - nearest) * 100;
      ctx.textAlign = x(hoverPt.time) > cssW / 2 ? 'right' : 'left';
      const dx = x(hoverPt.time) > cssW / 2 ? -8 : 8;
      ctx.fillText(`${midiToName(nearest)} ${cents >= 0 ? '+' : ''}${cents.toFixed(0)}¢`,
        x(hoverPt.time) + dx, Math.max(PAD.top + 8, y(hoverPt.mf) - 10));
    }
  });

  const timeAt = (e) => {
    const xCss = canvasX(e, canvas, controller.cssW);
    const w = controller.cssW - PAD.left - PAD.right;
    return t0 + ((xCss - PAD.left) / w) * (t1 - t0);
  };
  canvas.onmousemove = (e) => {
    const time = timeAt(e);
    const note = findNoteAt(notes, time);
    canvas.style.cursor = note ? 'pointer' : 'default';
    onNoteHover?.(note);
    controller.setHighlight(note);
    controller.setHover(nearestPoint(pts, time, 'mf'));
  };
  canvas.onmouseleave = () => {
    onNoteHover?.(null);
    controller.setHighlight(null);
    controller.setHover(null);
  };
  canvas.onclick = (e) => {
    const note = findNoteAt(notes, timeAt(e));
    if (note) onNoteClick?.(note);
  };

  // During playback, keep the sweeping playhead in view.
  const basePlayhead = controller.setPlayhead;
  controller.setPlayhead = (t) => {
    basePlayhead(t);
    if (t === null || !container) return;
    const w = controller.cssW - PAD.left - PAD.right;
    const px = PAD.left + ((t - t0) / (t1 - t0)) * w;
    const view = container.clientWidth;
    if (px < container.scrollLeft + 40 || px > container.scrollLeft + view - 40) {
      container.scrollLeft = Math.max(0, px - view / 3);
    }
  };
  return controller;
}

// --- zoom inset: one note in cents detail ----------------------------------

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

  const controller = makeController(canvas, (cv, dpr, cssW, cssH, hoverPt, playhead) => {
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    const w = cssW - PAD.left - PAD.right;
    const h = cssH - PAD.top - PAD.bottom;
    const x = (t) => PAD.left + ((t - t0) / (t1 - t0)) * w;
    const y = (dev) => PAD.top + (1 - (dev + CLAMP) / (2 * CLAMP)) * h;

    ctx.fillStyle = 'rgba(28, 34, 48, 0.05)';
    ctx.fillRect(x(note.start), PAD.top, x(note.end) - x(note.start), h);

    ctx.font = FONT;
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

    ctx.lineWidth = LINE_WIDTH;
    ctx.lineJoin = 'round';
    let prev = null;
    for (const p of pts) {
      if (p.dev === null) { prev = null; continue; }
      if (prev) {
        // inside the note, each moment wears its own in-tune color
        ctx.strokeStyle = p.inTarget && prev.inTarget
          ? STATUS_LINE[intonationStatus(p.dev)]
          : MUTED;
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
      ctx.arc(x(hoverPt.time), y(hoverPt.dev), 4, 0, 2 * Math.PI);
      ctx.fill();
      ctx.textAlign = x(hoverPt.time) > cssW / 2 ? 'right' : 'left';
      const dx = x(hoverPt.time) > cssW / 2 ? -8 : 8;
      ctx.fillText(`${hoverPt.dev >= 0 ? '+' : ''}${hoverPt.dev.toFixed(0)}¢`,
        x(hoverPt.time) + dx, Math.max(PAD.top + 8, y(hoverPt.dev) - 10));
    }
  });

  canvas.onmousemove = (e) => {
    const xCss = canvasX(e, canvas, controller.cssW);
    const w = controller.cssW - PAD.left - PAD.right;
    const time = t0 + ((xCss - PAD.left) / w) * (t1 - t0);
    controller.setHover(nearestPoint(pts, time, 'dev'));
  };
  canvas.onmouseleave = () => controller.setHover(null);
  return controller;
}
