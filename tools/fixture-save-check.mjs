// THE DOOR A REAL MEASUREMENT HAS TO COME THROUGH.
//
// `npm run scan:real` scores the bar map against marks somebody made by ear,
// which is the only ground truth about real playing that exists — and it can
// only ever read a file the app wrote. So the export is load-bearing in a way
// an export usually is not: get the shape wrong and the tool says "that fixture
// has no page in it" an hour after the take was played, on a device that has
// since moved on.
//
// So the whole round trip is driven here: a scanned score and a take and marks
// go into the store, Library → the take's ⋯ → "Save as test fixture" is
// pressed, the file the app hands out is caught before it reaches the disk, and
// what comes back is checked to be the thing `scan:real` reads — the page as
// the reader read it, the notes as the segmenter heard them, and the marks.
//
// No microphone and no camera: the take and the page are put into the store
// directly, because what is under test is the export and not the recording.
//
//   npm run dev            (on 5199)
//   npm run take:fixture
//
import puppeteer from 'puppeteer-core';

const APP = process.env.APP ?? 'http://localhost:5199';
const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

const browser = await puppeteer.launch({ executablePath: SHELL, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 900, height: 1100 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(APP, { waitUntil: 'domcontentloaded' });
await new Promise((r) => setTimeout(r, 1500));

const seed = await page.evaluate(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  [...document.querySelectorAll('button')]
    .find((b) => /start playing/i.test(b.textContent ?? ''))?.click();
  await wait(400);

  const { savePagesScore, saveScoreLayout, saveRecording, saveBarAnchors } =
    await import('/src/store/db.js');

  // A page of three systems, with staff positions on the heads so the layout is
  // the shape the reader actually produces.
  const stave = (top) => ({
    top, bottom: top + 0.2, space: 0.014, bars: [0.4, 0.7],
    heads: Array.from({ length: 12 }, (_, i) => ({
      x: 0.08 + i * 0.07, y: top + 0.1, step: (i * 3) % 9, space: 0.014,
    })),
  });
  const layout = [{ staves: [stave(0.05), stave(0.35), stave(0.65)] }];
  const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' });
  const scoreId = await savePagesScore({
    name: 'A fixture piece', source: 'images', pageCount: 1, pages: [blob],
  });
  await saveScoreLayout(scoreId, layout);

  const notes = Array.from({ length: 40 }, (_, i) => ({
    midi: 48 + (i % 12), start: i * 0.5, end: i * 0.5 + 0.4, cents: ((i % 7) - 3) * 4.2,
  }));
  const takeId = await saveRecording({
    date: Date.now(), duration: 20, sampleRate: 44100,
    audio: new Float32Array(4410).buffer, notes, readings: [], a4: 440,
    name: 'A fixture take', scoreId, scoreStats: null,
  });
  // The marks by ear — the only ground truth the file carries.
  await saveBarAnchors(scoreId, takeId, [
    { at: 0, time: 0.5 }, { at: 1, time: 7.2 }, { at: 2, time: 14.4 },
  ]);

  return { seeded: true, scoreId, takeId };
});

// RELOADED, because the seeding above writes behind the app's back and the
// library is built when the app starts — the same reason `take:save` reloads.
await page.reload({ waitUntil: 'domcontentloaded' });
await new Promise((r) => setTimeout(r, 1600));

const out = await page.evaluate(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  [...document.querySelectorAll('button')]
    .find((b) => /start playing/i.test(b.textContent ?? ''))?.click();
  await wait(400);

  // CAUGHT BEFORE IT REACHES THE DISK. `shareFile` asks the share sheet first
  // and falls back to an <a download>; headless has no share sheet, so the
  // anchor is the path taken and its href is the blob.
  let caught = null;
  const realClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function catchIt() {
    if (this.download && this.href?.startsWith('blob:')) caught = { url: this.href, name: this.download };
    else realClick.call(this);
  };

  // …through the menu a player uses, not by calling the function.
  const nav = document.querySelector('nav[role="tablist"]');
  [...nav.querySelectorAll('button')].find((b) => /library/i.test(b.textContent ?? ''))?.click();
  await wait(1400);
  const row = [...document.querySelectorAll('#library-list li')]
    .find((li) => (li.textContent ?? '').includes('A fixture take'));
  const more = row?.querySelector('button[aria-haspopup="menu"]');
  if (!more) return { failed: 'the take is not in the library', rows: document.querySelectorAll('#library-list li').length };
  more.click();
  await wait(400);
  const item = [...document.querySelectorAll('button, [role="menuitem"]')]
    .find((b) => /save as test fixture/i.test(b.textContent ?? ''));
  if (!item) {
    return { failed: 'no "Save as test fixture" in the menu',
      saw: [...document.querySelectorAll('[role="menuitem"], .menu-item')].map((b) => b.textContent).join(' | ') };
  }
  item.click();
  await wait(900);
  HTMLAnchorElement.prototype.click = realClick;
  if (!caught) return { failed: 'nothing was handed out' };

  const text = await (await fetch(caught.url)).text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch (err) { return { failed: `not JSON: ${err.message}` }; }
  return {
    name: caught.name,
    bytes: text.length,
    what: parsed.what,
    notes: parsed.take?.notes?.length ?? 0,
    hasCents: (parsed.take?.notes ?? []).some((n) => Number.isFinite(n.cents)),
    staves: parsed.score?.layout?.[0]?.staves?.length ?? 0,
    marks: parsed.marks?.length ?? 0,
    markShape: (parsed.marks ?? []).every((m) => Number.isFinite(m.at) && Number.isFinite(m.time)),
    hasAudio: JSON.stringify(parsed).includes('"audio"'),
    said: document.querySelector('#status')?.textContent ?? '',
  };
});

if (out.failed) {
  check('the take exports as a fixture', false, `${out.failed} ${JSON.stringify(out.saw ?? out.rows ?? '')}`);
} else {
  check('the take’s menu hands out a fixture file', /\.json$/.test(out.name ?? ''), `${out.name}, ${out.bytes} bytes`);
  check('…that says what it is', out.what === 'practice-partner bar-map fixture', out.what);
  check('…carrying the page as the reader read it', out.staves === 3, `${out.staves} staves`);
  check('…the notes as the segmenter heard them', out.notes === 40 && out.hasCents,
    `${out.notes} notes, cents ${out.hasCents}`);
  check('…and the marks made by ear, which are the only truth in it',
    out.marks === 3 && out.markShape, `${out.marks} marks, shape ok=${out.markShape}`);
  // A fixture is read by scan:real, which computes the map from NOTES. Samples
  // would multiply the file by a thousand and answer a different question —
  // `Download WAV` is beside this in the same menu for that one.
  check('…and no audio, which would make it enormous and answer nothing',
    out.hasAudio === false);
  check('…and it says what it saved, including how many marks', /3 marks by ear/.test(out.said ?? ''),
    JSON.stringify(out.said));
}
check('nothing was thrown', errors.length === 0, errors.slice(0, 2).join(' | '));

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(failed.length ? `\n${failed.length} FAILED` : '\nALL PASS');
process.exit(failed.length ? 1 : 0);
