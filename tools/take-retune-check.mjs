// A TAKE, JUDGED AGAINST ANOTHER A.
//
// A take is seeded whose every note sits ten cents sharp against A440 — a
// player steadily tuned to about 442.5. Opened from the library, the review
// must offer the A it is judged against as a number; typing 441 must move
// every cents figure by the 3.9 cents between the two; the "you were centred
// on" offer must name the right A and, taken, must bring the take to zero;
// and the library must hold the re-judged take, so it reads the same tomorrow.
//
//   npm run dev
//   npm run take:retune
//
import puppeteer from 'puppeteer-core';

const PORT = Number(process.env.PORT ?? 5199);
const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const OUT = process.env.OUT ?? null;
const browser = await puppeteer.launch({ executablePath: SHELL, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 820, height: 1180, deviceScaleFactor: 2, hasTouch: true });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? `  (${detail})` : ''}`);
  if (!ok) failed += 1;
};

await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
await wait(1500);
await page.evaluate(() => { document.querySelector('#welcome')?.remove(); document.querySelector('#welcome-card')?.remove(); });

// The take: twelve notes, each ten cents sharp of its name against 440.
const id = await page.evaluate(async () => {
  const db = await import('/src/store/db.js');
  const { midiToName } = await import('/src/analysis/note-utils.js');
  const notes = [];
  const readings = [];
  for (let i = 0; i < 12; i++) {
    const midi = 57 + (i % 7);
    notes.push({ start: i * 0.5, end: i * 0.5 + 0.45, midi, name: midiToName(midi), cents: 10 });
    for (let k = 0; k < 20; k++) {
      readings.push({ time: i * 0.5 + k * 0.02, frequency: 440 * 2 ** ((midi + 0.1 - 69) / 12), confidence: 0.95 });
    }
  }
  const sampleRate = 48000;
  const audio = new Float32Array(sampleRate * 6);
  return db.saveRecording({ date: Date.now(), duration: 6, sampleRate, audio, notes, readings, a4: 440, name: 'Retune check' });
});
// The library list is built when the app starts, so the app is started again
// with the take in its store.
await page.reload({ waitUntil: 'load' });
await wait(1500);
await page.evaluate(() => { document.querySelector('#welcome')?.remove(); document.querySelector('#welcome-card')?.remove(); });
await page.evaluate(() => document.querySelector('.tab-btn[data-tab="library"]')?.click());
await wait(800);
await page.evaluate(() => {
  const row = [...document.querySelectorAll('#library-list .lib-item')]
    .find((li) => li.querySelector('.lib-name')?.textContent === 'Retune check');
  row?.querySelector('.lib-open')?.click();
});
await wait(1500);

const read = () => page.evaluate(() => {
  const row = document.querySelector('#report-tuning');
  const grid = document.querySelector('#report-grid')?.textContent ?? '';
  const cents = [...grid.matchAll(/([+-]\d+)¢/g)].map((m) => Number(m[1]));
  return {
    shown: !!row && !row.hidden,
    a4: document.querySelector('#report-a4')?.value ?? null,
    centre: document.querySelector('#report-a4-centre')?.hidden ? null
      : document.querySelector('#report-a4-centre')?.textContent,
    cents,
  };
});
const r0 = await read();
check('the review offers the A it is judged against', r0.shown && r0.a4 === '440', `${r0.a4}`);
check('every note reads ten cents sharp against 440', r0.cents.length >= 12 && r0.cents.every((c) => c === 10), r0.cents.slice(0, 6).join(' '));
const wanted = Math.round(440 * 2 ** (10 / 1200) * 10) / 10;
check('it says what A the playing was centred on', !!r0.centre && r0.centre.includes(String(wanted)), r0.centre ?? 'no offer');
if (OUT) await page.screenshot({ path: `${OUT}/retune-before.png` });

// Type 441.
await page.evaluate(() => {
  const input = document.querySelector('#report-a4');
  input.value = '441';
  input.dispatchEvent(new Event('change', { bubbles: true }));
});
await wait(1200);
const r1 = await read();
check('against 441 every note reads 3.9 cents less sharp', r1.a4 === '441' && r1.cents.length >= 12 && r1.cents.every((c) => c === 6),
  `${r1.a4} Hz, ${r1.cents.slice(0, 6).join(' ')}`);
const stored1 = await page.evaluate(async (id) => { const db = await import('/src/store/db.js'); const d = await db.loadRecording(id); return { a4: d.a4, cents: d.notes[0].cents }; }, id);
check('…and the library holds the take re-judged', stored1.a4 === 441 && Math.abs(stored1.cents - 6.07) < 0.1, `a4 ${stored1.a4}, first note ${stored1.cents?.toFixed(2)}¢`);

// Take the offer.
await page.evaluate(() => document.querySelector('#report-a4-centre')?.click());
await wait(1200);
const r2 = await read();
check('judged against the A it was centred on, the take reads in tune',
  Number(r2.a4) === wanted && r2.cents.every((c) => Math.abs(c) <= 1), `${r2.a4} Hz, ${r2.cents.slice(0, 6).join(' ')}`);
check('…and the offer goes away', r2.centre === null, r2.centre ?? '');
if (OUT) await page.screenshot({ path: `${OUT}/retune-after.png` });

// Out of range is refused, not applied.
await page.evaluate(() => {
  const input = document.querySelector('#report-a4');
  input.value = '900';
  input.dispatchEvent(new Event('change', { bubbles: true }));
});
await wait(500);
const r3 = await read();
check('an A outside the tuner’s range is put back', Number(r3.a4) === wanted, r3.a4);

await page.evaluate(async (id) => { const db = await import('/src/store/db.js'); await db.deleteRecording(id); }, id);
console.log(`\n  page errors: ${errors.length}${errors.length ? ` — ${errors[0]}` : ''}`);
console.log(failed ? `\n  ${failed} CHECK(S) FAILED` : '\n  all checks passed');
await browser.close();
process.exit(failed ? 1 : 0);
