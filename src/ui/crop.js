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
  const natural = picture.naturalWidth / picture.naturalHeight;
  const shown = box.width / box.height;
  const width = shown > natural ? box.height * natural : box.width;
  const height = shown > natural ? box.height : box.width / natural;
  frame = {
    left: box.left + (box.width - width) / 2,
    top: box.top + (box.height - height) / 2,
    width,
    height,
  };
}

const toScreen = ([x, y]) => [frame.left + x * frame.width, frame.top + y * frame.height];
const toPicture = (x, y) => [(x - frame.left) / frame.width, (y - frame.top) / frame.height];

function draw() {
  if (!frame) measure();
  const points = quad.map(toScreen);
  const mids = edgeMidpoints(quad).map(toScreen);
  overlay.setAttribute('viewBox', `0 0 ${window.innerWidth} ${window.innerHeight}`);
  overlay.innerHTML = `
    <defs>
      <mask id="crop-hole">
        <rect x="0" y="0" width="100%" height="100%" fill="#fff"/>
        <polygon points="${points.map((p) => p.join(',')).join(' ')}" fill="#000"/>
      </mask>
    </defs>
    <rect x="0" y="0" width="100%" height="100%" fill="rgb(0 0 0 / 0.55)" mask="url(#crop-hole)"/>
    <polygon points="${points.map((p) => p.join(',')).join(' ')}"
      fill="none" stroke="rgb(58 130 255)" stroke-width="2.5" stroke-linejoin="round"/>
    ${mids.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="9" fill="rgb(58 130 255 / 0.85)" stroke="#fff" stroke-width="2"/>`).join('')}
    ${points.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="13" fill="#fff" stroke="rgb(58 130 255)" stroke-width="3"/>`).join('')}
  `;
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

  root.append(stage, overlay, hint, bar);
  document.body.append(root);
  return root;
}

function finish(result) {
  root.hidden = true;
  URL.revokeObjectURL(picture.src);
  picture.removeAttribute('src');
  window.removeEventListener('resize', draw);
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
  measure();
  draw();
  window.addEventListener('resize', draw);
  return new Promise((resolve) => { done = resolve; })
    .then((result) => (result ? { quad: result, width: w, height: h } : null));
}

export function cropIsOpen() {
  return !!root && !root.hidden;
}
