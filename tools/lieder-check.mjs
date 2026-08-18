// The reader against REAL PUBLISHED MUSIC, engraved by a real engraver.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHAT THIS MEASURES, AND WHAT IT DOES NOT. READ THIS BEFORE QUOTING A NUMBER.
// ─────────────────────────────────────────────────────────────────────────────
//
// WHAT IT MEASURES
//   - how many staves the reader finds on a page, against how many are on it;
//   - how many noteheads it finds, against every notehead that was printed,
//     matched by position with the pairing distances and the AMBIGUITY RATE
//     printed beside them so the pairing can be distrusted when it deserves it;
//   - whether the head landed on the right LINE OR SPACE (`step`), which is the
//     placement question on its own, free of the clef and the key;
//   - whether the note is the right PITCH, which is placement plus clef plus
//     key plus accidental;
//   - which clef it read for each staff, against the clef LilyPond printed;
//   - which key signature it read for each staff, against the one in the file.
//
// WHAT IT DOES NOT MEASURE
//   - a photograph. These are clean digital rasters with no camera, no paper,
//     no pencil and no perspective. `npm run bench` is still the only thing in
//     this project that measures a page somebody photographed, and when the two
//     disagree bench is right.
//   - anything comparable to `scan:studies`. That corpus is ONE VOICE on ONE
//     STAVE, which is what src/analysis/scan-read.js was built for. THIS corpus
//     is voice-plus-piano: three staves to a system, a brace, chords, two
//     voices on a stave, lyrics under the vocal line, dynamics, pedal marks and
//     hairpins. CLAUDE.md says the reader "has never been tested on a piano
//     score, two voices on one stave, or a clef change mid-system" — this is
//     that test, so a low number here is the corpus being harder and not a
//     regression. DO NOT PUT THE PITCH PERCENTAGE FROM THIS FILE NEXT TO THE
//     ONE FROM scan:studies. They are not the same question.
//   - rests, beams, slurs, lyrics or dynamics. Only noteheads, clefs and keys.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHERE THE TRUTH COMES FROM, AND WHY IT IS NOT THE MusicXML DIRECTLY
// ─────────────────────────────────────────────────────────────────────────────
//
// ~/music-data/lieder is the OpenScore Lieder corpus: 1,462 nineteenth-century
// songs as MusicXML. `musicxml2ly` converts one to LilyPond and LilyPond
// engraves it, which gives this project the thing it has never had — a page laid
// out by somebody else's engraver, with somebody else's spacing, somebody else's
// beams and a page of furniture nothing here drew.
//
// The obvious plan is to read the pitches out of the MusicXML. THE HARD PART IS
// NOT THE PITCH, IT IS THE (x, y): a MusicXML note says what it is and says
// nothing whatever about where on the printed page it ended up, and a truth file
// that cannot point at the ink cannot score a reader that finds ink.
//
// So the truth is taken from the ENGRAVING instead. tools/lieder-truth.ily hangs
// `output-attributes` on NoteHead, Clef, KeySignature and StaffSymbol, and the
// SVG backend writes them onto the grob's own group — so every notehead arrives
// as `<g class="nh" data-midi="61" data-pos="-3" ...>` wrapped round the very
// path that draws it. Position and pitch come out of one document and cannot
// drift apart. It also means the truth describes THE INK THAT IS ON THE PAGE and
// not what the source said before conversion, which is the right question to ask
// of a reader.
//
// THE MusicXML IS STILL PARSED, as the harness's own honesty check: this file
// counts the sounding, non-hidden notes in the MusicXML and compares the whole
// multiset of pitches against the whole multiset of tagged noteheads across all
// rendered pages. The `xml↔ink` column is that comparison. It is the number
// that says whether `musicxml2ly` dropped, added, re-spelled or transposed
// anything, and a score where it disagrees is REPORTED AND STILL SCORED — the
// reader read the ink, so the ink is what it is scored against — but the column
// tells you which scores to distrust. MEASURED on Webern Op.3 no.1: 200 sounding
// notes in the MusicXML, 200 tagged noteheads over two pages, multisets equal.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY THE PAGE THE READER IS GIVEN IS THE SVG AND NOT LILYPOND'S OWN PNG
// ─────────────────────────────────────────────────────────────────────────────
//
// This was the one real trap, and it was found by cropping the page at 8x and
// looking. Rendering the same .ly twice — once `-dbackend=svg` for the truth and
// once `--png` for the pixels — gives two pages that are NOT the same page. On
// Webern Op.3 no.1 page 1 the staff lines agree to within about 2px, but inside
// a dense system the horizontal spacing drifts: the chord at bar 7 sits about
// 8px (0.8 of a staff space) further left in the Ghostscript PNG than the SVG
// says, and one notehead's whole bounding box lands on WHITE PAPER. The crop
// shows it plainly — a red cross a full notehead to the right of the head it is
// supposed to be marking, with the lyric "ving-tes." set tight in the PNG and
// "wing - tes." spread in the SVG, so the two backends are not measuring the
// text the same way and the spacing follows the text.
//
// Measured over all 159 heads on that page, ink covering the truth bounding box:
//
//                           mean   median   p10    min   boxes under 20%
//   LilyPond PNG (150dpi)   0.506   0.524  0.252  0.000        8
//   the SVG, rasterised     0.733   0.722  0.666  0.626        0
//
// So the raster the reader is handed is LilyPond's own SVG drawn into a canvas
// at a chosen width, which puts the truth and the pixels in one coordinate
// system by construction. The PNG is still rendered — it is what `--png` in the
// brief asked for, and it is a genuine second rasteriser — and the `ink` columns
// in the report are that comparison, re-measured on every run. If the SVG column
// ever falls below 100% the harness itself is broken and the run says so.
//
// ─────────────────────────────────────────────────────────────────────────────
//
//   npm run scan:lieder                          twelve scores, first page each
//   npm run scan:lieder -- --n 40                more of them
//   npm run scan:lieder -- --widths 1240,930     two rasters per page
//   npm run scan:lieder -- --pages 2             more pages per score
//   npm run scan:lieder -- --list                just say which scores it picks
//   npm run scan:lieder -- --only Webern         pick by path substring
//   npm run scan:lieder -- --keep <dir>          write the rasters out to look at
//   npm run scan:lieder -- --refresh             ignore the render cache
//
// Renders are cached under ~/.cache/music-companion/lieder keyed by the file and
// its size, so a re-run is a second and a half. A conversion that hangs is cached
// as a SKIP with its reason and is not re-paid: `Je te veux` is a 491kB MusicXML
// and musicxml2ly was still going after five minutes of one core.

import { readFile, writeFile, mkdir, readdir, stat, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, relative, basename, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import puppeteer from 'puppeteer-core';

const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const PORT = process.env.PORT ?? '5199';
const TRUTH_ILY = new URL('./lieder-truth.ily', import.meta.url).pathname;
// Bump when anything that changes the CONTENT of a cached render changes, so a
// stale cache cannot quietly go on being scored.
const CACHE_VERSION = 6;

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : fallback;
};
const has = (name) => args.includes(`--${name}`);

const dir = resolve(flag('dir', `${process.env.HOME}/music-data/lieder/scores`));
const wanted = Number(flag('n', 12));
const only = flag('only', null);
const widths = String(flag('widths', '1240,930')).split(',').map(Number).filter((n) => n > 200);
const pagesPerScore = Number(flag('pages', 1));
const cacheRoot = resolve(flag('cache', `${process.env.HOME}/.cache/music-companion/lieder`));
const keep = flag('keep', null);
const refresh = has('refresh');
const listOnly = has('list');
const noPng = has('no-png');
const convertTimeout = Number(flag('convert-timeout', 90)) * 1000;
const renderTimeout = Number(flag('render-timeout', 180)) * 1000;

// --- running a command that might never come back ---------------------------
//
// `timeout` is not on the PATH on macOS, and musicxml2ly can peg a core for
// minutes on a big file, so the kill timer lives here.
function run(cmd, argv, { cwd, timeout }) {
  return new Promise((done) => {
    const child = spawn(cmd, argv, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; let err = ''; let killed = false;
    const timer = setTimeout(() => { killed = true; child.kill('SIGKILL'); }, timeout);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => {
      clearTimeout(timer);
      done({ ok: false, reason: `${cmd} would not start: ${e.message}`, out, err });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (killed) done({ ok: false, reason: `${cmd} timed out after ${timeout / 1000}s`, out, err });
      else if (code !== 0) done({ ok: false, reason: `${cmd} exited ${code}`, out, err });
      else done({ ok: true, out, err });
    });
  });
}

// --- the MusicXML, only as much of it as the honesty check needs -------------
//
// Deliberately small and deliberately NOT the app's parser: this exists to
// disagree with the engraving when the engraving is wrong, so it must not share
// a line of code with anything that made it.
const STEP_SEMIS = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
function musicxmlTruth(xml) {
  const notes = xml.match(/<note[\s>][\s\S]*?<\/note>/g) ?? [];
  const midis = [];
  let hidden = 0; let rests = 0; let unpitched = 0;
  for (const n of notes) {
    if (/<rest[\s/>]/.test(n)) { rests++; continue; }
    // print-object="no" is a note that sounds and is NOT drawn. musicxml2ly
    // turns it into \hideNote and LilyPond emits no stencil, so it must not be
    // in the denominator either.
    if (/<note[^>]*print-object="no"/.test(n)) { hidden++; continue; }
    const step = n.match(/<step>(\w)<\/step>/);
    const oct = n.match(/<octave>(-?\d+)<\/octave>/);
    if (!step || !oct) { unpitched++; continue; }
    const alter = n.match(/<alter>(-?[\d.]+)<\/alter>/);
    midis.push((Number(oct[1]) + 1) * 12 + STEP_SEMIS[step[1]] + Math.round(Number(alter?.[1] ?? 0)));
  }
  const fifths = [...xml.matchAll(/<fifths>(-?\d+)<\/fifths>/g)].map((m) => Number(m[1]));
  return {
    midis,
    hidden,
    rests,
    unpitched,
    fifths: [...new Set(fifths)],
    transposed: /<transpose>/.test(xml),
    parts: (xml.match(/<score-part\b/g) ?? []).length,
    title: (xml.match(/<work-title>([\s\S]*?)<\/work-title>/)?.[1] ?? '').trim(),
  };
}

// --- the SVG, which is where the truth about the PAGE lives ------------------
//
// One regex per grob class. Each tagged group is `<g class="…" data-…>` and the
// next `translate(` inside it is where LilyPond put the thing; a grob with an
// empty stencil (an empty key signature, for instance) has no translate at all,
// which is why the position is optional and the callers say so.
function tagged(svg, cls) {
  const out = [];
  const open = new RegExp(`<g class="${cls}"([^>]*)>`, 'g');
  for (const m of svg.matchAll(open)) {
    const attrs = Object.fromEntries(
      [...m[1].matchAll(/data-([a-z0-9]+)="([^"]*)"/g)].map((a) => [a[1], a[2]]),
    );
    // Look only as far as the group's own end, so a grob with no stencil cannot
    // borrow the position of whatever is drawn after it.
    const rest = svg.slice(m.index + m[0].length, m.index + m[0].length + 400);
    const stop = rest.indexOf('</g>');
    const head = stop >= 0 ? rest.slice(0, stop + 4) : rest;
    const t = head.match(/translate\((-?[\d.]+),\s*(-?[\d.]+)\)/);
    out.push({ ...attrs, x: t ? Number(t[1]) : null, y: t ? Number(t[2]) : null });
  }
  return out;
}

function parsePage(svg) {
  const vb = svg.match(/viewBox="(-?[\d.]+) (-?[\d.]+) ([\d.]+) ([\d.]+)"/);
  if (!vb) return null;
  const vbw = Number(vb[3]); const vbh = Number(vb[4]);

  // A StaffSymbol's own reference point is its BOTTOM line — checked against the
  // five <line> elements it draws and against the noteheads sitting on it: a
  // head with staff-position p on that staff has y = centre - p/2, and centre
  // came out at exactly (bottom - 2) on every staff of the test page.
  const staves = tagged(svg, 'ss')
    .filter((s) => s.y !== null)
    .map((s, i) => ({ i, x: s.x, centre: s.y - 2, lines: Number(s.lines ?? 5) }))
    .sort((a, b) => a.centre - b.centre);

  const rawHeads = tagged(svg, 'nh');
  // A NOTEHEAD THAT WAS NOT DRAWN. LilyPond emits the group with its attributes
  // and nothing inside when the stencil is suppressed — a transparent head,
  // which is what musicxml2ly makes of a note it wants sounded and not seen.
  // It is not ink, so it is not truth; it is counted so the xml↔ink line can
  // explain itself instead of being a mystery. See tools/lieder-truth.ily.
  const suppressed = rawHeads.filter((h) => h.y === null).length;
  const heads = rawHeads
    .filter((h) => h.y !== null && h.midi !== '?')
    .map((h) => ({
      midi: Number(h.midi),
      pos: Number(h.pos),
      bar: h.bar === '?' ? null : Number(h.bar),
      x0: h.x + Number(h.x0), x1: h.x + Number(h.x1),
      y0: h.y + Number(h.y0), y1: h.y + Number(h.y1),
      cx: h.x + (Number(h.x0) + Number(h.x1)) / 2,
      cy: h.y + (Number(h.y0) + Number(h.y1)) / 2,
      w: Number(h.x1) - Number(h.x0),
    }));
  // A HEAD CAN BE DRAWN OFF THE PAPER, and the first version of this file put
  // 238 of them in a denominator. Jaëll's `À toi` engraves a system 330 staff
  // spaces wide onto a page 119.5 wide: LilyPond writes the whole system into
  // the SVG whatever the paper says, so a third of that page's noteheads sit
  // past the right edge where nothing can see them. The harness's own ink check
  // caught it — 238 truth boxes with no ink under them, every one at x > 119.5 —
  // which is exactly the job that check exists for. Ink that is not on the sheet
  // is not something a reader can be asked to find, so it is separated out here,
  // counted, and printed in its own column rather than quietly dropped.
  for (const h of heads) {
    h.onPage = h.x0 >= 0 && h.x1 <= vbw && h.y0 >= 0 && h.y1 <= vbh;
  }
  // A GRACE OR CUE HEAD IS A SMALLER HEAD, and the grob's own `font-size` does
  // not say so — it reads 0 on every head of every score tried, because the
  // shrinking is done by the context's fontSize and lands in the stencil rather
  // than in that property. The stencil's own width does say so: an ordinary
  // black head on this corpus is 1.30 staff spaces wide and a grace head is
  // about two thirds of that, so anything under 0.85 of the page's own median
  // is called small. They stay in the denominator — they are real ink a reader
  // has to find — and the count is printed so a bad page can be attributed.
  if (heads.length) {
    const ws = heads.map((h) => h.w).sort((a, b) => a - b);
    const median = ws[Math.floor(ws.length / 2)];
    for (const h of heads) h.small = h.w < median * 0.85;
  }
  // Attach every head to its own staff by the engraver's arithmetic rather than
  // by guessing from geometry: centre = y + pos/2, to the staff whose centre
  // that is. Ledger lines put a head nearer a neighbouring staff all the time,
  // so a nearest-staff rule would get the piano's high right hand wrong.
  for (const h of heads) {
    const want = h.cy + h.pos * 0.5;
    let best = null;
    for (const s of staves) {
      const d = Math.abs(s.centre - want);
      if (best === null || d < best.d) best = { d, s };
    }
    h.staff = best && best.d < 0.3 ? best.s.i : null;
  }

  const clefs = tagged(svg, 'cl').filter((c) => c.y !== null).map((c) => ({
    glyph: String(c.glyph ?? ''),
    pos: Number(c.pos),
    x: c.x,
    y: c.y,
    change: /_change$/.test(String(c.glyph ?? '')),
  }));
  // A clef sits on the line its own staff-position names, so the same arithmetic
  // attaches it: centre = y + pos/2.
  for (const c of clefs) {
    const want = c.y + c.pos * 0.5;
    let best = null;
    for (const s of staves) {
      const d = Math.abs(s.centre - want);
      if (best === null || d < best.d) best = { d, s };
    }
    c.staff = best && best.d < 0.3 ? best.s.i : null;
  }

  const keys = tagged(svg, 'ks').map((k) => ({ fifths: Number(k.fifths), x: k.x, y: k.y }));

  return {
    vbw, vbh, staves, clefs, keys, suppressed,
    // What is ON the sheet, which is what gets scored…
    heads: heads.filter((h) => h.onPage),
    // …and every tagged head with a position, which is what the xml↔ink
    // multiset check compares against, because a head drawn off the paper was
    // still a note in the file.
    allHeads: heads,
    offPage: heads.filter((h) => !h.onPage).length,
  };
}

// LilyPond names a clef by a glyph and a line. G on -2 is treble, F on +2 is
// bass, C on +2 is tenor and C on 0 is alto — the reader has names for the first
// three and no name at all for the fourth, so alto is reported as its own thing
// rather than counted against it.
function clefName(glyph, pos) {
  const g = glyph.replace(/_change$/, '');
  if (g === 'clefs.G') return pos === -2 ? 'treble' : `G@${pos}`;
  if (g === 'clefs.F') return pos === 2 ? 'bass' : `F@${pos}`;
  if (g === 'clefs.C') return pos === 2 ? 'tenor' : pos === 0 ? 'alto' : `C@${pos}`;
  return g;
}

// A path in this corpus is Composer/Collection/Piece/lcNNNNNN.mxl, and the
// number is the only part of it nobody can read. Composer plus piece, then.
function label(rel) {
  const parts = rel.split('/').filter((s) => s && s !== '_');
  const composer = (parts[0] ?? '').split(',')[0];
  const piece = parts.length > 1 ? parts[parts.length - 2] : '';
  return `${composer} — ${piece}`.replace(/_/g, ' ');
}

// --- picking the scores ------------------------------------------------------
async function walk(root) {
  const out = [];
  const stack = [root];
  while (stack.length) {
    const at = stack.pop();
    for (const e of await readdir(at, { withFileTypes: true })) {
      const p = join(at, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile() && p.endsWith('.mxl')) out.push(p);
    }
  }
  return out.sort();
}

const all = await walk(dir);
if (!all.length) {
  console.log(`no .mxl under ${dir}`);
  process.exit(1);
}
// Deterministic and spread across the corpus rather than across one composer:
// an even stride over the sorted list. The picks are printed, so a re-run is
// comparable and anybody can go and look at the same page.
let picks;
if (only) picks = all.filter((p) => p.toLowerCase().includes(only.toLowerCase())).slice(0, wanted);
else {
  picks = [];
  const stride = all.length / wanted;
  for (let i = 0; i < wanted && i < all.length; i++) picks.push(all[Math.floor(i * stride)]);
}
if (!picks.length) {
  console.log(`nothing under ${dir} matched --only ${only}`);
  process.exit(1);
}
if (listOnly) {
  console.log(`${all.length} scores under ${dir}; ${picks.length} picked:`);
  for (const p of picks) console.log('  ' + relative(dir, p));
  process.exit(0);
}

// --- render one score, or fetch the render out of the cache ------------------
async function renderScore(mxl) {
  const st = await stat(mxl);
  const key = createHash('sha1')
    .update(`${CACHE_VERSION} ${mxl} ${st.size} ${st.mtimeMs} ${noPng ? 'nopng' : 'png'}`)
    .digest('hex').slice(0, 16);
  const at = join(cacheRoot, key);
  const metaPath = join(at, 'meta.json');
  if (refresh && existsSync(at)) await rm(at, { recursive: true, force: true });
  if (existsSync(metaPath)) {
    try { return JSON.parse(await readFile(metaPath, 'utf8')); } catch { /* fall through and redo */ }
  }
  await mkdir(at, { recursive: true });
  const fail = async (reason) => {
    const meta = { skip: reason, mxl, at };
    await writeFile(metaPath, JSON.stringify(meta));
    return meta;
  };

  // 1. the .mxl is a zip with the MusicXML inside; container.xml names it.
  const list = await run('unzip', ['-Z1', mxl], { cwd: at, timeout: 20000 });
  if (!list.ok) return fail(list.reason);
  const inner = list.out.split('\n').map((s) => s.trim())
    .filter((s) => s && !s.startsWith('META-INF') && /\.(xml|musicxml)$/i.test(s));
  if (!inner.length) return fail('no MusicXML inside the .mxl');
  const dump = await run('unzip', ['-p', mxl, inner[0]], { cwd: at, timeout: 30000 });
  if (!dump.ok) return fail(dump.reason);
  await writeFile(join(at, 'score.xml'), dump.out);

  // 2. LilyPond source. --absolute keeps the pitches out of \relative, which
  //    matters only for reading the .ly by eye; the truth comes from the render.
  const conv = await run('musicxml2ly', ['--absolute', join(at, 'score.xml'), '-o', join(at, 'out.ly')],
    { cwd: at, timeout: convertTimeout });
  if (!conv.ok) return fail(conv.reason);
  if (!existsSync(join(at, 'out.ly'))) return fail('musicxml2ly wrote no .ly');

  // ONE BUG IN musicxml2ly, PATCHED, AND NOTHING ELSE IS TOUCHED.
  //
  // A MusicXML dynamic with words in it — `p semplice`, `f Grandioso` — comes
  // out of musicxml2ly as `#(make-dynamic-script ""p semplice"")`, with the
  // string doubled. That is not Scheme, Guile stops on it and LilyPond exits 1
  // having rendered nothing: `Unbound variable: semplice`. It took three of the
  // first twelve scores picked — a quarter of the corpus — and it is a defect in
  // the converter and not in the music, so it is repaired here rather than
  // written off. The repair touches the DEFINITION of a dynamic mark's text and
  // no note, no pitch, no clef and no layout; the count of scores it fired on is
  // printed in the report so it can never be an invisible edit.
  const ly = await readFile(join(at, 'out.ly'), 'utf8');
  const fixed = ly.replace(/make-dynamic-script ""([^"]*)""/g, 'make-dynamic-script "$1"');
  const patched = (ly.match(/make-dynamic-script ""/g) ?? []).length;
  if (patched) await writeFile(join(at, 'out.ly'), fixed);

  // 3. the engraving, with the truth hung on it.
  const svgRun = await run('lilypond',
    ['-dbackend=svg', `-dinclude-settings=${TRUTH_ILY}`, '-o', join(at, 'svg'), join(at, 'out.ly')],
    { cwd: at, timeout: renderTimeout });
  if (!svgRun.ok) {
    // The exit code alone says nothing about WHY, and "lilypond exited 1" three
    // times in a report is three unanswered questions. Carry the first error
    // line it printed.
    const why = (svgRun.err.split('\n').find((l) => /error:/.test(l)) ?? '').trim();
    return fail(`${svgRun.reason}${why ? ` — ${why.slice(0, 90)}` : ''}`);
  }

  // 4. …and Ghostscript's rasterisation of the same file, kept only as the
  //    second opinion the `ink` columns compare against.
  if (!noPng) {
    await run('lilypond',
      ['--png', '-dresolution=150', `-dinclude-settings=${TRUTH_ILY}`, '-o', join(at, 'png'), join(at, 'out.ly')],
      { cwd: at, timeout: renderTimeout });
  }

  const files = await readdir(at);
  const svgs = files.filter((f) => /^svg-\d+\.svg$/.test(f))
    .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
  // A one-page score comes out as svg.svg with no number.
  if (!svgs.length && files.includes('svg.svg')) svgs.push('svg.svg');
  if (!svgs.length) return fail('lilypond produced no SVG');
  const pngs = files.filter((f) => /^png-page\d+\.png$/.test(f))
    .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
  if (!pngs.length && files.includes('png.png')) pngs.push('png.png');

  const meta = {
    at, mxl, svgs, pngs, patched,
    warnings: (svgRun.err.match(/warning:/g) ?? []).length,
  };
  await writeFile(metaPath, JSON.stringify(meta));
  return meta;
}

// --- the browser -------------------------------------------------------------
const browser = await puppeteer.launch({ executablePath: SHELL, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1500, height: 2000 });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));
await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 1500));
// If the app did not load, everything below returns zeros and they would look
// like a reader that finds nothing. Say so instead.
const alive = await page.evaluate(async () => {
  try { const M = await import('/src/analysis/scan-read.js'); return typeof M.readPage === 'function'; }
  catch { return false; }
});
if (!alive) {
  console.log(`the app on http://localhost:${PORT}/ did not serve src/analysis/scan-read.js.`);
  console.log('start it with `npm run dev` and run this again.');
  await browser.close();
  process.exit(1);
}

// One page, one width: draw the engraving into a canvas and read it.
async function scorePage({ svgUrl, truth, width, pngData, annotate }) {
  return page.evaluate(async (arg) => {
    const { svgUrl: url, truth: T, width: W, pngData: png, annotate: draw } = arg;
    const load = (src) => new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = () => rej(new Error('image would not load'));
      im.src = src;
    });
    const drawn = (im, w, h) => {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const g = c.getContext('2d', { willReadFrequently: true });
      // White paper under it: an SVG has a transparent background and a canvas
      // starts transparent black, which binarises to a page of solid ink.
      g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
      g.drawImage(im, 0, 0, w, h);
      return c;
    };
    // How much of a truth box is inked. This is the harness checking ITSELF:
    // if the truth says a notehead is here and the paper is blank, the geometry
    // is wrong and every number that follows is worthless.
    const inkOver = (canvas, boxes, sx, sy) => {
      const g = canvas.getContext('2d', { willReadFrequently: true });
      const fr = [];
      for (const b of boxes) {
        const X0 = Math.max(0, Math.round(b.x0 * sx));
        const X1 = Math.min(canvas.width - 1, Math.round(b.x1 * sx));
        const Y0 = Math.max(0, Math.round(b.y0 * sy));
        const Y1 = Math.min(canvas.height - 1, Math.round(b.y1 * sy));
        if (X1 <= X0 || Y1 <= Y0) { fr.push(0); continue; }
        const d = g.getImageData(X0, Y0, X1 - X0 + 1, Y1 - Y0 + 1).data;
        let dark = 0;
        for (let i = 0; i < d.length; i += 4) {
          const a = d[i + 3] / 255;
          const lum = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) * a + 255 * (1 - a);
          if (lum < 160) dark++;
        }
        fr.push(dark / (d.length / 4));
      }
      return fr;
    };

    const H = Math.round(W * T.vbh / T.vbw);
    const svgImg = await load(url);
    const canvas = drawn(svgImg, W, H);
    const sx = W / T.vbw; const sy = H / T.vbh;
    const spacePx = sx;                       // one viewBox unit is one staff space
    const inkSvg = inkOver(canvas, T.heads, sx, sy);

    let inkPng = null;
    if (png) {
      try {
        const pi = await load(png);
        const pc = drawn(pi, pi.naturalWidth, pi.naturalHeight);
        inkPng = inkOver(pc, T.heads, pi.naturalWidth / T.vbw, pi.naturalHeight / T.vbh);
      } catch { inkPng = null; }
    }

    const M = await import('/src/analysis/scan-read.js');
    const read = M.readPage(canvas, W, H);
    if (!read) {
      return { failed: true, spacePx, W, H, inkSvg, inkPng };
    }
    const notes = M.notesInOrder(read).map((n) => ({
      x: n.x * W, y: n.y * H, step: n.step, midi: n.midi ?? null, staff: n.staff,
    }));

    // Pair by position, nearest first, one for one — the same rule
    // tools/study-check.mjs uses, so the two are comparable in method even
    // though they are not comparable in difficulty.
    const tol = spacePx * 0.6;
    const pairs = [];
    for (let fi = 0; fi < notes.length; fi++) {
      for (let ti = 0; ti < T.heads.length; ti++) {
        const d = Math.hypot(notes[fi].x - T.heads[ti].cx * sx, notes[fi].y - T.heads[ti].cy * sy);
        if (d < tol) pairs.push({ fi, ti, d });
      }
    }
    // HOW MANY TRUTH HEADS HAD MORE THAN ONE CANDIDATE. On a chordal page with
    // seconds and two voices to a stave, a pairing can be arbitrary — and a
    // pitch score built on an arbitrary pairing is noise wearing a percentage.
    // This is the number that says whether to believe the one below it.
    const perTruth = new Array(T.heads.length).fill(0);
    for (const p of pairs) perTruth[p.ti]++;
    const ambiguous = perTruth.filter((n) => n > 1).length;

    pairs.sort((a, b) => a.d - b.d);
    const tookF = new Set(); const tookT = new Set(); const matched = [];
    for (const p of pairs) {
      if (tookF.has(p.fi) || tookT.has(p.ti)) continue;
      tookF.add(p.fi); tookT.add(p.ti);
      matched.push({ got: notes[p.fi], want: T.heads[p.ti], d: p.d });
    }
    const ds = matched.map((m) => m.d).sort((a, b) => a - b);
    const at = (q) => (ds.length ? ds[Math.min(ds.length - 1, Math.floor(q * ds.length))] : 0);

    // `step` counts half spaces up from the BOTTOM line; LilyPond's staff
    // position counts them from the MIDDLE line. step = pos + 4.
    const rightStep = matched.filter((m) => m.got.step === m.want.pos + 4).length;
    const rightPitch = matched.filter((m) => m.got.midi !== null && m.got.midi === m.want.midi).length;
    const noPitch = matched.filter((m) => m.got.midi === null).length;
    const offBy = {};
    for (const m of matched) {
      if (m.got.midi === null || m.got.midi === m.want.midi) continue;
      const k = m.got.midi - m.want.midi;
      offBy[k] = (offBy[k] ?? 0) + 1;
    }

    // Each staff the ENGRAVER drew, against the staff the reader found nearest
    // to it — paired in node, not by index, because a reader that misses one
    // staff of a system would otherwise have every clef below it counted wrong
    // for being one row out.
    //
    // The reader gives five lines per stave, each sampled across the page and
    // normalised; the middle line averaged over the strips is the stave's
    // centre, and that is the same thing LilyPond's staff position counts from.
    const readStaves = read.staves.map((s) => {
      const mid = s.lines?.[2] ?? [];
      const at = mid.filter((v) => Number.isFinite(v));
      return {
        centre: (at.length ? at.reduce((a, b) => a + b, 0) / at.length : 0) * H,
        clef: s.clef ?? null,
        key: s.key ? (s.key.sharps ? s.key.sharps : -s.key.flats) : null,
      };
    }).sort((a, b) => a.centre - b.centre);
    return {
      failed: false, W, H, spacePx,
      readStaveCount: read.staves.length,
      readStaves,
      readHeads: notes.length,
      matched: matched.length,
      ambiguous,
      dMedian: at(0.5), dP90: at(0.9), dMax: ds.length ? ds[ds.length - 1] : 0,
      rightStep, rightPitch, noPitch, offBy,
      inkSvg, inkPng,
      pageKey: read.key ? (read.key.sharps ? read.key.sharps : -read.key.flats) : null,
      // THE PAGE WITH THE ANSWER DRAWN ON IT. Every real bug in this reader was
      // found by looking at one of these, so --keep writes one per page: a green
      // ring where a truth head was found and named right, an amber ring where
      // it was found and named wrong or not at all, a red cross where a printed
      // head was never found, and a blue cross on everything the reader circled
      // that no printed head accounts for.
      annotated: draw ? (() => {
        const a = document.createElement('canvas');
        a.width = W; a.height = H;
        const g2 = a.getContext('2d');
        g2.drawImage(canvas, 0, 0);
        g2.lineWidth = 1.4;
        const r = Math.max(3, spacePx * 0.55);
        const cross = (x, y, c) => {
          g2.strokeStyle = c;
          g2.beginPath();
          g2.moveTo(x - r, y - r); g2.lineTo(x + r, y + r);
          g2.moveTo(x + r, y - r); g2.lineTo(x - r, y + r);
          g2.stroke();
        };
        for (const m of matched) {
          const right = m.got.midi !== null && m.got.midi === m.want.midi;
          g2.strokeStyle = right ? '#0a0' : '#e80';
          g2.beginPath(); g2.arc(m.want.cx * sx, m.want.cy * sy, r, 0, 7); g2.stroke();
        }
        for (let ti = 0; ti < T.heads.length; ti++) {
          if (tookT.has(ti)) continue;
          cross(T.heads[ti].cx * sx, T.heads[ti].cy * sy, '#d00');
        }
        for (let fi = 0; fi < notes.length; fi++) {
          if (tookF.has(fi)) continue;
          cross(notes[fi].x, notes[fi].y, '#06c');
        }
        return a.toDataURL('image/png');
      })() : null,
    };
  }, { svgUrl, truth, width, pngData, annotate });
}

// --- go ----------------------------------------------------------------------
if (keep) await mkdir(keep, { recursive: true });
const results = [];
const skipped = [];
console.log(`\nrendering ${picks.length} scores from ${dir} …`);

for (const mxl of picks) {
  const name = relative(dir, mxl).replace(/\.mxl$/, '');
  const meta = await renderScore(mxl);
  if (meta.skip) { skipped.push({ name, why: meta.skip }); continue; }

  const xml = musicxmlTruth(await readFile(join(meta.at, 'score.xml'), 'utf8'));
  // The whole score's ink, for the xml↔ink check — every page, not just the
  // pages that get scored, or the check would compare a part with a whole.
  const allPages = [];
  for (const f of meta.svgs) {
    const parsed = parsePage(await readFile(join(meta.at, f), 'utf8'));
    if (parsed) allPages.push(parsed);
  }
  if (!allPages.length) { skipped.push({ name, why: 'no page parsed out of the SVG' }); continue; }
  const suppressed = allPages.reduce((a, p) => a + p.suppressed, 0);
  const offPage = allPages.reduce((a, p) => a + p.offPage, 0);
  const inkMidis = allPages.flatMap((p) => p.allHeads.map((h) => h.midi)).sort((a, b) => a - b);
  const xmlMidis = [...xml.midis].sort((a, b) => a - b);
  const bag = (arr) => { const m = new Map(); for (const v of arr) m.set(v, (m.get(v) ?? 0) + 1); return m; };
  const bx = bag(xmlMidis); const bi = bag(inkMidis);
  let onlyXml = 0; let onlyInk = 0;
  for (const [k, v] of bx) onlyXml += Math.max(0, v - (bi.get(k) ?? 0));
  for (const [k, v] of bi) onlyInk += Math.max(0, v - (bx.get(k) ?? 0));

  // A key column is only honest where the file has one key and does not
  // transpose. Where it changes, say so and score everything else.
  const keyStable = xml.fifths.length === 1 && !xml.transposed;
  const truthFifths = keyStable ? xml.fifths[0] : null;
  // …and the engraving must agree with the file about it, or the column is
  // measuring the conversion and not the reader.
  const inkFifths = [...new Set(allPages.flatMap((p) => p.keys.map((k) => k.fifths)))];
  const keyAgreed = keyStable && inkFifths.length === 1 && inkFifths[0] === truthFifths;

  const perPage = [];
  for (let pi = 0; pi < Math.min(pagesPerScore, meta.svgs.length); pi++) {
    const truth = allPages[pi];
    const svgBuf = await readFile(join(meta.at, meta.svgs[pi]));
    // Base64 here and not in the page: String.fromCharCode(...bytes) on a
    // 300kB engraving overflows the argument stack in V8.
    const svgUrl = `data:image/svg+xml;base64,${svgBuf.toString('base64')}`;
    let pngData = null;
    if (meta.pngs[pi]) {
      const buf = await readFile(join(meta.at, meta.pngs[pi]));
      pngData = `data:image/png;base64,${buf.toString('base64')}`;
    }
    for (const width of widths) {
      const out = await scorePage({ svgUrl, truth, width, pngData, annotate: !!keep });
      if (keep && out.annotated) {
        await writeFile(join(keep, `${basename(name)}-p${pi + 1}-${width}.png`),
          Buffer.from(out.annotated.split(',')[1], 'base64'));
      }
      delete out.annotated;
      const inkOk = (arr) => (arr ? arr.filter((v) => v >= 0.2).length : null);
      const rec = {
        page: pi + 1, width, ...out,
        truthHeads: truth.heads.length,
        truthStaves: truth.staves.length,
        smallHeads: truth.heads.filter((h) => h.small).length,
        inkSvgOk: inkOk(out.inkSvg), inkPngOk: inkOk(out.inkPng),
      };
      delete rec.inkSvg; delete rec.inkPng;

      // CLEFS AND KEYS, staff by staff — but paired by WHERE THE STAFF IS, not
      // by index. A page where the reader misses one staff of a system, or
      // invents one, would otherwise have every staff below it compared with
      // the wrong truth and the whole column would read as wrong clefs. Nearest
      // centre, one for one, and no pair further apart than two staff spaces.
      const truthClefs = truth.staves.map((s) => {
        const own = truth.clefs.filter((c) => c.staff === s.i && !c.change).sort((a, b) => a.x - b.x);
        return {
          centre: s.centre * (out.H / truth.vbh),
          clef: own.length ? clefName(own[0].glyph, own[0].pos) : null,
        };
      });
      rec.truthClefs = truthClefs.map((t) => t.clef);
      rec.midClefChanges = truth.clefs.filter((c) => c.change).length;
      rec.clefRight = 0; rec.clefWrong = 0; rec.clefNone = 0; rec.clefPaired = 0;
      rec.keyRight = 0; rec.keyWrong = 0; rec.keyNone = 0;
      rec.keyScored = keyAgreed;
      rec.stavesUnpaired = truthClefs.length;
      if (!out.failed && out.readStaves) {
        const lim = (out.spacePx ?? 10) * 2;
        const cand = [];
        for (let a = 0; a < truthClefs.length; a++) {
          for (let b = 0; b < out.readStaves.length; b++) {
            const d = Math.abs(truthClefs[a].centre - out.readStaves[b].centre);
            if (d <= lim) cand.push({ a, b, d });
          }
        }
        cand.sort((p, q) => p.d - q.d);
        const tookA = new Set(); const tookB = new Set();
        for (const c of cand) {
          if (tookA.has(c.a) || tookB.has(c.b)) continue;
          tookA.add(c.a); tookB.add(c.b);
          rec.clefPaired++;
          const got = out.readStaves[c.b];
          if (got.clef === null) rec.clefNone++;
          else if (got.clef === truthClefs[c.a].clef) rec.clefRight++;
          else rec.clefWrong++;
          if (keyAgreed) {
            if (got.key === null) rec.keyNone++;
            else if (got.key === truthFifths) rec.keyRight++;
            else rec.keyWrong++;
          }
        }
        rec.stavesUnpaired = truthClefs.length - rec.clefPaired;
      }
      perPage.push(rec);
    }
    if (keep) {
      await writeFile(join(keep, `${basename(name)}-p${pi + 1}.truth.json`),
        JSON.stringify(truth.heads.map((h) => ({
          cx: h.cx, cy: h.cy, midi: h.midi, pos: h.pos, bar: h.bar, small: !!h.small,
        })), null, 1));
    }
  }
  results.push({
    name, meta, xml, onlyXml, onlyInk, suppressed, offPage, inkTotal: inkMidis.length,
    patched: meta.patched ?? 0,
    keyStable, keyAgreed, truthFifths, inkFifths, pages: meta.svgs.length, perPage,
  });
}
await browser.close();

// --- the report --------------------------------------------------------------
const pc = (a, b) => (b ? `${(a / b * 100).toFixed(1)}%` : '  — ');
const pad = (s, n) => String(s).padEnd(n).slice(0, n);
const num = (s, n) => String(s).padStart(n);

console.log('\nTHE READER ON REAL PUBLISHED LIEDER — OpenScore, engraved by LilyPond');
console.log('voice and piano: three staves to a system, chords, two voices to a stave, lyrics.');
console.log('This is NOT a photograph and NOT comparable with scan:studies — see the file header.\n');

console.log(`  ${pad('score', 46)} pages  xml notes  ink heads  not drawn  off page  xml↔ink`);
for (const r of results) {
  const agree = (r.onlyXml === 0 && r.onlyInk === 0) ? 'same'
    : `-${r.onlyXml}/+${r.onlyInk}`;
  console.log(`  ${pad(label(r.name), 46)} ${num(r.pages, 5)}  ${num(r.xml.midis.length, 9)}`
    + `  ${num(r.inkTotal, 9)}  ${num(r.suppressed, 9)}  ${num(r.offPage, 8)}  ${num(agree, 7)}`);
}
const badXml = results.filter((r) => r.onlyXml || r.onlyInk);
console.log(`\n  xml↔ink: ${results.length - badXml.length} of ${results.length} scores have the`
  + ' MusicXML\'s pitches and the engraved noteheads as the SAME MULTISET.');
if (badXml.length) {
  console.log('  DISAGREEING (musicxml2ly changed something; scored against the ink anyway):');
  for (const r of badXml) {
    console.log(`    ${pad(label(r.name), 46)} in xml only ${r.onlyXml}, on the page only ${r.onlyInk}`
      + `${r.suppressed ? `, of which ${r.suppressed} head(s) the engraving suppressed` : ''}`);
  }
}

for (const width of widths) {
  const rows = results.flatMap((r) => r.perPage.filter((p) => p.width === width)
    .map((p) => ({ r, p })));
  if (!rows.length) continue;
  const space = rows[0].p.spacePx;
  // The reader works at WORK_WIDTH = 1400 and scales the page down to it, so
  // the staff space it actually sees is not the one drawn.
  const eff = space * Math.min(1400, rows[0].p.W) / rows[0].p.W;
  console.log(`\n─── raster ${width}px wide — staff space ${space.toFixed(1)}px drawn,`
    + ` ${eff.toFixed(1)}px as the reader sees it ───\n`);
  console.log(`  ${pad('score', 34)} pg  staves     heads found        step   PITCH   amb  ink svg/png`);
  for (const { r, p } of rows) {
    if (p.failed) {
      console.log(`  ${pad(label(r.name), 34)} ${num(p.page, 2)}  readPage found no page at this size`);
      continue;
    }
    console.log(`  ${pad(label(r.name), 34)} ${num(p.page, 2)}`
      + `  ${num(`${p.readStaveCount}/${p.truthStaves}`, 6)}`
      + `  ${num(p.matched, 4)}/${num(p.truthHeads, 4)} ${pc(p.matched, p.truthHeads)}`
      + `  ${num(pc(p.rightStep, p.matched), 6)}`
      + `  ${num(pc(p.rightPitch, p.truthHeads), 6)}`
      + `  ${num(p.ambiguous, 4)}`
      + `  ${num(pc(p.inkSvgOk, p.truthHeads), 6)}/${p.inkPngOk === null ? ' — ' : pc(p.inkPngOk, p.truthHeads)}`);
  }
  const S = (k) => rows.reduce((a, { p }) => a + (p[k] ?? 0), 0);
  const heads = S('truthHeads');
  console.log(`\n  staves          ${S('readStaveCount')} found, ${S('truthStaves')} engraved`);
  console.log(`  NOTEHEADS       ${S('truthHeads')} engraved (${S('smallHeads')} grace or cue)`);
  console.log(`  found           ${S('matched')}  ${pc(S('matched'), heads)} recall`
    + `   (the reader circled ${S('readHeads')} things in all)`);
  console.log(`  RIGHT LINE      ${S('rightStep')}  ${pc(S('rightStep'), S('matched'))} of the matched`
    + '   (position alone, no clef and no key)');
  console.log(`  RIGHT PITCH     ${S('rightPitch')}  ${pc(S('rightPitch'), heads)} of everything engraved`);
  console.log(`  no pitch at all ${S('noPitch')}   (clef or key unread — a refusal, not a wrong answer)`);
  const off = {};
  for (const { p } of rows) for (const [d, n] of Object.entries(p.offBy ?? {})) off[d] = (off[d] ?? 0) + n;
  console.log(`  wrong by semitones ${JSON.stringify(off)}`);
  const dm = rows.map(({ p }) => p.dMedian ?? 0).filter((v) => v > 0).sort((a, b) => a - b);
  const dp = rows.map(({ p }) => p.dP90 ?? 0).filter((v) => v > 0).sort((a, b) => a - b);
  console.log(`\n  HOW GOOD IS THE PAIRING — tolerance ${(space * 0.6).toFixed(1)}px`
    + ` (0.6 staff space)`);
  console.log(`    matched distance, median of the pages  ${(dm[Math.floor(dm.length / 2)] ?? 0).toFixed(2)}px`
    + `   p90 ${(dp[Math.floor(dp.length / 2)] ?? 0).toFixed(2)}px`);
  console.log(`    truth heads with MORE THAN ONE candidate inside the tolerance  ${S('ambiguous')}`
    + `  ${pc(S('ambiguous'), heads)}`);
  console.log('    …that is the share of the pitch column that could have been paired either way.');
  console.log(`\n  CLEFS   ${S('clefRight')} right, ${S('clefWrong')} WRONG, ${S('clefNone')} not read`
    + `, of ${S('clefPaired')} staves paired top to bottom`);
  const keyRows = rows.filter(({ p }) => p.keyScored);
  const kS = (k) => keyRows.reduce((a, { p }) => a + (p[k] ?? 0), 0);
  console.log(`  KEYS    ${kS('keyRight')} right, ${kS('keyWrong')} WRONG, ${kS('keyNone')} not read`
    + `   (over ${keyRows.length} of ${rows.length} pages whose file and engraving agree on one key)`);
  console.log(`  a mid-system clef change appears ${S('midClefChanges')} times on these pages`);

  // The harness checking itself, loudest last.
  const inkBad = rows.filter(({ p }) => p.inkSvgOk !== null && p.inkSvgOk < p.truthHeads);
  if (inkBad.length) {
    console.log('\n  ** THE HARNESS IS SUSPECT ON THESE PAGES: a truth notehead box with no ink in it');
    console.log('     means the truth and the raster are not the same page. Do not quote the row.');
    for (const { r, p } of inkBad) {
      console.log(`     ${pad(label(r.name), 40)} p${p.page}  ${p.truthHeads - p.inkSvgOk} boxes under 20% ink`);
    }
  } else {
    console.log('\n  every truth notehead box has ink under it on every page: the truth and the'
      + ' raster are the same page.');
  }
  const pngTotal = rows.reduce((a, { p }) => a + (p.inkPngOk ?? 0), 0);
  const pngPages = rows.filter(({ p }) => p.inkPngOk !== null);
  if (pngPages.length) {
    const pngHeads = pngPages.reduce((a, { p }) => a + p.truthHeads, 0);
    console.log(`  the same boxes over LILYPOND'S OWN PNG: ${pc(pngTotal, pngHeads)} — the two`
      + ' backends do not lay a system out identically, which is why the SVG is what is read.');
  }
}

if (skipped.length) {
  console.log(`\n  SKIPPED ${skipped.length} of ${picks.length} scores, and they are not in any`
    + ' denominator above:');
  for (const s of skipped) console.log(`    ${pad(label(s.name), 46)} ${s.why}`);
}
const patchedScores = results.filter((r) => r.patched);
if (patchedScores.length) {
  console.log(`\n  ${patchedScores.length} of ${results.length} scores needed musicxml2ly's`
    + ' `make-dynamic-script ""x""` repaired before LilyPond would read them at all.'
    + ' It changes the TEXT OF A DYNAMIC MARK and nothing else — see renderScore.');
}
console.log('\n  picked deterministically by an even stride over the sorted corpus'
  + ` (${all.length} scores); re-run with --list to see the picks alone.`);
if (pageErrors.length) console.log('\n  page errors:', pageErrors.slice(0, 3));
