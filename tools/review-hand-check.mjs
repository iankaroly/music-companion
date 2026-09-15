// The review charts: per-moment colour, no gaps, and a swipe that keeps the wheel.
import puppeteer from 'puppeteer-core';
const SHELL = `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell`;
const OUT = process.argv[2] ?? '/tmp';
const browser = await puppeteer.launch({ executablePath: SHELL, headless: true, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
page.on('pageerror', (e) => console.log('ERR', String(e)));
await page.goto('http://localhost:5199/', { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 1500));
const built = await page.evaluate(async () => {
  document.querySelector('#welcome')?.remove();
  document.querySelector('#welcome-card')?.remove();
  document.querySelector('.tab-btn[data-tab="analyze"]')?.click();
  await new Promise((r) => setTimeout(r, 400));
  const a4 = 440;
  const hz = (m) => a4 * 2 ** ((m - 69) / 12);
  const midis = [48, 50, 52, 53, 55, 57, 59, 60, 59, 57, 55, 53, 52, 50, 48];
  const centsOf = [2, 12, -14, 4, 30, -3, 9, -20, 1, 15, -9, 3, 40, -30, 0];
  const notes = []; const readings = [];
  let t = 0.3;
  for (const [i, m] of midis.entries()) {
    const dur = 0.7;
    const cents = centsOf[i];
    notes.push({ midi: m, cents, start: t, end: t + dur, frequency: hz(m + cents / 100), name: null });
    for (let u = 0; u < dur; u += 0.0116) {
      const scoop = u < 0.12 ? -25 * (1 - u / 0.12) : 0;
      const vib = 18 * Math.sin(u * 2 * Math.PI * 5.5);
      const c = cents + scoop + vib;
      readings.push({ time: t + u, frequency: hz(m + c / 100), confidence: 0.95, rms: 0.05 });
    }
    // a short gap of silence between notes
    for (let u = 0; u < 0.08; u += 0.0116) readings.push({ time: t + dur + u, frequency: null, confidence: 0 });
    t += dur + 0.1;
  }
  const seconds = Math.ceil(t) + 1;
  const audio = new Float32Array(44100 * seconds);
  for (let i = 0; i < audio.length; i++) audio[i] = Math.sin(i * 0.05) * 0.2;
  const { Recorder } = await import('/src/audio/recording.js');
  const rec = new Recorder(44100); rec.push(audio);
  const { renderFreeReview } = await import('/src/ui/report.js');
  renderFreeReview(document, notes, rec, { readings, a4 });
  await new Promise((r) => setTimeout(r, 600));
  const canvas = document.querySelector('#pitch-chart');
  const b = canvas.getBoundingClientRect();
  return { seconds, chart: { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) } };
});
console.log('built', built);
// tap the chart to select a note and open the close-up
await page.touchscreen.tap(built.chart.x + 120, built.chart.y + built.chart.h / 2);
await new Promise((r) => setTimeout(r, 700));
await page.evaluate(() => document.querySelector('#pitch-chart').scrollIntoView({ block: 'start', behavior: 'instant' }));
await new Promise((r) => setTimeout(r, 300));
await page.screenshot({ path: `${OUT}/chart-after.png` });
// the close-up's colours vs the box: drag the zoom knob across and compare
const agree = await page.evaluate(async () => {
  const box = document.querySelector('#selected-note');
  const zoom = document.querySelector('#note-chart');
  const r = zoom.getBoundingClientRect();
  return { boxState: box?.dataset.state, boxText: box?.textContent, zoom: { x: r.left, y: r.top, w: r.width, h: r.height } };
});
console.log('box', agree);

// HAND-OFF: play, swipe ahead, and stay there.
const play = await page.evaluate(() => {
  const btn = document.querySelector('#clip-play');
  btn.scrollIntoView({ block: 'center', behavior: 'instant' });
  const b = btn.getBoundingClientRect();
  return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
});
await page.touchscreen.tap(play.x, play.y);
await new Promise((r) => setTimeout(r, 800));
const scrolled = await page.evaluate(async () => {
  const sc = document.querySelector('#chart-scroll');
  const before = sc.scrollLeft;
  // a finger on the graph, then it moves the view (a swipe)
  sc.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true }));
  sc.scrollLeft = sc.scrollWidth;
  const at = sc.scrollLeft;
  await new Promise((r) => setTimeout(r, 2500));
  const later = sc.scrollLeft;
  return { before, at, later, max: sc.scrollWidth - sc.clientWidth, playing: document.querySelector('#clip-play')?.getAttribute('aria-label') };
});
console.log('hand-off', scrolled, scrolled.later === scrolled.at ? 'STAYED' : 'SNAPPED BACK');
// a tap on the graph gives the wheel back: the view follows the playhead again
const back = await page.evaluate(async () => {
  const sc = document.querySelector('#chart-scroll');
  const canvas = document.querySelector('#pitch-chart');
  canvas.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: canvas.getBoundingClientRect().left + 100, clientY: canvas.getBoundingClientRect().top + 40 }));
  await new Promise((r) => setTimeout(r, 300));
  sc.scrollLeft = sc.scrollWidth;   // no gesture: the app moving its own view
  const at = sc.scrollLeft;
  await new Promise((r) => setTimeout(r, 1500));
  return { at, later: sc.scrollLeft };
});
console.log('after seek', back, back.later !== back.at ? 'FOLLOWS AGAIN' : 'still parked');
await browser.close();
