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
// Two shutters. The manual one is a button. The automatic one watches the
// picture: when the frame stops moving and looks like a page — bright, with ink
// on it — it takes the shot itself, and then refuses to take another until the
// picture CHANGES, which is what turning a page does. That last part is the
// whole trick; without it an auto-shutter takes forty photographs of the same
// page while you reach for the corner.
//
// What this is not: it is not document detection. It does not find the corners
// of the paper, straighten it, or crop to the edges. The page is captured as
// the camera sees it, which is what a phone held over a book gives you anyway.

let root = null;
let video = null;
let strip = null;
let statusLine = null;
let stream = null;
let pages = [];        // File objects, in the order they were taken
let watching = null;   // the interval that runs the auto-shutter
let armed = true;      // may the auto-shutter fire?
let auto = true;
let done = null;       // resolve the promise openScanner returned

// The sampling canvas: tiny on purpose. Nothing here needs detail, and reading
// a full camera frame five times a second is how a scanner turns a phone into a
// hand-warmer.
const SAMPLE_W = 64;
const SAMPLE_H = 48;
const sample = document.createElement('canvas');
sample.width = SAMPLE_W;
sample.height = SAMPLE_H;

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
const STILL_ENOUGH = 13;     // mean luma difference between frames, 0–255
const MOVED_ENOUGH = 24;     // what counts as "the page was turned"
const PAPER_FRACTION = 0.2;  // how much of the frame is brighter than its own mid-point
const INK_DENSITY = 0.035;   // how much of it has ink-like detail in it
const STILL_FRAMES = 3;      // ~600ms of holding steady
const PATIENCE = 11;         // ~2.2s: shoot anyway rather than wait for perfection
const NEW_PAGE = 5;          // how different from the last shot counts as another page

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
    const { motion, paper, ink, lit, frame } = readFrame();
    if (!auto) return;
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
    const steady = motion <= STILL_ENOUGH;
    const looksLikePaper = paper >= PAPER_FRACTION;
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
    const hasInk = ink >= INK_DENSITY;
    if (looksLikePaper && hasInk) stillFor++;
    else {
      stillFor = 0;
      say(hasInk ? 'point it at the page' : 'move it over the music');
    }
    // Either it looks right and has been still, or it has been still for a
    // good while: two seconds of a phone held motionless over a book is a
    // photograph waiting to happen, whatever the light is doing.
    if (stillFor >= STILL_FRAMES
      || (waiting >= PATIENCE && paper >= PAPER_FRACTION * 0.6 && ink >= INK_DENSITY * 0.7)) {
      stillFor = 0;
      waiting = 0;
      armed = false;
      capture();
    }
  }, 200);
}

async function capture() {
  if (!video?.videoWidth) return;
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
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

  const top = document.createElement('div');
  top.id = 'scan-top';
  const autoChip = button('scan-auto', 'Auto', 'scan-chip on', () => {
    auto = !auto;
    autoChip.classList.toggle('on', auto);
    autoChip.setAttribute('aria-pressed', String(auto));
    say(auto ? 'hold the page still and it shoots itself' : 'tap the button for each page');
  });
  autoChip.setAttribute('aria-pressed', 'true');
  top.append(
    button('scan-cancel', '✕', 'scan-tool', () => finish(null)),
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

  root.append(video, top, statusLine, strip, bottom);
  document.body.append(root);
  return root;
}

function stopCamera() {
  clearInterval(watching);
  watching = null;
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
  if (video) video.srcObject = null;
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
  auto = true;
  armed = true;
  refreshCount();
  el('scan-auto')?.classList.add('on');
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
  say('hold the page still and it shoots itself');
  watch();
  return new Promise((resolve) => { done = resolve; });
}

export function scannerIsOpen() {
  return !!root && !root.hidden;
}
