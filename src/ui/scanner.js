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
// Two shutters, both driven by that. The manual one is a button, and it lights
// up blue the moment the page is squarely in view. The automatic one takes the
// shot itself when the outline has held still, and then refuses to take another
// until the picture CHANGES, which is what turning a page does. That last part
// is the whole trick; without it an auto-shutter takes forty photographs of the
// same page while you reach for the corner.

import { findPage } from '../analysis/page-edges.js';
import { straightenCanvas } from './straighten.js';

let root = null;
let video = null;
let strip = null;
let guide = null;      // the outline drawn over the picture
let statusLine = null;
let stream = null;
let pages = [];        // File objects, in the order they were taken
let watching = null;   // the interval that runs the auto-shutter
let armed = true;      // may the auto-shutter fire?
// The shutter is yours. The camera finds the page and shows you it has — the
// blue outline — and then waits, because a scanner that fires by itself takes
// the picture half a beat before you have the book flat, and you find out two
// pages later. Auto is still here, one tap away, for somebody working through
// a thick part at a rhythm; it starts off.
let auto = false;
let cleanUp = true;    // pull the page square and take the shadows out, on the way in
let paper = null;      // where the page is in the LIVE picture: for the outline only
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
// search that runs when the shutter goes, so what you see outlined is exactly
// what will be kept.
const EDGE_W = 200;
const edges = document.createElement('canvas');

function findPaper() {
  if (!video?.videoWidth) return null;
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
    return findPage(luma, w, h);
  } catch {
    return null;
  }
}

// The page, drawn on the picture the way every scanner app does it: a blue
// outline when it has got it, and nothing at all when it has not. It is the
// only feedback that matters — you can see whether the thing is going to work
// before you press anything, and you press when it is blue.
function showPaper(quad, ready) {
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
  if (!quad) return;
  // The video is drawn with object-fit: cover, so the picture is cropped to the
  // screen, not letterboxed into it. The outline has to be cropped the same way
  // or it sits somewhere the page is not.
  const scale = Math.max(box.width / video.videoWidth, box.height / video.videoHeight);
  const shownW = video.videoWidth * scale;
  const shownH = video.videoHeight * scale;
  const offX = (box.width - shownW) / 2;
  const offY = (box.height - shownH) / 2;
  const at = quad.map(([x, y]) => [offX + x * shownW, offY + y * shownH]);
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineWidth = ready ? 4 : 2.5;
  ctx.strokeStyle = ready ? 'rgb(58 130 255)' : 'rgb(255 255 255 / 0.55)';
  ctx.fillStyle = 'rgb(58 130 255 / 0.14)';
  ctx.beginPath();
  at.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  if (ready) ctx.fill();
  ctx.stroke();
  ctx.restore();
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
const STILL_ENOUGH = 15;     // mean luma difference between frames, 0–255
const MOVED_ENOUGH = 24;     // what counts as "the page was turned"
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
    paper = findPaper();
    const steady = motion <= STILL_ENOUGH;
    const ready = !!paper && steady && lit >= 25;
    showPaper(paper, ready);
    readyToShoot(ready);
    if (!auto) {
      say(ready ? 'tap the button — the page is square in view'
        : paper ? 'hold it steady…'
          : lit < 25 ? 'too dark to see the page' : 'show the whole page, edges and all');
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
      say('hold it steady…');
      return;
    }
    // A page whose four corners are in view is a page: nothing else in a room
    // is a big bright quadrilateral held still under a phone. When the corners
    // cannot be found — the page fills the frame, a hand is over one edge — it
    // falls back to what it always did: mostly paper, with ink on it.
    if (ready) stillFor++;
    else {
      const looksLikePaper = bright >= PAPER_FRACTION;
      const hasInk = ink >= INK_DENSITY;
      if (looksLikePaper && hasInk) stillFor++;
      else {
        stillFor = 0;
        say(hasInk ? 'point it at the page' : 'move it over the music');
      }
    }
    if (stillFor >= STILL_FRAMES
      || (waiting >= PATIENCE && bright >= PAPER_FRACTION * 0.6 && ink >= INK_DENSITY * 0.7)) {
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
async function capture() {
  if (!video?.videoWidth) return;
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);
  let page = canvas;
  if (cleanUp) {
    try {
      page = straightenCanvas(canvas, canvas.width, canvas.height);
    } catch {
      page = canvas;    // the photograph as taken is still a page
    }
  }
  const blob = await new Promise((resolve) => page.toBlob(resolve, 'image/jpeg', 0.9));
  if (!blob) return;
  shotOf = previous ? Float32Array.from(previous) : null;
  const number = String(pages.length + 1).padStart(2, '0');
  pages.push(new File([blob], `page-${number}.jpg`, { type: 'image/jpeg' }));
  addThumb(pages.at(-1), pages.length - 1);
  refreshCount();
  waiting = 0;
  say(auto ? 'got it — turn the page' : 'got it');
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

function addThumb(file, index) {
  const wrap = document.createElement('div');
  wrap.className = 'scan-thumb';
  const image = document.createElement('img');
  image.src = URL.createObjectURL(file);
  image.alt = `Page ${index + 1}`;
  const drop = document.createElement('button');
  drop.type = 'button';
  drop.className = 'scan-drop';
  drop.textContent = '✕';
  drop.setAttribute('aria-label', `Throw away page ${index + 1}`);
  drop.addEventListener('click', () => {
    const at = pages.indexOf(file);
    if (at >= 0) pages.splice(at, 1);
    URL.revokeObjectURL(image.src);
    wrap.remove();
    renumber();
    refreshCount();
  });
  const label = document.createElement('span');
  label.className = 'scan-number';
  label.textContent = String(index + 1);
  wrap.append(image, drop, label);
  strip.append(wrap);
  strip.scrollLeft = strip.scrollWidth;
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
  paper = null;
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
  const taken = result;
  pages = [];
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
  auto = false;
  cleanUp = true;
  armed = true;
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
  say('line the page up — the button lights when it has it');
  watch();
  return new Promise((resolve) => { done = resolve; });
}

export function scannerIsOpen() {
  return !!root && !root.hidden;
}
