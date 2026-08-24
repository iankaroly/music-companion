// Moving the edges of a scanned page by hand.
//
// The scanner finds the sheet of paper itself, and mostly it is right. When it
// is not — a page on a dark score bag, a facing page it took for part of this
// one, a corner under a thumb — there has to be a way to say where the paper
// actually is, and every scanner app has the same one: the photograph as taken,
// the outline drawn over it, a dot on each corner and each edge, and you drag
// them until it fits.
//
// It is a QUADRILATERAL, not a rectangle. A phone held over a book is never
// square to the page, so the four corners move independently and the page is
// pulled square afterwards — which is the only way a crop can take the shape of
// a page photographed at an angle.

import {
  moveCorner, moveEdge, edgeMidpoints, handleAt, WHOLE_FRAME,
} from '../analysis/crop-geometry.js';
import { readableImage, sizeOfImage } from './straighten.js';

const REACH = 0.055;      // how near a finger has to be, in picture terms

let root = null;
let picture = null;       // the photograph, as an <img>
let overlay = null;       // the outline and its handles
let done = null;          // resolve the promise editCorners returned
let quad = null;
let found = null;         // what the scanner thought, for Reset
let dragging = null;      // { kind, index, from } while a handle is held
let frame = null;         // where the picture actually sits on screen

function el(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

// The photograph is drawn with object-fit: contain, so it does not fill its
// box. Everything here works in the picture's own 0–1 terms, and this is the
// one place that knows where those land on the glass.
function measure() {
  const box = picture.getBoundingClientRect();
  const own = overlay?.getBoundingClientRect()
    ?? { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
  const natural = picture.naturalWidth / picture.naturalHeight;
  const shown = box.width / box.height;
  const width = shown > natural ? box.height * natural : box.width;
  const height = shown > natural ? box.height : box.width / natural;
  frame = {
    left: box.left + (box.width - width) / 2,
    top: box.top + (box.height - height) / 2,
    width,
    height,
    // Where the overlay's own coordinate space starts, so what is DRAWN and
    // what is TOUCHED are the same place however the layer is positioned.
    originX: own.left,
    originY: own.top,
    boxW: own.width ?? window.innerWidth,
    boxH: own.height ?? window.innerHeight,
  };
}

// Screen coordinates in the OVERLAY'S OWN BOX, not the window's.
//
// It used to be viewport pixels drawn into a `viewBox` of window.innerWidth by
// window.innerHeight. Those two agree today — MEASURED, at 390x844: the overlay
// is 0,0 390x844 and a handle lands on the pixel the arithmetic asks for — but
// they agree by coincidence rather than by construction, and an SVG whose
// viewBox does not match its box does not clip, it LETTERBOXES: the default
// `preserveAspectRatio` scales the drawing down and centres it, so every handle
// would sit inset from the paper by a margin nobody could see the cause of.
// Without a viewBox at all, one user unit is one CSS pixel of the element, and
// there is nothing left to disagree.
const toScreen = ([x, y]) => [
  frame.left - frame.originX + x * frame.width,
  frame.top - frame.originY + y * frame.height,
];
const toPicture = (x, y) => [(x - frame.left) / frame.width, (y - frame.top) / frame.height];

// The parts of the outline, made ONCE.
//
// `draw` used to write an SVG source string into `overlay.innerHTML` on every
// pointermove — parsing markup, building six elements and throwing the previous
// six away, sixty to a hundred and twenty times a second while a finger is
// down. That is the whole of "it's very glitchy, it's slow": the drag itself is
// four numbers. These are built the first time and only their attributes move
// after that, which is a handful of numbers written into nodes that already
// exist.
let parts = null;

function svg(tag, attrs) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

function buildOverlay() {
  // THE HOLE IN THE SHADE, CUT BY A FILL RULE RATHER THAN BY A MASK.
  //
  // It was a full-screen `<rect>` painted through an SVG `<mask>` whose
  // contents changed on every pointermove. A mask is an offscreen buffer the
  // size of the thing it masks, re-rasterised whenever anything inside it
  // moves — a whole screen of it, every frame, over a twelve-megapixel
  // photograph that is already the most expensive layer on the page. One path
  // with `fill-rule: evenodd` says exactly the same thing with no buffer at
  // all: the outer rectangle winds one way, the quadrilateral inside it the
  // other, and the middle comes out empty.
  const shade = svg('path', { fill: 'rgb(0 0 0 / 0.55)', 'fill-rule': 'evenodd' });
  const line = svg('polygon', {
    fill: 'none', stroke: 'rgb(58 130 255)', 'stroke-width': 2.5, 'stroke-linejoin': 'round',
  });
  const mids = [0, 1, 2, 3].map(() => svg('circle', {
    r: 9, fill: 'rgb(58 130 255 / 0.85)', stroke: '#fff', 'stroke-width': 2,
  }));
  const dots = [0, 1, 2, 3].map(() => svg('circle', {
    r: 13, fill: '#fff', stroke: 'rgb(58 130 255)', 'stroke-width': 3,
  }));
  overlay.replaceChildren(shade, line, ...mids, ...dots);
  parts = { shade, line, mids, dots };
}

function draw() {
  if (!frame) measure();
  if (!parts) buildOverlay();
  const points = quad.map(toScreen);
  const list = points.map((p) => p.join(',')).join(' ');
  // The outer rectangle is the overlay's own box; the inner one is the page.
  // Taken from `measure` rather than read here: `getBoundingClientRect` forces
  // a layout, and forcing one inside the thing that runs on every pointermove
  // is the other half of a janky drag.
  parts.shade.setAttribute('d',
    `M0 0H${frame.boxW}V${frame.boxH}H0Z`
    + `M${points.map((p) => p.join(' ')).join('L')}Z`);
  parts.line.setAttribute('points', list);
  edgeMidpoints(quad).map(toScreen).forEach(([x, y], i) => {
    parts.mids[i].setAttribute('cx', x);
    parts.mids[i].setAttribute('cy', y);
  });
  points.forEach(([x, y], i) => {
    parts.dots[i].setAttribute('cx', x);
    parts.dots[i].setAttribute('cy', y);
  });
}

function onDown(e) {
  measure();
  const [x, y] = toPicture(e.clientX, e.clientY);
  const hit = handleAt(quad, x, y, REACH);
  if (!hit) return;
  e.preventDefault();
  dragging = { ...hit, from: [x, y] };
  try { overlay.setPointerCapture(e.pointerId); } catch { /* tap only */ }
}

function onMove(e) {
  if (!dragging) return;
  e.preventDefault();
  const [x, y] = toPicture(e.clientX, e.clientY);
  if (dragging.kind === 'corner') {
    quad = moveCorner(quad, dragging.index, x, y);
  } else {
    quad = moveEdge(quad, dragging.index, x - dragging.from[0], y - dragging.from[1]);
    dragging.from = [x, y];
  }
  draw();
}

function onUp() {
  dragging = null;
}

// A rotation moves the picture inside its box, so the mapping has to be taken
// again — `draw` only measures when there is no frame at all, which after a
// turn is a stale one rather than none, and the handles were left where the
// screen used to be.
function onResize() {
  fitStage();
  measure();
  draw();
}

function build() {
  if (root) return root;
  root = el('div');
  root.id = 'crop';
  root.hidden = true;

  const stage = el('div', 'crop-stage');
  picture = document.createElement('img');
  picture.id = 'crop-picture';
  picture.alt = 'The page as photographed';
  stage.append(picture);

  overlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  overlay.id = 'crop-overlay';
  overlay.addEventListener('pointerdown', onDown);
  overlay.addEventListener('pointermove', onMove);
  overlay.addEventListener('pointerup', onUp);
  overlay.addEventListener('pointercancel', onUp);

  const bar = el('div', 'crop-bar');
  const cancel = el('button', 'ctl');
  cancel.type = 'button';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', () => finish(null));
  const whole = el('button', 'ctl');
  whole.type = 'button';
  whole.id = 'crop-whole';
  whole.textContent = 'Whole photo';
  whole.addEventListener('click', () => { quad = WHOLE_FRAME.map((p) => [...p]); draw(); });
  const reset = el('button', 'ctl');
  reset.type = 'button';
  reset.id = 'crop-reset';
  reset.textContent = 'What it found';
  reset.addEventListener('click', () => { quad = found.map((p) => [...p]); draw(); });
  const keep = el('button', 'ctl primary');
  keep.type = 'button';
  keep.id = 'crop-keep';
  keep.textContent = 'Use these edges';
  keep.addEventListener('click', () => finish(quad));
  bar.append(cancel, whole, reset, keep);

  const hint = el('p', 'crop-hint');
  hint.id = 'crop-hint';
  hint.textContent = 'Drag the corners onto the corners of the paper, or drag a line to move a whole edge.';

  // THE HINT AND THE BUTTONS, STACKED RATHER THAN BOTH PINNED TO THE BOTTOM.
  //
  // They were two absolutely-positioned things, the hint at a fixed 4.6rem off
  // the floor — which is above a bar of ONE row and underneath a bar of two.
  // Four buttons do not fit across a phone, so the bar wraps, and the sentence
  // telling you what to do was printed straight through "Cancel" and "Whole
  // photo". LOOKED AT, at 390x844, which is the only way that kind of fault is
  // ever found.
  const foot = el('div', 'crop-foot');
  foot.append(hint, bar);
  root.append(stage, overlay, foot);
  document.body.append(root);
  // …and the picture gets whatever is left. Measured rather than guessed at,
  // because how tall the foot is depends on how many rows the buttons take,
  // which depends on the screen and on the words — the 7.5rem that used to be
  // written here was right for one of those and wrong for the other.
  fitStage();
  return root;
}

// How much room the picture has, once the foot has had what it needs.
function fitStage() {
  const foot = root?.querySelector('.crop-foot');
  const stage = root?.querySelector('.crop-stage');
  if (!foot || !stage) return;
  const tall = Math.ceil(foot.getBoundingClientRect().height);
  if (tall > 0) stage.style.bottom = `${tall + 12}px`;
}

function finish(result) {
  root.hidden = true;
  URL.revokeObjectURL(picture.src);
  picture.removeAttribute('src');
  window.removeEventListener('resize', onResize);
  const answer = result;
  done?.(answer);
  done = null;
}

// The photograph as taken, and where the paper was thought to be. Resolves with
// the corners the player settled on, or null if they left it alone.
// The words on the buttons.
//
// This editor does two jobs. On a photograph it is finding the sheet of paper
// in a picture of a room; on a page of a PDF it is trimming the white off
// something already rectangular. The gestures are the same and the sentences
// are not — "Whole photo" on a downloaded part is a button describing a
// photograph that does not exist.
const PHOTO_WORDS = {
  whole: 'Whole photo',
  reset: 'What it found',
  keep: 'Use these edges',
  hint: 'Drag the corners onto the corners of the paper, or drag a line to move a whole edge.',
};

export async function editCorners(blob, corners = null, words = null) {
  build();
  const say = { ...PHOTO_WORDS, ...(words ?? {}) };
  root.querySelector('#crop-whole').textContent = say.whole;
  root.querySelector('#crop-reset').textContent = say.reset;
  root.querySelector('#crop-keep').textContent = say.keep;
  root.querySelector('#crop-hint').textContent = say.hint;
  const image = await readableImage(blob);
  if (!image) return null;
  const { w, h } = sizeOfImage(image);
  found = (corners ?? WHOLE_FRAME).map((p) => [...p]);
  quad = found.map((p) => [...p]);
  picture.src = URL.createObjectURL(blob);
  root.hidden = false;
  await new Promise((resolve) => {
    if (picture.complete && picture.naturalWidth) resolve();
    else picture.onload = resolve;
  });
  // The overlay is sized to the window and the picture to whatever is left of
  // it, so both have to be measured after the layout has happened.
  fitStage();
  measure();
  draw();
  window.addEventListener('resize', onResize);
  return new Promise((resolve) => { done = resolve; })
    .then((result) => (result ? { quad: result, width: w, height: h } : null));
}

export function cropIsOpen() {
  return !!root && !root.hidden;
}
