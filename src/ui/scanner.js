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

const STILL_ENOUGH = 6;      // mean channel difference, 0–255
const MOVED_ENOUGH = 14;     // what counts as "the page was turned"
const PAPER_FRACTION = 0.42; // how much of the frame has to be bright
const STILL_FRAMES = 3;      // ~600ms of holding steady

let previous = null;
let stillFor = 0;

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
  let bright = 0;
  let motion = 0;
  for (let i = 0; i < count; i++) {
    const at = i * 4;
    const luma = data[at] * 0.299 + data[at + 1] * 0.587 + data[at + 2] * 0.114;
    next[i] = luma;
    if (luma > 150) bright++;
    if (previous) motion += Math.abs(luma - previous[i]);
  }
  const result = {
    motion: previous ? motion / count : Infinity,
    paper: bright / count,
  };
  previous = next;
  return result;
}

function watch() {
  clearInterval(watching);
  watching = setInterval(() => {
    if (!video || video.readyState < 2) return;
    const { motion, paper } = readFrame();
    if (!auto) return;
    if (motion > MOVED_ENOUGH) {
      // The picture changed — a page was turned, or the phone was moved to the
      // next one. Whatever it was, the shutter is allowed again.
      armed = true;
      stillFor = 0;
      say('hold it steady…');
      return;
    }
    if (!armed) return;
    if (motion > STILL_ENOUGH) { stillFor = 0; return; }
    if (paper < PAPER_FRACTION) {
      say('point it at the page');
      stillFor = 0;
      return;
    }
    stillFor++;
    if (stillFor >= STILL_FRAMES) {
      stillFor = 0;
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
  const number = String(pages.length + 1).padStart(2, '0');
  pages.push(new File([blob], `page-${number}.jpg`, { type: 'image/jpeg' }));
  addThumb(pages.at(-1), pages.length - 1);
  refreshCount();
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
  stillFor = 0;
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
