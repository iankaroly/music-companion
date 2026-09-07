// THE SCREENSHOTS THE APP STORE LISTING NEEDS, rendered rather than cropped.
//
// App Store Connect wants images at exact pixel sizes, and the app ships for
// iPhone AND iPad, so it wants both. These are produced at the size Apple asks
// for by rendering at the device's LOGICAL size and letting the device pixel
// ratio do the rest — 430x932 at 3x is 1290x2796, 1024x1366 at 2x is 2048x2732
// — so nothing is ever scaled up, and the type is as sharp as the screen it is
// pretending to be.
//
// The app is filled from the same fixtures `edge:fit` uses, so what is shown is
// the real interface with real content in it rather than an empty shell: a
// shelf of engraved parts with a folder and a programme, a take against one of
// them, a fortnight of takes for the coach, and pencil marks on a page — every
// one of them stored the way the app stores it and drawn by the app's own code.
//
// NOTHING HERE MARKS A TAKE ONTO THE MUSIC. The listing used to show the score
// tab with the take's rings on every notehead; that feature is not being put
// in front of people yet, so no screen calls annotateTake, and the score tab
// is photographed as what it is first — a music stand: the shelf, and a page
// open full screen with a pencil out.
//
//   npm run dev
//   npm run store:shots
//
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const APP = process.env.APP ?? 'http://localhost:5199';
const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const font = (await readFile(new URL('./fonts/Bravura.otf', import.meta.url))).toString('base64');
const OUT = new URL('../docs/store/', import.meta.url);
await mkdir(OUT, { recursive: true });

// Logical size and scale chosen so the PNG lands exactly on the size asked for.
const DEVICES = [
  { name: 'iphone-6.9', width: 430, height: 932, scale: 3 },   // 1290 x 2796
  { name: 'ipad-13', width: 1024, height: 1366, scale: 2 },    // 2048 x 2732
];

// The parts on the shelf. The first is the one the take, the coach's fortnight
// and the pencil marks are all made against; the two in the folder are what
// gives the folder a count.
const PARTS = [
  'Bach — Cello Suite No. 1, Prélude',
  'Saint-Saëns — The Swan',
  'Elgar — Salut d\'amour',
  'Fauré — Élégie',
  'Popper — Étude No. 3',
];
const FILED = ['Schumann — Fantasiestücke, Op. 73', 'Squire — Tarantella'];

// The engraving. TWELVE NOTES A SYSTEM, NOT EIGHT: at eight the page read as an
// exercise — a note every two centimetres with air between — and at twelve it
// reads as a part, with three bars to a line the way a printed one has. Eight
// systems for the reason the old note gave: five trim to a square, and a
// printed part is about 1.9:1.
const ENGRAVE = { pages: 2, systems: 8, perSystem: 12, space: 13 };

// The six screens, in the order a listing should tell the story: what it
// hears, the shelf, the pencil, the tuner, the weeks, the practice.
//
// `settle(page, seed)` runs in Node after the tab is up and before the shot,
// for a screen whose resting state is not the one worth showing; `after` puts
// the app back the way the next screen expects to find it. Both get the ids
// and geometry the seeding returned. `only` names the one device a screen is
// for, where the two devices want different pictures under the same caption.
const SCREENS = [
  { tab: 'analyze', name: '1-what-you-played' },
  {
    tab: 'score', name: '2-on-the-stand', only: 'iphone-6.9',
    // THE SHELF ON THE PHONE, THE PAGE ON THE IPAD. Six rows fill a phone's
    // screen and tell the story of parts being loaded, filed and put in a
    // programme; on an iPad the same six rows stop a third of the way down and
    // the rest is ground. LOOKED AT, both ways: the tablet reads better with a
    // part open full screen — which is what a stand is — on a different piece
    // from the pencil screen after it, so the two are not one page twice. The
    // reader's two-page spread would have been the better tablet picture and
    // it is only offered in landscape (`spreadFits`), which the listing's
    // portrait sizes rule out.
    //
    // The shelf is drawn when the tab is first shown, which was before any of
    // these parts existed. The search box's input handler is the one way in
    // from outside that redraws it without changing what is on it.
    settle: (page) => page.evaluate(async () => {
      const box = document.querySelector('#score-search');
      if (!box) return;
      box.value = '';
      box.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 600));
      document.scrollingElement.scrollTop = 0;
    }),
  },
  {
    tab: 'score', name: '2-on-the-stand', only: 'ipad-13',
    settle: (page, seed) => page.evaluate(async (id) => {
      const { openScoreFromLibrary } = await import('/src/ui/score.js');
      await openScoreFromLibrary(id);
      await new Promise((r) => setTimeout(r, 1500));
    }, seed.swan),
    after: (page) => page.evaluate(async () => {
      const { close } = await import('/src/ui/reader.js');
      close();
      await new Promise((r) => setTimeout(r, 400));
    }),
  },
  {
    tab: 'score', name: '3-pencil',
    // The reader, full screen on the first part, holding the pen. The marks
    // were written into the store during seeding (see marksFor); the reader
    // loads them the way it loads anybody's. The pen button on the top bar is
    // the same one a thumb presses, and pressing it is what brings the ink bar
    // and the brush row out — the bar is otherwise hidden, on purpose, from
    // the moment a part opens.
    settle: (page, seed) => page.evaluate(async (id) => {
      const { openScoreFromLibrary } = await import('/src/ui/score.js');
      await openScoreFromLibrary(id);
      await new Promise((r) => setTimeout(r, 1500));
      document.querySelector('#reader [data-tool="pen"]')?.click();
      await new Promise((r) => setTimeout(r, 800));
    }, seed.bach),
    after: (page) => page.evaluate(async () => {
      const { close } = await import('/src/ui/reader.js');
      close();
      await new Promise((r) => setTimeout(r, 400));
    }),
  },
  { tab: 'tuner', name: '4-tuner' },
  { tab: 'coach', name: '5-coach' },
  { tab: 'metronome', name: '6-metronome' },
];

// --- the pencil marks -------------------------------------------------------
//
// A handful of the marks a player actually makes, placed from where the notes
// were PRINTED — `engravePart` returns every notehead's position — so the ring
// goes round four notes, the fingerings sit over the notes they belong to and
// the highlighter runs along a stave.
//
// The reader's coordinate for a mark on paper is a fraction of the page's
// CONTENT BOX, not of the sheet. MEASURED, by writing a ruled line at every
// twentieth of the page: a line asked for at 0.50 of the sheet landed 0.04
// above the fifth stave, and the spacing between lines came out at 0.83 of a
// system where a system is 0.108 of the sheet — the crop this page gets is
// {y: 0.046, h: 0.833}, and those are the same two numbers. So the notehead
// positions, which are fractions of the sheet, go through the crop the reader
// remembered for the page (`loadScorePages(id).crops[0]`) before they are
// written. The crop only exists once the page has been measured, which is why
// `measurePages` runs first.
//
// Widths and text sizes are in the reader's own unit, a sixtieth of the page's
// height: a pen at 0.2 is a fine ballpoint, a highlighter at 1.6 is three
// staff spaces wide, and text at 1.1 is the size of a printed fingering.
function marksFor(written, crop, { systems, perSystem, space }) {
  const onPage = written.filter((w) => w.page === 0);
  const sys = (s) => onPage.slice(s * perSystem, s * perSystem + perSystem);
  // The engraving's own geometry (see engravePage): the middle line of stave
  // `s`, as a fraction of the sheet.
  const sheetH = space * (10 + systems * 13 + 6);
  const staffMid = (s) => (space * 8 + s * space * 13 + 2 * space) / sheetH;
  const at = (x, y) => ({
    space: 'page', p: 0, x: (x - crop.x) / crop.w, y: (y - crop.y) / crop.h,
  });
  // A hand is not a plotter: a little drift on the ring and the highlighter
  // so neither comes out as a geometric shape.
  const drift = (i) => Math.sin(i * 7.3) * 0.0015;
  const text = (label, x, y, extra = {}) => ({
    type: 'text', tool: 'text', layer: 0, text: label, size: 1.1, colour: '#1c1b22',
    points: [at(x, y)], ...extra,
  });

  // A passage ringed in red pencil: four notes of the second system.
  const ringed = sys(1).slice(2, 6);
  const cx = (ringed[0].x + ringed[3].x) / 2;
  const cy = (ringed.reduce((a, n) => a + n.y, 0) / ringed.length + staffMid(1)) / 2;
  const rx = (ringed[3].x - ringed[0].x) / 2 + 0.035;
  const ry = 0.03;
  const ring = [];
  for (let i = 0; i <= 40; i += 1) {
    const t = -0.4 + (i / 40) * Math.PI * 2.15;   // a hand overlaps the join
    ring.push(at(cx + rx * Math.cos(t) + drift(i), cy + ry * Math.sin(t) + drift(i + 3)));
  }

  // Fingerings over three notes of the third system.
  const fingered = sys(2);
  const fingerings = [['1', fingered[1]], ['3', fingered[2]], ['4', fingered[4]]]
    .map(([digit, note]) => text(digit, note.x - 0.006, note.y - 0.035));

  // The highlighter along the fifth system, over the stave and the notes on
  // it rather than dead on the middle line, because the notes there sit high.
  const lit = sys(4).slice(1, 6);
  const litY = (lit.reduce((a, n) => a + n.y, 0) / lit.length + staffMid(4)) / 2;
  const highlight = [];
  for (let i = 0; i <= 12; i += 1) {
    highlight.push(at(lit[0].x - 0.012 + (lit[4].x - lit[0].x + 0.024) * (i / 12), litY + drift(i)));
  }

  // "sul C", with an arrow to the note it means, in the sixth system.
  const target = sys(5)[6];
  const arrow = {
    type: 'shape', shape: 'arrow', tool: 'arrow', layer: 0, colour: '#2f7fe8',
    width: 0.2, overlay: false, nib: 'ballpoint',
    points: [at(target.x - 0.09, target.y - 0.048), at(target.x - 0.014, target.y - 0.012)],
  };

  return [
    { tool: 'pen', layer: 0, colour: '#d81b3c', width: 0.2, overlay: false, nib: 'pencil', points: ring },
    ...fingerings,
    { tool: 'highlighter', layer: 0, colour: 'hsla(52, 95%, 55%, 0.35)', width: 1.6, overlay: true, nib: 'marker', points: highlight },
    text('sul C', target.x - 0.17, target.y - 0.052, { size: 1.0, colour: '#2f7fe8' }),
    arrow,
    text('cresc.', sys(6)[2].x, sys(6)[2].y + 0.05, { size: 1.0 }),
  ];
}

const browser = await puppeteer.launch({
  executablePath: SHELL, headless: true,
  args: ['--no-sandbox', '--force-device-scale-factor=1'],
  protocolTimeout: 240000,
});

const made = [];
for (const device of DEVICES) {
  const page = await browser.newPage();
  await page.setViewport({
    width: device.width, height: device.height,
    deviceScaleFactor: device.scale, hasTouch: true, isMobile: true,
  });
  // The overview chart opens at 120 px per second, which on a phone shows the
  // first three seconds of a seventeen-second take — three notes of forty-eight
  // and a lot of empty ruled paper. The zoom is a stored preference the chart
  // reads once when its module loads, so it is set BEFORE the page's scripts
  // run, at the same 30 px/s floor the pinch gesture bottoms out at: about
  // thirteen seconds across a phone, the whole take across an iPad.
  //
  // The reader's first-run lines are marked as seen for the same reason: a
  // "tap the top to bring the bar back" hint across the music is not the
  // screen, and the reader's night setting is pinned to paper-white so the
  // page reads as a page against the listing's ground.
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('chartPxPerSec', '30');
    localStorage.setItem('readerHinted', 'yes');
    localStorage.setItem('readerPencilSeen', 'yes');
    localStorage.setItem('readerNight', 'off');
  });
  await page.goto(APP, { waitUntil: 'load' });
  await new Promise((r) => setTimeout(r, 1600));

  const seed = await page.evaluate(async ({ bravura, parts, filed, engrave }) => {
    document.querySelector('#welcome')?.remove();
    document.querySelector('#welcome-card')?.remove();
    const { engravePart, engravePage, takeFromWritten, useBravura } = await import('/src/fixtures/engraved-page.js');
    const db = await import('/src/store/db.js');
    // Loaded before either branch: the clef's measured width sets where the
    // first note of every system goes, so a page engraved without the font
    // puts its noteheads somewhere else and the marks miss them.
    await useBravura(bravura);
    // Seeded once: the iPad page shares the iPhone's store, and a second
    // sowing would put every part on the shelf twice and double every count
    // the coach shows.
    const already = (await db.listScores()).find((s) => s.name === parts[0]);
    let bach;
    let swan;
    let written;
    if (already) {
      bach = already.id;
      swan = (await db.listScores()).find((s) => s.name === parts[1])?.id ?? null;
      // The take and the coach's fortnight are built from what is WRITTEN,
      // and that came from the engraving; engraving the same seed again gives
      // the same notes without storing a second copy.
      const { pitchOf } = await import('/src/analysis/scan-notes.js');
      const { keyFromCount } = await import('/src/analysis/scan-key.js');
      const KEY = keyFromCount(1, 'sharp');
      written = [0, 1].flatMap((p) => engravePage({ ...engrave, seed: 20260818 + p * 7919 }).places
        .map((place) => ({ ...place, page: p, midi: pitchOf(place.step, 'bass', KEY)?.midi ?? null })));
    } else {
      // A different seed per part, so five parts are five different pieces
      // rather than one piece under five names. The first keeps the fixture's
      // own seed, which is the one the take below is built from.
      const ids = [];
      for (const [i, name] of [...parts, ...filed].entries()) {
        const one = await engravePart({ base64: bravura, name, ...engrave, seed: 20260818 + i * 101 });
        ids.push(one.scoreId);
        if (i === 0) { bach = one.scoreId; written = one.written; }
        if (i === 1) swan = one.scoreId;
      }
      // A folder made from the Scores shelf, with two pieces in it, and a
      // programme of three — the shelf's own rows, not a mock of them.
      const folder = await db.createFolder('Lessons', 'scores');
      for (const id of ids.slice(parts.length)) await db.setScoreFolder(id, folder);
      await db.saveSetlist({ name: 'Recital — 14 March', items: [ids[0], ids[1], ids[3]] });
    }

    // THE TAKE: sixty-four notes of the first part, heard well enough to draw a
    // pitch graph the length of a phone. The review is the free one — the
    // graph of what was played — and it is NOT marked onto the score.
    const { renderFreeReview } = await import('/src/ui/report.js');
    const { Recorder } = await import('/src/audio/recording.js');
    const notes = takeFromWritten(written, { from: 0, count: 64, spacing: 0.35, sounding: 0.3, lead: 0 });
    const readings = notes.map((n) => ({
      time: n.start, frequency: n.frequency, confidence: 0.95, rms: 0.05, midi: n.midi, cents: n.cents,
    }));
    const rec = new Recorder(44100);
    rec.push(new Float32Array(44100 * 18));
    renderFreeReview(document, notes, rec, { readings, a4: 440 });

    // THE COACH NEEDS A FORTNIGHT, not a take. It draws nothing until three
    // takes share a note, and its opening card compares this week with last —
    // so on a fresh store the Coach screenshot was an empty state under a
    // caption about what changed. Six takes of the same part, dated across
    // the last two weeks, each starting somewhere else in the music so the
    // same notes recur with different errors; and the older takes are played
    // wider of the mark than the newer ones, so the week-on-week card has a
    // direction to report.
    if ((await db.listRecordingsWithStats()).length === 0) {
      const DAY = 86400000;
      const takes = [
        { ago: 13, from: 8, wide: 1.6 }, { ago: 11, from: 0, wide: 1.5 },
        { ago: 8, from: 16, wide: 1.3 }, { ago: 5, from: 4, wide: 1.0 },
        { ago: 2, from: 12, wide: 0.8 }, { ago: 0, from: 0, wide: 0.7 },
      ];
      for (const t of takes) {
        const played = takeFromWritten(written, { from: t.from, count: 40, spacing: 0.35, sounding: 0.3, lead: 0 })
          .map((n) => ({ ...n, cents: Math.round(n.cents * t.wide) }));
        const heard = played.map((n) => ({
          time: n.start, frequency: n.frequency, confidence: 0.95, rms: 0.05, midi: n.midi, cents: n.cents,
        }));
        await db.saveRecording({
          date: Date.now() - t.ago * DAY, duration: 16, sampleRate: 44100,
          audio: new Float32Array(44100 * 2), notes: played, readings: heard, a4: 440,
          scoreId: bach, name: parts[0],
        });
      }
    }

    // THE PAGE'S CROP, for the pencil marks (see marksFor). Reading the pages
    // is what remembers it, and it is the same pass the app runs behind a
    // newly opened part.
    const { measurePages } = await import('/src/ui/score.js');
    await measurePages(bach);
    // The pass ends by saying "192 notes found, so your playing can be marked
    // onto them" in the Record tab's card and above the shelf — the one
    // sentence in the app that promises the screen this listing leaves out.
    // Cleared here, the way it clears itself the next time anything is said.
    for (const id of ['score-hint', 'score-tab-hint']) {
      const hint = document.getElementById(id);
      if (hint) { hint.textContent = ''; hint.hidden = true; }
    }
    const crop = (await db.loadScorePages(bach))?.crops?.[0] ?? null;
    return { bach, swan, written, crop };
  }, { bravura: font, parts: PARTS, filed: FILED, engrave: ENGRAVE });

  if (!seed.crop) throw new Error('the first page was never measured, so the marks have no crop to be placed by');
  await page.evaluate(async ({ id, marks }) => {
    const db = await import('/src/store/db.js');
    await db.saveAnnotations(id, marks);
  }, { id: seed.bach, marks: marksFor(seed.written, seed.crop, ENGRAVE) });

  for (const screen of SCREENS) {
    if (screen.only && screen.only !== device.name) continue;
    for (let i = 0; i < 20; i += 1) {
      if (await page.evaluate((t) => document.querySelector(`#tab-${t}`)?.classList.contains('active'), screen.tab)) break;
      await page.evaluate((t) => document.querySelector(`.tab-btn[data-tab="${t}"]`)?.click(), screen.tab);
      await new Promise((r) => setTimeout(r, 150));
    }
    if (screen.settle) await screen.settle(page, seed);
    // The charts draw on a canvas and the score draws on a photograph; both
    // finish a frame or two after the tab does.
    await new Promise((r) => setTimeout(r, 1500));
    const file = fileURLToPath(new URL(`${device.name}-${screen.name}.png`, OUT));
    await page.screenshot({ path: file, captureBeyondViewport: false });
    made.push({ file, device: device.name, screen: screen.name });
    if (screen.after) await screen.after(page, seed);
  }
  await page.close();
}
await browser.close();

console.log(`\n${made.length} screenshots in docs/store/`);
for (const one of made) console.log(`  ${one.device.padEnd(12)} ${one.screen}`);
