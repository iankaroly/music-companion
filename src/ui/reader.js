// The score, full screen, as a thing to play from.
//
// Everything else in this app looks at music you have already played. This
// looks at music you are about to play: the part on the stand, filling the
// screen, turning a page at a tap on the right-hand edge and taking pencil
// marks the way paper does. It is the reason to keep the phone in front of you
// between takes rather than putting it away.
//
// Three decisions hold it up:
//
// The pages are ENGRAVED to the shape of the screen, not fitted to it after the
// fact. A sheet of A4 shown on a phone is a postage stamp with a wide white
// border; asking the engraver for a page the size and shape of the screen
// instead gives full-height staves in portrait and long, few-to-a-page systems
// in landscape. Turning the phone re-engraves, which is why landscape looks
// like landscape rather than like portrait with the sides cut off.
//
// The ink is anchored to BARS. A pencil mark is about a bar — this shift, that
// accidental — so a stroke is stored as offsets from the corner of the bar it
// was drawn over, in the engraver's units. Re-flow the music and the marks move
// with their bars. Storing screen coordinates would mean every annotation you
// have ever made slides into the wrong place the first time you rotate.
//
// A tap does something different depending on where it lands, and NOTHING is
// dragged. Left third back, right third forward, middle shows or hides the
// chrome. Pinching, panning and rubber-banding a page of music while trying to
// read it is the failure mode this whole screen exists to avoid.

import { showScore, indexNoteheads } from './score-view.js';
import { followPlayback } from './report.js';
import { loadAnnotations, saveAnnotations } from '../store/db.js';

// How big the music is drawn, as the height of one staff space in pixels.
//
// That is the number a player actually cares about — it is the size of a
// notehead and the gap between two lines — and it is the one the engraver
// thinks in too: OpenSheetMusicDisplay lays out at ten pixels to a staff space
// and scales the lot by osmd.zoom, so a staff space of 15px is simply zoom 1.5.
// The page is then asked for in staff spaces as well, which is what makes a
// page exactly fill the screen at any size: as many spaces across as the screen
// has room for.
//
// The starting size is a fact about the SCREEN, not a constant. Ten pixels is
// right on a phone; the same ten on an iPad would be phone-sized music with
// thirteen bars to a line, which is the opposite of what a big screen is for.
// It grows with the screen's short edge — by its square root, because an iPad's
// short edge is two and a half times a phone's and music two and a half times
// the size would be four bars to a page. Bigger, and more of it.
//
// What is remembered is a multiplier on top of that, so a phone and an iPad
// each start out right and the ± moves them from there. This is the app's one
// deliberate zoom, and it re-engraves rather than magnifying: the notes get
// bigger, they do not get blurrier, and the page still fits the screen exactly.
const SIZE_KEY = 'readerZoom';
const PHONE_EDGE = 414;      // the short edge this was drawn against
const PHONE_STAFF_PX = 10;   // what the engraver draws at zoom 1
const ZOOM_MIN = 0.6;
const ZOOM_MAX = 2.4;
const ZOOM_STEP = 1.18;

function baseStaffPx() {
  const short = Math.min(window.innerWidth, window.innerHeight) || PHONE_EDGE;
  return PHONE_STAFF_PX * Math.sqrt(short / PHONE_EDGE);
}

function readingZoom() {
  const stored = Number(globalThis.localStorage?.getItem(SIZE_KEY));
  if (!Number.isFinite(stored) || stored <= 0) return 1;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, stored));
}

function setReadingZoom(next) {
  const zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next));
  try { globalThis.localStorage?.setItem(SIZE_KEY, String(zoom)); } catch { /* survivable */ }
  return zoom;
}

// One staff space, in pixels, at the size being read.
function staffPx() {
  return baseStaffPx() * readingZoom();
}

// The pens. Four presets to reach for without thinking, and behind them a
// brush you can mix: hue, saturation, brightness, transparency and a size.
// Colours are stored on the stroke as a plain CSS colour, so a mark keeps the
// exact ink it was made with rather than a name that might mean something else
// later.
//
// Widths are in STAFF SPACES, never pixels: a pencil line has to look like a
// pencil line whether the music is set small on a phone or large on an iPad.
const PRESETS = [
  { h: 262, s: 12, l: 26, a: 1, label: 'pencil' },
  { h: 352, s: 82, l: 62, a: 1, label: 'red' },
  { h: 252, s: 90, l: 63, a: 1, label: 'blue' },
  { h: 160, s: 78, l: 40, a: 1, label: 'green' },
];

const PEN_WIDTH = 0.28;
const HIGHLIGHT_WIDTH = 1.6;
const MIN_WIDTH = 0.08;
const MAX_WIDTH = 3;

// One brush per tool, because a highlighter is not a pen with the settings
// changed — reaching for it should not mean re-mixing yellow every time.
const brushes = {
  pen: { h: 262, s: 12, l: 26, a: 1, width: PEN_WIDTH, overlay: false },
  highlighter: { h: 52, s: 95, l: 55, a: 0.35, width: HIGHLIGHT_WIDTH, overlay: true },
};

function brushCss(brush) {
  return `hsla(${Math.round(brush.h)} ${Math.round(brush.s)}% ${Math.round(brush.l)}% / ${brush.a.toFixed(2)})`;
}

function currentBrush() {
  return brushes[tool === 'highlighter' ? 'highlighter' : 'pen'];
}

let root = null;      // the whole reader
let sheet = null;     // where the engraving is mounted
let ink = null;       // the canvas the marks are drawn on
let view = null;      // the engraved score
let score = null;     // { id, name, xml, partIndex }
let take = null;      // the analysed take on screen, if there is one
let unfollow = null;  // stop listening to the playhead
let sounding = null;  // the notehead lit right now
let strokes = [];     // every mark on this piece
let pageIndex = 0;
let tool = null;      // null = reading; 'pen' | 'highlighter' | 'eraser'
let drawing = null;   // the stroke being drawn
let chrome = true;    // is the bar showing
let saveTimer = null;
// What was done, so it can be undone: each entry is a whole gesture — one
// stroke drawn, or every stroke one sweep of the eraser took away.
let history = [];
let redoable = [];

const el = (id) => document.querySelector(`#${id}`);

// --- persistence -------------------------------------------------------------

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (score) saveAnnotations(score.id, strokes).catch(() => { /* nothing to say */ });
  }, 400);
}

// --- geometry ----------------------------------------------------------------
//
// Every mark is held against a BAR, in staff-spaces from the top-left corner of
// that bar. Two things make that the right anchor:
//
// The bar is what the mark is ABOUT — "watch the shift here", "breathe" — so
// when the music re-flows into different systems on a different page, the ink
// belongs with its bar and not with the piece of screen the bar used to be on.
//
// And the staff space is the one length in engraving that means the same thing
// at every size: a mark half a staff space above the top line is in the same
// place whether the music is set small or large. Both are measured off the
// RENDERED page rather than off the engraver's model — the model's page
// coordinates and the drawn ones are not the same numbers, because systems get
// spread to fill the page after the layout is computed.

let bars = new Map();   // bar number → { page, node, system } on the page as drawn

// The page currently on screen.
function currentPage() {
  return view?.pages?.[pageIndex] ?? null;
}

// Where each bar ended up on the page. Bars are read from the DOM in order —
// one staff, one voice, so the order the engraver drew them in is the order
// they are numbered in.
function indexBars() {
  const found = new Map();
  if (!view) return found;
  const numbers = [];
  for (const row of view.osmd?.graphic?.MeasureList ?? []) {
    if (row?.[0]) numbers.push(row[0].MeasureNumber);
  }
  let cursor = 0;
  for (const [index, node] of view.pages.entries()) {
    for (const measure of node.querySelectorAll('.vf-measure')) {
      const number = numbers[cursor++];
      if (number === undefined) break;
      found.set(number, { page: index, node: measure, system: measure.closest('.staffline') });
    }
  }
  return found;
}

// The bar's corner and its staff space, in pixels on the page being read.
//
// Measured off the five staff lines themselves. They are the first five paths
// the engraver draws inside a bar, they are exactly four staff spaces apart,
// and they do not move when the music above them does — unlike the bar's outline,
// which grows upwards the moment somebody writes a high note and would take
// every mark in the bar with it.
function barFrame(bar) {
  const entry = bars.get(bar);
  const page = currentPage();
  if (!entry || !page || entry.page !== pageIndex) return null;
  const pageBox = page.getBoundingClientRect();
  const lines = [...entry.node.children]
    .filter((node) => node.tagName === 'path')
    .slice(0, 5)
    .map((node) => node.getBoundingClientRect());
  if (lines.length < 5 || lines[0].width === 0) {
    // No staff to measure (an empty bar, a backend that drew it differently):
    // fall back to the bar's outline, which is roughly right and never null.
    const box = entry.node.getBoundingClientRect();
    return {
      x: box.left - pageBox.left,
      y: box.top - pageBox.top,
      width: box.width,
      height: box.height,
      unit: Math.max(1, box.height / 8),
    };
  }
  const unit = Math.max(1, (lines[4].top - lines[0].top) / 4);
  return {
    x: lines[0].left - pageBox.left,
    y: lines[0].top - pageBox.top,
    width: lines[0].width,
    height: unit * 4,
    unit,
  };
}

function unitScale() {
  // A representative staff space, for line widths and eraser reach.
  for (const [bar, entry] of bars) {
    if (entry.page !== pageIndex) continue;
    const frame = barFrame(bar);
    if (frame) return frame.unit;
  }
  return 10;
}

// A point on screen → the bar it is over, plus how far into that bar it sits.
// Points that land between bars — in the margin, above the first system — take
// the nearest bar on the page, so a bracket drawn round a system still has
// something to hold on to.
function anchor(px, py) {
  let best = null;
  let bestDistance = Infinity;
  for (const [number, entry] of bars) {
    if (entry.page !== pageIndex) continue;
    const frame = barFrame(number);
    if (!frame) continue;
    const dx = px < frame.x ? frame.x - px : px > frame.x + frame.width ? px - (frame.x + frame.width) : 0;
    const dy = py < frame.y ? frame.y - py : py > frame.y + frame.height ? py - (frame.y + frame.height) : 0;
    const distance = Math.hypot(dx, dy);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = { number, frame };
    }
    if (distance === 0) break;
  }
  if (!best) return null;
  return {
    m: best.number,
    u: (px - best.frame.x) / best.frame.unit,
    v: (py - best.frame.y) / best.frame.unit,
  };
}

// …and back again, for drawing. Null when the bar this point belongs to is not
// on the page being looked at.
function place(point) {
  const frame = barFrame(point.m);
  if (!frame) return null;
  return { x: frame.x + point.u * frame.unit, y: frame.y + point.v * frame.unit };
}

// --- drawing -----------------------------------------------------------------

// The ink a stroke was made with. Anything that looks like a colour is used as
// it is; the old named pens still resolve, so marks made before the brush
// existed keep the colour they were drawn in.
const NAMED = { pencil: 0, red: 1, blue: 2, green: 3 };
function strokeColour(stroke) {
  const value = stroke.colour;
  if (typeof value === 'string' && /^(#|rgb|hsl)/.test(value)) return value;
  const preset = PRESETS[NAMED[value] ?? 0];
  // Marks made before the brush existed: the highlighter's wash was a fixed
  // transparency applied at drawing time rather than part of the colour, so it
  // is put back here. Without this every old highlight comes back opaque.
  return brushCss({ ...preset, a: stroke.tool === 'highlighter' ? 0.32 : preset.a });
}

function drawStroke(ctx, stroke) {
  const points = stroke.points.map(place);
  const scale = unitScale();
  ctx.save();
  ctx.beginPath();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = strokeColour(stroke);
  // A highlighter goes UNDER the notes rather than over them: multiply keeps
  // the black of the engraving showing through a wash of colour, which is what
  // a real one does to paper.
  if (stroke.overlay ?? stroke.tool === 'highlighter') ctx.globalCompositeOperation = 'multiply';
  ctx.lineWidth = Math.max(1, stroke.width * scale);
  let moved = false;
  for (const point of points) {
    if (!point) { moved = false; continue; } // a bar on another page: lift the pen
    if (!moved) { ctx.moveTo(point.x, point.y); moved = true; } else ctx.lineTo(point.x, point.y);
  }
  ctx.stroke();
  ctx.restore();
}

function redraw() {
  const page = currentPage();
  if (!ink || !page) return;
  const box = page.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  if (ink.width !== Math.round(box.width * dpr) || ink.height !== Math.round(box.height * dpr)) {
    ink.width = Math.round(box.width * dpr);
    ink.height = Math.round(box.height * dpr);
  }
  ink.style.width = `${box.width}px`;
  ink.style.height = `${box.height}px`;
  ink.style.left = `${box.left}px`;
  ink.style.top = `${box.top}px`;
  const ctx = ink.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, box.width, box.height);
  for (const stroke of strokes) drawStroke(ctx, stroke);
  if (drawing) drawStroke(ctx, drawing);
}

// Rubbing out: a stroke goes if the eraser passes within a finger's width of it.
function eraseAt(px, py) {
  const scale = unitScale();
  const reach = 3.2 * scale;
  const gone = [];
  strokes = strokes.filter((stroke) => {
    const hit = stroke.points.some((point) => {
      const at = place(point);
      return at && Math.hypot(at.x - px, at.y - py) <= reach;
    });
    if (hit) gone.push(stroke);
    return !hit;
  });
  if (gone.length) {
    // One sweep of the eraser is one undo, however many marks it caught: the
    // gesture is what a hand remembers doing.
    const last = history.at(-1);
    if (erasing && last?.type === 'erase') last.strokes.push(...gone);
    else remember({ type: 'erase', strokes: gone });
    redraw();
    scheduleSave();
  }
}

function remember(op) {
  history.push(op);
  redoable = [];       // a new mark ends the branch you could have gone back to
  refreshHistoryButtons();
}

function pointerPosition(e) {
  const box = currentPage()?.getBoundingClientRect();
  if (!box) return null;
  return { x: e.clientX - box.left, y: e.clientY - box.top };
}

let erasing = false;

function beginStroke(e) {
  const at = pointerPosition(e);
  if (!at) return;
  if (tool === 'eraser') { erasing = false; eraseAt(at.x, at.y); erasing = true; return; }
  const point = anchor(at.x, at.y);
  if (!point) return;
  const brush = currentBrush();
  drawing = {
    tool,
    colour: brushCss(brush),
    width: brush.width,
    overlay: brush.overlay,
    points: [point],
  };
}

function extendStroke(e) {
  const at = pointerPosition(e);
  if (!at) return;
  if (tool === 'eraser') { eraseAt(at.x, at.y); return; }
  if (!drawing) return;
  const point = anchor(at.x, at.y);
  if (point) drawing.points.push(point);
  redraw();
}

function endStroke() {
  if (drawing && drawing.points.length > 1) {
    strokes.push(drawing);
    remember({ type: 'add', stroke: drawing });
    scheduleSave();
  }
  drawing = null;
  erasing = false;
  redraw();
}

// --- pages -------------------------------------------------------------------

function showPage(index) {
  if (!view?.pages?.length) return;
  pageIndex = Math.max(0, Math.min(view.pages.length - 1, index));
  for (const [i, node] of view.pages.entries()) node.hidden = i !== pageIndex;
  const count = el('reader-count');
  if (count) count.textContent = `p. ${pageIndex + 1} of ${view.pages.length}`;
  redraw();
}

const nextPage = () => showPage(pageIndex + 1);
const previousPage = () => showPage(pageIndex - 1);

// --- chrome ------------------------------------------------------------------
//
// Two bars and a sheet, and only one of them is ever up.
//
// Reading: a bar across the top with the piece, the page, and the way into
// everything else. It hides itself when you tap the middle of the page, because
// the point of the screen is the music.
//
// Annotating: that bar is replaced by the tools, which is how every drawing app
// on a tablet behaves and, more to the point, keeps the page turns and the pen
// from sharing a tap.

let menuOpen = false;

function setChrome(on) {
  chrome = on;
  root?.classList.toggle('bare', !on);
}

function setTool(next) {
  tool = tool === next ? null : next;
  root?.classList.toggle('drawing', tool !== null);
  for (const button of root.querySelectorAll('[data-tool]')) {
    const on = button.dataset.tool === tool;
    button.classList.toggle('on', on);
    button.setAttribute('aria-pressed', String(on));
  }
  if (tool) {
    setChrome(true);
    closeMenu();
  }
  closeBrush();
  refreshBrushUI();
}

function refreshHistoryButtons() {
  const undoBtn = el('reader-undo');
  const redoBtn = el('reader-redo');
  if (undoBtn) undoBtn.disabled = history.length === 0;
  if (redoBtn) redoBtn.disabled = redoable.length === 0;
}

function undo() {
  const op = history.pop();
  if (!op) return;
  if (op.type === 'add') strokes = strokes.filter((stroke) => stroke !== op.stroke);
  else strokes.push(...op.strokes);
  redoable.push(op);
  refreshHistoryButtons();
  redraw();
  scheduleSave();
}

function redo() {
  const op = redoable.pop();
  if (!op) return;
  if (op.type === 'add') strokes.push(op.stroke);
  else strokes = strokes.filter((stroke) => !op.strokes.includes(stroke));
  history.push(op);
  refreshHistoryButtons();
  redraw();
  scheduleSave();
}

function clearPage() {
  const gone = strokes.filter((stroke) => {
    const entry = bars.get(stroke.points[0]?.m);
    return entry && entry.page === pageIndex;
  });
  if (!gone.length) return;
  strokes = strokes.filter((stroke) => !gone.includes(stroke));
  remember({ type: 'erase', strokes: gone });
  redraw();
  scheduleSave();
}

// --- the brush ---------------------------------------------------------------

function closeBrush() {
  el('reader-brush')?.classList.remove('open');
}

function toggleBrush() {
  const panel = el('reader-brush');
  if (!panel) return;
  if (!tool || tool === 'eraser') setTool('pen');
  panel.classList.toggle('open');
  hangBelowBar(panel);
  refreshBrushUI();
}

// Under whichever bar is up, measured rather than guessed: on a phone the tool
// bar wraps onto two rows, and a panel positioned from a constant would open
// straight through it.
function hangBelowBar(panel) {
  const bar = tool ? el('reader-ink-bar') : el('reader-top');
  const bottom = bar?.getBoundingClientRect().bottom ?? 0;
  panel.style.top = `${Math.round(bottom + 8)}px`;
}

function refreshBrushUI() {
  const brush = currentBrush();
  const panel = el('reader-brush');
  for (const button of root.querySelectorAll('[data-preset]')) {
    const preset = PRESETS[Number(button.dataset.preset)];
    button.classList.toggle('on', Math.round(preset.h) === Math.round(brush.h)
      && Math.round(preset.s) === Math.round(brush.s)
      && Math.round(preset.l) === Math.round(brush.l));
  }
  const nib = el('reader-nib');
  if (nib) {
    nib.style.setProperty('--nib', brushCss(brush));
    nib.style.setProperty('--nib-size', `${Math.min(1.4, 0.25 + brush.width * 0.45)}rem`);
  }
  if (!panel) return;
  for (const input of panel.querySelectorAll('input[type="range"]')) {
    const key = input.dataset.brush;
    input.value = String(brush[key]);
    input._paintFill?.();
  }
  const overlay = panel.querySelector('#reader-overlay');
  if (overlay) {
    overlay.classList.toggle('on', brush.overlay);
    overlay.setAttribute('aria-pressed', String(brush.overlay));
  }
  const preview = panel.querySelector('#reader-brush-preview');
  if (preview) {
    preview.style.setProperty('--ink', brushCss(brush));
    preview.style.setProperty('--thick', `${Math.max(1, brush.width * staffPx())}px`);
  }
}

function setBrush(key, value) {
  const brush = currentBrush();
  brush[key] = value;
  refreshBrushUI();
}

function usePreset(index) {
  const preset = PRESETS[index];
  const brush = currentBrush();
  brush.h = preset.h;
  brush.s = preset.s;
  brush.l = preset.l;
  if (tool !== 'highlighter') brush.a = preset.a;
  if (!tool || tool === 'eraser') setTool('pen');
  refreshBrushUI();
}

// --- the menu ----------------------------------------------------------------

function closeMenu() {
  menuOpen = false;
  el('reader-menu')?.classList.remove('open');
}

function toggleMenu() {
  const sheet = el('reader-menu');
  if (!sheet) return;
  menuOpen = !menuOpen;
  sheet.classList.toggle('open', menuOpen);
  if (menuOpen) {
    setChrome(true);
    buildMenu(sheet);
    hangBelowBar(sheet);
  }
}

function menuRow(sheet, { label, detail = '', glyph = '', danger = false, onPick }) {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = danger ? 'reader-menu-row danger' : 'reader-menu-row';
  const icon = document.createElement('span');
  icon.className = 'reader-menu-glyph';
  icon.textContent = glyph;
  const text = document.createElement('span');
  text.className = 'reader-menu-text';
  const name = document.createElement('b');
  name.textContent = label;
  text.append(name);
  if (detail) {
    const sub = document.createElement('small');
    sub.textContent = detail;
    text.append(sub);
  }
  row.append(icon, text);
  row.addEventListener('click', () => { closeMenu(); onPick(); });
  sheet.append(row);
}

function menuGroup(sheet, title) {
  const head = document.createElement('div');
  head.className = 'reader-menu-head';
  head.textContent = title;
  sheet.append(head);
}

// Built fresh each time it opens, because most of what it offers depends on
// what is on screen — whether a take is loaded, how big the music is set.
function buildMenu(sheet) {
  sheet.replaceChildren();
  menuGroup(sheet, 'this score');
  menuRow(sheet, {
    label: 'Annotate', glyph: '✎', detail: 'write on the page',
    onPick: () => setTool('pen'),
  });
  menuRow(sheet, {
    label: 'Clear this page', glyph: '⌧', detail: 'the marks on it, not the music',
    onPick: clearPage,
  });
  if (take?.aligned) {
    menuGroup(sheet, 'this take');
    menuRow(sheet, {
      label: painted ? 'Hide what you played' : 'Show what you played',
      glyph: '◉',
      detail: painted ? 'back to a clean page' : 'colour the notes by how they landed',
      onPick: () => togglePainted(),
    });
    menuRow(sheet, {
      label: playing() ? 'Pause' : 'Play the take', glyph: playing() ? '❚❚' : '▶',
      detail: 'the note being heard lights up',
      onPick: togglePlayback,
    });
  }
  menuGroup(sheet, 'reading');
  menuRow(sheet, {
    label: 'Bigger', glyph: '+', detail: 'larger notes, more pages',
    onPick: () => resize(ZOOM_STEP),
  });
  menuRow(sheet, {
    label: 'Smaller', glyph: '−', detail: 'more music to a page',
    onPick: () => resize(1 / ZOOM_STEP),
  });
  menuRow(sheet, { label: 'Close the score', glyph: '✕', onPick: close });
}

// --- painting the take over the page -----------------------------------------

let painted = false;

async function togglePainted() {
  if (!take?.aligned || !view) return;
  painted = !painted;
  if (painted) {
    const { paint } = await import('./score-view.js');
    paint(view, { aligned: take.aligned, timing: take.timing, landings: take.landings });
  } else {
    await engrave();     // the only way back to un-coloured noteheads
    showPage(pageIndex);
  }
}

// --- building it -------------------------------------------------------------

function iconButton(id, glyph, label, onClick, { className = 'reader-tool' } = {}) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  if (id) button.id = id;
  button.textContent = glyph;
  button.setAttribute('aria-label', label);
  button.title = label;
  button.addEventListener('click', onClick);
  return button;
}

function toolButton(name, glyph, label) {
  const button = iconButton(null, glyph, label, () => setTool(name));
  button.dataset.tool = name;
  button.setAttribute('aria-pressed', 'false');
  return button;
}

function presetSwatch(index) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'reader-swatch';
  button.dataset.preset = String(index);
  button.style.setProperty('--swatch', brushCss({ ...PRESETS[index], a: 1 }));
  button.setAttribute('aria-label', `Draw in ${PRESETS[index].label}`);
  button.addEventListener('click', () => usePreset(index));
  return button;
}

function brushSlider(key, label, min, max, step) {
  const row = document.createElement('label');
  row.className = 'reader-brush-row';
  const name = document.createElement('span');
  name.textContent = label;
  const input = document.createElement('input');
  input.type = 'range';
  input.dataset.brush = key;
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.addEventListener('input', () => setBrush(key, Number(input.value)));
  row.append(name, input);
  return row;
}

function buildTopBar() {
  const bar = document.createElement('div');
  bar.id = 'reader-top';
  const title = document.createElement('span');
  title.id = 'reader-title';
  const count = document.createElement('span');
  count.id = 'reader-count';
  const play = iconButton('reader-play', '▶', 'Play the take', togglePlayback);
  bar.append(
    iconButton('reader-close', '✕', 'Close the score', close),
    title,
    count,
    play,
    iconButton('reader-annotate', '✎', 'Annotate this page', () => setTool('pen')),
    iconButton('reader-menu-btn', '⋯', 'More', toggleMenu),
  );
  return bar;
}

function buildInkBar() {
  const bar = document.createElement('div');
  bar.id = 'reader-ink-bar';
  const nib = document.createElement('span');
  nib.id = 'reader-nib';
  nib.setAttribute('aria-hidden', 'true');
  const brushBtn = iconButton('reader-brush-btn', '', 'Brush style', toggleBrush);
  brushBtn.append(nib);
  bar.append(
    iconButton('reader-done', '✓', 'Finished annotating', () => setTool(null)),
    toolButton('pen', '✎', 'Pen'),
    toolButton('highlighter', '▬', 'Highlighter'),
    toolButton('eraser', '⌫', 'Rub out'),
    ...PRESETS.map((_, i) => presetSwatch(i)),
    brushBtn,
    iconButton('reader-undo', '↺', 'Undo', undo),
    iconButton('reader-redo', '↻', 'Redo', redo),
    iconButton('reader-clear', '⌧', 'Clear this page', clearPage),
  );
  return bar;
}

function buildBrushPanel() {
  const panel = document.createElement('div');
  panel.id = 'reader-brush';
  const head = document.createElement('div');
  head.className = 'reader-brush-head';
  head.textContent = 'Brush';
  const preview = document.createElement('div');
  preview.id = 'reader-brush-preview';
  preview.setAttribute('aria-hidden', 'true');
  const overlay = iconButton('reader-overlay', 'overlay', 'Draw underneath the notes',
    () => setBrush('overlay', !currentBrush().overlay), { className: 'reader-chip' });
  panel.append(
    head,
    preview,
    brushSlider('width', 'size', MIN_WIDTH, MAX_WIDTH, 0.02),
    brushSlider('h', 'hue', 0, 360, 1),
    brushSlider('s', 'saturation', 0, 100, 1),
    brushSlider('l', 'brightness', 0, 100, 1),
    brushSlider('a', 'transparency', 0.08, 1, 0.02),
    overlay,
  );
  return panel;
}

function build() {
  if (root) return root;
  root = document.createElement('div');
  root.id = 'reader';
  root.hidden = true;

  sheet = document.createElement('div');
  sheet.id = 'reader-sheet';

  ink = document.createElement('canvas');
  ink.id = 'reader-ink';

  const menu = document.createElement('div');
  menu.id = 'reader-menu';

  root.append(sheet, ink, buildTopBar(), buildInkBar(), buildBrushPanel(), menu);
  document.body.append(root);

  // A tap does one of four things, and where it lands decides which. The top
  // strip is tested FIRST: it overlaps the left and right thirds, and a tap up
  // there is a reach for the controls, not for a page turn.
  root.addEventListener('click', (e) => {
    if (e.target.closest('#reader-top, #reader-ink-bar, #reader-menu, #reader-brush')) return;
    if (menuOpen) { closeMenu(); return; }
    if (el('reader-brush')?.classList.contains('open')) { closeBrush(); return; }
    if (tool) return;                        // the pen owns the page while it is out
    if (e.clientY < window.innerHeight * 0.16) { setChrome(true); return; }
    const third = window.innerWidth / 3;
    if (e.clientX < third) previousPage();
    else if (e.clientX > window.innerWidth - third) nextPage();
    else setChrome(!chrome);
  });

  ink.addEventListener('pointerdown', (e) => {
    if (!tool) return;
    ink.setPointerCapture(e.pointerId);
    beginStroke(e);
  });
  ink.addEventListener('pointermove', (e) => {
    if (!tool || (e.buttons === 0 && e.pointerType === 'mouse')) return;
    extendStroke(e);
  });
  for (const type of ['pointerup', 'pointercancel']) ink.addEventListener(type, endStroke);

  document.addEventListener('keydown', (e) => {
    if (root.hidden) return;
    if (e.key === 'Escape') {
      if (menuOpen) closeMenu();
      else if (tool) setTool(null);
      else close();
      return;
    }
    if (e.key === 'ArrowRight' || e.key === 'PageDown') nextPage();
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') previousPage();
  });

  window.addEventListener('resize', () => {
    if (!root.hidden) relayout();
  });

  return root;
}

// Bigger or smaller music. The bar you are looking at is kept, not the page
// number: a re-engraving at another size puts it on a different page, and
// coming back to "page 3 of a different pagination" is coming back to the wrong
// music.
async function resize(factor) {
  if (!score) return;
  const anchorBar = firstBarOnPage();
  setReadingZoom(readingZoom() * factor);
  await engrave();
  showPage(bars.get(anchorBar)?.page ?? 0);
}

// The lowest-numbered bar on the page being read.
function firstBarOnPage() {
  let lowest = null;
  for (const [number, entry] of bars) {
    if (entry.page !== pageIndex) continue;
    if (lowest === null || number < lowest) lowest = number;
  }
  return lowest;
}

// The engraving is thrown away and rebuilt at the new shape. This is the
// expensive path — a second or so on a long piece — and it runs on rotation
// only, which is a thing that happens once a session and not once a page.
let relayoutTimer = null;
function relayout() {
  clearTimeout(relayoutTimer);
  relayoutTimer = setTimeout(async () => {
    if (root.hidden || !score) return;
    const wasOn = pageIndex;
    await engrave();
    showPage(Math.min(wasOn, (view?.pages?.length ?? 1) - 1));
  }, 200);
}

// The page, in staff spaces, and the engraver zoom that turns those back into
// exactly one screenful of pixels.
function pageFormat() {
  const space = staffPx();
  // A floor on the width: past a point the page is narrower than a single bar
  // and the engraver has nowhere to put the music.
  const width = Math.max(24, window.innerWidth / space);
  // A whisker under the screen's own proportions — the engraver rounds a page
  // up to whole staff spaces, and a page a few pixels taller than the screen is
  // a page with the bottom line of the last system cut off.
  const height = (window.innerHeight / space) * 0.985;
  return { width, height, zoom: space / PHONE_STAFF_PX };
}

async function engrave() {
  const page = pageFormat();
  view = await showScore(sheet, {
    // The notes are always handed over, even with no take loaded: they are how
    // a notehead is found again when something needs to be lit, and finding it
    // is not the same as colouring it.
    xml: score.xml,
    scoreNotes: score.notes ?? [],
    partIndex: score.partIndex ?? 0,
    pageFormat: page,
    zoom: page.zoom,
    // The reader re-engraves on rotation itself, at the new page shape; the
    // view's own resize handler would re-render at the old one underneath it.
    autoRelayout: false,
  });
  bars = indexBars();
  // NOT painted. You open a score to play from it, and a page of red and green
  // noteheads is a report on last Tuesday — it belongs in the review, which is
  // where it stays. What the take is for here is the light that follows the
  // playback from note to note.
  if (take?.aligned) {
    indexNoteheads(view, take.aligned);
    followTake();
    // A re-engraving throws the colours away with the old pages; if they were
    // asked for, they are asked for again. Rotating the iPad is not a request
    // to stop showing what you played.
    if (painted) {
      const { paint } = await import('./score-view.js');
      paint(view, { aligned: take.aligned, timing: take.timing, landings: take.landings });
    }
  }
  return view;
}

// --- the light that follows the playback -------------------------------------
//
// The one thing the score can do that a graph cannot: while a take plays, the
// note being heard is lit on the page. Pages turn themselves to keep up, so a
// four-page piece plays through without a finger on the screen.

function clearSounding() {
  sounding?.classList.remove('sounding');
  sounding = null;
}

function followTake() {
  unfollow?.();
  clearSounding();
  unfollow = followPlayback((note) => {
    refreshPlayButton();
    const next = note && view?.noteheadFor ? view.noteheadFor(note) : null;
    if (next === sounding) return;
    clearSounding();
    if (!next) return;
    sounding = next;
    next.classList.add('sounding');
    const page = Number(next.closest('.osmd-page')?.dataset.page ?? -1);
    if (page >= 0 && page !== pageIndex) showPage(page);
  });
}

// --- playing the take from here ---------------------------------------------
//
// There is exactly one playback engine in the app (report.js) and one set of
// transport controls, which live on the review. Rather than build a second
// engine that would fight it for the same audio, the reader presses the same
// button: the take plays, the review's own controls move in step, and the light
// on the page follows.

function transportButton() {
  return document.querySelector('#clip-play');
}

function togglePlayback() {
  const button = transportButton();
  if (!button) return;
  button.click();
  // The engine flips the label; borrow it a moment later so this button agrees.
  setTimeout(refreshPlayButton, 60);
}

function playing() {
  const theirs = transportButton();
  return !!theirs && (theirs.textContent ?? '').trim() !== '▶';
}

function refreshPlayButton() {
  const mine = el('reader-play');
  if (!mine) return;
  const theirs = transportButton();
  const playable = !!take && !!theirs && !document.querySelector('#playback')?.hidden;
  mine.hidden = !playable;
  if (!playable) return;
  const on = playing();
  mine.textContent = on ? '❚❚' : '▶';
  mine.setAttribute('aria-label', on ? 'Pause the take' : 'Play the take');
}

// --- the door ----------------------------------------------------------------

// row: the score, with its parsed notes. take: the analysed take on screen, if
// there is one — used to light the notes as they play, not to colour the page.
export async function openReader(row, { take: analysed = null } = {}) {
  if (!row?.xml) return null;
  build();
  score = row;
  take = analysed;
  strokes = await loadAnnotations(row.id).catch(() => []);
  history = [];
  redoable = [];
  painted = false;
  menuOpen = false;
  pageIndex = 0;
  tool = null;
  root.classList.remove('drawing');
  setChrome(true);
  root.hidden = false;
  document.documentElement.dataset.reading = 'yes';
  el('reader-title').textContent = row.name ?? '';
  try {
    await engrave();
  } catch (err) {
    close();
    throw err;
  }
  setTool(null);
  refreshBrushUI();
  refreshHistoryButtons();
  showPage(0);
  refreshPlayButton();
  return view;
}

export function close() {
  if (!root || root.hidden) return;
  clearTimeout(saveTimer);
  if (score) saveAnnotations(score.id, strokes).catch(() => {});
  root.hidden = true;
  closeMenu();
  closeBrush();
  delete document.documentElement.dataset.reading;
  unfollow?.();
  unfollow = null;
  clearSounding();
  view?.destroy?.();
  view = null;
  score = null;
  take = null;
  strokes = [];
  bars = new Map();
}

export function readerIsOpen() {
  return !!root && !root.hidden;
}
