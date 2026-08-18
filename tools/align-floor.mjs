// DOES THIS TAKE BELONG TO THIS PAGE — the two score distributions, and the
// floor that separates them.
//
// WHY THIS EXISTS
//
// `pairNotes` believed ANY take against ANY page. `alignScore` is an edit
// distance, so it always returns a path; the only refusal on the scanned side
// was `findStart`'s, and the pitch route never reaches it. MEASURED, before the
// floor: two octaves of D major over the two engraved Bach pages of
// `score:follow` came back `placed: true`, 20 marks of 24 notes, verdicts
// { match: 6, wrong: 6, octave: 7, near: 1 }, and the review said in words
// "26 notes played onto 50 noteheads, in the order you played them".
//
// A floor tuned on that one example is not a floor. So this tool builds BOTH
// distributions on the same corpus, the same engraver and the same take
// builder as `npm run scan:align`:
//
//   RIGHT   a take played from study i, against the reader's reading of study i
//   WRONG   a take played from study j, against the reader's reading of study i
//
// and prints the trade curve over every candidate floor — how many RIGHT
// pairings a floor refuses against how many WRONG ones it catches. The floor
// is read off that curve; nothing here picks it.
//
//   npm run scan:floor -- [--dir ~/Downloads/cello-studies] [--takes 4]
//                         [--seed 11] [--space 14] [--phone] [--json]
//
// THE HARD NEGATIVES ARE THE POINT. 32 studies cross 992 ways and almost all of
// those crossings differ in clef or key, which any statistic separates. So the
// crossings are CHOSEN rather than sampled: for each study, first the foreign
// studies that share BOTH its clef and its key signature, then those that share
// its clef, then the rest — and the table reports the same-key-same-clef column
// on its own, because a floor that only works when the clef differs would pass
// the aggregate and fail on the real case.
//
// WHAT THIS IS NOT. The pages are this repo's own engraving and it shares
// tools/engrave.mjs's blind spots. And a WRONG take here is a different STUDY,
// not a different passage of the same study — a player on the wrong page of the
// right piece is a case nothing in this repo measures.

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
const wantJson = args.includes('--json');

// --- MusicXML, only as much of it as a scale study uses ---------------------
// Lifted from tools/align-check.mjs. Every tool in this directory is
// self-contained on purpose; see the note at the head of that file.
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

const files = (await readdir(dir)).filter((f) => /\.musicxml$/i.test(f)).sort();
if (!files.length) { console.log(`no .musicxml under ${dir}`); process.exit(1); }

const studies = [];
for (const file of files) {
  const study = parseStudy(await readFile(join(dir, file), 'utf8'));
  studies.push({ file: basename(file, '.musicxml'), ...study });
}

// Which foreign studies each page is crossed with. HARDEST FIRST, deliberately:
// same clef AND same key signature, then same clef, then anything. A floor is
// only worth what it does on the crossings a statistic cannot get for free.
function crossingsFor(i) {
  const me = studies[i];
  const rank = (j) => {
    const o = studies[j];
    if (o.clef === me.clef && o.fifths === me.fifths) return 0;
    if (o.clef === me.clef) return 1;
    return 2;
  };
  const others = studies.map((_, j) => j).filter((j) => j !== i);
  others.sort((a, b) => rank(a) - rank(b) || a - b);
  return others.slice(0, takes).map((j) => ({
    j,
    kind: ['same key, same clef', 'same clef', 'different clef'][rank(j)],
  }));
}

const font = (await readFile(new URL('./fonts/Bravura.otf', import.meta.url))).toString('base64');
const browser = await puppeteer.launch({ executablePath: SHELL, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1500, height: 2000 });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 1500));

const rows = [];
for (const [i, study] of studies.entries()) {
  const cross = crossingsFor(i);
  const foreign = cross.map((c) => ({
    name: studies[c.j].file,
    kind: c.kind,
    // The MIDI of the foreign study, in order, rests dropped. Only the notes
    // travel: the wrong take is somebody playing a DIFFERENT PIECE, not a
    // differently engraved one.
    midis: studies[c.j].bars.flat().filter((n) => !n.rest).map((n) => n.midi),
  }));
  const out = await page.evaluate(async ({
    b64, study, space, phone, keyAlterArr, bottomDeg, takes, seed0, foreign,
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
    const read = R.readPage(shot, shot.width, shot.height);
    if (!read) return { failed: 'the reader could not read its own engraving' };
    const heads = V.headsOf([read]);

    // --- the takes ---------------------------------------------------------
    //
    // The SAME builder for right and wrong, so the only difference between the
    // two distributions is which piece the notes came from. Drops, squeaks and
    // slips at the rates tools/align-check.mjs uses.
    const mkRng = (s) => () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
    const buildTake = (seed, midis) => {
      const rnd = mkRng(seed);
      const len = Math.min(midis.length, 40);
      const from = Math.floor(rnd() * Math.max(1, midis.length - len));
      const played = [];
      let t = 0;
      for (let k = from; k < from + len; k++) {
        if (rnd() < 0.05) { t += 0.25; continue; }
        if (rnd() < 0.04) {
          played.push({ midi: midis[k] + 5 + Math.floor(rnd() * 4), cents: 0, start: t, end: t + 0.08 });
          t += 0.12;
        }
        let midi = midis[k];
        const slip = rnd();
        if (slip < 0.02) midi += 12 * (rnd() < 0.5 ? 1 : -1);
        else if (slip < 0.05) midi += 2 + Math.floor(rnd() * 3);
        const dur = 0.22 + rnd() * 0.08;
        played.push({ midi, cents: Math.round((rnd() - 0.5) * 30), start: t + (rnd() - 0.5) * 0.03, end: t + dur });
        t += 0.25;
      }
      return played;
    };

    const ownMidis = truth.map((t) => t.midi);
    const ask = (played) => {
      const res = V.pairNotes(heads, played);
      return {
        n: played.length,
        placed: !!res.placed,
        readPitch: !!res.readPitch,
        confidence: res.exactAgreement ?? null,
        judged: res.judged ?? null,
        tally: res.tally ?? null,
        marks: res.marks?.length ?? 0,
      };
    };

    const right = [];
    const wrong = [];
    for (let k = 0; k < takes; k++) {
      right.push({ ...ask(buildTake(seed0 + k * 7919, ownMidis)) });
      const f = foreign[k % foreign.length];
      wrong.push({ from: f.name, kind: f.kind, ...ask(buildTake(seed0 + k * 7919 + 104729, f.midis)) });
    }
    return {
      failed: null,
      heads: heads.length,
      priced: heads.filter((h) => Number.isFinite(h.midi)).length,
      right,
      wrong,
    };
  }, {
    b64: font, study, space, phone, keyAlterArr: keyAlter(study.fifths),
    bottomDeg: BOTTOM[study.clef], takes, seed0, foreign,
  });
  rows.push({ file: study.file, fifths: study.fifths, clef: study.clef, ...out });
  if (out.failed) console.error(`  ${study.file}: ${out.failed}`);
}
await browser.close();
if (errs.length) console.error(`page errors: ${errs.slice(0, 3).join(' | ')}`);

const ok = rows.filter((r) => !r.failed);
if (wantJson) {
  console.log(JSON.stringify(rows, null, 2));
  process.exit(0);
}

// Only the pairings that REACHED the statistic. A take on a page that priced no
// head at all never gets to the pitch route and this floor cannot see it; a
// take with fewer than ENOUGH_JUDGED judgeable marks is refused for want of
// evidence and is counted on its own line, not folded into either distribution.
const rightAll = ok.flatMap((r) => r.right.map((t) => ({ ...t, page: r.file })));
const wrongAll = ok.flatMap((r) => r.wrong.map((t) => ({ ...t, page: r.file })));
const scored = (list) => list.filter((t) => t.readPitch && t.confidence !== null);
const contour = (list) => list.filter((t) => !t.readPitch).length;
const tooFew = (list) => list.filter((t) => t.readPitch && t.confidence === null).length;
const R = scored(rightAll);
const W = scored(wrongAll);

const hist = (list) => {
  const bins = new Array(11).fill(0);
  for (const t of list) bins[Math.min(10, Math.floor(t.confidence * 10))] += 1;
  return bins;
};
const stat = (list) => {
  const v = list.map((t) => t.confidence).sort((a, b) => a - b);
  const q = (p) => (v.length ? v[Math.min(v.length - 1, Math.floor(p * v.length))] : NaN);
  return { n: v.length, min: v[0], q10: q(0.10), med: q(0.5), q90: q(0.90), max: v[v.length - 1] };
};

console.log(`\nDOES THIS TAKE BELONG TO THIS PAGE — ${ok.length} engraved cello studies,`
  + ` ${takes} right takes and ${takes} wrong takes each, staff space ${space}px`
  + `${phone ? ', photographed (--phone)' : ', clean'}`);
console.log('The statistic is exact-pitch agreement over the marks on heads the page priced.\n');
console.log(`  RIGHT pairings: ${rightAll.length} built, ${R.length} scored`
  + `  (${contour(rightAll)} never reached the pitch route, ${tooFew(rightAll)} had too few judgeable marks)`);
console.log(`  WRONG pairings: ${wrongAll.length} built, ${W.length} scored`
  + `  (${contour(wrongAll)} never reached the pitch route, ${tooFew(wrongAll)} had too few judgeable marks)`);

const show = (name, s) => console.log(`  ${name.padEnd(6)} n=${String(s.n).padStart(3)}`
  + `   min ${(s.min * 100).toFixed(0)}%   10th ${(s.q10 * 100).toFixed(0)}%`
  + `   median ${(s.med * 100).toFixed(0)}%   90th ${(s.q90 * 100).toFixed(0)}%   max ${(s.max * 100).toFixed(0)}%`);
console.log('');
show('RIGHT', stat(R));
show('WRONG', stat(W));

console.log('\n  the two histograms, in tenths — 0.0-0.1 ... 0.9-1.0, 1.0 exactly in the last cell');
const bar = (name, bins, n) => console.log(`  ${name.padEnd(6)} ${bins.map((b) => String(b).padStart(4)).join('')}   of ${n}`);
bar('RIGHT', hist(R), R.length);
bar('WRONG', hist(W), W.length);

console.log('\n  the WRONG pairings by how hard the crossing is');
for (const kind of ['same key, same clef', 'same clef', 'different clef']) {
  const sub = W.filter((t) => t.kind === kind);
  if (!sub.length) continue;
  show(kind, stat(sub));
}

// HOW MUCH OF THE TAKE GOT A MARK AT ALL — the second statistic, and the one
// that tells a wrong piece from a right one once the ends of the alignment are
// free. A take of the wrong music can match a handful of its notes somewhere on
// the page and end there, leaving the rest as extras: high agreement over very
// few marks. A take of THIS music gets most of its notes marked.
const cover = (r) => (r.n ? r.marks / r.n : 0);
const spread = (rows, name) => {
  const xs = rows.filter((r) => r.placed).map(cover).sort((a, b) => a - b);
  if (!xs.length) return `${name}: none placed`;
  const at = (q) => `${Math.round(xs[Math.min(xs.length - 1, Math.floor(xs.length * q))] * 100)}%`;
  return `${name}  n=${xs.length}   min ${at(0)}   10th ${at(0.1)}   median ${at(0.5)}   90th ${at(0.9)}   max ${at(0.999)}`;
};
console.log('\n  HOW MUCH OF THE TAKE WAS MARKED — marks / notes played');
console.log(`  ${spread(rightAll, 'RIGHT')}`);
console.log(`  ${spread(wrongAll, 'WRONG')}`);
{
  const rows = [];
  for (let f = 0.1; f <= 0.9001; f += 0.1) {
    const refuse = (list) => list.filter((r) => r.placed && cover(r) < f).length;
    const placedR = rightAll.filter((r) => r.placed).length;
    const placedW = wrongAll.filter((r) => r.placed).length;
    rows.push(`    ${f.toFixed(1)}      ${refuse(rightAll)} of ${placedR}`
      + `            ${refuse(wrongAll)} of ${placedW}`);
  }
  console.log('\n  A COVERAGE FLOOR — refusing a pairing that marked less of the take than this');
  console.log('    floor    RIGHT refused       WRONG refused');
  for (const r of rows) console.log(r);
}

console.log('\n  THE TRADE CURVE — a floor refuses a pairing whose agreement is under it');
console.log('    floor    RIGHT refused          WRONG refused        worst WRONG that survives');
for (let f = 0.20; f <= 0.951; f += 0.05) {
  const rr = R.filter((t) => t.confidence < f);
  const wr = W.filter((t) => t.confidence < f);
  const survivor = W.filter((t) => t.confidence >= f).sort((a, b) => b.confidence - a.confidence)[0];
  console.log(`     ${f.toFixed(2)}   ${String(rr.length).padStart(4)} of ${R.length}`
    + ` (${(rr.length / R.length * 100).toFixed(1)}%)`.padEnd(10)
    + `   ${String(wr.length).padStart(4)} of ${W.length}`
    + ` (${(wr.length / W.length * 100).toFixed(1)}%)`.padEnd(10)
    + `   ${survivor ? `${(survivor.confidence * 100).toFixed(0)}%  ${survivor.from} on ${survivor.page}` : '—'}`);
}
console.log('');
