// THE TUNER TAB, THROUGH THE MICROPHONE, WITH A REAL RECORDING PLAYING INTO IT.
//
// tuner-check.mjs measures the lock on the analyzer's readings; this measures
// the screen. Chrome's fake capture device plays a WAV file into getUserMedia,
// so everything a player's sound goes through is under test — the worklet, the
// Analyzer as main.js builds it, Tuner.update and the #note it writes — and the
// big note is read off the page every animation frame for eight seconds.
//
// MEASURED on Apple's "City Nights Violin Lead" loop, a G5/F5/A#5 line: before
// the lock, 66 changes of the big note in 8s, 24 of them a note that appeared
// and was replaced by the one it interrupted, with F2, C4 and D7 among them.
// After it, 8 changes, 0 of those, and the sequence is the melody.
//
//   npm run dev            (on 5199)
//   node tools/tuner-mic-check.mjs <48k mono 16-bit wav>
//
// NO CAMERA. The fake device is audio from a file; nothing real is opened.
import puppeteer from 'puppeteer-core';
const SHELL = `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell`;
const wav = process.argv[2];
const browser = await puppeteer.launch({ executablePath: SHELL, headless: true,
  args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`, '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844 });
const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
await page.evaluateOnNewDocument(() => { localStorage.setItem('tab', 'tuner'); localStorage.setItem('micGranted', 'yes'); localStorage.setItem('toured', '1'); });
await page.goto('http://localhost:5199', { waitUntil: 'networkidle0' });
const btn = await page.$('#tuner-listen');
if (btn && await btn.evaluate((b) => !b.hidden)) await btn.click();
await new Promise((r) => setTimeout(r, 2500));
const trace = await page.evaluate(() => new Promise((res) => {
  const out = []; const t0 = performance.now();
  const tick = () => { out.push(document.querySelector('#note').textContent); if (performance.now() - t0 < 8000) requestAnimationFrame(tick); else res(out); };
  tick();
}));
let changes = 0, blanks = 0, blips = 0;
for (let i = 1; i < trace.length; i++) {
  if (trace[i] !== trace[i - 1]) { changes++; if (trace[i] === '–') blanks++; }
  if (i < trace.length - 3 && trace[i] !== trace[i - 1] && [trace[i + 1], trace[i + 2], trace[i+3]].includes(trace[i - 1])) blips++;
}
const on = trace.filter((n) => n !== '–').length;
console.log(`frames ${trace.length}  showing a note ${(100 * on / trace.length).toFixed(0)}%  changes ${changes}  blanks ${blanks}  A-B-A blips ${blips}`);
console.log('sequence:', trace.filter((n, i) => i === 0 || n !== trace[i - 1]).join(' '));
console.log('errors:', errors.length ? errors : 'none');
await browser.close();
