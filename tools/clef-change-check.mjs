// A clef that changes in the middle of a system.
//
// WHY THIS EXISTS
//
// A cello part changes clef constantly — bass to tenor for a high passage and
// back — and it does not wait for a system break to do it. The reader reads ONE
// clef per system, from a band just past the stave's left end, and applies it to
// every note on that system. So every note after a mid-system change is named
// with the wrong clef.
//
// AND IT IS NAMED CONFIDENTLY. `clefConfidence` is 1, because the clef the
// reader DID read is perfectly legible — it is simply not the clef those notes
// are written in. That makes this the worst failure in the reader: not a refusal
// and not a miss, but a page of wrong answers that says it is sure. Bass to
// tenor is a third and a half — a NINTH — so the notes come back wildly wrong
// and nothing downstream flags it.
//
//   npm run scan:clef-change
//
// Draws systems that change clef part-way through, at several sizes, and scores
// the PITCH of every note against what it was drawn as. A control page with the
// same music and no change is drawn beside each one, so a loss is the change's
// fault and not the layout's.

import { readFile } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';

const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const PORT = process.env.PORT ?? '5199';

const font = (await readFile(new URL('./fonts/Bravura.otf', import.meta.url))).toString('base64');
const browser = await puppeteer.launch({ executablePath: SHELL, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1500, height: 1400 });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 1500));

const rows = await page.evaluate(async ({ b64 }) => {
  const face = new FontFace('Bravura', `url(data:font/otf;base64,${b64})`);
  await face.load();
  document.fonts.add(face);
  const { readPage, notesInOrder } = await import('/src/analysis/scan-read.js');
  const G = { head: '\u{E0A4}', f: '\u{E062}', c: '\u{E05C}', g: '\u{E050}' };
  const ANCHOR = { bass: 1, tenor: 1, treble: 3 };
  const GLYPH = { bass: G.f, tenor: G.c, treble: G.g };
  // bottom line as a degree from C0: bass G2, tenor D3, treble E4
  const BOTTOM = { bass: 2 * 7 + 4, tenor: 3 * 7 + 1, treble: 4 * 7 + 2 };
  const SEMIS = [0, 2, 4, 5, 7, 9, 11];
  const midiOf = (deg) => (Math.floor(deg / 7) + 1) * 12 + SEMIS[((deg % 7) + 7) % 7];

  function draw({ space, from, to, changeAt, camera }) {
    const perSystem = 10;
    const systems = 3;
    const W = Math.round(space * 60);
    const H = Math.round(space * (10 + systems * 13 + 6));
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#111';
    const em = space * 4;
    const put = (ch, x, y, size = em) => { g.font = `${size}px Bravura`; g.textBaseline = 'alphabetic'; g.fillText(ch, x, y); g.font = `${size}px Bravura`; return g.measureText(ch).width; };
    const wid = (ch, size = em) => { g.font = `${size}px Bravura`; return g.measureText(ch).width; };
    const lt = Math.max(1, space * 0.1);
    const truth = [];
    for (let s = 0; s < systems; s++) {
      const base = space * 8 + s * space * 13;
      const lineY = (l) => base + l * space;
      const stepY = (st) => lineY(4) - st * (space / 2);
      for (let l = 0; l < 5; l++) g.fillRect(space * 2, lineY(l), W - space * 4, lt);
      let x = space * 3;
      x += put(GLYPH[from], x, lineY(ANCHOR[from])) + space * 1.2;
      const startX = x;
      const gap = (W - space * 3 - startX) / perSystem;
      let clef = from;
      for (let i = 0; i < perSystem; i++) {
        const cx = startX + gap * (i + 0.5);
        // The change itself: a cue-sized clef standing between two notes, which
        // is how an engraver prints one.
        if (changeAt >= 0 && i === changeAt) {
          clef = to;
          put(GLYPH[to], cx - gap * 0.42, lineY(ANCHOR[to]), em * 0.72);
        }
        const st = 1 + ((s * 3 + i * 2) % 7);
        const y = stepY(st);
        const w2 = wid(G.head);
        for (let k = 10; k <= st; k += 2) g.fillRect(cx - w2 * 0.75, stepY(k), w2 * 1.5, lt);
        put(G.head, cx - w2 / 2, y);
        const up = st < 4;
        g.fillRect(up ? cx + w2 / 2 - lt : cx - w2 / 2, up ? y - space * 3.2 : y, Math.max(1, lt), space * 3.2);
        truth.push({ x: cx / W, y: y / H, midi: midiOf(BOTTOM[clef] + st) });
      }
    }
    if (!camera) return { canvas: c, truth, W, H };
    const o2 = document.createElement('canvas');
    o2.width = W; o2.height = H;
    const o = o2.getContext('2d');
    o.filter = 'blur(0.6px) contrast(0.9) brightness(1.04)';
    o.drawImage(c, 0, 0);
    return { canvas: o2, truth, W, H };
  }

  const out = [];
  for (const [from, to] of [['bass', 'tenor'], ['tenor', 'bass'], ['treble', 'bass']]) {
    for (const changeAt of [-1, 5]) {            // -1 is the control: no change
      for (const space of [12, 16]) {
        for (const camera of [false, true]) {
          const d = draw({ space, from, to, changeAt, camera });
          const read = readPage(d.canvas, d.W, d.H);
          const got = read ? notesInOrder(read) : [];
          const near = space * 0.6;
          let found = 0; let right = 0; let named = 0;
          for (const t of d.truth) {
            let best = null; let bd = 1e9;
            for (const f of got) {
              const dd = Math.hypot((f.x - t.x) * d.W, (f.y - t.y) * d.H);
              if (dd < near && dd < bd) { bd = dd; best = f; }
            }
            if (!best) continue;
            found++;
            if (best.midi != null) named++;
            if (best.midi === t.midi) right++;
          }
          out.push({
            from, to, changeAt, space, camera,
            truth: d.truth.length, found, named, right,
          });
        }
      }
    }
  }
  return out;
}, { b64: font });

await browser.close();

console.log('\nA CLEF THAT CHANGES MID-SYSTEM — the pitch of every note, against what it was drawn as\n');
console.log('  case                       notes  found  NAMED  RIGHT');
const line = (label, rs) => {
  const t = rs.reduce((a, r) => a + r.truth, 0);
  const f = rs.reduce((a, r) => a + r.found, 0);
  const n = rs.reduce((a, r) => a + r.named, 0);
  const g = rs.reduce((a, r) => a + r.right, 0);
  console.log(`  ${label.padEnd(26)} ${String(t).padStart(5)} ${String(f).padStart(6)} `
    + `${String(n).padStart(6)} ${String(g).padStart(6)}  ${(g / t * 100).toFixed(1)}%`);
};
for (const [from, to] of [['bass', 'tenor'], ['tenor', 'bass'], ['treble', 'bass']]) {
  line(`${from}->${to}, NO change`, rows.filter((r) => r.from === from && r.to === to && r.changeAt < 0));
  line(`${from}->${to}, changes`, rows.filter((r) => r.from === from && r.to === to && r.changeAt >= 0));
}
const ch = rows.filter((r) => r.changeAt >= 0);
const ct = rows.filter((r) => r.changeAt < 0);
console.log('');
line('every control page', ct);
line('every changing page', ch);
const wrong = ch.reduce((a, r) => a + (r.named - r.right), 0);
console.log(`\n  CONFIDENTLY WRONG on a changing page: ${wrong} notes named, and named wrongly\n`);
if (errs.length) console.log('page errors:', errs.slice(0, 3));
