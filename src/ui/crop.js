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
// `readableImage` and `sizeOfImage` were used to decode the photograph a second
// time before the editor would open. See editCorners for what replaced them.

const REACH = 0.055;      // how near a finger has to be, in picture terms

let root = null;
let picture = null;       // the photograph, as an <img>
let overlay = null;       // the outline and its handles
let done = null;          // resolve the promise editCorners returned
let quad = null;
let found = null;         // what the scanner thought, for Reset
let dragging = null;      // { kind, index, from } while a handle is held
let frame = null;         // where the picture actually sits on screen
// The photograph's shape, before the photograph has arrived.
//
// The editor is drawn BEFORE the picture is decoded now (see editCorners), and
// `measure` needs an aspect ratio to place the outline against. A caller that
// knows the shape says so and the outline lands right first time; without one
// it is placed against the stage and repositions once when the picture lands.
let aspectHint = null;

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
  const natural = (picture.naturalWidth / picture.naturalHeight)
    || aspectHint
    || (box.width / box.height);
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

  // TWO BUTTONS AND NOTHING ELSE.
  //
  // There were four, and a sentence explaining the gesture. "there's a bunch of
  // options with whole photo and writing that overlaps a bunch of things. I
  // don't want that. I just want it to be huge. It doesn't need to tell you
  // where you can trim it. There are no instructions. You can just trim it and
  // then confirm it."
  //
  // He is right about the sentence: the handles are the instruction. Somebody
  // looking at a photograph with a blue box and eight dots on it does not need
  // to be told to drag them, and reading it costs the picture two lines of
  // height on the one screen where the picture is the whole point.
  //
  // "Whole photo" and "What it found" are gone with it. Both were ways back
  // from a bad drag, and Cancel is the way back now — it costs one more tap on
  // the rare occasion somebody wants it, and it buys every other visit a screen
  // with nothing on it but the page.
  // HOW THE PAGE IS DEVELOPED, which is the one option worth a row.
  //
  // "The Fourscore app has more features when you're scanning the page and then
  // you edit it. There are color options, stuff like that."
  //
  // A photographed page is a photograph of paper in a room: warm under a lamp,
  // grey in the shade, and never the flat black-on-white a printed part is.
  // Every scanning app on a phone offers the same four answers to that and they
  // are the right four — leave it alone, take the colour out, push it to ink,
  // or lift the contrast without going all the way. They are BAKED here rather
  // than applied when the page is drawn, because the page is being re-encoded
  // at this moment anyway and a setting kept per page is a setting to store, to
  // migrate, and to get wrong.
  //
  // Nothing else from that editor is copied. Rotation is the obvious next one
  // and it is deliberately absent: turning the picture would have to turn the
  // outline and the eight handles with it, in an editor whose whole geometry is
  // measured off the rendered box of an <img>, and a rotate that breaks the
  // drag is worse than no rotate.
  //
  // AT THE TOP, AS SYMBOLS. They were four words in a row over the buttons, and
  // the buttons are what you press when you are FINISHED — so the one row you
  // touch while you are working sat furthest from the picture and read as a
  // fourth and fifth button to get past. "I want the features for color and
  // stuff to be at the top and be like the symbols." A toolbar over the page,
  // four marks, the one in use lit — which is where every scanner app on this
  // platform puts them, and it gives the picture back the row it was using.
  const looks = el('div', 'crop-looks');
  looks.setAttribute('role', 'radiogroup');
  looks.setAttribute('aria-label', 'How the page is developed');
  for (const one of LOOKS) {
    const chip = el('button', 'crop-look');
    chip.type = 'button';
    chip.dataset.look = one.id;
    chip.setAttribute('role', 'radio');
    // The word is the label a screen reader reads and the tooltip a pointer
    // gets; the mark is what a finger goes to.
    chip.setAttribute('aria-label', one.name);
    chip.title = one.name;
    chip.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"`
      + ` stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"`
      + ` aria-hidden="true">${one.mark}</svg>`;
    chip.addEventListener('click', () => setLook(one.id));
    looks.append(chip);
  }

  const bar = el('div', 'crop-bar');
  const cancel = el('button', 'ctl');
  cancel.type = 'button';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', () => finish(null));
  const keep = el('button', 'ctl primary');
  keep.type = 'button';
  keep.id = 'crop-keep';
  keep.textContent = 'Use these edges';
  keep.addEventListener('click', () => finish(quad));
  bar.append(cancel, keep);

  // THE HINT AND THE BUTTONS, STACKED RATHER THAN BOTH PINNED TO THE BOTTOM.
  //
  // They were two absolutely-positioned things, the hint at a fixed 4.6rem off
  // the floor — which is above a bar of ONE row and underneath a bar of two.
  // Four buttons do not fit across a phone, so the bar wraps, and the sentence
  // telling you what to do was printed straight through "Cancel" and "Whole
  // photo". LOOKED AT, at 390x844, which is the only way that kind of fault is
  // ever found.
  const head = el('div', 'crop-head');
  head.append(looks);
  const foot = el('div', 'crop-foot');
  foot.append(bar);
  root.append(head, stage, overlay, foot);
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
  const head = root?.querySelector('.crop-head');
  const foot = root?.querySelector('.crop-foot');
  const stage = root?.querySelector('.crop-stage');
  if (!foot || !stage) return;
  const tall = Math.ceil(foot.getBoundingClientRect().height);
  if (tall > 0) stage.style.bottom = `${tall + 20}px`;
  const over = Math.ceil(head?.getBoundingClientRect().bottom ?? 0);
  if (over > 0) stage.style.top = `${over + 12}px`;
}

function finish(result) {
  root.hidden = true;
  aspectHint = null;
  URL.revokeObjectURL(picture.src);
  picture.removeAttribute('src');
  window.removeEventListener('resize', onResize);
  const answer = result;
  done?.(answer);
  done = null;
}

// The photograph as taken, and where the paper was thought to be. Resolves with
// the corners the player settled on, or null if they left it alone.
// THE FOUR LOOKS. `filter` is what the picture wears in the editor — it is a
// preview and costs nothing — and `bake` is what is actually done to the pixels
// of the finished page. The two are written next to each other so they cannot
// drift into showing one thing and saving another.
export const LOOKS = [
  // `mark` is what the toolbar draws, `filter` is the preview on the <img>, and
  // `bake` below is what is done to the finished page. All three live on one
  // line each so they cannot drift into showing one thing and saving another.
  {
    id: 'colour',
    name: 'Colour',
    filter: 'none',
    // Three overlapping circles: colour, the way every app draws it.
    mark: '<circle cx="12" cy="8.6" r="4.4"/><circle cx="8.4" cy="15" r="4.4"/>'
      + '<circle cx="15.6" cy="15" r="4.4"/>',
  },
  {
    id: 'grey',
    name: 'Grey',
    filter: 'grayscale(1)',
    // A disc with one half filled — the contrast mark, and the one everybody
    // reads as "take the colour out".
    mark: '<circle cx="12" cy="12" r="8"/>'
      + '<path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" stroke="none"/>',
  },
  {
    id: 'sharp',
    name: 'Sharper',
    filter: 'contrast(1.35) saturate(0.85) brightness(1.05)',
    // A sun: more light, more contrast, nothing thrown away.
    mark: '<circle cx="12" cy="12" r="3.8"/><path d="M12 2.6v2.4M12 19v2.4'
      + 'M2.6 12h2.4M19 12h2.4M5.3 5.3l1.7 1.7M17 17l1.7 1.7M18.7 5.3 17 7M7 17l-1.7 1.7"/>',
  },
  {
    id: 'ink',
    name: 'Ink',
    filter: 'grayscale(1) contrast(2.6) brightness(1.14)',
    // A drop, filled: black on white, and nothing in between.
    mark: '<path d="M12 3.2c3.4 4 5.6 6.6 5.6 9.4a5.6 5.6 0 1 1-11.2 0'
      + 'c0-2.8 2.2-5.4 5.6-9.4z" fill="currentColor" stroke="none"/>',
  },
];
const LOOK_KEY = 'scanLook';
let look = 'colour';
try { look = localStorage.getItem(LOOK_KEY) ?? 'colour'; } catch { /* fine */ }
if (!LOOKS.some((one) => one.id === look)) look = 'colour';

function setLook(id) {
  look = LOOKS.some((one) => one.id === id) ? id : 'colour';
  try { localStorage.setItem(LOOK_KEY, look); } catch { /* fine */ }
  showLook();
}

function showLook() {
  if (!root) return;
  const chosen = LOOKS.find((one) => one.id === look) ?? LOOKS[0];
  picture.style.filter = chosen.filter;
  for (const chip of root.querySelectorAll('.crop-look')) {
    const on = chip.dataset.look === look;
    chip.classList.toggle('on', on);
    chip.setAttribute('aria-checked', String(on));
  }
}

/**
 * Bake a look into a canvas of a finished page, in place.
 *
 * Done on the page rather than on the photograph: `straightenCanvas` has
 * already flattened the lighting across the sheet (see `unshadow`), which is
 * what makes a single threshold a reasonable thing to do at all — on the raw
 * photograph the shadow down one side would come out as a black stripe.
 */
export function bakeLook(canvas, which = look) {
  if (which === 'colour' || !canvas?.width) return canvas;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  let data;
  try { data = context.getImageData(0, 0, canvas.width, canvas.height); } catch { return canvas; }
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    const grey = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    let v = grey;
    if (which === 'ink') {
      // Not a hard threshold: a stem a pixel wide disappears at one, and the
      // page comes out speckled where the paper is. A steep curve about the
      // middle keeps the thin strokes and still takes the paper to white.
      v = 255 / (1 + Math.exp(-(grey - 150) / 12));
    } else if (which === 'sharp') {
      v = Math.max(0, Math.min(255, (grey - 128) * 1.35 + 128 + 8));
    }
    px[i] = v;
    px[i + 1] = v;
    px[i + 2] = v;
  }
  context.putImageData(data, 0, 0);
  return canvas;
}

// The word on the one button that has one.
//
// This editor does two jobs. On a photograph it is finding the sheet of paper
// in a picture of a room; on a page of a PDF it is trimming the white off
// something already rectangular. The gesture is the same and the sentence is
// not — "Use these edges" on a downloaded part is describing a crop of a
// photograph that does not exist.
const PHOTO_WORDS = { keep: 'Use these edges' };

export async function editCorners(blob, corners = null, words = null,
  { develops = true, aspect = null } = {}) {
  build();
  const say = { ...PHOTO_WORDS, ...(words ?? {}) };
  root.querySelector('#crop-keep').textContent = say.keep;
  // Only where the caller is going to re-encode the page. Trimming a page of a
  // PDF stores a rectangle and touches no pixels, so a row of looks there would
  // be four buttons that do nothing.
  root.querySelector('.crop-head').hidden = !develops;
  showLook();
  // THE BLOB WAS LOADED TWICE, AND NOTHING WAS DRAWN UNTIL BOTH FINISHED.
  //
  // "when I go to Crop Scan and click Edges, it's still delayed… It takes a
  // second to open." This read:
  //
  //     const image = await readableImage(blob);   // load #1, off-screen
  //     const { w, h } = sizeOfImage(image);       // its only use
  //     picture.src = URL.createObjectURL(blob);   // load #2, same bytes
  //     root.hidden = false;
  //     await picture.onload;                      // …and nothing drawn until it lands
  //
  // NOT TWO PIXEL DECODES, and the first version of this note said it was.
  // `readableImage` resolves on `<img>.onload` and never calls `.decode()`, and
  // line 1 only ever read `naturalWidth`/`naturalHeight`, which come off the
  // JPEG header — measured at 1.9ms against 57.3ms for the decode that follows
  // at rasterisation. There is one pixel decode and there always was. What the
  // first load actually cost is a second blob URL, a second header parse and a
  // second `<img>` load, of the same bytes under a different URL so nothing is
  // shared between them.
  //
  // The wait was mostly the ORDER, not the work. MEASURED against the running
  // app on a 3000x4000 JPEG, three orderings, medians of three, press to an
  // outline / press to a painted picture, at 20x throttle:
  //
  //     as written                      90 / 90 ms
  //     drawn before the load           13 / 49 ms
  //     one load, shown when ready      54 / 54 ms
  //
  // So: the outline goes up FIRST where the shape is known, and the picture
  // arrives under it — and where it is not, the editor waits and opens with the
  // page already in it. See the note by `aspectHint` below for why that split
  // exists and what the alternative costs.
  found = (corners ?? WHOLE_FRAME).map((p) => [...p]);
  quad = found.map((p) => [...p]);
  aspectHint = Number.isFinite(aspect) && aspect > 0 ? aspect : null;
  picture.removeAttribute('src');
  const url = URL.createObjectURL(blob);
  picture.src = url;
  // ONLY WHERE THERE IS A REAL SHAPE TO DRAW AGAINST.
  //
  // Drawing the outline before the picture lands is worth 13ms to an outline
  // against 54 — but only when the shape is known. Without one the outline is
  // placed against the stage and then MOVES when the photograph arrives:
  // measured at 90 CSS pixels on a 3000x4000 page. A jump that size is worse
  // than the wait it saves, and it is the reader's two call sites that have no
  // shape to give — the page they open on is a stored file, not a frame the
  // scanner has just taken and still knows the size of.
  if (aspectHint) {
    root.hidden = false;
    fitStage();
    measure();
    draw();
  }
  const readable = await new Promise((resolve) => {
    if (picture.complete && picture.naturalWidth) resolve(true);
    else {
      picture.onload = () => resolve(true);
      picture.onerror = () => resolve(false);
    }
  });
  // WHAT `readableImage` WAS ALSO FOR. It was the guard behind `if (!image)
  // return null`, and without something in its place a blob nothing can decode
  // left the editor on screen for ever with a postage-stamp outline and a
  // promise that never settled — measured, on a Blob of the word "not an image
  // at all". The cost of the reorder is a brief flash of the editor before it
  // closes on a picture that cannot be read; the alternative is the wait.
  if (!readable) {
    root.hidden = true;
    URL.revokeObjectURL(url);
    picture.removeAttribute('src');
    aspectHint = null;
    return null;
  }
  const w = picture.naturalWidth;
  const h = picture.naturalHeight;
  // Now that the picture has a size of its own. Where the outline went up
  // early this is the pass that puts it exactly on the photograph; where it did
  // not, this is the only pass, and the editor appears with the page already in
  // it rather than a moment before.
  root.hidden = false;
  fitStage();
  measure();
  draw();
  window.addEventListener('resize', onResize);
  return new Promise((resolve) => { done = resolve; })
    .then((result) => (result ? { quad: result, width: w, height: h, look } : null));
}

export function cropIsOpen() {
  return !!root && !root.hidden;
}
