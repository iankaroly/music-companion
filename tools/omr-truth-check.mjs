// IS THE MUSICXML THE MUSIC ON THE PAGE? The only instrument here that can say.
//
// The recogniser's own report counts bars, notes and how many bars add up. None
// of those is the question a player asks, which is "is this my piece": a reading
// can come back with four hundred notes, every bar adding up, and be a semitone
// out on all of them or be somebody else's tune. server/README.md says so in as
// many words — "Nothing here can tell you whether the notes that were read are
// the right PITCHES; that needs the original" — and that sentence is the reason
// a round of work on the scan pipeline could be judged by note COUNT and go
// backwards without anything noticing.
//
// So: a page whose notes are known by construction. Music is generated as a
// list of MIDI numbers, engraved by LILYPOND — a real engraver, and pointedly
// not this repo's own, because a reader graded against its author's drawing
// learns the drawing — photographed the way a phone photographs a page, brought
// in through the app's OWN straightening, sent to the pipeline, and the pitches
// that come back are lined up against the pitches that went in.
//
//   npm run dev              (on 5199 — the straightening runs in the app)
//   cd server && npm start   (or leave it: this calls the pipeline in-process)
//   npm run omr:truth
//
//   npm run omr:truth -- --keep <dir>    leave the page and the photograph
//   npm run omr:truth -- --clean-only    the ceiling: engraving straight in
//
// WHAT THE NUMBERS MEAN
//
//   in order      the longest run of the page's own notes, in the order they
//                 are printed, that the reading also has in that order. It is
//                 the honest score: a reading that finds every notehead and
//                 names them all a third out scores zero.
//   invented      notes in the reading that are not in that run. Some are real
//                 notes read in the wrong place and some are marks that are not
//                 notes; either way they are what an alignment trips over.
//   ceiling       the same music engraved and handed to the recogniser as a
//                 clean picture, with no camera in between. The gap between the
//                 ceiling and the photograph is the camera; the gap between the
//                 ceiling and 100% is the recogniser.

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : fallback;
};
const WORK = flag('keep', path.join(tmpdir(), 'music-companion-omr-truth'));
const APP = flag('app', 'http://localhost:5199');
const CLEAN_ONLY = args.includes('--clean-only');
const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';
mkdirSync(WORK, { recursive: true });

// --- the music, and therefore the truth --------------------------------------
//
// Runs and broken thirds in G major, which is where a cello part lives and what
// a study looks like: nothing but the seven notes of the key, so no accidental
// can be misread and every wrong answer is a wrong POSITION. Sixteenths in
// fours, because it is beamed groups at speed that a photograph loses first —
// "quarters and halves where the paper has semiquaver runs" — and a page of
// whole notes would say nothing about the case that goes wrong.

const SCALE = [7, 9, 11, 0, 2, 4, 6];        // G A B C D E F#
const NAME = { 7: 'g', 9: 'a', 11: 'b', 0: 'c', 2: 'd', 4: 'e', 6: 'fis' };

// A repeatable shuffle: the page has to be the same page every run, or a number
// that moved is a different page rather than a different reader.
function rolling(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function makeMusic(bars = 22, seed = 11) {
  const next = rolling(seed);
  // Degrees of the G major scale from G2 up, as an index into a ladder, so a
  // run is a run and a leap lands on a note of the key.
  const ladder = [];
  for (let octave = 3; octave <= 6; octave += 1) {
    for (const pc of SCALE) {
      const midi = pc + 12 * (octave + 1) + (pc < 7 ? 12 : 0);
      if (midi >= 55 && midi <= 88) ladder.push(midi);
    }
  }
  ladder.sort((a, b) => a - b);
  const notes = [];
  let at = 4;
  for (let bar = 0; bar < bars; bar += 1) {
    const shape = next();
    for (let beat = 0; beat < 4; beat += 1) {
      const up = next() < 0.55 ? 1 : -1;
      for (let i = 0; i < 4; i += 1) {
        notes.push(ladder[Math.max(0, Math.min(ladder.length - 1, at))]);
        // A scale run most of the time, broken thirds the rest, so the page has
        // both the shapes a study has.
        at += (shape < 0.6 ? 1 : 2) * up;
        if (at < 0) at = 1;
        if (at > ladder.length - 1) at = ladder.length - 2;
      }
    }
  }
  return notes;
}

const lilyName = (midi) => {
  const pc = ((midi % 12) + 12) % 12;
  const letter = NAME[pc];
  if (!letter) throw new Error(`${midi} is not in G major`);
  // LilyPond's c' is middle C. The octave a note is written in follows its
  // LETTER, so F# below middle C is still an f.
  const octave = Math.floor(midi / 12) - 1;
  const marks = octave - 3;
  return letter + (marks >= 0 ? "'".repeat(marks) : ','.repeat(-marks));
};

function engrave(notes) {
  const png = path.join(WORK, 'page.png');
  if (existsSync(png)) return png;
  const body = [];
  for (let i = 0; i < notes.length; i += 4) {
    body.push(notes.slice(i, i + 4).map((m, k) => `${lilyName(m)}${k === 0 ? '16' : ''}`).join(' '));
  }
  const ly = `\\version "2.24.0"
\\paper { paper-width = 8.5\\in paper-height = 11\\in top-margin = 0.55\\in bottom-margin = 0.55\\in
  left-margin = 0.6\\in right-margin = 0.6\\in indent = 0 print-page-number = ##f
  ragged-last-bottom = ##f }
\\header { title = "Study in G" composer = "for the scan check" tagline = ##f }
\\score { \\new Staff \\absolute { \\clef bass \\key g \\major \\time 4/4
  ${body.join('\n  ')} } \\layout { } }
`;
  const file = path.join(WORK, 'page.ly');
  writeFileSync(file, ly);
  execFileSync('lilypond', ['-dresolution=300', '--png', '-o', path.join(WORK, 'page'), file], { stdio: 'pipe' });
  if (!existsSync(png)) throw new Error('lilypond wrote no page.png — is the music one page?');
  return png;
}

// --- the photograph, and the page the app makes of it -------------------------

async function photograph(pngPath) {
  const browser = await puppeteer.launch({
    executablePath: SHELL,
    headless: true,
    args: ['--no-sandbox', '--js-flags=--max-old-space-size=4096'],
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  const b64 = readFileSync(pngPath).toString('base64');
  const out = await page.evaluate(async (data) => {
    const { straightenFile, readableImage, sizeOfImage } = await import('/src/ui/straighten.js');
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    const sheet = await readableImage(new File([bytes], 'page.png', { type: 'image/png' }));
    const { w: pw, h: ph } = sizeOfImage(sheet);

    // A PHONE OVER A PAGE. Twelve megapixels of frame, the page filling most of
    // it and leaning a little because nobody holds a phone square, a table
    // round it, the light falling off across the paper, and a JPEG at the end
    // of it — the four things that separate a photograph from a scan.
    const W = 3024;
    const H = 4032;
    const scratch = (a, b) => {
      const c = document.createElement('canvas');
      c.width = Math.round(a); c.height = Math.round(b); return c;
    };
    const shot = scratch(W, H);
    const g = shot.getContext('2d', { willReadFrequently: true });
    g.fillStyle = 'rgb(52,46,40)';
    g.fillRect(0, 0, W, H);
    // The page as a quadrilateral: a few degrees of lean and a little
    // perspective, drawn by mapping the engraving through it row by row.
    const quad = [[190, 150], [2880, 265], [2820, 3880], [130, 3760]];
    const source = scratch(pw, ph);
    source.getContext('2d').drawImage(sheet, 0, 0);
    const src = source.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, pw, ph);
    const im = g.getImageData(0, 0, W, H);
    const left = Math.min(...quad.map((p) => p[0]));
    const right = Math.max(...quad.map((p) => p[0]));
    const top = Math.min(...quad.map((p) => p[1]));
    const bottom = Math.max(...quad.map((p) => p[1]));
    // The inverse map, by bilinear interpolation of the quad's own coordinates:
    // for each frame pixel, where in the page it came from.
    const inQuad = (x, y) => {
      // Newton on (u,v) of the bilinear surface. Two steps is plenty here.
      let u = (x - left) / (right - left);
      let v = (y - top) / (bottom - top);
      for (let k = 0; k < 12; k += 1) {
        const px = (1 - u) * (1 - v) * quad[0][0] + u * (1 - v) * quad[1][0] + u * v * quad[2][0] + (1 - u) * v * quad[3][0];
        const py = (1 - u) * (1 - v) * quad[0][1] + u * (1 - v) * quad[1][1] + u * v * quad[2][1] + (1 - u) * v * quad[3][1];
        const dxu = -(1 - v) * quad[0][0] + (1 - v) * quad[1][0] + v * quad[2][0] - v * quad[3][0];
        const dyu = -(1 - v) * quad[0][1] + (1 - v) * quad[1][1] + v * quad[2][1] - v * quad[3][1];
        const dxv = -(1 - u) * quad[0][0] - u * quad[1][0] + u * quad[2][0] + (1 - u) * quad[3][0];
        const dyv = -(1 - u) * quad[0][1] - u * quad[1][1] + u * quad[2][1] + (1 - u) * quad[3][1];
        const det = dxu * dyv - dxv * dyu;
        if (!det) break;
        const ex = px - x;
        const ey = py - y;
        u -= (ex * dyv - ey * dxv) / det;
        v -= (dxu * ey - dyu * ex) / det;
      }
      return [u, v];
    };
    const sd = src.data;
    const od = im.data;
    for (let y = Math.floor(top); y < Math.ceil(bottom); y += 1) {
      for (let x = Math.floor(left); x < Math.ceil(right); x += 1) {
        const [u, v] = inQuad(x + 0.5, y + 0.5);
        if (u < 0 || v < 0 || u >= 1 || v >= 1) continue;
        // Three samples across the source pixel each way: the page is bigger in
        // the frame than it is on disk here, so this is a magnification and the
        // camera's own softness is what is being drawn.
        const sx = u * (pw - 1);
        const sy = v * (ph - 1);
        const x0 = sx | 0;
        const y0 = sy | 0;
        const fx = sx - x0;
        const fy = sy - y0;
        const a = (y0 * pw + x0) * 4;
        const b = a + 4;
        const c = a + pw * 4;
        const d = c + 4;
        const at = (y * W + x) * 4;
        // The light falls off towards one corner, the way a lamp behind you does.
        const lit = 1 - 0.22 * ((x / W) * 0.6 + (y / H) * 0.7);
        for (let k = 0; k < 3; k += 1) {
          const t = sd[a + k] + (sd[b + k] - sd[a + k]) * fx;
          const u2 = sd[c + k] + (sd[d + k] - sd[c + k]) * fx;
          od[at + k] = Math.max(0, Math.min(255, (t + (u2 - t) * fy) * lit));
        }
        od[at + 3] = 255;
      }
    }
    g.putImageData(im, 0, 0);
    // The camera's own softness, over the whole frame.
    const soft = scratch(W, H);
    const sg = soft.getContext('2d');
    sg.filter = 'blur(1.1px)';
    sg.drawImage(shot, 0, 0);
    sg.filter = 'none';

    const asFile = async (canvas, name, quality) => {
      const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', quality));
      return new File([blob], name, { type: 'image/jpeg' });
    };
    const photo = await asFile(soft, 'shot.jpg', 0.85);
    const kept = await straightenFile(photo);
    // The third thing that could be sent: the photograph cut to the sheet of
    // paper in it, with none of its pixels resampled.
    const { papersIn, paperCrop } = await import('/src/ui/straighten.js');
    const shotImage = await readableImage(photo);
    const shotSize = sizeOfImage(shotImage);
    const found = papersIn(shotImage, shotSize.w, shotSize.h);
    const cropped = found.length
      ? await asFile(paperCrop(shotImage, shotSize.w, shotSize.h, found[0]), 'cut.jpg', 0.92)
      : null;
    const bytesOf = async (file) => {
      const buf = new Uint8Array(await file.arrayBuffer());
      let s = '';
      for (let i = 0; i < buf.length; i += 1) s += String.fromCharCode(buf[i]);
      return btoa(s);
    };
    const shown = await readableImage(kept);
    return {
      photo: await bytesOf(photo),
      page: await bytesOf(kept),
      cut: cropped ? await bytesOf(cropped) : null,
      size: sizeOfImage(shown),
      cutSize: cropped ? sizeOfImage(await readableImage(cropped)) : null,
    };
  }, b64);
  await browser.close();
  if (errors.length) console.log(`  page errors: ${errors.join(' | ')}`);
  const photoPath = path.join(WORK, 'shot.jpg');
  const pagePath = path.join(WORK, 'page-straightened.jpg');
  const cutPath = out.cut ? path.join(WORK, 'page-cut.jpg') : null;
  writeFileSync(photoPath, Buffer.from(out.photo, 'base64'));
  writeFileSync(pagePath, Buffer.from(out.page, 'base64'));
  if (cutPath) writeFileSync(cutPath, Buffer.from(out.cut, 'base64'));
  return { photoPath, pagePath, cutPath, size: out.size, cutSize: out.cutSize };
}

// --- what came back, against what went in -------------------------------------

const STEP = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

function pitchesIn(xml) {
  const out = [];
  // One part only, and the one with the most notes: a photographed single stave
  // sometimes comes back as two parts, and reading both interleaves them.
  const parts = [...xml.matchAll(/<part\b[^>]*>([\s\S]*?)<\/part>/g)].map((m) => m[1]);
  const best = parts.sort((a, b) => (b.match(/<pitch>/g) ?? []).length - (a.match(/<pitch>/g) ?? []).length)[0] ?? '';
  for (const note of best.matchAll(/<note\b[\s\S]*?<\/note>/g)) {
    const one = note[0];
    if (/<rest\b/.test(one)) continue;
    if (/<chord\s*\/>/.test(one)) continue;          // one line of music, one voice
    const step = /<step>([A-G])<\/step>/.exec(one)?.[1];
    const octave = /<octave>(-?\d+)<\/octave>/.exec(one)?.[1];
    if (!step || octave == null) continue;
    const alter = Number(/<alter>(-?\d+)<\/alter>/.exec(one)?.[1] ?? 0);
    out.push(STEP[step] + alter + 12 * (Number(octave) + 1));
  }
  return out;
}

// The longest run of the page's notes the reading also has, in order. Anything
// cleverer — nearest-neighbour, a window, forgiving an octave — would be
// forgiving the reading for the thing that breaks an alignment.
function inOrder(want, got) {
  const n = want.length;
  const m = got.length;
  let prev = new Int32Array(m + 1);
  let row = new Int32Array(m + 1);
  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      row[j] = want[i - 1] === got[j - 1]
        ? prev[j - 1] + 1
        : Math.max(prev[j], row[j - 1]);
    }
    const swap = prev; prev = row; row = swap;
    row.fill(0);
  }
  return prev[m];
}

async function readWith(file) {
  const { convert } = await import('../server/src/pipeline.js');
  const report = { log: () => {}, stage: () => {} };
  const out = await convert({
    scoreId: `truth-${path.basename(file)}`,
    filePath: file,
    filename: path.basename(file),
    kind: /\.png$/i.test(file) ? 'image' : 'image',
    title: 'truth',
    report,
    workDir: path.join(WORK, `run-${path.basename(file)}`),
  });
  return out;
}

// --- the run ------------------------------------------------------------------

const truth = makeMusic();
console.log(`a page of ${truth.length} notes, engraved by LilyPond, in G major, bass clef`);
const pngPath = engrave(truth);

const rows = [];
const score = async (label, file) => {
  const started = Date.now();
  let result;
  try {
    result = await readWith(file);
  } catch (err) {
    rows.push({ label, failed: String(err?.message ?? err) });
    return;
  }
  const xml = result.musicXml ?? result.xml ?? readFileSync(result.xmlPath ?? '', 'utf8');
  const got = pitchesIn(xml);
  const run = inOrder(truth, got);
  rows.push({
    label,
    notes: got.length,
    run,
    recall: run / truth.length,
    invented: got.length - run,
    bars: result.score?.measureCount ?? null,
    rhythm: result.quality?.rhythmScore ?? null,
    secs: Math.round((Date.now() - started) / 1000),
  });
};

await score('the engraving itself (the ceiling)', pngPath);
if (!CLEAN_ONLY) {
  const { photoPath, pagePath, cutPath, size, cutSize } = await photograph(pngPath);
  console.log(`photographed at 3024x4032; squared up it is ${size.w}x${size.h}`
    + `${cutSize ? `, cut to the paper ${cutSize.w}x${cutSize.h}` : ', and no paper was found in it'}`);
  await score('the photograph, as taken', photoPath);
  await score('the page, squared up', pagePath);
  if (cutPath) await score('the photograph, cut to the paper', cutPath);
}

console.log('');
console.log('what was read                            notes  in order  recall  invented  bars  rhythm');
for (const row of rows) {
  if (row.failed) {
    console.log(`${row.label.padEnd(40)}  FAILED ${row.failed}`);
    continue;
  }
  console.log(`${row.label.padEnd(40)}${String(row.notes).padStart(6)}`
    + `${String(row.run).padStart(10)}`
    + `${`${(row.recall * 100).toFixed(1)}%`.padStart(8)}`
    + `${String(row.invented).padStart(10)}`
    + `${String(row.bars ?? '—').padStart(6)}`
    + `${String(row.rhythm ?? '—').padStart(8)}`);
}
console.log(`\nthe page and the photograph are in ${WORK}`);
