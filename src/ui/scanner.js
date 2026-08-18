// Scanning a part with the camera, page after page.
//
// The file picker was never the way this gets used. Music arrives as a book
// open on the stand, and what a player wants is to hold the phone over it,
// turn the page, hold it over the next one, and be done — not to photograph
// eight pages into the camera roll and then find them again in a picker.
//
// So this is a session: the camera stays up, pages pile up in a strip along the
// bottom, any of them can be thrown away and taken again, and one button ends
// it with a score. There is no page limit; there is no order to get right,
// because the order is the order you shot them in.
//
// The sheet of paper is found in the picture several times a second and drawn
// on it: a blue outline round the page when it has got it, nothing when it has
// not. That outline is the whole interface. You can see whether the scan is
// going to come out before you press anything, and what gets kept is exactly
// what was outlined — the page pulled square out of the frame, not the
// photograph of a book on a table.
//
// ONE SHEET AT A TIME, and that is a decision rather than a limitation. Over an
// open book the finder knows perfectly well that there are two pages there —
// and the outline still fills in over ONE of them: the page under the middle of
// the picture, which is the page you are pointing the phone at. The other is
// drawn as a thin line so you can see it was noticed and that the blue stops at
// the gutter rather than running across the spread.
//
// It was the other way round for a while: both pages outlined, numbered 1 and 2,
// and one press keeping both. What that actually looks like through the phone
// is a blue wash over most of the frame, and the question "is it going to keep
// the page or the book?" has no answer you can see. One press, one sheet,
// exactly what is filled in — you turn to the other page the same way you turn
// to the next one.
//
// It also says how far away to be. The page is stored at the size it was in the
// picture, so a page shot from across the room is a page kept at a fifth of the
// resolution the phone was holding, and nothing downstream can put that back.
// The shutter goes blue when the paper fills a third of the frame or more, and
// says "closer" until it does.
//
// Two shutters, both driven by that. The manual one is a button, and it lights
// up blue the moment the page is squarely in view. The automatic one takes the
// shot itself when the outline has held still, and then refuses to take another
// until the picture CHANGES, which is what turning a page does. That last part
// is the whole trick; without it an auto-shutter takes forty photographs of the
// same page while you reach for the corner.

import {
  findPages, coverageOf, quadsMoved, aimedPage,
} from '../analysis/page-edges.js';
import { straightenCanvas, readableImage, sizeOfImage, papersIn } from './straighten.js';

let root = null;
let video = null;
let strip = null;
let guide = null;      // the outline drawn over the picture
let statusLine = null;
let stream = null;
let pages = [];        // File objects, in the order they were taken
// The photograph behind each of those pages, and where the paper was found in
// it. Alongside `pages` rather than inside it because what leaves this screen
// is a list of pages; the negatives stay here and go when the session does.
let shots = [];        // { raw: Blob, corners: quad | null }
let watching = null;   // the interval that runs the auto-shutter
let armed = true;      // may the auto-shutter fire?
// The shutter is yours. The camera finds the page and shows you it has — the
// blue outline — and then waits, because a scanner that fires by itself takes
// the picture half a beat before you have the book flat, and you find out two
// pages later. Auto is still here, one tap away, for somebody working through
// a thick part at a rhythm; it starts off.
let auto = false;
let cleanUp = true;    // pull the page square and take the shadows out, on the way in
let paper = [];        // where the page or pages are in the LIVE picture: the outline
let held = null;       // where they were a tick ago, for deciding it is being held still
let done = null;       // resolve the promise openScanner returned

// The sampling canvas: tiny on purpose. Nothing here needs detail, and reading
// a full camera frame five times a second is how a scanner turns a phone into a
// hand-warmer.
const SAMPLE_W = 64;
const SAMPLE_H = 48;
const sample = document.createElement('canvas');
sample.width = SAMPLE_W;
sample.height = SAMPLE_H;

// A second, larger look at the picture: enough to find the corners of a sheet
// of paper, still small enough to do it several times a second. It is the same
// search that runs when the shutter goes, AT THE SAME WIDTH — the outline used
// to be looked for at 200 pixels across and the kept page at 220, so the two
// could disagree about whether there was a page at all, and the promise this
// file makes at the top of it (what gets kept is exactly what was outlined) was
// not quite true.
const EDGE_W = 220;
const edges = document.createElement('canvas');

function findPaper() {
  if (!video?.videoWidth) return [];
  const w = EDGE_W;
  const h = Math.max(1, Math.round((video.videoHeight / video.videoWidth) * w));
  if (edges.width !== w || edges.height !== h) { edges.width = w; edges.height = h; }
  const ctx = edges.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(video, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  const luma = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    luma[i] = data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114;
  }
  try {
    return findPages(luma, w, h);
  } catch {
    return [];
  }
}

// The page, drawn on the picture the way every scanner app does it: a blue
// outline when it has got it, and nothing at all when it has not. It is the
// only feedback that matters — you can see whether the thing is going to work
// before you press anything, and you press when it is blue.
//
// TWO outlines when the camera is over an open book, one round each page, and
// each numbered. That is the whole of the interface for a spread: you can see
// before you press anything that this is going to come out as two pages rather
// than as one page bent down the middle.
function showPaper(quads, ready) {
  if (!guide || !video?.videoWidth) return;
  const box = video.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  if (guide.width !== Math.round(box.width * dpr) || guide.height !== Math.round(box.height * dpr)) {
    guide.width = Math.round(box.width * dpr);
    guide.height = Math.round(box.height * dpr);
  }
  guide.style.width = `${box.width}px`;
  guide.style.height = `${box.height}px`;
  const ctx = guide.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, box.width, box.height);
  if (!quads?.length) return;
  // The video is drawn with object-fit: cover, so the picture is cropped to the
  // screen, not letterboxed into it. The outline has to be cropped the same way
  // or it sits somewhere the page is not.
  const scale = Math.max(box.width / video.videoWidth, box.height / video.videoHeight);
  const shownW = video.videoWidth * scale;
  const shownH = video.videoHeight * scale;
  const offX = (box.width - shownW) / 2;
  const offY = (box.height - shownH) / 2;
  ctx.save();
  ctx.lineJoin = 'round';
  const keeping = aimed(quads);
  quads.forEach((quad, page) => {
    const at = quad.map(([x, y]) => [offX + x * shownW, offY + y * shownH]);
    ctx.beginPath();
    at.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    // The page being aimed at is the one that gets kept, and it is the only one
    // that is filled in. The other page of a book gets a hairline: enough to
    // say "seen, and not this one", not enough to read as part of the shot.
    if (page === keeping) {
      ctx.lineWidth = ready ? 4 : 2.5;
      ctx.strokeStyle = ready ? 'rgb(58 130 255)' : 'rgb(255 255 255 / 0.55)';
      ctx.fillStyle = 'rgb(58 130 255 / 0.14)';
      if (ready) ctx.fill();
    } else {
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 6]);
      ctx.strokeStyle = 'rgb(255 255 255 / 0.35)';
    }
    ctx.stroke();
    ctx.setLineDash([]);
  });
  ctx.restore();
}

// The page the shutter will keep, out of what is in the frame. -1 when there is
// no paper at all.
function aimed(quads) {
  return aimedPage(quads);
}

function readyToShoot(on) {
  const shutter = el('scan-shutter');
  if (shutter) shutter.classList.toggle('ready', on);
}

// Thresholds, and the reason they are this loose.
//
// The first version of these was tuned against a synthetic camera and never
// fired against a real one: a phone's picture is never still. Auto-exposure
// breathes, the sensor is noisy, a hand holding a phone over a book moves a
// millimetre a second — the mean frame-to-frame difference sits around 8–12
// even when nothing is happening, so a threshold of 6 meant "hold steady"
// forever and a shutter that never went off.
//
// So: a much more forgiving idea of still, a much more forgiving idea of paper,
// and — the part that matters — a fallback. If the picture has been reasonably
// steady for a couple of seconds and no shot has been taken, it takes one.
// Somebody holding a phone over a page for two seconds wants a photograph, and
// a scanner that refuses because the light is grey is a scanner nobody uses.
// …and the reason THIS is measured on the page rather than on the picture.
//
// A mean frame-to-frame luma difference is not a measure of how still the phone
// is being held. It is a measure of how much of the frame is filled with ink
// that is moving, and the same hand-shake reads three times as big with the
// phone close over a page as it does at arm's length — measured on a synthetic
// camera: a one-pixel drift is 1.7 with the page filling a third of the frame
// and 8–12 with it filling most of it, against a threshold of 15. So the page
// was never "steady" close up, the shutter never lit blue, and the only way to
// get a scan out of this was to hold the phone far enough back that the page
// was a small slab in the middle of the picture — which is exactly the scan
// nobody wants, a page kept at a fifth of the resolution the camera was
// holding and blown up afterwards.
//
// So steadiness is asked of the CORNERS OF THE PAGE, which is the thing that
// actually has to hold still, and answered in fractions of the frame. It means
// the same at every distance.
const HELD_STILL = 0.03;     // how far a corner may drift a tick, in frame widths
const STILL_ENOUGH = 15;     // mean luma difference: the fallback, when no page is found
const MOVED_ENOUGH = 24;     // what counts as "the page was turned"
// How much of the frame the page has to fill before the shutter goes blue. What
// gets stored is the paper and nothing else, so a page shot from across the
// room is stored at the resolution it was in the picture — a fifth of a frame
// of music is a fifth of a page of detail, and no straightening puts that back.
//
// A LOWER BAR OVER A BOOK, and it reads backwards until you draw it. One page
// of an open book cannot fill a third of the frame while the other page is in
// the picture at all: a spread held right up against the phone covers about
// half a 4:3 frame and a third of a tall one, so each page of it is a quarter
// and an sixth. Asking a page of a book for what a loose sheet gives asks for
// something the shape of the phone will not allow, and the advice would run
// "closer" until the book ran off the frame and then "back off".
const FILL_FRAME = 0.3;
const FILL_SPREAD = 0.6;     // of it, for ONE page while the other is in view
const PAPER_FRACTION = 0.2;  // how much of the frame is brighter than its own mid-point
const INK_DENSITY = 0.03;    // how much of it has ink-like detail in it
const STILL_FRAMES = 2;      // ~300ms of holding steady: quick, because the
                             // second half of a scan is done at a rhythm
const PATIENCE = 7;          // ~1s and it takes the shot regardless
const NEW_PAGE = 5;          // how different from the last shot counts as another page
const TICK = 150;            // how often the picture is looked at, in ms

let previous = null;
let shotOf = null;    // what the last photograph looked like
let stillFor = 0;
let waiting = 0;

const el = (id) => document.querySelector(`#${id}`);

function say(text) {
  if (statusLine) statusLine.textContent = text ?? '';
}

// What the camera is looking at, in two numbers: how much it moved since last
// time, and how much of it looks like paper.
function readFrame() {
  const ctx = sample.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(video, 0, 0, SAMPLE_W, SAMPLE_H);
  const { data } = ctx.getImageData(0, 0, SAMPLE_W, SAMPLE_H);
  const count = data.length / 4;
  const next = new Float32Array(count);
  let motion = 0;
  let total = 0;
  for (let i = 0; i < count; i++) {
    const at = i * 4;
    const luma = data[at] * 0.299 + data[at + 1] * 0.587 + data[at + 2] * 0.114;
    next[i] = luma;
    total += luma;
    if (previous) motion += Math.abs(luma - previous[i]);
  }
  // Paper is judged against the frame's OWN brightness rather than an absolute:
  // a page under a desk lamp and a page in a dim practice room are both pages,
  // and a fixed threshold only ever recognised one of them. What a page looks
  // like is a lot of the picture being brighter than the picture's average.
  const mean = total / count;
  let bright = 0;
  for (let i = 0; i < count; i++) if (next[i] > mean * 1.02) bright++;

  // …and a page of MUSIC has ink on it. This is what tells a page from a hand,
  // a sleeve or a table: staff lines and noteheads make hundreds of small
  // dark-to-light steps, and a hand makes almost none. Brightness alone let the
  // shutter fire on the hand that had just turned the page — steady, pale
  // enough, and completely smooth.
  let edges = 0;
  for (let y = 1; y < SAMPLE_H; y++) {
    for (let x = 1; x < SAMPLE_W; x++) {
      const at = y * SAMPLE_W + x;
      const dx = Math.abs(next[at] - next[at - 1]);
      const dy = Math.abs(next[at] - next[at - SAMPLE_W]);
      if (Math.max(dx, dy) > 16) edges++;
    }
  }
  const result = {
    motion: previous ? motion / count : Infinity,
    paper: bright / count,
    ink: edges / count,
    lit: mean,
    frame: next,
  };
  previous = next;
  return result;
}

// Mean difference between two sampled frames. Infinity when there is nothing to
// compare with, which reads as "yes, different" everywhere it is used.
function different(a, b) {
  if (!a || !b || a.length !== b.length) return Infinity;
  let total = 0;
  for (let i = 0; i < a.length; i++) total += Math.abs(a[i] - b[i]);
  return total / a.length;
}

function watch() {
  clearInterval(watching);
  waiting = 0;
  watching = setInterval(() => {
    if (!video || video.readyState < 2) return;
    const { motion, paper: bright, ink, lit, frame } = readFrame();
    // Where the sheet of paper is, every tick, whether or not the shutter is
    // automatic: the outline is what tells you the scan is going to come out.
    const before = held;
    paper = findPaper();
    held = paper.length ? paper : null;
    // How much of the frame the page BEING KEPT fills — not how much all the
    // paper in the picture fills. One press keeps one sheet, so the size of the
    // sheet that press will keep is the number that decides whether it is worth
    // pressing.
    const keeping = aimed(paper);
    const fills = keeping < 0 ? 0 : coverageOf([paper[keeping]]);
    const steady = paper.length ? quadsMoved(paper, before) <= HELD_STILL : motion <= STILL_ENOUGH;
    const close = fills >= FILL_FRAME * (paper.length > 1 ? FILL_SPREAD : 1);
    const ready = paper.length > 0 && steady && close && lit >= 25;
    showPaper(paper, ready);
    readyToShoot(ready);
    // What to do about it, in one line, and each of these is a different thing
    // to do: come closer, back off, hold still, turn a light on.
    const advice = () => {
      if (lit < 25) return 'too dark to see the page';
      if (!paper.length) {
        // Nearly the whole frame is bright and yet no page was found: the paper
        // is running off the edges. That is the one case where the answer is to
        // move AWAY, and it used to be told to come closer.
        return bright > 0.72 ? 'back off a little — the edges are off the frame'
          : 'show the whole page, edges and all';
      }
      if (!close) return 'closer — fill the frame with the page';
      if (!steady) return 'hold it steady…';
      return paper.length > 1
        ? 'tap the button — it keeps the page you are pointing at'
        : 'tap the button — the page is square in view';
    };
    if (!auto) {
      say(advice());
      return;
    }
    // Re-arming asks the right question: not "did the picture just move" but
    // "is this a different page from the one already taken". A hand moving out
    // of shot is movement; the next page is a different picture. Comparing
    // against the last photograph rather than against the last frame is what
    // makes a slow, careful page turn work as well as a brisk one.
    if (!armed && different(frame, shotOf) > NEW_PAGE) {
      armed = true;
      stillFor = 0;
      waiting = 0;
      say('hold it steady…');
      return;
    }
    if (motion > MOVED_ENOUGH) {
      armed = true;
      stillFor = 0;
      waiting = 0;
      say('hold it steady…');
      return;
    }
    if (!armed) return;
    waiting++;
    if (lit < 25) {                       // the lens is covered, or the lights are off
      say('too dark to see the page');
      stillFor = 0;
      return;
    }
    if (!steady) {
      // Anything moving resets the clock — including the hand that just turned
      // the page. Without this the patience below fires on the hand: it is
      // briefly still, briefly bright enough, and you get a photograph of a
      // thumb between every two pages.
      stillFor = 0;
      waiting = 0;
      say(advice());
      return;
    }
    // A page whose four corners are in view is a page: nothing else in a room
    // is a big bright quadrilateral held still under a phone. When the corners
    // cannot be found — the page fills the frame, a hand is over one edge — it
    // falls back to what it always did: mostly paper, with ink on it.
    if (ready) stillFor++;
    else if (paper.length) {
      // Found, held still, and too far away to be worth keeping. Waiting is the
      // right answer: the shutter that fires here is the one that fills a
      // library with pages nothing can read.
      stillFor = 0;
      say(advice());
    } else {
      const looksLikePaper = bright >= PAPER_FRACTION;
      const hasInk = ink >= INK_DENSITY;
      if (looksLikePaper && hasInk) stillFor++;
      else {
        stillFor = 0;
        say(hasInk ? 'point it at the page' : 'move it over the music');
      }
    }
    if (stillFor >= STILL_FRAMES
      || (waiting >= PATIENCE && !paper.length
        && bright >= PAPER_FRACTION * 0.6 && ink >= INK_DENSITY * 0.7)) {
      stillFor = 0;
      waiting = 0;
      armed = false;
      capture();
    }
  }, TICK);
}

// The shutter. What is kept is not the photograph — it is the page out of it:
// the sheet of paper found in the frame, pulled square, with the shadows taken
// off.
//
// The corners are found again, here, on the frame that was actually taken —
// NOT reused from the last tick of the outline. Up to a sixth of a second
// passes between the outline being drawn and a finger arriving on the button,
// and a hand moves in a sixth of a second: warping this frame by where the page
// was in the last one shears the page by exactly that much. Finding them again
// costs about thirty milliseconds and carries no state at all.
// A canvas, encoded and then PROVED: a phone that has run out of room for
// canvases hands back a blob that decodes to nothing, and a page nothing can
// decode is what "could not open that score" was made of. Null if it did not
// come out.
async function pageFrom(canvas, name) {
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
  if (!blob?.size) return null;
  const file = new File([blob], name, { type: 'image/jpeg' });
  return (await readableImage(file)) ? file : null;
}

async function capture() {
  if (!video?.videoWidth) return;
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);
  // Where the paper was, on the frame actually taken. Kept with the shot, so
  // the edges can be moved afterwards without the corners having to be found
  // all over again from a picture the hand has since moved on from.
  //
  // One page comes out of one press, and over a book it is the page that was
  // filled in blue: the one under the middle of the picture. The finder still
  // finds both — that is what makes the kept page STOP at the gutter instead of
  // running across the spread — and the second one is left where it is, for the
  // next press. Warping both onto one rectangle would give a page bent down the
  // middle; taking the bigger one silently would throw half the music away; and
  // taking both on one press was what put a wash of blue over the whole frame
  // with nothing to say which sheet the shot was of.
  const all = cleanUp ? papersIn(canvas, canvas.width, canvas.height) : [];
  const keeping = aimed(all);
  const found = keeping < 0 ? [] : [all[keeping]];
  const taken = [];
  for (const corners of (found.length ? found : [null])) {
    const number = String(pages.length + taken.length + 1).padStart(2, '0');
    const name = `page-${number}.jpg`;
    let page = canvas;
    if (cleanUp) {
      try {
        page = straightenCanvas(canvas, canvas.width, canvas.height, corners);
      } catch {
        page = canvas;    // the photograph as taken is still a page
      }
    }
    // The straightened page first, the photograph as taken behind it: squaring
    // up is worth having and is never worth losing the shot over.
    const file = (await pageFrom(page, name))
      ?? (page === canvas ? null : await pageFrom(canvas, name));
    if (file) taken.push({ file, corners });
  }
  if (!taken.length) {
    say('that shot did not come out — take it again');
    return;
  }
  // The photograph as taken is kept for as long as the session lasts, because
  // moving the edges means going back to it: the straightened page has already
  // thrown away everything outside the outline. Both pages of a spread point at
  // the same photograph and at their own corners in it, so either of them can
  // have its edges moved without disturbing the other.
  const raw = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
  shotOf = previous ? Float32Array.from(previous) : null;
  for (const { file, corners } of taken) {
    pages.push(file);
    shots.push({ raw, corners });
    addThumb(file, pages.length - 1);
  }
  refreshCount();
  waiting = 0;
  // A book still has its facing page in the frame, so the next thing to do is
  // point at it rather than to turn over.
  if (all.length > 1) say('got it — now point at the other page');
  else say(auto ? 'got it — turn the page' : 'got it');
  root.classList.add('flash');
  setTimeout(() => root.classList.remove('flash'), 180);
}

function refreshCount() {
  const button = el('scan-done');
  if (button) {
    button.textContent = pages.length
      ? `Done · ${pages.length} ${pages.length === 1 ? 'page' : 'pages'}`
      : 'Done';
    button.disabled = pages.length === 0;
  }
}

// Both buttons close over the FILE they belong to rather than over a position,
// because positions shift as pages are thrown away — and both are rebuilt when
// a page is taken again with new edges, so neither is left pointing at a page
// that no longer exists.
function dropButton(file, thumbnail, index) {
  const drop = document.createElement('button');
  drop.type = 'button';
  drop.className = 'scan-drop';
  drop.textContent = '✕';
  drop.setAttribute('aria-label', `Throw away page ${index + 1}`);
  drop.addEventListener('click', () => {
    const at = pages.indexOf(file);
    if (at >= 0) { pages.splice(at, 1); shots.splice(at, 1); }
    URL.revokeObjectURL(thumbnail.src);
    thumbnail.parentElement?.remove();
    renumber();
    refreshCount();
  });
  return drop;
}

// Tap the page to say where the paper really was. The badge is there because a
// thumbnail that does something has to look like it does something.
function edgesButton(file, thumbnail, index) {
  const edges = document.createElement('button');
  edges.type = 'button';
  edges.className = 'scan-edges';
  edges.textContent = 'Edges';
  edges.setAttribute('aria-label', `Change the edges of page ${index + 1}`);
  edges.addEventListener('click', () => reshape(file, thumbnail));
  return edges;
}

function addThumb(file, index) {
  const wrap = document.createElement('div');
  wrap.className = 'scan-thumb';
  const image = document.createElement('img');
  image.src = URL.createObjectURL(file);
  image.alt = `Page ${index + 1}`;
  const label = document.createElement('span');
  label.className = 'scan-number';
  label.textContent = String(index + 1);
  wrap.append(image, dropButton(file, image, index), edgesButton(file, image, index), label);
  strip.append(wrap);
  strip.scrollLeft = strip.scrollWidth;
}

// A page, taken again from its own photograph with the corners somebody moved.
//
// Everything is redone from the negative rather than from the page: a crop of a
// crop loses whatever the first one cut off, and the point of this is to get
// back what the finder took away.
async function reshape(file, thumbnail) {
  const at = pages.indexOf(file);
  const shot = shots[at];
  if (at < 0 || !shot?.raw) return;
  const { editCorners } = await import('./crop.js');
  const chosen = await editCorners(shot.raw, shot.corners);
  if (!chosen) return;
  const image = await readableImage(shot.raw);
  if (!image) return;
  const { w, h } = sizeOfImage(image);
  let page;
  try {
    page = straightenCanvas(image, w, h, chosen.quad);
  } catch {
    say('those edges could not be made into a page');
    return;
  }
  const fresh = await pageFrom(page, file.name);
  if (!fresh) {
    say('that did not come out — try the edges again');
    return;
  }
  pages[at] = fresh;
  shots[at] = { ...shot, corners: chosen.quad };
  URL.revokeObjectURL(thumbnail.src);
  thumbnail.src = URL.createObjectURL(fresh);
  // The thumbnail's delete button closes over the OLD file, so it is rebuilt
  // against the new one rather than left pointing at a page that is gone.
  const drop = thumbnail.parentElement?.querySelector('.scan-drop');
  const edges = thumbnail.parentElement?.querySelector('.scan-edges');
  drop?.replaceWith(dropButton(fresh, thumbnail, at));
  edges?.replaceWith(edgesButton(fresh, thumbnail, at));
  say('edges changed');
}

// The numbers on the thumbnails are positions, not names, so throwing away
// page 2 has to renumber everything after it.
function renumber() {
  [...strip.querySelectorAll('.scan-number')].forEach((node, i) => {
    node.textContent = String(i + 1);
  });
}

function button(id, text, className, onClick) {
  const node = document.createElement('button');
  node.type = 'button';
  node.id = id;
  node.className = className;
  node.textContent = text;
  node.addEventListener('click', onClick);
  return node;
}

function build() {
  if (root) return root;
  root = document.createElement('div');
  root.id = 'scanner';
  root.hidden = true;

  video = document.createElement('video');
  video.id = 'scan-video';
  video.setAttribute('playsinline', '');
  video.muted = true;
  video.autoplay = true;

  guide = document.createElement('canvas');
  guide.id = 'scan-guide';
  guide.setAttribute('aria-hidden', 'true');

  const top = document.createElement('div');
  top.id = 'scan-top';
  const autoChip = button('scan-auto', 'Auto', 'scan-chip', () => {
    auto = !auto;
    autoChip.classList.toggle('on', auto);
    autoChip.setAttribute('aria-pressed', String(auto));
    say(auto ? 'hold the page still and it shoots itself' : 'tap the button for each page');
  });
  autoChip.setAttribute('aria-pressed', 'false');
  const cleanChip = button('scan-clean', 'Straighten', 'scan-chip on', () => {
    cleanUp = !cleanUp;
    cleanChip.classList.toggle('on', cleanUp);
    cleanChip.setAttribute('aria-pressed', String(cleanUp));
    say(cleanUp ? 'the page is squared up and the shadows come out'
      : 'pages are kept exactly as photographed');
  });
  cleanChip.setAttribute('aria-pressed', 'true');
  top.append(
    button('scan-cancel', '✕', 'scan-tool', () => finish(null)),
    cleanChip,
    autoChip,
  );

  statusLine = document.createElement('div');
  statusLine.id = 'scan-status';

  strip = document.createElement('div');
  strip.id = 'scan-strip';

  const bottom = document.createElement('div');
  bottom.id = 'scan-bottom';
  bottom.append(
    button('scan-shutter', '', 'scan-shutter', () => { armed = false; capture(); }),
    button('scan-done', 'Done', 'ctl primary', () => finish(pages)),
  );

  root.append(video, guide, top, statusLine, strip, bottom);
  document.body.append(root);
  return root;
}

function stopCamera() {
  clearInterval(watching);
  watching = null;
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
  if (video) video.srcObject = null;
  paper = [];
  held = null;
  showPaper(null, false);
  previous = null;
  shotOf = null;
  stillFor = 0;
  waiting = 0;
}

function finish(result) {
  stopCamera();
  root.hidden = true;
  delete document.documentElement.dataset.scanning;
  for (const image of strip.querySelectorAll('img')) URL.revokeObjectURL(image.src);
  strip.replaceChildren();
  // The photographs go with the pages, so the edges can still be changed
  // tomorrow rather than only during the session that took them.
  const taken = result ? { pages: result, raws: shots.map((shot) => shot.raw ?? null) } : null;
  pages = [];
  shots = [];
  done?.(taken);
  done = null;
}

// Opens the camera and resolves with the pages when the session ends — or with
// null if it was called off. VIDEO ONLY, deliberately: asking for audio here
// would drag the app's microphone session into a job that has nothing to do
// with sound, and this app is careful about when it is listening.
export async function openScanner() {
  build();
  pages = [];
  shots = [];
  auto = false;
  cleanUp = true;
  armed = true;
  paper = [];
  held = null;
  refreshCount();
  el('scan-auto')?.classList.remove('on');
  root.hidden = false;
  document.documentElement.dataset.scanning = 'yes';
  say('starting the camera…');
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 2048 } },
      audio: false,
    });
  } catch (err) {
    finish(null);
    throw new Error(`the camera would not open: ${err.message}`);
  }
  video.srcObject = stream;
  await video.play().catch(() => {});
  say('hold it close, so the page fills the frame — the button lights when it has it');
  watch();
  return new Promise((resolve) => { done = resolve; });
}

export function scannerIsOpen() {
  return !!root && !root.hidden;
}
