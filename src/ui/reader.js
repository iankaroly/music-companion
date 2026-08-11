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

import { showScore, paint } from './score-view.js';
import { loadAnnotations, saveAnnotations } from '../store/db.js';

// px per engraver unit — the one number that decides how big the music looks.
// It is a reading size, not a fitting size: the page is as many units across as
// the screen has room for at this scale, so raising it puts fewer bars on a
// line and makes every one of them bigger.
//
// It is a preference, because how big music needs to be is a fact about the
// player and the stand, not about the phone: on the stand at arm's length you
// want it large and turn more pages, at a desk you want the whole passage.
// This is the app's one deliberate zoom, and it re-engraves rather than
// magnifying — the notes get bigger, they do not get blurrier, and the page
// still fits the screen exactly.
const SIZE_KEY = 'readerScale';
const SIZE_MIN = 3.6;
const SIZE_MAX = 9;
const SIZE_STEP = 0.9;

function readingSize() {
  const stored = Number(globalThis.localStorage?.getItem(SIZE_KEY));
  if (!Number.isFinite(stored) || stored <= 0) return 5;
  return Math.min(SIZE_MAX, Math.max(SIZE_MIN, stored));
}

function setReadingSize(next) {
  const size = Math.min(SIZE_MAX, Math.max(SIZE_MIN, next));
  try { globalThis.localStorage?.setItem(SIZE_KEY, String(size)); } catch { /* survivable */ }
  return size;
}

const PEN_COLOURS = [
  { key: 'pencil', label: 'pencil', css: '--reader-pencil' },
  { key: 'red', label: 'red', css: '--bad' },
  { key: 'blue', label: 'blue', css: '--primary' },
  { key: 'green', label: 'green', css: '--good' },
];

// In staff spaces, so a pencil line looks like a pencil line at every size.
const PEN_WIDTH = 0.28;
const HIGHLIGHT_WIDTH = 1.6;

let root = null;      // the whole reader
let sheet = null;     // where the engraving is mounted
let ink = null;       // the canvas the marks are drawn on
let view = null;      // the engraved score
let score = null;     // { id, name, xml, partIndex }
let marks = null;     // an analysed take to paint over the page, if there is one
let strokes = [];     // every mark on this piece
let pageIndex = 0;
let tool = null;      // null = reading; 'pen' | 'highlighter' | 'eraser'
let colour = 'pencil';
let drawing = null;   // the stroke being drawn
let chrome = true;    // is the bar showing
let saveTimer = null;

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

function strokeColour(stroke) {
  const found = PEN_COLOURS.find((c) => c.key === stroke.colour) ?? PEN_COLOURS[0];
  const value = getComputedStyle(document.documentElement).getPropertyValue(found.css).trim();
  return value || '#888';
}

function drawStroke(ctx, stroke) {
  const points = stroke.points.map(place);
  const scale = unitScale();
  ctx.beginPath();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = strokeColour(stroke);
  ctx.globalAlpha = stroke.tool === 'highlighter' ? 0.32 : 1;
  ctx.lineWidth = Math.max(1, stroke.width * scale);
  let moved = false;
  for (const point of points) {
    if (!point) { moved = false; continue; } // a bar on another page: lift the pen
    if (!moved) { ctx.moveTo(point.x, point.y); moved = true; } else ctx.lineTo(point.x, point.y);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
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
  const before = strokes.length;
  strokes = strokes.filter((stroke) => !stroke.points.some((point) => {
    const at = place(point);
    return at && Math.hypot(at.x - px, at.y - py) <= reach;
  }));
  if (strokes.length !== before) {
    redraw();
    scheduleSave();
  }
}

function pointerPosition(e) {
  const box = currentPage()?.getBoundingClientRect();
  if (!box) return null;
  return { x: e.clientX - box.left, y: e.clientY - box.top };
}

function beginStroke(e) {
  const at = pointerPosition(e);
  if (!at) return;
  if (tool === 'eraser') { eraseAt(at.x, at.y); return; }
  const point = anchor(at.x, at.y);
  if (!point) return;
  drawing = {
    tool,
    colour,
    width: tool === 'highlighter' ? HIGHLIGHT_WIDTH : PEN_WIDTH,
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
    scheduleSave();
  }
  drawing = null;
  redraw();
}

// --- pages -------------------------------------------------------------------

function showPage(index) {
  if (!view?.pages?.length) return;
  pageIndex = Math.max(0, Math.min(view.pages.length - 1, index));
  for (const [i, node] of view.pages.entries()) node.hidden = i !== pageIndex;
  const count = el('reader-count');
  if (count) count.textContent = `${pageIndex + 1} / ${view.pages.length}`;
  redraw();
}

const nextPage = () => showPage(pageIndex + 1);
const previousPage = () => showPage(pageIndex - 1);

// --- chrome ------------------------------------------------------------------

function setChrome(on) {
  chrome = on;
  root?.classList.toggle('bare', !on);
}

function setTool(next) {
  tool = tool === next ? null : next;
  root?.classList.toggle('drawing', tool !== null);
  for (const button of root.querySelectorAll('[data-tool]')) {
    button.classList.toggle('on', button.dataset.tool === tool);
    button.setAttribute('aria-pressed', String(button.dataset.tool === tool));
  }
  if (tool) setChrome(true);
}

// Picking a colour is also picking up the pen — unless this is the reader
// setting its own default on the way in, which must not arrive drawing.
function setColour(next, { pickUpPen = true } = {}) {
  colour = next;
  for (const button of root.querySelectorAll('[data-colour]')) {
    button.classList.toggle('on', button.dataset.colour === colour);
  }
  if (pickUpPen && !tool) setTool('pen');
}

function undo() {
  strokes.pop();
  redraw();
  scheduleSave();
}

function clearPage() {
  const before = strokes.length;
  strokes = strokes.filter((stroke) => {
    const entry = bars.get(stroke.points[0]?.m);
    return !entry || entry.page !== pageIndex;
  });
  if (strokes.length !== before) {
    redraw();
    scheduleSave();
  }
}

// --- building it -------------------------------------------------------------

function swatch(colourSpec) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'reader-swatch';
  button.dataset.colour = colourSpec.key;
  button.style.setProperty('--swatch', `var(${colourSpec.css})`);
  button.setAttribute('aria-label', `Draw in ${colourSpec.label}`);
  button.addEventListener('click', () => setColour(colourSpec.key));
  return button;
}

function toolButton(name, glyph, label) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'reader-tool';
  button.dataset.tool = name;
  button.textContent = glyph;
  button.setAttribute('aria-label', label);
  button.setAttribute('aria-pressed', 'false');
  button.addEventListener('click', () => setTool(name));
  return button;
}

function actionButton(id, glyph, label, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'reader-tool';
  button.id = id;
  button.textContent = glyph;
  button.setAttribute('aria-label', label);
  button.addEventListener('click', onClick);
  return button;
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

  const bar = document.createElement('div');
  bar.id = 'reader-bar';
  const title = document.createElement('span');
  title.id = 'reader-title';
  const count = document.createElement('span');
  count.id = 'reader-count';
  const tools = document.createElement('div');
  tools.id = 'reader-tools';
  tools.append(
    toolButton('pen', '✎', 'Draw on the page'),
    toolButton('highlighter', '▬', 'Highlight'),
    toolButton('eraser', '⌫', 'Rub out'),
    ...PEN_COLOURS.map(swatch),
    actionButton('reader-undo', '↺', 'Undo the last mark', undo),
    actionButton('reader-clear', '⌧', 'Clear this page', clearPage),
    actionButton('reader-smaller', '−', 'Smaller music, fewer pages', () => resize(-SIZE_STEP)),
    actionButton('reader-bigger', '+', 'Bigger music, more pages', () => resize(SIZE_STEP)),
  );
  bar.append(
    actionButton('reader-close', '✕', 'Close the score', close),
    title,
    tools,
    count,
  );

  root.append(sheet, ink, bar);
  document.body.append(root);

  // A tap: back, forward, or show me the controls. Deliberately on the reader
  // itself rather than on three overlaid zones — an invisible div over the
  // music is one more thing to get between a finger and a page turn.
  root.addEventListener('click', (e) => {
    if (tool) return;                        // the pen owns the page while it is out
    if (e.target.closest('#reader-bar')) return;
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
    if (e.key === 'Escape') close();
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
async function resize(step) {
  if (!score) return;
  const anchorBar = firstBarOnPage();
  setReadingSize(readingSize() + step);
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

function pageFormat() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  // A floor on the units across: past a point the page is narrower than one bar
  // and the engraver has nowhere to put the music.
  const units = Math.max(48, width / readingSize());
  // A whisker under the screen's own proportions. The engraver rounds a page up
  // to whole staff spaces, and a page a few pixels taller than the screen is a
  // page with the bottom line of the last system cut off.
  return { width: units, height: units * (height / width) * 0.985 };
}

async function engrave() {
  view = await showScore(sheet, {
    xml: score.xml,
    scoreNotes: marks?.scoreNotes ?? [],
    partIndex: score.partIndex ?? 0,
    pageFormat: pageFormat(),
    // The reader re-engraves on rotation itself, at the new page shape; the
    // view's own resize handler would re-render at the old one underneath it.
    autoRelayout: false,
  });
  bars = indexBars();
  // A take read against this score comes with it, so the marked-up page can be
  // read full screen too rather than only in the panel.
  if (marks?.aligned) {
    paint(view, { aligned: marks.aligned, timing: marks.timing, landings: marks.landings });
  }
  return view;
}

// --- the door ----------------------------------------------------------------

export async function openReader(row, { marks: takeMarks = null } = {}) {
  if (!row?.xml) return null;
  build();
  score = row;
  marks = takeMarks;
  strokes = await loadAnnotations(row.id).catch(() => []);
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
  setColour(colour, { pickUpPen: false });
  setTool(null);
  showPage(0);
  return view;
}

export function close() {
  if (!root || root.hidden) return;
  clearTimeout(saveTimer);
  if (score) saveAnnotations(score.id, strokes).catch(() => {});
  root.hidden = true;
  delete document.documentElement.dataset.reading;
  view?.destroy?.();
  view = null;
  score = null;
  marks = null;
  strokes = [];
  bars = new Map();
}

export function readerIsOpen() {
  return !!root && !root.hidden;
}
