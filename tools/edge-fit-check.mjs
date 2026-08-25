// NOTHING RUNS OFF THE EDGE OF THE SCREEN.
//
// Two things were doing it, on every screen in the app, and neither was ever
// going to be caught by a check that asserts behaviour:
//
//   · THE TAB BAR. `min-width` and `white-space: nowrap` on six tabs made the
//     row wider than the bar holding it, and the bar is capped at the viewport
//     — so the last tab was cut off. The row wants 389px and has 375 at 390
//     wide, so "Metronome" lost 6px; at 375 it lost 21, at 360 it lost 36, and
//     at 320 it lost 76 — three quarters of the word.
//   · THE PITCH GRAPH. It is deliberately bled past the padding around it so it
//     runs edge to edge on a phone, and the bleed was written as one number —
//     "0.6rem panel + 0.7rem card" — which is right inside `#report` on the
//     Record tab and wrong on the Score tab, where the same panel is MOVED into
//     `#score-dock` and there is no card padding between it and the screen. The
//     canvas sat at x = -11 and the pitch names down the side were cut in half:
//     "G#2" read "#2".
//
// So this measures the one thing they have in common: every element that is
// supposed to be within the screen is within the screen, at every width a phone
// comes in. It looks at the DOCUMENT rather than at a list of suspects, because
// the next one of these will be somewhere nobody thought to look.
//
//   npm run dev             (on 5199)
//   npm run edge:fit
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

// 320 is the narrowest phone anybody still holds; 430 is the widest.
const WIDTHS = [320, 360, 375, 390, 430];

const browser = await puppeteer.launch({
  executablePath: SHELL, headless: true,
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
});

for (const width of WIDTHS) {
  const page = await browser.newPage();
  await page.setViewport({ width, height: 844, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  await page.goto(APP, { waitUntil: 'load' });
  await new Promise((r) => setTimeout(r, 1600));

  // A shelf, a part and a take, so the screens being measured have something on
  // them: an empty app has nothing to hang off the edge.
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

  const over = await page.evaluate(async () => {
    const bad = [];
    const tabs = ['tuner', 'analyze', 'library', 'score', 'coach', 'metronome'];
    for (const tab of tabs) {
      for (let i = 0; i < 20; i += 1) {
        if (document.querySelector(`#tab-${tab}`)?.classList.contains('active')) break;
        document.querySelector(`.tab-btn[data-tab="${tab}"]`)?.click();
        await new Promise((r) => setTimeout(r, 120));
      }
      await new Promise((r) => setTimeout(r, 600));
      // WHAT IS ALLOWED PAST THE EDGE, and why each one is.
      //
      //  · anything inside something that scrolls sideways — that IS the point
      //    of a scroller, and what matters is that the scroller is on screen;
      //  · the drifting colour behind everything (`#blobs`), which is a fixed
      //    decoration inset past all four edges on purpose and takes no taps.
      const inScroller = (node) => {
        for (let up = node.parentElement; up && up !== document.body; up = up.parentElement) {
          const how = getComputedStyle(up).overflowX;
          if (how === 'auto' || how === 'scroll') return true;
        }
        return false;
      };
      const decoration = (node) => !!node.closest?.('#blobs');
      for (const node of document.querySelectorAll('body *')) {
        if (node.hidden || !node.getClientRects().length) continue;
        const style = getComputedStyle(node);
        if (style.visibility === 'hidden' || style.opacity === '0') continue;
        if (decoration(node) || inScroller(node)) continue;
        const box = node.getBoundingClientRect();
        const outLeft = Math.round(-box.left);
        const outRight = Math.round(box.right - window.innerWidth);
        // A pixel is rounding. Three is a decision.
        const worst = Math.max(outLeft, outRight);
        if (worst < 3) continue;
        // …and the thing itself has to be the offender, not a child inside a
        // parent that already reported.
        bad.push({
          tab,
          what: (node.id ? `#${node.id}` : `${node.tagName.toLowerCase()}.${String(node.className).trim().split(/\s+/)[0] || ''}`)
            + ` [in ${node.parentElement?.id ? `#${node.parentElement.id}` : String(node.parentElement?.className || '').split(/\s+/)[0]}`
            + `, ${Math.round(box.width)}px wide]`,
          left: outLeft > 2 ? outLeft : 0,
          right: outRight > 2 ? outRight : 0,
        });
      }
    }
    // One line per offender, whichever tab it was worst on.
    const worst = new Map();
    for (const one of bad) {
      const now = Math.max(one.left, one.right);
      const had = worst.get(one.what);
      if (!had || now > Math.max(had.left, had.right)) worst.set(one.what, one);
    }
    return [...worst.values()].sort((a, b) => Math.max(b.left, b.right) - Math.max(a.left, a.right));
  });

  check(`${width}px: nothing hangs off the edge of the screen`, over.length === 0,
    over.slice(0, 6).map((o) => `${o.what} (${o.tab}) ${o.left ? `${o.left}px off the left` : ''}`
      + `${o.right ? `${o.right}px off the right` : ''}`).join(', '));

  // …AND THE GRAPH REACHES BOTH EDGES, which is the other half of the same
  // question. It is deliberately bled past the padding around it so it runs the
  // width of the phone; a bleed that is too SMALL leaves a gap and reports
  // nothing above, and a bleed that is too big is what put the pitch names off
  // the screen. Both are one measurement.
  const bleed = await page.evaluate(async () => {
    for (let i = 0; i < 20; i += 1) {
      if (document.querySelector('#tab-analyze')?.classList.contains('active')) break;
      document.querySelector('.tab-btn[data-tab="analyze"]')?.click();
      await new Promise((r) => setTimeout(r, 120));
    }
    await new Promise((r) => setTimeout(r, 700));
    const box = document.querySelector('#chart-scroll')?.getBoundingClientRect();
    if (!box || !box.width) return null;
    return { left: Math.round(box.left), right: Math.round(window.innerWidth - box.right) };
  });
  check(`${width}px: the graph reaches both edges and passes neither`,
    !!bleed && Math.abs(bleed.left) <= 2 && Math.abs(bleed.right) <= 2,
    bleed ? `${bleed.left}px from the left, ${bleed.right}px from the right` : 'no graph on screen');

  // …and the tab bar's own words are whole, which is not the same question: a
  // label can be clipped by its own button without the button leaving the
  // screen.
  const tabs = await page.evaluate(() => {
    const bar = document.querySelector('nav[role="tablist"]');
    if (!bar) return { none: true };
    const btns = [...bar.querySelectorAll('.tab-btn')];
    return {
      cut: bar.scrollWidth - bar.clientWidth,
      tight: btns.filter((b) => b.scrollWidth - b.clientWidth > 1).map((b) => b.textContent.trim()),
      labels: btns.length,
    };
  });
  check(`${width}px: all six tabs fit, whole`,
    tabs.cut <= 1 && (tabs.tight?.length ?? 0) === 0 && tabs.labels === 6,
    `${tabs.cut}px past the bar${tabs.tight?.length ? `, clipped: ${tabs.tight.join(', ')}` : ''}`);

  await page.close();
}

const failed = results.filter((r) => !r.pass);
console.log(failed.length ? `\n${failed.length} FAILED` : '\nALL PASS');
await browser.close();
process.exit(failed.length ? 1 : 0);
