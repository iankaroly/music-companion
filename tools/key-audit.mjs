// How wide and how tall is an accidental, and does that tell it from a note?
//
// findKeyBand walks right from the end of the clef and stops at the first thing
// which is not an accidental. That termination is the whole reason it is safe —
// the rule it replaced recognised a key signature by its being printed in the
// same place on every system, could not tell "printed twice" from "played
// twice", and took four to eight points of recall off the corpus. A scan that
// stops at the first non-accidental cannot reach into the music at all.
//
// But "is not an accidental" is a pair of numbers, and the first pair were
// guessed. They were wrong by four hundredths of a space: a real sharp measures
// 1.24 spaces across and the bound said 1.15, so the scan rejected every key
// signature on the page and the filter quietly did nothing.
//
// So this measures them, on real Bravura, spoiled the way a camera spoils a
// page, at the sizes a photograph actually produces. It prints what a sharp, a
// flat and a natural measure — and what a NOTEHEAD measures, because that is
// the thing the bounds have to exclude and the only mistake here that costs a
// note.
//
//   npm run scan:key
//
import { readFile } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';

const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const PORT = process.env.PORT ?? '5199';

const font = await readFile(new URL('./fonts/Bravura.otf', import.meta.url));
const fontBase64 = font.toString('base64');
const GLYPH = { sharp: '\u{E262}', flat: '\u{E260}', natural: '\u{E261}' };

const browser = await puppeteer.launch({ executablePath: SHELL, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1200, height: 900, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });

const rows = await page.evaluate(async ({ glyph, b64 }) => {
  const face = new FontFace('BravuraKey', `url(data:font/otf;base64,${b64})`);
  await face.load();
  document.fonts.add(face);

  // One object on one stave, drawn, photographed, and measured the way
  // findKeyBand measures — column by column, with the stave's own lines left
  // out, because a staff line runs the width of the page and would otherwise
  // make every column five lines tall.
  async function measure(what, space, spoil) {
    const W = Math.round(space * 14);
    const H = Math.round(space * 14);
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
    const top = Math.round(space * 5);
    const lineY = (k) => top + k * space;
    g.fillStyle = '#111';
    for (let k = 0; k < 5; k++) g.fillRect(0, lineY(k), W, Math.max(1, space * 0.09));
    const at = Math.round(space * 6);
    if (what === 'notehead') {
      const y = lineY(2);
      g.save(); g.translate(at + space * 0.6, y); g.rotate(-0.28);
      g.beginPath(); g.ellipse(0, 0, space * 0.62, space * 0.46, 0, 0, Math.PI * 2);
      g.fill(); g.restore();
      g.fillRect(at + space * 0.6 + space * 0.55, y - space * 3.2, Math.max(1.3, space * 0.11), space * 3.2);
    } else {
      // Bravura is designed so one em is one stave — four spaces.
      g.font = `${space * 4}px BravuraKey`;
      g.textBaseline = 'alphabetic';
      g.fillText(glyph[what], at, lineY(3));
    }

    let shot = c;
    if (spoil) {
      const s = document.createElement('canvas');
      const scale = 0.72;
      s.width = Math.round(W * scale); s.height = Math.round(H * scale);
      const sg = s.getContext('2d', { willReadFrequently: true });
      sg.filter = 'blur(1px) contrast(0.62)';
      sg.drawImage(c, 0, 0, s.width, s.height);
      sg.filter = 'none';
      const blob = await new Promise((d) => s.toBlob(d, 'image/jpeg', 0.6));
      const bmp = await createImageBitmap(blob);
      const out = document.createElement('canvas');
      out.width = s.width; out.height = s.height;
      out.getContext('2d', { willReadFrequently: true }).drawImage(bmp, 0, 0);
      bmp.close?.();
      shot = out;
    }
    const scale = shot.width / W;
    const sp = space * scale;
    const sw = shot.width; const sh = shot.height;
    const px = shot.getContext('2d', { willReadFrequently: true })
      .getImageData(0, 0, sw, sh).data;
    const gray = new Float32Array(sw * sh);
    for (let i = 0; i < sw * sh; i++) {
      gray[i] = px[i * 4] * 0.299 + px[i * 4 + 1] * 0.587 + px[i * 4 + 2] * 0.114;
    }
    // The reader's own local threshold, in miniature.
    const rad = Math.max(4, Math.round(sw / 8));
    const ink = new Uint8Array(sw * sh);
    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        let sum = 0; let n = 0;
        for (let dy = -rad; dy <= rad; dy += 3) {
          for (let dx = -rad; dx <= rad; dx += 3) {
            const yy = Math.min(sh - 1, Math.max(0, y + dy));
            const xx = Math.min(sw - 1, Math.max(0, x + dx));
            sum += gray[yy * sw + xx]; n++;
          }
        }
        ink[y * sw + x] = gray[y * sw + x] < sum / n - 16 ? 1 : 0;
      }
    }
    const lines = [0, 1, 2, 3, 4].map((k) => Math.round(lineY(k) * scale));
    const tol = Math.max(1, Math.round(sp * 0.16));
    const onLine = (y) => lines.some((L) => Math.abs(y - L) <= tol);
    const bandTop = Math.max(0, Math.round(lines[0] - sp * 1.2));
    const bandBottom = Math.min(sh - 1, Math.round(lines[4] + sp * 1.2));
    const column = (x) => {
      let first = -1; let last = -1;
      for (let y = bandTop; y <= bandBottom; y++) {
        if (!ink[y * sw + x] || onLine(y)) continue;
        if (first < 0) first = y;
        last = y;
      }
      return first < 0 ? null : { first, last };
    };
    let x0 = -1; let x1 = -1; let hi = sh; let lo = 0; let blank = 0;
    for (let x = Math.round(at * scale) - Math.round(sp); x < sw; x++) {
      const col = column(x);
      if (col) {
        if (x0 < 0) x0 = x;
        x1 = x; blank = 0;
        hi = Math.min(hi, col.first); lo = Math.max(lo, col.last);
      } else if (x0 >= 0 && ++blank > 1) break;
    }
    if (x0 < 0) return null;
    return { wide: +((x1 - x0 + 1) / sp).toFixed(2), tall: +((lo - hi + 1) / sp).toFixed(2) };
  }

  const out = [];
  for (const what of ['sharp', 'flat', 'natural', 'notehead']) {
    for (const space of [9, 12, 16, 22]) {
      for (const spoil of [false, true]) {
        const m = await measure(what, space, spoil);
        out.push({ what, space, spoil, ...(m ?? { wide: null, tall: null }) });
      }
    }
  }
  return out;
}, { glyph: GLYPH, b64: fontBase64 });

await browser.close();

console.log('\nACCIDENTALS AND NOTEHEADS — real Bravura, clean and photographed\n');
console.log('  what       space  camera   wide   tall');
for (const r of rows) {
  console.log(`  ${r.what.padEnd(10)} ${String(r.space).padStart(5)}  ${(r.spoil ? 'photo' : 'clean').padEnd(6)}`
    + `  ${String(r.wide).padStart(5)}  ${String(r.tall).padStart(5)}`);
}

const of = (what) => rows.filter((r) => r.what === what && r.wide !== null);
const span = (rs, k) => `${Math.min(...rs.map((r) => r[k])).toFixed(2)}–${Math.max(...rs.map((r) => r[k])).toFixed(2)}`;
console.log('\n  what        wide across all       tall across all');
for (const what of ['sharp', 'flat', 'natural', 'notehead']) {
  const rs = of(what);
  if (!rs.length) continue;
  console.log(`  ${what.padEnd(10)}  ${span(rs, 'wide').padEnd(20)}  ${span(rs, 'tall')}`);
}
const acc = [...of('sharp'), ...of('flat'), ...of('natural')];
const note = of('notehead');
console.log(`\n  an accidental is ${span(acc, 'wide')} wide and ${span(acc, 'tall')} tall`);
console.log(`  a notehead is    ${span(note, 'wide')} wide and ${span(note, 'tall')} tall`);
const wideOk = Math.max(...acc.map((r) => r.wide)) < Math.min(...note.map((r) => r.wide));
const tallOk = Math.max(...acc.map((r) => r.tall)) < Math.min(...note.map((r) => r.tall));
console.log(`\n  width separates them: ${wideOk ? 'YES' : 'no'}`);
console.log(`  height separates them: ${tallOk ? 'YES' : 'no'}\n`);
if (errors.length) console.log('page errors:', errors.slice(0, 3));
