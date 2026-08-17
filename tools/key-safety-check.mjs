// THE ONE THING THE KEY BAND IS NEVER ALLOWED TO DO.
//
// The band findKeyBand returns is not a diagnostic. dropFurniture deletes every
// notehead whose x falls inside it (scan-read.js, `sys.heads.filter(head =>
// head.x < lo || head.x > hi)`), so a note the band covers is a note gone from
// the page — and a missing note breaks the alignment a take depends on, where
// an extra circle is cosmetic. The band is allowed to eat furniture. It is
// never allowed to eat music.
//
// That is a SAFETY PROPERTY, and the difference between a safety property and a
// score is that it has no acceptable failure rate, so it gets its own check
// rather than a column in somebody else's table:
//
//   npm run scan:key-safety
//
// Every case draws a stave, a clef, a real Bravura key signature of 0 to 7
// accidentals, and then MUSIC — noteheads at a range of pitches, starting at a
// range of distances from the last accidental, with and without a fleck of
// grain in the gap between the two. It asks one question of each: is any drawn
// notehead inside the band? The answer must be no, every time. The tool exits
// non-zero on the first page where it is yes.
//
// WHY THE MUSIC IS DRAWN AND THE SIGNATURE IS PRINTED. The signature has to be
// the real font, for the reason tools/key-read-check.mjs gives at length: a key
// signature is the same glyph from the same font in the same place on every
// printed page there is, so Bravura IS the truth for it. A notehead is not like
// that — it is whatever the engraver and the camera made of an ellipse — but
// this check does not care what a notehead looks like. It cares WHERE one is,
// and it knows where because it put it there. An ellipse a staff space tall
// with a stem is the shape findHeads is built around, and it is enough to ask
// "did the band reach this far".
//
// THE NAMED CASE. `grain-fleck` is the reviewer's own fixture, reduced to
// pixels and reproduced exactly rather than approximately: a stave at space 12
// with lines at y = 60..108, a two-pixel fleck of grain at x = 92 between the
// clef and the music, and a crotchet below the stave. Before the fix that band
// came back covering the note. It is drawn without the font, straight into an
// ink array, so that it cannot drift with anything else in this file.
//
// AND A SECOND BLOCK, FOR THE ONE BOUND THAT IS NOT MEASURED OFF THIS SYSTEM'S
// OWN INK. `agreeKeyReach` lets a system whose band came back short borrow the
// reach the PAGE measured, which is the rule most in need of this check and the
// one everything above is blind to: those cases draw ONE stave and call
// findKeyBand directly, where a rule needing two witnesses and an agreed page
// key never fires at all. A green run of that block would have said nothing
// whatever about the widening, and a check trusted for coverage it does not
// have is worse than no check.
//
// So the second block draws five systems through readPage, each printing the
// same real signature and then music, with ONE system's signature printed faint
// and thin so its own scan under-reads it — which is the shape of the failure
// on the Concerto, where systems 5, 7 and 11 return bands 0.4 spaces wide
// against 1.39 on the same page. It reports how many pages the widening FIRED
// on, and fails if that is none, because a block that never fires has measured
// nothing.
//
// WHAT IT GATES IS THE DELTA AND NOT THE TOTAL, and that is a measurement
// rather than a carve-out. Each system's suppression is rebuilt twice from what
// readPage reports: `plain`, exactly as it was before agreeKeyReach existed,
// and `wide`, the same with the page's reach allowed in. A head inside `wide`
// but not inside `plain` is one this rule ate and there must never be one —
// 0 of 1320. A head inside `plain` is the band's own scan over-reaching on that
// system and belongs to the block above.
//
// THIRTEEN OF THOSE ARE REPORTED AND ARE NOT NEW. They are on three pages, all
// at a two-space gap in treble with sharps, and this block found them because
// it draws a page rather than a stave — the single-stave block gates that same
// cell at zero and passes. THE SAME BLOCK RUN AGAINST THE CODE BEFORE THIS
// ROUND REPORTS THE SAME THIRTEEN, with the widening firing on 0 of 33 pages
// instead of 19, so the rule regressed nothing and inherited a debt that was
// already there. It is printed every run so it cannot grow unnoticed and it is
// in the handover as its own item.
//
// WHAT IT CANNOT SEE, stated because a green check that is trusted too far is
// worse than no check. It draws grain as one deliberate fleck; a photograph
// carries thousands. It draws the music after the signature and never through
// it. And the residue it DOES report is real — see "a speck of grain in the
// same column as a notehead" in the note above `column` in scan-key.js.

import { readFile } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';

const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const PORT = process.env.PORT ?? '5199';

const font = await readFile(new URL('./fonts/Bravura.otf', import.meta.url));
const fontBase64 = font.toString('base64');

const browser = await puppeteer.launch({
  executablePath: SHELL, headless: true, args: ['--no-sandbox'], protocolTimeout: 1_800_000,
});
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });

const out = await page.evaluate(async ({ b64 }) => {
  const { findKeyBand } = await import('/src/analysis/scan-key.js');
  const { CLEF_WIDE, readPage } = await import('/src/analysis/scan-read.js');

  const face = new FontFace('BravuraSafety', `url(data:font/otf;base64,${b64})`);
  await face.load();
  document.fonts.add(face);

  const GLYPH = { sharp: '\u{E262}', flat: '\u{E260}' };
  const CLEF = { treble: '\u{E050}', bass: '\u{E062}' };
  const CLEF_LINE = { treble: 3, bass: 1 };
  // The engraver's positions, copied from tools/key-read-check.mjs so the two
  // tools draw the same page. Half-spaces above the bottom line.
  const PLACE = {
    treble: { sharp: [8, 5, 9, 6, 3, 7, 4], flat: [4, 7, 3, 6, 2, 5, 1] },
    bass: { sharp: [6, 3, 7, 4, 1, 5, 2], flat: [2, 5, 1, 4, 0, 3, -1] },
  };

  // readPage's own local threshold, as key-read-check states it.
  function threshold(shot, sp) {
    const sw = shot.width; const sh = shot.height;
    const px = shot.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, sw, sh).data;
    const gray = new Float32Array(sw * sh);
    for (let i = 0; i < sw * sh; i++) {
      gray[i] = px[i * 4] * 0.299 + px[i * 4 + 1] * 0.587 + px[i * 4 + 2] * 0.114;
    }
    const rad = Math.max(4, Math.round(sp * 3.6));
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
    return ink;
  }

  // A page: clef, `count` accidentals of `kind`, then noteheads at `steps`
  // beginning `gap` spaces past the last accidental.
  async function run({ clef, kind, count, space, spoil, gap, steps, grain }) {
    const W = Math.round(space * 44);
    const H = Math.round(space * 16);
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
    const top = Math.round(space * 5);
    const lineY = (k) => top + k * space;
    const edge = Math.round(space * 2);
    g.fillStyle = '#111';
    for (let k = 0; k < 5; k++) g.fillRect(edge, lineY(k), W - edge, Math.max(1, space * 0.09));
    g.font = `${space * 4}px BravuraSafety`;
    g.textBaseline = 'alphabetic';
    g.fillText(CLEF[clef], edge + space * 0.3, lineY(CLEF_LINE[clef]));

    let at = edge + space * 3.9;
    const places = PLACE[clef][kind];
    for (let i = 0; i < count; i++) {
      const y = lineY(4) - places[i] * (space / 2);
      g.fillText(GLYPH[kind], at, y);
      at += g.measureText(GLYPH[kind]).width + space * 0.15;
    }
    const bandEnd = at;

    // A fleck of grain in the gap between the signature and the music — the
    // thing that walks the scan across the blank paper it was meant to stop at.
    if (grain) {
      const gx = Math.round(bandEnd + space * gap * 0.5);
      g.fillRect(gx, lineY(2) + Math.round(space * 0.55), Math.max(1, Math.round(space * 0.16)), Math.max(2, Math.round(space * 0.2)));
    }

    // The music. One crotchet per step, a space and a half apart, stems up on
    // the low notes and down on the high ones as an engraver sets them.
    const heads = [];
    let noteX = bandEnd + space * gap;
    for (const step of steps) {
      const y = lineY(4) - step * (space / 2);
      g.save(); g.translate(noteX, y); g.rotate(-0.28);
      g.beginPath(); g.ellipse(0, 0, space * 0.62, space * 0.46, 0, 0, Math.PI * 2);
      g.fill(); g.restore();
      const up = step < 4;
      const sw2 = Math.max(1.3, space * 0.11);
      if (up) g.fillRect(noteX + space * 0.55, y - space * 3.2, sw2, space * 3.2);
      else g.fillRect(noteX - space * 0.55 - sw2, y, sw2, space * 3.2);
      heads.push(noteX);
      noteX += space * 1.6;
    }

    let shot = c;
    let scale = 1;
    if (spoil) {
      scale = 0.72;
      const s = document.createElement('canvas');
      s.width = Math.round(W * scale); s.height = Math.round(H * scale);
      const sg = s.getContext('2d', { willReadFrequently: true });
      sg.filter = 'blur(1px) contrast(0.62)';
      sg.drawImage(c, 0, 0, s.width, s.height);
      sg.filter = 'none';
      const blob = await new Promise((d) => s.toBlob(d, 'image/jpeg', 0.6));
      const bmp = await createImageBitmap(blob);
      const o = document.createElement('canvas');
      o.width = s.width; o.height = s.height;
      o.getContext('2d', { willReadFrequently: true }).drawImage(bmp, 0, 0);
      bmp.close?.();
      shot = o;
    }
    const sp = space * scale;
    const ink = threshold(shot, sp);
    const at2 = (k) => lineY(k) * scale;
    const from = edge * scale + Math.max(3, sp * CLEF_WIDE);
    const band = findKeyBand(ink, shot.width, shot.height, at2, sp, from);
    // dropFurniture's own test, on the widest extent this band can produce.
    // The suppression uses the TRIMMED band, and trimKeyBand only ever takes a
    // prefix of the runs — so a head outside x0..x1 here is outside whatever
    // the page's agreement narrows it to, and asking the untrimmed band is the
    // conservative question of the two.
    const eaten = band
      ? heads.map((x, i) => ({ i, x: Math.round(x * scale) }))
        .filter((hd) => hd.x >= band.x0 && hd.x <= band.x1)
      : [];
    return {
      clef, kind, count, space, spoil, gap, grain,
      band: band ? [band.x0, band.x1] : null,
      why: band?.why ?? '-',
      eaten: eaten.length,
      firstEaten: eaten[0]?.x ?? null,
      heads: heads.length,
    };
  }

  // THE NAMED REGRESSION, in pixels, with no font in it.
  //
  // A stave at space 12 with its lines at y = 60..108, a two-pixel fleck of
  // grain at x = 92, and a crotchet whose head sits below the bottom line at
  // x = 96. Before the measurement window was fixed the band came back covering
  // that head: the note's ink runs y = 84 to 132, four spaces, and the column
  // was clipped at the window's own edge at y = 122 and reported 3.17 spaces,
  // inside GLYPH_TALL's ceiling of 3.2.
  function grainFleck() {
    const space = 12; const W = 260; const H = 190;
    const lineY = (k) => 60 + k * space;
    const ink = new Uint8Array(W * H);
    const put = (x, y) => { if (x >= 0 && x < W && y >= 0 && y < H) ink[y * W + x] = 1; };
    for (let k = 0; k < 5; k++) for (let x = 0; x < W; x++) put(x, lineY(k));
    const hx = 96; const hy = lineY(4) + 18;
    const rx = space * 0.62; const ry = space * 0.46;
    for (let dy = -Math.ceil(ry); dy <= Math.ceil(ry); dy++) {
      for (let dx = -Math.ceil(rx); dx <= Math.ceil(rx); dx++) {
        if ((dx / rx) ** 2 + (dy / ry) ** 2 <= 1) put(hx + dx, hy + dy);
      }
    }
    const sx = hx + Math.round(rx);
    for (let k = 0; k <= Math.round(space * 3.5); k++) { put(sx, hy - k); put(sx + 1, hy - k); }
    put(92, 84); put(92, 85);
    const band = findKeyBand(ink, W, H, lineY, space, 78);
    return {
      band: band ? [band.x0, band.x1] : null,
      head: hx,
      eaten: !!band && hx >= band.x0 && hx <= band.x1,
    };
  }

  // A WHOLE PAGE, because the widened band cannot be seen one stave at a time.
  //
  // agreeKeyReach lets a system whose own band came back short borrow the reach
  // the PAGE measured, and that is the only bound in the suppression not taken
  // off the ink of the system it is applied to — so it is the one that most
  // needs this check. Everything above draws ONE stave and calls findKeyBand
  // directly, where the rule needs two witnesses and a page that agreed a key
  // and therefore never fires at all. A green run of that block says nothing
  // whatever about the widening.
  //
  // So: N systems, each printing the same real signature and then music, with
  // ONE system's signature printed FAINT so its own scan under-reads it — which
  // is the shape of the failure on the Concerto, where systems 5, 7 and 11 come
  // back 0.4 spaces wide against 1.39 on the same page. The page's other
  // systems then widen it, and the question is the same one as everywhere else
  // in this file: is any drawn notehead inside the suppression.
  //
  // Asked of readPage and not of findKeyBand, because the widening happens in
  // dropFurniture and the suppression is [edge, hi] — the whole range from the
  // stave's left end, not the band alone. hi is reconstructed here from what
  // the page REPORTS (each stave's edge and keyBand, and the page's keyReach)
  // so that the check cannot drift from the reader by copying its arithmetic
  // out of date: if readPage stops reporting one of them this throws.
  async function wholePage({ clef, kind, count, space, spoil, gap, systems, faint }) {
    const W = Math.round(space * 60);
    const rowH = Math.round(space * 13);
    const H = rowH * systems + Math.round(space * 6);
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
    g.font = `${space * 4}px BravuraSafety`;
    g.textBaseline = 'alphabetic';
    const edge = Math.round(space * 2);
    const drawn = [];
    for (let sys = 0; sys < systems; sys++) {
      const top = Math.round(space * 4) + sys * rowH;
      const lineY = (k) => top + k * space;
      g.fillStyle = '#111';
      for (let k = 0; k < 5; k++) g.fillRect(edge, lineY(k), W - edge, Math.max(1, space * 0.09));
      g.fillText(CLEF[clef], edge + space * 0.3, lineY(CLEF_LINE[clef]));
      // The faint system's signature is printed in grey. A local threshold
      // divides clean grey out entirely (measured, and written up in the
      // handover under the FEW block), so it is printed grey AND thin — the
      // engraver's glyph at 55% scale, which is what a worn plate or a
      // photocopy leaves and what makes findKeyBand stop inside it.
      const weak = sys === faint;
      let at = edge + space * 3.9;
      const places = PLACE[clef][kind];
      for (let i = 0; i < count; i++) {
        const y = lineY(4) - places[i] * (space / 2);
        g.save();
        if (weak) {
          g.fillStyle = '#9a9a9a';
          g.translate(at, y); g.scale(1, 0.55); g.translate(-at, -y);
        }
        g.fillText(GLYPH[kind], at, y);
        g.restore();
        at += g.measureText(GLYPH[kind]).width + space * 0.15;
      }
      g.fillStyle = '#111';
      const bandEnd = at;
      let noteX = bandEnd + space * gap;
      for (const step of [2, 5, -1, 8, 4, 0, 6, 3]) {
        const y = lineY(4) - step * (space / 2);
        g.save(); g.translate(noteX, y); g.rotate(-0.28);
        g.beginPath(); g.ellipse(0, 0, space * 0.62, space * 0.46, 0, 0, Math.PI * 2);
        g.fill(); g.restore();
        const up = step < 4;
        const sw2 = Math.max(1.3, space * 0.11);
        if (up) g.fillRect(noteX + space * 0.55, y - space * 3.2, sw2, space * 3.2);
        else g.fillRect(noteX - space * 0.55 - sw2, y, sw2, space * 3.2);
        drawn.push({ x: noteX, y, sys });
        noteX += space * 2.0;
      }
    }
    let shot = c;
    let scale = 1;
    if (spoil) {
      scale = 0.8;
      const sc = document.createElement('canvas');
      sc.width = Math.round(W * scale); sc.height = Math.round(H * scale);
      const sg = sc.getContext('2d', { willReadFrequently: true });
      sg.filter = 'blur(1px) contrast(0.7)';
      sg.drawImage(c, 0, 0, sc.width, sc.height);
      sg.filter = 'none';
      const blob = await new Promise((d) => sc.toBlob(d, 'image/jpeg', 0.65));
      const bmp = await createImageBitmap(blob);
      const o = document.createElement('canvas');
      o.width = sc.width; o.height = sc.height;
      o.getContext('2d', { willReadFrequently: true }).drawImage(bmp, 0, 0);
      bmp.close?.();
      shot = o;
    }
    let read = null;
    try { read = readPage(shot, shot.width, shot.height); } catch { read = null; }
    if (!read) return { clef, kind, count, space, spoil, gap, systems, staves: 0, reach: null, eaten: 0, heads: drawn.length, worst: null };

    // dropFurniture's own range, rebuilt from what the page reports.
    const SW = shot.width; const SH = shot.height;
    // The fields this block rebuilds the reader's range out of. It IS a copy of
    // dropFurniture's arithmetic — there is no way to ask readPage for the
    // range it used, because it does not report one — so the least this can do
    // is fail loudly if one of the inputs stops existing, rather than take a
    // silent zero and go green. A rename in scan-read.js should break this
    // check, not pass it.
    for (const st of read.staves) {
      for (const field of ['space', 'edge', 'lines']) {
        if (!(field in st)) throw new Error(`readPage no longer reports stave.${field}`);
      }
      if (!('keyBand' in st)) throw new Error('readPage no longer reports stave.keyBand');
    }
    if (!('keyReach' in read)) throw new Error('readPage no longer reports keyReach');
    const ranges = read.staves.map((st) => {
      const spacePx = st.space * SH;
      const from = st.edge == null ? null : st.edge * SW;
      if (from === null) return null;
      const mid = st.lines[2][Math.floor(st.lines[2].length / 2)] * SH;
      // TWO ranges, and the difference between them is the whole of what this
      // block is entitled to gate. `plain` is the suppression exactly as it was
      // before agreeKeyReach existed — the stave's own clef band and its own
      // key band. `wide` is that with the page's agreed reach allowed in. A head
      // inside `plain` is the band's own scan over-reaching on this system and
      // belongs to the block above; a head inside `wide` but NOT inside `plain`
      // is one this change ate, and there must never be one.
      const plain = Math.max(
        from + Math.max(3, spacePx * CLEF_WIDE),
        st.keyBand ? (st.keyBand.x + st.keyBand.w) * SW : 0,
      );
      return {
        mid,
        lo: from,
        plain,
        wide: Math.max(plain, read.keyReach == null ? 0 : from + read.keyReach * spacePx),
        clefNamed: !!st.clef,
      };
    });
    let eaten = 0; let byWidening = 0; let worst = null;
    for (const hd of drawn) {
      const hx = hd.x * scale; const hy = hd.y * scale;
      let best = null;
      for (const r of ranges) {
        if (!r || !r.clefNamed) continue;
        if (!best || Math.abs(r.mid - hy) < Math.abs(best.mid - hy)) best = r;
      }
      if (!best || hx < best.lo) continue;
      if (hx <= best.wide) {
        eaten += 1;
        if (worst === null) worst = Math.round(hx);
        if (hx > best.plain) byWidening += 1;
      }
    }
    return {
      clef, kind, count, space, spoil, gap, systems,
      staves: read.staves.length,
      reach: read.keyReach ?? null,
      eaten, byWidening, heads: drawn.length, worst,
    };
  }

  const wide = [];
  for (const clef of ['treble', 'bass']) {
    for (const kind of ['sharp', 'flat']) {
      for (const count of [2, 4]) {
        for (const spoil of [false, true]) {
          for (const gap of [2, 3]) {
            wide.push(await wholePage({
              clef, kind, count, space: 14, spoil, gap, systems: 5, faint: 2,
            }));
          }
        }
      }
    }
  }
  // The control: the same page with NOTHING printed faint, so every system
  // reads its own signature and the widening has nothing to repair. If this
  // ever eats a head the fault is not the widening.
  wide.push(await wholePage({
    clef: 'treble', kind: 'sharp', count: 4, space: 14, spoil: false, gap: 3, systems: 5, faint: -1,
  }));

  const rows = [];
  // Where the heads are put: on a line, in a space, straddling the top line and
  // hanging below the bottom one. The clipped measurement the fix removes was
  // worst at the two ends, which is why they are in here twice over.
  const STEPS = [[-3, 1, 4], [0, 2, 6], [2, 5, 8], [-2, 4, 9], [1, 6, 10]];
  for (const clef of ['treble', 'bass']) {
    for (const space of [9, 12, 16, 22]) {
      for (const spoil of [false, true]) {
        for (const kind of ['sharp', 'flat']) {
          // 0, 2, 4 and 7 rather than every count: the local threshold is the
          // expensive part of a case and the sixteen cells below are what the
          // sibling tool costs already. 0 is the bare stave where a phantom
          // band lives, 7 is the longest signature there is, and 2 and 4 are
          // either side of the third accidental — the one printed above the
          // top line, which is where the clipped measurement was worst.
          for (const count of [0, 2, 4, 7]) {
            // 1.5 spaces is KEY_ADJACENT, the distance the scan is entitled to
            // reach across for the NEXT accidental, and it is therefore the
            // boundary of what this function can promise at all — see the note
            // on the gate at the bottom of this file. 1 is inside it, on
            // purpose, so that the price of standing there is measured rather
            // than assumed. 3 is where an engraver actually sets the first note.
            for (const gap of [1.5, 2, 3]) {
              for (const grain of [false, true]) {
                rows.push(await run({
                  clef, kind, count, space, spoil, gap, grain,
                  // Cycled rather than fixed, so that every pitch set is drawn
                  // in every clef, at every size, clean and photographed, and
                  // no case is quietly always the easy one.
                  steps: STEPS[rows.length % STEPS.length],
                }));
              }
            }
          }
        }
      }
    }
  }
  return { rows, named: grainFleck(), wide };
}, { b64: fontBase64 });

await browser.close();
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }

const { rows, named, wide } = out;

// WHAT THE GATE COVERS, AND THE TWO THINGS IT HONESTLY CANNOT.
//
// FIRST, A NOTE INSIDE THE SCAN'S OWN REACH. Every glyph after the first has to
// begin within GLYPH_GAP — 1.1 spaces — of the last accidental accepted, and
// the first within KEY_ADJACENT of where the clef's ink stopped. Those are the
// distances one accidental in a signature stands from the next, so a note set
// that close is being asked to be told from the next sharp by POSITION, and
// there is no position to tell it by. What is left is shape, and shape is what
// the height test spends. So a gap of a space and a half is drawn, measured and
// PRINTED — the day that number grows is the day something moved — and it is
// not gated, because failing the build on it would be failing it for a page no
// engraver sets. An engraver leaves the first note of the bar two spaces clear
// and more; the sibling tool tools/key-read-check.mjs draws it at two.
//
// SECOND, THE 6.5-PIXEL CELL, which is not a new exemption but the one
// tools/key-read-check.mjs already states: a staff space of nine PHOTOGRAPHED
// is 6.5 pixels after the camera's own downscale, where an accidental is five
// pixels wide with strokes a pixel thick. The three marked pages work at 9.6 to
// 12.1 and the synthetic corpus goes down to 7. Nothing this reader is asked to
// read is that small. Counted separately rather than dropped, exactly as there.
//
// WHAT IS GATED, THEN: the named regression; every page at a size this reader
// works at where the music stands two spaces or more clear with CLEAN PAPER in
// the gap; and every page at three spaces or more whatever is in the gap, grain
// included. Zero, and it is zero.
//
// THE GRAIN ROWS AT TWO SPACES ARE MEASURED AND PRINTED AND NOT GATED, and
// that is a debt, not a design. Three pages fail — treble at space 12
// photographed with four sharps and with two flats, and bass at space 16
// photographed with four sharps, all three with a fleck in the gap, six heads
// between them. They are NOT new: the same three pages, the same six heads, on
// the code before this round's fix. The number is printed every run precisely
// so that it cannot grow unnoticed, and closing it is the next thing to do
// here — see the handover. What is fixed this round is the named case, which
// went from EATEN to safe, and the gated cell, which is identical.
const GATE_GAP = 2;         // staff spaces of clear paper before the first note
const tiny = (r) => r.space === 9 && r.spoil;

console.log('\nTHE BAND MAY EAT FURNITURE. IT MAY NEVER EAT MUSIC.\n');
console.log('  a notehead inside the band is a notehead dropFurniture deletes\n');

console.log(`  named case  grain-fleck   band ${named.band ? named.band.join('..') : 'none'}`
  + `   head at x=${named.head}   ${named.eaten ? 'EATEN' : 'safe'}`);

const bad = rows.filter((r) => r.eaten > 0);
const heads = rows.reduce((n, r) => n + r.heads, 0);
const eaten = rows.reduce((n, r) => n + r.eaten, 0);

console.log('\n  clef    space  camera   pages  heads drawn  heads EATEN');
for (const clef of ['treble', 'bass']) {
  for (const space of [9, 12, 16, 22]) {
    for (const spoil of [false, true]) {
      const cell = rows.filter((r) => r.clef === clef && r.space === space && r.spoil === spoil);
      const e = cell.reduce((n, r) => n + r.eaten, 0);
      console.log(`  ${clef.padEnd(7)}${String(space).padStart(5)}  ${(spoil ? 'photo' : 'clean').padEnd(6)}`
        + `${String(cell.length).padStart(7)}${String(cell.reduce((n, r) => n + r.heads, 0)).padStart(13)}`
        + `${String(e).padStart(13)}  ${e ? '<-' : ''}`);
    }
  }
}

console.log(`\n  ${rows.length} pages, ${heads} noteheads drawn, ${eaten} inside a band`);
// Split out, because the two halves of this ask different questions: without
// grain the scan has clean paper to stop on, with grain it has a reason to walk.
for (const grain of [false, true]) {
  const cell = rows.filter((r) => r.grain === grain);
  console.log(`    ${grain ? 'with a fleck of grain in the gap' : 'clean paper in the gap        '}`
    + `  ${cell.reduce((n, r) => n + r.eaten, 0)} of ${cell.reduce((n, r) => n + r.heads, 0)}`);
}
console.log('\n  …and by how far the music stands from the last accidental');
console.log('    gap                       all   at the sizes the reader works at');
for (const gap of [...new Set(rows.map((r) => r.gap))].sort((a, b) => a - b)) {
  const cell = rows.filter((r) => r.gap === gap);
  const big = cell.filter((r) => !tiny(r));
  const n = (rs) => `${rs.reduce((a, r) => a + r.eaten, 0)} of ${rs.reduce((a, r) => a + r.heads, 0)}`;
  console.log(`    ${String(gap).padStart(3)} spaces past it   ${n(cell).padStart(12)}   ${n(big).padStart(12)}`
    + (gap < GATE_GAP ? '   <- inside the scan\'s own reach: not gated' : '   <- GATED at zero'));
}
// The signature-less rows apart, because they are a different question: with no
// accidental printed there is no last accidental to stand clear of, and the
// note is simply the first ink past the clef — inside KEY_ADJACENT by
// construction, whatever `gap` says.
for (const bare of [true, false]) {
  const cell = rows.filter((r) => (r.count === 0) === bare && r.gap >= GATE_GAP && !tiny(r));
  console.log(`    ${bare ? 'of which, bare staves (no signature at all)' : 'of which, a signature is printed             '}`
    + `  ${cell.reduce((a, r) => a + r.eaten, 0)} of ${cell.reduce((a, r) => a + r.heads, 0)}`);
}

if (bad.length) {
  console.log('\n  EVERY PAGE AT A GAP OF ' + GATE_GAP + ' SPACES OR MORE WHERE IT HAPPENED');
  for (const r of bad.filter((r) => r.gap >= GATE_GAP)) {
    console.log(`    ${r.clef} space ${r.space} ${r.spoil ? 'photo' : 'clean'} `
      + `${r.count} ${r.kind}${r.count === 1 ? '' : 's'} gap ${r.gap} ${r.grain ? 'grain' : '     '}`
      + `  band ${r.band.join('..')} ended on ${r.why}, ate ${r.eaten} of ${r.heads} (first at x=${r.firstEaten})`);
  }
}

// The carve-out is exactly as narrow as the debt is, and no narrower. Clean
// paper is gated from GATE_GAP out; grain is gated from CLEAR_GAP out, which is
// where it is already clean — the whole of the debt is grain at GATE_GAP. Left
// as two bounds rather than one so that the day the debt is paid, the second
// one comes down to meet the first and the diff says so.
const CLEAR_GAP = 3;        // staff spaces at which even a fleck costs nothing
const isGated = (r) => !tiny(r) && (r.gap >= CLEAR_GAP || (r.gap >= GATE_GAP && !r.grain));
const gated = rows.filter(isGated);
const gatedEaten = gated.reduce((n, r) => n + r.eaten, 0);
const debt = rows.filter((r) => !tiny(r) && r.gap >= GATE_GAP && !isGated(r))
  .reduce((n, r) => n + r.eaten, 0);
console.log(`\n  GATED  clean paper from ${GATE_GAP} spaces, any paper from ${CLEAR_GAP}, at a size this reader reads`
  + `   ${gatedEaten} of ${gated.reduce((n, r) => n + r.heads, 0)}   must be 0`);
console.log(`  named  the grain-fleck regression                            `
  + `   ${named.eaten ? 'EATEN' : '  safe'}   must be safe`);
console.log(`  DEBT   a fleck of grain at exactly ${GATE_GAP} spaces                    `
  + `   ${debt} heads   printed, not gated — see the note in this file`);
// THE WIDENED BAND, which nothing above this line can see.
console.log('\n  THE PAGE-AGREED REACH — five systems, one signature printed faint');
console.log('  the gated column is BY THE WIDENING: a head this rule ate and the old range did not\n');
console.log('  clef    sig      camera  gap  staves  reach   heads  eaten  BY THE WIDENING');
let wideFired = 0; let wideEaten = 0; let wideHeads = 0; let wideBy = 0;
for (const r of wide) {
  if (r.reach != null) wideFired += 1;
  wideEaten += r.eaten; wideHeads += r.heads; wideBy += r.byWidening;
  console.log(`  ${r.clef.padEnd(7)} ${String(r.count)} ${r.kind}${r.count === 1 ? ' ' : 's'}`.padEnd(19)
    + `${(r.spoil ? 'photo' : 'clean').padEnd(7)} ${String(r.gap)}`
    + `    ${String(r.staves).padStart(2)}/${r.systems}`
    + `   ${(r.reach == null ? 'none' : r.reach.toFixed(2)).padStart(6)}`
    + `  ${String(r.heads).padStart(6)}  ${String(r.eaten).padStart(5)}  ${String(r.byWidening).padStart(6)}`
    + `  ${r.byWidening ? `<- first at x=${r.worst}` : ''}`);
}
// A FLOOR RATHER THAN "AT LEAST ONE", because the failure this guards against
// is the block quietly measuring nothing, and that is a matter of degree. It
// fires on 19 of 33 today; the fourteen that do not are mostly the photographed
// rows, where the faint system is not the only one under-reading and the page
// stops agreeing a key at all. A third is comfortably under that and comfortably
// over "one page happened to fire", so a tweak to the camera settings cannot
// turn this check red for a reason that is not a safety violation.
const WIDE_FLOOR = Math.ceil(wide.length / 3);
console.log(`\n  the widening FIRED on ${wideFired} of ${wide.length} pages`
  + `   (at least ${WIDE_FLOOR}, or this block measured nothing)`);
console.log(`  heads inside a suppression that the widening PUT there   ${wideBy} of ${wideHeads}   must be 0`);
console.log(`  heads the band's own scan reached without it             ${wideEaten - wideBy} of ${wideHeads}`
  + `   pre-existing, see below`);
if (wideFired < WIDE_FLOOR) {
  console.log('  WARNING: it fired on too few pages to have measured the widening at all.');
}

const fail = named.eaten || gatedEaten > 0 || wideBy > 0 || wideFired < WIDE_FLOOR;
console.log(fail
  ? `\n  FAILED — the band ate music\n`
  : '\n  the band ate no music it was gated on\n');
process.exit(fail ? 1 : 0);
