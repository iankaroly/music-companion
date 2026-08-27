// "I STARTED HERE" — one tap, and the map stops claiming the top of the page.
//
// The spread that needs no taps used to pin bars[0] — the first bar of the
// first page — to the first note heard, always. That is only true of somebody
// who started at the top. Start half way down and every bar above where you
// began is claimed to have been played in the seconds before you played
// anything, the line from there to the music is compressed into almost nothing,
// and the light runs ahead of the sound for the rest of the part.
//
// What is proved here is the before and the after, on the same layer, with the
// same take: what pressing a bar asks to hear when the app is left to spread the
// take over the whole page, and what it asks after one tap says where the
// playing started. And the hole underneath it — a mark made before the take has
// ever been played back used to be written down as "this bar sounded at second
// zero", because `heard` starts at 0 and 0 is a real second.
//
// The take player is stubbed: what is measured is the gesture and the
// arithmetic, not the audio engine.
//
//   npm run dev            (in another terminal, on port 5199)
//   npm run scan:start
//
import { writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : fallback;
};
const OUT = path.resolve(flag('out', path.join(tmpdir(), 'practice-partner-barstart')));
const APP = flag('app', 'http://localhost:5199');
const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: SHELL,
  headless: true,
  args: ['--no-sandbox'],
});
const page = await browser.newPage();
await page.setViewport({ width: 900, height: 1200 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(APP, { waitUntil: 'domcontentloaded' });

const report = await page.evaluate(async () => {
  const { attachBarSync } = await import('/src/ui/bar-sync.js');

  // Two pages of four systems, two bars in each: sixteen bars over eight
  // systems, so a bar's position in the piece is its index divided by two.
  const stave = (top) => ({
    top, bottom: top + 0.16, space: 0.012, bars: [0.5], heads: [{ x: 0.2 }, { x: 0.8 }],
  });
  const layout = [
    { staves: [stave(0.06), stave(0.3), stave(0.54), stave(0.78)] },
    { staves: [stave(0.06), stave(0.3), stave(0.54), stave(0.78)] },
  ];

  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:0;top:0;width:760px;z-index:99999;'
    + 'background:#fff;padding:12px;';
  for (let i = 0; i < 2; i += 1) {
    const holder = document.createElement('div');
    holder.className = 'scan-page';
    holder.dataset.page = String(i);
    holder.style.cssText = 'position:relative;width:360px;height:480px;display:inline-block;'
      + 'background:#fff;outline:1px solid #ddd';
    for (const top of [0.06, 0.3, 0.54, 0.78]) {
      const rule = document.createElement('div');
      rule.style.cssText = `position:absolute;left:8%;right:8%;top:${(top + 0.08) * 100}%;`
        + 'height:2px;background:#333';
      holder.append(rule);
    }
    host.append(holder);
  }
  document.body.append(host);

  // A TAKE THAT STARTS HALF WAY DOWN. Forty notes from 10s to 50s, evenly
  // spaced, with pitches the shape matcher cannot place on a layout whose
  // heads carry no staff position — so this is the case the spread is for, and
  // the app has nothing to go on but where it is told the playing began.
  const played = Array.from({ length: 40 }, (_, i) => ({
    midi: 60 + (i % 5),
    start: 10 + i,
    end: 10.8 + i,
  }));

  const asked = [];
  let saved = null;
  const sync = attachBarSync(host, {
    layout,
    play: (seconds) => { asked.push(seconds); return true; },
    follow: () => () => {},
    notes: played,
    onAnchors: (marks) => { saved = marks.map((m) => ({ ...m })); },
  });
  if (!sync) return { built: false };

  const boxes = [...host.querySelectorAll('.scan-bar')];
  const strip = document.querySelector('.bar-sync-bar');
  const startedButton = strip.querySelector('[data-bar="start"]');

  // --- BEFORE: the take spread over the whole part -------------------------
  // Bar 8 is the top of page 2, four systems in of eight. Spread over the
  // whole page it lands half way through a take that runs 10s to 50s: 30s.
  // The player actually began there, so the honest answer is 10s.
  boxes[8].click();
  const beforeBar8 = asked.at(-1);
  const openedReady = sync.anchors.length >= 2;

  // --- the tap -------------------------------------------------------------
  startedButton.click();
  const arming = strip.classList.contains('marking');
  boxes[8].click();
  const afterMode = strip.classList.contains('marking');
  const startedBoxes = [...host.querySelectorAll('.scan-bar.started')].length;

  // --- AFTER ---------------------------------------------------------------
  asked.length = 0;
  boxes[8].click();          // where the playing began: the first note, 10s
  boxes[12].click();         // two systems on of the four played: 30s
  boxes[15].click();         // the last bar: the end of the take, near 50s
  const after = [...asked];

  const said = host.querySelector('.bar-sync-say')?.textContent ?? '';

  // --- and the hole: a mark made before anything has been played back ------
  //
  // Its own host, because a second layer over the same pages puts a second set
  // of boxes and a second strip in the document and every query then has two
  // answers — which is a bug in a check, not in the thing being checked.
  const other = document.createElement('div');
  other.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;overflow:hidden;';
  for (let i = 0; i < 2; i += 1) {
    const holder = document.createElement('div');
    holder.className = 'scan-page';
    holder.dataset.page = String(i);
    holder.style.cssText = 'position:relative;width:360px;height:480px;';
    other.append(holder);
  }
  document.body.append(other);
  const second = attachBarSync(other, {
    layout,
    play: () => true,
    follow: () => () => {},
    notes: played,
  });
  // "Mark where you are" — the first button in the strip — and then a bar,
  // with the take never once played back.
  other.querySelector('.bar-sync-bar [data-bar="where"]').click();
  [...other.querySelectorAll('.scan-bar')][8].click();
  const blindMark = second.anchors.find((a) => Math.abs(a.at - 4) < 1e-6) ?? null;
  const blindStarted = other.querySelectorAll('.scan-bar.started').length;

  // --- and the stretches the map is only running across ---------------------
  //
  // "why would someone want to click on a bar and have the audio playing not be
  // from that bar" — measured with `npm run scan:guess`: between the anchors a
  // press lands about one note out, and the worst answers on the page are all
  // on systems the matcher refused. So the bars in such a stretch are drawn
  // differently and a press in one says what it is answering from.
  //
  // A page with real staff positions on it, so the matcher places some systems
  // and refuses others — the mixed case, which the fixtures above cannot make
  // because their heads carry no `step` at all and nothing is ever placed.
  const MAJOR = [0, 2, 4, 5, 7, 9, 11];
  const toMidi = (st) => 48 + 12 * Math.floor(st / 7) + MAJOR[((st % 7) + 7) % 7];
  let walk = 0;
  let seed = 5;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const mixedStaves = [];
  const mixedSteps = [];
  for (let sys = 0; sys < 6; sys += 1) {
    const heads = [];
    for (let i = 0; i < 24; i += 1) {
      walk += Math.round((rnd() - 0.5) * 5);
      walk = Math.max(-4, Math.min(12, walk));
      heads.push({ step: walk, x: 0.08 + (i / 24) * 0.84, y: 0.1 + sys * 0.15 });
      mixedSteps.push(walk);
    }
    mixedStaves.push({
      top: 0.06 + sys * 0.15, bottom: 0.06 + sys * 0.15 + 0.1, space: 0.012,
      bars: [0.35, 0.65], heads,
    });
  }
  const mixedLayout = [{ staves: mixedStaves }];
  // …AND THE TAKE SKIPS TWO SYSTEMS, which is what practising looks like: the
  // page has six, the playing covers 0, 1, 4 and 5, and nothing in the middle
  // can be found because nothing in the middle was played. That is the mixed
  // map this is for — anchors either side of a stretch with nothing in it.
  const mixedTake = mixedSteps
    .map((st, i) => ({ st, i }))
    .filter(({ i }) => i < 48 || i >= 96)
    .map(({ st }, n) => ({ midi: toMidi(st), start: n * 0.5, end: n * 0.5 + 0.4 }));

  const third = document.createElement('div');
  third.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;overflow:hidden;';
  const holder3 = document.createElement('div');
  holder3.className = 'scan-page';
  holder3.dataset.page = '0';
  holder3.style.cssText = 'position:relative;width:360px;height:900px;';
  third.append(holder3);
  document.body.append(third);
  const { placeSystems } = await import('/src/analysis/scan-align.js');
  const { systemsOf } = await import('/src/analysis/bar-map.js');
  const placements = placeSystems(systemsOf(mixedLayout), mixedTake);
  attachBarSync(third, {
    layout: mixedLayout,
    play: () => true,
    follow: () => () => {},
    notes: mixedTake,
  });
  const mixedBoxes = [...third.querySelectorAll('.scan-bar')];
  const unsureBoxes = mixedBoxes.filter((b) => b.classList.contains('unsure'));
  // A press inside one of them says what it is answering from.
  unsureBoxes[0]?.click();
  const saidOnPress = third.querySelector('.bar-sync-say')?.textContent ?? '';
  const mixed = {
    placed: placements.filter((one) => one.sure).length,
    refused: placements.filter((one) => !one.sure).length,
    bars: mixedBoxes.length,
    unsure: unsureBoxes.length,
    saidOnPress,
    strip: third.querySelector('.bar-sync-say')?.textContent ?? '',
  };

  const shot = host.getBoundingClientRect();
  return {
    built: true,
    beforeBar8,
    openedReady,
    arming,
    afterMode,
    startedBoxes,
    after,
    anchors: sync.anchors.length,
    saved,
    blindMarkTime: blindMark ? blindMark.time : null,
    blindStarted,
    said,
    mixed,
    where: { x: shot.x, y: shot.y, width: shot.width, height: shot.height },
  };
});

if (report.built) {
  await page.screenshot({ path: path.join(OUT, 'started.png'), clip: report.where });
}
await browser.close();

if (!report.built) {
  console.log('the layer would not attach to those pages');
  process.exit(1);
}

const near = (a, b, slack = 0.6) => Number.isFinite(a) && Math.abs(a - b) < slack;
const results = [];
const check = (name, pass, detail = '') => {
  results.push(pass);
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

console.log(`a take from 10s to 50s, played from the top of page 2\n`);
check('opens ready to press, with no taps at all', report.openedReady);
check('spread over the whole part, bar 9 asks for the middle of the take',
  near(report.beforeBar8, 30), `${report.beforeBar8?.toFixed(1)} s  (the wrong answer, want 30.0)`);
check('the button arms the next tap', report.arming);
check('and disarms once a bar has been marked', report.afterMode === false);
check('one bar shows where the playing started', report.startedBoxes === 1,
  `${report.startedBoxes}`);
check('bar 9 now asks for the first note', near(report.after[0], 10),
  `${report.after[0]?.toFixed(1)} s  (want 10.0)`);
check('bar 13, two systems on of the four played', near(report.after[1], 30),
  `${report.after[1]?.toFixed(1)} s  (want 30.0)`);
// Bar 16 BEGINS at system 7.5 of the eight the take covered, and a press plays
// from where a bar begins — so the honest answer is 45s and not the 50s the
// take ends at. Half a system of music is the difference.
check('the last bar begins where seven and a half systems in falls',
  near(report.after[2], 45), `${report.after[2]?.toFixed(1)} s  (want 45.0)`);
check('the mark is kept as a start and not as an ordinary tap',
  report.saved?.length === 1 && report.saved[0].start === true
    && near(report.saved[0].time, 10),
  JSON.stringify(report.saved));
check('a mark made before the take was played back pins the first note, not zero',
  near(report.blindMarkTime, 10), `${report.blindMarkTime} s  (want 10, not 0)`);
check('…and it is taken as a start', report.blindStarted === 1, `${report.blindStarted}`);
check('the strip says which bar it was run from', /started at bar 9/.test(report.said),
  JSON.stringify(report.said));
const mixed = report.mixed ?? {};
console.log('');
console.log(`a page the matcher places in part: ${mixed.placed} systems placed, ${mixed.refused} refused`);
check('a map with a gap in it marks the bars it is only running across',
  mixed.refused > 0 && mixed.unsure > 0 && mixed.unsure < mixed.bars,
  `${mixed.unsure} of ${mixed.bars} bars marked`);
check('…and a press in one says what it is answering from',
  /nothing was placed near it/.test(mixed.saidOnPress ?? ''),
  JSON.stringify(mixed.saidOnPress));

check('nothing was thrown', errors.length === 0, errors.join(' | '));

console.log(`\npicture: ${path.join(OUT, 'started.png')}`);
const ok = results.every(Boolean);
console.log(ok ? '\nPASS — one tap says where the playing began, and the map runs from there' : '\nFAIL');
process.exit(ok ? 0 : 1);
