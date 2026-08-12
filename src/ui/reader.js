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
  saveBookmarks, saveLinks,
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
  const points = stroke.points.map(at);
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
    // Width from speed: the hand slows into a turn and the line swells there,
    // which is most of what makes handwriting look written rather than plotted.
    let carried = width;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const b = points[i];
      const gone = Math.hypot(b.x - a.x, b.y - a.y);
      const want = width * Math.max(0.35, Math.min(1.5, 1.5 - gone / 26));
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
    ctx.globalAlpha = alpha * 0.55;
    ctx.lineWidth = width;
    polyline(ctx, points);
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
  if (painted) drawScanMarks(ctx);
  drawLinks(ctx);
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
  const point = anchor(at.x, at.y);
  if (point && drawing.type === 'shape') drawing.points[1] = point;
  else if (point) drawing.points.push(point);
  if (drawing.type !== 'shape') watchForHold(at);
  redraw();
}

// A stroke that turned out to be the start of a pinch is not a stroke.
function cancelStroke() {
  stopHold();
  drawing = null;
  redraw();
}

function endStroke() {
  stopHold();
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
    const slice = slices[pageIndex];
    if (!canvas || !slice) return;
    await paper.drawBand(slice.page, canvas, slice.rect,
      window.innerWidth * zoom, window.innerHeight * zoom);
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
      pinching = true;
      drawingPointer = null;
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

// The page after the last one is the next piece in the programme, and the page
// before the first is the end of the one before it. Without a programme they
// are simply the ends of the score.
function nextPage() {
  if (pageIndex + step() >= pageEls.length && setlist && moveSet) {
    if (setlist.index + 1 < setlist.items.length) {
      moveSet(setlist, setlist.index + 1);
      return;
    }
  }
  showPage(pageIndex + step());
}

function previousPage() {
  if (pageIndex === 0 && setlist && moveSet && setlist.index > 0) {
    moveSet(setlist, setlist.index - 1);
    return;
  }
  showPage(pageIndex - step());
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
    onPick: () => setTool('pen'),
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
  eraser: '<path d="M8 19h11"/><path d="M5.5 15.5l6-6 5.5 5.5-4.5 4.5H9z"/>',
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
  const count = document.createElement('span');
  count.id = 'reader-count';
  middle.append(title, count);

  const right = document.createElement('div');
  right.className = 'reader-bar-right';
  right.append(
    iconButton('reader-play', 'play', 'Play the take', togglePlayback),
    iconButton('reader-annotate', 'pen', 'Annotate this page', () => setTool('pen')),
    iconButton('reader-menu-btn', 'more', 'More', toggleMenu),
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
  const brushBtn = iconButton('reader-brush-btn', 'brush', 'Brush style', toggleBrush);
  brushBtn.append(nib);
  bar.append(
    iconButton('reader-done', 'tick', 'Finished annotating', () => setTool(null)),
    toolButton('pen', 'pen', 'Pen'),
    toolButton('highlighter', 'highlighter', 'Highlighter'),
    toolButton('text', 'text', 'Type on the page'),
    iconButton('reader-shapes', 'shapes', 'Lines, boxes and rings', openShapeMenu),
    iconButton('reader-stamps', STAMPS[0].glyph, 'Stamp a sign on the page', openStampMenu),
    toolButton('lasso', 'lasso', 'Pick up marks'),
    toolButton('eraser', 'eraser', 'Rub out'),
    ...PRESETS.map((_, i) => presetSwatch(i)),
    brushBtn,
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
  root.addEventListener('click', (e) => {
    if (e.target.closest('#reader-top, #reader-ink-bar, #reader-menu, #reader-brush')) return;
    if (menuOpen) { closeMenu(); return; }
    if (el('reader-brush')?.classList.contains('open')) { closeBrush(); return; }
    if (tool) return;                        // the pen owns the page while it is out
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
  });

  // Drawing and pinching share the same surface, and the pen must lose every
  // argument between them. A stroke is only started by a lone finger, is thrown
  // away the moment a second one lands, and cannot start again until BOTH have
  // left — otherwise lifting one finger out of a pinch draws a line from
  // wherever the other one happens to be resting.
  ink.addEventListener('pointerdown', (e) => {
    if (!tool || pointers.size > 1 || pinching) return;
    ink.setPointerCapture(e.pointerId);
    drawingPointer = e.pointerId;
    beginStroke(e);
  });
  ink.addEventListener('pointermove', (e) => {
    if (!tool || pinching || e.pointerId !== drawingPointer) return;
    if (e.buttons === 0 && e.pointerType === 'mouse') return;
    extendStroke(e);
  });
  for (const type of ['pointerup', 'pointercancel']) {
    ink.addEventListener(type, (e) => {
      if (e.pointerId !== drawingPointer) return;
      drawingPointer = null;
      endStroke();
    });
  }

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
  if (score.kind === 'pages') return layOutPaper();
  return engrave();
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

async function layOutPaper() {
  const payload = await loadScorePages(score.id);
  layout = payload?.layout ?? null;
  paper?.destroy?.();
  paper = await openPaper(payload);
  view = null;
  bars = new Map();
  sheet.replaceChildren();
  pageEls = [];
  const across = window.innerWidth / (spread ? 2 : 1);
  slices = await bandPages(across / window.innerHeight);
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

const drawn = new Set();

async function drawPaperPage(index) {
  const node = pageEls[index];
  const slice = slices[index];
  if (!paper || !node || !slice || drawn.has(index)) return;
  const canvas = node.querySelector('canvas');
  const across = window.innerWidth / (spread ? 2 : 1);
  await paper.drawBand(slice.page, canvas, slice.rect, across, window.innerHeight);
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
function markedHeads() {
  const heads = scanHeads();
  const played = take?.notes ?? [];
  if (!heads.length || !played.length) return [];
  const count = Math.min(heads.length, played.length);
  return heads.slice(0, count).map((head, i) => ({ ...head, cents: played[i]?.cents ?? 0 }));
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
  drawn.clear();
  slices = [];
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
