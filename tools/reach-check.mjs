// EVERY CONTROL ON THE SCREEN CAN BE PRESSED.
//
// Three faults in this app have been the same fault, and none of them threw
// anything, drew anything wrong, or failed any check that existed at the time:
//
//   · a SENTENCE carrying the class of the bar-box layer became a 390x1383
//     transparent sheet over the whole review, and the graph's play button,
//     Save and Discard could not be pressed at all;
//   · the word "Edges" over a scanned thumbnail took the tap meant for the
//     picture under it;
//   · the shutter's flash — a full-screen white sheet for 180ms — had no
//     `pointer-events: none`, so a press in that window went nowhere.
//
// Each was found by accident, and each was found by asking one question about
// one control. This asks it about ALL of them: for every button, link and field
// on the screen, is the pixel in its middle actually its own?
//
// WHAT IT DELIBERATELY ALLOWS. A control covered by its own child (an icon, a
// label) is fine — that is what `contains` is for. A control that is under an
// open sheet, menu or dialog is fine and is the point of a sheet, so those are
// walked separately with the sheet open. What is left is a control nothing is
// supposed to be covering, and something is.
//
//   npm run dev             (on 5199)
//   npm run app:reach
//
import { readFile } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';

const APP = process.env.APP ?? 'http://localhost:5199';
const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const font = (await readFile(new URL('./fonts/Bravura.otf', import.meta.url))).toString('base64');

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

const XML = '<?xml version="1.0"?><score-partwise version="3.1"><part-list><score-part id="P1">'
  + '<part-name>C</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes>'
  + '<divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type>'
  + '</time><clef><sign>F</sign><line>4</line></clef></attributes><note><pitch><step>C</step>'
  + '<octave>3</octave></pitch><duration>4</duration><type>whole</type></note></measure></part></score-partwise>';

const browser = await puppeteer.launch({
  executablePath: SHELL,
  headless: true,
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required',
    '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
});
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(APP, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 1700));

// A shelf, a photographed part and a take of it, so the screens being measured
// have controls on them.
await page.evaluate(async ({ xml, bravura }) => {
  document.querySelector('#welcome')?.remove();
  document.querySelector('#welcome-card')?.remove();
  const { saveScore, saveRecording, renameRecording } = await import('/src/store/db.js');
  for (const name of ['Bach — Suite No. 1 in G', 'Elgar — Cello Concerto, Op. 85']) {
    await saveScore({ name, xml, partIndex: 0, parts: [{ name: 'C', staves: 1 }] });
  }
  const { engravePart } = await import('/src/fixtures/engraved-page.js');
  const { scoreId, written } = await engravePart({
    base64: bravura, name: 'Photographed part', pages: 2, systems: 5, perSystem: 8, space: 13,
  });
  sessionStorage.setItem('__written', JSON.stringify(written));
  sessionStorage.setItem('__scan', String(scoreId));
  for (const name of ['this morning', 'yesterday']) {
    const id = await saveRecording({
      date: Date.now(), duration: 40, sampleRate: 44100,
      audio: new Float32Array(88200), notes: [], readings: [], a4: 440,
    });
    await renameRecording(id, name);
  }
}, { xml: XML, bravura: font });
await page.reload({ waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 1800));
await page.evaluate(() => {
  document.querySelector('#welcome')?.remove();
  document.querySelector('#welcome-card')?.remove();
});

// THE QUESTION, asked of everything on screen at once — with two things it has
// to get right or it reports nonsense.
//
// ONLY WHAT IS ON TOP. A settings sheet, the scanner, the edges editor and the
// open score each cover the whole screen, and the controls behind them are
// SUPPOSED to be unreachable — that is what a sheet is. So when one of those is
// up, only what is inside it is asked.
//
// AND SCROLLED TO, BEFORE BEING BELIEVED. The tab bar floats over the foot of
// every screen, so a control at the bottom of a long tab is under it right now
// and one flick away from not being. A control is only stuck if it is still
// covered with the page scrolled so that it is in the middle of the view —
// which is what a hand does.
const blocked = () => page.evaluate(async () => {
  const name = (n) => {
    if (!n) return 'nothing';
    const id = n.id ? `#${n.id}` : '';
    const cls = typeof n.className === 'string' && n.className.trim()
      ? `.${n.className.trim().split(/\s+/).slice(0, 2).join('.')}` : '';
    return `${n.tagName.toLowerCase()}${id}${cls}`;
  };
  // WHAT IS LEGITIMATELY OUT OF REACH, and it is one case only: a control that
  // is BEHIND a sheet covering the screen. The settings dialog, the scanner,
  // the edges editor and the open score each do that, and the tab bar behind
  // them is meant to be untouchable — that is what a sheet is for.
  //
  // Written as "the thing on top is a sheet AND this control is not inside it".
  // The first version of this picked a top surface and only looked inside it,
  // which is the same idea and is far too broad: it hid the flash (a white
  // sheet inside the scanner, over the scanner's own buttons) and it hid the
  // options sheet sitting on the reader's own bar, because both of those are
  // controls covered by something INSIDE the sheet they belong to. Reintroduced
  // on purpose, both, and the check passed — so the rule was wrong, not the app.
  const SHEETS = ['dialog[open]', '#crop:not([hidden])', '#scanner', '#reader:not([hidden])'];
  const behindASheet = (el, hit) => SHEETS.some((sel) => {
    const sheet = hit.closest?.(sel) ?? (hit.matches?.(sel) ? hit : null);
    return !!sheet && !el.closest(sel);
  });
  const CONTROLS = 'button, a[href], input, select, textarea, [role="button"], [role="option"]';
  const out = [];
  // NOT `hit.contains(el)`. That was here to let a menu row sit over the button
  // that opened it, and it swallowed every case where an ANCESTOR paints over
  // its own child — which is exactly what a full-screen `::after` does, and
  // `elementFromPoint` reports the element, never the pseudo.
  const mine = (el, hit) => hit === el || el.contains(hit) || el.contains(hit?.parentElement);
  for (const el of document.querySelectorAll(CONTROLS)) {
    if (el.disabled || el.hidden) continue;
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || style.opacity === '0' || style.pointerEvents === 'none') continue;
    const first = el.getBoundingClientRect();
    if (first.width < 6 || first.height < 6) continue;
    const ask = () => {
      const b = el.getBoundingClientRect();
      const x = Math.round(b.left + b.width / 2);
      const y = Math.round(b.top + b.height / 2);
      if (x < 1 || y < 1 || x > window.innerWidth - 1 || y > window.innerHeight - 1) return 'offscreen';
      return document.elementFromPoint(x, y);
    };
    let hit = ask();
    if (hit !== 'offscreen' && mine(el, hit)) continue;
    if (hit !== 'offscreen' && behindASheet(el, hit)) continue;
    // …and again, with the page moved so it is in the middle of the view. The
    // tab bar floats over the foot of every screen, so a control at the bottom
    // of a long tab is under it now and one flick away from not being.
    el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
    await new Promise((r) => setTimeout(r, 90));
    hit = ask();
    if (hit === 'offscreen') continue;   // edge:fit is the check for that
    if (mine(el, hit) || behindASheet(el, hit)) continue;
    out.push({ what: name(el), under: name(hit), text: (el.textContent ?? '').trim().slice(0, 24) });
  }
  return out;
});

const at = async (where, run) => {
  await run();
  const bad = await blocked();
  check(`${where}: every control on it can be pressed`, bad.length === 0,
    bad.slice(0, 5).map((b) => `${b.what}${b.text ? ` "${b.text}"` : ''} is under ${b.under}`).join(' · '));
  return bad.length;
};

const toTab = (tab) => page.evaluate(async (name) => {
  for (let i = 0; i < 20; i += 1) {
    if (document.querySelector(`#tab-${name}`)?.classList.contains('active')) break;
    document.querySelector(`.tab-btn[data-tab="${name}"]`)?.click();
    await new Promise((r) => setTimeout(r, 120));
  }
  await new Promise((r) => setTimeout(r, 650));
}, tab);

for (const tab of ['tuner', 'analyze', 'library', 'score', 'coach', 'metronome']) {
  await at(`the ${tab} tab`, () => toTab(tab));
}

await at('the settings sheet', () => page.evaluate(async () => {
  document.querySelector('[aria-label*="ettings"], #settings-open')?.click();
  await new Promise((r) => setTimeout(r, 600));
}));
await page.evaluate(() => document.querySelector('#settings-dialog')?.close('done'));

await at('a take reviewed against the pages', () => page.evaluate(async () => {
  const { selectScore, measurePages, annotateTake } = await import('/src/ui/score.js');
  const { renderFreeReview } = await import('/src/ui/report.js');
  const { Recorder } = await import('/src/audio/recording.js');
  const { takeFromWritten } = await import('/src/fixtures/engraved-page.js');
  const id = Number(sessionStorage.getItem('__scan'));
  await selectScore(id);
  await measurePages(id);
  const notes = takeFromWritten(JSON.parse(sessionStorage.getItem('__written') ?? '[]'), {
    from: 0, count: 40, spacing: 0.35, sounding: 0.3, lead: 0,
  });
  const readings = notes.map((n) => ({
    time: n.start, frequency: n.frequency, confidence: 0.95, rms: 0.05, midi: n.midi, cents: n.cents,
  }));
  const rec = new Recorder(44100);
  rec.push(new Float32Array(44100 * 16));
  renderFreeReview(document, notes, rec, { readings, a4: 440 });
  document.querySelector('.tab-btn[data-tab="score"]')?.click();
  await new Promise((r) => setTimeout(r, 500));
  await annotateTake(notes, { readings, a4: 440 });
  await new Promise((r) => setTimeout(r, 1400));
  // The save bar belongs to a take being kept; this one was built, so it is put
  // up by hand. What is under test is whether a finger can reach it.
  const bar = document.querySelector('#score-save-bar');
  if (bar) bar.hidden = false;
  const save = document.querySelector('#score-save-take');
  if (save && !save.textContent) save.textContent = 'Save this take';
  window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' });
  await new Promise((r) => setTimeout(r, 500));
}));

await at('the open score, with its bar down', () => page.evaluate(async () => {
  const { openReader } = await import('/src/ui/reader.js');
  const { loadScore } = await import('/src/store/db.js');
  await openReader(await loadScore(Number(sessionStorage.getItem('__scan'))), {});
  await new Promise((r) => setTimeout(r, 1300));
}));

await at('the options sheet, open', () => page.evaluate(async () => {
  document.querySelector('#reader-menu-btn')?.click();
  await new Promise((r) => setTimeout(r, 600));
}));

await at('the pencil, with its own bar', () => page.evaluate(async () => {
  document.querySelector('#reader-menu-btn')?.click();
  await new Promise((r) => setTimeout(r, 300));
  document.querySelector('#reader-annotate')?.click();
  await new Promise((r) => setTimeout(r, 700));
}));
await page.evaluate(async () => {
  const { close } = await import('/src/ui/reader.js');
  document.querySelector('#reader-done')?.click();
  await new Promise((r) => setTimeout(r, 300));
  close?.();
  await new Promise((r) => setTimeout(r, 500));
});

// THE SCANNER, AND THE MOMENT AFTER THE SHUTTER — which is where the last one
// of these lived: a white sheet over everything for 180ms with no
// `pointer-events: none`.
await at('the scanner', () => page.evaluate(async () => {
  const { openScanner } = await import('/src/ui/scanner.js');
  openScanner().catch(() => null);
  for (let i = 0; i < 80 && !document.querySelector('#scan-shutter'); i += 1) {
    await new Promise((r) => setTimeout(r, 100));
  }
  const shutter = document.querySelector('#scan-shutter');
  for (let i = 0; i < 120 && shutter?.disabled; i += 1) await new Promise((r) => setTimeout(r, 100));
  await new Promise((r) => setTimeout(r, 300));
}));

// THE BLINK AFTER THE SHUTTER, HELD UP. It is a white sheet over the whole
// scanner for 180ms, and 180ms is not long enough to walk every control on the
// screen — racing an animation would make this step pass by arriving late,
// which is the failure mode this whole tool exists to avoid. So the class goes
// on by hand and stays on: what is under test is the RULE (a sheet that size
// takes no taps), not the clock.
await at('the scanner, with the shutter\'s flash up', () => page.evaluate(async () => {
  document.querySelector('#scanner')?.classList.add('flash');
  await new Promise((r) => setTimeout(r, 120));
}));
await page.evaluate(() => document.querySelector('#scanner')?.classList.remove('flash'));

await at('the scanner, after a real shot', () => page.evaluate(async () => {
  document.querySelector('#scan-shutter')?.click();
  await new Promise((r) => setTimeout(r, 400));
}));

await at('the scanner, with a page in the strip', () => page.evaluate(async () => {
  for (let i = 0; i < 90 && !document.querySelector('.scan-thumb:not(.pending)'); i += 1) {
    await new Promise((r) => setTimeout(r, 100));
  }
  await new Promise((r) => setTimeout(r, 400));
}));

await at('the edges editor', () => page.evaluate(async () => {
  document.querySelector('.scan-thumb .scan-open')?.click();
  for (let i = 0; i < 60 && document.querySelector('#crop')?.hidden !== false; i += 1) {
    await new Promise((r) => setTimeout(r, 100));
  }
  await new Promise((r) => setTimeout(r, 600));
}));
await page.evaluate(async () => {
  document.querySelector('#crop .crop-bar button')?.click();
  await new Promise((r) => setTimeout(r, 500));
  document.querySelector('#scan-cancel')?.click();
  await new Promise((r) => setTimeout(r, 600));
});

if (errors.length) {
  console.log('\nerrors on the page:');
  for (const e of errors.slice(0, 5)) console.log(`  ${e}`);
}
const failed = results.filter((r) => !r.pass);
console.log(failed.length ? `\n${failed.length} FAILED` : '\nALL PASS');
await browser.close();
process.exit(failed.length ? 1 : 0);
