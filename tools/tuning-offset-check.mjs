// THE APP NOTICING THAT THE INSTRUMENT IS SOMEWHERE ELSE.
//
// A flute player's report: "one time, it got the pitch perfect relative to the
// notes being played, and the other times it was like a half step too low —
// the app would say it's an A, but it's actually an A#."
//
// Nothing was broken. The detector was measured against synthesised flute tones
// from C4 to C7 at both sample rates and came back inside two cents. Naming a
// pitch means rounding it to the nearest semitone, and an instrument 51 cents
// below A440 IS nearer the note below — so every name moves down together while
// the cents beside each one look immaculate. A flute 55¢ flat reads "A5, +45¢":
// a confident sentence and the wrong note. That is why it looks like a bug from
// the outside — the app never appears unsure.
//
// So the app says it, once, on the takes where it is the thing worth knowing.
// What is driven here is that it says it when it should and STAYS QUIET when it
// should not — because the failure that would matter is telling somebody having
// a hard time that their tuner is wrong.
//
//   npm run dev            (on 5199)
//   npm run take:tuning
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
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(APP, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 1600));

const said = await page.evaluate(async () => {
  document.querySelector('#welcome')?.remove();
  const { renderFreeReview } = await import('/src/ui/report.js');
  const { Recorder } = await import('/src/audio/recording.js');

  // A take, played at a chosen distance from the app's A. The cents written on
  // a note are always folded into ±50 — that fold IS the renaming — so this
  // folds too, exactly as the segmenter would.
  const fold = (c) => { let x = c; while (x < -50) x += 100; while (x >= 50) x -= 100; return x; };
  const take = (offset, wobble, seed) => {
    let s = seed;
    const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff - 0.5) * 2;
    const notes = [];
    const readings = [];
    for (let i = 0; i < 48; i++) {
      const midi = 72 + (i % 9);
      const cents = fold(offset + rnd() * wobble);
      const start = i * 0.5;
      notes.push({ midi, name: 'x', start, end: start + 0.4, cents });
      for (let k = 0; k < 8; k++) {
        readings.push({
          time: start + k * 0.05,
          frequency: 440 * 2 ** ((midi + cents / 100 - 69) / 12),
          confidence: 0.95,
        });
      }
    }
    return { notes, readings };
  };

  const show = (one) => {
    const rec = new Recorder(44100);
    rec.push(new Float32Array(44100 * 25));
    renderFreeReview(document, one.notes, rec, { readings: one.readings, a4: 440 });
    return (document.querySelector('#notes-summary')?.textContent ?? '').trim();
  };

  return {
    // Steady playing, well below the app's A — the flute case.
    flat: show(take(-30, 8, 5)),
    // Steady playing, so far off that the fold has taken the direction with it.
    edge: show(take(-55, 8, 9)),
    // Steady playing, near enough to A440 that there is nothing to say.
    fine: show(take(-5, 8, 3)),
    // Scattered playing — a hard day, not a wrong reference.
    rough: show(take(0, 70, 11)),
  };
});
await browser.close();

check('a take played well below the app’s A says so, and says which A',
  /below A440/.test(said.flat) && /A of about 4[23][0-9]/.test(said.flat),
  said.flat);
check('…and past the halfway line it refuses to name a direction',
  /half a semitone from A440/.test(said.edge) && !/(above|below)/.test(said.edge),
  said.edge);
// A flute 55¢ FLAT and one 45¢ SHARP write down identical readings, note for
// note — the fold has made them the same take. Saying "above" to the flat one
// would point at the opposite of the problem, so it says only what it knows.
check('…and says the names may have moved with it',
  /names on this take may be a semitone out/.test(said.edge), said.edge);
check('a take near the app’s A says nothing about tuning',
  !/A440/.test(said.fine), said.fine);
check('and SCATTERED playing is never told its tuner is wrong',
  !/A440/.test(said.rough), said.rough);
check('the note count is still there in every case',
  [said.flat, said.edge, said.fine, said.rough].every((one) => /48 notes/.test(one)),
  said.fine);
check('nothing was thrown', errors.length === 0, errors.slice(0, 2).join(' | '));

const failed = results.filter((r) => !r.pass);
console.log(failed.length ? `\n${failed.length} FAILED` : '\nALL PASS');
process.exit(failed.length ? 1 : 0);
