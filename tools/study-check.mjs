// The whole reader, end to end, against real music in fourteen keys.
//
// WHY THIS EXISTS
//
// Everything measured until now was measured on three pages, and all three are
// in ONE SHARP. The key signature reader handles nought to seven sharps and
// flats and was checked against signatures this project drew for the purpose;
// the accidental reader was checked the same way; and the clef, the key and the
// accidental together are what turn a position into a pitch. None of that had
// ever been tested against real music in a key other than G.
//
// ~/Downloads/cello-studies holds thirty-two MusicXML studies — scales,
// arpeggios and thirds, in A, B flat, C, D, E, E flat, F and G major and A, B,
// C, D, E and G minor. MusicXML is exact: every pitch, every octave, every key
// signature, written down by whoever made the file. So a study can be ENGRAVED
// with real Bravura, photographed, read back, and compared NOTE FOR NOTE
// against what it says.
//
//   npm run scan:studies -- [--dir ~/Downloads/cello-studies] [--camera] [--space 14]
//
// This is the strongest test in the project, because it is the only one that
// scores the thing the app actually wants — the PITCH — rather than whether a
// circle landed near some ink. A page can read 100% of its noteheads and still
// be a semitone out on every one of them, and nothing else here would notice.
//
// WHAT IT IS NOT. The engraving is this file's, not a publisher's, so it shares
// tools/engrave.mjs's blind spots: one notehead font, one layout algorithm, no
// slurs across systems, no page furniture. It tests the READING of real music,
// not the reading of a real edition. `npm run bench` remains the only thing that
// does the second, and when the two disagree bench is right.

import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
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
const camera = args.includes('--camera');
// A SECOND, HARSHER CAMERA — and the reason there are two.
//
// `--camera` is a gentle filter: blur 0.7px, contrast 0.88, a light gradient,
// no rescale and no JPEG. Measured, it is too gentle to move ANY number this
// file prints — clean and `--camera` come back identical in every field, note
// for note — so a run of it is not evidence that the reader survives a
// photograph, and quoting it as such is how "the camera does not affect this"
// came to be believed. `--phone` is the degradation tools/key-read-check.mjs
// spoils its signatures with, which does move numbers there: 0.72 downscale
// (so a 14px staff space arrives as 10), blur 1px, contrast 0.62, and a JPEG
// round trip at quality 0.6 for the ringing round every stem.
const phone = args.includes('--phone');
const space = Number(flag('space', 14));
const keep = flag('keep', null);

// --- MusicXML, only as much of it as a scale study uses ---------------------
//
// Deliberately small. The app has a real parser in src/analysis/musicxml.js and
// it wants a browser; this needs eight tags and runs in node, and a hundred
// lines of regex that is honest about what it does not handle beats importing a
// parser and pretending the rest of the format is covered.
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
  let clef = sign === 'F' ? 'bass' : (sign === 'C' && line === 4) ? 'tenor' : 'treble';
  // A lever for one experiment: force the clef, to ask whether a failure belongs
  // to the KEY or to the clef the key is printed under.
  if (process.env.FORCE_CLEF) clef = process.env.FORCE_CLEF;
  const bars = measures.map((m) => all(m, 'note').map((n) => {
    if (/<rest\s*\/?>/.test(n)) return { rest: true, duration: Number(tag(n, 'duration') ?? 1) };
    const step = tag(n, 'step');
    const octave = Number(tag(n, 'octave') ?? 4);
    const alter = Number(tag(n, 'alter') ?? 0);
    const duration = Number(tag(n, 'duration') ?? 1);
    const type = tag(n, 'type') ?? 'quarter';
    return {
      letter: step,
      octave,
      alter,
      duration,
      type,
      midi: (octave + 1) * 12 + SEMIS[LETTERS.indexOf(step)] + alter,
      // Where it sits on the stave, counted in diatonic degrees from C0.
      degree: octave * 7 + LETTERS.indexOf(step),
    };
  }));
  return { fifths, clef, beats, bars, title: tag(xml, 'work-title') ?? '' };
}

// Which degrees a signature alters, and by how much. The same order tables as
// scan-key.js, restated here because this file must NOT import the reader's
// idea of a key signature to generate the page the reader is then tested on.
const SHARP_ORDER = [3, 0, 4, 1, 5, 2, 6];
const FLAT_ORDER = [6, 2, 5, 1, 4, 0, 3];
function keyAlter(fifths) {
  const alter = [0, 0, 0, 0, 0, 0, 0];
  const order = fifths >= 0 ? SHARP_ORDER : FLAT_ORDER;
  for (let i = 0; i < Math.abs(fifths); i++) alter[order[i]] = fifths >= 0 ? 1 : -1;
  return alter;
}
// The bottom line of each clef, as a degree from C0 — bass G2, tenor D3,
// treble E4.
const BOTTOM = { bass: 2 * 7 + 4, tenor: 3 * 7 + 1, treble: 4 * 7 + 2 };

const files = (await readdir(dir)).filter((f) => /\.musicxml$/i.test(f)).sort();
if (!files.length) {
  console.log(`no .musicxml under ${dir}`);
  process.exit(1);
}
if (keep) await mkdir(keep, { recursive: true });

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
  const out = await page.evaluate(async ({ b64, study, space, camera, phone, keyAlterArr, bottomDeg }) => {
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

    // Lay the study out: as many bars per system as fit.
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
    const put = (ch, x, y) => { g.font = `${em}px Bravura`; g.textBaseline = 'alphabetic'; g.fillText(ch, x, y); g.font = `${em}px Bravura`; return g.measureText(ch).width; };
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
        // WHAT IS IN FORCE ON EACH LINE AND SPACE, THIS BAR.
        //
        // This harness used to decide whether to print an accidental by
        // comparing the note to the KEY SIGNATURE alone. That is not the rule
        // of accidentals, and the difference is not academic: a printed
        // accidental holds for the REST OF ITS BAR, so a note that agrees with
        // the key but follows an inflection of the same degree in the same bar
        // needs a cancelling natural printed in front of it, and this drew
        // nothing there.
        //
        // Every melodic minor scale in the corpus has exactly that shape. Bar 3
        // of B-minor-scale is G4#(sharp) A4#(sharp) B4 A4: the ascending form
        // raises the sixth and seventh, the descending form restores them in the
        // same bar, and the restoring A4 was engraved bare on the same staff
        // line as the A4# three notes earlier. The reader carried the sharp to
        // the end of the bar — which is what an engraver, a player and the rule
        // all say — and was scored wrong for being right, on six notes: the last
        // note of bar 3 of A-, B-, C-, D-, E- and G-minor-scale, all at x = 787
        // to 789, every one with the found step equal to the wanted step. That
        // whole population was the `+1` group in `wrong by semitones`, and it
        // was the reason this file's own header claim — "NOTE FOR NOTE against
        // what the file says" — was not true.
        //
        // Keyed by the note's absolute DEGREE, not by degree modulo seven: an
        // accidental binds the line or space it is written on, not the letter.
        // Seeded from the key at every barline, which is what a barline does.
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
          // A PRINTED accidental wherever the note disagrees with what is
          // already in force on its own line or space — see `inForce` above.
          let printedAcc = null;
          if (note.alter !== inForce(note.degree)) {
            printedAcc = note.alter > 0 ? 'sharp' : note.alter < 0 ? 'flat' : 'natural';
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
          // …AND WHAT WAS PRINTED IN FRONT OF IT, so the accidental reader can be
          // scored separately from the key reader. They are two different pieces of
          // machinery — scan-key.js and scan-accidental.js — and until now the only
          // number covering either was `RIGHT PITCH`, which they share with the clef.
          truth.push({ x: cxn / W, y: y / H, midi: note.midi, step: st, acc: printedAcc });
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
      const out = document.createElement('canvas');
      out.width = s.width; out.height = s.height;
      out.getContext('2d', { willReadFrequently: true }).drawImage(bmp, 0, 0);
      bmp.close?.();
      shot = out;
    } else if (camera) {
      const o2 = document.createElement('canvas');
      o2.width = W; o2.height = H;
      const o = o2.getContext('2d');
      o.filter = 'blur(0.7px) contrast(0.88) brightness(1.05)';
      o.drawImage(c, 0, 0);
      o.filter = 'none';
      const gr = o.createLinearGradient(0, 0, W, H);
      gr.addColorStop(0, 'rgba(0,0,0,0.07)');
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      o.fillStyle = gr; o.fillRect(0, 0, W, H);
      shot = o2;
    }

    const M = await import('/src/analysis/scan-read.js');
    // The page's OWN size, not the drawn one: `--phone` hands the reader a
    // canvas 0.72 across, and readPage measures its staff space off what it is
    // given. Truth positions are fractions of the page, so they still line up.
    const read = M.readPage(shot, shot.width, shot.height);
    if (!read) return { failed: true, truth: truth.length, png: shot.toDataURL('image/png') };
    const notes = M.notesInOrder(read);

    // Pair by position, then ask whether the PITCH agrees.
    const near = space * 0.6;
    const pairs = [];
    for (const [fi, f] of notes.entries()) {
      for (const [ti, t] of truth.entries()) {
        const d = Math.hypot((f.x - t.x) * W, (f.y - t.y) * H);
        if (d < near) pairs.push({ fi, ti, d });
      }
    }
    pairs.sort((a, b) => a.d - b.d);
    const tookF = new Set(); const tookT = new Set(); const matched = [];
    for (const p of pairs) {
      if (tookF.has(p.fi) || tookT.has(p.ti)) continue;
      tookF.add(p.fi); tookT.add(p.ti);
      matched.push({ got: notes[p.fi], want: truth[p.ti] });
    }
    const rightPitch = matched.filter((m) => m.got.midi === m.want.midi).length;
    const noPitch = matched.filter((m) => m.got.midi == null).length;
    // THE ACCIDENTAL READER, SCORED ON ITS OWN. `RIGHT PITCH` is shared between
    // the clef, the key signature and the accidental in front of the note, and a
    // failure in any of the three lands in the same column — so a change to one
    // of them cannot be attributed from that number alone. These four count the
    // glyphs this page actually printed, against what scan-accidental.js said.
    const kindOf = (a) => (a ? (a.kind ?? String(a)) : null);
    // Counted against the PAGE first and the matches second, because those are
    // two different failures wearing one number. At `--phone` the reader loses
    // 61 of 692 heads, and 28 of those 61 are the heads with an accidental
    // printed against them — 4% of the notes taking 46% of the losses. Scoring
    // the accidental reader only over matched notes would have hidden that
    // entirely and reported 2 of 2, 100%.
    const accPrinted = truth.filter((t) => t.acc).length;
    const accWanted = matched.filter((m) => m.want.acc);
    const accFound = accWanted.filter((m) => kindOf(m.got.accidental) !== null).length;
    const accNamed = accWanted.filter((m) => kindOf(m.got.accidental) === m.want.acc).length;
    const accNone = matched.filter((m) => !m.want.acc);
    const accInvented = accNone.filter((m) => kindOf(m.got.accidental) !== null).length;
    const offBy = {};
    for (const m of matched) {
      if (m.got.midi == null || m.got.midi === m.want.midi) continue;
      const d = m.got.midi - m.want.midi;
      offBy[d] = (offBy[d] ?? 0) + 1;
    }
    return {
      failed: false,
      truth: truth.length,
      found: notes.length,
      matched: matched.length,
      rightPitch,
      noPitch,
      offBy,
      accPrinted,
      accWanted: accWanted.length,
      accFound,
      accNamed,
      accNone: accNone.length,
      accInvented,
      clef: read.staves[0]?.clef ?? null,
      key: read.key ? (read.key.sharps ? read.key.sharps : -read.key.flats) : null,
      // …AND THE KEY EACH STAVE READ FOR ITSELF, which is not the same question
      // and was being reported as though it were. `read.key` is the PAGE key,
      // and agreeKey deliberately refuses to name one without more than one
      // witness — so every single-system page on this corpus reports none, and
      // the "key signature right N of 32" line counted all fourteen arpeggios
      // as failures. Their staves read the signature perfectly and twelve of
      // them score 100% right pitch off it. A column that cannot tell "read it
      // wrong" from "declined to agree with itself" is not measuring the key
      // reader, and this corpus is the only instrument that looks at fourteen
      // keys.
      staveKeys: read.staves.map((s) => (s.key ? (s.key.sharps ? s.key.sharps : -s.key.flats) : null)),
      staves: read.staves.length,
      png: shot.toDataURL('image/png'),
    };
  }, { b64: font, study, space, camera, phone, keyAlterArr: keyAlter(study.fifths), bottomDeg: BOTTOM[study.clef] });

  if (keep && out.png) {
    await writeFile(join(keep, `${basename(file, '.musicxml')}.png`),
      Buffer.from(out.png.split(',')[1], 'base64'));
  }
  delete out.png;
  results.push({ file: basename(file, '.musicxml'), fifths: study.fifths, clef: study.clef, ...out });
}
await browser.close();

const pc = (a, b) => `${b ? (a / b * 100).toFixed(1) : '—'}%`;
console.log(`\nTHE READER ON ${results.length} REAL CELLO STUDIES — engraved with Bravura`
  + `${camera ? ', photographed' : ', clean'}, staff space ${space}px`);
console.log('MusicXML says what every pitch is, so this scores the PITCH and not the circle.\n');
// A stave that never read a signature is not a stave that read the wrong one,
// so the two are separated everywhere below: `!` means WRONG, `·` means none.
const mark = (got, want) => (got === want ? ' ' : got === null ? '·' : '!');
const staveCol = (r) => {
  const keys = r.staveKeys ?? [];
  if (!keys.length) return '—';
  const right = keys.filter((k) => k === r.fifths).length;
  const wrong = keys.filter((k) => k !== null && k !== r.fifths).length;
  return `${right}/${keys.length}${wrong ? '!' : ''}`;
};
console.log('  study                    key  clef read  page key  staves  notes  found  matched  RIGHT PITCH');
for (const r of results) {
  const want = r.fifths;
  console.log(`  ${r.file.padEnd(24)} ${String(want).padStart(3)}  ${String(r.clef ?? '—').padEnd(9)}`
    + `  ${String(r.key ?? '—').padStart(4)}${mark(r.key, want)}   ${staveCol(r).padStart(5)}`
    + `  ${String(r.truth).padStart(5)}`
    + `  ${String(r.found ?? 0).padStart(5)}  ${String(r.matched ?? 0).padStart(7)}`
    + `  ${String(r.rightPitch ?? 0).padStart(5)} ${pc(r.rightPitch ?? 0, r.truth).padStart(7)}`);
}
const sum = (k) => results.reduce((a, r) => a + (r[k] ?? 0), 0);
console.log(`\n  notes engraved      ${sum('truth')}`);
console.log(`  found               ${sum('matched')}  ${pc(sum('matched'), sum('truth'))} recall`);
console.log(`  RIGHT PITCH         ${sum('rightPitch')}  ${pc(sum('rightPitch'), sum('truth'))} of everything engraved`);
console.log(`  no pitch at all     ${sum('noPitch')}  (clef or key unread)`);
// THREE NUMBERS, BECAUSE THERE ARE THREE ANSWERS. A key read wrong is the one
// unforgivable failure in this reader — it puts a semitone on every note of a
// degree across a whole page — and a key not read at all costs a fallback. The
// single figure printed here before could not tell them apart, and every one of
// the fourteen it counted against the reader was the second kind.
const pageRight = results.filter((r) => r.key === r.fifths).length;
const pageWrong = results.filter((r) => r.key !== null && r.key !== r.fifths).length;
const staveTotal = results.reduce((a, r) => a + (r.staveKeys?.length ?? 0), 0);
const staveRight = results.reduce((a, r) => a
  + (r.staveKeys ?? []).filter((k) => k === r.fifths).length, 0);
const staveWrong = results.reduce((a, r) => a
  + (r.staveKeys ?? []).filter((k) => k !== null && k !== r.fifths).length, 0);
console.log(`  page key right      ${pageRight} of ${results.length}`
  + `   (WRONG on ${pageWrong} — this is the number that must stay at zero)`);
console.log(`  page key not agreed ${results.length - pageRight - pageWrong} of ${results.length}`
  + '   (a page of ONE system has no second witness, by design)');
console.log(`  stave key right     ${staveRight} of ${staveTotal}`
  + `   (WRONG on ${staveWrong})`);
console.log(`\n  ACCIDENTALS PRINTED   ${sum('accPrinted')}`);
console.log(`    their note found    ${sum('accWanted')}  ${pc(sum('accWanted'), sum('accPrinted'))}`);
console.log(`    accidental found    ${sum('accFound')}  ${pc(sum('accFound'), sum('accWanted'))} of those`);
console.log(`    …and NAMED right    ${sum('accNamed')}  ${pc(sum('accNamed'), sum('accWanted'))} of those`);
console.log(`  notes with NO accidental, given one  ${sum('accInvented')} of ${sum('accNone')}`
  + `  ${pc(sum('accInvented'), sum('accNone'))}`);
const off = {};
for (const r of results) for (const [d, n] of Object.entries(r.offBy ?? {})) off[d] = (off[d] ?? 0) + n;
console.log(`  wrong by semitones  ${JSON.stringify(off)}`);
if (errs.length) console.log('\npage errors:', errs.slice(0, 3));
