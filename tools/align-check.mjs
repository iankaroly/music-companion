// WHICH NOTEHEAD DID THE TAKE LAND ON — the first measurement of the alignment.
//
// WHY THIS EXISTS
//
// Everything in this repo measures the READER: where a circle sits (`bench`),
// what a head is called against the printed lines (`scan:steps`), what it is
// called against a MusicXML file (`scan:studies`). Nothing measured the next
// step, which is the one the app is actually for — a recording arrives, and
// every note of it has to be put on the notehead it was played from. That is
// `pairNotes` in src/ui/scan-view.js, and until this file it had seven unit
// tests over a hand-made array of steps and no number at all against a page.
//
// It needed one because of a specific bug. `headsOf` priced every head with
// `pitchOf(note.step, note.clef, NO_KEY)` — the reference handed to the
// aligner was the page read AS IF IN C MAJOR, on a corpus where two thirds of
// the studies are in something else. `notesInOrder` had been returning a fully
// priced `midi` (clef in force, page key, and the bar's own accidentals) since
// the signature reader landed, and `headsOf` threw it away and recomputed a
// worse one.
//
//   npm run scan:align -- [--dir ~/Downloads/cello-studies] [--takes 4]
//                         [--seed 11] [--space 14] [--phone] [--only <name>]
//   npm run scan:align -- --real          the three marked photographs, coverage only
//
// HOW IT MEASURES, and why it is built this way
//
// The player plays WHAT IS WRITTEN, so the take is synthesised from the
// MusicXML — exact pitches, nothing to do with what the reader saw. The
// reference is what the reader read off its own engraving of that file. Those
// are two different things and that is the whole point: a take built out of
// `notesInOrder`'s own midi would be wrong in exactly the places the reference
// is wrong, the two errors would cancel, and the instrument would report a
// perfect score for a reader that cannot name a note. That tautology is the
// trap this file was designed around.
//
// "The right notehead" is defined by POSITION and not by pitch: each MusicXML
// note is paired to the read head nearest to where it was drawn (the same
// nearest-neighbour pairing tools/study-check.mjs uses), so the answer to
// "which head should this played note have landed on" is settled by the
// engraver's own fillText coordinates before any pitch is consulted.
//
// BEFORE AND AFTER IN ONE RUN. The shipped `headsOf` supplies the AFTER
// reference; the BEFORE is reconstructed from that same output by re-pricing
// each head through `pitchOf(step, clef, NO_KEY)`, which is character for
// character what the line that was removed did. So one command prints both,
// on identical takes, and there is no edit-run-revert-run dance in which the
// two halves could drift apart.
//
// WHAT IS AND IS NOT NOISE. `alignScore` reads `.midi` and nothing else, so
// cents error and timing jitter do no work here — they are on the played notes
// because a mark carries the note through to the review and the objects should
// be the shape the rest of the app expects, not because they stress anything.
// What stresses the aligner is dropped notes, inserted squeaks, the occasional
// wrong note, and a take that begins somewhere other than the top of the page.
// The RNG is seeded, so before and after see byte-identical takes.
//
// WHAT THIS IS NOT. The pages are this repo's own engraving, so it shares
// tools/engrave.mjs's blind spots — one notehead font, one layout algorithm,
// no publisher's furniture. AND ITS PAGES ARE ONE TO THREE SYSTEMS LONG, which
// is the shape agreeKey cannot get a quorum on: read the route column, not only
// the percentage, or a page-level key rule will look like an alignment result.
//
// There is no per-note pitch truth for the three photographs, so placement on
// real paper cannot be scored this way at all. `--real` therefore asks the one
// question about them that needs no truth file — how many heads reach the
// aligner with a pitch on them at all, before and after — because a head with
// no pitch is dropped from the aligner's window entirely, and that is the way
// this change can hurt a real page.

import { readFile, readdir } from 'node:fs/promises';
import { join, resolve, basename } from 'node:path';
import puppeteer from 'puppeteer-core';

const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const PORT = process.env.PORT ?? '5199';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : fallback;
};
const dir = resolve(flag('dir', `${process.env.HOME}/Downloads/cello-studies`));
const phone = args.includes('--phone');
const space = Number(flag('space', 14));
const takes = Number(flag('takes', 4));
const seed0 = Number(flag('seed', 11));
const only = flag('only', null);
// HOW MANY OF THE PAGE'S NOTEHEADS THE READER NEVER FOUND — the user's page,
// modelled. A real phone scan of a real edition came back with about half its
// notes, and the complaint was not the missing half: it was that pressing a
// ring played a moment from somewhere else entirely. This drops a seeded
// fraction of the heads from the REFERENCE before the pairing runs, which is
// exactly what a page read at 50% hands the aligner. A played note whose own
// head was dropped is counted apart (`lost`) and left out of the score, so what
// this measures is the notes that COULD still be placed.
const miss = Number(flag('miss', 0));
// THE PAGE WHOSE CLEF OR KEY WOULD NOT READ — every head unpriced, which sends
// pairNotes down the CONTOUR route (pairByShape, and then `positional` when the
// estimated pitches do not fit). That is the route a phone photograph of a real
// edition takes when the reader cannot establish a key on it, and nothing in
// this repo had ever scored WHERE its marks land.
const unpriced = args.includes('--unpriced');
const wantJson = args.includes('--json');

// --- MusicXML, only as much of it as a scale study uses ---------------------
//
// Lifted from tools/study-check.mjs rather than shared. Every tool in this
// directory is self-contained on purpose: the harness that GENERATES the page
// must not import the reader's idea of anything, and a shared helper is one
// refactor away from doing exactly that.
const LETTERS = 'CDEFGAB';
const SEMIS = [0, 2, 4, 5, 7, 9, 11];
const tag = (xml, name) => {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
  return m ? m[1] : null;
};
const all = (xml, name) => [...xml.matchAll(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'g'))]
  .map((m) => m[1]);

function parseStudy(xml) {
  const measures = all(xml, 'measure');
  const fifths = Number(tag(xml, 'fifths') ?? 0);
  const sign = tag(xml, 'sign') ?? 'G';
  const line = Number(tag(xml, 'line') ?? 2);
  const beats = Number(tag(xml, 'beats') ?? 4);
  const clef = sign === 'F' ? 'bass' : (sign === 'C' && line === 4) ? 'tenor' : 'treble';
  const bars = measures.map((m) => all(m, 'note').map((n) => {
    if (/<rest\s*\/?>/.test(n)) return { rest: true, duration: Number(tag(n, 'duration') ?? 1) };
    const step = tag(n, 'step');
    const octave = Number(tag(n, 'octave') ?? 4);
    const alter = Number(tag(n, 'alter') ?? 0);
    return {
      letter: step,
      octave,
      alter,
      duration: Number(tag(n, 'duration') ?? 1),
      type: tag(n, 'type') ?? 'quarter',
      midi: (octave + 1) * 12 + SEMIS[LETTERS.indexOf(step)] + alter,
      degree: octave * 7 + LETTERS.indexOf(step),
    };
  }));
  return { fifths, clef, beats, bars, title: tag(xml, 'work-title') ?? '' };
}

const SHARP_ORDER = [3, 0, 4, 1, 5, 2, 6];
const FLAT_ORDER = [6, 2, 5, 1, 4, 0, 3];
function keyAlter(fifths) {
  const alter = [0, 0, 0, 0, 0, 0, 0];
  const order = fifths >= 0 ? SHARP_ORDER : FLAT_ORDER;
  for (let i = 0; i < Math.abs(fifths); i++) alter[order[i]] = fifths >= 0 ? 1 : -1;
  return alter;
}
const BOTTOM = { bass: 2 * 7 + 4, tenor: 3 * 7 + 1, treble: 4 * 7 + 2 };

// --- the three real photographs, which have no per-note pitch truth ---------
//
// `--real` answers ONE question, and it is the question the engraved corpus
// cannot answer: on a page that is actually a photograph, how many of the
// heads handed to the aligner carry a pitch at all? That is not a judgement
// and needs no truth file — a head is priced or it is not — and it is what
// decides whether pricing off the read key is safe on real paper, because a
// null-priced head is FILTERED OUT of the aligner's window entirely.
//
// It deliberately does NOT score which notehead a take landed on. There is no
// pitch truth for these pages, so the only take that could be built is one
// synthesised from the reader's own reading, and scoring the AFTER reference
// against a take built out of the AFTER reference is a tautology. The
// engraved studies are where placement is scored.
if (args.includes('--real')) {
  const index = JSON.parse(await readFile(new URL('../pages/index.json', import.meta.url), 'utf8'));
  const browser = await puppeteer.launch({ executablePath: SHELL, headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 1800, deviceScaleFactor: 1 });
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
  await new Promise((r) => setTimeout(r, 1600));
  const rows = [];
  for (const entry of index) {
    const b64 = (await readFile(entry.file)).toString('base64');
    const out = await page.evaluate(async ({ b64, pdf }) => {
      // The app's own path to pixels — the same one tools/truth-check.mjs uses.
      // sips and pdf.js do not agree and the reader can tell.
      const binary = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
      let source;
      if (pdf) {
        const pdfjs = await import('/node_modules/pdfjs-dist/build/pdf.mjs');
        pdfjs.GlobalWorkerOptions.workerSrc = '/node_modules/pdfjs-dist/build/pdf.worker.mjs';
        const doc = await pdfjs.getDocument({ data: binary }).promise;
        const first = await doc.getPage(1);
        const scale = 1800 / first.getViewport({ scale: 1 }).width;
        const viewport = first.getViewport({ scale });
        source = document.createElement('canvas');
        source.width = viewport.width; source.height = viewport.height;
        await first.render({ canvasContext: source.getContext('2d'), viewport }).promise;
      } else {
        const bitmap = await createImageBitmap(new Blob([binary]));
        source = document.createElement('canvas');
        source.width = bitmap.width; source.height = bitmap.height;
        source.getContext('2d').drawImage(bitmap, 0, 0);
        bitmap.close?.();
      }
      const W = Math.min(1400, source.width);
      const work = document.createElement('canvas');
      work.width = W;
      work.height = Math.round(source.height * (W / source.width));
      work.getContext('2d').drawImage(source, 0, 0, work.width, work.height);

      const R = await import('/src/analysis/scan-read.js');
      const V = await import('/src/ui/scan-view.js');
      const N = await import('/src/analysis/scan-notes.js');
      const K = await import('/src/analysis/scan-key.js');
      const read = R.readPage(work, work.width, work.height);
      if (!read) return { failed: 'no stave' };
      const after = V.headsOf([read]);
      const before = after.map((h) => N.pitchOf(h.step, h.clef, K.NO_KEY)?.midi ?? null);
      const staves = read.staves.length;
      return {
        heads: after.length,
        pricedBefore: before.filter((m) => Number.isFinite(m)).length,
        pricedAfter: after.filter((h) => Number.isFinite(h.midi)).length,
        pageKey: read.key ? (read.key.sharps ? read.key.sharps : -read.key.flats) : null,
        pageKeyKind: read.key?.kind ?? null,
        keySource: read.keySource ?? null,
        staves,
        stavesWithKey: read.staves.filter((s) => s.key).length,
        clefs: read.staves.filter((s) => s.clef).length,
      };
    }, { b64, pdf: /\.pdf$/i.test(entry.file) });
    rows.push({ name: entry.name, ...out });
  }
  await browser.close();
  console.log('\nTHE THREE PHOTOGRAPHS — how many heads reach the aligner with a pitch on them');
  console.log('No pitch truth exists for these pages, so this counts COVERAGE and nothing else.\n');
  console.log('  page          staves  clefs  staves w/ key  page key   heads   priced NO_KEY   priced from the read key');
  for (const r of rows) {
    if (r.failed) { console.log(`  ${r.name.padEnd(12)}  ${r.failed}`); continue; }
    console.log(`  ${r.name.padEnd(12)}  ${String(r.staves).padStart(6)}  ${String(r.clefs).padStart(5)}`
      + `  ${`${r.stavesWithKey}/${r.staves}`.padStart(13)}`
      + `  ${String(r.pageKey ?? '—').padStart(4)}${r.pageKeyKind ? ` ${r.pageKeyKind}` : ''}`.padEnd(12)
      + `  ${String(r.heads).padStart(5)}   ${String(r.pricedBefore).padStart(13)}   ${String(r.pricedAfter).padStart(24)}`);
  }
  console.log('');
  process.exit(0);
}

const files = (await readdir(dir))
  .filter((f) => /\.musicxml$/i.test(f))
  .filter((f) => !only || f.toLowerCase().includes(only.toLowerCase()))
  .sort();
if (!files.length) {
  console.log(`no .musicxml under ${dir}`);
  process.exit(1);
}

const font = (await readFile(new URL('./fonts/Bravura.otf', import.meta.url))).toString('base64');
const browser = await puppeteer.launch({ executablePath: SHELL, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1500, height: 2000 });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 1500));

const results = [];
for (const file of files) {
  const study = parseStudy(await readFile(join(dir, file), 'utf8'));
  const out = await page.evaluate(async ({
    b64, study, space, phone, keyAlterArr, bottomDeg, takes, seed0, miss, unpriced,
  }) => {
    const face = new FontFace('Bravura', `url(data:font/otf;base64,${b64})`);
    await face.load();
    document.fonts.add(face);
    const G = {
      black: '\u{E0A4}', half: '\u{E0A3}', whole: '\u{E0A2}',
      gClef: '\u{E050}', fClef: '\u{E062}', cClef: '\u{E05C}',
      sharp: '\u{E262}', flat: '\u{E260}', natural: '\u{E261}',
    };
    const ANCHOR = { treble: 3, bass: 1, tenor: 1 };
    const CLEF_GLYPH = { treble: G.gClef, bass: G.fClef, tenor: G.cClef };
    const SHARP_STEPS = { treble: [8, 5, 9, 6, 3, 7, 4], bass: [6, 3, 7, 4, 1, 5, 2], tenor: [7, 4, 8, 5, 2, 6, 3] };
    const FLAT_STEPS = { treble: [4, 7, 3, 6, 2, 5, 1], bass: [2, 5, 1, 4, 0, 3, -1], tenor: [3, 6, 2, 5, 1, 4, 0] };

    // --- engrave the study, exactly as tools/study-check.mjs does -----------
    const perSystem = 4;
    const systems = Math.ceil(study.bars.length / perSystem);
    const W = Math.round(space * 62);
    const H = Math.round(space * (10 + systems * 13 + 6));
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#111';
    const em = space * 4;
    const put = (ch, x, y) => { g.font = `${em}px Bravura`; g.textBaseline = 'alphabetic'; g.fillText(ch, x, y); return g.measureText(ch).width; };
    const wid = (ch) => { g.font = `${em}px Bravura`; return g.measureText(ch).width; };
    const lineThick = Math.max(1, space * 0.1);

    const truth = [];
    for (let sys = 0; sys < systems; sys++) {
      const base = space * 8 + sys * space * 13;
      const lineY = (l) => base + l * space;
      const stepY = (st) => lineY(4) - st * (space / 2);
      for (let l = 0; l < 5; l++) g.fillRect(space * 2, lineY(l), W - space * 4, lineThick);
      let x = space * 3;
      x += put(CLEF_GLYPH[study.clef], x, lineY(ANCHOR[study.clef])) + space * 0.5;
      const n = Math.abs(study.fifths);
      if (n) {
        const steps = (study.fifths >= 0 ? SHARP_STEPS : FLAT_STEPS)[study.clef];
        const glyph = study.fifths >= 0 ? G.sharp : G.flat;
        for (let k = 0; k < n; k++) x += put(glyph, x, stepY(steps[k])) + space * 0.06;
        x += space * 0.6;
      }
      const startX = x + space;
      const bars = study.bars.slice(sys * perSystem, (sys + 1) * perSystem);
      const usable = (W - space * 3) - startX;
      const barW = usable / Math.max(1, bars.length);
      for (const [bi, bar] of bars.entries()) {
        const bx = startX + bi * barW;
        if (bi) g.fillRect(bx - space * 0.3, lineY(0), Math.max(1, lineThick * 1.2), lineY(4) - lineY(0));
        const gap = barW / Math.max(1, bar.length + 0.6);
        // What is in force on each line and space, this bar — see the long note
        // in tools/study-check.mjs. A printed accidental holds to the barline,
        // so a note that agrees with the key but follows an inflection of its
        // own degree needs a cancelling natural drawn in front of it.
        const inBar = new Map();
        const inForce = (degree) => (inBar.has(degree)
          ? inBar.get(degree)
          : keyAlterArr[((degree % 7) + 7) % 7]);
        for (const [ni, note] of bar.entries()) {
          if (note.rest) continue;
          const cxn = bx + gap * (ni + 0.6);
          const st = note.degree - bottomDeg;
          const y = stepY(st);
          const long = note.type === 'whole' || note.duration >= 4;
          const half = note.type === 'half' || note.duration === 2;
          const glyph = long ? G.whole : half ? G.half : G.black;
          const gw = wid(glyph);
          for (let s2 = 10; s2 <= st; s2 += 2) g.fillRect(cxn - gw * 0.75, stepY(s2), gw * 1.5, lineThick);
          for (let s2 = -2; s2 >= st; s2 -= 2) g.fillRect(cxn - gw * 0.75, stepY(s2), gw * 1.5, lineThick);
          if (note.alter !== inForce(note.degree)) {
            const acc = note.alter > 0 ? G.sharp : note.alter < 0 ? G.flat : G.natural;
            put(acc, cxn - gw / 2 - wid(acc) - space * 0.15, y);
            inBar.set(note.degree, note.alter);
          }
          put(glyph, cxn - gw / 2, y);
          if (!long) {
            const up = st < 4;
            const sx = up ? cxn + gw / 2 - lineThick : cxn - gw / 2;
            g.fillRect(sx, up ? y - space * 3.2 : y, Math.max(1, lineThick), space * 3.2);
          }
          truth.push({ x: cxn / W, y: y / H, midi: note.midi });
        }
      }
      g.fillRect(W - space * 2.4, lineY(0), Math.max(1, lineThick * 1.6), lineY(4) - lineY(0));
    }

    let shot = c;
    if (phone) {
      const s = document.createElement('canvas');
      s.width = Math.round(W * 0.72); s.height = Math.round(H * 0.72);
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

    // --- read it, the way the app reads it ---------------------------------
    const R = await import('/src/analysis/scan-read.js');
    const V = await import('/src/ui/scan-view.js');
    const N = await import('/src/analysis/scan-notes.js');
    const K = await import('/src/analysis/scan-key.js');
    const read = R.readPage(shot, shot.width, shot.height);
    if (!read) return { failed: 'the reader could not read its own engraving', truth: truth.length };

    // The layout the review hands `headsOf`: one entry per page. `hid` is this
    // file's own label for a head and is spread through every route in
    // pairNotes, which is how a mark can be asked WHICH head it landed on.
    const after = V.headsOf([read]).map((h, i) => ({ ...h, hid: i }));
    // The BEFORE reference, reconstructed rather than re-run: this is exactly
    // the line that was in headsOf — every head priced as if the page were in
    // C major, whatever its signature says.
    const before = after.map((h) => ({
      ...h, midi: N.pitchOf(h.step, h.clef, K.NO_KEY)?.midi ?? null,
    }));

    // --- which head is which written note ----------------------------------
    //
    // Settled by POSITION, before any pitch is consulted: the engraver's own
    // coordinates against the reader's, nearest first, one head to one note.
    const near = space * 0.6;
    const pairs = [];
    for (const [hi, h] of after.entries()) {
      for (const [ti, t] of truth.entries()) {
        const d = Math.hypot((h.x - t.x) * W, (h.y - t.y) * H);
        if (d < near) pairs.push({ hi, ti, d });
      }
    }
    pairs.sort((a, b) => a.d - b.d);
    const tookH = new Set(); const tookT = new Set();
    const headOf = new Array(truth.length).fill(-1);   // -1: the reader never found it
    for (const p of pairs) {
      if (tookH.has(p.hi) || tookT.has(p.ti)) continue;
      tookH.add(p.hi); tookT.add(p.ti);
      headOf[p.ti] = p.hi;
    }

    // --- the takes ---------------------------------------------------------
    //
    // Seeded, so BEFORE and AFTER are scored on byte-identical playing. The
    // rates are the reader's own error rates turned round: on a photograph it
    // misses or invents about one head in seven, and a player of a scale study
    // drops rather fewer than that.
    const mkRng = (s) => () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
    const buildTake = (seed) => {
      const rnd = mkRng(seed);
      const len = Math.min(truth.length, 40);
      const from = Math.floor(rnd() * Math.max(1, truth.length - len));
      const played = [];
      let t = 0;
      for (let k = from; k < from + len; k++) {
        // a note left out
        if (rnd() < 0.05) { t += 0.25; continue; }
        // a squeak nobody wrote, before this note
        if (rnd() < 0.04) {
          played.push({ midi: truth[k].midi + 5 + Math.floor(rnd() * 4), cents: 0, start: t, end: t + 0.08, want: null });
          t += 0.12;
        }
        // the note itself — occasionally the wrong one, which is a player's
        // error and not the reader's: it still belongs to that notehead.
        let midi = truth[k].midi;
        const slip = rnd();
        if (slip < 0.02) midi += 12 * (rnd() < 0.5 ? 1 : -1);
        else if (slip < 0.05) midi += 2 + Math.floor(rnd() * 3);
        const dur = 0.22 + rnd() * 0.08;
        played.push({
          midi,
          cents: Math.round((rnd() - 0.5) * 30),
          start: t + (rnd() - 0.5) * 0.03,
          end: t + dur,
          want: headOf[k],
        });
        t += 0.25;
      }
      return played;
    };

    // The page as the reader ACTUALLY read it when it only found some of the
    // notes: a seeded fraction of the heads simply is not there. Seeded off the
    // head's own index so BEFORE and AFTER lose the same ones.
    const thin = (heads) => {
      if (unpriced) heads = heads.map((h) => ({ ...h, midi: null }));
      if (!(miss > 0)) return heads;
      let seed = 20260818;
      const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
      return heads.filter(() => rnd() >= miss);
    };

    const scoreTake = (heads, played) => {
      const kept = new Set(heads.map((h) => h.hid));
      const res = V.pairNotes(heads, played);
      const markAt = new Map();
      for (const m of res.marks ?? []) markAt.set(m.index, m);
      let correct = 0; let misplaced = 0; let unmarked = 0;
      let onUnread = 0; let squeakMarked = 0; let squeaks = 0; let unread = 0;
      let lost = 0;
      const offsets = {};
      const byVerdict = {};
      for (const [i, p] of played.entries()) {
        const m = markAt.get(i);
        if (p.want === null) { squeaks++; if (m) squeakMarked++; continue; }
        if (p.want < 0) { unread++; if (m) onUnread++; continue; }
        // Its own notehead was one of the ones this page never found. Nothing
        // the aligner does can be right for it, so it is counted and left out.
        if (!kept.has(p.want)) { lost++; continue; }
        if (!m) { unmarked++; continue; }
        if (m.hid === p.want) { correct++; byVerdict[`right ${m.verdict ?? '—'}`] = (byVerdict[`right ${m.verdict ?? '—'}`] ?? 0) + 1; }
        else {
          misplaced++;
          byVerdict[`WRONG ${m.verdict ?? '—'}`] = (byVerdict[`WRONG ${m.verdict ?? '—'}`] ?? 0) + 1;
          const d = m.hid - p.want;
          offsets[d] = (offsets[d] ?? 0) + 1;
        }
      }
      return {
        placed: !!res.placed,
        readPitch: !!res.readPitch,
        aligned: !!res.aligned,
        countedOff: res.placed && res.aligned === false,
        fitAgreement: res.fitAgreement ?? null,
        startScore: res.confidence ?? null,
        marks: res.marks?.length ?? 0,
        correct, misplaced, unmarked, onUnread, squeakMarked, squeaks, unread, lost,
        scorable: correct + misplaced + unmarked,
        offsets,
        byVerdict,
      };
    };

    const rows = [];
    for (let k = 0; k < takes; k++) {
      const played = buildTake(seed0 + k * 7919);
      rows.push({
        n: played.length,
        before: scoreTake(thin(before), played),
        after: scoreTake(thin(after), played),
      });
    }

    // Rolled up two ways, because the change moves TWO things and one of them
    // hides the other. `all` is every take. `kept` is only the takes where the
    // AFTER side still took the pitch route — a page whose key could not be
    // established now drops to the contour route by design (rule 5), and
    // averaging its refusal in with the takes that were aligned reports a fall
    // in placement quality that is really a change of route.
    const sum = (which, only) => {
      const t = { correct: 0, misplaced: 0, unmarked: 0, onUnread: 0, squeakMarked: 0, squeaks: 0, unread: 0, lost: 0, scorable: 0, pitchRoute: 0, takes: 0, offsets: {} };
      for (const r of rows) {
        if (only === 'kept' && !r.after.readPitch) continue;
        for (const k of ['correct', 'misplaced', 'unmarked', 'onUnread', 'squeakMarked', 'squeaks', 'unread', 'lost', 'scorable']) t[k] += r[which][k];
        if (r[which].readPitch) t.pitchRoute++;
        if (r[which].countedOff) t.countedOff = (t.countedOff ?? 0) + 1;
        t.takes++;
        for (const [d, n] of Object.entries(r[which].offsets)) t.offsets[d] = (t.offsets[d] ?? 0) + n;
        for (const [k, n] of Object.entries(r[which].byVerdict ?? {})) {
          t.byVerdict = t.byVerdict ?? {};
          t.byVerdict[k] = (t.byVerdict[k] ?? 0) + n;
        }
      }
      return t;
    };
    // Takes that were on the pitch route before and are not after: the whole
    // cost of refusing to price a head off a key nobody read.
    const flipped = rows.filter((r) => r.before.readPitch && !r.after.readPitch).length;

    return {
      failed: null,
      // Every take of this study, kept whole so a summary can ask questions of
      // the individual takes — which is what the contour-confidence table does.
      rows,
      truth: truth.length,
      heads: after.length,
      matchedHeads: headOf.filter((h) => h >= 0).length,
      keyRead: read.key ? (read.key.sharps ? read.key.sharps : -read.key.flats) : null,
      keyKind: read.key?.kind ?? null,
      staveKeys: read.staves.map((s) => (s.key ? (s.key.sharps ? s.key.sharps : -s.key.flats) : null)),
      clef: read.staves[0]?.clef ?? null,
      pricedBefore: before.filter((h) => Number.isFinite(h.midi)).length,
      pricedAfter: after.filter((h) => Number.isFinite(h.midi)).length,
      takes: rows.length,
      flipped,
      before: sum('before'),
      after: sum('after'),
      beforeKept: sum('before', 'kept'),
      afterKept: sum('after', 'kept'),
    };
  }, { b64: font, study, space, phone, keyAlterArr: keyAlter(study.fifths), bottomDeg: BOTTOM[study.clef], takes, seed0, miss, unpriced });

  results.push({ file: basename(file, '.musicxml'), fifths: study.fifths, clef: study.clef, ...out });
  if (out.failed) console.error(`  ${basename(file, '.musicxml')}: ${out.failed}`);
}
await browser.close();
if (errs.length) console.error(`page errors: ${errs.slice(0, 3).join(' | ')}`);

const ok = results.filter((r) => !r.failed);
const pc = (a, b) => (b ? `${(a / b * 100).toFixed(1)}%` : '—');

if (wantJson) {
  console.log(JSON.stringify(results, null, 2));
} else {
  console.log(`\nWHICH NOTEHEAD DID THE TAKE LAND ON — ${ok.length} engraved cello studies,`
    + ` ${takes} synthetic takes each, staff space ${space}px${phone ? ', photographed (--phone)' : ', clean'}`
    + `${miss > 0 ? `, WITH ${Math.round(miss * 100)}% OF THE PAGE'S NOTEHEADS NEVER FOUND (--miss)` : ''}`);
  console.log('The take is played from the MusicXML; the reference is what the reader read.\n');
  console.log('                             key         BEFORE (heads priced NO_KEY)        AFTER (heads priced from the read key)');
  console.log('  study                    want got   right  wrong  none  route      right  wrong  none  route');
  for (const r of ok) {
    const b = r.before; const a = r.after;
    console.log(`  ${r.file.padEnd(24)} ${String(r.fifths).padStart(3)} ${String(r.keyRead ?? '—').padStart(3)}`
      + `   ${pc(b.correct, b.scorable).padStart(6)} ${String(b.misplaced).padStart(5)} ${String(b.unmarked).padStart(5)}`
      + `  ${(b.pitchRoute === r.takes ? 'pitch' : b.pitchRoute ? `${b.pitchRoute}/${r.takes}` : 'shape').padEnd(6)}`
      + `    ${pc(a.correct, a.scorable).padStart(6)} ${String(a.misplaced).padStart(5)} ${String(a.unmarked).padStart(5)}`
      + `  ${(a.pitchRoute === r.takes ? 'pitch' : a.pitchRoute ? `${a.pitchRoute}/${r.takes}` : 'shape').padEnd(6)}`);
  }

  const roll = (which) => {
    const t = { correct: 0, misplaced: 0, unmarked: 0, scorable: 0, onUnread: 0, squeakMarked: 0, squeaks: 0, unread: 0, lost: 0, pitchRoute: 0, takes: 0, offsets: {} };
    for (const r of ok) {
      for (const k of ['correct', 'misplaced', 'unmarked', 'scorable', 'onUnread', 'squeakMarked', 'squeaks', 'unread', 'lost', 'pitchRoute', 'takes', 'countedOff']) t[k] = (t[k] ?? 0) + (r[which][k] ?? 0);
      for (const [d, n] of Object.entries(r[which].offsets)) t.offsets[d] = (t.offsets[d] ?? 0) + n;
    }
    return t;
  };
  // DOES THE CONTOUR ROUTE KNOW WHEN IT IS WRONG? Its own two statistics —
  // fitPitches' agreement and findStart's shape score — against how its marks
  // actually landed, take by take, in tenths.
  if (unpriced) {
    const band = new Map();
    for (const r of ok) {
      for (const row of r.rows ?? []) {
        const a = row.after;
        if (!a.placed) continue;
        const key = a.fitAgreement === null ? 'counted off'
          : `${(Math.floor(a.fitAgreement * 10) / 10).toFixed(1)}`;
        const cell = band.get(key) ?? { takes: 0, correct: 0, misplaced: 0 };
        cell.takes += 1;
        cell.correct += a.correct;
        cell.misplaced += a.misplaced;
        band.set(key, cell);
      }
    }
    console.log('\n  THE CONTOUR ROUTE AGAINST ITS OWN CONFIDENCE');
    console.log('    fit agreement   takes   right head   WRONG head');
    for (const [k, c] of [...band.entries()].sort()) {
      console.log(`    ${k.padEnd(15)} ${String(c.takes).padStart(5)}   ${String(c.correct).padStart(10)}   ${String(c.misplaced).padStart(10)}`);
    }
  }

  const B = roll('before'); const A = roll('after');
  // How the marks that landed WRONG were judged by the aligner — the question
  // "could the pairing have known?" A misplaced mark whose pitch agreed exactly
  // is one nothing here can catch; one judged `wrong` is a mark the aligner
  // already doubted and placed anyway.
  const verdicts = {};
  for (const r of ok) {
    for (const [k, n] of Object.entries(r.after.byVerdict ?? {})) verdicts[k] = (verdicts[k] ?? 0) + n;
  }
  const BK = roll('beforeKept'); const AK = roll('afterKept');
  const flipped = ok.reduce((n, r) => n + r.flipped, 0);
  const line = (name, t) => {
    console.log(`  ${name.padEnd(8)} ${pc(t.correct, t.scorable).padStart(7)} on the right head`
      + `   ${String(t.misplaced).padStart(5)} on the WRONG head`
      + `   ${String(t.unmarked).padStart(5)} unmarked`
      + `${miss > 0 ? `   ${String(t.lost).padStart(5)} whose head was never found` : ''}`
      + `   ${String(t.squeakMarked).padStart(4)}/${t.squeaks} squeaks ringed`
      + `   ${t.pitchRoute}/${t.takes} takes on the pitch route`
      + `${t.countedOff ? `   ${t.countedOff} COUNTED OFF` : ''}`);
  };
  console.log(`\n  HOW THE MARKS WERE JUDGED — ${Object.entries(verdicts).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}: ${n}`).join(' · ')}`);
  console.log(`\n  EVERY TAKE — ${B.scorable} played notes scored per side, over ${B.takes} takes`);
  line('BEFORE', B);
  line('AFTER', A);
  // The two questions this change asks, kept apart. A page whose key could not
  // be established is REFUSED now where it was answered from a C-major
  // assumption before, and that shows up as unmarked notes rather than as
  // misplaced ones — a different thing, and the one rule 5 is about.
  console.log(`\n  THE TAKES THAT STAYED ON THE PITCH ROUTE — ${flipped} of ${B.takes} dropped to the`
    + ` contour route because their page could not establish a key, and are excluded here`);
  line('BEFORE', BK);
  line('AFTER', AK);
  const off = (t) => Object.entries(t.offsets).sort((x, y) => y[1] - x[1]).slice(0, 6)
    .map(([d, n]) => `${d > 0 ? '+' : ''}${d}: ${n}`).join('   ');
  // Over the KEPT takes, so the two histograms count the same playing. A take
  // that dropped to the contour route contributes no marks at all and so no
  // misplacements, which would flatter the after column for the wrong reason.
  console.log(`\n  where the wrong ones landed, in heads from the right one — the kept takes only`);
  console.log(`    before   ${off(BK) || '—'}`);
  console.log(`    after    ${off(AK) || '—'}`);
  console.log('');
}
