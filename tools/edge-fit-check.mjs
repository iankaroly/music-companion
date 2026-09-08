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

  // ── THE WELCOME CARD, BEFORE ANYTHING DELETES IT ──────────────────────────
  // Everything below this begins by removing the welcome screen, which is right
  // for measuring the app but left the FIRST screen a new player ever sees out
  // of every fit check in the repo — and it was broken: the instrument tiles'
  // captions ("flute, clarinet, oboe, sax, bassoon") set each tile's min-content
  // width, `repeat(2, 1fr)` could not go under it, and the right-hand column sat
  // 103px past the card's content edge — the edge measured below — and off a
  // 320-wide screen entirely, reading "flute, clarinet, obo". So measure it
  // here, first, while it is still on the page.
  //
  // Two things together, because either alone passes a bad card: every tile
  // INSIDE the card's content box (a tile can be whole and still hang off), and
  // every tile's own words UNCUT (a tile can sit inside the card with its
  // caption clipped). Plus the way out: a taller card must still be scrollable
  // to "Start playing", or a fixed overhang becomes a dead first screen.
  const welcome = await page.evaluate(async () => {
    const card = document.querySelector('#welcome-card');
    const tiles = [...document.querySelectorAll('#welcome-instruments [data-instrument]')];
    if (!card || !tiles.length) return { none: true };
    const style = getComputedStyle(card);
    const box = card.getBoundingClientRect();
    const left = box.left + parseFloat(style.paddingLeft);
    const right = box.right - parseFloat(style.paddingRight);
    const past = [];
    const cut = [];
    for (const tile of tiles) {
      const r = tile.getBoundingClientRect();
      const out = Math.round(Math.max(left - r.left, r.right - right));
      const name = tile.firstChild?.textContent?.trim() || tile.textContent.trim();
      if (out > 2) past.push(`${name} +${out}px`);
      for (const node of [tile, ...tile.querySelectorAll('*')]) {
        if (node.scrollWidth - node.clientWidth > 1) { cut.push(name); break; }
      }
    }
    // The way out, after scrolling as far as the card goes.
    const start = document.querySelector('#welcome-start');
    card.scrollTop = card.scrollHeight;
    await new Promise((r) => setTimeout(r, 120));
    const s = start?.getBoundingClientRect();
    const reachable = !!s && s.bottom <= window.innerHeight + 2 && s.top >= -2 && s.height > 20;
    return { past, cut, tiles: tiles.length, reachable, startBottom: Math.round(s?.bottom ?? 0), viewportH: window.innerHeight };
  });
  check(`${width}px: the welcome card's instrument tiles fit inside it, whole`,
    !welcome.none && welcome.tiles === 5 && welcome.past.length === 0 && welcome.cut.length === 0,
    welcome.none ? 'no welcome card on a fresh profile'
      : `${welcome.tiles} tiles`
        + `${welcome.past.length ? `, past the card: ${welcome.past.join(', ')}` : ''}`
        + `${welcome.cut.length ? `, clipped words: ${welcome.cut.join(', ')}` : ''}`);
  check(`${width}px: "Start playing" is reachable on the welcome card`,
    !welcome.none && welcome.reachable,
    welcome.none ? 'no welcome card' : `bottom at ${welcome.startBottom}px of ${welcome.viewportH}`);

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

  // …and the SHELF HEADINGS are whole, which is the same question a third time
  // and the one nothing above could see: the Score tab's heading read "S…" at
  // 320 while every element on the screen was inside the screen, because the
  // clipping was INSIDE the row. The title is the only item there that can
  // give — the three buttons are `nowrap` — so it was handed 50px of a 301px
  // row for 77px of "Scores".
  //
  // TWO ASSERTIONS, because either alone passes a bad fix. Whole words plus a
  // row that does not overflow is satisfied by a heading that wraps its actions
  // onto a second line at EVERY width, which is a regression at 390 dressed up
  // as a fix; so the second one holds the rest of the range to ONE line. A
  // floor on the title that is too generous fails it.
  const heads = await page.evaluate(async () => {
    const out = {};
    for (const [tab, id] of [['score', '#score-browser-head'], ['library', '#library-head']]) {
      for (let i = 0; i < 20; i += 1) {
        if (document.querySelector(`#tab-${tab}`)?.classList.contains('active')) break;
        document.querySelector(`.tab-btn[data-tab="${tab}"]`)?.click();
        await new Promise((r) => setTimeout(r, 120));
      }
      await new Promise((r) => setTimeout(r, 400));
      // THE SHELF IS BEHIND THE REVIEW. Everything above this built a take and
      // annotated it, and a review arriving takes the Score tab — so the
      // heading row is hidden, has no client rects, and a check that walks its
      // children finds nothing and PASSES. It did, at every width, until the
      // "one line" assertion printed `row 0px, tallest item 0px`. Press the
      // review's ← first, and refuse to report on a row that is not on screen.
      document.querySelector('#score-review-back')?.click();
      await new Promise((r) => setTimeout(r, 300));
      // The heading of a piece is that piece's NAME and is allowed to
      // ellipsise; the root of the shelf is the fixed word being measured.
      const back = document.querySelector(tab === 'score' ? '#score-browser-back' : '#library-back');
      for (let i = 0; i < 6 && back && !back.hidden; i += 1) {
        back.click();
        await new Promise((r) => setTimeout(r, 200));
      }
      const head = document.querySelector(id);
      if (!head || !head.getClientRects().length) { out[tab] = { none: true }; continue; }
      const words = [];
      for (const node of head.querySelectorAll('*')) {
        if (node.hidden || !node.getClientRects().length) continue;
        if (node.scrollWidth - node.clientWidth > 1) words.push(node.textContent.trim());
      }
      // One line, measured as the row being no taller than its tallest item.
      const tall = Math.max(0, ...[...head.children]
        .filter((c) => !c.hidden && c.getClientRects().length)
        .map((c) => c.getBoundingClientRect().height));
      out[tab] = {
        words,
        title: document.querySelector(tab === 'score' ? '#score-browser-title' : '#library-title')?.textContent ?? '',
        over: head.scrollWidth - head.clientWidth,
        height: Math.round(head.getBoundingClientRect().height),
        tall: Math.round(tall),
      };
    }
    return out;
  });
  for (const [tab, head] of Object.entries(heads)) {
    check(`${width}px: the ${tab === 'score' ? 'Score' : 'Library'} tab's heading row reads whole`,
      !head.none && head.words.length === 0 && head.over <= 1,
      head.none ? 'the heading row was not on screen to measure'
        : `“${head.title}”, `
          + `${head.words.length ? `clipped: ${head.words.join(', ')}` : 'nothing clipped'}`
          + `, row ${head.over}px past itself`);
  }
  // …ON ONE LINE, at every width including 320. Letting the row WRAP is the
  // obvious way to make the words whole and it was tried: the actions on a
  // second line make the heading 68px tall against 32, and those 36px pushed
  // tour stop 7's hole from 99→301 down to 135→337 while its card only moved
  // 313→324, so the card came to lie over the control it describes. Whole
  // words alone would pass that; this is the half that does not.
  for (const [tab, head] of Object.entries(heads)) {
    check(`${width}px: the ${tab === 'score' ? 'Score' : 'Library'} tab's heading stays on one line`,
      !head.none && head.height <= head.tall + 1,
      head.none ? 'the heading row was not on screen to measure'
        : `row ${head.height}px, tallest item ${head.tall}px`);
  }

  await page.close();
}

const failed = results.filter((r) => !r.pass);
console.log(failed.length ? `\n${failed.length} FAILED` : '\nALL PASS');
await browser.close();
process.exit(failed.length ? 1 : 0);
