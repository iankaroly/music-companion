import { midiToName } from '../analysis/note-utils.js';
import { findNoteAt, intonationStatus } from './chart-utils.js';

// Two views over the same pitch data, one renderer:
// - Overview: the whole session as a pitch contour with each detected
//   note's span tinted by how in-tune it was. Shown as soon as a report
//   opens — no click needed.
// - Note zoom: cents deviation around one clicked note.
// Both return a controller whose setPlayhead(recordingTime|null) draws a
// sweeping cursor during playback, so you can see exactly when the note
// you're studying is sounding.

const INK = '#33261b';
const MUTED = '#8a7a68';
const GRID = '#eae1cf';
const GOOD = '#3f9d63';
const STATUS_LINE = { good: '#3f9d63', off: '#d9862a', bad: '#c8524a' };
const STATUS_SPAN = {
  good: 'rgba(63, 157, 99, 0.12)',
  off: 'rgba(217, 134, 42, 0.14)',
  bad: 'rgba(200, 82, 74, 0.14)',
};
const PAD = { top: 16, right: 10, bottom: 18, left: 44 };
const FONT = '12px system-ui, sans-serif';
const LINE_WIDTH = 2.5;

function toMidiFloat(r, a4) {
  return 69 + 12 * Math.log2(r.frequency / a4);
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

// --- session overview ------------------------------------------------------

export function renderOverviewChart(canvas, { readings, notes, a4, onNoteClick, onNoteHover }) {
  if (notes.length === 0) return { setPlayhead() {}, setHover() {}, setHighlight() {} };
  const padT = 0.4;
  const starts = notes.map((n) => n.start);
  const ends = notes.map((n) => n.end);
  const t0 = Math.min(...starts) - padT;
  const t1 = Math.max(...ends) + padT;
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

    // note spans, tinted by intonation; a hovered box's span lights up
    ctx.font = FONT;
    ctx.textBaseline = 'middle';
    for (const n of notes) {
      const spanW = Math.max(2, x(n.end) - x(n.start));
      ctx.fillStyle = STATUS_SPAN[intonationStatus(n.cents)];
      ctx.fillRect(x(n.start), PAD.top, spanW, h);
      if (n === highlight) {
        ctx.strokeStyle = INK;
        ctx.lineWidth = 1;
        ctx.strokeRect(x(n.start), PAD.top, spanW, h);
      }
      // name each note directly on the graph when there's room
      if (spanW > 30) {
        ctx.fillStyle = MUTED;
        ctx.textAlign = 'center';
        ctx.fillText(`${n.chord ? '+' : ''}${n.name}`, x(n.start) + spanW / 2, PAD.top - 7);
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

  // The chart is the navigator: click any note's stretch of the trace to
  // select it; hovering shows which note is under the cursor.
  const timeAt = (e) => {
    const rect = canvas.getBoundingClientRect();
    const w = controller.cssW - PAD.left - PAD.right;
    return t0 + ((e.clientX - rect.left - PAD.left) / w) * (t1 - t0);
  };
  canvas.onmousemove = (e) => {
    const time = timeAt(e);
    const note = findNoteAt(notes, time);
    canvas.style.cursor = note ? 'pointer' : 'default';
    onNoteHover?.(note);
    controller.setHighlight(note);
    let nearest = null;
    for (const p of pts) {
      if (p.mf === null) continue;
      if (!nearest || Math.abs(p.time - time) < Math.abs(nearest.time - time)) nearest = p;
    }
    controller.setHover(nearest);
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
  return controller;
}
