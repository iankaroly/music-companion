// TAP A BAR, HEAR THAT MOMENT — driven the way a finger drives it.
//
// `bar-map` is unit-tested and `scan:barmap` proves the boxes land on the
// printed bars. Neither of those presses anything. This mounts the real layer
// over real page elements, taps real buttons in the real order a player would —
// mark the bar you are hearing, mark another, then tap a third — and checks
// that what came back was a request to play the take at the second the map says.
//
// The take player is stubbed, because what is being measured is the gesture and
// the arithmetic behind it, not the audio engine: a real recording would make
// this slow, need a microphone somewhere in its history, and prove nothing more.
//
//   npm run dev            (on 5199)
//   npm run scan:barsync -- [--out <dir>]

import { writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : fallback;
};
const OUT = path.resolve(flag('out', path.join(tmpdir(), 'practice-partner-barsync')));
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

  // Two pages of four systems, two bars in each: sixteen bars, and page 2's
  // first system follows page 1's last.
  const stave = (top) => ({
    top, bottom: top + 0.16, space: 0.012, bars: [0.5], heads: [{ x: 0.2 }, { x: 0.8 }],
  });
  const layout = [
    { staves: [stave(0.06), stave(0.3), stave(0.54), stave(0.78)] },
    { staves: [stave(0.06), stave(0.3), stave(0.54), stave(0.78)] },
  ];

  // The pages as the scan view draws them: a holder per page carrying its
  // number, with the picture inside it.
  const host = document.createElement('div');
  // Over the app's own screen, so the picture this leaves is of the bars and
  // not of whatever the app happened to be showing behind them.
  host.style.cssText = 'position:fixed;left:0;top:0;width:760px;z-index:99999;'
    + 'background:#fff;padding:12px;';
  for (let i = 0; i < 2; i += 1) {
    const holder = document.createElement('div');
    holder.className = 'scan-page';
    holder.dataset.page = String(i);
    holder.style.cssText = 'position:relative;width:360px;height:480px;display:inline-block;'
      + 'background:#fff;outline:1px solid #ddd';
    // Something to see the boxes against: four staves where the layout says.
    for (const top of [0.06, 0.3, 0.54, 0.78]) {
      const rule = document.createElement('div');
      rule.style.cssText = `position:absolute;left:8%;right:8%;top:${(top + 0.08) * 100}%;`
        + 'height:2px;background:#333';
      holder.append(rule);
    }
    host.append(holder);
  }
  document.body.append(host);

  // The take player, stubbed: it writes down what it was asked to play.
  const asked = [];
  let tell = null;
  const sync = attachBarSync(host, {
    layout,
    play: (seconds) => { asked.push(seconds); return true; },
    follow: (fn) => { tell = fn; return () => { tell = null; }; },
  });
  if (!sync) return { built: false };

  const boxes = [...host.querySelectorAll('.scan-bar')];
  const press = (i) => boxes[i].click();
  const hearing = (t) => tell?.(null, t);

  // --- the gesture ----------------------------------------------------------
  // Sixteen bars over two pages; the take runs 60 seconds. Say the first bar
  // was heard at 2s and bar 9 — the top of page 2 — at 34s.
  const startedMarking = sync.anchors.length === 0;
  hearing(2);
  press(0);
  const afterOne = sync.anchors.length;
  hearing(34);
  press(8);
  const afterTwo = sync.anchors.length;

  // Two marks is a map, so it should have left marking mode by itself.
  const modeAfterTwo = document.querySelector('.bar-sync-bar').classList.contains('marking');

  // Now tap bars and see what it asks to play. Bar 0 is at position 0 and bar 8
  // at position 4 (four systems in), so the map is 8 seconds a system: bar 4
  // (two systems in) is 18s, and bar 12 (six systems in) is 50s.
  press(4);
  press(12);
  press(1);

  // …and the light follows the moment being heard.
  hearing(18);
  const litAt18 = boxes.findIndex((b) => b.classList.contains('sounding'));
  hearing(50);
  const litAt50 = boxes.findIndex((b) => b.classList.contains('sounding'));

  // Leave it showing what a player sees: the marks made, one bar sounding, and
  // the boxes visible the way they are while marking.
  document.querySelector('.bar-sync-bar button').click();
  hearing(18);

  const shot = host.getBoundingClientRect();
  return {
    built: true,
    bars: sync.bars.length,
    boxes: boxes.length,
    startedMarking,
    afterOne,
    afterTwo,
    modeAfterTwo,
    asked,
    litAt18,
    litAt50,
    marked: boxes.filter((b) => b.classList.contains('marked')).length,
    where: { x: shot.x, y: shot.y, width: shot.width, height: shot.height },
  };
});

if (report.built) {
  await page.screenshot({ path: path.join(OUT, 'bars.png'), clip: report.where });
}
await browser.close();

if (!report.built) {
  console.log('the layer would not attach to those pages');
  process.exit(1);
}
console.log(`bars from the layout             ${report.bars}`);
console.log(`boxes drawn over the pages       ${report.boxes}`);
console.log(`starts in marking mode           ${report.startedMarking}`);
console.log(`anchors after one tap / two      ${report.afterOne} / ${report.afterTwo}`);
console.log(`still marking after two          ${report.modeAfterTwo}  (want false)`);
console.log(`asked to play at                 ${report.asked.map((n) => n.toFixed(1)).join(', ')} s`);
console.log(`                                 (want 18.0, 50.0, 6.0)`);
console.log(`bar lit while hearing 18s / 50s  ${report.litAt18} / ${report.litAt50}  (want 4 / 12)`);
console.log(`bars showing a mark              ${report.marked}  (want 2)`);
console.log(`\npicture: ${path.join(OUT, 'bars.png')}`);
if (errors.length) console.log(`page errors: ${errors.join(' | ')}`);

const near = (a, b) => Math.abs(a - b) < 0.35;
const ok = report.bars === 16 && report.boxes === 16
  && report.startedMarking && report.afterOne === 1 && report.afterTwo === 2
  && report.modeAfterTwo === false
  && report.asked.length === 3
  && near(report.asked[0], 18) && near(report.asked[1], 50) && near(report.asked[2], 6)
  && report.litAt18 === 4 && report.litAt50 === 12
  && report.marked === 2;
console.log(ok ? '\nPASS — marking two bars maps the rest, and a tap plays that moment' : '\nFAIL');
process.exit(ok ? 0 : 1);
