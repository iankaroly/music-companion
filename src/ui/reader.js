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
import { bandsOfPage } from './bands.js';
import { notesInOrder } from '../analysis/scan-read.js';
import { shapeFrom } from '../analysis/shape-snap.js';
import { pageTurn } from './pedal.js';
import { intonationTone } from './chart-utils.js';
import { actionMenu } from './controls.js';
import {
  loadAnnotations, saveAnnotations, loadScorePages, renameScore, deleteScore,
  saveBookmarks, saveLinks, saveScoreLayout,
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

// The signs a musician stamps on music. Written by hand these take a second and
// come out wobbly; on a screen they are a tap, and they are the marks that
// actually get made at a rehearsal — a flat somebody forgot to print, a bowing
// the section agreed on, a breath, a fermata, the coda you keep missing.
//
// Every one of them is a CHARACTER, drawn with the same code that writes a
// fingering on the page, which means a stamp can be rubbed out, picked up,
// recoloured and resized like any other mark rather than being a special kind
// of thing with its own half-working menu.
const STAMPS = [
  { glyph: '\u266F', label: 'sharp' },
  { glyph: '\u266D', label: 'flat' },
  { glyph: '\u266E', label: 'natural' },
  { glyph: '\u2293', label: 'down bow' },
  { glyph: 'V', label: 'up bow' },
  { glyph: '>', label: 'accent' },
  { glyph: '\u2022', label: 'staccato' },
  { glyph: '\u2013', label: 'tenuto' },
  { glyph: '\u{1D110}', label: 'fermata' },
  { glyph: ',', label: 'breath' },
  // Written out rather than set in the Musical Symbols block: a segno that
  // arrives as an empty box because the font on the device has no glyph for it
  // is worse than the two letters every player writes by hand anyway.
  { glyph: 'D.S.', label: 'dal segno' },
  { glyph: 'Coda', label: 'coda' },
  { glyph: 'tr', label: 'trill' },
  { glyph: 'pizz.', label: 'pizzicato' },
  { glyph: 'arco', label: 'arco' },
  { glyph: '8va', label: 'octave up' },
];
let stamp = STAMPS[0];

const PEN_WIDTH = 0.28;
const HIGHLIGHT_WIDTH = 1.6;
// Hair-thin at the bottom end, and meant to be: a fingering written between two
// ledger lines, a bracket over a beam, the sort of mark that used to come out
// four times too fat because the thinnest pen on offer was 0.08 of a staff
// space. On a phone that is now a third of a pixel, which the canvas draws as
// the faint hairline a sharp pencil actually makes.
const MIN_WIDTH = 0.015;
const MAX_WIDTH = 3;

// What the pen IS, not just what colour it is. A pencil that goes down grey and
// grainy, a ballpoint that goes down the same width however fast you move, a
// fountain pen that swells where the hand slows — the three things a musician
// has in the case, behaving the way they behave on paper.
const NIBS = [
  { id: 'pencil', label: 'Pencil' },
  { id: 'ballpoint', label: 'Ballpoint' },
  { id: 'fountain', label: 'Fountain' },
  { id: 'marker', label: 'Marker' },
];

// The sizes worth having as a tap. GoodNotes gets this right: nobody wants to
// aim at a slider for the pen they use forty times a session, they want the
// same four or five nibs where they left them.
const SIZE_DOTS = [0.03, 0.07, 0.14, 0.28, 0.55, 1];

// A full palette, because "any colour you want" is the ask and a mixer alone is
// not an answer — mixing is for the colour you cannot find here.
const PALETTE = [
  '#1c1b22', '#5b5768', '#9a94ab', '#ffffff',
  '#d81b3c', '#f0552b', '#f5a623', '#f7d64a',
  '#2fae62', '#0f9a8a', '#2f7fe8', '#3b4ff5',
  '#7b3ff2', '#c23bd6', '#e8558f', '#8a5a3c',
];

// One brush per tool, because a highlighter is not a pen with the settings
// changed — reaching for it should not mean re-mixing yellow every time.
const brushes = {
  pen: { h: 262, s: 12, l: 26, a: 1, width: PEN_WIDTH, overlay: false, nib: 'ballpoint' },
  highlighter: { h: 52, s: 95, l: 55, a: 0.35, width: HIGHLIGHT_WIDTH, overlay: true, nib: 'marker' },
};

function brushCss(brush) {
  return `hsla(${Math.round(brush.h)} ${Math.round(brush.s)}% ${Math.round(brush.l)}% / ${brush.a.toFixed(2)})`;
}

// --- colour, in the three shapes it has to take -------------------------------
//
// The brush thinks in HSL because that is what a mark is stored as. A picker
// thinks in HSV, because a saturation/brightness square IS an HSV plane. And a
// player thinks in hex, because that is the number they have written down.

function hslToHsv({ h, s, l }) {
  const v = l + (s / 100) * Math.min(l, 100 - l);
  return { h, s: v === 0 ? 0 : 200 * (1 - l / v), v };
}

function hsvToHsl({ h, s, v }) {
  const l = v * (1 - s / 200);
  const m = Math.min(l, 100 - l);
  return { h, s: m === 0 ? 0 : 100 * ((v - l) / m), l };
}

function hslToRgb({ h, s, l }) {
  const sat = s / 100;
  const light = l / 100;
  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = light - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [r, g, b].map((v) => Math.round((v + m) * 255));
}

function rgbToHsl(r, g, b) {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l: l * 100 };
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === rn ? 60 * (((gn - bn) / d + 6) % 6)
    : max === gn ? 60 * ((bn - rn) / d + 2)
      : 60 * ((rn - gn) / d + 4);
  return { h, s: s * 100, l: l * 100 };
}

function hexOf(brush) {
  return `#${hslToRgb(brush).map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

// Null unless it really is a colour, so a half-typed hex does not repaint the
// pen on every keystroke.
function hslFromHex(text) {
  const hex = String(text).trim().replace(/^#/, '');
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex;
  if (!/^[0-9a-f]{6}$/i.test(full)) return null;
  const n = parseInt(full, 16);
  return rgbToHsl((n >> 16) & 255, (n >> 8) & 255, n & 255);
}

function currentBrush() {
  return brushes[tool === 'highlighter' ? 'highlighter' : 'pen'];
}

let root = null;      // the whole reader
let sheet = null;     // where the engraving is mounted
let ink = null;       // the canvas the marks are drawn on
let view = null;      // the engraved score, when the score IS notation
let paper = null;     // the pages, when the score is paper
let layout = null;    // what was read off those pages: staves, bars, noteheads
let slices = [];      // what the reader shows as pages: bands of a scanned page
let setlist = null;   // the programme this piece is being played in, if any
let moveSet = null;   // ask the app to open the neighbouring piece
let pendingLink = null; // a link being taped down: where it starts
let pageEls = [];     // whichever kind, the elements one page each
let score = null;     // { id, name, xml, partIndex }
let take = null;      // the analysed take on screen, if there is one
let unfollow = null;  // stop listening to the playhead
let sounding = null;  // the notehead lit right now
let strokes = [];     // every mark on this piece
let pageIndex = 0;
let tool = null;      // null = reading; 'pen' | 'highlighter' | 'eraser'
// The last thing you were writing WITH.
//
// Putting the bar away was putting the pen down: it came back holding a plain
// pen every single time, so a session spent marking fingerings in the
// highlighter meant reaching for the highlighter again after every phrase you
// played. What you last wrote with is what you meant to go on writing with —
// the bar closing is you looking at the music, not you changing your mind about
// the pen.
let lastInk = 'pen';
// The tools this remembers. The eraser is deliberately not one of them: coming
// back to a score holding a rubber is how you rub out the phrase you meant to
// annotate, and nobody ever means "carry on erasing" after a page turn.
const INKS = ['pen', 'highlighter', 'text', 'lasso', 'line', 'arrow', 'rect', 'ellipse', 'stamp'];
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
  dropDryInk();   // the marks changed; the picture of them is out of date
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

// Which pages are on screen — or would be, if the reader were showing the page
// given. A turn asks the second question before it commits to the first: the
// pages have to be drawn before they are shown, and that means knowing which
// ones they will be.
function visiblePages(at = pageIndex) {
  const shown = [at];
  if (spread && at + 1 < pageEls.length) shown.push(at + 1);
  return shown;
}

// The rectangle a page's marks belong to, in SCREEN coordinates. For engraved
// music that is the page container; for paper it is the drawn page inside it,
// which is centred with margins either side.
function boxOfPage(index) {
  if (boxCache.has(index)) return boxCache.get(index);
  const box = measurePageBox(index);
  boxCache.set(index, box);
  return box;
}

function measurePageBox(index) {
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
// --- geometry, measured once a frame rather than once a point -----------------
//
// Everything drawn on the page is placed by asking a BAR where it is, and a bar
// answers by measuring five staff lines with getBoundingClientRect. Each of
// those is a forced layout — the browser stops and re-computes the page before
// it will give you a number — and the reader was asking for one per staff line,
// per point, per stroke, on every frame of a pen stroke. A page carrying thirty
// marks of forty points each came to twelve thousand forced layouts between one
// movement of the hand and the next. That is the whole of "the pen lags", "the
// page turn hangs", and most of "it feels slow".
//
// Nothing about the page moves while you are writing on it, so the answers are
// worth keeping. They are thrown away wholesale whenever something that CAN
// move them happens — a turn, a pinch, a re-engraving, a rotation — and, as a
// belt to that brace, at the start of every frame painted while the hand is NOT
// on the glass. So the cache is only ever trusted across the one interval where
// it cannot go stale: the middle of a stroke.
const frameCache = new Map();
const boxCache = new Map();
let unitCache = null;

function invalidateGeometry() {
  frameCache.clear();
  boxCache.clear();
  unitCache = null;
}

function barFrame(bar) {
  if (frameCache.has(bar)) return frameCache.get(bar);
  const frame = measureBar(bar);
  frameCache.set(bar, frame);
  return frame;
}

function measureBar(bar) {
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
  if (unitCache === null) unitCache = measureUnit();
  return unitCache;
}

function measureUnit() {
  if (isPaper()) {
    const box = pageBox();
    // The box is a BAND of the page, not the page: divide it back out, or a pen
    // drawn on a page split in two comes back twice as thick on a page shown
    // whole.
    const band = slices[pageIndex]?.rect?.h ?? 1;
    return Math.max(1, (box?.height ?? 600) / band / 60);
  }
  const shown = visiblePages();
  for (const [bar, entry] of bars) {
    if (!shown.includes(entry.page)) continue;
    const frame = barFrame(bar);
    if (frame) return frame.unit;
  }
  return 10;
}

// On paper, a mark is held against the PAGE: a fraction across and down the
// photograph, margins trimmed. There is nothing else to hold it against, and
// nothing else is needed — a scan does not re-flow. The same picture is shown
// at every size, so a mark on the second beat of bar 12 is on the second beat
// of bar 12 whatever the screen does with the paper afterwards.
//
// The screen may be showing only part of that page. Everything below goes
// through one mapping, so the ink and the analysis rings cannot drift apart.
function anchorOnPaper(px, py) {
  const index = pageAt(px, py);
  const slice = slices[index];
  const box = boxOfPage(index);
  if (!slice || !box || !box.width || !box.height) return null;
  const { rect } = slice;
  return {
    space: 'page',
    p: slice.page,
    x: rect.x + ((px - box.left) / box.width) * rect.w,
    y: rect.y + ((py - box.top) / box.height) * rect.h,
  };
}

// A place on the paper → where it is on the screen, or null when that part of
// the page is not being shown.
function pageToScreen(p, x, y) {
  for (const index of visiblePages()) {
    const slice = slices[index];
    const box = boxOfPage(index);
    if (!slice || !box || slice.page !== p) continue;
    const { rect } = slice;
    // A whisker of tolerance: a fingering written just above the top system of
    // a band belongs to that band, not to nothing.
    const air = rect.h * 0.04;
    if (y < rect.y - air || y > rect.y + rect.h + air) continue;
    return {
      x: box.left + ((x - rect.x) / rect.w) * box.width,
      y: box.top + ((y - rect.y) / rect.h) * box.height,
      unit: box.height / rect.h,      // pixels per whole page height
    };
  }
  return null;
}

function placeOnPaper(point) {
  return pageToScreen(point.p, point.x, point.y);
}

// Marks made while scans were re-cut into screenfuls were held against the
// SYSTEM they were drawn over. The same numbers give the same place on the
// paper, so they are converted once as the score opens and written back in the
// new form — rather than disappearing, which is what an unrecognised anchor
// does: silently, and to work somebody actually did.
function onPaperNow(point) {
  if (point.space !== 'system') return point;
  return {
    space: 'page',
    p: point.p,
    x: point.x,
    y: point.top + (point.v ?? 0) * (point.bottom - point.top),
  };
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
  if (point.p !== undefined) return placeOnPaper(point);
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

// `at` and `scale` are how a point becomes a pixel. On screen that is the page
// being read; on an export it is the page being written into a file. Same ink,
// same code, so what you send is what you saw.
function drawStroke(ctx, stroke, { at = place, scale = unitScale() } = {}) {
  // The pressure travels with the point. `at` only knows about where a mark is,
  // and how hard it was pressed is the other half of what a nib needs.
  const points = stroke.points.map((point) => {
    const spot = at(point);
    if (spot && point.w !== undefined) spot.w = point.w;
    return spot;
  });
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = strokeColour(stroke);
  ctx.fillStyle = strokeColour(stroke);
  // A highlighter goes UNDER the notes rather than over them: multiply keeps
  // the black of the engraving showing through a wash of colour, which is what
  // a real one does to paper.
  if (stroke.overlay ?? stroke.tool === 'highlighter') ctx.globalCompositeOperation = 'multiply';
  // A floor well under a pixel, because the thinnest pen is meant to be a
  // hairline: the canvas draws a 0.4px line as a faint one, which is exactly
  // what a sharp pencil does to paper.
  ctx.lineWidth = Math.max(0.35, stroke.width * scale);

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
    point.p !== undefined ? `paper:${point.p}` : bars.get(point.m)?.system ?? null
  ));
  // The runs of points the pen never left the paper for.
  const runs = [];
  let run = [];
  for (const [i, point] of points.entries()) {
    if (!point || (i > 0 && systems[i] !== systems[i - 1])) {
      if (run.length) runs.push(run);
      run = [];
    }
    if (point) run.push(point);
  }
  if (run.length) runs.push(run);
  for (const line of runs) inkRun(ctx, line, stroke, ctx.lineWidth);
  ctx.restore();
}

// --- what each nib does to a line ---------------------------------------------
//
// The same run of points, laid down four ways. None of it is simulation for its
// own sake: a pencil that goes down as a flat opaque cable does not read as a
// pencil, and "which pen is this" should be answerable by looking at the mark.

// Jitter that is the SAME every frame. A pencil's grain has to be part of the
// mark, not an animation: seeded off the position, it stays where it was drawn
// through every redraw, zoom and export.
function grain(x, y, salt) {
  const n = Math.sin(x * 12.9898 + y * 78.233 + salt * 43.758) * 43758.5453;
  return (n - Math.floor(n)) - 0.5;
}

function polyline(ctx, points) {
  ctx.beginPath();
  points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.stroke();
}

function inkRun(ctx, points, stroke, width) {
  const nib = stroke.nib ?? (stroke.tool === 'highlighter' ? 'marker' : 'ballpoint');
  if (points.length === 1) {
    // A tap is a dot, whichever pen made it.
    ctx.beginPath();
    ctx.arc(points[0].x, points[0].y, width / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  if (nib === 'fountain') {
    // Width from speed, and from the hand: the hand slows into a turn and the
    // line swells there, which is most of what makes handwriting look written
    // rather than plotted — and where a real pencil was pressing is known
    // outright, so a stroke made with one is drawn from that instead of
    // guessed at.
    let carried = width;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const b = points[i];
      const gone = Math.hypot(b.x - a.x, b.y - a.y);
      const want = width * (b.w !== undefined
        ? Math.max(0.35, Math.min(1.5, 0.45 + b.w * 1.3))
        : Math.max(0.35, Math.min(1.5, 1.5 - gone / 26)));
      carried += (want - carried) * 0.35;   // no sudden steps between segments
      ctx.lineWidth = carried;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.lineWidth = width;
    return;
  }
  if (nib === 'pencil') {
    // Graphite: a soft core with a scattering of grain either side of it, and
    // never quite opaque, so what is underneath still shows through.
    const alpha = ctx.globalAlpha;
    ctx.lineWidth = width;
    // A pencil pressed harder is a darker pencil. Where the hand's pressure was
    // recorded the core is laid down segment by segment at the darkness each
    // one was drawn with, which is how a written 3 comes out with a light lead
    // in and a firm downstroke instead of one flat grey cable.
    if (points.some((p) => p.w !== undefined)) {
      for (let i = 1; i < points.length; i++) {
        const force = points[i].w ?? points[i - 1].w ?? 0.5;
        ctx.globalAlpha = alpha * Math.max(0.18, Math.min(0.75, 0.2 + force * 0.7));
        ctx.beginPath();
        ctx.moveTo(points[i - 1].x, points[i - 1].y);
        ctx.lineTo(points[i].x, points[i].y);
        ctx.stroke();
      }
    } else {
      ctx.globalAlpha = alpha * 0.55;
      polyline(ctx, points);
    }
    ctx.globalAlpha = alpha * 0.3;
    ctx.lineWidth = Math.max(0.3, width * 0.55);
    for (const side of [-1, 1]) {
      const shifted = points.map((p, i) => {
        const next = points[Math.min(i + 1, points.length - 1)];
        const prev = points[Math.max(i - 1, 0)];
        const dx = next.x - prev.x;
        const dy = next.y - prev.y;
        const len = Math.hypot(dx, dy) || 1;
        const off = width * (0.35 + 0.3 * grain(p.x, p.y, side));
        return { x: p.x + (-dy / len) * off * side, y: p.y + (dx / len) * off * side };
      });
      polyline(ctx, shifted);
    }
    ctx.globalAlpha = alpha;
    ctx.lineWidth = width;
    return;
  }
  if (nib === 'marker') {
    // A flat tip: square ends, no swell, and one pass so the overlaps inside a
    // single stroke do not darken it the way two passes of a wash would.
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'round';
    polyline(ctx, points);
    ctx.lineCap = 'round';
    return;
  }
  // Ballpoint: the same width all the way along, and dense.
  polyline(ctx, points);
}

// The ink layer is the whole screen, and the drawing is moved onto the page.
//
// It used to be a canvas the size of the page, moved to sit on top of it. That
// stops working the moment the page can be zoomed: a page at four times the
// size is a canvas four times the size, most of it off-screen, all of it in
// memory. One screen-sized canvas with the origin shifted to the page's corner
// draws the same picture and costs the same however far in you go.
// Asked for as often as you like, done once a frame.
//
// A pen stroke arrives as a shower of pointermove events — on an iPad, well
// over one every frame — and each of them used to repaint the entire page of
// ink synchronously, inside the event handler. The browser cannot show any of
// those paints but the last one, so all the work between them was thrown away,
// and the handler was still running when the next event wanted to be delivered:
// the events queue up behind the painting and the line falls further and
// further behind the nib.
//
// So a redraw is now a REQUEST. Ask twenty times between two frames and the
// page is painted once, at the moment the screen is actually going to show it.
let painting = 0;

function redraw() {
  if (painting) return;
  painting = requestAnimationFrame(() => {
    painting = 0;
    paintInk();
  });
}

// The same thing, but now, for the few places that need the ink on screen
// before they go on — an export, a page that has just been swapped underneath.
function redrawNow() {
  if (painting) { cancelAnimationFrame(painting); painting = 0; }
  paintInk();
}

// --- dry ink and wet ink ------------------------------------------------------
//
// The marks already on the page are not going to change while you draw the next
// one, and re-drawing them sixty times a second to find that out is most of
// what a frame was spent on: every committed stroke re-placed against its bar,
// re-broken at its system, and re-rasterised with whatever nib it was made
// with — a pencil being four passes of that — so that a single wet line can be
// laid on top.
//
// So the page of finished marks is painted ONCE, onto a canvas of its own, and
// each frame copies it across in a single blit before drawing the one stroke
// that is actually moving. It is what every drawing app does, and it is the
// difference between a frame that costs a page of ink and a frame that costs
// one line.
//
// The dry layer is thrown away by anything that could change what is on it:
// another mark finished, one rubbed out, an undo, a layer hidden, a page
// turned, a pinch. Which is the same list the geometry cache keeps, plus the
// marks themselves — so it hangs off that.
let dry = null;          // an offscreen canvas holding the finished marks
let dryKey = null;       // what it is a picture OF

// Everything about the page that would make the dry layer wrong.
function dryStamp(scale, shown) {
  return `${strokes.length}|${scale}|${shown.join(',')}|${[...hidden].join(',')}`
    + `|${zoom}|${panX}|${panY}|${painted ? 1 : 0}|${take ? 1 : 0}|${linksOf().length}`;
}

// The stamp catches a page that has changed shape or gained a mark. It cannot
// catch a mark that was MOVED, recoloured, or swapped back by an undo — the
// list is the same length and the page is the same page. Every one of those
// goes through scheduleSave, so that is where this is said, once, rather than
// at a dozen call sites one of which would eventually be missed.
function dropDryInk() {
  dryKey = null;
}

function paintInk() {
  // Measurements are only trusted through the middle of a stroke, where the
  // page is guaranteed to be still. Any other frame re-measures.
  if (drawingPointer === null) invalidateGeometry();
  if (!ink || !pageBox()) return;
  const dpr = window.devicePixelRatio || 1;
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (ink.width !== Math.round(w * dpr) || ink.height !== Math.round(h * dpr)) {
    ink.width = Math.round(w * dpr);
    ink.height = Math.round(h * dpr);
    dropDryInk();     // a canvas that has just been resized has been emptied
  }
  ink.style.width = `${w}px`;
  ink.style.height = `${h}px`;
  ink.style.left = '0px';
  ink.style.top = '0px';
  const ctx = ink.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  // Measured once for the whole page rather than re-derived per mark: it is the
  // same length for every stroke on screen, and working it out means walking
  // the bars.
  const scale = unitScale();
  const shown = visiblePages();

  const stamp = dryStamp(scale, shown);
  if (dryKey !== stamp || !dry || dry.width !== ink.width || dry.height !== ink.height) {
    if (!dry) dry = document.createElement('canvas');
    if (dry.width !== ink.width || dry.height !== ink.height) {
      dry.width = ink.width;
      dry.height = ink.height;
    }
    const dctx = dry.getContext('2d');
    dctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    dctx.clearRect(0, 0, w, h);
    for (const stroke of strokes) {
      if (hidden.has(stroke.layer ?? 0)) continue;
      // A part is one list of marks from the first bar to the last, and all but
      // the handful on the page in front of you are somewhere else. Asking each
      // of the others where it is — bar by bar, point by point — only to find
      // out it is not here is the cost of a whole score.
      if (!touchesScreen(stroke, shown)) continue;
      drawStroke(dctx, stroke, { scale });
    }
    if (painted) drawScanMarks(dctx);
    drawLinks(dctx);
    dryKey = stamp;
  }
  // One copy of everything that was already there…
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(dry, 0, 0);
  ctx.restore();
  // …and then the only thing that is moving.
  if (drawing) drawStroke(ctx, drawing, { scale });
  drawLasso(ctx);
}

// Rubbing out: a stroke goes if the eraser passes within a finger's width of it.
function eraseAt(px, py) {
  const scale = unitScale();
  const reach = 3.2 * scale;
  const shown = visiblePages();
  const gone = [];
  strokes = strokes.filter((stroke) => {
    if (hidden.has(stroke.layer ?? 0)) return true;  // out of sight, out of reach
    if (!touchesScreen(stroke, shown)) return true;  // nor is a mark on another page
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

// --- draw it, then hold: the shape you meant ----------------------------------
//
// Hold the pen still at the end of a stroke and the scrawl becomes the thing it
// was trying to be: a straight line, a box round a bar, a ring round an
// accidental, a triangle, a shape with corners. It is how GoodNotes does it and
// it is the right way round — you draw first and ask for tidiness afterwards,
// rather than choosing a shape tool before you know you want one.
//
// Nothing is guessed about intent: the snap only happens while the pen is DOWN
// and STILL, so a stroke that is finished and lifted is never touched.

const HOLD_MS = 550;        // how long still counts as "hold"
const HOLD_STIR = 4;        // px of wobble allowed while holding — a hand is a hand
const CHANGED_MIND = 34;    // px of travel after a snap that means "no, keep mine"

let holdTimer = null;
let holdFrom = null;        // where the pen was when the hold clock started

function stopHold() {
  clearTimeout(holdTimer);
  holdTimer = null;
  holdFrom = null;
}

// The clock restarts every time the pen moves, so only the END of a stroke can
// trigger it.
function watchForHold(at) {
  if (!drawing || drawing.snapped) return;
  if (holdFrom && Math.hypot(at.x - holdFrom.x, at.y - holdFrom.y) < HOLD_STIR) return;
  clearTimeout(holdTimer);
  holdFrom = at;
  holdTimer = setTimeout(snapDrawing, HOLD_MS);
}

// The moment the hold pays off: the scrawl on screen is replaced, in place, by
// the shape it was drawing. Anchored back onto the music the same way every
// other mark is, so it re-flows with the page like anything else.
function snapDrawing() {
  holdTimer = null;
  if (!drawing || drawing.snapped || drawing.type === 'shape') return;
  const screen = drawing.points.map(place).filter(Boolean);
  if (screen.length !== drawing.points.length) return;   // half of it is off-page
  const shaped = shapeFrom(screen);
  if (!shaped) return;
  // Every point of the ideal has to find somewhere on the music to live. Half
  // an ellipse anchored and half of it dropped is not a tidier version of what
  // was drawn — it is a shape with a chord cut across it.
  const anchored = shaped.map((p) => anchor(p.x, p.y)).filter(Boolean);
  if (anchored.length !== shaped.length) return;
  // The scrawl is kept until the pen lifts. Carrying on drawing is somebody
  // saying they did not want the shape, and they should get their own line
  // back rather than have to undo and write it again.
  drawing.freehand = drawing.points;
  drawing.points = anchored;
  drawing.snapped = true;
  // A hold that has done its work should feel like it did.
  navigator.vibrate?.(8);
  redraw();
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
  nibPressure(point, e);
  lastInkAt = at;
  if (tool === 'text') { writeText(point); return; }
  if (tool === 'stamp') { placeStamp(point); return; }
  const brush = currentBrush();
  drawing = {
    tool,
    layer,
    colour: brushCss(brush),
    width: brush.width,
    overlay: brush.overlay,
    // The pen it was written with, kept on the mark: a pencil note stays a
    // pencil note after you have picked up the highlighter.
    nib: brush.nib,
    points: [point],
  };
  // A shape is two points: where the finger went down and where it is now. The
  // second is replaced on every move rather than added to, which is what makes
  // it stretch instead of scribble.
  if (SHAPES.includes(tool)) {
    drawing.type = 'shape';
    drawing.shape = tool;
    drawing.points.push(point);
  } else {
    // Freehand only: the shape tools are already shapes, and the hold is for
    // the pen and the highlighter.
    stopHold();
    watchForHold(at);
  }
}

function extendStroke(e, { quiet = false } = {}) {
  const at = pointerPosition(e);
  if (!at) return;
  // Said before the tools branch, so the eraser gets it too. A sweep of the
  // rubber tests every mark on the page against the point it is over; running
  // that four times for four samples of one place is four times the work for
  // the same marks removed.
  const stirred = !lastInkAt || Math.hypot(at.x - lastInkAt.x, at.y - lastInkAt.y) >= INK_STEP;
  if (tool === 'eraser') {
    if (stirred) { lastInkAt = at; eraseAt(at.x, at.y); }
    return;
  }
  if (tool === 'lasso') {
    if (dragging) {
      moveSelection(at.x - dragging.x, at.y - dragging.y);
      dragging = at;
    } else if (lasso) {
      lasso.push(at);
    }
    if (!quiet) redraw();
    return;
  }
  if (!drawing) return;
  // Once it has snapped, the mark is the shape: the wobble of a hand that has
  // not lifted yet must not scribble over it. Moving off properly is another
  // matter — that is somebody carrying on drawing, and they get their own line
  // back, exactly as they drew it.
  if (drawing.snapped) {
    if (!holdFrom || Math.hypot(at.x - holdFrom.x, at.y - holdFrom.y) < CHANGED_MIND) return;
    drawing.points = drawing.freehand;
    delete drawing.freehand;
    delete drawing.snapped;
    watchForHold(at);
  }
  // Samples the hand did not make.
  //
  // Asking for the coalesced events is what got the whole gesture instead of a
  // quarter of it, but a pencil sampled at 240Hz reports where it is whether or
  // not it has gone anywhere: hold it still for a second at the end of a
  // fingering and that is two hundred and forty points describing one spot.
  // They are stored, they are re-anchored, and they are re-drawn on every
  // frame for as long as the mark exists.
  //
  // A third of a pixel apart is not a different place — no screen can show the
  // difference and no hand meant one — so a sample that has not moved sensibly
  // since the last one is dropped. Not simplification: nothing that was drawn
  // is lost, only positions the device repeated. The shape tools are exempt,
  // because their second point IS the live corner and replacing it is the whole
  // gesture.
  if (drawing.type !== 'shape' && !stirred) { watchForHold(at); return; }
  const point = anchor(at.x, at.y);
  if (point) nibPressure(point, e);
  if (point && drawing.type === 'shape') drawing.points[1] = point;
  else if (point) { drawing.points.push(point); lastInkAt = at; }
  if (drawing.type !== 'shape') watchForHold(at);
  if (!quiet) redraw();
}

// How far the pen has to travel before it counts as somewhere else. A third of
// a pixel: below what any screen can draw, above what a still hand reports.
const INK_STEP = 0.34;
let lastInkAt = null;

// How hard the pencil was pressing, kept on the point that was made.
//
// Only ever recorded for a real pen. A finger and a mouse report a flat 0.5 or
// a flat 1 depending on the browser, and a line that swells to a number the
// device invented is worse than a line of one width honestly drawn — so a
// stroke made with anything but a pencil carries no pressure at all, and the
// nibs fall back to the shape they had before.
function nibPressure(point, e) {
  if (e.pointerType !== 'pen') return;
  const force = e.pressure;
  if (!Number.isFinite(force) || force <= 0) return;
  point.w = Math.round(Math.min(1, force) * 100) / 100;
}

// A stroke that turned out to be the start of a pinch is not a stroke.
function cancelStroke() {
  stopHold();
  lastInkAt = null;
  drawing = null;
  // A lasso is a gesture too, and pinching in the middle of one used to leave
  // it half-drawn: the loop stayed on screen with nothing able to finish it,
  // because every path back through the ink layer is gated on a pointer that
  // has been given up. A drag is worse — moveSelection has already moved the
  // marks, in place, and only endStroke would ever have written that down, so
  // an interrupted drag left the ink somewhere it would not be tomorrow.
  if (dragging) scheduleSave();
  dragging = null;
  lasso = null;
  erasing = false;
  // What was PICKED stays picked. Pinching in to look closer at a selection is
  // a reasonable thing to do to one, and losing it for that would be its own
  // small betrayal.
  redraw();
}

// The tools a tap should put DOWN rather than use.
//
// Text and the stamps ARE tapped — that is how they are placed — and a tap with
// the eraser is a rub in one spot, and with the lasso it is how a selection is
// put down. For the rest, a tap has never done anything at all: a stroke of one
// point was already thrown away as "that was a tap, not a drag". So nothing is
// taken away by giving the gesture a job.
const TAP_PUTS_DOWN = ['pen', 'highlighter', ...SHAPES];

function endStroke() {
  stopHold();
  lastInkAt = null;
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
    // The scrawl behind a snapped shape is scaffolding, not part of the mark.
    delete drawing.freehand;
    delete drawing.snapped;
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
let pinch = null;         // { distance, x, y } at the moment the second finger landed
let pinching = false;     // a pinch is in progress, or has only just ended
let drawingPointer = null;
// How many marks were on the page when this gesture started. A gesture that
// added one was WRITING, however small it was — see onTap.
let marksAtDown = 0;

function applyZoom() {
  if (!sheet) return;
  sheet.style.transformOrigin = '50% 50%';
  sheet.style.transform = zoom === 1 && !panX && !panY
    ? ''
    : `translate(${panX}px, ${panY}px) scale(${zoom})`;
  const reset = el('reader-reset-zoom');
  if (reset) reset.hidden = zoom === 1;
  // The page just moved under the ink: nothing measured before this is true of
  // it any more. Said here rather than left to the next paint, because a pen
  // that lands between the pinch and the frame would otherwise anchor its first
  // point against where the music used to be.
  invalidateGeometry();
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
    const slice = slices[pageIndex];
    if (!canvas || !slice) return;
    try {
      await paper.drawBand(slice.page, canvas, slice.rect,
        window.innerWidth * zoom, window.innerHeight * zoom);
    } catch {
      return;   // the page on screen is the page that was already there
    }
    // Drawn big, shown at the page's own size: the transform does the rest.
    //
    // Taken from the size drawBand SAID the band is, not worked back out of the
    // canvas's pixel count. Those two used to be the same number; they are not
    // any more, because a canvas too big for the device is now given fewer
    // pixels in the same space, and dividing that down again would draw the page
    // at a fraction of its size on every zoom that hit the ceiling.
    const shownW = parseFloat(canvas.style.width);
    const shownH = parseFloat(canvas.style.height);
    if (!(shownW > 0) || !(shownH > 0)) return;
    canvas.style.width = `${Math.round(shownW / zoom)}px`;
    canvas.style.height = `${Math.round(shownH / zoom)}px`;
    redraw();
  }, 220);
}

// --- the pencil ---------------------------------------------------------------
//
// An Apple Pencil is not a finger and must never be treated as one.
//
// Two things follow from that, and both are what makes a reader feel like it
// was written for the iPad rather than ported onto it.
//
// Touching the page with the pencil IS reaching for the pen. Nobody puts a
// pencil on paper meaning to turn the page. So the pen you last wrote with is
// picked back up, the bar of tools comes down, and the stroke starts from that
// same touch — not the next one, or the first mark of every annotation is the
// one that got away.
//
// And while the pencil is on the glass, the hand holding it is on the glass
// too. A palm is a touch pointer, and a reader that counts pointers sees a
// second one land and decides you are pinching: the line stops dead halfway
// through a fingering. So touches are simply not admitted while the pencil is
// down. They start no pinch, they end no stroke, they are not there.
let penPointer = null;
// The gesture that picked the pen up must not also be the gesture that puts it
// down again — see onTap, which normally reads a tap that made no mark as "I
// have finished writing".
let armedByPen = false;

function penIsDown() {
  return penPointer !== null;
}

// The pencil has landed on the music with no tool in hand.
function armPencil(e) {
  if (!root || root.hidden || menuOpen) return false;
  // Not on the chrome: a pencil is a perfectly good way to press a button.
  if (e.target?.closest?.('#reader-top, #reader-ink-bar, #reader-menu, #reader-brush,'
    + ' #reader-selection, #reader-land, .pick-pop, dialog')) return false;
  // Nor over a jump you taped down, or the one you are in the middle of taping.
  if (pendingLink) return false;
  setTool(lastInk);
  armedByPen = true;
  if (!tool) return false;
  // The tools that place a thing where you tap — a fingering, a stamp — are
  // armed and left to the NEXT touch. Opening a keyboard because a pencil
  // brushed the page is not picking a pen up, it is an accident.
  if (tool === 'text' || tool === 'stamp') return true;
  // Capture is what routes the rest of this stroke to the ink layer, which the
  // pen has only just been given the right to touch — but a pointer that has
  // already been released, or captured elsewhere, makes it throw, and a throw
  // here would take the whole stroke down with it. The mark is worth more than
  // the routing: without capture the moves still arrive, they just stop if the
  // pen leaves the canvas.
  try { ink.setPointerCapture(e.pointerId); } catch { /* the stroke goes on */ }
  drawingPointer = e.pointerId;
  marksAtDown = strokes.length;
  beginStroke(e);
  return true;
}

function trackPointers(root) {
  root.addEventListener('pointerdown', (e) => {
    armedByPen = false;
    if (e.pointerType === 'pen') {
      penPointer = e.pointerId;
      // A hand that was already resting on the screen when the pencil arrived
      // is the same hand, and it must not be sitting in the map looking like
      // the first finger of a pinch.
      for (const [id, spot] of [...pointers]) if (spot.touch) pointers.delete(id);
      pinch = null;
      pinching = false;
      if (!tool && armPencil(e)) return;
    } else if (penIsDown() && e.pointerType === 'touch') {
      return;   // the palm
    }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, touch: e.pointerType === 'touch' });
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
      pinching = true;
      drawingPointer = null;
      cancelStroke();   // the first finger was drawing; it was not, it was pinching
    }
  }, true);
  root.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, touch: e.pointerType === 'touch' });
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
      if (e.pointerId === penPointer) penPointer = null;
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      if (pointers.size === 0) {
        // Both fingers off: only now may the pen be believed again.
        pinching = false;
        if (isPaper() && zoom > 1) redrawPaperAtZoom();
      }
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

// A sign, dropped where the finger went down. Sized like the music rather than
// like the screen — a flat is about two staff spaces tall on paper, so that is
// what it is here.
function placeStamp(point) {
  const brush = currentBrush();
  const mark = {
    type: 'text',
    tool: 'stamp',
    layer,
    text: stamp.glyph,
    size: Math.max(1.4, brush.width * 6),
    colour: brushCss({ ...brush, a: 1 }),
    points: [point],
  };
  strokes.push(mark);
  remember({ type: 'add', stroke: mark });
  scheduleSave();
  redraw();
}

function openStampMenu() {
  actionMenu(el('reader-stamps'), STAMPS.map((sign) => ({
    label: `${sign.glyph}   ${sign.label}`,
    onPick: () => {
      stamp = sign;
      const button = el('reader-stamps');
      if (button) button.textContent = sign.glyph;
      if (tool !== 'stamp') setTool('stamp');
      else refreshBrushUI();
    },
  })));
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
        const index = visiblePages().find((i) => slices[i]?.page === point.p);
        const box = boxOfPage(index);
        const rect = slices[index]?.rect;
        if (!box || !rect) continue;
        point.x += (dx / box.width) * rect.w;
        point.y += (dy / box.height) * rect.h;
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

// How long the page you are ON stays up while the next one is being drawn.
//
// A page is REVEALED before it has been drawn, or it is not revealed at all:
// showing an empty canvas is showing a black rectangle, which is the flash on
// every turn that had outrun its own rendering. Waiting is only ever better
// than that — the music you are still reading stays on screen — but not
// forever, so a page that is taking an unreasonable time is shown blank rather
// than leaving the turn stuck.
// Shorter than it was, and deliberately. Twelve hundred milliseconds is over a
// second of a screen that does not answer, which does not read as "drawing" —
// it reads as "broken", and a player who taps again gets the page after the one
// they wanted. Under half a second covers every page this renderer draws in
// practice; past that, whatever there is goes up, and the picture arrives when
// it arrives.
const HOLD_PAGE = 450;

// Which pages are worth keeping drawn, either side of the one being read. Every
// drawn page is a screenful of pixels: on a tablet, twenty of them left lying
// about is how a long part turns into a renderer that gives up.
//
// Split by direction, because reading is not symmetric. You go forwards through
// a part all evening and backwards twice; spending the same budget both ways
// means half of it is kept for pages nobody is going to ask for, and the pages
// they ARE going to ask for run out two turns into a fast movement. Three ahead
// and one behind is the same amount of memory, pointed where the music is
// going.
const KEEP_AHEAD = 3;
const KEEP_BEHIND = 1;

let turnToken = 0;
// Which way the last turn went, so the look-ahead knows which way to look.
let turnWay = 1;
// Where the reader is HEADING, as opposed to what it is showing.
//
// A turn on paper waits for the next page to be drawn, and a tap that lands
// during that wait used to be computed from the page still on screen: two quick
// taps at the edge advanced one page, because the second one asked for "the
// page after the one I can see" — which was the page the first tap had already
// gone to fetch. Three taps advanced one page. That is the whole of "sometimes
// it doesn't register". Turns are counted from where the reader is going.
let wantedPage = 0;

async function showPage(index) {
  if (!pageEls.length) return;
  const next = Math.max(0, Math.min(pageEls.length - 1, index));
  if (next !== wantedPage) turnWay = next > wantedPage ? 1 : -1;
  wantedPage = next;
  const shownNext = visiblePages(next);
  // Drawn BEFORE anything on screen changes. A turn that has to wait shows the
  // page you were reading for a moment longer, which is the right thing to
  // look at while waiting.
  if (isPaper()) {
    const token = ++turnToken;
    const ready = Promise.all(shownNext.map((i) => drawPaperPage(i).catch(() => {})));
    await Promise.race([ready, new Promise((resolve) => { setTimeout(resolve, HOLD_PAGE); })]);
    // Somebody tapped again while this page was being drawn: that turn is the
    // one that matters, and this one must not undo it.
    if (token !== turnToken) return;
  }
  const moved = next !== pageIndex;
  pageIndex = next;
  // A new page is a new page: it arrives whole, not at whatever corner you had
  // magnified on the last one.
  if (moved && zoom !== 1) { zoom = 1; panX = 0; panY = 0; applyZoom(); }
  const shown = visiblePages();
  for (const [i, node] of pageEls.entries()) {
    const wantHidden = !shown.includes(i);
    const side = shown.length > 1 && shown.includes(i) ? (i === shown[0] ? 'left' : 'right') : '';
    // Only the pages whose state actually changes are written to. A twenty-one
    // page part was having every one of its containers assigned a hidden flag,
    // a data attribute and four inline styles on every turn — eighty-odd writes
    // to say that nineteen pages are still exactly where they were, each one a
    // reason for the browser to think about the layout again.
    if (node.hidden === wantHidden && node.dataset.side === side) continue;
    node.hidden = wantHidden;
    node.dataset.side = side;
    // Laid out from here rather than from the stylesheet: the engraver puts
    // `position: relative` inline on every page container it makes, and an
    // inline style beats any rule you can write about it.
    if (side) {
      node.style.position = 'absolute';
      node.style.top = '0';
      // An engraved page container is already half the screen wide (the
      // stylesheet says so, because the engraver was asked for a half-width
      // page); a photographed one is not, so it is halved here.
      node.style.width = isPaper() ? '50%' : '100%';
      node.style.left = side === 'left' ? '0' : (isPaper() ? '50%' : '100%');
    } else {
      node.style.position = '';
      node.style.top = '';
      node.style.left = '';
      node.style.width = '';
    }
  }
  const count = el('reader-count');
  if (count) count.textContent = `p. ${pageIndex + 1} of ${pageEls.length}`;
  invalidateGeometry();     // different music, in different places
  redraw();
  if (isPaper()) keepNeighboursReady(shown);
}

// The pages either side, drawn while nobody is waiting, and the ones far behind
// thrown away. Both halves matter: the first is what makes a turn instant, and
// the second is what stops a twenty-one page part holding twenty-one screenfuls
// of pixels at once.
function keepNeighboursReady(shown) {
  const first = shown[0];
  const last = shown.at(-1);
  const ahead = turnWay >= 0 ? KEEP_AHEAD : KEEP_BEHIND;
  const behind = turnWay >= 0 ? KEEP_BEHIND : KEEP_AHEAD;
  const near = (i) => i >= first - behind && i <= last + ahead;
  // Swept by looking at the PAGES rather than at the list of what has been
  // drawn. That list is cleared in several places — a resize, a re-layout,
  // coming back to the app — and every time it is, the canvases it was
  // describing keep their pixels and become invisible to a sweep that trusts
  // it. Eleven screenfuls were still being held after a dozen turns. The pages
  // themselves cannot get out of step with themselves.
  const forget = () => {
    for (const [i, node] of pageEls.entries()) {
      // Never out from under a render in progress: the pixels it is drawing
      // into are the canvas being taken away, and what comes back is a page
      // that stayed empty because it was emptied mid-sentence.
      if (near(i) || beingDrawn.has(i)) continue;
      const canvas = node.querySelector('canvas');
      if (!canvas || canvas.width <= 1) continue;
      // Zero by zero is how a canvas gives its pixels back.
      canvas.width = 0;
      canvas.height = 0;
      drawn.delete(i);
    }
  };
  // The page you are about to ask for is drawn FIRST — the one immediately the
  // way you are already going — and the rest afterwards. Drawn in the wrong
  // order, a look-ahead that is busy fetching the page behind you is a look-
  // ahead that loses the race to the next tap.
  const wanted = [];
  if (turnWay >= 0) {
    for (let i = last + 1; i <= last + ahead && i < pageEls.length; i++) wanted.push(i);
    for (let i = first - 1; i >= first - behind && i >= 0; i--) wanted.push(i);
  } else {
    for (let i = first - 1; i >= first - behind && i >= 0; i--) wanted.push(i);
    for (let i = last + 1; i <= last + ahead && i < pageEls.length; i++) wanted.push(i);
  }
  forget();
  // A look-ahead belongs to the turn that started it, and only to that one.
  //
  // The pages are fetched one after another because two at once is two page
  // renders competing for the same processor. But that queue used to have no
  // way of being told it was obsolete: turn four pages quickly and the fourth
  // turn's look-ahead — the pages you are actually about to want — sat behind
  // up to twelve renders of pages nobody is going anywhere near. The turn
  // itself then waited on a page nothing had got round to drawing, which is
  // the pause that arrives out of nowhere after a run of instant turns.
  //
  // Each turn now stakes a claim, and a look-ahead that finds it has been
  // superseded stops where it is. The renders already in flight finish — they
  // cannot be recalled — but nothing further is asked for.
  const mine = ++lookAhead;
  setTimeout(async () => {
    for (const i of wanted) {
      if (mine !== lookAhead) return;
      await drawPaperPage(i).catch(() => {});
    }
    if (mine !== lookAhead) return;
    // Again afterwards: a page drawn by the LAST turn's look-ahead finishes
    // after this turn has already swept, and without a second sweep those
    // stragglers are what a long part accumulates.
    forget();
  }, 0);
}

let lookAhead = 0;

// Straight to a page, for a part long enough that turning to it is a chore.
//
// A grid of numbers rather than a box to type in: on a stand you are holding a
// bow, and "page 14" is one tap rather than a keyboard, a return key and a
// missed entry. Bookmarks are the other half of this and live under ⋯ — this is
// for the page you have not marked.
function openPageJump() {
  if (pageEls.length < 2) return;
  const pop = document.createElement('div');
  pop.className = 'pick-pop pages';
  pop.setAttribute('role', 'menu');
  for (let i = 0; i < pageEls.length; i += step()) {
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'page-cell';
    cell.textContent = String(i + 1);
    cell.classList.toggle('on', visiblePages().includes(i));
    cell.setAttribute('aria-label', `Page ${i + 1}`);
    cell.addEventListener('click', () => { pop.remove(); showPage(i); });
    pop.append(cell);
  }
  const shut = (e) => {
    if (pop.contains(e.target) || e.target.closest('#reader-count')) return;
    pop.remove();
    document.removeEventListener('pointerdown', shut, true);
  };
  document.body.append(pop);
  const box = el('reader-count').getBoundingClientRect();
  pop.style.left = `${Math.round(Math.max(8, Math.min(
    box.left + box.width / 2 - pop.offsetWidth / 2, window.innerWidth - pop.offsetWidth - 8,
  )))}px`;
  pop.style.top = `${Math.round(box.bottom + 8)}px`;
  pop.classList.add('from-top');
  setTimeout(() => document.addEventListener('pointerdown', shut, true), 0);
  pop.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
}

const step = () => (spread ? 2 : 1);

// The page after the last one is the next piece in the programme, and the page
// before the first is the end of the one before it. Without a programme they
// are simply the ends of the score.
// Counted from where the reader is HEADING, never from what is currently on the
// glass — see wantedPage. Two taps is two pages even if the first one is still
// being drawn.
function nextPage() {
  if (wantedPage + step() >= pageEls.length && setlist && moveSet) {
    if (setlist.index + 1 < setlist.items.length) {
      moveSet(setlist, setlist.index + 1);
      return;
    }
  }
  showPage(wantedPage + step());
}

function previousPage() {
  if (wantedPage === 0 && setlist && moveSet && setlist.index > 0) {
    moveSet(setlist, setlist.index - 1);
    return;
  }
  showPage(wantedPage - step());
}

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
  // Tapping the pen you are already holding opens the pen case — which pen,
  // how thick, what colour. It is what every drawing app does, and it is how
  // the brush gets reached without a second button to learn.
  if (next && next === tool && (next === 'pen' || next === 'highlighter')) {
    toggleBrush();
    return;
  }
  tool = tool === next ? null : next;
  // Remembered on the way IN, not on the way out: putting a tool down leaves
  // `tool` null, and null is not something to come back holding.
  if (INKS.includes(tool)) lastInk = tool;
  if (tool !== 'lasso') { picked = []; lasso = null; refreshSelectionBar(); }
  root?.classList.toggle('drawing', tool !== null);
  for (const button of root.querySelectorAll('[data-tool]')) {
    const on = button.dataset.tool === tool;
    button.classList.toggle('on', on);
    button.setAttribute('aria-pressed', String(on));
  }
  const shapes = el('reader-shapes');
  if (shapes) shapes.classList.toggle('on', SHAPES.includes(tool));
  const stamps = el('reader-stamps');
  if (stamps) stamps.classList.toggle('on', tool === 'stamp');
  if (tool) {
    setChrome(true);
    closeMenu();
  }
  closeBrush();
  refreshBrushUI();
}

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

function refreshLandButton() {
  const land = el('reader-land');
  if (land) land.hidden = pendingLink?.stage !== 'to';
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

// Is any of this mark on the screen at all?
//
// Deliberately answered WITHOUT measuring anything: bars know which page they
// are on and bands know which strip of paper they show, and both are lookups in
// something already in memory. Every point is asked rather than only the first,
// because a mark drawn along a line of music is anchored to several bars and a
// re-engraving is free to put the far end of it on the next page — a highlight
// that started overleaf still has to be drawn where it now continues.
function touchesScreen(stroke, shown = visiblePages()) {
  if (isPaper()) {
    return stroke.points.some((point) => shown.some((index) => {
      const slice = slices[index];
      if (!slice || slice.page !== point.p) return false;
      const air = slice.rect.h * 0.04;      // the same tolerance placeOnPaper allows
      return point.y >= slice.rect.y - air && point.y <= slice.rect.y + slice.rect.h + air;
    }));
  }
  return stroke.points.some((point) => shown.includes(bars.get(point.m)?.page));
}

function onThisPage(stroke) {
  const first = stroke.points[0];
  if (!first) return false;
  const shown = visiblePages();
  if (first.p !== undefined) return !!place(first);   // paper: is it on screen at all
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
  if (!tool || tool === 'eraser') setTool(lastInk === 'highlighter' ? 'highlighter' : 'pen');
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
  // Named apart from the app's own --ink on purpose: setting that here would
  // repaint every label inside the panel in whatever colour the pen happens to
  // be, which is exactly what it did.
  panel.style.setProperty('--brush-ink', brushCss(brush));
  panel.style.setProperty('--brush-solid', brushCss({ ...brush, a: 1 }));
  panel.style.setProperty('--brush-hue', `hsl(${Math.round(brush.h)} 100% 50%)`);

  for (const button of panel.querySelectorAll('[data-nib]')) {
    const on = button.dataset.nib === brush.nib;
    button.classList.toggle('on', on);
    button.setAttribute('aria-pressed', String(on));
  }
  for (const button of panel.querySelectorAll('[data-size]')) {
    const size = Number(button.dataset.size);
    button.classList.toggle('on', Math.abs(size - brush.width) < 0.005);
  }
  for (const button of panel.querySelectorAll('[data-colour]')) {
    button.classList.toggle('on', button.dataset.colour.toLowerCase() === hexOf(brush));
  }
  const sizeWrap = panel.querySelector('.brush-size-wrap');
  if (sizeWrap) sizeWrap.style.setProperty('--at', `${Math.round(sizeToRail(brush.width) * 100)}%`);
  const hue = panel.querySelector('#reader-hue-rail');
  if (hue) hue.style.setProperty('--at', `${Math.round((brush.h / 360) * 100)}%`);
  const alpha = panel.querySelector('#reader-alpha-rail');
  if (alpha) alpha.style.setProperty('--at', `${Math.round(brush.a * 100)}%`);
  const field = panel.querySelector('#reader-sv');
  if (field) {
    const hsv = hslToHsv(brush);
    field.style.setProperty('--sx', `${Math.round(hsv.s)}%`);
    field.style.setProperty('--sy', `${Math.round(100 - hsv.v)}%`);
  }
  const hex = panel.querySelector('#reader-hex');
  if (hex && document.activeElement !== hex) hex.value = hexOf(brush);
  const readout = panel.querySelector('#reader-size-value');
  if (readout) readout.textContent = brush.width.toFixed(brush.width < 0.1 ? 3 : 2);
  const overlay = panel.querySelector('#reader-overlay');
  if (overlay) {
    overlay.classList.toggle('on', brush.overlay);
    overlay.setAttribute('aria-pressed', String(brush.overlay));
  }
  paintBrushPreview();
}

// The sample stroke, drawn with the very code that draws on the page — the
// pencil in the preview is grainy because the pencil IS grainy, not because a
// preview was styled to look like one.
function paintBrushPreview() {
  const canvas = el('reader-brush-preview');
  if (!canvas?.getContext) return;
  const brush = currentBrush();
  const box = canvas.getBoundingClientRect();
  const w = box.width || 260;
  const h = box.height || 46;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const points = [];
  for (let i = 0; i <= 48; i++) {
    const t = i / 48;
    // Slower at the ends than in the middle, so a fountain nib shows its swell.
    const eased = t * t * (3 - 2 * t);
    points.push({
      x: 10 + eased * (w - 20),
      y: h / 2 + Math.sin(t * Math.PI * 2) * (h * 0.22),
    });
  }
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = brushCss(brush);
  ctx.fillStyle = brushCss(brush);
  const width = Math.max(0.35, brush.width * staffPx());
  ctx.lineWidth = width;
  inkRun(ctx, points, { nib: brush.nib }, width);
  ctx.restore();
}

// The size rail is not linear. Half of every session is spent between a
// hairline and a fingering — a straight rail puts all of that in the first
// eighth of the track and hands the rest to widths nobody uses.
function sizeToRail(width) {
  const t = Math.log(width / MIN_WIDTH) / Math.log(MAX_WIDTH / MIN_WIDTH);
  return Math.min(1, Math.max(0, t));
}

function railToSize(t) {
  return MIN_WIDTH * ((MAX_WIDTH / MIN_WIDTH) ** Math.min(1, Math.max(0, t)));
}

function setBrush(key, value) {
  const brush = currentBrush();
  brush[key] = value;
  refreshBrushUI();
}

// A colour off the palette or out of the mixer. Transparency is left alone —
// it belongs to the pen, not to the colour, and a highlighter that turns opaque
// because you chose a different yellow is a highlighter nobody asked for.
function setColour({ h, s, l }) {
  const brush = currentBrush();
  brush.h = h;
  brush.s = s;
  brush.l = l;
  refreshBrushUI();
}

function usePreset(index) {
  const preset = PRESETS[index];
  const brush = currentBrush();
  brush.h = preset.h;
  brush.s = preset.s;
  brush.l = preset.l;
  if (tool !== 'highlighter') brush.a = preset.a;
  if (!tool || tool === 'eraser') setTool(lastInk === 'highlighter' ? 'highlighter' : 'pen');
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

// --- links -------------------------------------------------------------------
//
// A jump taped to the page: the repeat back to the top, the coda three pages
// on, the cut your teacher wants. You put the badge where the sign is, then go
// to where it should land and say so — because that is the order you think in
// when you are looking at the music.

function linksOf() {
  return score?.links ?? [];
}

function drawLinks(ctx) {
  const style = getComputedStyle(document.documentElement);
  const colour = style.getPropertyValue('--primary').trim() || '#6d4ef6';
  for (const index of visiblePages()) {
    const box = boxOfPage(index);
    if (!box) continue;
    for (const link of linksOf()) {
      if (link.from.screen !== index) continue;
      const x = box.left + link.from.x * box.width;
      const y = box.top + link.from.y * box.height;
      const r = Math.max(9, box.height * 0.016);
      ctx.save();
      ctx.fillStyle = colour;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = style.getPropertyValue('--on-primary').trim() || '#fff';
      ctx.font = `600 ${Math.round(r * 1.1)}px ${style.getPropertyValue('--display').trim() || 'sans-serif'}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('↴', x, y + r * 0.05);
      ctx.restore();
    }
  }
}

// Did that tap land on a link? If it did, take it.
function followLink(px, py) {
  for (const index of visiblePages()) {
    const box = boxOfPage(index);
    if (!box) continue;
    for (const link of linksOf()) {
      if (link.from.screen !== index) continue;
      const x = box.left + link.from.x * box.width;
      const y = box.top + link.from.y * box.height;
      const r = Math.max(14, box.height * 0.02);
      if (Math.hypot(px - x, py - y) <= r) {
        showPage(link.to);
        return true;
      }
    }
  }
  return false;
}

function startLink() {
  pendingLink = { stage: 'from' };
  setChrome(true);
  say('tap the page where the sign is');
}

function say(text) {
  const line = el('reader-say');
  if (!line) return;
  line.textContent = text ?? '';
  line.hidden = !text;
}

async function finishLink(to) {
  const links = [...linksOf(), { from: pendingLink.from, to }];
  score.links = links;
  pendingLink = null;
  await saveLinks(score.id, links).catch(() => {});
  say('');
  redraw();
}

function openLinks() {
  const rows = linksOf().map((link, i) => ({
    label: `Jump on page ${link.from.screen + 1} → page ${link.to + 1}`,
    onPick: () => showPage(link.to),
    ...(i === undefined ? {} : {}),
  }));
  rows.push({ label: '＋ Tape a jump to this page', onPick: startLink });
  if (linksOf().length) {
    rows.push({
      label: 'Peel the last one off',
      danger: true,
      onPick: async () => {
        const links = linksOf().slice(0, -1);
        score.links = links;
        await saveLinks(score.id, links).catch(() => {});
        redraw();
      },
    });
  }
  actionMenu(el('reader-menu-btn'), rows);
}

// --- reading in the dark ------------------------------------------------------
//
// A pit, a dark hall, a stand light somebody else is using: a white page at
// full brightness is a lamp pointed at your own eyes and at everyone behind
// you. Inverted, the paper goes black and the notes go white, and the marks
// keep their colours — a red circle on a black page is still a red circle,
// which a plain brightness setting cannot do.
const NIGHT_KEY = 'readerNight';
let night = false;

function toggleNight() {
  night = !night;
  try { globalThis.localStorage?.setItem(NIGHT_KEY, night ? 'on' : 'off'); } catch { /* fine */ }
  root?.classList.toggle('night', night);
}

// --- out of the app -----------------------------------------------------------
//
// A PDF of the pages with everything you have written on them, handed to the
// share sheet: mail it to your teacher, print it, put it in Files, open it in
// another reader. Nothing is uploaded — the file is made here and given to the
// phone, which is a different thing from sending it somewhere.

async function sendScore(withMarks) {
  const { pdfFromPages, shareFile, fileName } = await import('./export.js');
  const pages = [];
  say('making the file…');
  try {
    for (let p = 0; p < paper.count; p++) {
      const canvas = document.createElement('canvas');
      // The whole page, margins and all: an export is a copy of the music, not
      // a copy of what happens to be on the screen.
      await paper.drawBand(p, canvas, { x: 0, y: 0, w: 1, h: 1 },
        1600 / (window.devicePixelRatio || 1), 40000);
      if (withMarks) {
        const ctx = canvas.getContext('2d');
        const at = (point) => (point.p === p
          ? { x: point.x * canvas.width, y: point.y * canvas.height }
          : null);
        for (const stroke of strokes) {
          if (hidden.has(stroke.layer ?? 0)) continue;
          drawStroke(ctx, stroke, { at, scale: canvas.height / 60 });
        }
      }
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.88));
      pages.push({
        bytes: new Uint8Array(await blob.arrayBuffer()),
        width: canvas.width,
        height: canvas.height,
      });
    }
    const how = await shareFile(pdfFromPages(pages), fileName(score.name, 'pdf'));
    say(how === 'saved' ? 'saved to your files' : '');
  } catch {
    say('that file could not be made');
  }
  setTimeout(() => say(''), 2600);
}

async function sendNotation() {
  const { shareFile, fileName } = await import('./export.js');
  const blob = new Blob([score.xml], { type: 'application/vnd.recordare.musicxml+xml' });
  const how = await shareFile(blob, fileName(score.name, 'musicxml'));
  say(how === 'saved' ? 'saved to your files' : '');
  setTimeout(() => say(''), 2600);
}

function openSend() {
  if (!isPaper()) { sendNotation(); return; }
  actionMenu(el('reader-menu-btn'), [
    { label: 'PDF, with everything written on it', onPick: () => sendScore(true) },
    { label: 'PDF of the pages as they are', onPick: () => sendScore(false) },
  ]);
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
    onPick: () => setTool(lastInk),
  });
  menuRow(sheet, {
    label: 'Clear this page', glyph: '⌧', detail: 'the marks on it, not the music',
    onPick: clearPage,
  });
  const canMark = isPaper() ? (!!take?.notes?.length && !!layout) : !!take?.aligned;
  if (canMark) {
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
  {
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
    menuGroup(sheet, 'the pages themselves');
    menuRow(sheet, {
      label: 'Trim a page…',
      glyph: '⌗',
      detail: 'say where the music is, when too much white or too little shows',
      onPick: openTrimMenu,
    });
    // Only a photograph has edges to find: a PDF page is already a rectangle,
    // and there is no picture behind it to re-cut.
    if (score?.source !== 'pdf') {
      menuRow(sheet, {
        label: 'Change the edges…',
        glyph: '⛶',
        detail: 'crop a page again, or straighten one that came out crooked',
        onPick: openEdgesMenu,
      });
    }
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
  menuGroup(sheet, 'while you play');
  menuRow(sheet, {
    label: 'Metronome', glyph: '𝅘𝅥', detail: 'the click, without leaving the page',
    onPick: () => { close(); document.querySelector('.tab-btn[data-tab="metronome"]')?.click(); },
  });
  menuRow(sheet, {
    label: 'Tuner', glyph: '♪', detail: 'tune up and come back',
    onPick: () => { close(); document.querySelector('.tab-btn[data-tab="tuner"]')?.click(); },
  });
  menuRow(sheet, {
    label: 'Record a take', glyph: '●', detail: 'against this piece',
    onPick: () => { close(); document.querySelector('.tab-btn[data-tab="analyze"]')?.click(); },
  });

  menuGroup(sheet, 'places');
  menuRow(sheet, {
    label: 'Jumps', glyph: '↴',
    detail: linksOf().length
      ? `${linksOf().length} taped to this score`
      : 'a repeat, a coda, a cut',
    onPick: openLinks,
  });
  menuRow(sheet, {
    label: 'Bookmarks', glyph: '⚑',
    detail: bookmarksOf().length
      ? bookmarksOf().map((m) => m.label).join(' · ').slice(0, 44)
      : 'mark where you keep stopping',
    onPick: openBookmarks,
  });
  menuRow(sheet, {
    label: spread ? 'One page at a time' : 'Two pages side by side',
    glyph: '▥',
    detail: spread ? 'the way a phone reads' : 'the way a tablet on a stand reads',
    onPick: toggleSpread,
  });
  menuRow(sheet, {
    label: night ? 'Light page' : 'Dark page',
    glyph: night ? '☀' : '☾',
    detail: night ? 'back to black on white' : 'white on black, for a dark hall',
    onPick: toggleNight,
  });
  menuGroup(sheet, 'this file');
  menuRow(sheet, {
    label: 'Send a copy…', glyph: '⤴',
    detail: isPaper() ? 'a PDF, with your marks on it' : 'the MusicXML file',
    onPick: openSend,
  });
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

// --- changing the edges of a page, after the fact -----------------------------
//
// The edges could be moved while the scanner was still open and never again,
// which is the wrong half of the life of a part: the page that turns out to be
// crooked is the one you notice at a rehearsal, weeks later, with the scanner
// long gone. The photographs are kept with the pages for exactly this, so the
// crop is done again from the negative rather than from the page — a crop of a
// crop cannot give back what the first one took.

function openEdgesMenu() {
  const rows = pageEls.map((_, i) => ({
    label: `Page ${(slices[i]?.page ?? i) + 1}`,
    onPick: () => changeEdges(slices[i]?.page ?? i),
  }));
  // One row per PAGE, not per screenful: two bands of the same photograph are
  // one piece of paper and one set of edges.
  const seen = new Set();
  const pages = rows.filter((row) => (seen.has(row.label) ? false : seen.add(row.label)));
  actionMenu(el('reader-menu-btn'), pages);
}

// Trimming a page: saying where the music is on it, when the app got it wrong.
//
// Every page is measured on the way in — margins off, music to the edges — and
// mostly that is right. When it is not, it is badly wrong: a page number read
// as ink keeps two inches of white, a faint first system gets cut off. Until
// now there was nothing to do about it on a PDF, which is what most parts are.
//
// This changes NOTHING about the file. The crop is a rectangle to draw FROM,
// stored beside the pages; the PDF is untouched and the whole sheet is always
// there to widen back out to. That is why it can be offered on a downloaded
// part at all, and why it is safe to get wrong and do again.
async function trimPage(pageNumber) {
  if (!score || !paper?.drawWhole) return;
  const { setPageCrop, loadScorePages } = await import('../store/db.js');
  const { editCorners } = await import('./crop.js');
  const sheetCanvas = document.createElement('canvas');
  try {
    // Big enough to place an edge by eye, and no bigger.
    await paper.drawWhole(pageNumber, sheetCanvas, 1400, 1900);
  } catch (err) {
    say(`that page could not be drawn to crop — ${err.message}`);
    return;
  }
  const blob = await new Promise((resolve) => sheetCanvas.toBlob(resolve, 'image/jpeg', 0.92));
  sheetCanvas.width = 0;
  sheetCanvas.height = 0;
  if (!blob?.size) { say('that page could not be prepared for cropping'); return; }
  // Starting from where the crop is NOW, so a small correction is a small drag
  // rather than drawing the whole rectangle again.
  const row = await loadScorePages(score.id);
  const at = row?.crops?.[pageNumber];
  const start = at
    ? [[at.x, at.y], [at.x + at.w, at.y], [at.x + at.w, at.y + at.h], [at.x, at.y + at.h]]
    : null;
  const chosen = await editCorners(blob, start, {
    whole: 'Whole page',
    reset: 'What it found',
    keep: 'Trim it here',
    hint: 'Drag the edges to where the music starts and stops. Nothing is cut from the file —'
      + ' this is only how much of the page is shown.',
  });
  if (!chosen) return;
  // The corners move independently, because the same editor squares up a
  // photograph taken at an angle. A page of a PDF is already square, so what is
  // taken from it is the rectangle those corners enclose.
  const xs = chosen.quad.map((p) => p[0]);
  const ys = chosen.quad.map((p) => p[1]);
  const x = Math.max(0, Math.min(...xs));
  const y = Math.max(0, Math.min(...ys));
  const crop = {
    x,
    y,
    w: Math.min(1 - x, Math.max(0.05, Math.max(...xs) - x)),
    h: Math.min(1 - y, Math.max(0.05, Math.max(...ys) - y)),
  };
  await setPageCrop(score.id, pageNumber, crop);
  say('page trimmed');
  // Rebuilt from the score as it now stands: the bands of that page are cut
  // from the crop, so they are all different now.
  drawn.clear();
  await render();
  showPage(Math.max(0, slices.findIndex((slice) => slice.page === pageNumber)));
}

// Which page to trim.
function openTrimMenu() {
  const seen = new Set();
  const pages = pageEls
    .map((_, i) => slices[i]?.page ?? i)
    .filter((page) => (seen.has(page) ? false : seen.add(page)))
    .map((page) => ({ label: `Page ${page + 1}`, onPick: () => trimPage(page) }));
  actionMenu(el('reader-menu-btn'), pages);
}

async function changeEdges(pageNumber) {
  if (!score) return;
  const { loadScorePages, replaceOnePage } = await import('../store/db.js');
  const row = await loadScorePages(score.id);
  const original = row?.raws?.[pageNumber] ?? row?.pages?.[pageNumber];
  if (!original) {
    say('there is no photograph behind that page to crop');
    return;
  }
  const fresh = !!row?.raws?.[pageNumber];
  const { editCorners } = await import('./crop.js');
  const { readableImage, sizeOfImage, straightenCanvas } = await import('./straighten.js');
  // Starting from the whole photograph when it IS the photograph, and from the
  // whole page when all that is left is the page — in which case the edges can
  // only take away, and saying so is better than a surprise.
  const chosen = await editCorners(original, null);
  if (!chosen) return;
  const image = await readableImage(original);
  if (!image) { say('that page could not be read'); return; }
  const { w, h } = sizeOfImage(image);
  let page;
  try {
    page = straightenCanvas(image, w, h, chosen.quad);
  } catch {
    say('those edges could not be made into a page');
    return;
  }
  const blob = await new Promise((resolve) => page.toBlob(resolve, 'image/jpeg', 0.9));
  if (!blob?.size) { say('that did not come out — try the edges again'); return; }
  const name = original.name ?? `page-${pageNumber + 1}.jpg`;
  await replaceOnePage(score.id, pageNumber, new File([blob], name, { type: 'image/jpeg' }));
  say(fresh ? 'page changed' : 'page changed — cropped from the page, not the photograph');
  // Everything measured about that page is gone with it, so the reader is
  // rebuilt from the score as it now stands.
  drawn.clear();
  await render();
  showPage(Math.min(pageIndex, pageEls.length - 1));
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
  // Come back to the music you were reading, not to page one. On paper that is
  // the sheet of paper you were on — half the screen means half the width, so
  // the bands are recut and the numbering changes underneath you.
  const paperPage = isPaper() ? slices[pageIndex]?.page ?? 0 : null;
  const bar = isPaper() ? null : firstBarOnPage();
  drawn.clear();
  await render();
  if (isPaper()) showPage(Math.max(0, slices.findIndex((slice) => slice.page === paperPage)));
  else showPage(bars.get(bar)?.page ?? 0);
}

// --- painting the take over the page -----------------------------------------

let painted = false;

async function togglePainted() {
  // On paper the marks are drawn on the ink layer, so there is nothing to
  // re-engrave: it is a redraw either way.
  if (isPaper()) {
    if (!take?.notes?.length || !layout) return;
    painted = !painted;
    redraw();
    return;
  }
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

// Drawn, not typed. A bar of ✕ ‹ › ⋯ is a row of characters in whatever face
// the system feels like; a score reader's bar is a row of thin, even line
// drawings, and at a stand you recognise the shape long before you read it.
const ICONS = {
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  forward: '<path d="M9 5l7 7-7 7"/>',
  play: '<path d="M8 5.5l11 6.5-11 6.5z" fill="currentColor" stroke="none"/>',
  pause: '<path d="M9 5.5v13M15 5.5v13"/>',
  pen: '<path d="M4 20l4-1 9.5-9.5a2 2 0 0 0-2.8-2.8L5 16.2z"/><path d="M13.5 6.5l4 4"/>',
  more: '<circle cx="5.5" cy="12" r="1.4" fill="currentColor" stroke="none"/>'
    + '<circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/>'
    + '<circle cx="18.5" cy="12" r="1.4" fill="currentColor" stroke="none"/>',
  shelf: '<rect x="3.5" y="4" width="7" height="7" rx="1.4"/><rect x="13.5" y="4" width="7" height="7" rx="1.4"/>'
    + '<rect x="3.5" y="13" width="7" height="7" rx="1.4"/><rect x="13.5" y="13" width="7" height="7" rx="1.4"/>',
  tick: '<path d="M5 12.5l4.5 4.5L19 7"/>',
  highlighter: '<path d="M4 19h6"/><path d="M7 15.5l8-8a2 2 0 0 1 3 3l-8 8H7z"/>',
  text: '<path d="M5 6h14M12 6v13"/>',
  shapes: '<rect x="4.5" y="4.5" width="10" height="10" rx="1"/><circle cx="15.5" cy="15.5" r="4.5"/>',
  lasso: '<ellipse cx="12" cy="10.5" rx="7.5" ry="5.5"/><path d="M8 15.5c0 2 1 3.5 1 4.5"/>',
  // A rubber, held at the angle a hand holds one, with the seam across it that
  // says which end has been used and a line of paper under it. The old one was
  // the same idea drawn small and thin, and at the size this bar draws icons it
  // read as a smudge — which is how a tool that has been here all along got
  // asked for as a tool that was missing.
  eraser: '<path d="M3.8 16.6l7.6-7.6a2 2 0 0 1 2.9 0l3.3 3.3a2 2 0 0 1 0 2.9l-4.4 4.4H6.6z"/>'
    + '<path d="M9.3 11.5l5.9 5.9"/><path d="M11 20.2h9"/>',
  undo: '<path d="M9 7H5.5V3.5"/><path d="M5.8 7.2a7 7 0 1 1-1.3 6"/>',
  redo: '<path d="M15 7h3.5V3.5"/><path d="M18.2 7.2a7 7 0 1 0 1.3 6"/>',
  clear: '<rect x="4.5" y="5.5" width="15" height="13" rx="2"/><path d="M9 9.5l6 5M15 9.5l-6 5"/>',
  layers: '<path d="M12 3.5l8.5 4.5L12 12.5 3.5 8z"/><path d="M4.5 12.5L12 16.5l7.5-4"/>',
  fit: '<path d="M9 4.5H4.5V9M15 4.5h4.5V9M9 19.5H4.5V15M15 19.5h4.5V15"/>',
  brush: '<path d="M6 20c2.5 0 4-1.5 4-3.5S8.5 13 6.5 13.5C5 14 4 16 4 20z"/><path d="M10.5 15.5l8-8a2 2 0 0 0-3-3l-8 8"/>',
};

function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.7');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.innerHTML = ICONS[name] ?? '';
  svg.setAttribute('aria-hidden', 'true');
  return svg;
}

function iconButton(id, glyph, label, onClick, { className = 'reader-tool' } = {}) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  if (id) button.id = id;
  if (ICONS[glyph]) button.append(icon(glyph));
  else button.textContent = glyph;
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

// A rail you drag along, rather than a browser slider. Every one of these is
// showing a colour or a thickness, and a native range input shows neither: it
// puts a grey track and a fat knob over the top of the only thing you came to
// look at.
function rail(id, className, onDrag) {
  const track = document.createElement('div');
  track.id = id;
  track.className = `brush-rail ${className}`;
  const thumb = document.createElement('span');
  thumb.className = 'brush-thumb';
  thumb.setAttribute('aria-hidden', 'true');
  track.append(thumb);
  const pick = (e) => {
    const box = track.getBoundingClientRect();
    onDrag(Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)));
  };
  track.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    // Capture is what makes a drag survive leaving the rail; a device that
    // will not give it is still allowed to tap.
    try { track.setPointerCapture(e.pointerId); } catch { /* tap only */ }
    pick(e);
  });
  track.addEventListener('pointermove', (e) => {
    if (!track.hasPointerCapture(e.pointerId)) return;
    e.stopPropagation();
    pick(e);
  });
  return track;
}

// The nibs, as a segmented row with the mark each one makes drawn on it.
function nibButton(nib) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'brush-nib';
  button.dataset.nib = nib.id;
  const mark = document.createElement('span');
  mark.className = `brush-nib-mark is-${nib.id}`;
  mark.setAttribute('aria-hidden', 'true');
  const label = document.createElement('span');
  label.textContent = nib.label;
  button.append(mark, label);
  button.setAttribute('aria-label', `${nib.label} nib`);
  button.addEventListener('click', () => {
    setBrush('nib', nib.id);
    // A marker is a wash and a pencil is not: the transparency that goes with
    // the nib comes with it, unless the pen already has one of its own.
    if (nib.id === 'marker' && currentBrush().a > 0.8) setBrush('a', 0.4);
    if (nib.id !== 'marker' && tool !== 'highlighter' && currentBrush().a < 0.5) setBrush('a', 1);
  });
  return button;
}

function sizeDot(width) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'brush-dot';
  button.dataset.size = String(width);
  button.style.setProperty('--dot', `${Math.max(2, Math.min(18, 2 + width * 12))}px`);
  button.setAttribute('aria-label', `${width} staff spaces`);
  button.addEventListener('click', () => setBrush('width', width));
  return button;
}

function paletteSwatch(hex) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'brush-colour';
  button.dataset.colour = hex;
  button.style.setProperty('--swatch', hex);
  button.setAttribute('aria-label', `Draw in ${hex}`);
  button.addEventListener('click', () => {
    const hsl = hslFromHex(hex);
    if (hsl) setColour(hsl);
  });
  return button;
}

// The mixer: a saturation/brightness field with a hue rail under it, the way
// every drawing app does it, because it is the one arrangement where "a bit
// lighter than that red" is a single movement.
function buildMixer() {
  const wrap = document.createElement('div');
  wrap.id = 'reader-mixer';
  wrap.hidden = true;

  const field = document.createElement('div');
  field.id = 'reader-sv';
  const dot = document.createElement('span');
  dot.className = 'brush-sv-dot';
  dot.setAttribute('aria-hidden', 'true');
  field.append(dot);
  const pick = (e) => {
    const box = field.getBoundingClientRect();
    const s = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)) * 100;
    const v = 100 - Math.min(1, Math.max(0, (e.clientY - box.top) / box.height)) * 100;
    setColour(hsvToHsl({ h: currentBrush().h, s, v }));
  };
  field.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    try { field.setPointerCapture(e.pointerId); } catch { /* tap only */ }
    pick(e);
  });
  field.addEventListener('pointermove', (e) => {
    if (!field.hasPointerCapture(e.pointerId)) return;
    e.stopPropagation();
    pick(e);
  });

  const hue = rail('reader-hue-rail', 'is-hue', (t) => setBrush('h', t * 360));
  const alpha = rail('reader-alpha-rail', 'is-alpha', (t) => setBrush('a', Math.max(0.05, t)));

  const hex = document.createElement('input');
  hex.id = 'reader-hex';
  hex.type = 'text';
  hex.spellcheck = false;
  hex.setAttribute('aria-label', 'Colour, as hex');
  hex.addEventListener('input', () => {
    const hsl = hslFromHex(hex.value);
    if (hsl) setColour(hsl);
  });

  const row = document.createElement('div');
  row.className = 'brush-hex-row';
  const label = document.createElement('span');
  label.textContent = 'Hex';
  row.append(label, hex);

  wrap.append(field, hue, alpha, row);
  return wrap;
}

function buildTopBar() {
  const bar = document.createElement('div');
  bar.id = 'reader-top';

  const left = document.createElement('div');
  left.className = 'reader-bar-left';
  left.append(
    iconButton('reader-close', 'shelf', 'Back to the shelf', close),
    iconButton('reader-back', 'back', 'The page before', previousPage),
    iconButton('reader-forward', 'forward', 'The next page', nextPage),
  );

  const middle = document.createElement('div');
  middle.className = 'reader-bar-middle';
  const title = document.createElement('span');
  title.id = 'reader-title';
  // "p. 7 of 21" is already the answer to "where am I", so it is also the way
  // to say where you would rather be. A button rather than a label, and it
  // looks like a label until it is worth pressing — nothing new to find, and
  // nothing in the way of a part with three pages.
  const count = document.createElement('button');
  count.type = 'button';
  count.id = 'reader-count';
  count.addEventListener('click', openPageJump);
  middle.append(title, count);

  const right = document.createElement('div');
  right.className = 'reader-bar-right';
  right.append(
    iconButton('reader-play', 'play', 'Play the take', togglePlayback),
    iconButton('reader-annotate', 'pen', 'Annotate this page', () => setTool(lastInk)),
    iconButton('reader-menu-btn', 'more', 'More', toggleMenu),
  );

  bar.append(left, middle, right);
  return bar;
}

function buildInkBar() {
  const bar = document.createElement('div');
  bar.id = 'reader-ink-bar';
  // The ink you are holding, shown ON the pen rather than on a button of its
  // own. There used to be a brush button here, and everything behind it is
  // already one tap on the pen you are already holding — so it was a second
  // door into the same room, taking up space in a bar that has none. What it
  // was worth keeping was the nib: the colour and rough thickness of the mark
  // you are about to make, which now sits on the tool itself.
  const pen = toolButton('pen', 'pen', 'Pen');
  const nib = document.createElement('span');
  nib.id = 'reader-nib';
  nib.setAttribute('aria-hidden', 'true');
  pen.append(nib);
  bar.append(
    iconButton('reader-done', 'tick', 'Finished annotating', () => setTool(null)),
    pen,
    toolButton('highlighter', 'highlighter', 'Highlighter'),
    toolButton('text', 'text', 'Type on the page'),
    iconButton('reader-shapes', 'shapes', 'Lines, boxes and rings', openShapeMenu),
    iconButton('reader-stamps', STAMPS[0].glyph, 'Stamp a sign on the page', openStampMenu),
    toolButton('lasso', 'lasso', 'Pick up marks'),
    toolButton('eraser', 'eraser', 'Rub out'),
    ...PRESETS.map((_, i) => presetSwatch(i)),
    iconButton('reader-undo', 'undo', 'Undo', undo),
    iconButton('reader-redo', 'redo', 'Redo', redo),
    iconButton('reader-clear', 'clear', 'Clear this page', clearPage),
    iconButton('reader-layers', 'layers', 'Layers', openLayerMenu),
    iconButton('reader-reset-zoom', 'fit', 'Back to the whole page', resetZoom),
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

// The pen, laid out the way a pen case is: which pen, how thick, what colour.
// Three questions in that order, each answered by tapping the thing itself
// rather than by aiming at a row of unlabelled sliders.
function buildBrushPanel() {
  const panel = document.createElement('div');
  panel.id = 'reader-brush';

  const nibs = document.createElement('div');
  nibs.className = 'brush-nibs';
  nibs.append(...NIBS.map(nibButton));

  const preview = document.createElement('canvas');
  preview.id = 'reader-brush-preview';
  preview.setAttribute('aria-hidden', 'true');

  const sizes = document.createElement('div');
  sizes.className = 'brush-sizes';
  const value = document.createElement('span');
  value.id = 'reader-size-value';
  sizes.append(...SIZE_DOTS.map(sizeDot), value);

  // The wedge is clipped to its own shape, so the handle rides in a wrapper
  // above it rather than being sliced off by the clip.
  const sizeWrap = document.createElement('div');
  sizeWrap.className = 'brush-size-wrap';
  const sizeRail = rail('reader-size-rail', 'is-size', (t) => setBrush('width', railToSize(t)));
  const sizeThumb = document.createElement('span');
  sizeThumb.className = 'brush-thumb';
  sizeThumb.setAttribute('aria-hidden', 'true');
  sizeWrap.append(sizeRail, sizeThumb);

  const palette = document.createElement('div');
  palette.className = 'brush-palette';
  palette.append(...PALETTE.map(paletteSwatch));

  const mixer = buildMixer();
  const custom = document.createElement('button');
  custom.type = 'button';
  custom.id = 'reader-custom';
  custom.className = 'brush-more';
  custom.textContent = 'Mix a colour';
  custom.setAttribute('aria-expanded', 'false');
  custom.addEventListener('click', () => {
    mixer.hidden = !mixer.hidden;
    custom.setAttribute('aria-expanded', String(!mixer.hidden));
    custom.textContent = mixer.hidden ? 'Mix a colour' : 'Hide the mixer';
    refreshBrushUI();
  });

  const overlay = iconButton('reader-overlay', 'Under the notes', 'Draw underneath the notes',
    () => setBrush('overlay', !currentBrush().overlay), { className: 'reader-chip' });

  // Everything that shows the ink itself goes on the paper card.
  const paper = document.createElement('div');
  paper.className = 'brush-paper';
  paper.append(preview, sizes, sizeWrap);

  panel.append(nibs, paper, palette, custom, mixer, overlay);
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

  const line = document.createElement('div');
  line.id = 'reader-say';
  line.hidden = true;
  const land = iconButton('reader-land', 'Land it', 'Land the jump here', () => {
    if (pendingLink?.stage === 'to') finishLink(pageIndex);
    refreshLandButton();
  }, { className: 'reader-chip' });
  land.hidden = true;

  root.append(sheet, ink, buildTopBar(), buildInkBar(), buildBrushPanel(),
    buildSelectionBar(), menu, line, land);
  document.body.append(root);
  trackPointers(root);

  // A tap does one of four things, and where it lands decides which. The top
  // strip is tested FIRST: it overlaps the left and right thirds, and a tap up
  // there is a reach for the controls, not for a page turn.
  // A tap, worked out from the pointer rather than waited for as a click.
  //
  // Two things were wrong with listening for `click` on a tablet. It arrives
  // late — the browser waits to see whether the touch is going to become
  // something else — and it does not arrive AT ALL if the finger moved a few
  // pixels on the way down, which a finger resting on a music stand does every
  // time. That is the whole of "sometimes it doesn't register, sometimes it
  // takes a while": the turn was waiting on an event that was slow when it came
  // and often never came.
  //
  // A tap is now what it looks like: one pointer, down and up in the same place
  // inside half a second, and the page turns on the up.
  // A generous idea of "the same place". A page-turn zone is a third of the
  // screen wide, so nothing is ambiguous at this distance, and a finger resting
  // on a music stand travels further than you would think.
  const TAP_SLIP = 20;      // px of travel still counts as a tap
  const TAP_TIME = 600;     // ms held still counts as a tap
  let tapFrom = null;
  root.addEventListener('pointerdown', (e) => {
    // The palm is turned away here as well as at the door.
    //
    // trackPointers refuses a touch while the pencil is down, but a `return`
    // only leaves the listener it is in — and this is a second listener on the
    // same element. Without saying so again here, a hand settling on the iPad
    // halfway through a fingering would land in `tapFrom`, lift with the pen,
    // read as a tap on the music, and put the pen away mid-annotation. The
    // pencil's own entry is left exactly as it was.
    if (penIsDown() && e.pointerType !== 'pen') return;
    tapFrom = pointers.size > 1 ? null : { x: e.clientX, y: e.clientY, at: e.timeStamp, id: e.pointerId };
  }, true);
  root.addEventListener('pointerup', (e) => {
    if (penIsDown() && e.pointerType !== 'pen') return;
    const from = tapFrom;
    tapFrom = null;
    if (!from || from.id !== e.pointerId || pinching) return;
    if (Math.hypot(e.clientX - from.x, e.clientY - from.y) > TAP_SLIP) return;
    if (e.timeStamp - from.at > TAP_TIME) return;
    onTap(e);
  });
  root.addEventListener('pointercancel', () => { tapFrom = null; });

  function onTap(e) {
    if (e.target.closest('#reader-top, #reader-ink-bar, #reader-menu, #reader-brush')) return;
    if (menuOpen) { closeMenu(); return; }
    if (el('reader-brush')?.classList.contains('open')) { closeBrush(); return; }
    // The pen owns the page while it is out — but a TAP with it is you looking
    // up from the writing. You annotate a bar, then you play, and the bar of
    // tools sits over the music with the pen still armed; getting back to
    // reading meant finding one small tick at the top of the screen. Anywhere
    // on the page does it now, and the pen you were using is remembered for
    // when you come back to it.
    if (tool) {
      // …unless the tap WROTE something. A fingering digit, a comma of a breath
      // mark, a dot over a note: all of them are a few pixels across, all of
      // them are inside what this reader calls a tap, and all of them are you
      // annotating rather than finishing. Putting the pen down after each one
      // would be the same complaint this was meant to fix, from the other end.
      // So the question is not how far the finger moved, it is whether a mark
      // came out of it.
      // …and never on the gesture that PICKED the pen up. A pencil touching
      // the page arms the last tool and starts a stroke from that same touch;
      // a pencil that touched and lifted without leaving a mark would
      // otherwise arm the pen and put it straight back down again, which is a
      // tool bar that flashes on and off and a reader that never lets you
      // write anything.
      if (armedByPen) { armedByPen = false; return; }
      if (TAP_PUTS_DOWN.includes(tool) && strokes.length === marksAtDown) {
        setTool(null);
        setChrome(false);
      }
      return;
    }
    // Taping a jump down: the first tap is where the sign is, and after that
    // the page turns as usual until you say where it lands.
    if (pendingLink?.stage === 'from') {
      const box = boxOfPage(pageIndex);
      if (box) {
        pendingLink.from = {
          screen: pageIndex,
          x: (e.clientX - box.left) / box.width,
          y: (e.clientY - box.top) / box.height,
        };
        pendingLink.stage = 'to';
        say('now turn to where it should land, and tap Land it');
        refreshLandButton();
      }
      return;
    }
    if (followLink(e.clientX, e.clientY)) return;
    // While the bar is down, ANY tap on the music puts it away again — it is
    // in the way, and reaching for a particular third of the screen to dismiss
    // something that is covering the music is a rule nobody should have to
    // learn. Page turns come back the moment it is gone.
    if (chrome) { setChrome(false); return; }
    if (e.clientY < window.innerHeight * 0.16) { setChrome(true); return; }
    const third = window.innerWidth / 3;
    if (e.clientX < third) previousPage();
    else if (e.clientX > window.innerWidth - third) nextPage();
    else setChrome(true);
  }

  // Drawing and pinching share the same surface, and the pen must lose every
  // argument between them. A stroke is only started by a lone finger, is thrown
  // away the moment a second one lands, and cannot start again until BOTH have
  // left — otherwise lifting one finger out of a pinch draws a line from
  // wherever the other one happens to be resting.
  ink.addEventListener('pointerdown', (e) => {
    if (!tool || pinching) return;
    // A second FINGER is a pinch. A palm while the pencil is writing is not a
    // second anything — it has already been turned away at the door.
    if (pointers.size > 1 && !penIsDown()) return;
    if (penIsDown() && e.pointerType !== 'pen') return;
    try { ink.setPointerCapture(e.pointerId); } catch { /* the stroke goes on */ }
    drawingPointer = e.pointerId;
    marksAtDown = strokes.length;
    beginStroke(e);
  });
  ink.addEventListener('pointermove', (e) => {
    if (!tool || pinching || e.pointerId !== drawingPointer) return;
    if (e.buttons === 0 && e.pointerType === 'mouse') return;
    // Every position the device actually sampled, not just the one it got round
    // to telling us about.
    //
    // iPadOS samples an Apple Pencil at 240Hz and the screen redraws at 120 at
    // best, so it hands over one pointermove carrying the several positions
    // that happened since the last one. Reading only the event itself throws
    // three points in four away: a fast stroke comes out as a chain of straight
    // segments with visible corners, and a flicked accent comes out as one
    // line. Asking for the coalesced events costs nothing and gets the whole
    // gesture, which is the difference between ink that was recorded and ink
    // that was sampled.
    const moves = e.getCoalescedEvents?.() ?? null;
    if (moves && moves.length > 1) for (const move of moves) extendStroke(move, { quiet: true });
    else extendStroke(e, { quiet: true });
    redraw();
  });
  for (const type of ['pointerup', 'pointercancel']) {
    ink.addEventListener(type, (e) => {
      if (e.pointerId !== drawingPointer) return;
      drawingPointer = null;
      endStroke();
    });
  }

  // Coming back to the app, with the pages possibly gone.
  //
  // iOS takes the pixels back out of a canvas when it needs the memory, and
  // putting the app aside for a minute is when it needs the memory. The canvas
  // is still there and still the right size — nothing about it says it has been
  // emptied — so a reader that believes it has already drawn a page will show
  // that page as a black rectangle for ever. Everything drawn is therefore
  // forgotten on the way out, and the page in front of you is drawn again on
  // the way back.
  document.addEventListener('visibilitychange', () => {
    if (root.hidden || document.visibilityState !== 'visible' || !isPaper()) return;
    drawn.clear();
    for (const index of visiblePages()) drawPaperPage(index).catch(() => {});
    keepNeighboursReady(visiblePages());
  });

  document.addEventListener('keydown', (e) => {
    if (root.hidden) return;
    // Not while something is being typed. The reader is still up behind the
    // rename box and the text-on-the-page box, and a space bar that turns the
    // page instead of typing a space makes naming a piece "Menuet II"
    // impossible — the page turn is a reading gesture, not a keyboard.
    if (e.target?.closest?.('input, textarea, [contenteditable]')
      || document.querySelector('dialog[open]')) return;
    if (e.key === 'Escape') {
      if (menuOpen) closeMenu();
      else if (tool) setTool(null);
      else close();
      return;
    }
    // The keys a Bluetooth page turner sends — every pedal on the market is a
    // keyboard, and one it has been taught wins over the built-in ones. See
    // pedal.js for which keys and why.
    //
    // Held down is not turned again: a pedal somebody is standing on should
    // not run through the movement.
    if (e.repeat) return;
    const turn = pageTurn(e);
    if (turn === 'forward') {
      e.preventDefault();
      nextPage();
    } else if (turn === 'back') {
      e.preventDefault();
      previousPage();
    }
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
  setReadingZoom(readingZoom() * factor);
  if (isPaper()) {
    // Bigger music on a scan means less of the paper on screen at once: the
    // page is split at another system gap and each half fills the glass.
    const first = pageIndex;
    drawn.clear();
    await render();
    showPage(Math.min(first, pageEls.length - 1));
    return;
  }
  const anchorBar = firstBarOnPage();
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
    drawn.clear();           // the screen changed shape; so does every page
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
  invalidateGeometry();     // new pages; every measurement of the old ones is void
  const out = score.kind === 'pages' ? await layOutPaper() : await engrave();
  invalidateGeometry();
  return out;
}

// Paper: a container per page with a canvas in it, drawn to fit the screen the
// first time it is looked at and again whenever the screen changes shape.
// Nothing is scaled by CSS — every page is rendered at the device's own pixels,
// because a photograph of a page stretched by a browser is exactly the blurry
// mess this app tells people it isn't.
// Which part of which page each screen shows — see bands.js for the whole of
// that argument. Here it is only asked, page by page, of the paper in hand.
async function bandPages(target) {
  const out = [];
  for (let p = 0; p < paper.count; p++) {
    const rects = bandsOfPage({
      staves: layout?.[p]?.staves ?? [],
      crop: await paper.cropOf(p),
      size: await paper.sizeOf(p),
      target,
      zoom: readingZoom(),
    });
    for (const rect of rects) out.push({ page: p, rect });
  }
  return out;
}

// Which laying-out the pages on screen belong to.
//
// Turning the iPad round throws every page away and builds new ones, and the
// draws the last screen shape had in flight do not stop when it does — they
// finish, against canvases that are no longer in the document, and then say
// "page 7 is drawn". Page 7 by then is a different, empty canvas that nothing
// will ever draw again, because it has been marked as done. That is a page of a
// part that is blank until you leave the score and come back, and rotating is
// the commonest way in the world to hit it.
let era = 0;

async function layOutPaper() {
  const mine = ++era;
  // Nothing that was true of the old pages is true of the new ones.
  drawn.clear();
  beingDrawn.clear();
  const payload = await loadScorePages(score.id);
  if (mine !== era) return null;
  layout = payload?.layout ?? null;
  paper?.destroy?.();
  paper = await openPaper(payload);
  if (mine !== era) return null;
  view = null;
  bars = new Map();
  sheet.replaceChildren();
  pageEls = [];
  const across = window.innerWidth / (spread ? 2 : 1);
  slices = await bandPages(across / window.innerHeight);
  rememberMeasurements(payload);
  for (let i = 0; i < slices.length; i++) {
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

// Scores whose staves have already been sent for reading in this session. A
// part whose pages genuinely cannot be read never gets a layout however often
// it is asked, and asking on every open is a scan of the whole part every time.
const reading = new Set();

// Keeping what laying the part out has just cost.
//
// bandPages asks every page where its music sits and how big it is, and until
// now the answers were worked out, used once, and dropped on the floor when the
// reader closed — so a part whose measuring pass never finished measured itself
// again on every single open, for ever. On a twenty-odd page scan that is a
// render per page before anything appears: seconds of black screen, every time,
// for an answer the score already had the first time it was asked.
//
// It costs one write of two small arrays, and only when something was missing.
function rememberMeasurements(payload) {
  if (!paper?.measured || score?.kind !== 'pages') return;
  const id = score.id;
  const measured = paper.measured();
  const complete = (stored) => stored?.length >= paper.count
    && stored.every((one) => one != null);
  if (complete(payload?.crops) && complete(payload?.sizes)) return;
  saveScoreLayout(id, payload?.layout ?? null, measured).catch(() => {
    /* a score that will not remember its measurements is still a readable score */
  });
  // And where the STAVES are, which crops alone cannot bring back: a part
  // imported before this existed, or one whose reading pass was interrupted,
  // has no layout at all, and without it a take can never be marked onto it.
  // Quietly, behind the page that is already on screen — nothing waits for it.
  if (!payload?.layout && !reading.has(id)) {
    reading.add(id);
    import('./score.js')
      .then(({ measurePages }) => measurePages(id))
      // A pass that FAILED has not answered the question, so the next open is
      // allowed to ask again. Only a pass that finished puts the score down.
      .catch(() => { reading.delete(id); /* still a score to play from */ });
  }
}

const drawn = new Set();
// Pages being drawn right now.
//
// `drawn` only records pages that have FINISHED, so two things asking for the
// same page at once — a turn and the look-ahead it kicked off a moment earlier
// — both got past it and both started drawing. That was survivable when each
// render built its own canvas and the second one simply won; now that a page is
// rendered straight into the canvas it will be shown on, two renders on one
// canvas is something the renderer refuses outright, and the page it refuses is
// a page that never appears. The second caller waits for the first instead.
const beingDrawn = new Map();

function drawPaperPage(index) {
  const already = beingDrawn.get(index);
  if (already) return already;
  const one = drawOnePage(index).finally(() => beingDrawn.delete(index));
  beingDrawn.set(index, one);
  return one;
}

async function drawOnePage(index) {
  const node = pageEls[index];
  const slice = slices[index];
  if (!paper || !node || !slice || drawn.has(index)) return;
  const canvas = node.querySelector('canvas');
  const across = window.innerWidth / (spread ? 2 : 1);
  const mine = era;
  try {
    await paper.drawBand(slice.page, canvas, slice.rect, across, window.innerHeight);
  } catch (err) {
    // The pages were rebuilt underneath this one — rotated, resized, a page
    // recropped. It drew on a canvas nobody can see any more, and it has
    // nothing to say about the pages that exist now.
    if (mine !== era) return;
    // A page the renderer chokes on leaves a blank canvas and no explanation,
    // which reads as a score that has lost a page. Say it on the page itself:
    // the rest of the part still turns, and the reason is where the missing
    // music would have been.
    sayOnPage(canvas, `Page ${slice.page + 1} could not be drawn — ${err.message}`, across);
  }
  if (mine !== era) return;
  drawn.add(index);
  // The canvas has just been given a size, which means the box the ink is
  // placed against has just changed — and on the paper path that box IS the
  // canvas. Nothing else invalidates it: a page drawn while the pen is down
  // (coming back to the app, a neighbour landing) would otherwise leave every
  // mark on it placed against the empty rectangle it had before.
  invalidateGeometry();
  dropDryInk();
  redraw(); // the ink layer measures the page it has just been given a size for
}

// A sentence where a page should have been.
function sayOnPage(canvas, text, across) {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(across);
  const h = Math.round(window.innerHeight * 0.6);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#f6f5f2';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#8a8794';
  ctx.textAlign = 'center';
  ctx.font = `400 ${Math.max(13, Math.round(w / 34))}px system-ui, sans-serif`;
  // Wrapped by hand: a canvas has no idea what a line is.
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > w * 0.8 && line) { lines.push(line); line = word; }
    else line = next;
  }
  if (line) lines.push(line);
  lines.forEach((one, i) => ctx.fillText(one, w / 2, h / 2 + (i - (lines.length - 1) / 2) * 26));
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

// --- what you played, on your own photograph ---------------------------------
//
// A scan cannot say which note is WRITTEN — nothing in a picture of a page says
// that, and the app never pretends otherwise. What it can say is which note you
// played and how in tune it was, because that comes from the audio, and where
// each note sits on the page, because that was read off the picture.
//
// So the marks here are the ones the recording proved: a ring round each
// notehead in the colour of how it landed. They are placed in the order they
// were played — the noteheads of the page in reading order, against the notes
// of the take in the order they came out — which assumes you played it through.
// Stop halfway and the tail of the page is simply unmarked; that is honest, and
// it is why nothing here ever says "wrong note".
function scanHeads() {
  if (!layout) return [];
  const all = [];
  for (const [pageIndex, page] of layout.entries()) {
    if (!page) continue;
    const space = page.space ?? 0.01;
    for (const note of notesInOrder(page)) all.push({ ...note, page: pageIndex, space });
  }
  return all;
}

// One mark per note PLAYED, in order, and not one more.
//
// Stretching a short take across a whole page would decorate music nobody
// touched, which is the kind of confident nonsense this app is written to
// avoid. Play half the page and half the page is marked; play it twice through
// and the second pass marks over the first. It is the order you played in, and
// nothing cleverer is claimed for it.
// Worked out once, then kept until one of the two things it is made of
// changes.
//
// This list is the same list on every frame — the noteheads of the whole score
// paired off against the notes of one take — and it was being rebuilt inside
// the paint, which is to say on every frame of every pen stroke on a scanned
// part with a take loaded. Rebuilding it walks every page of the reading, spans
// every note of every page, and allocates a fresh object for each: a hundred
// times a second, to arrive at the same answer.
//
// Held against the IDENTITY of its two inputs rather than cleared by hand at
// the places that change them. A cache that has to be remembered about is a
// cache that will be forgotten about — and this one would go stale silently,
// as rings drawn round the notes of a take that is no longer on screen.
let scanMarks = null;
let scanMarksFrom = null;

function markedHeads() {
  const played = take?.notes ?? [];
  if (scanMarks && scanMarksFrom?.layout === layout && scanMarksFrom?.notes === played) {
    return scanMarks;
  }
  scanMarksFrom = { layout, notes: played };
  const heads = scanHeads();
  if (!heads.length || !played.length) {
    scanMarks = [];
    return scanMarks;
  }
  const count = Math.min(heads.length, played.length);
  scanMarks = heads.slice(0, count).map((head, i) => ({ ...head, cents: played[i]?.cents ?? 0 }));
  return scanMarks;
}

function drawScanMarks(ctx) {
  if (!isPaper() || !take?.notes?.length || !layout) return;
  const colours = {
    good: '--good', off: '--off', bad: '--bad', flatOff: '--flat-off', flatBad: '--flat-bad',
  };
  const style = getComputedStyle(document.documentElement);
  for (const head of markedHeads()) {
    // The same page-to-screen mapping the ink uses, so a ring and a fingering
    // written on the same note stay on the same note.
    const place = pageToScreen(head.page, head.x, head.y);
    if (place) drawOneMark(ctx, head, place, style, colours);
  }
}

function drawOneMark(ctx, head, place, style, colours) {
  {
    const { tier, direction } = intonationTone(head.cents);
    const token = tier === 'good' ? colours.good
      : direction === 'flat' ? (tier === 'off' ? colours.flatOff : colours.flatBad)
        : (tier === 'off' ? colours.off : colours.bad);
    ctx.save();
    ctx.strokeStyle = style.getPropertyValue(token).trim() || '#888';
    // Sized off the staff space the page reader measured, at the scale this
    // system is being shown — so a mark is the size of the notehead it rings.
    const { x, y } = place;
    const r = Math.max(3, head.space * place.unit * 0.62);
    ctx.lineWidth = Math.max(1, r * 0.26);
    ctx.beginPath();
    ctx.ellipse(x, y, r * 1.25, r * 0.95, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
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
  mine.replaceChildren(icon(on ? 'pause' : 'play'));
  mine.setAttribute('aria-label', on ? 'Pause the take' : 'Play the take');
}

// --- the door ----------------------------------------------------------------

// row: the score, with its parsed notes. take: the analysed take on screen, if
// there is one — used to light the notes as they play, not to colour the page.
export async function openReader(row, {
  take: analysed = null, setlist: programme = null, onSetlistMove = null,
} = {}) {
  // Notation needs its XML; paper needs nothing but the row, because its pages
  // live in a store of their own.
  if (!row || (row.kind !== 'pages' && !row.xml)) return null;
  build();
  score = row;
  take = analysed;
  setlist = programme;
  moveSet = onSetlistMove;
  pendingLink = null;
  strokes = (await loadAnnotations(row.id).catch(() => []))
    .map((stroke) => ({ ...stroke, points: stroke.points.map(onPaperNow) }));
  dropDryInk();     // a different piece, with different marks on it
  scanMarks = null;
  scanMarksFrom = null;
  history = [];
  redoable = [];
  layer = 0;
  hidden = new Set();
  picked = [];
  lasso = null;
  // A take opened with a scan arrives already marked: you came here from a
  // review, and hunting through a menu for the thing you came to see is a
  // menu getting in the way.
  painted = row.kind === 'pages' && !!analysed?.notes?.length;
  spread = wantsSpread();
  root.classList.toggle('spread', spread);
  try { night = globalThis.localStorage?.getItem(NIGHT_KEY) === 'on'; } catch { night = false; }
  root.classList.toggle('night', night);
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
  const opening = sayOpening(row);
  try {
    drawn.clear();
    await render();
  } catch (err) {
    opening.remove();
    close();
    throw err;
  }
  opening.remove();
  setTool(null);
  refreshBrushUI();
  refreshHistoryButtons();
  showPage(0);
  refreshPlayButton();
  refreshLandButton();
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
  // Closing is a re-laying-out like any other: draws still in flight belong to
  // a score that is no longer open, and none of them may report back.
  era++;
  drawn.clear();
  beingDrawn.clear();
  slices = [];
  sheet.replaceChildren();
  score = null;
  take = null;
  strokes = [];
  bars = new Map();
  // A frame asked for on the way out would paint a score that is gone against
  // measurements of pages that no longer exist.
  if (painting) { cancelAnimationFrame(painting); painting = 0; }
  invalidateGeometry();
  pageIndex = 0;
  wantedPage = 0;
  turnWay = 1;
  scanMarks = null;
  scanMarksFrom = null;
  dry = null;
  dryKey = null;
  lastInkAt = null;
  penPointer = null;
  armedByPen = false;
  stopHold();
  drawingPointer = null;
  drawing = null;
  lasso = null;
  picked = [];
  dragging = null;
  pointers.clear();
  pinch = null;
  pinching = false;
}

// Something to look at while the first page is being got ready.
//
// The reader is put on screen BEFORE it has anything to draw, deliberately —
// the tap that opened a part should do something immediately — and what it had
// until now was a black screen for however long the pages took. The CSS holds
// this back for a moment, so a part that opens in a fifth of a second (which,
// once it has been measured, every part does) never shows it at all.
function sayOpening(row) {
  const note = document.createElement('div');
  note.id = 'reader-opening';
  note.setAttribute('role', 'status');
  note.textContent = row?.name ? `Opening ${row.name}…` : 'Opening…';
  root.append(note);
  return note;
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
