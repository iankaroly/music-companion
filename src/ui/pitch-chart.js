import { midiToName } from '../analysis/note-utils.js';
import { findNoteAt, intonationStatus } from './chart-utils.js';
import { palette, onThemeChange } from './theme.js';

// Two synced views: the session overview (pitch contour, notes tinted by
// verdict, click to play in place) and a zoom inset below it showing one
// note's cents-level detail. Both take the playhead during playback.

// A canvas can't see CSS variables, so every colour comes from the theme's
// palette at draw time. C() is cached and invalidated on a theme switch.
const C = palette;
const STATUS_LINE = () => {
  const p = C();
  return { good: p.good, off: p.off, bad: p.bad };
};
const STATUS_SPAN = () => {
  const p = C();
  return { good: p.goodFill, off: p.offFill, bad: p.badFill };
};
// The note-name gutter used to be a fixed 44px, which is a tenth of a phone
// screen spent on labels. Trimming it to a guess was worse: "C#4" is wider
// than the guess, so the labels ran off the left edge of the canvas and were
// sliced in half. The gutter is measured from the widest label the chart will
// actually draw, so it is exactly as wide as it needs to be and never less.
// Reassigned wholesale before each render, so every closure below reads the
// current geometry.
const LABEL_GAP = 5;  // between the label and the axis
const EDGE_GAP = 3;   // between the label and the canvas edge
let PAD = { top: 16, right: 10, bottom: 18, left: 44 };

const FONT = '12px -apple-system, "Segoe UI", Roboto, sans-serif';

function syncPad(canvas, labels = []) {
  const narrow = (globalThis.innerWidth ?? 900) <= 640;
  PAD = narrow
    ? { top: 14, right: 5, bottom: 16, left: 28 }
    : { top: 16, right: 10, bottom: 18, left: 44 };
  const ctx = canvas?.getContext?.('2d');
  if (!ctx || labels.length === 0) return;
  ctx.font = FONT;
  let widest = 0;
  for (const label of labels) widest = Math.max(widest, ctx.measureText(label).width);
  PAD.left = Math.max(PAD.left, Math.ceil(widest) + LABEL_GAP + EDGE_GAP);
}
const LIVE_FONT_PX = 12;
const EMPTY = new Set();
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
  let highlight = EMPTY; // a set: comparison lights up several notes at once
  const draw = () => drawFn(canvas, dpr, cssW, cssH, hoverPt, playhead, highlight);

  // A phone reports pointer moves faster than it can paint — two or three per
  // displayed frame is normal — and every one of them used to repaint the whole
  // canvas synchronously. Dragging the cursor was therefore doing most of its
  // work to produce pixels nobody ever saw, and it felt exactly as slow as that
  // sounds. Draws are collapsed to one per frame instead: state is written
  // immediately, so the last value in a frame is the one drawn, and a reader
  // asking for the current position still gets the truth.
  let frame = 0;
  const scheduleDraw = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => { frame = 0; draw(); });
  };
  draw();

  // A canvas keeps whatever it was last painted with, so a theme switch has to
  // ask it to repaint. These canvases are permanent fixtures re-rendered many
  // times over (every note click builds a fresh zoom controller), so the
  // previous handler is dropped first — same bookkeeping as attachPinch below.
  canvas._themeOff?.();
  canvas._themeOff = onThemeChange(draw);

  return {
    cssW,
    repaint: scheduleDraw, // the virtualised overview repaints on scroll
    setHover(pt) { hoverPt = pt; scheduleDraw(); },
    setPlayhead(t) { playhead = t; scheduleDraw(); },
    // Accepts one note, a list of them, or null — comparison highlights every
    // other take of the same pitch, while playback highlights just the one
    // that's sounding.
    setHighlight(notes) {
      highlight = notes == null ? EMPTY
        : notes instanceof Set ? notes
          : new Set(Array.isArray(notes) ? notes : [notes]);
      scheduleDraw();
    },
  };
}

function drawPlayhead(ctx, x, top, height) {
  ctx.strokeStyle = C().ink;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, top);
  ctx.lineTo(x, top + height);
  ctx.stroke();
}

// Two-finger pinch (or trackpad ctrl+wheel) rescales a chart's time axis.
// Gesture state lives ON the canvas element because charts re-render
// mid-gesture and their listeners are recreated; the new value is always
// computed from the gesture's start so re-renders stay stable. `invert`
// is for values where spreading fingers should SHRINK the number (like a
// context-window width).
// Charts cover most of the screen, and they swallow the pinch to rescale their
// own time axis. If the page ever ends up zoomed anyway — iOS Safari honours no
// request not to — swallowing the gesture would trap the user at that
// magnification with nowhere left to pinch. So while the page is zoomed, the
// charts hand the gesture back to the browser and the user can always get out.
function pageIsZoomed() {
  return (window.visualViewport?.scale ?? 1) > 1.01;
}

function attachPinch(canvas, { value, min, max, invert = false, onScale }) {
  for (const [type, fn] of canvas._pinchListeners ?? []) canvas.removeEventListener(type, fn);
  canvas._pinchListeners = [];
  if (!onScale) return;
  const clamp = (v) => Math.max(min, Math.min(max, v));
  const dist = (touches) => Math.hypot(
    touches[0].clientX - touches[1].clientX,
    touches[0].clientY - touches[1].clientY,
  );
  const listen = (type, fn) => {
    canvas.addEventListener(type, fn, { passive: false });
    canvas._pinchListeners.push([type, fn]);
  };
  listen('touchstart', (e) => {
    if (e.touches.length === 2 && !pageIsZoomed()) {
      e.preventDefault();
      canvas._pinch = { d0: dist(e.touches), v0: value };
    }
  });
  listen('touchmove', (e) => {
    if (canvas._pinch && e.touches.length === 2) {
      e.preventDefault();
      const ratio = dist(e.touches) / canvas._pinch.d0;
      onScale(clamp(invert ? canvas._pinch.v0 / ratio : canvas._pinch.v0 * ratio));
    }
  });
  const endPinch = (e) => { if (e.touches.length < 2) canvas._pinch = null; };
  listen('touchend', endPinch);
  listen('touchcancel', endPinch);
  listen('gesturestart', (e) => { if (!pageIsZoomed()) e.preventDefault(); }); // Safari page-zoom
  listen('wheel', (e) => {
    if (!e.ctrlKey) return; // trackpad pinch arrives as ctrl+wheel
    e.preventDefault();
    onScale(clamp(value * Math.exp((invert ? e.deltaY : -e.deltaY) * 0.01)));
  });
}

// The trace sample under a given time. Called once per animation frame while
// the take plays, and `pts` runs to tens of thousands of samples on a long
// take, so it binary-searches the (time-sorted) array rather than scanning.
function sampleAt(pts, time) {
  let lo = 0;
  let hi = pts.length - 1;
  let best = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const p = pts[mid];
    if (best === null || Math.abs(p.time - time) < Math.abs(best.time - time)) best = p;
    if (p.time < time) lo = mid + 1;
    else hi = mid - 1;
  }
  return best;
}

// How sharp or flat the playing is right now, printed beside the trace at the
// playhead so the number moves with the sound during playback.
function drawLiveCents(ctx, canvas, pts, playhead, x, y, cssW, cssH) {
  const p = sampleAt(pts, playhead);
  if (!p || p.mf === null || Math.abs(p.time - playhead) > 0.08) return;
  const nearest = Math.round(p.mf);
  const cents = (p.mf - nearest) * 100;
  const label = `${midiToName(nearest)} ${cents >= 0 ? '+' : ''}${cents.toFixed(0)}¢`;

  ctx.font = `600 ${LIVE_FONT_PX}px -apple-system, "Segoe UI", Roboto, sans-serif`;
  const padX = 6;
  const w = ctx.measureText(label).width + padX * 2;
  const hBox = LIVE_FONT_PX + 8;
  // Sits to the right of the line, flipping left near the edge. On a long take
  // the canvas is far wider than the window onto it, so "the edge" is where the
  // scroller currently ends — measuring against the canvas would let the label
  // sail off the visible area during playback.
  const scroller = canvas.parentElement;
  const scrolls = scroller && scroller.scrollWidth > scroller.clientWidth + 1;
  const viewLeft = scrolls ? scroller.scrollLeft : 0;
  const viewRight = scrolls ? scroller.scrollLeft + scroller.clientWidth : cssW;
  const flip = x(playhead) + 12 + w > viewRight - PAD.right;
  const bx = flip
    ? Math.max(viewLeft + 4, x(playhead) - 12 - w)
    : x(playhead) + 12;
  const by = Math.max(PAD.top + 2, Math.min(y(p.mf) - hBox / 2, cssH - PAD.bottom - hBox - 2));

  const c = C();
  ctx.fillStyle = STATUS_SPAN()[intonationStatus(cents)];
  ctx.beginPath();
  ctx.roundRect(bx, by, w, hBox, 999);
  ctx.fill();
  ctx.strokeStyle = STATUS_LINE()[intonationStatus(cents)];
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.fillStyle = c.ink;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, bx + padX, by + hBox / 2);
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
//
// The chart is VIRTUALISED: the canvas is only as wide as the window onto it,
// and a spacer beside it provides the scroll extent. Time maps to a position in
// that scroll extent, and each paint draws the slice currently on screen.
//
// It used to be one canvas as wide as the whole take. That is fine for the
// ten-second scales this was built against and falls apart at the length people
// actually practise: a ten-minute take at 120 px/s wants 72,000 px, which
// blew past the 24,000 px cap (silently compressing the time axis threefold),
// exceeded the maximum canvas area Safari will allocate at all, and cost ~100 MB
// of texture. Worse, every playhead move repainted the entire thing — measured
// at 10 fps on a desktop, and playback redraws once per frame.
//
// Drawing a screenful instead makes the cost independent of take length, so the
// density is whatever the player pinches it to and nothing is capped.
const PX_PER_SEC = 120;

// Consecutive trace points sharing an intonation verdict are stroked as ONE
// path rather than one path per point. A ten-minute take is ~52,000 points;
// as individual strokes that alone missed frame budget by an order of magnitude.
function drawTrace(ctx, pts, from, to, x, y) {
  ctx.lineWidth = LINE_WIDTH;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  let i = from;
  while (i < to) {
    if (pts[i].mf === null) { i++; continue; }
    // a run ends at a gap, or where the verdict changes
    const status = pts[i].status;
    let j = i + 1;
    while (j < to && pts[j].mf !== null && pts[j].status === status) j++;
    if (j - i > 1) {
      ctx.strokeStyle = status ? STATUS_LINE()[status] : C().muted;
      ctx.beginPath();
      ctx.moveTo(x(pts[i].time), y(pts[i].mf));
      for (let k = i + 1; k < j; k++) ctx.lineTo(x(pts[k].time), y(pts[k].mf));
      ctx.stroke();
      // bridge to the next run so a verdict change isn't a visible break
      if (j < to && pts[j].mf !== null) {
        ctx.strokeStyle = C().muted;
        ctx.beginPath();
        ctx.moveTo(x(pts[j - 1].time), y(pts[j - 1].mf));
        ctx.lineTo(x(pts[j].time), y(pts[j].mf));
        ctx.stroke();
      }
    }
    i = j;
  }
}

// First index with time >= t, by bisection: the paint path runs per frame and
// must not scan the whole take to find where the screen starts.
function lowerBound(pts, t) {
  let lo = 0;
  let hi = pts.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (pts[mid].time < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function renderOverviewChart(canvas, {
  readings, notes, a4, onSeek, onNoteHover, onScale,
  pxPerSec = PX_PER_SEC, mode = 'pitch', wave = null,
}) {
  if (notes.length === 0) return { setPlayhead() {}, setHover() {}, setHighlight() {} };
  const padT = 0.4;
  const starts = notes.map((n) => n.start);
  const ends = notes.map((n) => n.end);
  const t0 = Math.min(...starts) - padT;
  const t1 = Math.max(...ends) + padT;

  const midis = notes.map((n) => n.midi);
  const yMin = Math.min(...midis) - 1;
  const yMax = Math.max(...midis) + 1;
  // every name that could appear in the gutter, so it can be sized to fit
  const rowNames = [];
  for (let m = Math.ceil(yMin); m <= Math.floor(yMax); m++) rowNames.push(midiToName(m));
  syncPad(canvas, rowNames);

  const scroller = canvas.closest('#chart-scroll') ?? canvas.parentElement;
  // The spacer is what actually scrolls; the canvas is pinned over it.
  let spacer = scroller?.querySelector('.chart-span');
  if (scroller && !spacer) {
    spacer = document.createElement('div');
    spacer.className = 'chart-span';
    spacer.setAttribute('aria-hidden', 'true');
    scroller.prepend(spacer);
  }
  const viewW = Math.max(240, scroller?.clientWidth || 900);
  const duration = t1 - t0;
  // Below this the take fits and there is nothing to scroll; above it, the
  // spacer grows and the canvas stays put.
  const plotW = viewW - PAD.left - PAD.right;
  const scale = Math.max(pxPerSec, plotW / Math.max(duration, 0.001));
  const contentW = PAD.left + duration * scale + PAD.right;
  if (spacer) spacer.style.width = `${Math.round(contentW)}px`;
  canvas.style.width = `${viewW}px`;

  const scrollLeft = () => (scroller ? scroller.scrollLeft : 0);
  // content space ↔ time
  const contentX = (t) => PAD.left + (t - t0) * scale;
  const timeAtContentX = (px) => t0 + (px - PAD.left) / scale;

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
  // Notes are drawn per screenful too, so they get the same bisection.
  const noteStarts = notes.map((n) => ({ time: n.start, n }));

  const controller = makeController(canvas, (cv, dpr, cssW, cssH, hoverPt, playhead, highlight) => {
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    const h = cssH - PAD.top - PAD.bottom;
    const left = scrollLeft();
    const x = (t) => contentX(t) - left;
    const y = (mf) => PAD.top + (1 - (mf - yMin) / (yMax - yMin)) * h;
    // the slice on screen, with a little margin so partial marks aren't clipped
    const tVis0 = timeAtContentX(left + PAD.left) - 0.2;
    const tVis1 = timeAtContentX(left + cssW - PAD.right) + 0.2;

    // Everything left of the gutter is the axis, so the plot is clipped to the
    // right of it — otherwise a scrolled trace would run under the note names.
    ctx.save();
    ctx.beginPath();
    ctx.rect(PAD.left, 0, cssW - PAD.left - PAD.right, cssH);
    ctx.clip();

    // note spans, tinted by intonation; the selected/hovered note lights up
    for (const n of notes) {
      if (n.end < tVis0 || n.start > tVis1) continue;
      const spanW = Math.max(2, x(n.end) - x(n.start));
      ctx.fillStyle = STATUS_SPAN()[intonationStatus(n.cents)];
      ctx.fillRect(x(n.start), PAD.top, spanW, h);
      if (highlight.has(n)) {
        ctx.strokeStyle = C().ink;
        ctx.lineWidth = 1;
        ctx.strokeRect(x(n.start), PAD.top, spanW, h);
      }
    }

    if (mode === 'wave' && wave) {
      // amplitude envelope: symmetric peak bars around the vertical middle,
      // wearing each note's intonation verdict like the pitch trace does
      const mid = PAD.top + h / 2;
      for (let px = PAD.left; px < cssW - PAD.right; px++) {
        const ta = timeAtContentX(left + px);
        const tb = timeAtContentX(left + px + 1);
        let amp = 0;
        const b0 = Math.max(0, Math.floor(ta * wave.perSec));
        const b1 = Math.min(wave.peaks.length - 1, Math.ceil(tb * wave.perSec));
        for (let b = b0; b <= b1; b++) if (wave.peaks[b] > amp) amp = wave.peaks[b];
        if (amp <= 0) continue;
        const note = findNoteAt(notes, (ta + tb) / 2, 0);
        ctx.fillStyle = note ? STATUS_LINE()[intonationStatus(note.cents)] : C().muted;
        const barH = Math.max(0.6, amp * 0.92 * (h / 2 - 2));
        ctx.fillRect(px, mid - barH, 1, barH * 2);
      }
    } else {
      // semitone gridlines
      for (let m = Math.ceil(yMin); m <= Math.floor(yMax); m++) {
        ctx.strokeStyle = C().grid;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(PAD.left, y(m));
        ctx.lineTo(cssW - PAD.right, y(m));
        ctx.stroke();
      }
      const from = Math.max(0, lowerBound(pts, tVis0) - 1);
      const to = Math.min(pts.length, lowerBound(pts, tVis1) + 1);
      drawTrace(ctx, pts, from, to, x, y);
    }

    if (playhead !== null && playhead >= t0 && playhead <= t1) {
      const px = x(playhead);
      if (px >= PAD.left - 20 && px <= cssW - PAD.right + 20) {
        drawPlayhead(ctx, px, PAD.top, h);
        // the grab handle — drag it along the take to steer the zoom below
        ctx.fillStyle = C().primary;
        ctx.beginPath();
        ctx.arc(px, PAD.top + 7, 8, 0, 2 * Math.PI);
        ctx.fill();
        ctx.fillStyle = C().onPrimary;
        ctx.beginPath();
        ctx.arc(px, PAD.top + 7, 3, 0, 2 * Math.PI);
        ctx.fill();
      }
    }

    if (hoverPt) {
      ctx.fillStyle = C().ink;
      ctx.beginPath();
      ctx.arc(x(hoverPt.time), y(hoverPt.mf), 4, 0, 2 * Math.PI);
      ctx.fill();
      const nearest = Math.round(hoverPt.mf);
      const cents = (hoverPt.mf - nearest) * 100;
      ctx.font = FONT;
      ctx.textBaseline = 'middle';
      ctx.textAlign = x(hoverPt.time) > cssW / 2 ? 'right' : 'left';
      const dx = x(hoverPt.time) > cssW / 2 ? -8 : 8;
      ctx.fillText(`${midiToName(nearest)} ${cents >= 0 ? '+' : ''}${cents.toFixed(0)}¢`,
        x(hoverPt.time) + dx, Math.max(PAD.top + 8, y(hoverPt.mf) - 10));
    }
    ctx.restore();

    // The axis sits outside the clip so it stays legible at any scroll offset —
    // it is the one part of the chart that must not move.
    if (mode !== 'wave' || !wave) {
      ctx.font = FONT;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'right';
      const rowH = h / (yMax - yMin);
      for (let m = Math.ceil(yMin); m <= Math.floor(yMax); m++) {
        const pc = ((m % 12) + 12) % 12;
        const natural = ![1, 3, 6, 8, 10].includes(pc);
        const labeled = rowH >= 13 || (rowH >= 6.5 && natural) || pc === 0 || pc === 2 || pc === 7;
        if (!labeled) continue;
        ctx.fillStyle = C().muted;
        ctx.fillText(midiToName(m), PAD.left - LABEL_GAP, y(m));
      }
    }
    // ...and how far off the pitch is right there, moving with the sound
    if (playhead !== null && !hoverPt) {
      drawLiveCents(ctx, cv, pts, playhead, x, y, cssW, cssH);
    }
  });

  const timeAt = (e) => {
    const xCss = canvasX(e, canvas, controller.cssW);
    return Math.max(t0, Math.min(t1, timeAtContentX(xCss + scrollLeft())));
  };

  // Repaint as the take scrolls under the pinned canvas, at most once a frame.
  let scrollPending = false;
  const onScroll = () => {
    if (scrollPending) return;
    scrollPending = true;
    requestAnimationFrame(() => { scrollPending = false; controller.repaint(); });
  };
  scroller?.removeEventListener('scroll', scroller._chartScroll ?? (() => {}));
  if (scroller) {
    scroller._chartScroll = onScroll;
    scroller.addEventListener('scroll', onScroll, { passive: true });
  }

  // Keep the sweeping playhead in view during playback.
  const basePlayhead = controller.setPlayhead;
  controller.setPlayhead = (t) => {
    if (t !== null && scroller) {
      const px = contentX(t);
      const view = scroller.clientWidth;
      if (px < scroller.scrollLeft + PAD.left + 20 || px > scroller.scrollLeft + view - 60) {
        scroller.scrollLeft = Math.max(0, px - view / 3);
      }
    }
    basePlayhead(t);
  };

  // The drag handle is a real DOM element floating over the drawn knob:
  // it declares touch-action none, so grabbing it always drags the cursor,
  // while touch anywhere else still pans the scrollable chart natively. It
  // lives in the scroll content, so its position is in content space.
  let knob = scroller?.querySelector('.chart-knob');
  if (scroller && !knob) {
    knob = document.createElement('div');
    knob.className = 'chart-knob';
    scroller.append(knob);
  }
  // The handle spans the cursor's whole height rather than sitting as a dot at
  // the top of it. What is drawn is a line down the chart, so that line is what
  // people reach for — and on a phone the old 44px circle meant hunting for a
  // target the size of the dot while the thing you wanted to grab ran the full
  // height of the graph.
  const placeKnob = (t) => {
    if (!knob) return;
    if (t === null || t < t0 || t > t1) { knob.style.display = 'none'; return; }
    knob.style.display = 'block';
    knob.style.left = `${contentX(t)}px`;
    knob.style.top = `${PAD.top}px`;
    knob.style.height = `${Math.max(44, (canvas.clientHeight || 0) - PAD.top - PAD.bottom)}px`;
  };
  const withKnob = controller.setPlayhead;
  controller.setPlayhead = (t) => { withKnob(t); placeKnob(t); };

  const hoverAt = (e) => {
    const time = timeAt(e);
    const note = findNoteAt(notes, time);
    canvas.style.cursor = note ? 'pointer' : 'default';
    onNoteHover?.(note);
    controller.setHighlight(note);
    const i = lowerBound(pts, time);
    controller.setHover(nearestPoint(pts.slice(Math.max(0, i - 12), i + 12), time, 'mf'));
  };

  let dragging = false;
  if (knob) {
    knob.onpointerdown = (e) => {
      if (!onSeek) return;
      dragging = true;
      knob.setPointerCapture(e.pointerId);
      e.preventDefault();
      onSeek(timeAt(e), 'start');
    };
    // Not dragging means this is a mouse passing over, and the strip is now
    // tall enough to shadow a whole column of the chart — so it has to do the
    // hovering the canvas underneath it can no longer be told about.
    knob.onpointermove = (e) => (dragging ? onSeek(timeAt(e), 'move') : hoverAt(e));
    knob.onpointerup = (e) => {
      if (!dragging) return;
      dragging = false;
      onSeek(timeAt(e), 'end');
    };
    knob.onpointercancel = knob.onpointerup;
    // Same reason: a tap that lands on the strip is a tap on the chart, and
    // without this the cursor's own column would be the one place tapping did
    // nothing at all.
    knob.onclick = (e) => onSeek?.(timeAt(e), 'tap');
  }

  canvas.onmousemove = hoverAt;
  canvas.onclick = (e) => onSeek?.(timeAt(e), 'tap');
  canvas.onmouseleave = () => {
    onNoteHover?.(null);
    controller.setHighlight(null);
    controller.setHover(null);
  };

  attachPinch(canvas, {
    value: pxPerSec, min: 30, max: 500, onScale,
  });

  controller.range = { t0, t1 };
  controller.xOfTime = contentX;
  controller.timeAtX = timeAtContentX;
  controller.notes = noteStarts;
  return controller;
}

// --- zoom inset: one note in cents detail ----------------------------------

export function renderNoteChart(canvas, { readings, note, a4, contextSec = 1.2, onSeek, onScale }) {
  const CLAMP = 150;
  syncPad(canvas, [-100, 0, 100].map((dev) => midiToName(note.midi + dev / 100)));
  const t0 = note.start - contextSec;
  const t1 = note.end + contextSec;
  // Bisect in rather than filtering the whole take. This runs again every time
  // the cursor crosses into another note, and dragging the overview across a
  // fast passage crosses several a second — scanning fifty thousand readings
  // each time is most of what made that drag expensive.
  const pts = [];
  for (let i = lowerBound(readings, t0); i < readings.length; i++) {
    const r = readings[i];
    if (r.time > t1) break;
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

    ctx.fillStyle = C().wave;
    ctx.fillRect(x(note.start), PAD.top, x(note.end) - x(note.start), h);

    ctx.font = FONT;
    ctx.textBaseline = 'middle';
    for (const dev of [-100, 0, 100]) {
      ctx.strokeStyle = dev === 0 ? C().good : C().grid;
      ctx.setLineDash(dev === 0 ? [4, 4] : []);
      ctx.beginPath();
      ctx.moveTo(PAD.left, y(dev));
      ctx.lineTo(cssW - PAD.right, y(dev));
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = C().muted;
      ctx.textAlign = 'right';
      ctx.fillText(midiToName(note.midi + dev / 100), PAD.left - LABEL_GAP, y(dev));
    }

    ctx.lineWidth = LINE_WIDTH;
    ctx.lineJoin = 'round';
    let prev = null;
    for (const p of pts) {
      if (p.dev === null) { prev = null; continue; }
      if (prev) {
        // inside the note, each moment wears its own in-tune color
        ctx.strokeStyle = p.inTarget && prev.inTarget
          ? STATUS_LINE()[intonationStatus(p.dev)]
          : C().muted;
        ctx.beginPath();
        ctx.moveTo(x(prev.time), y(prev.dev));
        ctx.lineTo(x(p.time), y(p.dev));
        ctx.stroke();
      }
      prev = p;
    }

    if (playhead !== null && playhead >= t0 && playhead <= t1) {
      drawPlayhead(ctx, x(playhead), PAD.top, h);
      // the grab handle — dragging starts only on this knob
      ctx.fillStyle = C().primary;
      ctx.beginPath();
      ctx.arc(x(playhead), PAD.top + 7, 8, 0, 2 * Math.PI);
      ctx.fill();
      ctx.fillStyle = C().onPrimary;
      ctx.beginPath();
      ctx.arc(x(playhead), PAD.top + 7, 3, 0, 2 * Math.PI);
      ctx.fill();
    }

    if (hoverPt) {
      ctx.fillStyle = C().ink;
      ctx.beginPath();
      ctx.arc(x(hoverPt.time), y(hoverPt.dev), 4, 0, 2 * Math.PI);
      ctx.fill();
      ctx.textAlign = x(hoverPt.time) > cssW / 2 ? 'right' : 'left';
      const dx = x(hoverPt.time) > cssW / 2 ? -8 : 8;
      ctx.fillText(`${hoverPt.dev >= 0 ? '+' : ''}${hoverPt.dev.toFixed(0)}¢`,
        x(hoverPt.time) + dx, Math.max(PAD.top + 8, y(hoverPt.dev) - 10));
    }
  });

  // track where the dot currently is, for grab hit-testing
  let dotTime = null;
  const baseSetPlayhead = controller.setPlayhead;
  controller.setPlayhead = (t) => { dotTime = t; baseSetPlayhead(t); };

  const xOf = (t) => {
    const w = controller.cssW - PAD.left - PAD.right;
    return PAD.left + ((t - t0) / (t1 - t0)) * w;
  };
  const timeFromEvent = (e) => {
    const xCss = canvasX(e, canvas, controller.cssW);
    const w = controller.cssW - PAD.left - PAD.right;
    const t = t0 + ((xCss - PAD.left) / w) * (t1 - t0);
    return Math.max(t0, Math.min(t1, t));
  };
  const nearDot = (e) =>
    dotTime !== null && Math.abs(canvasX(e, canvas, controller.cssW) - xOf(dotTime)) < 26;

  // The playhead moves only while the finger is on the dot itself —
  // tapping elsewhere never jumps it.
  let dragging = false;
  canvas.onpointerdown = (e) => {
    if (!onSeek || !nearDot(e)) return;
    dragging = true;
    canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
    onSeek(timeFromEvent(e), 'start');
  };
  canvas.onpointermove = (e) => {
    if (dragging) {
      onSeek(timeFromEvent(e), 'move');
    } else {
      canvas.style.cursor = onSeek && nearDot(e) ? 'grab' : 'default';
      controller.setHover(nearestPoint(pts, timeFromEvent(e), 'dev'));
    }
  };
  canvas.onpointerup = (e) => {
    if (!dragging) return;
    dragging = false;
    onSeek(timeFromEvent(e), 'end');
  };
  canvas.onmouseleave = () => { if (!dragging) controller.setHover(null); };

  // pinch out = tighter context window = more detail on this note
  attachPinch(canvas, {
    value: contextSec, min: 0.25, max: 4, invert: true, onScale,
  });
  return controller;
}
