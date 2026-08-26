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
import { saying } from './why.js';
import { followPlayback, takeIsPlaying, toggleTakePlayback } from './report.js';
import { openPaper } from './paper.js';
import { bandsOfPage } from './bands.js';
import { headsOf, pairNotes } from './scan-view.js';
import { parseScore } from '../analysis/musicxml.js';
import { syncTake } from '../analysis/scan-sync.js';
import { shapeFrom } from '../analysis/shape-snap.js';
import { pageTurn } from './pedal.js';
import { intonationHue } from './chart-utils.js';
import { actionMenu, closeAnyPop } from './controls.js';
import { aidsElement, showAids, hideAids, aidsShowing, stopAids } from './score-aids.js';
import { tap, readyHaptics } from './haptics.js';
import {
  loadAnnotations, saveAnnotations, loadScorePages, renameScore, deleteScore,
  saveBookmarks, saveLinks, saveScoreLayout, wasReadFromPages, saveCorrection,
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

// …and the pen case survives being put away.
//
// "The pen you put down is the pen you pick up" was already true within a
// session, and stopped being true the moment the app was closed: the brushes,
// the tool you were holding and the layers you had hidden are module state, so
// a reload handed back a factory-fresh dark ballpoint. A player who spent an
// evening marking bowings in green comes back the next day and re-mixes green.
// The size and the night setting were already remembered next door; this is the
// rest of the same idea.
const BRUSH_KEY = 'readerBrushes';

// Written a moment after the last change rather than on each one: dragging the
// size rail is a hundred calls to setBrush, and a hundred writes to storage for
// one decision about how thick a pencil is.
let brushSaveTimer = null;

function scheduleBrushSave() {
  clearTimeout(brushSaveTimer);
  brushSaveTimer = setTimeout(rememberBrushes, 300);
}

function rememberBrushes() {
  try {
    globalThis.localStorage?.setItem(BRUSH_KEY, JSON.stringify({
      brushes, lastInk, layer, hidden: [...hidden], stamp: stamp?.glyph, eraserWidth, fingerInk,
    }));
  } catch { /* a pen that will not be remembered still writes */ }
}

function recallBrushes() {
  let saved = null;
  try { saved = JSON.parse(globalThis.localStorage?.getItem(BRUSH_KEY) ?? 'null'); } catch { saved = null; }
  if (!saved) return;
  // Merged onto the defaults rather than trusted wholesale: a half-written or
  // out-of-date entry should cost you a colour, not the ability to draw.
  for (const key of ['pen', 'highlighter']) {
    const one = saved.brushes?.[key];
    if (one && typeof one === 'object') Object.assign(brushes[key], one);
  }
  if (INKS.includes(saved.lastInk)) lastInk = saved.lastInk;
  if (Number.isInteger(saved.layer) && saved.layer >= 0 && saved.layer < LAYER_NAMES.length) {
    layer = saved.layer;
  }
  if (Array.isArray(saved.hidden)) {
    hidden = new Set(saved.hidden.filter((i) => Number.isInteger(i) && i < LAYER_NAMES.length));
  }
  const found = STAMPS.find((s) => s.glyph === saved.stamp);
  if (found) stamp = found;
  if (ERASER_SIZES.includes(saved.eraserWidth)) eraserWidth = saved.eraserWidth;
  if (['auto', 'on', 'off'].includes(saved.fingerInk)) fingerInk = saved.fingerInk;
}

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
// Whether this notation came off a photographed page. It changes how it is
// drawn — every staff, the page's own line breaks, a page per printed page —
// see wasReadFromPages and engraveAsPrinted.
let asPrinted = false;
// Correcting the notes: which note is chosen, where every notehead is, and the
// scores as they were before each change so a wrong tap can be taken back.
let correcting = false;
let chosen = null;      // a note id
let noteHits = [];      // { id, el }
let undoStack = [];
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
// How far down the screen counts as "the top", where a tap is a reach for the
// controls rather than a page turn.
//
// It was a sixth, and a sixth of a phone is about two finger-widths — you had
// to aim at it, and a player holding a bow does not aim. A quarter is a strip
// you can hit without looking, and it costs the turn zones nothing that
// matters: the page still turns from anywhere in the lower three quarters,
// which is where a hand reaching for the corner of a page actually lands.
const TOP_REACH = 0.25;

// Everything on top of the music that is a CONTROL rather than the page.
//
// Four separate gestures ask this same question — the turn on the way down, the
// swipe, the tap, and the pencil arming itself — and each of them used to carry
// its own copy of the answer. They had already drifted apart by one entry, and
// every control added afterwards was a bug waiting in whichever list somebody
// forgot. There is one list.
// `#reader-record` is not listed separately any more: it sits inside
// `#reader-top`, which is, so a press on it was already not a page turn.
const CHROME = '#reader-top, #reader-ink-bar, #reader-menu, #reader-brush,'
  + ' #reader-selection, #reader-land, #reader-aids, .pick-pop, dialog';

// Was this touch on the chrome rather than on the music?
function onChrome(e) {
  return !!e.target?.closest?.(CHROME);
}

const el = (id) => document.querySelector(`#${id}`);

// Is a part on the stand right now? Asked by the document-level guards, which
// run for the whole app and must only bite while the reader is up.
function isReading() {
  return !!root && !root.hidden;
}

// Whatever the webview decided to highlight, un-highlighted. Wrapped because
// there is no version of this that is worth throwing over.
function dropSelection() {
  try {
    const chosen = getSelection();
    if (chosen && !chosen.isCollapsed) chosen.removeAllRanges();
  } catch { /* nothing to clear */ }
}

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
  const box = target?.getBoundingClientRect() ?? null;
  // A canvas with no size is a page whose pixels iOS has taken back, or one
  // that has not been drawn yet. Its rectangle is a point, and a point is not
  // somewhere a mark can be placed — so everything measured against it comes
  // back as nothing and the pen quietly stops working on that page. The
  // container is where the page WILL be, which is near enough to write on
  // while the picture catches up.
  if (box && box.width > 0 && box.height > 0) return box;
  return node.getBoundingClientRect();
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
// Ink, read on a black page.
//
// The engraving is inverted for the dark and the ink deliberately is not — a
// red circle you drew round an accidental has to still be a red circle, and
// running somebody's annotations through a filter to suit the room is changing
// their notes rather than the lighting. But the commonest pen in the case is a
// pencil, which is very nearly black, and a very nearly black line on a black
// page is a mark you cannot find. In a pit, in the dark, that is the annotation
// you needed most.
//
// So the HUE is left exactly alone and only the LIGHTNESS is lifted, and only
// for ink too dark to see. A pencil comes up to the grey a pencil looks like on
// white paper; a red, a blue, a green — anything already bright enough — is not
// touched at all. The stroke itself is never altered: this is a lamp held over
// the page, not a change to what is on it.
const afterDarkCache = new Map();
let colourProbe = null;

function afterDark(colour) {
  const known = afterDarkCache.get(colour);
  if (known) return known;
  let out = colour;
  try {
    // Any CSS colour, resolved to numbers by the one thing that already knows
    // how to read all of them.
    if (!colourProbe) colourProbe = document.createElement('canvas').getContext('2d');
    colourProbe.fillStyle = '#000';
    colourProbe.fillStyle = colour;
    const [r, g, b, a] = parseColour(colourProbe.fillStyle);
    const { h, s, l } = rgbToHsl(r, g, b);
    if (l < 42) {
      const lifted = Math.min(88, 62 + l * 0.5);
      out = `hsla(${Math.round(h)} ${Math.round(Math.max(s, 6))}% ${Math.round(lifted)}% / ${a})`;
    }
  } catch { /* an ink the browser cannot read is an ink drawn as it was */ }
  afterDarkCache.set(colour, out);
  return out;
}

// The two shapes a canvas normalises a colour into.
function parseColour(text) {
  const hex = /^#([0-9a-f]{6})$/i.exec(text);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const parts = text.match(/[\d.]+/g) ?? [];
  return [Number(parts[0]) || 0, Number(parts[1]) || 0, Number(parts[2]) || 0,
    parts[3] === undefined ? 1 : Number(parts[3])];
}

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
  const wash = stroke.overlay ?? stroke.tool === 'highlighter';
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const paint = night && !wash ? afterDark(strokeColour(stroke)) : strokeColour(stroke);
  ctx.strokeStyle = paint;
  ctx.fillStyle = paint;
  // A highlighter goes UNDER the notes rather than over them: multiply keeps
  // the black of the engraving showing through a wash of colour, which is what
  // a real one does to paper.
  if (wash) ctx.globalCompositeOperation = 'multiply';
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
// Rubbing out PART of a mark, not all of it.
//
// The eraser used to take whole strokes: touch any of a phrase-long highlight
// and the whole phrase went. That is not what an eraser is. On paper you rub
// out the bit you got wrong and the rest of the line stays, which is the whole
// reason a pencil is worth using — and it is what every drawing app on a tablet
// does.
//
// So the points under the rubber are taken out and what is left on either side
// carries on as marks in its own right, in the same ink, on the same layer,
// anchored to the same bars. A stroke rubbed through the middle becomes two; a
// stroke rubbed at the end becomes a shorter one; a stroke rubbed out entirely
// simply goes.
//
// Three things stay whole, because there is no "part" of them to keep: a piece
// of text, a stamp, and a shape, all of which are one thing that is either
// there or not.
const ERASER_SIZES = [0.7, 1.6, 3.2, 6];
const ERASER_KEY = 'readerEraser';
let eraserWidth = ERASER_SIZES[1];

function eraseAt(px, py) {
  const scale = unitScale();
  const reach = Math.max(3, eraserWidth * scale);
  const shown = visiblePages();
  const gone = [];       // marks this touch took away
  const made = [];       // what is left of them
  const kept = [];
  for (const stroke of strokes) {
    if (hidden.has(stroke.layer ?? 0) || !touchesScreen(stroke, shown)) {
      kept.push(stroke);          // out of sight, or on another page: out of reach
      continue;
    }
    const under = (point) => {
      const at = place(point);
      return !!at && Math.hypot(at.x - px, at.y - py) <= reach;
    };
    // One thing, whole or not at all.
    if (stroke.type === 'text' || stroke.type === 'shape' || stroke.points.length < 2) {
      if (stroke.points.some(under)) gone.push(stroke);
      else kept.push(stroke);
      continue;
    }
    if (!stroke.points.some(under)) { kept.push(stroke); continue; }
    gone.push(stroke);
    // The runs the rubber did not touch. A run of one point is a dot the hand
    // never meant — the remains of a line, not a mark — so it is dropped.
    let run = [];
    for (const point of stroke.points) {
      if (under(point)) {
        if (run.length > 1) made.push({ ...stroke, points: run });
        run = [];
      } else {
        run.push(point);
      }
    }
    if (run.length > 1) made.push({ ...stroke, points: run });
  }
  if (!gone.length) return;
  strokes = [...kept, ...made];
  // One sweep of the eraser is one undo, however many marks it caught: the
  // gesture is what a hand remembers doing.
  const last = history.at(-1);
  if (erasing && last?.type === 'erase') {
    // A fragment this sweep made a moment ago, now rubbed out by the same
    // sweep, was never a mark the player had: it is struck off the list of
    // things this sweep created rather than added to the list of things it
    // destroyed. Otherwise one undo would both put it back and take it away.
    for (const stroke of gone) {
      const born = last.made.indexOf(stroke);
      if (born >= 0) last.made.splice(born, 1);
      else last.strokes.push(stroke);
    }
    last.made.push(...made);
  } else {
    remember({ type: 'erase', strokes: gone, made });
  }
  redraw();
  scheduleSave();
}

function setEraserWidth(width) {
  eraserWidth = width;
  try { globalThis.localStorage?.setItem(ERASER_KEY, String(width)); } catch { /* fine */ }
  refreshBrushUI();
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
  // A hold that has done its work should feel like it did. Said through the
  // one door now — this used to be a bare navigator.vibrate, which iOS has
  // never implemented, so the single place the reader answered a gesture with
  // a feeling was answering it everywhere except on the hardware it is for.
  tap('snap');
  redraw();
}

let erasing = false;
// The lasso: a loop drawn round marks, and then what you do with them. Kept
// apart from the drawing tools because it does not add ink — it picks up ink
// that is already there.
let lasso = null;        // the loop being drawn, in screen points
let picked = [];         // the strokes inside it
let dragging = null;     // { x, y } while the selection is being moved
let pendingPlace = null; // { tool, point } this gesture will leave, if it is a tap

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
  // Where on the music this is — and if the answer is "nowhere", ASK AGAIN.
  //
  // This is the "sometimes I write and nothing happens". A mark is held against
  // the bar it was drawn over, and working out which bar means measuring the
  // page; if that measurement comes back empty the stroke was silently dropped
  // — no ink, no error, nothing to notice except that the pen did not work that
  // one time.
  //
  // It comes back empty for one reason: the measurements were taken before the
  // page they describe was ready. Every page turn and every re-engraving throws
  // them away and they are re-taken on the next frame, so a pen that lands in
  // the gap between the two — which is exactly what writing straight after a
  // turn does — asks a cache that has nothing in it yet. Measuring again on the
  // spot costs a frame and answers every time.
  let point = anchor(at.x, at.y);
  if (!point) {
    invalidateGeometry();
    point = anchor(at.x, at.y);
  }
  if (!point) return;
  nibPressure(point, e);
  lastInkAt = at;
  strokeTravel = 0;
  // The tools that PLACE a thing do it when the finger lifts, not when it lands.
  //
  // At the moment a contact arrives there is no way to tell whether a second
  // one is on its way: there is one entry in `pointers`, `pinch` is null, and
  // the first finger of a pinch is indistinguishable from a tap. So acting on
  // the way down meant every pinch made with one of these in hand did its thing
  // before the pinch began — a sharp dropped on the page, or a keyboard thrown
  // up over the music — and since a freshly placed sign is held, what the pinch
  // then resized was the accident rather than the sign you had reached for.
  // Reaching to make a flat bigger left another flat behind it, every time.
  //
  // This is what you MIGHT have meant; endStroke decides that you did, and
  // cancelStroke throws it away the moment two fingers turn out to be a pinch.
  // A modal still opens inside the gesture that asked for it, which is what iOS
  // requires — a lift is as much a gesture as a press.
  if (tool === 'text' || tool === 'stamp') { pendingPlace = { tool, point }; return; }
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
  else if (point) {
    strokeTravel += lastInkAt ? Math.hypot(at.x - lastInkAt.x, at.y - lastInkAt.y) : 0;
    drawing.points.push(point);
    lastInkAt = at;
  }
  if (drawing.type !== 'shape') watchForHold(at);
  if (!quiet) redraw();
}

// How far the pen has to travel before it counts as somewhere else. A third of
// a pixel: below what any screen can draw, above what a still hand reports.
const INK_STEP = 0.34;
let lastInkAt = null;
// How far a stroke has travelled across the glass. Under TAP_INK it was a tap,
// however many positions the device reported along the way — see endStroke.
const TAP_INK = 4;
let strokeTravel = 0;

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
  // A pencil's stroke is not a thing to cancel.
  //
  // This exists for the finger that turns out to have been the first half of a
  // pinch. A pencil is never part of a pinch — it is not even counted among
  // the pointers on the glass — so nothing that cancels a finger's gesture has
  // any business throwing away a pencil's. It is FINISHED instead, and what
  // was drawn is kept.
  if (penStroke.live) { penStroke.end(); return; }
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
  // The sign that was never placed. This is the whole point of holding it back:
  // the finger that was about to stamp turned out to be half of a pinch, and a
  // pinch is a request to resize what is already there, never to add to it.
  pendingPlace = null;
  // What was PICKED stays picked. Pinching in to look closer at a selection is
  // a reasonable thing to do to one, and losing it for that would be its own
  // small betrayal.
  redraw();
}

function endStroke() {
  stopHold();
  lastInkAt = null;
  // A thing that survived the gesture: one finger went down and the same finger
  // came up, so it was a tap and it meant what it said.
  if (pendingPlace) {
    const { tool: what, point } = pendingPlace;
    pendingPlace = null;
    if (what === 'text') writeText(point);
    else placeStamp(point);
    return;
  }
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
  // A stroke that went nowhere was a TAP.
  //
  // "More than one point" was the test, and a finger cannot put one point on a
  // sheet of glass: resting it and lifting it reports two or three positions a
  // pixel apart, which came out as a stray speck of ink on the page. Worse, it
  // counted as writing — so the tap that was meant to send the tool bar away
  // was read as annotating and the bar stayed exactly where it was. That is
  // the "sometimes tapping to get rid of the bar doesn't work" of it.
  //
  // Four pixels of travel is under anything a hand does on purpose and over
  // everything it does by accident. A deliberate dot is a stamp, and there is
  // one on the bar.
  if (drawing && drawing.points.length > 1 && strokeTravel >= TAP_INK) {
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

// How far past a boundary a thing follows before it stops following.
//
// A hard stop is the one thing in this reader that could be mistaken for the
// app having crashed: the page freezes under two fingers that are still moving,
// and there is nothing on screen to say whether that is a limit or a hang.
// Every other surface on an iPad answers this the same way — it keeps moving,
// less and less — and that reads as "still listening, nothing more this way",
// which is a different sentence entirely.
//
// Apple's own curve. The `constant` is how quickly the give runs out.
function rubberband(past, span, constant = 0.55) {
  if (!span) return 0;
  return (past * span * constant) / (span + constant * Math.abs(past));
}

// How far the page may be pushed at this zoom before it is out of bounds. The
// rule itself has not changed: at any zoom you can push a corner to the middle
// and no further, or a page could be lost off the edge with no way back.
function panBounds() {
  const box = currentPage()?.getBoundingClientRect();
  if (!box) return null;
  return {
    x: Math.max(0, (box.width - window.innerWidth) / 2 + window.innerWidth * 0.25),
    y: Math.max(0, (box.height - window.innerHeight) / 2 + window.innerHeight * 0.25),
  };
}

function clampPan() {
  const bound = panBounds();
  if (!bound) return;
  panX = Math.min(bound.x, Math.max(-bound.x, panX));
  panY = Math.min(bound.y, Math.max(-bound.y, panY));
}

// The same, but with give — used only while two fingers are actually down.
// The moment they leave, settleZoom takes it back to the real boundary.
function bandPan() {
  const bound = panBounds();
  if (!bound) return;
  const give = Math.max(120, window.innerWidth * 0.35);
  if (panX > bound.x) panX = bound.x + rubberband(panX - bound.x, give);
  else if (panX < -bound.x) panX = -bound.x - rubberband(-bound.x - panX, give);
  if (panY > bound.y) panY = bound.y + rubberband(panY - bound.y, give);
  else if (panY < -bound.y) panY = -bound.y - rubberband(-bound.y - panY, give);
}

// Out of bounds is a state the page may be in only while it is being held.
//
// Animated back rather than snapped, and from wherever it actually is rather
// than from where the pinch thought it was — so a second pinch landing during
// the settle takes over from the picture on screen instead of fighting it.
// Interruptible is the whole point: cancelled outright the moment two fingers
// arm a new pinch.
let settling = null;

function stopSettle() {
  if (settling) cancelAnimationFrame(settling);
  settling = null;
}

function settleZoom() {
  stopSettle();
  const bound = panBounds();
  const wantZoom = Math.min(ZOOM_LIMIT, Math.max(1, zoom));
  const wantX = wantZoom === 1 ? 0 : Math.min(bound?.x ?? 0, Math.max(-(bound?.x ?? 0), panX));
  const wantY = wantZoom === 1 ? 0 : Math.min(bound?.y ?? 0, Math.max(-(bound?.y ?? 0), panY));
  if (zoom === wantZoom && panX === wantX && panY === wantY) return;
  const fromZoom = zoom;
  const fromX = panX;
  const fromY = panY;
  const began = performance.now();
  const RUN = 280;
  const step = (now) => {
    const t = Math.min(1, (now - began) / RUN);
    // Critically damped in feel: fast out of the overshoot, no bounce coming
    // back. A page of music that springs past its own edge twice is a page
    // playing with you, and you are trying to read it.
    const e = 1 - (1 - t) ** 3;
    zoom = fromZoom + (wantZoom - fromZoom) * e;
    panX = fromX + (wantX - fromX) * e;
    panY = fromY + (wantY - fromY) * e;
    applyZoom();
    if (t < 1) { settling = requestAnimationFrame(step); return; }
    settling = null;
    zoom = wantZoom; panX = wantX; panY = wantY;
    applyZoom();
    if (isPaper() && zoom > 1) redrawPaperAtZoom();
  };
  settling = requestAnimationFrame(step);
}

function resetZoom() {
  // Anything animating its way back to a boundary is answering a gesture that
  // has just been overruled by a button.
  stopSettle();
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
// When the pencil was last heard from. It is deliberately NOT kept in the
// pointer map — arming a tool from a pencil touch returns before anything is
// counted — which meant the sweep that forgets abandoned fingers could never
// forget an abandoned PENCIL. One missed lift and the reader believed a pencil
// was on the glass for the rest of the session: every finger turned away at the
// door, every finger tap ignored, the bar refusing to go. This is how it is
// noticed instead.
let penSeenAt = 0;

// --- when the pencil does not write -------------------------------------------
//
// Every path that can refuse a pencil is now either fixed or impossible, and
// that sentence has been true before. Installed from the home screen there is
// no console, so a stroke that fails on a real iPad and not on any machine here
// leaves nothing behind to look at — which is why "sometimes it doesn't work"
// has been so hard to pin down.
//
// So the reader keeps count. Every pencil touch that should have made a mark
// and did not is recorded with the reason, and Settings can show the tally. A
// number is worth more than a memory of it happening.
const inkTrouble = [];
// How many pencil strokes went down, and how many came back. A list of
// refusals with no denominator cannot tell "everything worked" from "three
// vanished down a path that logs nothing" — they both read as zero.
const penStrokes = { began: 0, ended: 0 };

function penRefused(why) {
  inkTrouble.push(why);
  if (inkTrouble.length > 40) inkTrouble.shift();
}

// What the pencil has been refused for, since the app started.
export function inkReport() {
  const tally = new Map();
  for (const why of inkTrouble) tally.set(why, (tally.get(why) ?? 0) + 1);
  return {
    total: inkTrouble.length,
    began: penStrokes.began,
    ended: penStrokes.ended,
    marks: strokes.length,
    reasons: [...tally].map(([why, n]) => `${why} x${n}`),
  };
}
// The gesture that picked the pen up must not also be the gesture that puts it
// down again — see onTap, which normally reads a tap that made no mark as "I
// have finished writing".
let armedByPen = false;

function penIsDown() {
  return penPointer !== null;
}

// Nothing is judged by how big it is any more.
//
// There WAS a rule here that a contact wider than 45px is the heel of a hand
// rather than a fingertip, and it was wrong about a real iPad. A synthetic
// touch reports a tidy 16px; a fingertip actually pressed against glass
// reports its whole contact ellipse, which on a thumb is easily past that —
// so both fingers of a pinch were being read as palms and thrown away, and
// pinching to zoom stopped working altogether.
//
// It is not needed. What it was for — a resting hand making the reader believe
// a pinch was under way, and eating every tap — is fixed by the rule below
// instead: a pinch is two contacts MOVING relative to one another, which is
// the one thing a hand resting on a tablet never does. Judging a gesture by
// what it does beats judging it by how fat it is.

// --- who is allowed to draw ---------------------------------------------------
//
// forScore has a setting called "prevent finger drawing", and it is there
// because on a tablet a finger is two things at once: the thing that works the
// app, and — if you let it — the thing that writes on the music. Every touch
// then has to be guessed at, and the guess is sometimes wrong: a fingertip
// steadying the iPad leaves a comma across a bar, a tap meant for the tool bar
// comes out as a dot.
//
// With the pencil doing all the writing, none of that has to be guessed. A
// finger becomes unambiguous — it turns pages, it works the bar, it never
// marks the page — and the pencil becomes unambiguous too, which is most of
// why writing "just works" once this is on.
//
// Three states rather than two, because a phone has no pencil and must still
// be able to annotate. Left alone it decides for itself: the moment an Apple
// Pencil touches this device, fingers stop writing. Say otherwise with the
// button and it is remembered.
const PENCIL_SEEN_KEY = 'readerPencilSeen';
let fingerInk = 'auto';        // 'auto' | 'on' | 'off'
let pencilSeen = false;

function canFingerDraw() {
  if (fingerInk === 'on') return true;
  if (fingerInk === 'off') return false;
  return !pencilSeen;
}

function noteAPencil() {
  if (pencilSeen) return;
  pencilSeen = true;
  try { globalThis.localStorage?.setItem(PENCIL_SEEN_KEY, 'yes'); } catch { /* fine */ }
  refreshFingerButton();
}

function toggleFingerInk() {
  fingerInk = canFingerDraw() ? 'off' : 'on';
  refreshFingerButton();
  scheduleBrushSave();
  say(canFingerDraw()
    ? 'your finger can write on the page'
    : 'only the pencil writes — your finger works the app');
  clearTimeout(fingerSaid);
  fingerSaid = setTimeout(() => { if (!pendingLink) say(''); }, 2400);
}
let fingerSaid = null;

function refreshFingerButton() {
  const button = el('reader-finger');
  if (!button) return;
  const on = canFingerDraw();
  button.classList.toggle('on', on);
  button.setAttribute('aria-pressed', String(on));
  button.title = on
    ? 'Your finger can write — tap to let only the pencil write'
    : 'Only the pencil writes — tap to let your finger write too';
  button.setAttribute('aria-label', button.title);
}

// The pencil has landed on the music with no tool in hand.
function armPencil(e) {
  if (!root || root.hidden) return false;
  noteAPencil();
  if (isMenuOpen()) { penRefused('a menu was open'); return false; }
  // Not on the chrome: a pencil is a perfectly good way to press a button.
  if (onChrome(e)) {
    const what = e.target?.id || e.target?.className || e.target?.tagName || '?';
    penRefused(`the touch landed on the chrome (${what})`);
    return false;
  }
  // Nor over a jump you taped down, or the one you are in the middle of taping.
  if (pendingLink) { penRefused('a jump was being taped down'); return false; }
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
  // Through the SAME door as every other pencil stroke.
  //
  // This used to start the stroke itself — its own live flag, its own
  // beginStroke — which meant the first stroke of every session, the one that
  // arms the tool, was the one with no raw path recorded, no try/catch round
  // it and nothing logged if it failed. The one most likely to be lost was the
  // one nothing was watching. Called after setTool above, because begin()
  // refuses outright when no tool is out.
  penStroke.begin(e);
  return true;
}

// --- the pencil, on a road of its own -----------------------------------------
//
// Everything else in this reader is worked out from the pointers on the glass:
// how many there are, which one owns the stroke, whether two of them are a
// pinch. That machinery exists for FINGERS, which are ambiguous — a finger
// might be turning a page, or pinching, or writing — and it has to be, because
// the only way to tell is to watch what the finger does next.
//
// A pencil is not ambiguous. There is one of them, it is only ever writing, and
// no amount of watching will reveal otherwise. Routing it through the finger
// machinery meant it inherited every one of that machinery's ways of going
// wrong, and each of them ended the same way: a stroke that began, was recorded
// as begun, and then quietly received none of its own movement. One point, no
// line, thrown away as a tap. Nothing refused, nothing logged, and no way to
// tell from the outside except that the pen did not write that once.
//
// So it has its own road. Handled at the top, before anything is counted, on
// the element that sees every event whatever the page underneath it is doing:
//
//   it does not depend on which element was under the tip, so a canvas that has
//   not been drawn yet cannot swallow it;
//   it does not depend on pointer capture, so a capture that is refused or lost
//   cannot strand it;
//   it does not depend on the id matching, so a contact iOS renumbers mid-
//   stroke cannot orphan it;
//   and it is not counted among the fingers, so it can neither cause a pinch
//   nor be stopped by one.
//
// There is one pencil. While it is down it is drawing. That is the whole rule.
const penStroke = {
  live: false,
  // Where the pencil actually went, written down the moment it is heard and
  // before anything is done with it.
  //
  // This is the safety net, and it is deliberately not clever. Every other
  // record of a stroke is downstream of machinery that has now failed three
  // times in ways nobody could reproduce: the anchoring, the thinning, the
  // coalesced samples, the caches. This is the raw positions, kept by the
  // outermost handler in the app, and if a stroke reaches its end having
  // collected nothing while this holds a path, the stroke is rebuilt from it.
  // A mark drawn from these is a mark the hand actually made, even if
  // everything between here and the page went wrong.
  raw: [],

  begin(e) {
    // EVERY way out of here says so.
    //
    // The refusal log used to sit below all of these, so a stroke turned away
    // at the door left no trace whatsoever — and the panel read "nothing was
    // refused" while the pencil visibly did not write. Three rounds were spent
    // guessing at a bug the instrumentation could not see. A silent return is
    // the thing that made this hard, not the bug behind it.
    if (!tool) { penRefused('no tool was out'); return; }
    if (onChrome(e)) {
      const what = e.target?.id || e.target?.className || e.target?.tagName || '?';
      penRefused(`the touch landed on the chrome (${what})`);
      return;
    }
    if (pendingLink) { penRefused('a jump was being taped down'); return; }
    // A stroke still open — a lift that never arrived — is finished, not
    // thrown away: what was drawn is what you drew.
    if (this.live || drawing || drawingPointer !== null) {
      this.live = false;
      drawingPointer = null;
      endStroke();
    }
    this.live = true;
    penStrokes.began += 1;
    this.raw = [{ x: e.clientX, y: e.clientY }];
    drawingPointer = e.pointerId;
    marksAtDown = strokes.length;
    try {
      beginStroke(e);
    } catch (err) {
      penRefused(`the stroke could not be started (${err.name}: ${err.message})`);
    }
    if (!drawing && !['eraser', 'lasso', 'text', 'stamp'].includes(tool)) {
      penRefused('the page could not place the touch');
    }
  },

  // What the last stroke came to. Read by the diagnostic, so "it did not
  // write" stops being a thing only the player can see.
  report() {
    return { live: this.live, points: drawing?.points?.length ?? 0 };
  },

  extend(e) {
    if (!this.live || !tool) return;
    // Written down FIRST, before anything that could throw.
    if (this.raw.length < 4000) this.raw.push({ x: e.clientX, y: e.clientY });
    // Every position the device actually sampled, not just the one it got
    // round to telling us about — iPadOS gathers a pencil at 240Hz and hands
    // the extra ones over in a single move.
    //
    // Wrapped, and the wrapping is the point. A throw anywhere in here — a
    // getCoalescedEvents that WebKit refuses on an event it no longer
    // considers current, a coalesced entry with no coordinates, anything —
    // leaves the stroke alive but never extended again: it collects one point
    // and is thrown away on the lift as a tap. Which is precisely the shape of
    // the bug that has survived three attempts to fix it. A stroke may now
    // fail, but it may not fail QUIETLY.
    let moves = null;
    try {
      moves = e.getCoalescedEvents?.() ?? null;
    } catch (err) {
      penRefused(`the device refused its own samples (${err.name})`);
      moves = null;
    }
    try {
      if (moves && moves.length > 1) {
        for (const move of moves) extendStroke(move, { quiet: true });
      } else {
        extendStroke(e, { quiet: true });
      }
    } catch (err) {
      // Fall back to the plain event rather than losing the movement.
      penRefused(`a sample could not be drawn (${err.name}: ${err.message})`);
      try { extendStroke(e, { quiet: true }); } catch { /* the stroke is what it is */ }
    }
    redraw();
  },

  end() {
    if (!this.live) return;
    this.live = false;
    drawingPointer = null;
    const began = marksAtDown;

    // The net, and it is no longer gated on the stroke still existing.
    //
    // It used to ask "was there a mark under way?" before rebuilding one — and
    // every silent path this bug could take is a path that THROWS THE MARK
    // AWAY while leaving the stroke live: a pinch cancelling it, the app being
    // backgrounded, a pointer presumed lost. In exactly the cases the net was
    // written for, the net was disarmed, and nothing was written down either.
    // Which is why the diagnostic could read clean while the pencil visibly
    // failed.
    //
    // So the question is now the only one that matters: did the pencil travel,
    // and did anything get committed? If it travelled and nothing did, the
    // mark is rebuilt from where it travelled — building it from nothing if
    // need be. For a pencil there is no such thing as a stroke that was
    // rightly discarded: it is never part of a pinch, so nothing that cancels
    // a finger's gesture has any business cancelling this one. A pen stroke
    // interrupted by anything at all is still a mark the hand made.
    // Only for the tools that MAKE a mark. A lasso, a rubber, a stamp and a
    // piece of text all legitimately leave `drawing` empty — rebuilding "the
    // stroke" from the path of a rubber would ink in everything it had just
    // rubbed out.
    const marking = !['eraser', 'lasso', 'text', 'stamp'].includes(tool);
    const thin = (drawing?.points?.length ?? 0) <= 1;
    if (marking && thin && this.raw.length > 2) {
      const rescued = [];
      for (const at of this.raw) {
        const point = anchor(at.x, at.y);
        if (point) rescued.push(point);
      }
      if (rescued.length > 1) {
        const brush = currentBrush();
        drawing = {
          ...(drawing ?? {
            tool,
            layer,
            colour: brushCss(brush),
            width: brush.width,
            overlay: brush.overlay,
            nib: brush.nib,
          }),
          points: rescued,
        };
        delete drawing.freehand;
        delete drawing.snapped;
        strokeTravel = TAP_INK;   // it travelled; that is what raw says
        penRefused(`a stroke was rebuilt from the raw path (${rescued.length} points)`);
      }
    }
    const points = drawing?.points?.length ?? 0;
    this.raw = [];
    try {
      endStroke();
    } catch (err) {
      penRefused(`the stroke could not be finished (${err.name}: ${err.message})`);
    }
    if (marking && points <= 1 && strokes.length === began) {
      penRefused('the stroke began and nothing came of it');
    }
    penStrokes.ended += 1;
  },
};

function trackPointers(root) {
  root.addEventListener('pointerdown', (e) => {
    armedByPen = false;
    usedNow();
    // Before anything is counted, anything that is no longer there is dropped.
    forgetLostPointers(e.timeStamp);
    if (e.pointerType === 'pen') {
      penPointer = e.pointerId;
      penSeenAt = e.timeStamp;
      noteAPencil();
      // Picking the pencil up again is going back to annotating.
      //
      // A tap with a finger takes the bar away and leaves the tool in your
      // hand, which is what you want while you are reading what you just
      // wrote. Touching the page with the pencil after that is the other half
      // of the same sentence — forScore calls the pair instant annotation —
      // so the bar comes back with the tool that was never put down.
      // A hand that was already resting on the screen when the pencil arrived
      // is the same hand, and it must not be sitting in the map looking like
      // the first finger of a pinch.
      for (const [id, spot] of [...pointers]) if (spot.touch) pointers.delete(id);
      pinch = null;
      pinching = false;
      if (!tool && armPencil(e)) return;
      // With a tool already in hand, the pencil draws — and it draws from
      // HERE, not from the ink canvas. See penStroke below for why.
      //
      // The stroke starts BEFORE the bar is shown. Showing it first meant the
      // bar could appear over the very touch that asked for it and then be the
      // reason that touch was refused as "a tap on the chrome" — a stroke lost
      // to the thing it summoned.
      if (tool) {
        penStroke.begin(e);
        if (!chrome && !onChrome(e)) setChrome(true);
      }
      // A pencil is never one of the fingers of a pinch, so it is never
      // counted as one. `pointers` is the hand on the glass and nothing else;
      // the pencil is followed by penPointer, which has its own watchdog. Put
      // in here, a pencil whose lift went missing made the NEXT touch look
      // like the second finger of a pinch — and a pinch stops the drawing.
      return;
    } else if (penIsDown() && e.pointerType === 'touch') {
      return;   // the palm
    }
    pointers.set(e.pointerId, {
      x: e.clientX, y: e.clientY, touch: e.pointerType === 'touch', at: e.timeStamp,
    });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      // ARMED, not started.
      //
      // Two contacts used to mean a pinch outright, and that is not what two
      // contacts mean on a tablet you are holding: it means a hand resting and
      // a finger doing something. So the second one only sets the pinch up, and
      // nothing is a pinch until the two of them actually move apart or
      // together — which is the one thing a resting hand never does.
      // Where the page's own middle is on the glass, which is the point every
      // scale is taken about. Scaling about the middle does not MOVE the
      // middle, so whatever the page is doing right now, subtracting the pan
      // from the middle of its rendered box gives the untransformed one — no
      // second measurement, and true at any zoom.
      const box = sheet?.getBoundingClientRect();
      pinch = {
        distance: Math.hypot(a.x - b.x, a.y - b.y),
        x: (a.x + b.x) / 2,
        y: (a.y + b.y) / 2,
        zoom,
        panX,
        panY,
        cx: box ? box.left + box.width / 2 - panX : window.innerWidth / 2,
        cy: box ? box.top + box.height / 2 - panY : window.innerHeight / 2,
      };
    }
  }, true);
  root.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'pen') {
      penSeenAt = e.timeStamp;
      penStroke.extend(e);
    }
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, {
      x: e.clientX, y: e.clientY, touch: e.pointerType === 'touch', at: e.timeStamp,
    });
    forgetLostPointers(e.timeStamp);
    if (pointers.size !== 2 || !pinch) return;
    const [a, b] = [...pointers.values()];
    const distance = Math.hypot(a.x - b.x, a.y - b.y);
    // …and now it IS one. Waiting for real movement is what tells a pinch from
    // a hand that happens to be on the glass.
    if (!pinching) {
      if (Math.abs(distance - pinch.distance) < PINCH_START) return;
      pinching = true;
      clearTimeout(pinchOver);
      // A settle still running belongs to the LAST pinch, and this one has the
      // page now. Cancelled rather than allowed to finish, or the two of them
      // write to the same transform on alternate frames.
      stopSettle();
      drawingPointer = null;
      cancelStroke();   // that first finger was not drawing, it was pinching
      // And the chips go away for the duration. `pinching` is what hides them,
      // but nothing repaints on its own between here and the end of the pinch:
      // said only in refreshSelectionBar, the bar raised by the sign you are
      // about to resize would simply stay up under your fingers.
      refreshSelectionBar();
    }
    // With marks picked up, a pinch means those marks rather than the page. It
    // is the only thing it could mean: you have said which marks you are
    // talking about, and then made the gesture for bigger or smaller.
    if (picked.length) {
      const was = pinch.sized ?? pinch.distance;
      if (was > 0) scaleSelection(distance / was);
      pinch.sized = distance;
      return;
    }
    const x = (a.x + b.x) / 2;
    const y = (a.y + b.y) / 2;
    // Past either limit the page keeps growing, less and less, instead of
    // stopping dead under fingers that are still moving. Done in zoom itself
    // rather than in pixels, so the give is the same fraction of a page at
    // both ends. Said ONCE per crossing — the tap is "you have arrived at the
    // edge", and a tap on every frame of sitting there is a rattle.
    const asked = pinch.zoom * (distance / (pinch.distance || 1));
    const wasEdged = pinch.edged ?? false;
    if (asked > ZOOM_LIMIT) {
      zoom = ZOOM_LIMIT + rubberband(asked - ZOOM_LIMIT, ZOOM_LIMIT * 0.6);
      pinch.edged = true;
    } else if (asked < 1) {
      zoom = Math.max(0.55, 1 - rubberband(1 - asked, 0.9));
      pinch.edged = true;
    } else {
      zoom = asked;
      pinch.edged = false;
    }
    if (pinch.edged && !wasEdged) tap('edge');
    // The music stays under the fingers.
    //
    // The pan used to follow only how far the midpoint had TRAVELLED — pan +
    // (now - then) — which is right for two fingers sliding and wrong for two
    // fingers spreading. A page is scaled about its own middle, so growing it
    // pushes everything away from that middle; unless you happened to pinch
    // dead centre, the note you were pinching on slid out from under you as it
    // grew, and the further out you were the faster it went. At five times on
    // a phone it could leave the screen altogether, which is the whole feeling
    // of handling paper falling over.
    //
    // What has to hold instead is that the point of the page under the
    // midpoint STAYS under the midpoint. Where that point sits on the page is
    // fixed by the pinch that started it — (m0 - c - pan0) / z0 in page units
    // — and putting it back under the midpoint now is the same statement
    // rearranged. The ratio is the zoom actually reached rather than the one
    // the fingers asked for, so at either limit the page stops growing and
    // still slides with the hand instead of sticking.
    const grew = zoom / (pinch.zoom || 1);
    panX = x - pinch.cx - grew * (pinch.x - pinch.cx - pinch.panX);
    panY = y - pinch.cy - grew * (pinch.y - pinch.cy - pinch.panY);
    if (zoom === 1) { panX = 0; panY = 0; }
    bandPan();
    applyZoom();
  }, true);
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    root.addEventListener(type, (e) => {
      if (e.pointerType === 'pen' && type !== 'lostpointercapture') penStroke.end();
      if (e.pointerId === penPointer) penPointer = null;
      pointers.delete(e.pointerId);
      if (pointers.size < 2 && pinch) {
        // The fingers that were holding it past its edge have gone, so the
        // page goes back to where it is allowed to be. Only after a real
        // pinch — a second finger that armed one and never moved leaves
        // nothing out of bounds to put back.
        pinch = null;
        settleZoom();
      }
      if (pointers.size < 2) {
        // A pinch is over the moment there are not two fingers making one.
        //
        // This used to wait for the map to reach EMPTY, on the reasoning that
        // lifting one finger out of a pinch must not draw a line from the
        // other. That reasoning is right and the rule was wrong: it made
        // "there is still a finger down" and "a pinch is still happening" the
        // same statement, so a pinch whose second `up` was lost — which is
        // most of them on a tablet, where two fingers rarely leave together —
        // left the whole reader refusing strokes and taps.
        //
        // The intent is kept by a moment's grace instead: for a quarter of a
        // second after the second finger goes, nothing is a stroke and nothing
        // is a tap. That is long enough for the other hand to leave, and short
        // enough that a reader which has lost a pointer comes back on its own
        // before anybody reaches for it a second time.
        clearTimeout(pinchOver);
        pinchOver = setTimeout(() => {
          pinching = false;
          // And the selection comes back out. It was hidden for the duration
          // of the pinch and this is the only place that knows the pinch is
          // over, so without saying so here the chips and the box stay gone
          // until something unrelated happens to repaint them.
          refreshSelectionBar();
          redraw();
        }, 250);
      }
      if (pointers.size === 0 && isPaper() && zoom > 1) redrawPaperAtZoom();
    }, true);
  }
}

let pinchOver = null;

// --- a finger that never lifted -----------------------------------------------
//
// This is the "sometimes the bar just stops answering" bug, and it is one line
// of arithmetic away from every gesture in the reader.
//
// The reader counts the fingers on the glass, and three separate refusals hang
// off that count: a stroke will not start while `pinching`, a tap is ignored
// while `pinching`, and a stroke will not start with more than one pointer
// down. All three are correct — and all three assume every pointer that goes
// down comes back up.
//
// On iOS they do not. A touch swallowed by a system gesture, an app switched
// away from mid-pinch, a pointer whose `up` is lost to the edge of the screen:
// any of those leaves an entry in the map that will never be removed. And
// `pinching` is only ever cleared when the map reaches EMPTY, so one orphan is
// enough to say "a pinch is in progress" for the rest of the session. The bar
// is still drawn, still lit, still exactly where it was — and nothing on it,
// or on the page, does anything at all until the score is closed and reopened.
//
// So no pointer is believed on trust. Each one carries the time it was last
// heard from, anything that has gone quiet for a second and a half is presumed
// gone, and `pinching` is worked out from what is actually left rather than
// remembered. Backgrounding the app — where the lost pointers mostly come from
// — drops the lot outright.
const POINTER_STALE = 1500;
// How far two contacts have to travel relative to one another before they are
// a pinch rather than two things that happen to be touching the screen.
const PINCH_START = 14;

function forgetLostPointers(now) {
  // A pencil that has said nothing for a while is a pencil that has been put
  // down, whatever became of its lift.
  if (penPointer !== null && now - penSeenAt > POINTER_STALE) {
    penPointer = null;
    if (drawingPointer !== null) { drawingPointer = null; endStroke(); }
  }
  let dropped = false;
  for (const [id, spot] of [...pointers]) {
    if (now - (spot.at ?? 0) <= POINTER_STALE) continue;
    pointers.delete(id);
    if (id === penPointer) penPointer = null;
    if (id === drawingPointer) { drawingPointer = null; cancelStroke(); }
    dropped = true;
  }
  if (!dropped) return;
  if (pointers.size < 2) { pinch = null; pinching = false; refreshSelectionBar(); }
}

// Everything let go of at once: no fingers, no pencil, no pinch, no half-drawn
// stroke. Used where the app cannot be told what happened to any of them.
function forgetEveryPointer() {
  clearTimeout(pinchOver);
  stopSettle();
  // Everything let go of includes a page left past its own edge: with no
  // fingers to explain it, out of bounds is just wrong.
  clampPan();
  zoom = Math.min(ZOOM_LIMIT, Math.max(1, zoom));
  applyZoom();
  pointers.clear();
  penPointer = null;
  pinch = null;
  pinching = false;
  pendingPlace = null;
  refreshSelectionBar();
  if (drawingPointer !== null) { drawingPointer = null; cancelStroke(); }
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
  tap('place');
  remember({ type: 'add', stroke: mark });
  // Held, so it can be sized straight away: pinch it bigger or smaller, or use
  // the two chips that appear with it. Placing the next one lets this one go.
  picked = [mark];
  refreshSelectionBar();
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
  // These marks are FINISHED marks, so they live on the dry layer — the one
  // that is only re-drawn when something about it changes. This is that
  // something, and it is the one mutation that does not go through
  // scheduleSave: a drag says so only when it ends. Without this the loop and
  // its outline slide across the page while the ink inside them stays exactly
  // where it was and snaps into place when the finger lifts.
  dropDryInk();
}

// Bigger or smaller, by pinching the thing itself.
//
// A sharp you have just stamped on the page is nearly always the wrong size:
// the one the engraver would have set is a fraction of the one your finger
// placed, and the one you want over a ledger line is bigger again. Reaching
// for a slider to say so is reaching away from the note you are looking at.
//
// So a pinch resizes what is picked up. A stamp and a piece of text have a
// size and only that changes; a drawn mark has a width AND a shape, so it is
// scaled about its own middle and stays the mark it was, larger. Anything
// picked up can be resized, whichever tool is in hand — a pinch with marks
// selected can only mean one thing.
const SIZE_FLOOR = 0.35;
const SIZE_CEILING = 14;

function scaleSelection(by) {
  if (!picked.length || !Number.isFinite(by) || by <= 0) return;
  const bounds = selectionBounds();
  const scale = unitScale();
  for (const stroke of picked) {
    if (stroke.type === 'text') {
      stroke.size = Math.max(SIZE_FLOOR, Math.min(SIZE_CEILING, (stroke.size ?? 1.6) * by));
      continue;
    }
    stroke.width = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, (stroke.width ?? 0.28) * by));
    // …and the shape with it, about the middle of what is picked up, so a box
    // round a bar grows into a bigger box rather than a fatter one.
    if (!bounds || !scale) continue;
    const midX = (bounds.left + bounds.right) / 2;
    const midY = (bounds.top + bounds.bottom) / 2;
    for (const point of stroke.points) {
      const at = place(point);
      if (!at) continue;
      const want = { x: midX + (at.x - midX) * by, y: midY + (at.y - midY) * by };
      const moved = anchor(want.x, want.y);
      if (!moved) continue;
      if (point.p !== undefined) { point.x = moved.x; point.y = moved.y; point.p = moved.p; }
      else { point.m = moved.m; point.u = moved.u; point.v = moved.v; }
    }
  }
  dropDryInk();
  redraw();
  scheduleSave();
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
  // Never while a pinch is under way.
  //
  // A pinch on a mark you are holding means one thing — bigger, or smaller —
  // and it is a gesture you make while looking at the mark. A bar of chips
  // sliding in under your fingers and a dashed box drawn round the very thing
  // you are watching change size is the app answering a question nobody asked,
  // and on a small sign the box is most of what you can see. Both come back
  // when the fingers are off; the grace timer in the pinch handler is what puts
  // them there, because nothing else would.
  bar.hidden = picked.length === 0 || pinching;
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
  // …and out of the way of a pinch, for the same reason the chips are — see
  // refreshSelectionBar.
  const box = picked.length && !pinching ? selectionBounds() : null;
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
const HOLD_PAGE = 2600;

// How long a turn may take before it admits it is taking a while.
//
// The old rule was to hold the page you were reading for 450ms and then show
// the next one whether or not it had been drawn — which on a slow device meant
// the commonest turn was: your music for half a second, then a BLANK page, then
// the music. That is the worst of both: you wait, and then you are shown
// nothing for your trouble.
//
// So the page you are reading now stays until the next one is genuinely ready.
// A page of music you can still read is the best thing to be looking at while
// waiting, and it is never a glitch — it is the page you were on. What was
// missing is any sign that the reader heard you, so past a third of a second a
// quiet mark appears in the corner. A turn that is quick — which is nearly all
// of them — never reaches it.
const SAY_TURNING = 350;

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

// Exported so a check can jump the way the page list and a bookmark jump —
// straight to a page nothing has been near. See tools/reader-cold-turns.mjs.
export async function showPage(index) {
  usedNow();
  if (!pageEls.length) return;
  const next = Math.max(0, Math.min(pageEls.length - 1, index));
  if (next !== wantedPage) turnWay = next > wantedPage ? 1 : -1;
  // Said here rather than in nextPage, because this is where a turn is a turn:
  // a tap at the last page asks for one and does not get one, and a detent for
  // a page that did not move is the reader lying about what it did.
  if (next !== wantedPage) tap('turn');
  wantedPage = next;
  const token = ++turnToken;

  // THE TURN HAPPENS NOW. The pixels catch up.
  //
  // Everything below the wait used to be below the wait: the page number, the
  // pages themselves, the ink. So a turn to a page that was not drawn yet held
  // the WHOLE turn — for up to two and a half seconds, because that is how long
  // this was willing to keep the page you were reading rather than show you a
  // blank one.
  //
  // Which is fine once. Tap ten times while it is doing that and you get ten
  // turns, every one of them waiting, every one of them superseded by the next
  // — so nothing moves at all, and then the last one lands and the part jumps
  // ten pages in one go. That is exactly what a reader that ignores you and
  // then overreacts feels like, and it was the honest consequence of insisting
  // a page be perfect before it could be seen.
  //
  // It is the wrong trade. A page that is on its way is a better thing to be
  // looking at than the page you have just left, because it is the one you
  // asked for — and it arrives sooner now anyway, drawn roughly first. So the
  // turn is committed here, immediately, and the drawing follows it.
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
  refreshUpNext();
  redraw();
  if (!isPaper()) return;

  // …and now the picture, for the page you are already looking at.
  //
  // Nothing waits on this except the mark in the corner, and a turn that has
  // been superseded asks for nothing at all — ten taps are one render of the
  // page you stopped on, not ten renders of the nine you went past.
  if (shown.every((i) => drawn.has(i))) { keepNeighboursReady(shown); return; }
  const slow = setTimeout(() => {
    if (token === turnToken) root?.classList.add('waiting');
  }, SAY_TURNING);
  turning++;
  try {
    // Always the rough one, with somebody waiting.
    //
    // This asked for a SHARP draw of anything already on the page, which was
    // right while the look-ahead drew sharp and became exactly wrong once it
    // drew rough: a page the look-ahead had warmed would be thrown away and
    // re-rendered at full quality with a finger tapping, turning the warm case
    // — the one that is supposed to be instant — into the slowest of the lot.
    //
    // Nothing here is ever sharp now. An undrawn page gets the rough render, a
    // rough one is already on screen and returns at once, and sharpenSoon does
    // the proper draw when the turning stops. What a turn waits for is the
    // least it can wait for and still show you music.
    await Promise.all(shown.map(
      (i) => drawPaperPage(i, { quick: true }).catch(() => {}),
    ));
  } finally {
    turning--;
    clearTimeout(slow);
    if (token === turnToken) root?.classList.remove('waiting');
  }
  if (token !== turnToken) return;
  keepNeighboursReady(shown);
}

// What you are about to turn into.
//
// Past the last page of a piece in a programme is the first page of the next
// one, and that has worked for a while — but it happened without warning, so
// the last page of a movement was a small cliff: turn once more and you are
// somewhere else, and you find out which piece by reading it. A recital is
// exactly where you least want that.
//
// So the last page says what is coming. It is not a control and does not want
// to be tapped; it is the label on the corner of an orchestral part that tells
// you the Menuet is overleaf.
function refreshUpNext() {
  const chip = el('reader-next');
  if (!chip) return;
  const last = visiblePages().at(-1) ?? 0;
  const onLastPage = last >= pageEls.length - 1;
  const next = setlist && setlist.index + 1 < (setlist.items?.length ?? 0)
    ? (setlist.names?.[setlist.index + 1] ?? '')
    : '';
  // Only with the music in front of you — while the chrome is up it is one more
  // thing over the page, and the bar already says where you are.
  const show = onLastPage && !!next && !!setlist && pageEls.length > 0;
  chip.hidden = !show;
  if (show) chip.textContent = `next: ${next}`;
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
      rough.delete(i);
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
      // Nothing is drawn ahead while somebody is waiting on a page NOW. The
      // look-ahead exists to make turns instant; a look-ahead that delays a
      // turn is doing the opposite of its job.
      while (turning > 0) {
        await new Promise((go) => { setTimeout(go, 30); });
        if (mine !== lookAhead) return;
      }
      // ROUGH, which is the whole point of drawing it early.
      //
      // This asked for a full-quality render, and a full render of a
      // photographed page is several times the work of the rough one the TURN
      // itself uses. So the look-ahead was the most expensive thing in the
      // reader while being the least urgent: three sharp pages queued one
      // behind another, each one blocking the next, and a hand tapping at the
      // speed hands actually tap outran them within a page or two. After that
      // every turn paid for its own render with somebody waiting on it, which
      // is exactly what a look-ahead exists to prevent.
      //
      // Rough pages cost a fraction, so the window in front of you actually
      // fills, and sharpenSoon upgrades whatever you land on a moment after
      // the turns stop — which is the order these should always have been in:
      // something to read immediately, sharp before you need the detail.
      await drawPaperPage(i, { quick: true }).catch(() => {});
    }
    if (mine !== lookAhead) return;
    // Again afterwards: a page drawn by the LAST turn's look-ahead finishes
    // after this turn has already swept, and without a second sweep those
    // stragglers are what a long part accumulates.
    forget();
  }, 0);
}

let lookAhead = 0;
// How many turns are waiting on a page right now. See showPage.
let turning = 0;

// When the reader was last touched at all.
//
// Waiting only for a turn IN PROGRESS was not enough. Reading one page of a PDF
// is seconds of work that cannot be interrupted once it has begun, so a pass
// that checks between pages and then starts another the instant the turn ends
// simply collides with the NEXT turn — and the first half-dozen turns after
// opening a part each waited whole seconds while it did.
//
// So it does not wait for a gap between turns. It waits for the player to stop:
// no turn, no stroke, no tap for a couple of seconds, which is the difference
// between somebody hunting for their place and somebody who has found it and is
// playing. A part measures itself in the rests.
let lastUsed = 0;
const IDLE_ENOUGH = 2500;
// True from the first line of `openReader` until its first pages are on the
// glass. Read by `standAside` — see the note there. (Not `opening`: that name
// is already a local inside `openReader`, holding the "opening…" line.)
let comingUp = false;

function usedNow() {
  lastUsed = Date.now();
}

// Exported so that a reading pass started ANYWHERE waits for the same quiet
// this one does. The pass that runs straight after a scan was started by
// score.js with no `standAside` at all, so it read the part flat out while the
// player was turning through it — which is a second of solid arithmetic against
// every turn, and is what "when I open a score and try to click fast through
// the pages the first time … it takes a while for the score to load" is made
// of. See scanPages.
export function standAside() {
  // `root.hidden` means "nobody is reading", and the pass may have the
  // processor. It does NOT mean that while the reader is opening: the root is
  // hidden for the whole of `openReader` and its first render, which on a part
  // just scanned is precisely when the pass is started (score.js fires
  // `measurePages` at import). So the pass ran at full speed through the render
  // of the first page somebody was waiting to look at, and `readPage` has no
  // yield inside it — once a page's read begins, a tap waits it out. MEASURED:
  // 3.0-5.3s stalls with nothing else on the thread, and turns of 1433, 1506,
  // 1540 and once 10632ms taken while the pass was mid-page.
  const clear = () => !comingUp
    && ((root?.hidden ?? true) || (turning <= 0 && Date.now() - lastUsed > IDLE_ENOUGH));
  if (clear()) return Promise.resolve();
  return new Promise((go) => {
    const look = setInterval(() => {
      if (!clear()) return;
      clearInterval(look);
      go();
    }, 120);
  });
}

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

// Whether the ⋯ sheet is open is a question the SHEET can answer.
//
// It was a variable kept alongside the class on the element, and two records of
// one fact are one record and one liability: anything that hid the sheet
// without going through closeMenu left the variable saying it was still open,
// and from then on every tap on the page was swallowed as "close the menu" —
// a reader that looks completely normal and quietly ignores you.
function isMenuOpen() {
  return !!el('reader-menu')?.classList.contains('open');
}

function setChrome(on) {
  // A RUNNING TAKE NO LONGER KEEPS THE BAR.
  //
  // It used to: `chrome = on || taking` pinned it open for the length of a take
  // so there was always a visible way to stop. OVERRULED, on request — "once
  // you click record, it gets rid of the menu bar right away… then you see the
  // full screen and you can click at the top to get it back."
  //
  // The invariant that pin defended is paid for twice over, and neither payment
  // costs the music a pixel:
  //   · THE TAP. While the bar is away, a tap in the top quarter of the screen
  //     brings it back, and so does a tap in the middle third — the same
  //     gesture that brings it back for anything else, so there is nothing new
  //     to learn and the stop is one tap away at any moment of a take.
  //   · THE INK BAR. `placeRecordButton` puts the one button in whichever bar
  //     is showing, and `.bare` styles `#reader-top` ONLY — `#reader-ink-bar`
  //     answers to `.drawing` and nothing else. So a pencil picked up mid-take
  //     still has the stop under the hand.
  //
  // What is genuinely given up, and is the price of what was asked for: with
  // the bar away there is nothing on the screen saying a take is running. The
  // ` · rec` clock lives in `#reader-count`, inside the bar. The Record tab
  // still shows it.
  chrome = on;
  root?.classList.toggle('bare', !chrome);
}

function setTool(next) {
  // Tapping the pen you are already holding opens the pen case — which pen,
  // how thick, what colour. It is what every drawing app does, and it is how
  // the brush gets reached without a second button to learn.
  if (next && next === tool && (next === 'pen' || next === 'highlighter' || next === 'eraser')) {
    toggleBrush();
    return;
  }
  tool = tool === next ? null : next;
  // Remembered on the way IN, not on the way out: putting a tool down leaves
  // `tool` null, and null is not something to come back holding.
  if (INKS.includes(tool)) lastInk = tool;
  if (tool !== 'lasso') { picked = []; lasso = null; refreshSelectionBar(); }
  root?.classList.toggle('drawing', tool !== null);
  placeRecordButton();   // it lives in whichever bar is showing
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
  if (op.type === 'add') {
    strokes = strokes.filter((stroke) => stroke !== op.stroke);
  } else {
    // What the eraser left behind goes, and what it took comes back.
    if (op.made?.length) strokes = strokes.filter((stroke) => !op.made.includes(stroke));
    strokes.push(...op.strokes);
  }
  redoable.push(op);
  refreshHistoryButtons();
  redraw();
  scheduleSave();
}

function redo() {
  const op = redoable.pop();
  if (!op) return;
  if (op.type === 'add') {
    strokes.push(op.stroke);
  } else {
    strokes = strokes.filter((stroke) => !op.strokes.includes(stroke));
    if (op.made?.length) strokes.push(...op.made);
  }
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
  // The rubber used to be bundled in with "no tool at all" here, and opening
  // the pen case while holding it swapped it for a pen — which was fair when a
  // rubber had nothing to configure. It has a size now, and that panel is
  // reached the same way the pen's is: by tapping the tool already in hand.
  if (!tool) setTool(lastInk === 'highlighter' ? 'highlighter' : 'pen');
  panel.classList.toggle('open');
  hangBelowBar(panel);
  refreshBrushUI();
}

// Under whichever bar is up, measured rather than guessed: on a phone the tool
// bar wraps onto two rows, and a panel positioned from a constant would open
// straight through it.
// Hung under whichever bar is showing — measured off the LAYOUT, not off the
// painted box.
//
// `getBoundingClientRect` reports where a thing is drawn, and while the bar is
// coming down it is drawn wherever the transition has got to: `#reader.bare
// #reader-top` holds it at `translateY(-100%)`, so a rect taken in that moment
// says the bar ends at zero. Opening this sheet is what BRINGS the bar down
// (`setChrome(true)` a line earlier), so the measurement was taken during the
// 220ms it takes to arrive — and the sheet was placed at 8px, on top of the
// close button, the page arrows, the page count and the record dot.
//
// `offsetTop` and `offsetHeight` are the untransformed answer and are what this
// wants: where the bar WILL be, which is where it already is as far as layout
// is concerned. MEASURED: sheet top 8px before, 66px after, against a bar that
// ends at 58. Found by `npm run app:reach`.
function hangBelowBar(panel) {
  const bar = tool ? el('reader-ink-bar') : el('reader-top');
  const bottom = bar ? bar.offsetTop + bar.offsetHeight : 0;
  panel.style.top = `${Math.round(bottom + 8)}px`;
}

function refreshBrushUI() {
  // Everything that changes the pen, the layer or the stamp ends here, which
  // makes this the one place worth saying it from.
  scheduleBrushSave();
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
  for (const button of panel.querySelectorAll('[data-eraser]')) {
    button.classList.toggle('on', Math.abs(Number(button.dataset.eraser) - eraserWidth) < 0.005);
  }
  // The rubber has no colour and no nib, and the pen has no rubber: the panel
  // shows one or the other rather than both greyed out.
  panel.classList.toggle('rubbing', tool === 'eraser');
  refreshFingerButton();
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
  // The ink is drawn differently in the dark — see afterDark — so the page of
  // finished marks has to be laid down again.
  dropDryInk();
  redraw();
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
  el('reader-menu')?.classList.remove('open');
}

function toggleMenu() {
  const sheet = el('reader-menu');
  if (!sheet) return;
  const opening = !isMenuOpen();
  sheet.classList.toggle('open', opening);
  if (opening) {
    setChrome(true);
    buildMenu(sheet);
    hangBelowBar(sheet);
  }
}

function menuRow(sheet, { label, detail = '', glyph = '', danger = false, onPick }) {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = danger ? 'reader-menu-row danger' : 'reader-menu-row';
  const mark = document.createElement('span');
  mark.className = 'reader-menu-glyph';
  // Drawn rather than typed — see ICONS. A name that is not in the set falls
  // back to the character, so a row added in a hurry still gets something.
  if (ICONS[glyph]) mark.append(icon(glyph));
  else mark.textContent = glyph;
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
  row.append(mark, text);
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
  // WHAT A ROW SAYS UNDER ITS NAME, and what it does not.
  //
  // Every row here used to carry a sentence: "write on the page" under
  // Annotate, "the click, on the page" under Metronome, "crop a page again, or
  // straighten one that came out crooked" under the edges. Told once, that
  // reads as help; told sixteen times down one sheet it reads as a machine
  // explaining its own buttons — "I don't want text explaining stuff. It just
  // makes it seem like AI and not good."
  //
  // So the line under a row is now only ever an ANSWER: how many jumps are
  // taped to this score, what the bookmarks are called, what the file is
  // called, what a row will do that its name cannot say on its own (the take
  // that could not be paired). Nothing that merely restates the label.
  menuGroup(sheet, 'score');
  menuRow(sheet, {
    label: 'Annotate', glyph: 'pen',
    onPick: () => setTool(lastInk),
  });
  // Only for a score read off a page: a part somebody exported from MuseScore
  // is already what its composer wrote.
  if (asPrinted) {
    menuRow(sheet, {
      label: correcting ? 'Stop correcting' : 'Correct the notes',
      glyph: 'note',
      onPick: () => setCorrecting(!correcting),
    });
  }
  menuRow(sheet, {
    label: 'Clear this page', glyph: 'clear',
    onPick: clearPage,
  });
  const canMark = isPaper() ? (!!take?.notes?.length && !!layout) : !!take?.aligned;
  // What the row PROMISES, on a take the pairing refused.
  //
  // "colour the notes by how they landed" is a promise this app cannot keep on
  // a page where it could not work out which notes those are, and a row that
  // opens onto a page with nothing on it reads as a bug rather than as a
  // refusal. So the row stays — and it says what it will actually do, which is
  // the one line on this sheet that is not the label said twice.
  const refused = isPaper() && canMark && !scanPairing().marks.length;
  if (canMark) {
    menuGroup(sheet, 'take');
    menuRow(sheet, {
      label: refused
        ? (painted ? 'Hide why this take is not on the page' : 'Why this take is not on the page')
        : (painted ? 'Hide what you played' : 'Show what you played'),
      glyph: 'paint',
      onPick: () => togglePainted(),
    });
    menuRow(sheet, {
      label: takeIsPlaying() ? 'Pause' : 'Play the take', glyph: takeIsPlaying() ? 'pause' : 'play',
      onPick: togglePlayback,
    });
  }
  {
    menuGroup(sheet, 'size');
    menuRow(sheet, { label: 'Bigger', glyph: 'bigger', onPick: () => resize(ZOOM_STEP) });
    menuRow(sheet, { label: 'Smaller', glyph: 'smaller', onPick: () => resize(1 / ZOOM_STEP) });
  }
  if (isPaper()) {
    menuGroup(sheet, 'pages');
    // ONE ROW, NOT TWO. "There shouldn't be a 'trim a page and change the
    // edges' option. It should just be 'change the edges'."
    //
    // They were two rows because they are two different jobs underneath: a
    // photograph has corners to re-cut in the edges editor, and a PDF page is
    // already a rectangle, so the only thing there is to say about one is where
    // on it the music sits. That is a fact about the file, not a question for
    // the player — so the row is one row, and it opens whichever of the two
    // this score actually has.
    menuRow(sheet, {
      label: 'Change the edges…',
      glyph: 'edges',
      onPick: score?.source === 'pdf' ? openTrimMenu : openEdgesMenu,
    });
  }
  menuGroup(sheet, 'play');
  // Both of these used to CLOSE the score and take you to a tab, which is a
  // metronome you use before you start playing and never again. They open on
  // the page now, over the foot of it, and the music stays where it is.
  menuRow(sheet, {
    label: aidsShowing() === 'metronome' ? 'Hide the metronome' : 'Metronome', glyph: 'metronome',
    onPick: () => {
      if (aidsShowing() === 'metronome') hideAids(); else showAids('metronome');
      closeMenu();
    },
  });
  menuRow(sheet, {
    label: aidsShowing() === 'tuner' ? 'Hide the tuner' : 'Tuner', glyph: 'note',
    onPick: () => {
      if (aidsShowing() === 'tuner') hideAids(); else showAids('tuner');
      closeMenu();
    },
  });
  menuRow(sheet, {
    label: 'Record a take', glyph: 'record',
    onPick: () => { close(); document.querySelector('.tab-btn[data-tab="analyze"]')?.click(); },
  });

  menuGroup(sheet, 'places');
  menuRow(sheet, {
    label: 'Jumps', glyph: 'jump',
    // An ANSWER, not an explanation: how many are taped to this score.
    detail: linksOf().length ? `${linksOf().length} taped to this score` : '',
    onPick: openLinks,
  });
  menuRow(sheet, {
    label: 'Bookmarks', glyph: 'bookmark',
    detail: bookmarksOf().length
      ? bookmarksOf().map((m) => m.label).join(' · ').slice(0, 44)
      : '',
    onPick: openBookmarks,
  });
  menuRow(sheet, {
    label: spread ? 'One page at a time' : 'Two pages side by side',
    glyph: spread ? 'onePage' : 'spread',
    onPick: toggleSpread,
  });
  menuRow(sheet, {
    label: night ? 'Light page' : 'Dark page',
    glyph: night ? 'sun' : 'moon',
    onPick: toggleNight,
  });
  menuGroup(sheet, 'file');
  menuRow(sheet, {
    label: 'Send a copy…', glyph: 'send',
    onPick: openSend,
  });
  menuRow(sheet, {
    label: 'Rename…', glyph: 'rename', detail: score?.name ?? '',
    onPick: renameThisScore,
  });
  menuRow(sheet, {
    label: 'Delete this score', glyph: 'trash', danger: true,
    onPick: deleteThisScore,
  });
  menuRow(sheet, { label: 'Close the score', glyph: 'close', onPick: close });
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
    // Big enough to place an edge by eye, and no bigger — and PLAIN, because
    // what comes out of this is stored as the page. Brightening belongs on the
    // way to the screen and not on the way into the library: see `brighten` in
    // paper.js.
    await paper.drawWhole(pageNumber, sheetCanvas, 1400, 1900, { plain: true });
  } catch (err) {
    say(saying('that page could not be drawn to crop', err));
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
  // No looks here: trimming a page of a PDF stores a rectangle and re-encodes
  // nothing, so there is nothing for them to be baked into.
  const chosen = await editCorners(blob, start, { keep: 'Trim it here' }, { develops: false });
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
  const id = score.id;
  await setPageCrop(id, pageNumber, crop);
  say('page trimmed');
  // Rebuilt from the score as it now stands: the bands of that page are cut
  // from the crop, so they are all different now. This happens AT ONCE — the
  // trim you just made is on screen before you have lifted your finger.
  drawn.clear();
  await render();
  showPage(Math.max(0, slices.findIndex((slice) => slice.page === pageNumber)));

  // …and then, quietly behind it, the page is read again.
  //
  // Where the staves are was measured against the OLD crop, so setPageCrop
  // throws it away — rightly, because those numbers describe a part of the
  // page that is no longer being shown. But nothing ever put them back, and
  // where the staves are is what lets a page be cut into screenfuls: a page
  // with none known cannot be cut anywhere, so it is shown whole, one tall
  // sheet shrunk to fit, with the music a fraction of the size it was.
  //
  // Not awaited, and deliberately. Reading a part is seconds of work and the
  // trim is already on screen; making somebody watch "reading the pages… 4 of
  // 21" every time they straighten a margin is its own kind of broken. The
  // bands sharpen a moment later, on the page they are still looking at.
  reading.delete(id);
  import('./score.js')
    .then(({ measurePages }) => measurePages(id, { standAside }))
    .then(() => relayoutSameScore(id))
    .catch(() => { reading.delete(id); /* still a page to play from */ });
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
  const { editCorners, bakeLook } = await import('./crop.js');
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
    page = straightenCanvas(image, w, h, chosen.quad, { asGiven: true });
    bakeLook(page, chosen.look);
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
// `chooseNotation` lived here — the reader's door to pairing a scan with a
// MusicXML file. Removed with the other three (see main.js). The machinery it
// called is untouched; nothing in the app asks for it any more.

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
  // A filled dot and a square: what record and stop have looked like for sixty
  // years, and the two shapes somebody finds without reading a label.
  record: '<circle cx="12" cy="12" r="6" fill="currentColor" stroke="none"/>',
  stopRec: '<rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" stroke="none"/>',
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
  // A rubber, the way every drawing app draws one: a block leaning to the
  // right, divided across the middle so the worn end reads as the end that
  // rubs. Nothing under it — the baseline and the band together looked like
  // two stray lines rather than an object.
  // A hand with one finger out: the thing that either writes on the page or
  // does not, which is what the button beside it decides.
  finger: '<path d="M10 11.5V5.4a1.6 1.6 0 0 1 3.2 0v6.1"/>'
    + '<path d="M13.2 11.2V9.6a1.5 1.5 0 0 1 3 0v1.9"/>'
    + '<path d="M16.2 11.5v-1a1.5 1.5 0 0 1 3 0v5.1a5.4 5.4 0 0 1-5.4 5.4h-1.3'
    + 'a5 5 0 0 1-3.6-1.5l-3.4-3.5a1.6 1.6 0 0 1 2.3-2.2L10 15.4"/>',
  eraser: '<path d="M9.9 20.2 3.9 14.2a2.1 2.1 0 0 1 0-3L11.6 3.6a2.1 2.1 0 0 1 3 0l5.5 5.5'
    + 'a2.1 2.1 0 0 1 0 3l-8.1 8.1z"/>'
    + '<path d="M7.4 10.7 14 17.3"/>'
    + '<path d="M9.3 11.5l5.9 5.9"/><path d="M11 20.2h9"/>',
  undo: '<path d="M9 7H5.5V3.5"/><path d="M5.8 7.2a7 7 0 1 1-1.3 6"/>',
  redo: '<path d="M15 7h3.5V3.5"/><path d="M18.2 7.2a7 7 0 1 0 1.3 6"/>',
  clear: '<rect x="4.5" y="5.5" width="15" height="13" rx="2"/><path d="M9 9.5l6 5M15 9.5l-6 5"/>',
  layers: '<path d="M12 3.5l8.5 4.5L12 12.5 3.5 8z"/><path d="M4.5 12.5L12 16.5l7.5-4"/>',
  fit: '<path d="M9 4.5H4.5V9M15 4.5h4.5V9M9 19.5H4.5V15M15 19.5h4.5V15"/>',
  brush: '<path d="M6 20c2.5 0 4-1.5 4-3.5S8.5 13 6.5 13.5C5 14 4 16 4 20z"/><path d="M10.5 15.5l8-8a2 2 0 0 0-3-3l-8 8"/>',
  // THE OPTIONS SHEET USED UNICODE, and it showed. The rows were labelled with
  // whatever character was nearest — ✎ ⌧ ⛶ ↴ ⚑ ▥ ☾ ● + − — which are drawn by
  // whatever font on the device happens to have them, at whatever weight and
  // size that font draws them at. So the sheet was a column of mismatched
  // marks; and 𝅘𝅥 (U+1D15F, a quarter note) is in no font an iPhone ships, so
  // the metronome's row came up as TWO EMPTY BOXES. Everything in that sheet is
  // drawn here now, at one weight, on one grid.
  metronome: '<path d="M9.2 20.5 12 4.2h0.1l2.7 16.3z" /><path d="M6.8 20.5h10.4"/><path d="M9.9 14h4.2"/>',
  note: '<circle cx="9" cy="17.5" r="3" /><path d="M12 17.5V5l6 2"/>',
  bookmark: '<path d="M7 4.5h10v15l-5-3.6-5 3.6z"/>',
  jump: '<path d="M5 7h9a4 4 0 0 1 0 8H8"/><path d="M10.5 12 8 15l2.5 3"/>',
  spread: '<rect x="3.5" y="5" width="7.5" height="14" rx="1.2"/>'
    + '<rect x="13" y="5" width="7.5" height="14" rx="1.2"/>',
  onePage: '<rect x="6.5" y="4.5" width="11" height="15" rx="1.4"/>',
  moon: '<path d="M19 14.6A7.6 7.6 0 0 1 9.4 5 7.6 7.6 0 1 0 19 14.6z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2'
    + 'M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4"/>',
  send: '<path d="M12 4v12"/><path d="M8 8l4-4 4 4"/><path d="M5 15v3.5h14V15"/>',
  // A luggage tag: the thing a name is written on. Drawn as letters ("Aa") it
  // came out as an A beside a small h at icon size, which is a mark nobody can
  // read and nothing recognises.
  rename: '<path d="M11.4 3.8H19a1.2 1.2 0 0 1 1.2 1.2v7.6a1.6 1.6 0 0 1-.47 1.13l-6.2 6.2'
    + 'a1.2 1.2 0 0 1-1.7 0l-7.6-7.6a1.2 1.2 0 0 1 0-1.7l6.2-6.2a1.6 1.6 0 0 1 1.13-.47z"/>'
    + '<circle cx="16" cy="8" r="1.3"/>',
  trash: '<path d="M5 7h14"/><path d="M9.5 7V4.8h5V7"/><path d="M6.8 7l0.9 12.2h8.6L17.2 7"/>',
  bigger: '<path d="M12 6v12M6 12h12"/>',
  smaller: '<path d="M6 12h12"/>',
  edges: '<path d="M4 8.5V4.5h4"/><path d="M20 8.5V4.5h-4"/><path d="M4 15.5v4h4"/>'
    + '<path d="M20 15.5v4h-4"/>',
  paint: '<circle cx="12" cy="12" r="7.5"/><path d="M12 4.5a7.5 7.5 0 0 1 0 15"'
    + ' fill="currentColor" stroke="none"/>',
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

// --- recording from the music ------------------------------------------------
//
// The button is one tap and the whole of the recording lives elsewhere: this
// asks take-control to start or stop, and then draws whatever it is told. It
// deliberately holds no state of its own — a second idea of whether a take is
// running is a second thing to be wrong.

let takeWatch = null;

function showTake(state) {
  const button = el('reader-record');
  if (!button) return;
  // A RUNNING TAKE IS ALWAYS SHOWN. `canRecord` decides whether to OFFER the
  // button; it does not get to take away the only way to stop something that
  // is already recording. This is belt and braces over the bug that made the
  // dot vanish mid-take — the invariant is worth stating in the view too.
  button.hidden = !state.recording && !state.canRecord;
  button.classList.toggle('recording', !!state.recording);
  // A VIEW, AND NOTHING ELSE. This used to pin the chrome open for the length
  // of a take (`root.classList.toggle('taking', …)` and `setChrome(true)`), and
  // it ran on every publish of the take clock — four times a second — so
  // anything that put the bar away was undone within 50ms. See setChrome for
  // what replaced the invariant it was defending.
  placeRecordButton();
  button.disabled = !!state.busy;
  button.replaceChildren(icon(state.recording ? 'stopRec' : 'record'));
  const label = state.recording
    ? `Stop — recording, ${Math.floor(state.seconds / 60)}:${String(Math.floor(state.seconds % 60)).padStart(2, '0')}`
    : 'Record while you read';
  button.setAttribute('aria-label', label);
  button.title = label;
  // The clock goes beside the page number rather than on the button: a number
  // that changes four times a second inside a target you are meant to press is
  // a target that moves under your finger.
  const count = el('reader-count');
  if (count) count.classList.toggle('recording', !!state.recording);
}

async function toggleTakeHere() {
  const { toggleTake, takeState } = await import('./take-control.js');
  const starting = !takeState()?.recording;
  // AWAY AT ONCE, not when the take actually begins. A count-in is two bars of
  // clicks before a single sample is recorded, and leaving the bar over the
  // music for those is the whole of the complaint. The gesture is what hides
  // it, so it goes on the way in.
  if (starting) setChrome(false);
  const went = await toggleTake();
  // …and back, if it never started. A refused microphone, or a start that
  // walked away, would otherwise leave a bare page and no way to see why.
  if (starting && went === false) setChrome(true);
}

// WHICHEVER BAR IS ON SCREEN IS THE BAR IT IS IN.
//
// The button moved into `#reader-top`, and `#reader.drawing` hides that bar
// outright — one bar at a time, reading or drawing, which is the right rule for
// everything else in it. MEASURED, before this: start a take, pick up the
// pencil to mark a fingering, and the only way to stop the take is gone —
// `getBoundingClientRect()` 0x0 — leaving somebody to go and find the Record
// tab. That is precisely the hazard the old floating dot existed to avoid, and
// it is the one thing `showTake` promises in its own comment.
//
// A DOM node lives in exactly one place, so it is MOVED rather than copied —
// the same arrangement score-tab.js uses for the playback panel, and for the
// same reason: two of a control is two things to keep in step, and they do not
// stay in step. Marking a fingering while a take runs is one of the two things
// this reader is for; the stop goes where the hand already is.
function placeRecordButton() {
  const button = el('reader-record');
  if (!button || !root) return;
  const drawing = root.classList.contains('drawing');
  const home = drawing
    ? root.querySelector('#reader-ink-bar')
    : root.querySelector('#reader-top .reader-bar-right');
  if (!home || button.parentElement === home) return;
  // On the ink bar it goes straight after the tick, which is the other control
  // there that is about leaving rather than about drawing.
  const after = drawing ? el('reader-done') : null;
  if (after && after.parentElement === home) after.after(button);
  else if (drawing) home.prepend(button);
  else home.insertBefore(button, el('reader-annotate'));
}

function watchTake() {
  import('./take-control.js').then(({ onTakeChange, takeState }) => {
    takeWatch?.();
    takeWatch = onTakeChange(showTake);
    showTake(takeState());
  }).catch(() => { /* no recorder registered: the button stays hidden */ });
}

/**
 * RECORD, IN THE BAR, BESIDE THE PENCIL.
 *
 * Recording used to mean leaving the page: you chose the score on the Record
 * tab and then had a tab of charts in front of you instead of the notes you
 * were about to play. "when you select a score to record from, you can't
 * actually read the music."
 *
 * The first answer was a floating dot in the bottom-right corner of the page,
 * and the note that used to be here argued at length that the bar was the one
 * place it could NOT go: the reader takes its chrome away the moment somebody
 * starts reading, and a take with no visible way to stop it is worse than no
 * button at all. That is a real hazard and the argument was sound; it is
 * OVERRULED, on request — "instead of it being in the bottom right, I want it
 * to be in the menu… maybe to the left of the pencil button" — and paid for
 * rather than ignored:
 *
 *   THE BAR CANNOT HIDE WHILE A TAKE IS RUNNING. `showTake` pins the chrome
 *   open for as long as `state.recording`, so the invariant the old note was
 *   defending — that there is always a visible way to stop — still holds. It is
 *   the same invariant `showTake` already states about the button itself.
 *
 * What the corner cost was worth losing. A round dot floating over the
 * bottom-right of a page sat exactly where a right hand rests on a phone
 * propped on a stand, in the middle of the "next page" tap zone, and it was the
 * one control in the reader that was not where the other controls are. Wanting
 * to record and wanting to write a fingering are the same kind of wanting; they
 * belong in the same row.
 */
function buildRecordButton() {
  const button = iconButton(
    'reader-record', 'record', 'Record while you read', toggleTakeHere,
    { className: 'reader-tool reader-rec' },
  );
  button.hidden = true;          // until something says it can record
  return button;
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
    // RECORD, HERE, BESIDE THE PENCIL — see buildRecordButton for what moved
    // and what had to hold for it to be safe.
    buildRecordButton(),
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
  // door into the same room, taking up space in a bar that has none.
  //
  // There was also a little bar of colour under the pen showing the ink you
  // were holding. The colours are on the bar three inches away and the pen
  // case is one tap behind the pen itself, so it was a third place to be told
  // the same thing — and at that size it read as a smudge on the button rather
  // than as ink.
  const pen = toolButton('pen', 'pen', 'Pen');
  bar.append(
    iconButton('reader-done', 'tick', 'Finished annotating', () => setTool(null)),
    // The way to the next page WITHOUT putting the pen down.
    //
    // A tool now stays in your hand until you say otherwise, which is what a
    // player marking fingerings through a movement wants — and it takes the
    // page turns away, because while a tool is out a tap on the page is a
    // mark. So the turns come back here, on the bar, where forScore puts them
    // for the same reason: annotate this page, move on, carry on annotating,
    // and reach for the tick only when you have actually finished.
    iconButton('reader-ink-prev', '‹', 'Previous page', () => previousPage(),
      { className: 'reader-tool reader-ink-page' }),
    iconButton('reader-ink-next', '›', 'Next page', () => nextPage(),
      { className: 'reader-tool reader-ink-page' }),
    pen,
    toolButton('highlighter', 'highlighter', 'Highlighter'),
    toolButton('text', 'text', 'Type on the page'),
    iconButton('reader-shapes', 'shapes', 'Lines, boxes and rings', openShapeMenu),
    iconButton('reader-stamps', STAMPS[0].glyph, 'Stamp a sign on the page', openStampMenu),
    toolButton('lasso', 'lasso', 'Pick up marks'),
    toolButton('eraser', 'eraser', 'Rub out'),
    // Whether a finger writes on the music or only works the app.
    iconButton('reader-finger', 'finger', 'Let your finger write', toggleFingerInk),
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
    // Said two ways: pinch what is picked up, or tap these. A gesture nobody
    // finds is a gesture nobody has.
    iconButton(null, '−', 'Smaller', () => scaleSelection(1 / 1.25), { className: 'reader-chip' }),
    iconButton(null, '+', 'Bigger', () => scaleSelection(1.25), { className: 'reader-chip' }),
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

  // The rubber's own panel. It has one question — how big — so it is one row
  // of dots and nothing else: no nib, no colour, no mixer. Kept inside the same
  // panel so the eraser opens the way the pen does, by tapping the tool you are
  // already holding.
  const rubber = document.createElement('div');
  rubber.id = 'reader-eraser-sizes';
  rubber.className = 'brush-sizes brush-erasers';
  const rubberLabel = document.createElement('span');
  rubberLabel.className = 'brush-eraser-label';
  rubberLabel.textContent = 'Rubber';
  rubber.append(rubberLabel, ...ERASER_SIZES.map(eraserDot));

  panel.append(nibs, paper, palette, custom, mixer, overlay, rubber);
  return panel;
}

function eraserDot(width) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'brush-dot brush-eraser-dot';
  button.dataset.eraser = String(width);
  button.style.setProperty('--dot', `${Math.round(6 + width * 3.2)}px`);
  button.setAttribute('aria-label', `Rubber ${width} staff spaces across`);
  button.addEventListener('click', () => setEraserWidth(width));
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

  const menu = document.createElement('div');
  menu.id = 'reader-menu';

  const line = document.createElement('div');
  line.id = 'reader-say';
  line.hidden = true;
  const upNext = document.createElement('div');
  upNext.id = 'reader-next';
  upNext.hidden = true;
  upNext.setAttribute('aria-live', 'polite');

  const land = iconButton('reader-land', 'Land it', 'Land the jump here', () => {
    if (pendingLink?.stage === 'to') finishLink(pageIndex);
    refreshLandButton();
  }, { className: 'reader-chip' });
  land.hidden = true;

  root.append(sheet, ink, buildTopBar(), buildInkBar(), buildBrushPanel(),
    buildSelectionBar(), menu, line, land, upNext, aidsElement());
  document.body.append(root);

  // The last word on selecting the music, said in JavaScript because CSS is
  // advice and this is not.
  //
  // Both of the reader's central gestures deliberately park a finger still on
  // the page for over half a second — a tap is allowed 600ms, and holding the
  // pen still for 550 is how a scrawl becomes the box it was trying to be.
  // That is exactly the gesture iOS reads as "select this word". The stylesheet
  // now refuses selection every way it can, but a webview that decides to start
  // one anyway is answered here: the attempt is cancelled, and the Copy / Look
  // Up bubble that would follow it is refused as well.
  //
  // Listened for on the DOCUMENT, not on the reader.
  //
  // It was on #reader, and on a real iPad the bubble still came up: a
  // selectstart whose target is not inside the reader — the document itself,
  // the body, a node behind the full-screen page — never reaches a listener
  // bound to the reader, and cancelling it is the only chance there is. There
  // is nothing to lose by listening wider, because the guard is the reader
  // being OPEN, and while it is open nothing on the screen is a word to copy.
  for (const type of ['selectstart', 'contextmenu', 'dragstart']) {
    document.addEventListener(type, (e) => {
      if (!isReading()) return;
      // …except in the one place that IS text you are typing.
      if (e.target?.closest?.('input, textarea, [contenteditable]')) return;
      e.preventDefault();
    }, true);
  }
  // And whatever got selected before any of that could stop it, dropped — on
  // the way in, and again on every touch of the page. A selection that has
  // already been made raises the bubble on its own; refusing new ones does
  // nothing about one that is already there.
  document.addEventListener('pointerdown', (e) => {
    if (!isReading()) return;
    if (e.target?.closest?.('input, textarea, [contenteditable]')) return;
    dropSelection();
  }, true);

  // --- the touch stream, refused ------------------------------------------
  //
  // This is the published workaround for the thing that has eaten a stroke
  // four times, and it is the only one of these that is not a guess.
  //
  // WebKit bug 269535, open: if a finger or a palm is already on the glass
  // when the Apple Pencil lands, WebKit dispatches NO POINTER EVENTS AT ALL
  // for that pencil contact. Not a pointerdown, not a cancel, not an error —
  // the stroke happens on the screen and the page is never told. Writing a
  // second letter with your hand still resting from the first is exactly that
  // race, which is why it is always the second one, why it is intermittent,
  // and why no amount of driving a headless browser could ever produce it.
  //
  // The asymmetry that makes this fixable: on iOS, preventDefault on a POINTER
  // event does not call off the system gesture recognisers, and preventDefault
  // on a TOUCH event does. So the touch stream is refused outright — which is
  // what both of the published fixes for this symptom do, and what stops the
  // recogniser claiming the sequence before the pencil's pointer events are
  // ever synthesised.
  //
  // { passive: false } is not optional: a passive listener cannot
  // preventDefault, and would look exactly like this change doing nothing.
  //
  // Not on the chrome. Refusing touches on a button is refusing the button.
  for (const type of ['touchstart', 'touchmove']) {
    root.addEventListener(type, (e) => {
      if (onChrome(e)) return;
      if (e.cancelable) e.preventDefault();
    }, { passive: false });
  }

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
    // CHOOSING A NOTE COMES FIRST.
    //
    // While the notes are being corrected, a tap on the music is a tap on a
    // note — not a page turn. The turn zones are the outer thirds of the page
    // and that is exactly where the music is, so without this the first note
    // somebody tried to fix turned the page instead.
    if (correcting && !onChrome(e) && !e.target?.closest?.('#reader-correct')) {
      const hit = noteAt(e.clientX, e.clientY);
      chosen = hit ? hit.id : null;
      showChosen();
      if (hit) { tapFrom = null; e.preventDefault(); return; }
    }
    // The turn happens on the way DOWN. Always.
    //
    // A tap used to be read on the way up, because until the finger leaves you
    // cannot be certain it was a tap rather than a swipe or the first finger of
    // a pinch — and being certain is worth the few tens of milliseconds it
    // costs. On a stand, mid-phrase, it is not: the hand is already going back
    // to the string and the page has to be there. This was a mode for a while
    // and it should never have been one, because there is no moment at which
    // you would rather the page came later.
    //
    // What is given up is small and worth giving up. A swipe that begins in a
    // turn zone now turns the page as it starts rather than as it ends — but it
    // turns it the same way, since the near edge is the direction you are
    // swiping from. And the tap-to-hide-the-bar in the middle of the page is
    // untouched, because the middle is not a turn zone.
    //
    // The top strip is tested FIRST and is not a turn: it overlaps both zones,
    // and a hand going up there is reaching for the controls.
    if (!tool && !isMenuOpen() && !pinching && zoom === 1
      && pointers.size <= 1 && e.pointerType !== 'pen' && !pendingLink
      && !onChrome(e)) {
      if (e.clientY < window.innerHeight * TOP_REACH) {
        // Up here is the bar, either way round — showing it if it is away, and
        // getting out of the way of a tap meant for it if it is already down.
        if (!chrome) { setChrome(true); tapFrom = null; return; }
      } else if (!chrome) {
        const third = window.innerWidth / 3;
        if (e.clientX < third) { previousPage(); tapFrom = null; return; }
        if (e.clientX > window.innerWidth - third) { nextPage(); tapFrom = null; return; }
      }
    }
    // The palm is turned away here as well as at the door.
    //
    // trackPointers refuses a touch while the pencil is down, but a `return`
    // only leaves the listener it is in — and this is a second listener on the
    // same element. Without saying so again here, a hand settling on the iPad
    // halfway through a fingering would land in `tapFrom`, lift with the pen,
    // read as a tap on the music, and put the pen away mid-annotation. The
    // pencil's own entry is left exactly as it was.
    if (penIsDown() && e.pointerType !== 'pen') return;
    // How many marks were on the piece when this gesture began.
    //
    // It used to be recorded by the ink layer, which only sees the touches it
    // is going to DRAW with. So once a finger stopped being allowed to draw,
    // the number stayed at whatever the last pencil stroke left it — and onTap,
    // comparing against it to ask "did this tap write something?", got a yes
    // every time and refused to put the bar away. A tap with the finger did
    // nothing at all, which is precisely the complaint. It belongs here, where
    // every gesture starts, drawing or not.
    marksAtDown = strokes.length;
    // A second finger means a PINCH, not merely a second contact.
    //
    // This asked whether anything else was on the glass, and a hand resting on
    // the iPad is something else on the glass — so with the pencil up and your
    // hand down, which is how anyone holds a tablet, every tap was thrown away
    // before it began. `pinching` is set the moment two fingers really are one
    // gesture, so the original intent survives and a resting hand stops eating
    // your taps.
    tapFrom = pinching ? null : { x: e.clientX, y: e.clientY, at: e.timeStamp, id: e.pointerId };
  }, true);
  root.addEventListener('pointerup', (e) => {
    if (e.pointerType === 'pen') return;
    if (penIsDown()) return;
    const from = tapFrom;
    tapFrom = null;
    if (!from || from.id !== e.pointerId || pinching) return;
    if (onSwipe(e, from)) return;
    if (Math.hypot(e.clientX - from.x, e.clientY - from.y) > TAP_SLIP) return;
    if (e.timeStamp - from.at > TAP_TIME) return;
    onTap(e);
  });

  // Turning the page the other way people turn pages.
  //
  // The tap zones are exact and they are what this reader was built on, but a
  // hand coming off a fingerboard is not an exact instrument, and every reader
  // a player has used takes a swipe as well — forScore documents the two as
  // equals, and swiping is the more forgiving of them precisely because it does
  // not care where on the page you are.
  //
  // Nothing is DRAGGED. The page does not follow the finger and there is no
  // rubber band; the gesture is recognised when the finger leaves, and the page
  // it lands on arrives whole. That is the distinction this screen has always
  // made — a page of music you can push about is a page you lose your place in
  // — and a swipe on the right side of it.
  //
  // Left is forward, the way a page of a book goes.
  const SWIPE_FAR = 55;      // px across before it is a swipe at all
  const SWIPE_STRAIGHT = 1.4; // how much more across than down it has to be
  const SWIPE_TIME = 700;    // ms; slower than this is a hand resting, not a turn

  function onSwipe(e, from) {
    if (tool || pendingLink || isMenuOpen() || zoom !== 1) return false;
    if (onChrome(e)) return false;
    const dx = e.clientX - from.x;
    const dy = e.clientY - from.y;
    if (Math.abs(dx) < SWIPE_FAR) return false;
    if (Math.abs(dx) < Math.abs(dy) * SWIPE_STRAIGHT) return false;
    if (e.timeStamp - from.at > SWIPE_TIME) return false;
    if (dx < 0) nextPage();
    else previousPage();
    return true;
  }
  root.addEventListener('pointercancel', (e) => {
    // A palm whose contact the system cancels — which is exactly what iPadOS
    // does to a palm it has decided is a palm — must not wipe a pending tap on
    // its way out.
    if (e.pointerType === 'pen' || penIsDown()) return;
    tapFrom = null;
  });

  function onTap(e) {
    if (onChrome(e)) return;
    if (isMenuOpen()) { closeMenu(); return; }
    if (el('reader-brush')?.classList.contains('open')) { closeBrush(); return; }
    // A tap on the page hides the BAR. It does not put the pen down.
    //
    // It used to do both, and that was wrong in two directions at once. You
    // would pick the highlighter, mark a phrase, tap the page to see the music
    // — and come back to find the pen had been put away, so annotating a page
    // meant re-arming the tool between every mark. And it only did it for the
    // drawing tools, so with the eraser in hand a tap on the page did nothing
    // whatsoever: the bar sat over the music and would not go.
    //
    // Both are the same mistake — treating "get this bar off my music" and "I
    // have finished annotating" as one gesture. They are not. Tapping the page
    // is the first; the tick on the bar is the second, and it is the only
    // thing that puts a tool down.
    if (tool) {
      // …except the tap that WROTE something. A fingering digit, a comma of a
      // breath mark, a dot over a note: all of them are a few pixels across and
      // all of them are inside what this reader calls a tap. Hiding the bar
      // after every one of those would be its own kind of maddening.
      if (armedByPen) { armedByPen = false; return; }
      if (strokes.length !== marksAtDown) return;
      // With a FINGER, not with the pencil. The pencil is for writing; a tap
      // with it that made no mark is a tap that was going to make one, and
      // taking the bar away underneath it is the reader second-guessing the
      // hand. A finger has nothing else to be doing.
      if (e.pointerType === 'pen') return;
      setChrome(!chrome);
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
    if (e.clientY < window.innerHeight * TOP_REACH) { setChrome(true); return; }
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
    // The pencil came in by another road — see penStroke.
    if (e.pointerType === 'pen') return;
    const isPen = false;
    if (!tool) return;
    // A pencil is never one of the fingers of a pinch, so `pinching` — which
    // exists to stop a finger LIFTING out of a pinch from drawing a line —
    // has nothing to say about it. It used to refuse the pen too, which meant
    // that writing in the quarter-second after you moved the page put down no
    // ink at all: the commonest "I wrote and nothing happened" there is.
    if (pinching && !isPen) return;
    // And a finger only writes if it has been given permission to.
    if (!isPen && !canFingerDraw()) return;
    // A second FINGER is a pinch. A palm while the pencil is writing is not a
    // second anything — it has already been turned away at the door.
    if (pointers.size > 1 && !penIsDown()) {
      if (isPen) penRefused('more than one pointer was down');
      return;
    }
    if (penIsDown() && !isPen) return;
    // A stroke still open when the next one starts.
    //
    // iOS drops a pointerup now and then — it is why everything here has a
    // watchdog — and when it dropped the one that ended a stroke, the next
    // touch replaced the half-finished mark with a fresh one and what you had
    // written vanished as you began writing again. Two letters in a row, one
    // letter on the page. It is FINISHED here rather than abandoned: whatever
    // was drawn is what you drew, and it is kept.
    if (drawing || drawingPointer !== null) {
      drawingPointer = null;
      endStroke();
    }
    try { ink.setPointerCapture(e.pointerId); } catch { /* the stroke goes on */ }
    drawingPointer = e.pointerId;
    marksAtDown = strokes.length;
    beginStroke(e);
    // The tools that make a MARK should have one under way by now. If not, the
    // page could not say where the touch was — which is the failure this was
    // all chasing, and it no longer passes without being written down.
    if (isPen && !drawing && !['eraser', 'lasso', 'text', 'stamp'].includes(tool)) {
      penRefused('the page could not place the touch');
    }
  });
  ink.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'pen') return;
    if (!tool || e.pointerId !== drawingPointer) return;
    // THE one that was losing strokes.
    //
    // The touch that begins a stroke is allowed through while `pinching` if it
    // is a pencil — a pencil is never one of the fingers of a pinch — but this,
    // the handler that does the actual drawing, still refused it. So the stroke
    // began, was recorded as begun, and then every single position of it was
    // dropped on the floor: one point, no line, and endStroke threw the mark
    // away as "that was a tap". No error, nothing refused, nothing to see in
    // any diagnostic — the pen simply did not write that once.
    //
    // Which pinch? A stale one. A pointerup that iOS never delivered left the
    // previous contact in the map, so the next touch made two, and two is a
    // pinch. That is why it was the SECOND stroke.
    if (pinching && e.pointerType !== 'pen') return;
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
      // There is only ever one pencil, so a pencil lifting ends the stroke a
      // pencil was drawing — whatever id it arrives under. Insisting the two
      // match is how a stroke stays open for ever when iOS renumbers a
      // contact, and a stroke that stays open is one the next touch inherits.
      if (e.pointerType === 'pen') return;
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
  // Coming back to the app has no idea what became of the fingers that were on
  // the glass when it left, and neither does anything else. Whatever they were,
  // they are not on the glass now.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') forgetEveryPointer();
  });
  window.addEventListener('blur', forgetEveryPointer);
  window.addEventListener('pagehide', forgetEveryPointer);

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
      if (isMenuOpen()) closeMenu();
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
  // The light follows on a photograph too.
  //
  // This was hung off `take.aligned` over in the engraved path, and a take
  // against a scan has no alignment — there is no written pitch to align it
  // to. So the subscription was never made, and "Play the take" on a scan did
  // exactly what it said and no more: the audio ran, the rings sat still, and
  // the page you were on stayed the page you were on for four minutes. What a
  // scan HAS is the pairing in markedHeads — the notes you played against the
  // noteheads the page reader found — and that is all a light needs.
  //
  // Safe to say on every re-layout: followTake drops its previous subscription
  // before making a new one, so a rotation does not leave two.
  if (take?.notes?.length && layout) followTake();
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
    // …but not YET.
    //
    // Reading a part is seconds of solid arithmetic and it starts the moment
    // the part is opened, which is exactly the moment the look-ahead is trying
    // to get a page or two in front of you. They compete, the look-ahead loses,
    // and the first handful of turns after opening a new part each wait about a
    // second — then it all comes right, which is precisely how it feels: fast,
    // except at the beginning.
    //
    // Standing aside for a turn already in progress was not enough, because
    // between two turns there is nothing to stand aside FOR: the pass simply
    // takes the processor back and the look-ahead never gets ahead. So it waits
    // until the pages either side of you are drawn before it begins at all.
    whenPagesReady()
      .then(() => import('./score.js'))
      .then(({ measurePages }) => measurePages(id, { standAside }))
      // …and then LAY IT OUT AGAIN, which nothing used to do.
      //
      // Where the staves are is what lets a page be cut into screenfuls: a
      // page with no known staves cannot be cut anywhere, so it is shown whole
      // — one tall sheet shrunk to fit, with the music a third the size it
      // should be. That is exactly the state a part is in while this pass is
      // running, and the pass finished into a reader that never asked again.
      // So a freshly imported part read itself, wrote down every stave, and
      // went on showing you the un-banded version until you closed it and
      // opened it back up.
      .then(() => relayoutSameScore(id))
      // A pass that FAILED has not answered the question, so the next open is
      // allowed to ask again. Only a pass that finished puts the score down.
      .catch(() => { reading.delete(id); /* still a score to play from */ });
  }
}

// Until the pages around the one on screen have been drawn.
//
// Capped, because this must never be the reason a part goes unread: a score
// whose pages will not draw at all would otherwise wait for ever, and the
// reading pass is what makes a take markable onto it.
function whenPagesReady(cap = 8000) {
  return new Promise((go) => {
    const from = Date.now();
    const look = setInterval(() => {
      const done = () => { clearInterval(look); go(); };
      if (!root || root.hidden || !isPaper()) return done();
      if (Date.now() - from > cap) return done();
      const last = visiblePages().at(-1) ?? 0;
      for (let i = last + 1; i <= last + KEEP_AHEAD && i < pageEls.length; i++) {
        if (!drawn.has(i)) return undefined;
      }
      return done();
    }, 140);
  });
}

// Lay the pages out again for a score that is still the one on screen.
//
// Guarded on the id because everything here is asynchronous and slow: a
// reading pass started on the part you opened four minutes ago must not
// re-lay-out the part you are reading now, and must not touch a reader you
// have already closed.
async function relayoutSameScore(id) {
  if (!root || root.hidden || score?.id !== id || !isPaper()) return;
  const wasOn = slices[pageIndex]?.page ?? 0;
  drawn.clear();
  await render();
  if (!root || root.hidden || score?.id !== id) return;
  // Back to the same PAGE of paper, which is what the player was looking at —
  // not the same screenful, because there are a different number of those now.
  const at = slices.findIndex((slice) => slice.page === wasOn);
  showPage(Math.max(0, at));
}

const drawn = new Set();
// How many times a page has come back as a card. Bounded, so a page that really
// cannot be read settles on saying so instead of blinking for ever.
const cardTries = new Map();
// Counted so a check can see the card arrive and then go — see readerState.
const cards = { drawn: 0, healed: 0 };
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

// Pages drawn ROUGHLY, because somebody is waiting for them.
//
// A page costs what its pixels cost, and there is one processor. Turn faster
// than the device can render — which is what anyone does on the first taps of a
// part, hunting for where they left off — and every turn waits for a whole page
// to be built at the sharpness you would want to read music at.
//
// You do not need that sharpness to know you are on the wrong page. So a page
// somebody is WAITING for is drawn first at a third of the density, which is
// about a ninth of the work, and the proper one is laid over it a moment later.
// Riffling shows soft pages that keep up; stopping on one sharpens it within a
// breath.
//
// Only ever for a page being waited on. The look-ahead has nobody waiting, so
// it draws properly the first time and there is no second pass to pay for.
const ROUGH = 0.34;
const rough = new Set();

function drawPaperPage(index, { quick = false } = {}) {
  const already = beingDrawn.get(index);
  if (already) return already;
  const one = drawOnePage(index, quick).finally(() => beingDrawn.delete(index));
  beingDrawn.set(index, one);
  return one;
}

async function drawOnePage(index, quick = false) {
  const node = pageEls[index];
  const slice = slices[index];
  if (!paper || !node || !slice) return;
  // Already there, and already as sharp as it is going to be.
  if (drawn.has(index) && !(!quick && rough.has(index))) {
    // …except that a page which is only ROUGH is still owed a proper draw, and
    // returning here is now the commonest way of arriving at one: the turn asks
    // for rough, finds the look-ahead has already done it, and leaves. Without
    // saying so on the way out, the sharpening was scheduled only by the draw
    // that never happened, and a warmed page stayed soft until something
    // unrelated redrew it.
    if (rough.has(index)) sharpenSoon(index);
    return;
  }
  const canvas = node.querySelector('canvas');
  const across = window.innerWidth / (spread ? 2 : 1);
  const mine = era;
  // WHAT THIS DRAW PUT UP, from the draw itself.
  //
  // paper.js used to answer with `drewACard()` / `drewAThumb()` — two booleans
  // for the whole score, drained by whichever caller asked first. Two pages
  // drawing at once, which is a turn and the look-ahead behind it, and the
  // second was told it had drawn neither. MEASURED: four cards drawn, the flag
  // true for the first page and false for the second — and the second was then
  // marked finished below and never asked again, so its card stayed on the
  // music. A draw says what it drew now, to the caller that asked for it.
  let drew = null;
  try {
    // COLD MEANS "PUT SOMETHING THERE NOW".
    //
    // A canvas with no pixels on it is a white rectangle where the music
    // should be, and how long it stays white is how long the page takes to
    // decode or render — a few hundred milliseconds for a photographed page on
    // a phone, and longer for a PDF page. `instant` lets paper.js answer from
    // the small copy it keeps of every page (see THUMB_WIDE) and hand back the
    // debt through `drewAThumb()`, which is paid below by the same sharpening
    // that a fast turn's rough draw uses.
    //
    // Only when the canvas is COLD. A page already on screen is being redrawn
    // for some other reason — a resize, a sharpen — and replacing it with a
    // soft copy first would be a flicker rather than a fix.
    const cold = !drawn.has(index) || canvas.width <= 1;
    drew = await paper.drawBand(slice.page, canvas, slice.rect, across, window.innerHeight,
      quick ? ROUGH : 1, { instant: cold });
  } catch (err) {
    // The pages were rebuilt underneath this one — rotated, resized, a page
    // recropped. It drew on a canvas nobody can see any more, and it has
    // nothing to say about the pages that exist now.
    if (mine !== era) return;
    // A page the renderer chokes on leaves a blank canvas and no explanation,
    // which reads as a score that has lost a page. Say it on the page itself:
    // the rest of the part still turns, and the reason is where the missing
    // music would have been.
    sayOnPage(canvas, saying(`Page ${slice.page + 1} could not be drawn`, err), across);
  }
  if (mine !== era) return;
  // A CARD IS NOT AN ANSWER, IT IS A PAGE THAT HAS NOT ARRIVED YET.
  //
  // `load` in paper.js never remembers a failed decode — the cause is a phone
  // short of memory while it straightens half a dozen photographs and reads
  // them, and the memory comes back — but nothing ever asked again, so the card
  // stayed on the music until the score was closed and reopened. "it'll show
  // the score for about 20 seconds, it'll then say Page 1 could not be read,
  // and I have to go back to the menu and reopen the score."
  //
  // WHY TWENTY SECONDS, and it is not the reading pass being slow. When the
  // pass finishes it stores what it measured, and storing triggers a RE-LAYOUT
  // — `relayoutSameScore` → `layOutPaper`, which destroys the paper instance
  // and builds a new one with an empty cache and an empty set of small copies,
  // then decodes every visible page again from nothing. MEASURED at 16.8–20.3s
  // after opening a four-page part. Before that moment a card is impossible;
  // after it, every page is decoded afresh with nothing to fall back on, at the
  // exact moment the reading pass has finished eating the memory.
  //
  // The retry used to be bounded at three, at 0.9s, 1.8s and 2.7s — so it gave
  // up 5.4s after the first card, and the pressure it is waiting out lasts
  // longer than that. MEASURED on a single page with decodes refused for 12s:
  // four cards, none healed, the card never cleared; with 3s of refusal it
  // healed. It keeps asking now, backing off to a steady three seconds, and
  // stops only when the page arrives or the score is closed — a card is a page
  // that has not come yet, and there is no number of tries after which that
  // stops being true.
  const carded = !!drew?.card;
  if (carded) {
    cards.drawn += 1;
    const tries = (cardTries.get(index) ?? 0) + 1;
    cardTries.set(index, tries);
    setTimeout(() => {
      if (mine !== era) return;
      if (!cardTries.has(index)) return;   // it healed on somebody else's draw
      // NEITHER `drawn` NOR `rough` IS CLEARED HERE, and that is the whole
      // point of marking a carded page rough below. The early return at the top
      // of this function is `drawn && !(sharp && rough)` — so a page that is
      // drawn AND rough falls through to a sharp draw, which is exactly what a
      // card is owed. Clearing `rough` first (which this did, and which I wrote)
      // turns that condition true and the retry returns without drawing
      // anything: MEASURED, four pages carded and still carded 36 seconds
      // later with the retry firing every three.
      drawOnePage(index, false);
    }, Math.min(900 * tries, 3000));
  } else {
    if (cardTries.has(index)) cards.healed += 1;
    cardTries.delete(index);
  }
  // A PAGE PAINTED FROM ITS SMALL COPY IS A ROUGH PAGE, whoever asked for it.
  //
  // `paper.drawBand` puts up the small copy at once where the page has not been
  // decoded yet (see THUMB_WIDE in paper.js) — which is what stops a tap onto a
  // page nobody has turned to from showing white for a second. That page is
  // soft and uncropped, so it owes a proper draw exactly the way a page drawn
  // quickly during a fast turn does, and it goes through the same door.
  const wasThumb = !!drew?.thumb;
  drawn.add(index);
  // A CARD IS NEVER A FINISHED PAGE. `drawn` is what the early return at the
  // top of this function consults, and marking a carded page done was the other
  // half of why a card stuck: the retry deleted it from `drawn`, but any other
  // draw of that page in between put it back and the retry then found nothing
  // to do. It is marked ROUGH instead — which `drawn` needs to stay true for,
  // because `whenPagesReady` counts it — so the page is still owed a sharp draw
  // and the early return will not skip it.
  if (quick || wasThumb || carded) rough.add(index);
  else rough.delete(index);
  // The canvas has just been given a size, which means the box the ink is
  // placed against has just changed — and on the paper path that box IS the
  // canvas. Nothing else invalidates it: a page drawn while the pen is down
  // (coming back to the app, a neighbour landing) would otherwise leave every
  // mark on it placed against the empty rectangle it had before.
  invalidateGeometry();
  dropDryInk();
  redraw(); // the ink layer measures the page it has just been given a size for
  // …and then the same page properly, once nobody is waiting on anything.
  if (quick || wasThumb) sharpenSoon(index);
}

// The proper draw, after the rough one. Held back until the turns have stopped:
// sharpening a page while somebody is still turning past it is the look-ahead's
// mistake all over again.
let sharpening = null;

function sharpenSoon(index) {
  clearTimeout(sharpening);
  sharpening = setTimeout(async () => {
    if (!root || root.hidden || !isPaper()) return;
    for (const i of visiblePages()) {
      if (!rough.has(i)) continue;
      if (turning > 0) return sharpenSoon(i);
      await drawPaperPage(i).catch(() => {});
    }
  }, 220);
  return undefined;
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

// --- correcting what the recogniser got wrong -------------------------------
//
// Reading a photograph is not going to be perfect: it finds most of the notes
// and some of them are wrong, and no amount of work on the recogniser ends in
// "all of them". What ends there is a minute of somebody's time — tap the note
// that is wrong, move it, and it stays fixed, because the correction is written
// into the score the app keeps rather than into a view of it.
//
// Only for a score read off a page. A part exported from MuseScore is already
// what its composer wrote, and tapping a note in it would be an edit nobody
// asked for.

/** Every notehead on screen, with the note it stands for. */
function indexNotesForCorrection() {
  noteHits = [];
  if (!view?.map) return;
  for (const [id, engraved] of view.map) {
    const element = engraved?.gnote?.getSVGGElement?.();
    if (element) noteHits.push({ id, el: element });
  }
}

/** The notehead nearest a tap, if the tap was near one at all. */
function noteAt(x, y) {
  let best = null;
  let bestGap = Infinity;
  for (const hit of noteHits) {
    const box = hit.el.getBoundingClientRect?.();
    if (!box || !box.width) continue;
    const dx = Math.max(box.left - x, 0, x - box.right);
    const dy = Math.max(box.top - y, 0, y - box.bottom);
    const gap = Math.hypot(dx, dy);
    if (gap < bestGap) { bestGap = gap; best = hit; }
  }
  // A finger is wide and a notehead is small: anything within about a finger of
  // one is a tap on it. Further away is a tap on the page, and does nothing.
  return bestGap <= 28 ? best : null;
}

function showChosen() {
  for (const hit of noteHits) {
    const on = hit.id === chosen;
    hit.el.classList?.toggle('chosen-note', on);
    if (on) hit.el.setAttribute('data-chosen', 'yes');
    else hit.el.removeAttribute('data-chosen');
  }
  const bar = el('reader-correct');
  if (bar) bar.classList.toggle('has-note', !!chosen);
}

/** Apply one correction, write it down, and draw it. */
async function correct(change) {
  if (!chosen || !score?.xml) return;
  const { editNote } = await import('../analysis/musicxml-edit.js');
  const result = editNote(score.xml, chosen, change);
  if (!result.changed) {
    say(result.what);
    return;
  }
  undoStack.push({ xml: score.xml, note: chosen });
  await applyCorrection(result.xml, result.what);
}

async function undoCorrection() {
  const back = undoStack.pop();
  if (!back) { say('nothing to undo'); return; }
  chosen = back.note;
  await applyCorrection(back.xml, 'put back');
}

async function applyCorrection(xml, what) {
  score = { ...score, xml };
  // Parsed again so what is drawn, what is played and what a take is marked
  // against are all the corrected score rather than the read one.
  try {
    score.notes = parseScore(xml, { partIndex: score.partIndex ?? 0, steadyBars: asPrinted }).notes;
  } catch { /* the engraver will complain louder than this could */ }
  await saveCorrection(score.id, xml).catch(() => say('that correction could not be saved'));
  const keep = chosen;
  await engrave();
  indexNotesForCorrection();
  chosen = noteHits.some((h) => h.id === keep) ? keep : null;
  showChosen();
  say(what);
}

function correctionBar() {
  let bar = el('reader-correct');
  if (bar) return bar;
  bar = document.createElement('div');
  bar.id = 'reader-correct';
  const button = (label, title, run) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'reader-correct-key';
    b.textContent = label;
    b.title = title;
    b.setAttribute('aria-label', title);
    b.addEventListener('click', run);
    bar.append(b);
    return b;
  };
  button('↑', 'a step higher', () => correct({ steps: 1 }));
  button('↓', 'a step lower', () => correct({ steps: -1 }));
  button('♯', 'sharper', () => correct({ alter: 1 }));
  button('♭', 'flatter', () => correct({ alter: -1 }));
  button('◗', 'half as long', () => correct({ shorter: true }));
  button('◖', 'twice as long', () => correct({ longer: true }));
  button('𝄽', 'not a note — make it a rest', () => correct({ remove: true }));
  button('↺', 'undo', () => undoCorrection());
  const done = button('Done', 'stop correcting', () => setCorrecting(false));
  done.classList.add('reader-correct-done');
  root.append(bar);
  return bar;
}

function setCorrecting(on) {
  correcting = on && asPrinted;
  chosen = null;
  undoStack = [];
  root?.classList.toggle('correcting', correcting);
  const bar = correcting ? correctionBar() : el('reader-correct');
  if (bar) bar.classList.toggle('on', correcting);
  if (correcting) {
    indexNotesForCorrection();
    say(noteHits.length
      ? 'tap a note that is wrong, then move it'
      : 'there are no notes on this page to correct');
  }
  showChosen();
}

// How many pages the sheet itself has, as the recogniser wrote them down. The
// breaks are repeated in every part, so one part's worth is the page count.
function printedPages() {
  const xml = score?.xml ?? '';
  const parts = (xml.match(/<score-part\b/g) ?? []).length || 1;
  const breaks = (xml.match(/new-page="yes"/g) ?? []).length;
  return Math.max(1, Math.round(breaks / parts) + 1);
}

/**
 * A score read off a page, drawn a page at a time like the page it came from.
 *
 * Keeping the lines where the sheet had them is only half of "the same as the
 * scan": the systems still have to FIT. A page shaped like the screen holds
 * three or four of them, so a photographed page came out as two engraved ones
 * with the join in the middle of the music — measured on a real page, 2 pages
 * for 1 — which is the complaint, unchanged, after the line breaks were fixed.
 *
 * So the page is allowed to grow. It keeps the screen's width, in staff spaces,
 * and gets as tall as it needs to be for the systems on it; the reader's own
 * zoom is what makes that readable, exactly as it is on the photograph itself.
 * Bounded: three goes, then whatever it managed, because a page that will not
 * settle is still a page somebody is waiting for.
 */
/**
 * The notes of EVERY part, for a score whose parts are the staves of one page.
 *
 * `score.notes` is one part's worth, which is what a cellist reading their own
 * line wants. On a scan it is half the page — and the half that is left out is
 * invisible to everything that works off the note list: the playback light, a
 * take's marks, and tapping a note to correct it.
 */
function notesOfEveryPart() {
  const mine = score?.notes ?? [];
  if (!score?.xml) return mine;
  try {
    const parsed = parseScore(score.xml, { partIndex: 0, steadyBars: asPrinted });
    if ((parsed.parts?.length ?? 1) < 2) return mine;
    const all = [];
    for (let i = 0; i < parsed.parts.length; i += 1) {
      all.push(...parseScore(score.xml, { partIndex: i, steadyBars: asPrinted }).notes);
    }
    return all;
  } catch {
    return mine;
  }
}

async function engraveAsPrinted() {
  const want = printedPages();
  const base = pageFormat();
  // A PAGE THE SHAPE OF THE SCREEN, WITH SMALLER MUSIC ON IT.
  //
  // Fitting a sheet's systems onto one page means one of two things: a taller
  // page, or smaller music. The first is what this did — it grew the page in
  // staff spaces and left the staff size alone — and the result was an
  // engraving three thousand pixels tall inside a screen eight hundred tall,
  // with the rest of the music below the fold and no way to reach it: the
  // reader turns pages, it does not scroll.
  //
  // So the page keeps the screen's shape and the music shrinks to suit. Asking
  // for k times as many staff spaces in each direction while drawing each one
  // k times smaller leaves the page exactly the size of the screen, with k
  // times more music on it. Pinching still works, and what a pinch does is
  // exactly this.
  let bigger = 1;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    view = await showScore(sheet, {
      xml: score.xml,
      scoreNotes: notesOfEveryPart(),
      partIndex: score.partIndex ?? 0,
      pageFormat: { width: base.width * bigger, height: base.height * bigger },
      zoom: base.zoom / bigger,
      autoRelayout: false,
      asPrinted: true,
    });
    const drawn = view.pages?.length ?? 1;
    if (drawn <= want) break;
    // Room for as much as it overflowed by, and a little over, so the last
    // system does not land a staff space short of fitting.
    bigger *= Math.sqrt(drawn / want) * 1.04;
  }
  return view;
}

async function engrave() {
  // ONLY THE DRAWING DIFFERS.
  //
  // A score read off a page is drawn a page at a time (engraveAsPrinted); what
  // happens next is the same either way, and it very nearly was not. Returning
  // early from here skipped the bar index and the page list — so a scanned
  // score engraved beautifully and then could not be turned, followed or
  // written on, because everything downstream is hung off those two lines.
  if (asPrinted) await engraveAsPrinted();
  else await engravePlainly();
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
  // The notes can be tapped again: the old noteheads went with the old pages.
  if (correcting) indexNotesForCorrection();
  return view;
}

async function engravePlainly() {
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
  return view;
}

// --- what you played, on your own photograph ---------------------------------
//
// ONE PAIRING FOR THE WHOLE APP, AND THIS FILE USED TO BE THE SECOND ONE.
//
// The review pairs a take onto a photograph through scan-view.js's
// `headsOf` + `pairNotes`: an edit distance over the pitches the page reader
// priced off the paper, which survives a dropped note, a repeated bar and a
// take that does not start at the top. This file had its own private pairing
// that did none of that — `scanHeads()` re-walked the layout and
// `markedHeads()` counted noteheads off from the beginning of page one,
// `heads.slice(0, played.length)`. That is exactly the positional pairing
// src/analysis/scan-align.js was written to kill, and it was still alive in
// the view a player actually reads from at a stand, wearing the review's own
// intonation colours, one tap away: score-tab.js listens for a click on the
// whole of #score-stage, so a finger anywhere on the photograph between two
// rings swaps the aligned review for this.
//
// MEASURED, `npm run score:agree` — two engraved pages, a take that begins at
// notehead 36, crosses the page break and skips three written notes, driven
// through the app's own doors (annotateTake + renderScoreTab for the review,
// readCurrentScore for the reader): the review ringed heads 9-78, the reader
// ringed heads 0-37, and NOT ONE of the 37 played notes was on the same
// notehead in the two views. Every ring in here was a specific false claim
// about a specific note, in colour.
//
// THE TAKE IS FILTERED HERE, and that is the quieter half of the same
// disagreement. score.js:610 (`analyseScanTake`) drops every note the
// segmenter could not price BEFORE the review pairs it, while score.js:358
// hands the reader the unfiltered array — so even one shared pairing function
// would have been given two different takes and would have answered
// differently. Mirrored rather than shared because scan-view.js is another
// session's file this round; the two lines want to become one and the place
// for it is score.js, which owns both calls, not either view.
//
// AND THE TIME COMES FROM THE BRIDGE. src/analysis/scan-sync.js joins the
// pairing to the seconds the segmenter measured and answers null everywhere
// there is no answer — between two notes, before the first, after the last,
// and on any note that landed on no notehead at all. The light on the page is
// driven from `headAt(t)`, so a moment nobody played lights NOTHING instead of
// holding the last ring on through a rest.

// { heads, played, pairing, bridge, marks, byHead, why } — worked out once,
// then kept until one of the two things it is made of changes.
//
// Held against the IDENTITY of its two inputs rather than cleared by hand at
// the places that change them. A cache that has to be remembered about is a
// cache that will be forgotten about — and this one would go stale silently,
// as rings drawn round the notes of a take that is no longer on screen.
//
// It is cached for the same reason the old one was: this is read inside the
// paint, which is to say on every frame of every pen stroke, and rebuilding it
// walks every page of the reading and runs a full edit distance to arrive at
// the same answer a hundred times a second.
let scanPair = null;
let scanPairFrom = null;

// A pairing that says no, with the sentence to put on the page in place of the
// rings. Every field the drawing side reads is present, so nothing downstream
// needs a branch for "there is no pairing" — the same shape scan-sync.js's own
// `refused` has, and for the same reason.
function noPairing(why, heads = [], played = []) {
  return { heads, played, pairing: null, bridge: null, marks: [], byHead: new Map(), why };
}

function buildScanPairing(raw) {
  if (!layout) return noPairing(null);
  const heads = headsOf(layout);
  const played = (raw ?? []).filter((n) => Number.isFinite(n?.midi));
  // Two different silences, and they want two different sentences — the review
  // draws the same distinction (score.js scanUnreadNote against
  // scanUnplacedNote). "The pages have not been read" is a fact about the
  // photograph; "the take could not be found on them" is a fact about the take,
  // and telling somebody the wrong one sends them to fix the wrong thing.
  if (!heads.length) {
    return noPairing('These pages have not been read yet, so there is nothing on them'
      + ' to put your playing onto.', heads, played);
  }
  if (!played.length) {
    return noPairing('Nothing in that take could be given a pitch, so there is nothing'
      + ' to mark onto the page.', heads, played);
  }
  const pairing = pairNotes(heads, played);
  const bridge = syncTake({ heads, played, pairing });
  // RULE 3. pairNotes refuses when findStart cannot say where the take begins,
  // and the refusal is CARRIED rather than repaired: falling back to counting
  // from the top of the page is what this whole section is a repair of, and a
  // blank page with a sentence on it beats a page of confident wrong rings.
  if (!bridge.placed) {
    const why = pairing?.why ?? bridge.why ?? null;
    return {
      heads,
      played,
      pairing,
      bridge,
      marks: [],
      byHead: new Map(),
      why: 'Where this take sits on these pages could not be worked out'
        + `${why ? ` — ${why}` : ''}, so nothing is ringed.`,
    };
  }

  // One ring per note that LANDED, taken off the bridge's spans rather than off
  // the pairing's marks, so that the ring a time resolves to and the head that
  // time was measured against are the same object by construction — the same
  // reason scan-view.js builds its own byHead map by walking the spans.
  const marks = [];
  const byHead = new Map();
  for (const span of bridge.spans) {
    const head = heads[span.headIndex];
    if (!head) continue;
    if (!byHead.has(span.headIndex)) byHead.set(span.headIndex, marks.length);
    marks.push({
      ...head,
      headIndex: span.headIndex,
      // WHEN it sounded, carried on the mark rather than looked up by position
      // in `spans` later. A mark list and a span list that are read as parallel
      // arrays is the same assumption `heads.slice(0, count)` was making, one
      // level down: the `continue` above can drop a span, and from that point
      // every start would be paired with the next head's index.
      start: span.start,
      // NULL, not zero. `cents ?? 0` painted a note whose intonation was never
      // measured the same green as one played dead centre; intonationHue reads
      // a non-finite value as 'none' and drawOneMark rings it in --muted.
      cents: Number.isFinite(span.played?.cents) ? span.played.cents : null,
    });
  }
  return { heads, played, pairing, bridge, marks, byHead, why: null };
}

// THE PAGE READS ITSELF WHILE YOU ARE LOOKING AT IT.
//
// A scan opened straight after scanning is opened before anything is known
// about it, so this reader says "these pages have not been read yet" — and it
// used to go on saying it until the score was closed and opened again. That is
// a user's report, in their words: "when I scan something, I'll look at the
// page for a moment and then it says page not read so I have to reopen the
// score."
//
// score.js fires this as each page of the reading pass finishes. The layout
// object is NEW every time, which is what `scanPairing` caches on, so the
// pairing rebuilds itself; the ink cache is dropped so the marks are painted
// again; and where there were no staves at all before, the whole layout is
// done again — a page with none known cannot be cut into screenfuls and is
// shown whole, so the arrival of the first ones changes the shape of the page.
//
// Guarded on the score's id, because a pass started on the part you opened four
// minutes ago must not touch the one in front of you now.
// Subscribed through a dynamic import, and that is not fussiness: score.js
// imports this module, so importing it back at the top would be a cycle and the
// binding would be undefined while this file is still being evaluated. The
// subscription is wanted the first time a reader opens and not before.
let watchingLayouts = false;
function watchLayouts() {
  if (watchingLayouts) return;
  watchingLayouts = true;
  import('./score.js').then(({ onLayoutRead }) => onLayoutRead(layoutArrived)).catch(() => {
    watchingLayouts = false;
  });
}

function layoutArrived(id, fresh) {
  if (!root || root.hidden || !isPaper() || score?.id !== id || !fresh) return;
  const hadStaves = (layout ?? []).some((page) => page?.staves?.length);
  layout = fresh;
  scanPair = null;
  scanPairFrom = null;
  if (!hadStaves && fresh.some((page) => page?.staves?.length)) {
    relayoutSameScore(id).catch(() => { /* still a page to play from */ });
    return;
  }
  dropDryInk();
  redraw();
}

function scanPairing() {
  const raw = take?.notes ?? null;
  if (scanPair && scanPairFrom?.layout === layout && scanPairFrom?.notes === raw) {
    return scanPair;
  }
  scanPairFrom = { layout, notes: raw };
  scanPair = buildScanPairing(raw);
  return scanPair;
}

function markedHeads() {
  return scanPairing().marks;
}

// What this reader believes about this take, as head INDICES into the page's
// own noteheads — so a check can stand the reader beside the review and compare
// them note for note, which is the only way the two were ever going to be
// caught disagreeing. `npm run score:agree` is the check; before it existed
// nothing in the tree compared them.
export function paperPairing() {
  if (!isPaper() || !layout) return null;
  const state = scanPairing();
  return {
    heads: state.heads.length,
    played: state.played.length,
    placed: state.marks.length > 0,
    why: state.why,
    route: state.pairing?.readPitch ? 'pitch'
      : (state.pairing?.aligned ? 'contour' : (state.pairing ? 'refused' : 'unread')),
    // note.start -> head index, which is how two views holding two different
    // copies of the same take can be compared at all.
    byStart: state.marks.map((m) => [m.start ?? null, m.headIndex]),
    headIndices: state.marks.map((m) => m.headIndex),
    lit: soundingMark >= 0 && state.marks[soundingMark]
      ? state.marks[soundingMark].headIndex : null,
  };
}

// A refusal, written where the rings would have been.
//
// It is drawn onto the page rather than said in the status line, and that is
// not decoration: `say()` is cleared by half a dozen other things (finishLink
// calls say('')), and the one sentence explaining why a marked take shows no
// marks would go with it. A page that is blank for a reason has to carry the
// reason.
function drawScanRefusal(ctx, why) {
  const dpr = window.devicePixelRatio || 1;
  const w = ctx.canvas.width / dpr;
  const h = ctx.canvas.height / dpr;
  const size = Math.max(13, Math.min(19, Math.round(w / 46)));
  ctx.save();
  ctx.font = `400 ${size}px system-ui, -apple-system, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const words = why.split(' ');
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > w * 0.62 && line) { lines.push(line); line = word; }
    else line = next;
  }
  if (line) lines.push(line);
  const pad = size;
  const boxW = Math.min(w * 0.72, Math.max(...lines.map((l) => ctx.measureText(l).width)) + pad * 2);
  const boxH = lines.length * size * 1.45 + pad;
  // AT THE FOOT OF THE SCREEN, and that was found by looking rather than
  // decided. Drawn at the top it sat squarely across the first system of a page
  // somebody is trying to play from — see the shot this check writes — and a
  // reader that covers the music to explain itself is worse than the bug. The
  // foot of the screen is where the reader's own hint already lives.
  const top = Math.max(size * 2.4, h - boxH - size * 3.2);
  ctx.fillStyle = 'rgba(28, 26, 34, 0.86)';
  ctx.beginPath();
  ctx.roundRect((w - boxW) / 2, top, boxW, boxH, size * 0.6);
  ctx.fill();
  ctx.fillStyle = '#f2f0ea';
  lines.forEach((one, i) => {
    ctx.fillText(one, w / 2, top + pad / 2 + size * 0.72 + i * size * 1.45);
  });
  ctx.restore();
}

function drawScanMarks(ctx) {
  if (!isPaper() || !take?.notes?.length || !layout) return;
  const state = scanPairing();
  // RULE 3 arriving at the one place a player would otherwise never find out.
  // No rings, and the reason where the rings would have been.
  if (!state.marks.length) {
    if (state.why) drawScanRefusal(ctx, state.why);
    return;
  }
  const colours = { good: '--good', sharp: '--sharp', flat: '--flat' };
  const style = getComputedStyle(document.documentElement);
  for (const [i, head] of state.marks.entries()) {
    // The same page-to-screen mapping the ink uses, so a ring and a fingering
    // written on the same note stay on the same note.
    const place = pageToScreen(head.page, head.x, head.y);
    if (place) drawOneMark(ctx, head, place, style, colours, i === soundingMark);
  }
}

function drawOneMark(ctx, head, place, style, colours, lit = false) {
  {
    const token = colours[intonationHue(head.cents)] ?? '--muted';
    ctx.save();
    ctx.strokeStyle = style.getPropertyValue(token).trim() || '#888';
    // Sized off the staff space the page reader measured, at the scale this
    // system is being shown — so a mark is the size of the notehead it rings.
    const { x, y } = place;
    const r = Math.max(3, head.space * place.unit * 0.62);
    ctx.lineWidth = Math.max(1, r * 0.26);
    // The one being heard, right now.
    //
    // Told apart by WEIGHT rather than by colour, because colour is already
    // saying something here — how the note landed — and a light that recoloured
    // it would be two facts fighting over one ring. A halo and a thicker line
    // read as "this one" at a stand, from further away than a hue change does,
    // and they leave the intonation reading exactly as it was.
    if (lit) {
      ctx.save();
      ctx.globalAlpha = 0.28;
      ctx.fillStyle = ctx.strokeStyle;
      ctx.beginPath();
      ctx.ellipse(x, y, r * 2.05, r * 1.7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.lineWidth = Math.max(1.5, r * 0.42);
    }
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

// Which mark the playback is inside, on a scanned part. An index into
// markedHeads rather than the head itself, so it survives the list being
// rebuilt underneath it.
let soundingMark = -1;

// The light, on a photograph.
//
// The engraved path finds a notehead ELEMENT and puts a class on it, which is
// the whole trick — and it is a trick a scan cannot borrow, because a scan has
// no elements. The music is pixels on a canvas and the noteheads are places
// the page reader measured, so being lit is not something a notehead can be
// told to do; it is something the ring around it has to be drawn as.
//
// Without this the reader offered "Play the take" on a scan and then played it
// with nothing moving: the audio ran, the rings sat there, and the one thing
// the page can do that a graph cannot — say WHICH note you are hearing —
// simply did not happen.
function followOnPaper(note, t) {
  const { bridge, marks, byHead } = scanPairing();
  // THE TIME BRIDGE, not `marks[played.indexOf(note)]`.
  //
  // The old line took the note's position in the take and used it as a
  // position in the mark list, which is only ever right when the two lists are
  // the same length and in the same order — which is what the positional
  // pairing above guaranteed and what an aligner deliberately does not. With
  // the pairing shared, note 12 of the take may be on notehead 48 and note 13
  // on nothing at all, and only the bridge knows which.
  //
  // headAt(t) is asked FIRST because it is the only direction that can say
  // "nothing is sounding here": it is a half-open interval, so between two
  // notes and either side of the take it answers null, and null lights nothing.
  // followPlayback hands the time as its second argument (report.js
  // tellFollowers) — the same pair of arguments scan-view.js's noteheadFor
  // takes, answered the same way, so the review and the stand light the same
  // notehead at the same instant.
  let span = null;
  if (bridge) {
    if (Number.isFinite(t)) span = bridge.headAt(t);
    else if (note && Number.isFinite(note.start)) {
      // No clock. The note's own moment is what the spans were built from, but
      // the span covering that instant may belong to a NEIGHBOUR — a note that
      // landed on no notehead has no span of its own, and the previous one may
      // still be sounding across its start. So the span is kept only where it
      // is this note's; otherwise nothing is lit, which is the truth.
      const at = bridge.headAt(note.start);
      span = at && (at.played === note || at.played?.start === note.start) ? at : null;
    }
  }
  const next = span && byHead.has(span.headIndex) ? byHead.get(span.headIndex) : -1;
  if (next === soundingMark) return;
  soundingMark = next;
  // The page the note is on comes to the front, so a part plays through
  // without a finger on it — the same promise the engraved side makes.
  const mark = next >= 0 ? marks[next] : null;
  if (mark) {
    const screenful = slices.findIndex((slice) => slice?.page === mark.page);
    if (screenful >= 0 && screenful !== pageIndex) showPage(screenful);
  }
  redraw();
}

function followTake() {
  unfollow?.();
  clearSounding();
  soundingMark = -1;
  unfollow = followPlayback((note, t) => {
    refreshPlayButton();
    if (isPaper()) { followOnPaper(note, t); return; }
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

// ASKED, NOT READ OFF THE BUTTON'S FACE.
//
// Both of these used to go through `#clip-play`: pressing it with `.click()`
// and deciding whether the take was running by comparing its textContent with
// '▶'. That is one fact kept in two places, and the second of them is a glyph —
// change the character and the reader silently believes a stopped take is
// playing, with no error anywhere. It also meant the reader could only work a
// button that was ON THE PAGE, so the transport was unreachable whenever the
// review's panel happened to be borrowed or hidden. report.js owns the player;
// it can be asked and it can be told.
function togglePlayback() {
  toggleTakePlayback();
  // The engine flips its own controls; catch up a moment later so this button
  // agrees with them.
  setTimeout(refreshPlayButton, 60);
}

function refreshPlayButton() {
  const mine = el('reader-play');
  if (!mine) return;
  const playable = !!take && !document.querySelector('#playback')?.hidden;
  mine.hidden = !playable;
  if (!playable) return;
  const on = takeIsPlaying();
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
  // OPENING COUNTS AS BUSY. See `standAside`: it lets the reading pass run flat
  // out whenever the reader is hidden, which is exactly what the reader is
  // while it opens — so a part just scanned had the heaviest pass in the app
  // racing the render of its own first page.
  comingUp = true;
  // …and never for longer than it can plausibly take. A reader whose open
  // throws somewhere unguarded would otherwise hold the reading pass off for
  // the life of the session.
  setTimeout(() => { comingUp = false; }, 20000);
  build();
  // A scan opened before it has been read refreshes itself when it is — see
  // layoutArrived.
  watchLayouts();
  // …and the record button starts saying whatever the recorder is doing, which
  // may be "already recording" if the take was started from the other door.
  watchTake();
  score = row;
  asPrinted = await wasReadFromPages(row).catch(() => false);
  take = analysed;
  setlist = programme;
  moveSet = onSetlistMove;
  pendingLink = null;
  strokes = (await loadAnnotations(row.id).catch(() => []))
    .map((stroke) => ({ ...stroke, points: stroke.points.map(onPaperNow) }));
  dropDryInk();     // a different piece, with different marks on it
  scanPair = null;
  scanPairFrom = null;
  history = [];
  redoable = [];
  // The pen case, the sheet you were writing on and the sheets you had put out
  // of sight, as you left them — see recallBrushes. What is NOT carried over is
  // the undo history, which belongs to a piece and to an evening.
  layer = 0;
  hidden = new Set();
  recallBrushes();
  picked = [];
  lasso = null;
  // A take opened with a scan arrives already marked: you came here from a
  // review, and hunting through a menu for the thing you came to see is a
  // menu getting in the way.
  painted = row.kind === 'pages' && !!analysed?.notes?.length;
  spread = wantsSpread();
  root.classList.toggle('spread', spread);
  try {
    pencilSeen = globalThis.localStorage?.getItem(PENCIL_SEEN_KEY) === 'yes';
  } catch { pencilSeen = false; }
  try { night = globalThis.localStorage?.getItem(NIGHT_KEY) === 'on'; } catch { night = false; }
  root.classList.toggle('night', night);
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
  // Whatever was highlighted on the way in does not follow the music onto the
  // stand: a selection made in the library, on a title or a date, would sit
  // there in blue under a full-screen page of a part.
  dropSelection();
  el('reader-title').textContent = row.name ?? '';
  const opening = sayOpening(row);
  try {
    drawn.clear();
    await render();
  } catch (err) {
    opening.remove();
    comingUp = false;
    close();
    throw err;
  }
  opening.remove();
  setTool(null);
  refreshBrushUI();
  refreshHistoryButtons();
  showPage(0);
  // The first page is on the glass; the reading pass may have the processor
  // back. Anything after this is the look-ahead, which already yields.
  comingUp = false;
  refreshPlayButton();
  refreshLandButton();
  return view;
}

/**
 * What the reader has in hand, for a check to look at.
 *
 * The bar index and the page list are what page turning, pencil anchoring,
 * bookmarks and the playback light are all hung off. A score can engrave
 * perfectly with both of them empty — which is exactly what happened when a
 * scanned score got a drawing path of its own — and nothing on the screen says
 * so until somebody tries to turn a page.
 */
export function readerState() {
  // `bars` is a Map keyed by bar number, `pageEls` a list of page elements.
  // `bars` is a Map keyed by bar number, `pageEls` a list of page elements, and
  // `map` is every note that found the notehead it belongs to.
  return {
    pagesKnown: pageEls?.length ?? 0,
    barsKnown: bars?.size ?? 0,
    notesIndexed: view?.map?.size ?? 0,
    unmatched: view?.unmatched?.length ?? 0,
    // How many times a page came back as the "could not be read" card, and how
    // many of those the reader then put a real page over without anybody
    // touching anything. The second number is the whole of the promise: a card
    // is a page that has not arrived yet.
    cardsDrawn: cards.drawn,
    cardsHealed: cards.healed,
    // How many pages have a small copy ready to be painted the instant somebody
    // taps onto them — see THUMB_WIDE in paper.js. A check that finds this at
    // zero is measuring a reader whose warm pass never ran, not a slow turn.
    thumbsReady: paper?.thumbsReady?.() ?? null,
    roughNow: rough.size,
  };
}

export function close() {
  if (!root || root.hidden) return;
  // A mode left on is a mode somebody meets again without asking for it: the
  // next score opened would take a tap on the music as a tap on a note.
  if (correcting) setCorrecting(false);
  clearTimeout(saveTimer);
  if (score) saveAnnotations(score.id, strokes).catch(() => {});
  root.hidden = true;
  closeMenu();
  closeBrush();
  // The layer, stamp and page-jump popups live in the body and are anchored to
  // buttons that are about to be hidden; left open they hang over the library.
  closeAnyPop();
  stopAids();     // no click and no microphone left running behind a shut score
  // The button stops listening, and DELIBERATELY does not stop the take: a page
  // turn between movements closes nothing, but somebody who shuts the score to
  // look something up has not finished playing, and a recording that ends
  // because a screen was closed is a recording nobody asked to end. The Record
  // tab still has it.
  takeWatch?.();
  takeWatch = null;
  // …and the pin the take put on the chrome goes with the watcher that set it.
  // Left on, it would follow the next score onto the stand and refuse to let
  // its bar out of the way — a reader that will not clear itself, for a take
  // that is not running.
  // `taking` was the class that pinned the bar open for the length of a take.
  // Nothing sets it any more (see setChrome); this stays so a reader left open
  // across a reload of the module cannot come back wearing it.
  root.classList.remove('taking');
  for (const pop of document.querySelectorAll('.pick-pop.pages')) pop.remove();
  delete document.documentElement.dataset.reading;
  unfollow?.();
  unfollow = null;
  clearSounding();
  soundingMark = -1;   // …and the lit ring on a scan, which is not an element
  view?.destroy?.();
  view = null;
  paper?.destroy?.();
  paper = null;
  pageEls = [];
  // Closing is a re-laying-out like any other: draws still in flight belong to
  // a score that is no longer open, and none of them may report back.
  era++;
  drawn.clear();
  cardTries.clear();   // a different score's pages, and a different tally
  cards.drawn = 0;
  cards.healed = 0;
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
  turning = 0;
  scanPair = null;
  scanPairFrom = null;
  dry = null;
  dryKey = null;
  lastInkAt = null;
  penPointer = null;
  penStroke.live = false;
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

/**
 * One line over the page, for something the player needs to know while they are
 * still reading. It reuses the first-run hint's own element and styling rather
 * than growing a second kind of message: the reader has exactly one place it
 * ever says anything, and it is the bottom of the page.
 *
 * It exists for the take that heard nothing. Everything else about a take is
 * said on the review, and the review is somewhere else.
 */
export function sayOnTheMusic(text) {
  if (!root || root.hidden) return;
  for (const old of root.querySelectorAll('#reader-hint')) old.remove();
  const note = document.createElement('div');
  note.id = 'reader-hint';
  note.textContent = text;
  root.append(note);
  setTimeout(() => note.remove(), 3600);
}

export function readerIsOpen() {
  return !!root && !root.hidden;
}
