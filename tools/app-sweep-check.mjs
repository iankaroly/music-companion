// WALK THE WHOLE APP AND WRITE DOWN EVERY ERROR IT THROWS.
//
// Two bugs this session were invisible to every targeted check in this repo and
// both were sitting in plain sight in the console:
//
//   · `Cannot access 'scoreWantsEars' before initialization` — main.js stopped
//     evaluating for anybody whose last tab was not the tuner, so half the app
//     was never wired. Found by noticing the app's own error toast in the
//     corner of a screenshot taken to measure something else.
//   · `edgesButton is not defined` — thrown at the end of EVERY edges edit,
//     after the page had been written, so what it broke was everything after
//     it.
//
// Neither would have been found by a check that asserts something. So this one
// asserts almost nothing: it works the app the way a hand works it and reports
// what came out of the console.
//
// TWO THINGS MAKE IT SHARP, and both come from how those bugs actually hid.
//
// EVERYTHING TWICE. `edgesButton` threw on the first edit; the fault it hid —
// a handler closing over a file that had been replaced — needed a SECOND edit
// to show. Opening, acting, acting again, closing and reopening is the shape
// that catches a stale closure, and a list that patches its own nodes rather
// than rebuilding them is where those live.
//
// AND FROM A COLD START, SEVERAL WAYS. `scoreWantsEars` needed `localStorage.tab`
// to be restored to something that was not the tuner. What the app remembers
// between visits is a real input and it is never the default.
//
//   npm run dev             (on 5199)
//   npm run app:sweep
//
import { readFile } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';

const font = (await readFile(new URL('./fonts/Bravura.otf', import.meta.url))).toString('base64');

const APP = process.env.APP ?? 'http://localhost:5199';
const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const ONLY = process.env.ONLY ?? null;

const XML = '<?xml version="1.0"?><score-partwise version="3.1"><part-list><score-part id="P1">'
  + '<part-name>C</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes>'
  + '<divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type>'
  + '</time><clef><sign>F</sign><line>4</line></clef></attributes>'
  + '<note><pitch><step>C</step><octave>3</octave></pitch><duration>2</duration><type>half</type></note>'
  + '<note><pitch><step>E</step><octave>3</octave></pitch><duration>2</duration><type>half</type></note>'
  + '</measure></part></score-partwise>';

// What the app remembers between visits. Never the default, and the default is
// the only thing a fresh browser ever tries.
const STATES = [
  { name: 'first run', set: {} },
  { name: 'last on the Score tab', set: { tab: 'score' } },
  { name: 'last on the Library tab', set: { tab: 'library' } },
  { name: 'last on Record, night page, two-up', set: { tab: 'analyze', readerNight: 'on', readerSpread: 'on' } },
  { name: 'last on the Coach tab, Ink scans, long notes only', set: { tab: 'coach', scanLook: 'ink', heldLeast: '1' } },
];

// PROOF THAT THE WALK ACTUALLY WALKED.
//
// A sweep whose clicks land on nothing reports no errors, which is the same
// output as an app with no errors in it. So every step says what it found, and
// the totals are asserted at the end: a step that stops working — a renamed
// class, a control that moved — turns into a failure rather than into silence.
const did = {};
const tally = (what, n = 1) => { did[what] = (did[what] ?? 0) + n; };

const found = new Map();   // message -> { where: Set, count }
const note = (where, message) => {
  const key = String(message).split('\n')[0].slice(0, 200);
  if (!found.has(key)) found.set(key, { where: new Set(), count: 0 });
  found.get(key).where.add(where);
  found.get(key).count += 1;
};

const browser = await puppeteer.launch({
  executablePath: SHELL,
  headless: true,
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required',
    '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
});

let step = 'start-up';
const walked = [];

for (const state of STATES) {
  if (ONLY && !state.name.includes(ONLY)) continue;
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  page.on('pageerror', (e) => note(`${state.name} · ${step}`, e));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    // A blocked media device and a missing favicon are the harness, not the app.
    if (/favicon|ERR_INTERNET_DISCONNECTED|Failed to load resource/i.test(text)) return;
    note(`${state.name} · ${step}`, text);
  });
  await page.evaluateOnNewDocument((remembered) => {
    localStorage.setItem('instrument', 'cello');
    for (const [k, v] of Object.entries(remembered)) localStorage.setItem(k, v);
    // A LEDGER OF WATCHERS. A ResizeObserver made on every render and never
    // disconnected is a handler that outlives what it closed over — the same
    // fault as the two found in the scanner this week, and invisible to
    // everything else here: it throws nothing and draws nothing wrong until the
    // screen changes size, at which point the OLDEST one repaints last.
    const Real = window.ResizeObserver;
    if (!Real) return;
    window.__watchers = new Set();
    window.ResizeObserver = class extends Real {
      observe(target, options) { window.__watchers.add(this); return super.observe(target, options); }
      disconnect() { window.__watchers.delete(this); return super.disconnect(); }
    };
  }, state.set);

  const at = async (name, run) => {
    step = name;
    try {
      const out = await run(page);
      if (out && typeof out === 'object') for (const [k, v] of Object.entries(out)) tally(k, v);
    } catch (err) { note(`${state.name} · ${name}`, `THREW: ${err.message}`); }
    walked.push(`${state.name} · ${name}`);
  };

  await at('opening the app', async (p) => {
    await p.goto(APP, { waitUntil: 'load' });
    await new Promise((r) => setTimeout(r, 1800));
    await p.evaluate(() => {
      document.querySelector('#welcome')?.remove();
      document.querySelector('#welcome-card')?.remove();
    });
  });

  // A shelf to work with: two notation parts and two photographed ones.
  await at('putting music on the shelf', async (p) => {
    await p.evaluate(async ({ xml, bravura }) => {
      const { saveScore, savePagesScore, saveRecording, renameRecording } = await import('/src/store/db.js');
      await saveScore({ name: 'Bach Suite I', xml, partIndex: 0, parts: [{ name: 'C', staves: 1 }] });
      await saveScore({ name: 'Elgar Concerto', xml, partIndex: 0, parts: [{ name: 'C', staves: 1 }] });
      // ENGRAVED, in Bravura, with a clef and a signature — a page nobody can
      // price gets no marks at all, so a hand-drawn page of ellipses would give
      // this sweep a review with nothing on it and nothing to go wrong in.
      const { engravePart, takeFromWritten } = await import('/src/fixtures/engraved-page.js');
      const { scoreId, written } = await engravePart({
        base64: bravura, name: 'Photographed part', pages: 2, systems: 5, perSystem: 8, space: 13,
      });
      window.__scanScore = scoreId;
      // Kept somewhere that survives the reload below — a `window` property
      // does not, and a take built from an empty list is refused by the
      // pairing for a reason that has nothing to do with the app.
      sessionStorage.setItem('__written', JSON.stringify(written));
      void savePagesScore;
      void takeFromWritten;
      for (const name of ['this morning', 'yesterday']) {
        const id = await saveRecording({
          date: Date.now(), duration: 24, sampleRate: 44100,
          audio: new Float32Array(44100 * 2), notes: [], readings: [], a4: 440,
        });
        await renameRecording(id, name);
      }
    }, { xml: XML, bravura: font });
    await p.reload({ waitUntil: 'load' });
    await new Promise((r) => setTimeout(r, 1800));
    await p.evaluate(() => {
      document.querySelector('#welcome')?.remove();
      document.querySelector('#welcome-card')?.remove();
    });
  });

  const toTab = (tab) => page.evaluate(async (name) => {
    for (let i = 0; i < 20; i += 1) {
      if (document.querySelector(`#tab-${name}`)?.classList.contains('active')) break;
      document.querySelector(`.tab-btn[data-tab="${name}"]`)?.click();
      await new Promise((r) => setTimeout(r, 120));
    }
    await new Promise((r) => setTimeout(r, 500));
  }, tab);

  // EVERY TAB, TWICE ROUND. The second lap is the one that catches a panel
  // that only survives being built once.
  await at('every tab, twice round', async (p) => {
    let shown = 0;
    for (let lap = 0; lap < 2; lap += 1) {
      for (const tab of ['tuner', 'analyze', 'library', 'score', 'coach', 'metronome']) {
        await toTab(tab);
        // eslint-disable-next-line no-await-in-loop
        if (await p.evaluate((t) => !!document.querySelector(`#tab-${t}`)?.classList.contains('active'), tab)) {
          shown += 1;
        }
      }
    }
    return { 'tabs opened': shown };
  });

  await at('the settings sheet, opened and dismissed twice', async (p) => {
    let opened = 0;
    let moved = 0;
    for (let i = 0; i < 2; i += 1) {
      const out = await p.evaluate(async () => {
        document.querySelector('#settings-open, #open-settings, [aria-label*="ettings"]')?.click();
        await new Promise((r) => setTimeout(r, 400));
        const dialog = document.querySelector('#settings-dialog');
        let controls = 0;
        if (dialog?.open) {
          // Every control on it, moved.
          for (const range of dialog.querySelectorAll('input[type="range"]')) {
            range.value = range.max;
            range.dispatchEvent(new Event('input', { bubbles: true }));
            range.dispatchEvent(new Event('change', { bubbles: true }));
            controls += 1;
          }
          for (const seg of dialog.querySelectorAll('.seg button, [role="radio"]')) { seg.click(); controls += 1; }
          await new Promise((r) => setTimeout(r, 200));
          dialog.close('done');
        }
        await new Promise((r) => setTimeout(r, 300));
        return { open: !!dialog?.open || controls > 0, controls };
      });
      opened += out.open ? 1 : 0;
      moved += out.controls;
    }
    return { 'settings sheets opened': opened, 'settings controls moved': moved };
  });

  await at('the metronome, started and stopped twice', async (p) => {
    await toTab('metronome');
    return p.evaluate(async () => {
      for (let i = 0; i < 2; i += 1) {
        document.querySelector('#metro-toggle')?.click();
        await new Promise((r) => setTimeout(r, 500));
        document.querySelector('#metro-toggle')?.click();
        await new Promise((r) => setTimeout(r, 200));
      }
      for (const sel of ['#beats-per-bar', '#subdivision', '#trainer-step', '#trainer-bars', '#timer-mins']) {
        const s = document.querySelector(sel);
        if (!s) continue;
        s.value = s.options[s.options.length - 1].value;
        s.dispatchEvent(new Event('change', { bubbles: true }));
      }
      document.querySelector('#tap-tempo')?.click();
      document.querySelector('#bpm-up')?.click();
      document.querySelector('#bpm-down')?.click();
      document.querySelector('#accent-toggle')?.click();
      await new Promise((r) => setTimeout(r, 300));
      return { 'metronome controls worked': document.querySelectorAll('#metro-card button, #metro-card select').length };
    });
  });

  await at('the score shelf: search, folder, setlist, ⋯', async (p) => {
    await toTab('score');
    return p.evaluate(async () => {
      const box = document.querySelector('#score-search');
      for (const word of ['bach', 'zzz', '']) {
        if (!box) break;
        box.value = word;
        box.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 250));
      }
      // Twice: a folder made from this shelf, a second from the Library's
      // own button, and the sheet closed both times. A folder shows on the
      // shelf that made it until something of the other kind is filed in it
      // (see createFolder's `home`), so the library walk below wants one made
      // there.
      let made = 0;
      for (let i = 0; i < 2; i += 1) {
        if (i === 1) {
          document.querySelector('.tab-btn[data-tab="library"]')?.click();
          await new Promise((r) => setTimeout(r, 400));
          document.querySelector('#new-folder')?.click();
        } else {
          document.querySelector('#score-folder')?.click();
        }
        await new Promise((r) => setTimeout(r, 300));
        const dialog = document.querySelector('#folder-dialog');
        const input = document.querySelector('#folder-name');
        if (dialog?.open && input) {
          input.value = `Folder ${i + 1}`;
          dialog.querySelector('button[value="save"], [value="save"]')?.click();
          if (dialog.open) dialog.close('save');
          made += 1;
        }
        await new Promise((r) => setTimeout(r, 400));
      }
      document.querySelector('.tab-btn[data-tab="score"]')?.click();
      await new Promise((r) => setTimeout(r, 400));
      // Setlists in and out.
      document.querySelector('#score-sets')?.click();
      await new Promise((r) => setTimeout(r, 400));
      document.querySelector('#score-sets')?.click();
      await new Promise((r) => setTimeout(r, 400));
      // The ⋯ on the first piece, opened and dismissed twice.
      let menus = 0;
      for (let i = 0; i < 2; i += 1) {
        const more = document.querySelector('#score-list li button:last-of-type');
        more?.click();
        await new Promise((r) => setTimeout(r, 350));
        if (document.querySelector('.pick-pop.menu')) menus += 1;
        // Dismissed the way the app dismisses one. A click on <body> lands
        // inside the pop-over's own outside-click handler on the way past and
        // the second lap then found it already open.
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        document.querySelector('.pick-pop.menu')?.remove();
        await new Promise((r) => setTimeout(r, 250));
      }
      return {
        'pieces on the shelf': document.querySelectorAll('#score-list li').length,
        'shelf searches': 3,
        'folders made': made,
        '⋯ menus opened': menus,
      };
    });
  });

  await at('the library: search and a take opened twice', async (p) => {
    await toTab('library');
    return p.evaluate(async () => {
      const box = document.querySelector('#library-search');
      for (const word of ['morning', 'zzz', '']) {
        if (!box) break;
        box.value = word;
        box.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 250));
      }
      // A TAKE, NOT A FOLDER. Both are `li.lib-item` with a `.lib-open` button,
      // so the obvious selector walks into the first folder and then reports an
      // empty library — which is what it did, and looked exactly like a bug.
      const takeRows = () => [...document.querySelectorAll('#library-list li')]
        .filter((li) => !li.querySelector('.lib-folder'));
      let opened = 0;
      for (let i = 0; i < 2; i += 1) {
        const row = takeRows()[0]?.querySelector('.lib-open');
        row?.click();
        opened += row ? 1 : 0;
        await new Promise((r) => setTimeout(r, 800));
        document.querySelector('.tab-btn[data-tab="library"]')?.click();
        await new Promise((r) => setTimeout(r, 500));
      }
      // …and into a folder and back out, twice, which is the other way this
      // list changes what it is showing.
      let intoFolders = 0;
      for (let i = 0; i < 2; i += 1) {
        const folder = [...document.querySelectorAll('#library-list li')]
          .find((li) => li.querySelector('.lib-folder'));
        if (!folder) break;
        folder.querySelector('.lib-open')?.click();
        await new Promise((r) => setTimeout(r, 500));
        intoFolders += 1;
        document.querySelector('#library-back')?.click();
        await new Promise((r) => setTimeout(r, 500));
      }
      return { 'takes in the library': takeRows().length,
        'takes opened': opened, 'folders opened and left': intoFolders };
    });
  });

  await at('the reader: opened, turned, drawn on, closed, reopened', async (p) => {
    return p.evaluate(async () => {
      let turns = 0;
      let strokes = 0;
      let menuRows = 0;
      const { openReader, close } = await import('/src/ui/reader.js');
      const { listScores, loadScore } = await import('/src/store/db.js');
      const scores = await listScores();
      const paper = scores.find((s) => s.kind === 'pages') ?? scores[0];
      for (let lap = 0; lap < 2; lap += 1) {
        await openReader(await loadScore(paper.id), {});
        await new Promise((r) => setTimeout(r, 1200));
        const { showPage } = await import('/src/ui/reader.js');
        for (const to of [1, 2, 0, 2, 1]) {
          await showPage(to);
          await new Promise((r) => setTimeout(r, 250));
          turns += 1;
        }
        // The bar down, the options sheet up and away, and back again.
        for (let i = 0; i < 2; i += 1) {
          document.querySelector('#reader-menu-btn')?.click();
          await new Promise((r) => setTimeout(r, 350));
          document.querySelector('#reader-menu-btn')?.click();
          await new Promise((r) => setTimeout(r, 250));
        }
        // Every row of the options sheet is opened at least far enough to build.
        document.querySelector('#reader-menu-btn')?.click();
        await new Promise((r) => setTimeout(r, 350));
        menuRows = document.querySelectorAll('#reader-menu .reader-menu-row').length;
        document.querySelector('#reader-menu-btn')?.click();
        // The pencil, a stroke, undo, and away again.
        document.querySelector('#reader-annotate')?.click();
        await new Promise((r) => setTimeout(r, 400));
        const layer = document.querySelector('#reader-ink, #reader-overlay, #reader canvas');
        if (layer) {
          const b = layer.getBoundingClientRect();
          const send = (type, x, y) => layer.dispatchEvent(new PointerEvent(type, {
            bubbles: true, cancelable: true, pointerId: 1, pointerType: 'touch',
            clientX: x, clientY: y, isPrimary: true,
          }));
          send('pointerdown', b.left + b.width * 0.3, b.top + b.height * 0.4);
          for (let i = 1; i <= 6; i += 1) {
            send('pointermove', b.left + b.width * (0.3 + i * 0.05), b.top + b.height * 0.4);
          }
          send('pointerup', b.left + b.width * 0.6, b.top + b.height * 0.4);
          strokes += 1;
        }
        await new Promise((r) => setTimeout(r, 300));
        document.querySelector('#reader-undo')?.click();
        await new Promise((r) => setTimeout(r, 200));
        document.querySelector('#reader-done')?.click();
        await new Promise((r) => setTimeout(r, 300));
        close?.();
        await new Promise((r) => setTimeout(r, 500));
      }
      return { 'pages turned': turns, 'strokes drawn': strokes, 'options rows built': menuRows };
    });
  });

  await at('a take against the photographed part, reviewed twice', async (p) => {
    return p.evaluate(async () => {
      const { selectScore, measurePages, annotateTake } = await import('/src/ui/score.js');
      const { renderFreeReview } = await import('/src/ui/report.js');
      const { Recorder } = await import('/src/audio/recording.js');
      const { takeFromWritten } = await import('/src/fixtures/engraved-page.js');
      const { listScores } = await import('/src/store/db.js');
      const scores = await listScores();
      const paper = scores.find((one) => one.kind === 'pages');
      if (!paper) return;
      await selectScore(paper.id);
      await measurePages(paper.id);
      // Played from what is WRITTEN on those pages, or the pairing refuses it
      // for the right reason and this step proves nothing.
      const written = JSON.parse(sessionStorage.getItem('__written') ?? '[]');
      const notes = takeFromWritten(written, {
        from: 0, count: 40, spacing: 0.35, sounding: 0.3, lead: 0,
      });
      const readings = notes.map((n) => ({
        time: n.start, frequency: n.frequency, confidence: 0.95, rms: 0.05,
        midi: n.midi, cents: n.cents,
      }));
      const rec = new Recorder(44100);
      rec.push(new Float32Array(44100 * 12));
      let bars = 0;
      let rings = 0;
      for (let lap = 0; lap < 2; lap += 1) {
        renderFreeReview(document, notes, rec, { readings, a4: 440 });
        document.querySelector('.tab-btn[data-tab="score"]')?.click();
        await new Promise((r) => setTimeout(r, 500));
        await annotateTake(notes, { readings, a4: 440 });
        await new Promise((r) => setTimeout(r, 900));
        // Play, seek, pause, and the close-up under it.
        document.querySelector('#clip-play')?.click();
        await new Promise((r) => setTimeout(r, 500));
        document.querySelectorAll('.scan-bar')[3]?.click();
        await new Promise((r) => setTimeout(r, 500));
        document.querySelector('#clip-restart')?.click();
        await new Promise((r) => setTimeout(r, 400));
        document.querySelector('#clip-play')?.click();
        await new Promise((r) => setTimeout(r, 300));
        // Every control in the row under the graph.
        for (const sel of ['#playback-speed button', '#chart-mode button',
          '#clip-click', '#any-drone', '#mark-passage']) {
          for (const btn of document.querySelectorAll(sel)) {
            btn.click();
            await new Promise((r) => setTimeout(r, 150));
          }
        }
        document.body.click();
        await new Promise((r) => setTimeout(r, 300));
        bars = Math.max(bars, document.querySelectorAll('.scan-bar').length);
        rings = Math.max(rings, document.querySelectorAll('.scan-note').length);
      }
      return { 'bars drawn over the pages': bars, 'rings marked on the notes': rings,
        'notes in the take': notes.length,
        // COUNTED WHILE A REVIEW IS ON SCREEN, which is the only moment the
        // number means anything: the graph's watcher is made by rendering one.
        // Two takes were rendered in this step, so a second watcher here is one
        // per render rather than one per screen. MEASURED against the version
        // before this was fixed: three renders left three.
        'resize watchers, after two reviews': window.__watchers?.size ?? 0 };
    });
  });

  // SAVING, DISCARDING AND DELETING — the paths that change the list under the
  // handler that is on it, which is exactly where the two scanner faults lived.
  await at('a take saved, a take discarded, a piece deleted', async (p) => {
    return p.evaluate(async () => {
      const { listRecordings, listScores } = await import('/src/store/db.js');
      const before = (await listRecordings()).length;
      let saved = 0;
      let discarded = 0;
      for (const which of ['#score-save-take', '#score-discard-take']) {
        const bar = document.querySelector('#score-save-bar');
        if (bar) bar.hidden = false;
        const btn = document.querySelector(which);
        if (!btn) continue;
        btn.click();
        await new Promise((r) => setTimeout(r, 900));
        if (which.includes('save')) saved += 1; else discarded += 1;
      }
      // …and a piece removed from the shelf, twice: the row that moves up into
      // the gap has to be the row that gets deleted next.
      document.querySelector('.tab-btn[data-tab="score"]')?.click();
      await new Promise((r) => setTimeout(r, 600));
      const wasScores = (await listScores()).length;
      let deleted = 0;
      for (let i = 0; i < 2; i += 1) {
        // A PIECE, not a folder: an empty folder made on this shelf sits at
        // the top of it now, and its ⋯ offers to delete the folder.
        const piece = [...document.querySelectorAll('#score-list li')]
          .find((li) => !li.querySelector('.lib-folder'));
        const row = piece?.querySelector('button:last-of-type');
        row?.click();
        await new Promise((r) => setTimeout(r, 400));
        const kill = [...document.querySelectorAll('.pick-pop.menu .pick-row')]
          .find((one) => /^delete/i.test(one.textContent.trim()));
        kill?.click();
        await new Promise((r) => setTimeout(r, 500));
        const dialog = [...document.querySelectorAll('dialog[open]')].at(-1);
        dialog?.querySelector('[value="delete"], .danger, [value="save"]')?.click();
        if (dialog?.open) dialog.close('delete');
        await new Promise((r) => setTimeout(r, 700));
        document.querySelector('.pick-pop.menu')?.remove();
      }
      deleted = wasScores - (await listScores()).length;
      return {
        'takes before saving': before,
        'a take saved': saved,
        'a take discarded': discarded,
        'pieces deleted, one after another': deleted,
      };
    });
  });

  // THE SCANNER, AND THE ONE LIST IN THIS APP THAT PATCHES ITS OWN NODES.
  //
  // The library and the score shelf rebuild themselves whole on every change,
  // so a handler cannot outlive the thing it closed over. The scanner's strip
  // does not: it replaces individual buttons in place, and both faults found in
  // it this week were handlers holding a page that had already been replaced.
  // So this deletes from the middle and then works the page that moved up into
  // the gap, which is the same defect one step over.
  await at('the scanner: four pages, one deleted, the rest edited twice', async (p) => {
    return p.evaluate(async () => {
      const { openScanner, scannerIsOpen } = await import('/src/ui/scanner.js');
      openScanner().catch(() => null);
      for (let i = 0; i < 60 && !document.querySelector('#scan-shutter'); i += 1) {
        await new Promise((r) => setTimeout(r, 100));
      }
      const shutter = document.querySelector('#scan-shutter');
      if (!shutter) return { 'scanner shutters pressed': 0 };
      // A PRESS BEFORE THE CAMERA IS LIVE. The shell is built before
      // `getUserMedia` is even called, and `capture()` used to return in
      // silence while `videoWidth` was 0 — so a hand that opened the scanner
      // and went straight for the shutter got nothing, and pressed again.
      // MEASURED at the time: four presses in that window put ONE page in the
      // strip. The button is born disabled now.
      const bornOff = shutter.disabled ? 1 : 0;
      shutter.click();
      await new Promise((r) => setTimeout(r, 250));
      const nothingYet = document.querySelectorAll('.scan-thumb').length === 0 ? 1 : 0;
      for (let i = 0; i < 120 && shutter.disabled; i += 1) {
        await new Promise((r) => setTimeout(r, 100));
      }
      await new Promise((r) => setTimeout(r, 300));
      let shots = 0;
      for (let i = 0; i < 4; i += 1) {
        shutter.click();
        shots += 1;
        for (let w = 0; w < 80; w += 1) {
          await new Promise((r) => setTimeout(r, 100));
          if (document.querySelectorAll('.scan-thumb:not(.pending)').length > i) break;
        }
      }
      const slots = () => [...document.querySelectorAll('.scan-thumb')];
      const numbers = () => slots().map((s) => s.querySelector('.scan-number')?.textContent);

      // …page 2 thrown away, from the middle.
      const before = slots().length;
      slots()[1]?.querySelector('.scan-drop')?.click();
      await new Promise((r) => setTimeout(r, 600));
      const after = slots().length;
      const renumbered = numbers().join(',');

      // …and then the page that MOVED UP into that gap is edited, twice, and
      // thrown away in its turn. If a button is still holding the page that was
      // deleted, one of these does nothing and says nothing.
      let edits = 0;
      for (let lap = 0; lap < 2; lap += 1) {
        const slot = slots()[1];
        const wasSrc = slot?.querySelector('img')?.src;
        slot?.querySelector('.scan-open')?.click();
        for (let w = 0; w < 60 && document.querySelector('#crop')?.hidden !== false; w += 1) {
          await new Promise((r) => setTimeout(r, 100));
        }
        if (document.querySelector('#crop')?.hidden === false) {
          document.querySelector(`.crop-look[data-look="${lap ? 'grey' : 'colour'}"]`)?.click();
          await new Promise((r) => setTimeout(r, 150));
          document.querySelector('#crop-keep')?.click();
          for (let w = 0; w < 120; w += 1) {
            await new Promise((r) => setTimeout(r, 100));
            const now = slots()[1]?.querySelector('img')?.src;
            if (now && now !== wasSrc) { edits += 1; break; }
          }
        }
        await new Promise((r) => setTimeout(r, 300));
      }
      const droppedAfter = slots().length;
      slots()[1]?.querySelector('.scan-drop')?.click();
      await new Promise((r) => setTimeout(r, 600));
      const droppedNow = slots().length;

      document.querySelector('#scan-done')?.click();
      await new Promise((r) => setTimeout(r, 1200));
      void scannerIsOpen;
      return {
        'the shutter is off until the camera is': bornOff,
        'and a press in that window puts nothing up': nothingYet,
        'scanner shutters pressed': shots,
        'pages in the strip': before,
        'a page deleted from the middle': before - after,
        'pages renumbered after the delete': renumbered === '1,2,3' ? 1 : 0,
        'edges edited after a delete': edits,
        'a second delete took a page': droppedAfter - droppedNow,
      };
    });
  });

  await page.close();
}

// --- what came out ----------------------------------------------------------
console.log(`\nwalked ${walked.length} steps across ${ONLY ? 1 : STATES.length} remembered states`);
console.log('what the walk actually did:');
for (const [what, n] of Object.entries(did)) console.log(`   ${String(n).padStart(5)}  ${what}`);
// Syncing the audio to the bars is on hold for this release — BAR_SYNC in
// ui/score.js — so the review draws no bar boxes and the step that counts them
// legitimately counts none. Read off the source rather than hard-coded, so this
// expectation comes back on its own the day the switch moves.
const BARS_ON = !/const BAR_SYNC = false/.test(
  await readFile(new URL('../src/ui/score.js', import.meta.url), 'utf8'));

// A step that stops working has to fail rather than go quiet.
const WANT = {
  'tabs opened': 10, 'settings sheets opened': 2, 'pieces on the shelf': 2,
  'folders made': 2, 'takes in the library': 2, 'takes opened': 2,
  'pages turned': 8, 'strokes drawn': 2, 'options rows built': 8,
  'bars drawn over the pages': BARS_ON ? 4 : 0, 'rings marked on the notes': 4,
  'folders opened and left': 2, '⋯ menus opened': 2, 'notes in the take': 40,
  'the shutter is off until the camera is': 1,
  'and a press in that window puts nothing up': 1,
  'scanner shutters pressed': 4, 'pages in the strip': 4,
  'a take saved': 1, 'a take discarded': 1, 'pieces deleted, one after another': 2,
  'resize watchers, after two reviews': 1,
  'a page deleted from the middle': 1, 'pages renumbered after the delete': 1,
  'edges edited after a delete': 2, 'a second delete took a page': 1,
};
const idle = Object.entries(WANT).filter(([what, least]) => (did[what] ?? 0) < least);
// …and the other direction, for the one number that must not GROW. Five states,
// one watcher each at most.
const watchers = did['resize watchers, after two reviews'] ?? 0;
const leaked = watchers > (ONLY ? 1 : STATES.length);
if (leaked) {
  console.log(`\nA WATCHER WAS LEFT BEHIND: ${watchers} live after`
    + ` ${ONLY ? 1 : STATES.length} × two reviews, at most ${ONLY ? 1 : STATES.length} expected`);
}
if (idle.length) {
  console.log('\nSTEPS THAT DID NOTHING — the walk is not walking, whatever it reports:');
  for (const [what, least] of idle) console.log(`   ${what}: ${did[what] ?? 0}, wanted at least ${least}`);
}

if (!found.size) {
  console.log('ALL PASS — nothing was thrown, and nothing was logged as an error');
} else {
  for (const [message, { where, count }] of found) {
    console.log(`✗ ${message}`);
    console.log(`    ${count}x — ${[...where].slice(0, 4).join(' | ')}`);
  }
  console.log(`\n${found.size} DISTINCT ERRORS`);
}
await browser.close();
process.exit(found.size || idle.length || leaked ? 1 : 0);
