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

import { showScore, indexNoteheads, paint } from './score-view.js';
import { followPlayback } from './report.js';
import { openPaper } from './paper.js';
import { actionMenu } from './controls.js';
import {
  loadAnnotations, saveAnnotations, loadScorePages, renameScore, deleteScore,
  saveBookmarks,
} from '../store/db.js';

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

// Only ever offered on a screen wide enough to mean it: two pages on a phone
// held upright is two columns of postage stamps.
function spreadFits() {
  return window.innerWidth > window.innerHeight * 1.15 && window.innerWidth >= 900;
}

function wantsSpread() {
  try {
    return globalThis.localStorage?.getItem(SPREAD_KEY) === 'on' && spreadFits();
  } catch {
    return false;
  }
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

// The shapes a musician draws on music: a line under a passage, a box round a
// bar, a ring round an accidental, an arrow at a page turn.
const SHAPES = ['line', 'arrow', 'rect', 'ellipse'];

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
let view = null;      // the engraved score, when the score IS notation
let paper = null;     // the pages, when the score is paper
let pageEls = [];     // whichever kind, the elements one page each
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
// Layers, in the sense a musician means: the fingerings you agreed with your
// teacher on one, the bowings you are still arguing about on another, the
// conductor's cuts on a third. Each can be hidden without rubbing anything out,
// and a mark belongs to whichever was current when it was made.
const LAYER_NAMES = ['fingerings', 'bowings', 'notes'];
let layer = 0;
let hidden = new Set();   // layers being kept out of sight
// Two pages at once, which is what a tablet on a stand is FOR: half the page
// turns, and the turn you do make lands you at the top of a fresh spread rather
// than halfway down the music you were reading.
const SPREAD_KEY = 'readerSpread';
let spread = false;

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

// The page — or PAGES: on a wide screen two of them sit side by side, the way a
// tablet on a stand reads, and everything that touches the paper has to cope
// with either. The pen, the page turns and the ink layer never ask which.
function currentPage() {
  return pageEls[pageIndex] ?? null;
}

function visiblePages() {
  const shown = [pageIndex];
  if (spread && pageIndex + 1 < pageEls.length) shown.push(pageIndex + 1);
  return shown;
}

// The rectangle a page's marks belong to, in SCREEN coordinates. For engraved
// music that is the page container; for paper it is the drawn page inside it,
// which is centred with margins either side.
function boxOfPage(index) {
  const node = pageEls[index];
  if (!node) return null;
  const target = isPaper() ? node.querySelector('canvas') : node;
  return target?.getBoundingClientRect() ?? null;
}

// Which of the visible pages a point is over — with two pages up, the left half
// of the screen and the right half are different pages of music.
function pageAt(x, y) {
  const shown = visiblePages();
  for (const index of shown) {
    const box = boxOfPage(index);
    if (box && x >= box.left && x <= box.right && y >= box.top && y <= box.bottom) return index;
  }
  return shown[0] ?? 0;
}

// Is this score notation, or is it paper? Everything that reads bars is off
// limits for paper: a picture of a page knows nothing about where bar 12 is.
function isPaper() {
  return !!paper;
}

function pageBox() {
  return boxOfPage(pageIndex);
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
  if (!entry || !visiblePages().includes(entry.page)) return null;
  const lines = [...entry.node.children]
    .filter((node) => node.tagName === 'path')
    .slice(0, 5)
    .map((node) => node.getBoundingClientRect());
  if (lines.length < 5 || lines[0].width === 0) {
    // No staff to measure (an empty bar, a backend that drew it differently):
    // fall back to the bar's outline, which is roughly right and never null.
    const box = entry.node.getBoundingClientRect();
    return {
      x: box.left, y: box.top, width: box.width, height: box.height,
      unit: Math.max(1, box.height / 8),
    };
  }
  const unit = Math.max(1, (lines[4].top - lines[0].top) / 4);
  return {
    x: lines[0].left,
    y: lines[0].top,
    width: lines[0].width,
    height: unit * 4,
    unit,
  };
}

// The length a stroke width is measured in. On engraved music that is a staff
// space, which is the same size as the notes it is drawn among. A photograph of
// a page has no staff space this code can find, so it uses a sixtieth of the
// page — about a staff space on a printed part, and in any case a constant
// fraction of the paper, so a pen looks the same on a phone and an iPad.
function unitScale() {
  if (isPaper()) {
    const box = pageBox();
    return Math.max(1, (box?.height ?? 600) / 60);
  }
  const shown = visiblePages();
  for (const [bar, entry] of bars) {
    if (!shown.includes(entry.page)) continue;
    const frame = barFrame(bar);
    if (frame) return frame.unit;
  }
  return 10;
}

// On paper, a mark is held against the PAGE, as a fraction of its width and
// height. There is nothing else to hold it against — and nothing needs
// anything else, because a scanned page never re-flows: it is the same picture
// at every size, so a mark two thirds of the way across bar 12 stays exactly
// there whatever the screen does.
function anchorOnPaper(px, py) {
  const index = pageAt(px, py);
  const box = boxOfPage(index);
  if (!box || !box.width || !box.height) return null;
  return {
    space: 'page',
    p: index,
    x: (px - box.left) / box.width,
    y: (py - box.top) / box.height,
  };
}

function placeOnPaper(point) {
  if (!visiblePages().includes(point.p)) return null;
  const box = boxOfPage(point.p);
  if (!box) return null;
  return { x: box.left + point.x * box.width, y: box.top + point.y * box.height };
}

// A point on screen → the bar it is over, plus how far into that bar it sits.
// Points that land between bars — in the margin, above the first system — take
// the nearest bar on the page, so a bracket drawn round a system still has
// something to hold on to.
function anchor(px, py) {
  if (isPaper()) return anchorOnPaper(px, py);
  const shown = visiblePages();
  let best = null;
  let bestDistance = Infinity;
  for (const [number, entry] of bars) {
    if (!shown.includes(entry.page)) continue;
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
  if (point.space === 'page' || point.p !== undefined) return placeOnPaper(point);
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
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = strokeColour(stroke);
  ctx.fillStyle = strokeColour(stroke);
  // A highlighter goes UNDER the notes rather than over them: multiply keeps
  // the black of the engraving showing through a wash of colour, which is what
  // a real one does to paper.
  if (stroke.overlay ?? stroke.tool === 'highlighter') ctx.globalCompositeOperation = 'multiply';
  ctx.lineWidth = Math.max(1, stroke.width * scale);

  // Typed, not drawn: a fingering, a bar number, "watch the shift". Written at
  // a size in staff spaces like everything else, so it stays the size of the
  // music it is written on.
  if (stroke.type === 'text') {
    const at = points[0];
    if (at) {
      const size = Math.max(8, (stroke.size ?? 1.6) * scale);
      ctx.font = `600 ${size}px ${getComputedStyle(document.documentElement)
        .getPropertyValue('--display').trim() || 'sans-serif'}`;
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(stroke.text ?? '', at.x, at.y);
    }
    ctx.restore();
    return;
  }

  // Two corners and a shape between them.
  if (stroke.type === 'shape') {
    const [a, b] = points;
    // Not across the gutter: with two pages up, a box whose corners ended up on
    // different pages is not a box round anything.
    const [pa, pb] = stroke.points.map((point) => (
      point.p !== undefined ? point.p : bars.get(point.m)?.page
    ));
    if (a && b && pa === pb) {
      ctx.beginPath();
      if (stroke.shape === 'line' || stroke.shape === 'arrow') {
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        if (stroke.shape === 'arrow') {
          // A head that grows with the pen rather than with the arrow: a long
          // arrow drawn thin should not arrive with a spearhead on it.
          const head = Math.max(6, ctx.lineWidth * 3.5);
          const angle = Math.atan2(b.y - a.y, b.x - a.x);
          ctx.beginPath();
          ctx.moveTo(b.x, b.y);
          ctx.lineTo(b.x - head * Math.cos(angle - 0.4), b.y - head * Math.sin(angle - 0.4));
          ctx.lineTo(b.x - head * Math.cos(angle + 0.4), b.y - head * Math.sin(angle + 0.4));
          ctx.closePath();
          ctx.fill();
        }
      } else if (stroke.shape === 'rect') {
        ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      } else if (stroke.shape === 'ellipse') {
        ctx.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2,
          Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.restore();
    return;
  }

  // The pen lifts between systems, not just between pages.
  //
  // A mark drawn along a line of music is anchored to the bars it covers, and
  // those bars do not stay on one line: re-engraved for another screen, bar 7
  // can end a system and bar 8 begin the next one. Joining them would draw a
  // diagonal across the page — the marks still cover the right MUSIC, but they
  // look like a scrawl. Broken at the system, a highlight over four bars comes
  // back as a highlight over four bars, on however many lines they now occupy.
  const systems = stroke.points.map((point) => (
    point.space === 'page' || point.p !== undefined ? null : bars.get(point.m)?.system ?? null
  ));
  ctx.beginPath();
  let moved = false;
  for (const [i, point] of points.entries()) {
    if (!point) { moved = false; continue; } // a bar on another page: lift the pen
    if (i > 0 && systems[i] !== systems[i - 1]) moved = false;
    if (!moved) { ctx.moveTo(point.x, point.y); moved = true; } else ctx.lineTo(point.x, point.y);
  }
  ctx.stroke();
  ctx.restore();
}

// The ink layer is the whole screen, and the drawing is moved onto the page.
//
// It used to be a canvas the size of the page, moved to sit on top of it. That
// stops working the moment the page can be zoomed: a page at four times the
// size is a canvas four times the size, most of it off-screen, all of it in
// memory. One screen-sized canvas with the origin shifted to the page's corner
// draws the same picture and costs the same however far in you go.
function redraw() {
  if (!ink || !pageBox()) return;
  const dpr = window.devicePixelRatio || 1;
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (ink.width !== Math.round(w * dpr) || ink.height !== Math.round(h * dpr)) {
    ink.width = Math.round(w * dpr);
    ink.height = Math.round(h * dpr);
  }
  ink.style.width = `${w}px`;
  ink.style.height = `${h}px`;
  ink.style.left = '0px';
  ink.style.top = '0px';
  const ctx = ink.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  for (const stroke of strokes) {
    if (hidden.has(stroke.layer ?? 0)) continue;
    drawStroke(ctx, stroke);
  }
  if (drawing) drawStroke(ctx, drawing);
  drawLasso(ctx);
}

// Rubbing out: a stroke goes if the eraser passes within a finger's width of it.
function eraseAt(px, py) {
  const scale = unitScale();
  const reach = 3.2 * scale;
  const gone = [];
  strokes = strokes.filter((stroke) => {
    if (hidden.has(stroke.layer ?? 0)) return true;  // out of sight, out of reach
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

// Screen coordinates, all the way through: with two pages up there is no one
// page to be relative to, and every frame is measured live anyway.
function pointerPosition(e) {
  return { x: e.clientX, y: e.clientY };
}

let erasing = false;
// The lasso: a loop drawn round marks, and then what you do with them. Kept
// apart from the drawing tools because it does not add ink — it picks up ink
// that is already there.
let lasso = null;        // the loop being drawn, in screen points
let picked = [];         // the strokes inside it
let dragging = null;     // { x, y } while the selection is being moved

function beginStroke(e) {
  const at = pointerPosition(e);
  if (!at) return;
  if (tool === 'eraser') { erasing = false; eraseAt(at.x, at.y); erasing = true; return; }
  if (tool === 'lasso') {
    // Inside a selection you already have, the drag moves it; anywhere else it
    // starts a new loop.
    if (picked.length && insideSelection(at.x, at.y)) dragging = { x: at.x, y: at.y };
    else { picked = []; lasso = [at]; }
    redraw();
    return;
  }
  const point = anchor(at.x, at.y);
  if (!point) return;
  if (tool === 'text') { writeText(point); return; }
  const brush = currentBrush();
  drawing = {
    tool,
    layer,
    colour: brushCss(brush),
    width: brush.width,
    overlay: brush.overlay,
    points: [point],
  };
  // A shape is two points: where the finger went down and where it is now. The
  // second is replaced on every move rather than added to, which is what makes
  // it stretch instead of scribble.
  if (SHAPES.includes(tool)) {
    drawing.type = 'shape';
    drawing.shape = tool;
    drawing.points.push(point);
  }
}

function extendStroke(e) {
  const at = pointerPosition(e);
  if (!at) return;
  if (tool === 'eraser') { eraseAt(at.x, at.y); return; }
  if (tool === 'lasso') {
    if (dragging) {
      moveSelection(at.x - dragging.x, at.y - dragging.y);
      dragging = at;
    } else if (lasso) {
      lasso.push(at);
    }
    redraw();
    return;
  }
  if (!drawing) return;
  const point = anchor(at.x, at.y);
  if (point && drawing.type === 'shape') drawing.points[1] = point;
  else if (point) drawing.points.push(point);
  redraw();
}

// A stroke that turned out to be the start of a pinch is not a stroke.
function cancelStroke() {
  drawing = null;
  redraw();
}

function endStroke() {
  if (tool === 'lasso') {
    if (dragging) { dragging = null; scheduleSave(); }
    else if (lasso) { picked = strokesInside(lasso); lasso = null; refreshSelectionBar(); }
    redraw();
    return;
  }
  if (drawing?.type === 'shape') {
    // A shape that is a dot was a tap, not a drag.
    const [a, b] = drawing.points.map(place);
    const big = a && b && Math.hypot(b.x - a.x, b.y - a.y) > 6;
    if (big) { strokes.push(drawing); remember({ type: 'add', stroke: drawing }); scheduleSave(); }
    drawing = null;
    redraw();
    return;
  }
  if (drawing && drawing.points.length > 1) {
    strokes.push(drawing);
    remember({ type: 'add', stroke: drawing });
    scheduleSave();
  }
  drawing = null;
  erasing = false;
  redraw();
}

// --- zoom and pan ------------------------------------------------------------
//
// Pinching in on a page is the one magnification this app allows, and it is
// here because of the pen: writing a fingering between two ledger lines at
// arm's length is asking to draw a fingering on the wrong note. It is a
// transform on the page, so the engraving stays sharp at any size and the ink
// follows exactly — every mark is placed from the page's box, and the box is
// measured live, transform and all.
//
// Two fingers, always. One finger is the pen while annotating and a page turn
// while reading, and neither can be shared.

const ZOOM_LIMIT = 5;
let zoom = 1;
let panX = 0;
let panY = 0;
const pointers = new Map();
let pinch = null;   // { distance, x, y } at the moment the second finger landed

function applyZoom() {
  if (!sheet) return;
  sheet.style.transformOrigin = '50% 50%';
  sheet.style.transform = zoom === 1 && !panX && !panY
    ? ''
    : `translate(${panX}px, ${panY}px) scale(${zoom})`;
  const reset = el('reader-reset-zoom');
  if (reset) reset.hidden = zoom === 1;
  redraw();
}

// Keep the page overlapping the screen: at any zoom you can push a corner to
// the middle, and no further. Losing the page off the edge with no way to
// scroll it back would be a dead end.
function clampPan() {
  const box = currentPage()?.getBoundingClientRect();
  if (!box) return;
  const slackX = Math.max(0, (box.width - window.innerWidth) / 2 + window.innerWidth * 0.25);
  const slackY = Math.max(0, (box.height - window.innerHeight) / 2 + window.innerHeight * 0.25);
  panX = Math.min(slackX, Math.max(-slackX, panX));
  panY = Math.min(slackY, Math.max(-slackY, panY));
}

function resetZoom() {
  zoom = 1;
  panX = 0;
  panY = 0;
  applyZoom();
  if (isPaper()) redrawPaperAtZoom();
}

// A photograph drawn for a screen and then blown up four times is four times
// blurrier. Once the fingers come off, the page is drawn again at the size it
// is now being shown.
let sharpenTimer = null;
function redrawPaperAtZoom() {
  clearTimeout(sharpenTimer);
  sharpenTimer = setTimeout(async () => {
    if (!isPaper() || !paper) return;
    const node = pageEls[pageIndex];
    const canvas = node?.querySelector('canvas');
    if (!canvas) return;
    await paper.draw(pageIndex, canvas, window.innerWidth * zoom, window.innerHeight * zoom);
    // Drawn big, shown at the page's own size: the transform does the rest.
    canvas.style.width = `${Math.round(canvas.width / (window.devicePixelRatio || 1) / zoom)}px`;
    canvas.style.height = `${Math.round(canvas.height / (window.devicePixelRatio || 1) / zoom)}px`;
    redraw();
  }, 220);
}

function trackPointers(root) {
  root.addEventListener('pointerdown', (e) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = {
        distance: Math.hypot(a.x - b.x, a.y - b.y),
        x: (a.x + b.x) / 2,
        y: (a.y + b.y) / 2,
        zoom,
        panX,
        panY,
      };
      cancelStroke();   // the first finger was drawing; it was not, it was pinching
    }
  }, true);
  root.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size !== 2 || !pinch) return;
    const [a, b] = [...pointers.values()];
    const distance = Math.hypot(a.x - b.x, a.y - b.y);
    const x = (a.x + b.x) / 2;
    const y = (a.y + b.y) / 2;
    zoom = Math.min(ZOOM_LIMIT, Math.max(1, pinch.zoom * (distance / (pinch.distance || 1))));
    panX = pinch.panX + (x - pinch.x);
    panY = pinch.panY + (y - pinch.y);
    if (zoom === 1) { panX = 0; panY = 0; }
    clampPan();
    applyZoom();
  }, true);
  for (const type of ['pointerup', 'pointercancel']) {
    root.addEventListener(type, (e) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      if (pointers.size === 0 && isPaper() && zoom > 1) redrawPaperAtZoom();
    }, true);
  }
}

// Typing on the page. The keyboard is the right tool for a word — writing
// "sul G" with a fingertip is a worse version of a thing every phone already
// does well.
function writeText(point) {
  const dialog = document.querySelector('#reader-text-dialog');
  const input = document.querySelector('#reader-text-input');
  if (!dialog || !input) return;
  input.value = '';
  const done = () => {
    dialog.removeEventListener('close', done);
    if (dialog.returnValue !== 'save') return;
    const text = input.value.trim();
    if (!text) return;
    const brush = currentBrush();
    const stroke = {
      type: 'text',
      tool: 'text',
      layer,
      text,
      size: Math.max(1, brush.width * 5),
      colour: brushCss({ ...brush, a: 1 }),
      points: [point],
    };
    strokes.push(stroke);
    remember({ type: 'add', stroke });
    scheduleSave();
    redraw();
  };
  dialog.addEventListener('close', done);
  dialog.showModal();
  input.focus();
}

// --- the lasso ---------------------------------------------------------------

// Even-odd ray casting: the usual answer to "is this point inside that loop".
function insideLoop(loop, x, y) {
  let inside = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const a = loop[i];
    const b = loop[j];
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

// A mark is caught if MOST of it is in the loop — catching a long slur because
// one end of it strayed inside would be worse than missing it.
function strokesInside(loop) {
  if (loop.length < 3) return [];
  return strokes.filter((stroke) => {
    if (hidden.has(stroke.layer ?? 0)) return false;
    const points = stroke.points.map(place).filter(Boolean);
    if (!points.length) return false;
    const caught = points.filter((point) => insideLoop(loop, point.x, point.y)).length;
    return caught / points.length > 0.6;
  });
}

function selectionBounds() {
  let box = null;
  for (const stroke of picked) {
    for (const point of stroke.points.map(place)) {
      if (!point) continue;
      box ??= { left: point.x, right: point.x, top: point.y, bottom: point.y };
      box.left = Math.min(box.left, point.x);
      box.right = Math.max(box.right, point.x);
      box.top = Math.min(box.top, point.y);
      box.bottom = Math.max(box.bottom, point.y);
    }
  }
  return box;
}

function insideSelection(x, y) {
  const box = selectionBounds();
  if (!box) return false;
  const margin = 20;
  return x > box.left - margin && x < box.right + margin
    && y > box.top - margin && y < box.bottom + margin;
}

// Moving marks means moving them WITHIN their anchor: a few staff spaces
// further along the bar they belong to, or a fraction further down the page
// they are on. They stay attached to the music they were about.
function moveSelection(dx, dy) {
  const scale = unitScale();
  for (const stroke of picked) {
    for (const point of stroke.points) {
      if (point.p !== undefined) {
        const box = boxOfPage(point.p);
        if (!box) continue;
        point.x += dx / box.width;
        point.y += dy / box.height;
      } else {
        point.u += dx / scale;
        point.v += dy / scale;
      }
    }
  }
}

function recolourSelection() {
  const brush = currentBrush();
  for (const stroke of picked) stroke.colour = brushCss(brush);
  scheduleSave();
  redraw();
}

function deleteSelection() {
  if (!picked.length) return;
  const gone = picked;
  strokes = strokes.filter((stroke) => !gone.includes(stroke));
  remember({ type: 'erase', strokes: gone });
  picked = [];
  refreshSelectionBar();
  scheduleSave();
  redraw();
}

function clearSelection() {
  picked = [];
  lasso = null;
  refreshSelectionBar();
  redraw();
}

function refreshSelectionBar() {
  const bar = el('reader-selection');
  if (!bar) return;
  bar.hidden = picked.length === 0;
  const count = bar.querySelector('.reader-selection-count');
  if (count) count.textContent = `${picked.length} ${picked.length === 1 ? 'mark' : 'marks'}`;
}

// The loop itself, and a box round what it caught.
function drawLasso(ctx) {
  if (lasso?.length > 1) {
    ctx.save();
    ctx.setLineDash([6, 5]);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim() || '#6d4ef6';
    ctx.beginPath();
    ctx.moveTo(lasso[0].x, lasso[0].y);
    for (const point of lasso.slice(1)) ctx.lineTo(point.x, point.y);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }
  const box = picked.length ? selectionBounds() : null;
  if (box) {
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim() || '#6d4ef6';
    ctx.strokeRect(box.left - 8, box.top - 8, box.right - box.left + 16, box.bottom - box.top + 16);
    ctx.restore();
  }
}

// --- pages -------------------------------------------------------------------

function showPage(index) {
  if (!pageEls.length) return;
  const moved = index !== pageIndex;
  pageIndex = Math.max(0, Math.min(pageEls.length - 1, index));
  // A new page is a new page: it arrives whole, not at whatever corner you had
  // magnified on the last one.
  if (moved && zoom !== 1) { zoom = 1; panX = 0; panY = 0; applyZoom(); }
  const shown = visiblePages();
  for (const [i, node] of pageEls.entries()) {
    node.hidden = !shown.includes(i);
    const side = shown.length > 1 && shown.includes(i) ? (i === shown[0] ? 'left' : 'right') : '';
    node.dataset.side = side;
    // Laid out from here rather than from the stylesheet: the engraver puts
    // `position: relative` inline on every page container it makes, and an
    // inline style beats any rule you can write about it.
    if (side) {
      node.style.position = 'absolute';
      node.style.top = '0';
      node.style.left = side === 'left' ? '0' : '100%';
      node.style.width = '100%';
    } else {
      node.style.position = '';
      node.style.top = '';
      node.style.left = '';
      node.style.width = '';
    }
  }
  if (isPaper()) {
    for (const index of shown) drawPaperPage(index).catch(() => {});
    // The page after, quietly, so a turn is instant.
    const ahead = shown.at(-1) + 1;
    if (ahead < pageEls.length) setTimeout(() => drawPaperPage(ahead).catch(() => {}), 120);
  }
  const count = el('reader-count');
  if (count) count.textContent = `p. ${pageIndex + 1} of ${pageEls.length}`;
  redraw();
}

const step = () => (spread ? 2 : 1);
const nextPage = () => showPage(pageIndex + step());
const previousPage = () => showPage(pageIndex - step());

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
  if (tool !== 'lasso') { picked = []; lasso = null; refreshSelectionBar(); }
  root?.classList.toggle('drawing', tool !== null);
  for (const button of root.querySelectorAll('[data-tool]')) {
    const on = button.dataset.tool === tool;
    button.classList.toggle('on', on);
    button.setAttribute('aria-pressed', String(on));
  }
  const shapes = el('reader-shapes');
  if (shapes) {
    const on = SHAPES.includes(tool);
    shapes.classList.toggle('on', on);
    shapes.textContent = on ? SHAPE_GLYPH[tool] : '◻';
  }
  if (tool) {
    setChrome(true);
    closeMenu();
  }
  closeBrush();
  refreshBrushUI();
}

const SHAPE_GLYPH = { line: '╱', arrow: '↗', rect: '◻', ellipse: '◯' };

function openShapeMenu() {
  const button = el('reader-shapes');
  actionMenu(button, SHAPES.map((shape) => ({
    label: { line: 'Line', arrow: 'Arrow', rect: 'Box', ellipse: 'Ring' }[shape],
    onPick: () => setTool(shape),
  })));
}

// Which sheet you are writing on, and which sheets you are looking at. Both in
// one menu because they are the same question asked twice.
function openLayerMenu() {
  const button = el('reader-layers');
  actionMenu(button, LAYER_NAMES.map((name, index) => ({
    label: `${index === layer ? '✎ ' : ''}${name}${hidden.has(index) ? ' — hidden' : ''}`,
    onPick: () => {
      if (index === layer) {
        // Tapping the sheet you are already on is how you put it away.
        if (hidden.has(index)) hidden.delete(index);
        else hidden.add(index);
      } else {
        layer = index;
        hidden.delete(index);   // you cannot write on a sheet you cannot see
      }
      refreshBrushUI();
      redraw();
    },
  })));
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

function onThisPage(stroke) {
  const first = stroke.points[0];
  if (!first) return false;
  const shown = visiblePages();
  if (first.space === 'page' || first.p !== undefined) return shown.includes(first.p);
  return shown.includes(bars.get(first.m)?.page);
}

function clearPage() {
  const gone = strokes.filter(onThisPage);
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
  const layers = el('reader-layers');
  if (layers) {
    layers.title = `Writing on ${LAYER_NAMES[layer]}`;
    layers.setAttribute('aria-label', layers.title);
    layers.classList.toggle('on', hidden.size > 0);
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

// --- bookmarks ---------------------------------------------------------------
//
// A bookmark is a place in the MUSIC, not a page number: on notation it is the
// first bar of the page you were on, so it still finds the right spot after the
// music has been re-engraved at another size, on another screen, into another
// number of pages. On a scan there are no bars, so a page number is all there
// is and all it can be.

function bookmarksOf() {
  return score?.bookmarks ?? [];
}

async function addBookmark() {
  if (!score) return;
  const here = isPaper()
    ? { page: pageIndex }
    : { bar: firstBarOnPage() ?? 1 };
  const label = isPaper()
    ? `page ${pageIndex + 1}`
    : `bar ${here.bar}`;
  const list = [...bookmarksOf(), { ...here, label }];
  score.bookmarks = list;
  await saveBookmarks(score.id, list).catch(() => {});
}

function goToBookmark(mark) {
  if (mark.page !== undefined) { showPage(mark.page); return; }
  const page = bars.get(mark.bar)?.page;
  if (page !== undefined) showPage(page);
}

async function dropBookmark(mark) {
  const list = bookmarksOf().filter((m) => m !== mark);
  score.bookmarks = list;
  await saveBookmarks(score.id, list).catch(() => {});
}

function openBookmarks() {
  const rows = bookmarksOf().map((mark) => ({
    label: mark.label,
    onPick: () => goToBookmark(mark),
  }));
  rows.push({ label: '＋ Mark this page', onPick: () => addBookmark() });
  if (bookmarksOf().length) {
    rows.push({
      label: 'Forget the last one',
      danger: true,
      onPick: () => dropBookmark(bookmarksOf().at(-1)),
    });
  }
  actionMenu(el('reader-menu-btn'), rows);
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
  if (take?.aligned && !isPaper()) {
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
  if (!isPaper()) {
    menuGroup(sheet, 'reading');
    menuRow(sheet, {
      label: 'Bigger', glyph: '+', detail: 'larger notes, more pages',
      onPick: () => resize(ZOOM_STEP),
    });
    menuRow(sheet, {
      label: 'Smaller', glyph: '−', detail: 'more music to a page',
      onPick: () => resize(1 / ZOOM_STEP),
    });
  }
  if (isPaper()) {
    menuGroup(sheet, 'what is behind it');
    menuRow(sheet, {
      label: score?.notationId != null ? 'Change the notation…' : 'Add notation for analysis…',
      glyph: '♪',
      detail: score?.notationId != null
        ? 'takes of this piece are read against it'
        : 'so takes can be marked up on it',
      onPick: chooseNotation,
    });
  }
  menuGroup(sheet, 'places');
  menuRow(sheet, {
    label: 'Bookmarks', glyph: '⚑',
    detail: bookmarksOf().length
      ? bookmarksOf().map((m) => m.label).join(' · ').slice(0, 44)
      : 'mark where you keep stopping',
    onPick: openBookmarks,
  });
  if (!isPaper()) {
    menuRow(sheet, {
      label: spread ? 'One page at a time' : 'Two pages side by side',
      glyph: '▥',
      detail: spread ? 'the way a phone reads' : 'the way a tablet on a stand reads',
      onPick: toggleSpread,
    });
  }
  menuGroup(sheet, 'this file');
  menuRow(sheet, {
    label: 'Rename…', glyph: 'Aa', detail: score?.name ?? '',
    onPick: renameThisScore,
  });
  menuRow(sheet, {
    label: 'Delete this score', glyph: '␡', danger: true,
    detail: 'the pages and everything written on them',
    onPick: deleteThisScore,
  });
  menuRow(sheet, { label: 'Close the score', glyph: '✕', onPick: close });
}

// Naming and unnaming. A scan arrives called whatever the camera called it, so
// renaming is not a nicety here — it is how a shelf of photographs becomes a
// shelf of pieces.
function renameThisScore() {
  const dialog = document.querySelector('#score-name-dialog');
  const input = document.querySelector('#score-name-input');
  if (!dialog || !input || !score) return;
  input.value = score.name ?? '';
  const done = async () => {
    dialog.removeEventListener('close', done);
    if (dialog.returnValue !== 'save') return;
    const name = input.value.trim();
    if (!name) return;
    await renameScore(score.id, name).catch(() => {});
    score.name = name;
    const title = el('reader-title');
    if (title) title.textContent = name;
    announceLibraryChanged();
  };
  dialog.addEventListener('close', done);
  dialog.showModal();
}

// Two taps, no dialog: the first turns the row into the warning. Same shape the
// settings sheet uses for restoring defaults.
let armedDelete = false;
async function deleteThisScore() {
  if (!score) return;
  if (!armedDelete) {
    armedDelete = true;
    setTimeout(() => { armedDelete = false; }, 5000);
    toggleMenu();                 // reopen, so the row can say it out loud
    const sheet = el('reader-menu');
    const row = [...sheet.querySelectorAll('.reader-menu-row')].find((r) => r.classList.contains('danger'));
    if (row) row.querySelector('b').textContent = 'Tap again to delete it';
    return;
  }
  const id = score.id;
  close();
  await deleteScore(id).catch(() => {});
  announceLibraryChanged();
}

function announceLibraryChanged() {
  document.dispatchEvent(new CustomEvent('settings-change', { detail: { key: 'library' } }));
}

// Behind a scan: the notation that says which note is which.
//
// Nothing here recognises music from a photograph — no browser can, and the
// services that do would mean sending your part to somebody else's computer.
// What this does instead is let you SAY the two are the same piece: recognise
// the scan once in MuseScore (or wherever), bring the MusicXML back, and from
// then on the piece reads from your pages and analyses from the file.
async function chooseNotation() {
  if (!score) return;
  const { notationScores, pairWithNotation, importNotationFor } = await import('./score.js');
  const scores = await notationScores();
  const rows = scores.map((row) => ({
    label: row.id === score.notationId ? `✓ ${row.name}` : row.name,
    onPick: async () => {
      await pairWithNotation(score.id, row.id);
      score.notationId = row.id;
    },
  }));
  rows.push({
    label: '＋ Import a MusicXML file…',
    onPick: () => {
      const input = document.querySelector('#score-notation-file');
      if (!input) return;
      input.onchange = async () => {
        const file = input.files?.[0];
        input.value = '';
        if (!file) return;
        const id = await importNotationFor(score.id, file).catch(() => null);
        if (id != null) score.notationId = id;
      };
      input.click();
    },
  });
  if (score.notationId != null) {
    rows.push({
      label: 'Unpair',
      danger: true,
      onPick: async () => {
        await pairWithNotation(score.id, null);
        delete score.notationId;
      },
    });
  }
  actionMenu(el('reader-menu-btn'), rows);
}

async function toggleSpread() {
  spread = !spread;
  try { globalThis.localStorage?.setItem(SPREAD_KEY, spread ? 'on' : 'off'); } catch { /* fine */ }
  root.classList.toggle('spread', spread);
  const bar = firstBarOnPage();
  await render();
  showPage(bars.get(bar)?.page ?? 0);
}

// --- painting the take over the page -----------------------------------------

let painted = false;

async function togglePainted() {
  if (!take?.aligned || !view) return;
  painted = !painted;
  if (painted) {
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

  const left = document.createElement('div');
  left.className = 'reader-bar-left';
  left.append(
    iconButton('reader-close', '✕', 'Close the score', close),
    iconButton('reader-back', '‹', 'The page before', previousPage),
    iconButton('reader-forward', '›', 'The next page', nextPage),
  );

  const middle = document.createElement('div');
  middle.className = 'reader-bar-middle';
  const title = document.createElement('span');
  title.id = 'reader-title';
  const count = document.createElement('span');
  count.id = 'reader-count';
  middle.append(title, count);

  const right = document.createElement('div');
  right.className = 'reader-bar-right';
  right.append(
    iconButton('reader-play', '▶', 'Play the take', togglePlayback),
    iconButton('reader-annotate', '✎', 'Annotate this page', () => setTool('pen')),
    iconButton('reader-menu-btn', '⋯', 'More', toggleMenu),
  );

  bar.append(left, middle, right);
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
    toolButton('text', 'A', 'Type on the page'),
    iconButton('reader-shapes', '◻', 'Lines, boxes and rings', openShapeMenu),
    toolButton('lasso', '◌', 'Pick up marks'),
    toolButton('eraser', '⌫', 'Rub out'),
    ...PRESETS.map((_, i) => presetSwatch(i)),
    brushBtn,
    iconButton('reader-undo', '↺', 'Undo', undo),
    iconButton('reader-redo', '↻', 'Redo', redo),
    iconButton('reader-clear', '⌧', 'Clear this page', clearPage),
    iconButton('reader-layers', '≡', 'Layers', openLayerMenu),
    iconButton('reader-reset-zoom', '1×', 'Back to the whole page', resetZoom),
  );
  bar.querySelector('#reader-reset-zoom').hidden = true;
  return bar;
}

// What you can do to marks you have picked up. It appears with them and goes
// away with them.
function buildSelectionBar() {
  const bar = document.createElement('div');
  bar.id = 'reader-selection';
  bar.hidden = true;
  const count = document.createElement('span');
  count.className = 'reader-selection-count';
  bar.append(
    count,
    iconButton(null, '🎨', 'Recolour them', recolourSelection, { className: 'reader-chip' }),
    iconButton(null, 'Delete', 'Rub them out', deleteSelection, { className: 'reader-chip danger' }),
    iconButton(null, 'Done', 'Put them down', clearSelection, { className: 'reader-chip' }),
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

  root.append(sheet, ink, buildTopBar(), buildInkBar(), buildBrushPanel(), buildSelectionBar(), menu);
  document.body.append(root);
  trackPointers(root);

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
  if (!score || isPaper()) return; // paper is one size: the size of the page
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
    spread = wantsSpread();
    root.classList.toggle('spread', spread);
    drawn.clear();
    await render();
    showPage(Math.min(wasOn, pageEls.length - 1));
  }, 200);
}

// The page, in staff spaces, and the engraver zoom that turns those back into
// exactly one screenful of pixels.
function pageFormat() {
  const space = staffPx();
  // A floor on the width: past a point the page is narrower than a single bar
  // and the engraver has nowhere to put the music.
  const across = spread ? window.innerWidth / 2 : window.innerWidth;
  const width = Math.max(24, across / space);
  // A whisker under the screen's own proportions — the engraver rounds a page
  // up to whole staff spaces, and a page a few pixels taller than the screen is
  // a page with the bottom line of the last system cut off.
  const height = (window.innerHeight / space) * 0.985;
  return { width, height, zoom: space / PHONE_STAFF_PX };
}

// One door, two kinds of score behind it.
async function render() {
  if (score.kind === 'pages') return layOutPaper();
  return engrave();
}

// Paper: a container per page with a canvas in it, drawn to fit the screen the
// first time it is looked at and again whenever the screen changes shape.
// Nothing is scaled by CSS — every page is rendered at the device's own pixels,
// because a photograph of a page stretched by a browser is exactly the blurry
// mess this app tells people it isn't.
async function layOutPaper() {
  const payload = await loadScorePages(score.id);
  paper?.destroy?.();
  paper = await openPaper(payload);
  view = null;
  bars = new Map();
  sheet.replaceChildren();
  pageEls = [];
  for (let i = 0; i < paper.count; i++) {
    const node = document.createElement('div');
    node.className = 'osmd-page reader-paper';
    node.dataset.page = String(i);
    const canvas = document.createElement('canvas');
    node.append(canvas);
    const layer = document.createElement('div');
    layer.className = 'score-overlay';
    layer.setAttribute('aria-hidden', 'true');
    node.append(layer);
    sheet.append(node);
    pageEls.push(node);
  }
  await drawPaperPage(pageIndex);
  return null;
}

const drawn = new Set();

async function drawPaperPage(index) {
  const node = pageEls[index];
  if (!paper || !node || drawn.has(index)) return;
  const canvas = node.querySelector('canvas');
  await paper.draw(index, canvas, window.innerWidth / (spread ? 2 : 1), window.innerHeight);
  drawn.add(index);
  redraw(); // the ink layer measures the page it has just been given a size for
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
  pageEls = view.pages;
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
  // Notation needs its XML; paper needs nothing but the row, because its pages
  // live in a store of their own.
  if (!row || (row.kind !== 'pages' && !row.xml)) return null;
  build();
  score = row;
  take = analysed;
  strokes = await loadAnnotations(row.id).catch(() => []);
  history = [];
  redoable = [];
  layer = 0;
  hidden = new Set();
  picked = [];
  lasso = null;
  spread = wantsSpread();
  root.classList.toggle('spread', spread);
  painted = false;
  menuOpen = false;
  pageIndex = 0;
  tool = null;
  root.classList.remove('drawing');
  // Out of the way from the first moment. You opened a score to look at music,
  // and a glass bar over the top system is not music. The top strip brings it
  // back — and says so once, the first time, because a screen with nothing on
  // it teaches nobody anything.
  setChrome(false);
  zoom = 1;
  panX = 0;
  panY = 0;
  applyZoom();
  root.hidden = false;
  showFirstRunHint();
  document.documentElement.dataset.reading = 'yes';
  el('reader-title').textContent = row.name ?? '';
  try {
    drawn.clear();
    await render();
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
  paper?.destroy?.();
  paper = null;
  pageEls = [];
  drawn.clear();
  sheet.replaceChildren();
  score = null;
  take = null;
  strokes = [];
  bars = new Map();
}

const HINT_KEY = 'readerHinted';

function showFirstRunHint() {
  let seen = false;
  try { seen = globalThis.localStorage?.getItem(HINT_KEY) === 'yes'; } catch { /* private mode */ }
  if (seen) return;
  try { globalThis.localStorage?.setItem(HINT_KEY, 'yes'); } catch { /* survivable */ }
  // A line at the bottom, and NOT the bar itself: "show nothing until it is
  // asked for" is the whole point, and a bar that drops down uninvited to
  // explain that nothing drops down uninvited is a joke at the reader's
  // expense.
  const hint = document.createElement('div');
  hint.id = 'reader-hint';
  hint.textContent = 'Tap the top of the screen for the controls · left and right to turn pages';
  root.append(hint);
  setTimeout(() => hint.remove(), 4600);
}

export function readerIsOpen() {
  return !!root && !root.hidden;
}
