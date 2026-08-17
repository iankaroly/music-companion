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
  const out = await page.evaluate(async ({ b64, study, space, camera, keyAlterArr, bottomDeg }) => {
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
          // A PRINTED accidental only where the note disagrees with the key.
          const want = keyAlterArr[((note.degree % 7) + 7) % 7];
          if (note.alter !== want) {
            const acc = note.alter > 0 ? G.sharp : note.alter < 0 ? G.flat : G.natural;
            put(acc, cxn - gw / 2 - wid(acc) - space * 0.15, y);
          }
          put(glyph, cxn - gw / 2, y);
          if (!long) {
            const up = st < 4;
            const sx = up ? cxn + gw / 2 - lineThick : cxn - gw / 2;
            g.fillRect(sx, up ? y - space * 3.2 : y, Math.max(1, lineThick), space * 3.2);
          }
          truth.push({ x: cxn / W, y: y / H, midi: note.midi, step: st });
        }
      }
      g.fillRect(W - space * 2.4, lineY(0), Math.max(1, lineThick * 1.6), lineY(4) - lineY(0));
    }

    let shot = c;
    if (camera) {
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
    const read = M.readPage(shot, W, H);
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
      clef: read.staves[0]?.clef ?? null,
      key: read.key ? (read.key.sharps ? read.key.sharps : -read.key.flats) : null,
      staves: read.staves.length,
      png: shot.toDataURL('image/png'),
    };
  }, { b64: font, study, space, camera, keyAlterArr: keyAlter(study.fifths), bottomDeg: BOTTOM[study.clef] });

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
console.log('  study                    key  clef read  key read   notes  found  matched  RIGHT PITCH');
for (const r of results) {
  const want = r.fifths;
  const keyOk = r.key === want ? ' ' : '!';
  console.log(`  ${r.file.padEnd(24)} ${String(want).padStart(3)}  ${String(r.clef ?? '—').padEnd(9)}`
    + `  ${String(r.key ?? '—').padStart(4)}${keyOk}     ${String(r.truth).padStart(4)}`
    + `  ${String(r.found ?? 0).padStart(5)}  ${String(r.matched ?? 0).padStart(7)}`
    + `  ${String(r.rightPitch ?? 0).padStart(5)} ${pc(r.rightPitch ?? 0, r.truth).padStart(7)}`);
}
const sum = (k) => results.reduce((a, r) => a + (r[k] ?? 0), 0);
console.log(`\n  notes engraved      ${sum('truth')}`);
console.log(`  found               ${sum('matched')}  ${pc(sum('matched'), sum('truth'))} recall`);
console.log(`  RIGHT PITCH         ${sum('rightPitch')}  ${pc(sum('rightPitch'), sum('truth'))} of everything engraved`);
console.log(`  no pitch at all     ${sum('noPitch')}  (clef or key unread)`);
console.log(`  key signature right ${results.filter((r) => r.key === r.fifths).length} of ${results.length}`);
const off = {};
for (const r of results) for (const [d, n] of Object.entries(r.offBy ?? {})) off[d] = (off[d] ?? 0) + n;
console.log(`  wrong by semitones  ${JSON.stringify(off)}`);
if (errs.length) console.log('\npage errors:', errs.slice(0, 3));
