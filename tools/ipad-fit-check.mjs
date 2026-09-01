// THE APP ON AN iPAD, WHICH IT SHIPS FOR AND HAS NEVER BEEN MEASURED ON.
//
// `TARGETED_DEVICE_FAMILY = "1,2"`: the App Store listing covers iPhone AND
// iPad, so a reviewer will open it on one. `edge:fit` measures 320–430px —
// every width a phone comes in and none an iPad does — so the whole of the
// tablet, in both orientations, was untested.
//
// The overflow rule is `edge:fit`'s, deliberately: what is allowed past the
// edge (sideways scrollers, the drifting decoration) is the same question on a
// bigger pane of glass, and two answers to it would be one too many.
//
// What is asked HERE and not there is the opposite failure. A phone layout on a
// tablet does not usually break — it strands: a column of controls sized for a
// thumb, alone in the middle of a 1366px screen, with the reading line of text
// run out to the full width. So the widest run of text is measured as well.
//
//   npm run dev
//   npm run ipad:fit
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

// The iPads in circulation, in points, both ways up. The 13" is the one that
// strands a phone layout worst, and the mini is the one that crowds it.
const SCREENS = [
  { name: 'iPad mini portrait', width: 744, height: 1133 },
  { name: 'iPad 11" portrait', width: 820, height: 1180 },
  { name: 'iPad 11" landscape', width: 1180, height: 820 },
  { name: 'iPad 13" portrait', width: 1024, height: 1366 },
  { name: 'iPad 13" landscape', width: 1366, height: 1024 },
];

// Past this a line of text is hard to read: the eye loses the start of the next
// line. It is the reason every newspaper is in columns.
const LONG_LINE = 900;

const browser = await puppeteer.launch({
  executablePath: SHELL, headless: true,
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
  protocolTimeout: 240000,
});

for (const screen of SCREENS) {
  const page = await browser.newPage();
  await page.setViewport({
    width: screen.width, height: screen.height, deviceScaleFactor: 2, hasTouch: true, isMobile: true,
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(APP, { waitUntil: 'load' });
  await new Promise((r) => setTimeout(r, 1600));

  // A shelf, a part and a take, so the screens being measured have something on
  // them — an empty app has nothing to strand and nothing to hang off an edge.
  await page.evaluate(async ({ bravura }) => {
    document.querySelector('#welcome')?.remove();
    document.querySelector('#welcome-card')?.remove();
    const { engravePart, takeFromWritten } = await import('/src/fixtures/engraved-page.js');
    const { scoreId, written } = await engravePart({
      base64: bravura, name: 'Photographed part', pages: 2, systems: 5, perSystem: 8, space: 13,
    });
    const { selectScore, measurePages, annotateTake } = await import('/src/ui/score.js');
    const { renderFreeReview } = await import('/src/ui/report.js');
    const { Recorder } = await import('/src/audio/recording.js');
    await selectScore(scoreId);
    await measurePages(scoreId);
    const notes = takeFromWritten(written, { from: 0, count: 40, spacing: 0.35, sounding: 0.3, lead: 0 });
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
  }, { bravura: font });

  const seen = await page.evaluate(async (longLine) => {
    const over = [];
    const wide = [];
    const tabs = ['tuner', 'analyze', 'library', 'score', 'coach', 'metronome'];
    const inScroller = (node) => {
      for (let up = node.parentElement; up && up !== document.body; up = up.parentElement) {
        const how = getComputedStyle(up).overflowX;
        if (how === 'auto' || how === 'scroll') return true;
      }
      return false;
    };
    const decoration = (node) => !!node.closest?.('#blobs');

    for (const tab of tabs) {
      for (let i = 0; i < 20; i += 1) {
        if (document.querySelector(`#tab-${tab}`)?.classList.contains('active')) break;
        document.querySelector(`.tab-btn[data-tab="${tab}"]`)?.click();
        await new Promise((r) => setTimeout(r, 120));
      }
      await new Promise((r) => setTimeout(r, 600));

      for (const node of document.querySelectorAll('body *')) {
        if (node.hidden || !node.getClientRects().length) continue;
        const style = getComputedStyle(node);
        if (style.visibility === 'hidden' || style.opacity === '0') continue;
        if (decoration(node)) continue;
        const box = node.getBoundingClientRect();

        if (!inScroller(node)) {
          const worst = Math.max(Math.round(-box.left), Math.round(box.right - window.innerWidth));
          if (worst >= 3) {
            over.push({ tab, what: node.id ? `#${node.id}` : `${node.tagName.toLowerCase()}.${String(node.className).trim().split(/\s+/)[0] || ''}`, by: worst });
          }
        }

        // A LONG LINE OF TEXT, measured on the element that actually holds the
        // words rather than on the box around it: a wide container whose child
        // paragraph is capped is not the fault being looked for.
        const ownText = [...node.childNodes]
          .filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(' ');
        if (ownText.length > 90 && box.width > longLine) {
          wide.push({ tab, what: node.id ? `#${node.id}` : node.tagName.toLowerCase(), width: Math.round(box.width) });
        }
      }
    }
    const worstOf = (list, key) => {
      const m = new Map();
      for (const one of list) {
        const had = m.get(one.what);
        if (!had || one[key] > had[key]) m.set(one.what, one);
      }
      return [...m.values()].sort((a, b) => b[key] - a[key]);
    };

    // The tab bar, and the one big button, both of which have to be reachable.
    const bar = document.querySelector('.tab-btn')?.parentElement;
    const barBox = bar?.getBoundingClientRect();
    const start = document.querySelector('#start')?.getBoundingClientRect();
    return {
      over: worstOf(over, 'by'),
      wide: worstOf(wide, 'width'),
      tabsFit: !!barBox && barBox.right <= window.innerWidth + 2 && barBox.left >= -2,
      tabCount: document.querySelectorAll('.tab-btn').length,
      startOnScreen: !!start && start.top >= 0 && start.bottom <= window.innerHeight,
    };
  }, LONG_LINE);

  const at = `${screen.name} (${screen.width}x${screen.height})`;
  check(`${at}: nothing hangs off the edge`, seen.over.length === 0,
    seen.over.slice(0, 5).map((o) => `${o.what} on ${o.tab}, ${o.by}px`).join(', '));
  check(`${at}: all six tabs fit, whole`, seen.tabsFit && seen.tabCount === 6,
    `${seen.tabCount} tabs, within the screen: ${seen.tabsFit}`);
  check(`${at}: the Record button is on screen`, seen.startOnScreen);
  check(`${at}: no line of text runs past ${LONG_LINE}px`, seen.wide.length === 0,
    seen.wide.slice(0, 5).map((o) => `${o.what} on ${o.tab}, ${o.width}px wide`).join(', '));
  check(`${at}: nothing was thrown`, errors.length === 0, errors.slice(0, 2).join(' | '));
  await page.close();
}

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(failed.length ? `\n${failed.length} FAILED` : '\nALL PASS');
process.exit(failed.length ? 1 : 0);
