// DO THE BARS ON A PAGE ADD UP — measured against music whose bars are known.
//
//   npm run scan:bars-believed            32 engraved cello studies, AS SHIPPED
//   MERGE=1 npm run scan:bars-believed    …with the rejected merge switched on
//   npm run scan:bars-believed -- --phone through the phone filter
//   npm run scan:bars-believed -- --only A-major-scale
//
// Needs `npm run dev` (PORT=5199 by default).
//
// WHY THIS EXISTS, AND WHAT IT ANSWERS THAT scan:values CANNOT
//
// `npm run scan:values` scores note values against a hand-encoded truth file
// and prints how many bars `scan-values.js` believed. Both numbers are real and
// neither of them answers the question a change to the GROUPING has to answer:
// *of the bars it now believes, is the music inside them one printed bar?* A
// change that believes twice as many bars by gluing half-bars together would
// improve every number scan:values prints.
//
// These thirty-two studies are the one corpus where that is checkable. Each is
// eight bars of 4/4 — seven bars of four quarter notes and a last bar of one
// whole note — so what is ENGRAVED on the page is 4 crotchet beats per bar, on
// every bar of every page, and each printed bar's heads are known by their own
// coordinates. So this can say, per believed bar, whether it holds exactly the
// heads of one printed bar.
//
// WHAT IS DRAWN IS THE TRUTH, NOT WHAT THE MUSICXML SAYS. tools/engrave.mjs
// draws three notehead glyphs and a stem and no beams or flags at all, so a
// quarter note arrives on the page as a crotchet and a whole note as a
// semibreve. A reader that called an engraved quarter note a quaver would be
// wrong about the paper, which is what is being measured. Values below are
// therefore scored as 1 beat for a stemmed filled head and 4 for the semibreve.
//
// WHAT IT IS NOT. The engraving is this repo's own — one notehead font, no
// beams, no dots, no rests drawn, one layout — so it says NOTHING about beam
// counting, which is the biggest single source of wrong values on a
// photograph. `npm run scan:values` is the instrument for that and this does
// not replace it. What this measures is the GROUPING: whether the barlines the
// reader found, and the merge that reconciles them with the values, put the
// right heads in a bar.
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
const only = flag('only', null);

// --- MusicXML, only as much of it as a scale study uses ---------------------
//
// Lifted from tools/align-check.mjs rather than shared, for the reason written
// there: the harness that GENERATES the page must not import the reader's idea
// of anything, and a shared helper is one refactor away from doing exactly
// that.
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

let files = (await readdir(dir)).filter((f) => f.endsWith('.musicxml') || f.endsWith('.xml')).sort();
if (only) files = files.filter((f) => basename(f).includes(only));

const font = (await readFile(new URL('./fonts/Bravura.otf', import.meta.url))).toString('base64');
const browser = await puppeteer.launch({
  executablePath: SHELL, headless: true, args: ['--no-sandbox'], protocolTimeout: 240000,
});
const page = await browser.newPage();
await page.setViewport({ width: 1500, height: 2000 });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 1500));

const results = [];
for (const file of files) {
  const study = parseStudy(await readFile(join(dir, file), 'utf8'));
  const out = await page.evaluate(async ({ b64, study, space, phone, keyAlterArr, bottomDeg }) => {
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

    // --- engrave the study, exactly as tools/align-check.mjs does -----------
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
          // THE DRAWN VALUE, not the MusicXML one — see this file's header.
          // A semibreve is 4 crotchet beats, a minim 2, and everything else
          // leaves this engraver as a filled head with a stem and no beam,
          // which is a crotchet.
          truth.push({
            x: cxn / W, y: y / H, bar: sys * perSystem + bi,
            beats: long ? 4 : half ? 2 : 1,
          });
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
    const read = R.readPage(shot, shot.width, shot.height);
    if (!read) return { failed: 'the reader could not read its own engraving' };
    const heads = R.notesInOrder(read).map((h, i) => ({
      hid: i, staff: h.staff, bar: h.bar, beats: h.beats ?? 0, x: h.x, y: h.y,
    }));

    // --- which head is which printed note, by POSITION ----------------------
    const near = space * 0.6;
    const pairs = [];
    for (const [hi, h] of heads.entries()) {
      for (const [ti, t] of truth.entries()) {
        const d = Math.hypot((h.x - t.x) * W, (h.y - t.y) * H);
        if (d < near) pairs.push({ hi, ti, d });
      }
    }
    pairs.sort((a, b) => a.d - b.d);
    const tookH = new Set(); const tookT = new Set();
    // -1 where the reader never found that printed note; a head with no truth
    // index is a circle on something that is not a notehead.
    const truthOf = new Array(heads.length).fill(-1);
    for (const p of pairs) {
      if (tookH.has(p.hi) || tookT.has(p.ti)) continue;
      tookH.add(p.hi); tookT.add(p.ti);
      truthOf[p.hi] = p.ti;
    }
    return { heads, truth, truthOf, found: tookT.size };
  }, {
    b64: font, study, space, phone,
    keyAlterArr: keyAlter(study.fifths), bottomDeg: BOTTOM[study.clef],
  });
  if (out.failed) { results.push({ file, failed: out.failed }); continue; }
  results.push({ file, ...out });
  process.stdout.write('.');
}
process.stdout.write('\n');

// --- and now the analysis, through the app's own modules --------------------
//
// Imported in NODE, not in the page: nothing here needs a canvas, and a module
// imported in the page would be the second instance the CLAUDE.md note warns
// about. The reading above had to happen in a browser; this does not.
const { validateValues } = await import('../src/analysis/scan-values.js');

// --- THE EXPERIMENT THIS TOOL EXISTS TO SETTLE -------------------------------
//
// Reconcile the barlines the reader found with the values it read, by MERGING
// consecutive bar-groups until their values add up to a bar. This lived in
// src/analysis/scan-values.js for part of a round and was taken out again, and
// the reason it was taken out is the whole point of this tool: on the three
// photographs it is a clear win (the Bach page goes from 0 bars believed to 9
// of its 20, and every one of those nine holds exactly the sixteen semiquaver
// heads printed in it), and on these thirty-two engraved studies it takes bars
// believed from 6 to 28 while the bars that ARE a printed bar go only from 2 to
// 10 — eight more right bars bought with fourteen more wrong ones. The second
// number is the one that decides, and nothing measured before this tool existed
// could see it at all.
//
// It is kept here, wired into nothing the app runs, so that the next person to
// have the same idea can run it instead of building it.
const PLAUSIBLE = [1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 6];
const tick = (beats) => Math.round(beats * 16);


// How few notes a page may show before its agreement is an accident.
//
// Three bar-groups was the old floor and it is about bars, not about notes: a
// take of five notes over three fragments can agree with itself perfectly and
// say nothing. This is asked of the notes because the coverage above is.
const ENOUGH_NOTES = 12;

/**
 * Reconcile the barlines the reader found with the values it read.
 *
 * `groups` is the reader's bar-groups in reading order — one object per group,
 * each carrying `page`, `staff` and `values` (one crotchet count per note).
 * Nothing else is looked at, so a caller may hang whatever it likes on them.
 *
 * Returns { runs, beatsPerBar, covered, why }. `runs` is one entry per bar
 * AFTER the merge — `{ from, to, closed }`, inclusive indices into `groups` —
 * so the caller merges its own payload and this file never has to know what a
 * bar is made of. `closed` is true where the run's values add up to the bar
 * length chosen; a run that never added up is one group wide and `closed` is
 * false.
 *
 * MERGING ONLY, NEVER SPLITTING, and that asymmetry is the whole safety
 * argument. A barline the reader FOUND is evidence — something on the page made
 * a full-height column — and a merge only ever says "this one was not a
 * barline". A split would be inventing a barline out of the note values, which
 * is the same arithmetic in the direction where it cannot be checked, and it is
 * exactly how a page of semiquavers read half a beat short everywhere would
 * come back agreeing with itself. MEASURED, on the Bach photograph: the one
 * system whose interior barline was MISSED keeps its single group of 32 heads
 * summing to 8 beats and is refused, and that is the honest answer for it.
 *
 * WHY THE LENGTH IS CHOSEN THIS WAY, and what it would take to fool it. Every
 * plausible bar length is tried and the one that closes the most NOTES wins.
 * On a page of uniform semiquavers that sounds like it should be degenerate —
 * eight semiquavers make two beats just as sixteen make four — and it is not,
 * because a run may only close AT A BARLINE THE READER FOUND. MEASURED on
 * Bach: B=4 closes 144 of 324 notes, B=2 closes 42 and B=3 closes 42, because
 * the systems that were barred correctly have no boundary at all half way
 * through a bar. The failure this cannot see is a page where every value was
 * read at HALF its length AND the barlines are right: the sums then close at
 * the same boundaries with a bar length half as long, and 2 is as plausible a
 * bar as 4. Nothing in a note value can distinguish those two pages; a time
 * signature could, and none is read.
 */
export function regroupBars(groups) {
  const list = groups ?? [];
  const sums = list.map((g) => (g.values ?? []).reduce((a, b) => a + b, 0));
  const counts = list.map((g) => (g.values ?? []).length);
  const total = counts.reduce((a, b) => a + b, 0);
  const flat = () => list.map((_, i) => ({ from: i, to: i, closed: false }));
  if (list.length < 2 || total < ENOUGH_NOTES) {
    return { runs: flat(), beatsPerBar: null, covered: null, why: 'too few notes to tell where a bar ends' };
  }

  // A run may not cross a page or a stave: the reader numbers bars within a
  // stave and starts again on the next one, so two groups either side of a
  // system break are not adjacent music even though they are adjacent here.
  const segments = [];
  for (const [i, g] of list.entries()) {
    const last = segments.at(-1);
    if (last && list[last.at(-1)].page === g.page && list[last.at(-1)].staff === g.staff) last.push(i);
    else segments.push([i]);
  }

  const tryLength = (beats) => {
    const runs = [];
    let closedNotes = 0;
    for (const seg of segments) {
      let k = 0;
      while (k < seg.length) {
        let sum = 0;
        let end = -1;
        for (let j = k; j < seg.length; j++) {
          sum += sums[seg[j]];
          const over = tick(sum) - tick(beats);
          if (over === 0) { end = j; break; }
          if (over > 0) break;
        }
        if (end >= 0) {
          runs.push({ from: seg[k], to: seg[end], closed: true });
          for (let j = k; j <= end; j++) closedNotes += counts[seg[j]];
          k = end + 1;
        } else {
          // The run did not add up. It is emitted ONE GROUP WIDE and the walk
          // starts again at the next group rather than at the next note: the
          // group after a failure is as good a place to be right from as any,
          // and gluing the failure onto its neighbour would spread it.
          runs.push({ from: seg[k], to: seg[k], closed: false });
          k += 1;
        }
      }
    }
    runs.sort((a, b) => a.from - b.from);
    return { runs, covered: total > 0 ? closedNotes / total : 0 };
  };

  let bestBeats = null;
  let bestRun = null;
  for (const beats of PLAUSIBLE) {
    const got = tryLength(beats);
    if (!bestRun || got.covered > bestRun.covered) { bestRun = got; bestBeats = beats; }
  }
  if (!bestRun || bestRun.covered <= 0) {
    return { runs: flat(), beatsPerBar: null, covered: 0, why: 'no bar length makes these values add up' };
  }
  return { runs: bestRun.runs, beatsPerBar: bestBeats, covered: bestRun.covered, why: '' };
}


const rows = [];
for (const r of results) {
  if (r.failed) { rows.push({ file: r.file, failed: r.failed }); continue; }
  // The bar-groups exactly as scan-timing.js's barsOf builds them: consecutive
  // heads sharing (page, staff, bar). One page here, so page is constant.
  const groups = [];
  let cur = null;
  for (const h of r.heads) {
    const key = `${h.staff}|${h.bar}`;
    if (!cur || cur.key !== key) { cur = { key, staff: h.staff, heads: [] }; groups.push(cur); }
    cur.heads.push(h);
  }
  const shaped = groups.map((g) => ({
    staff: g.staff, page: 0, values: g.heads.map((h) => h.beats), heads: g.heads,
  }));
  // TWO GROUPINGS, SCORED SIDE BY SIDE. `as read` is what the app ships — the
  // reader's own bar-groups, one bar each. `merged` is the experiment above.
  // MERGE=0 prints only the shipped column.
  const merged = process.env.MERGE === '1'
    ? regroupBars(shaped)
    : { runs: shaped.map((_, i) => ({ from: i, to: i, closed: false })), beatsPerBar: null, covered: null, why: 'not merged' };
  if (process.env.DUMP_SUMS) {
    console.log(`\n  ${r.file}`);
    for (const g of shaped) console.log(`    staff ${g.staff} n=${g.values.length} sum=${g.values.reduce((a,b)=>a+b,0)} vals=${g.values.join(',')}`);
    console.log(`    chose ${merged.beatsPerBar} covered ${merged.covered}`);
  }
  // The merge hands back index runs and the caller joins its own payload — the
  // same two lines scan-timing.js's barsOf runs.
  const bars = merged.runs.map((run) => {
    const parts = shaped.slice(run.from, run.to + 1);
    return {
      closed: run.closed,
      values: parts.flatMap((p) => p.values),
      heads: parts.flatMap((p) => p.heads),
    };
  });
  const decision = validateValues(bars.map((b) => b.values));

  // Is a believed bar one printed bar?
  //
  // Judged on the heads it holds: every head in it must map to a printed note
  // of the SAME printed bar, and it must hold all of that bar's notes the
  // reader found. A bar that holds three of four is not a bar even if its
  // values add up to one.
  const printedOf = (h) => (r.truthOf[h.hid] >= 0 ? r.truth[r.truthOf[h.hid]].bar : null);
  const foundPerPrinted = new Map();
  for (const h of r.heads) {
    const b = printedOf(h);
    if (b !== null) foundPerPrinted.set(b, (foundPerPrinted.get(b) ?? 0) + 1);
  }
  let believed = 0; let believedRight = 0; let believedWrong = 0;
  let notesInBelieved = 0; let valuesRightInBelieved = 0;
  for (const [i, bar] of bars.entries()) {
    if (!(decision.ok && decision.trusted.has(i))) continue;
    believed += 1;
    const printed = bar.heads.map(printedOf);
    const one = printed.every((p) => p !== null && p === printed[0]);
    const whole = one && printed.length === foundPerPrinted.get(printed[0]);
    if (whole) believedRight += 1; else believedWrong += 1;
    for (const h of bar.heads) {
      notesInBelieved += 1;
      const t = r.truthOf[h.hid];
      if (t >= 0 && r.truth[t].beats === h.beats) valuesRightInBelieved += 1;
    }
  }
  const falseBeats = new Map();
  for (const h of r.heads) {
    if (r.truthOf[h.hid] >= 0) continue;
    falseBeats.set(h.beats, (falseBeats.get(h.beats) ?? 0) + 1);
  }
  let valuesRight = 0; let scored = 0;
  for (const h of r.heads) {
    const t = r.truthOf[h.hid];
    if (t < 0) continue;
    scored += 1;
    if (r.truth[t].beats === h.beats) valuesRight += 1;
  }
  rows.push({
    file: r.file,
    printedBars: new Set(r.truth.map((t) => t.bar)).size,
    printedHeads: r.truth.length,
    foundHeads: r.found,
    circled: r.heads.length,
    readerGroups: groups.length,
    mergedBars: bars.length,
    chose: merged.beatsPerBar,
    why: merged.why,
    covered: merged.covered,
    ok: decision.ok,
    decisionWhy: decision.why,
    believed, believedRight, believedWrong,
    notesInBelieved, valuesRightInBelieved,
    scored, valuesRight, falseBeats: [...falseBeats.entries()],
  });
}

const good = rows.filter((r) => !r.failed);
const sum = (pick) => good.reduce((a, r) => a + (pick(r) ?? 0), 0);
const pct = (a, b) => (b > 0 ? `${((a / b) * 100).toFixed(1)}%` : '—');

console.log(`\nDO THE BARS ADD UP — ${good.length} engraved cello studies${phone ? ', through the phone filter' : ''}`);
console.log('  every one is eight bars of 4/4: seven bars of four crotchets and a last bar of one semibreve,');
console.log('  so 4 crotchet beats is what is ON THE PAGE in every bar of every page.\n');
console.log(`  printed bars ${sum((r) => r.printedBars)} · printed heads ${sum((r) => r.printedHeads)}`
  + ` · heads the reader found ${sum((r) => r.foundHeads)}`);
console.log(`  bar-groups the BARLINE reader made ${sum((r) => r.readerGroups)}`
  + ` · bars after the merge ${sum((r) => r.mergedBars)}`);
const chose = new Map();
for (const r of good) chose.set(r.chose, (chose.get(r.chose) ?? 0) + 1);
console.log(`  the bar length it chose: ${[...chose.entries()]
  .sort((a, b) => b[1] - a[1]).map(([v, n]) => `${v} beats on ${n}`).join(' · ')}`);
console.log(`  pages whose values were believed at all: ${good.filter((r) => r.ok).length} of ${good.length}`);
console.log('');
console.log(`  BARS BELIEVED          ${sum((r) => r.believed)} of ${sum((r) => r.printedBars)}`
  + `  (${pct(sum((r) => r.believed), sum((r) => r.printedBars))})`);
console.log(`  …and IS ONE PRINTED BAR ${sum((r) => r.believedRight)} of ${sum((r) => r.believed)}`
  + `  (${pct(sum((r) => r.believedRight), sum((r) => r.believed))})`
  + `   WRONG ${sum((r) => r.believedWrong)}`);
console.log('');
console.log(`  VALUES, every head scored      ${sum((r) => r.valuesRight)} of ${sum((r) => r.scored)}`
  + `  (${pct(sum((r) => r.valuesRight), sum((r) => r.scored))})`);
console.log(`  VALUES, inside a believed bar  ${sum((r) => r.valuesRightInBelieved)} of ${sum((r) => r.notesInBelieved)}`
  + `  (${pct(sum((r) => r.valuesRightInBelieved), sum((r) => r.notesInBelieved))})`);
if (process.env.PER_PAGE) {
  console.log('\n  page                       printed  found  groups  merged  chose  covd  believed  right  wrong  values');
  for (const r of good) {
    console.log(`  ${basename(r.file, '.musicxml').padEnd(26)}`
      + `${String(r.printedBars).padStart(7)}${String(r.foundHeads).padStart(4)}/${String(r.circled).padStart(3)}`
      + `${String(r.readerGroups).padStart(8)}${String(r.mergedBars).padStart(8)}`
      + `${String(r.chose ?? '—').padStart(7)}${String((r.covered ?? 0).toFixed(2)).padStart(6)}${String(r.believed).padStart(10)}`
      + `${String(r.believedRight).padStart(7)}${String(r.believedWrong).padStart(7)}`
      + `  ${r.valuesRight}/${r.scored}`);
  }
}
const fb = new Map();
for (const r of good) for (const [v, n] of r.falseBeats) fb.set(v, (fb.get(v) ?? 0) + n);
console.log(`\n  CIRCLES THAT ARE NOT A PRINTED NOTEHEAD: ${[...fb.values()].reduce((a, b) => a + b, 0)}`
  + ` of ${good.reduce((a, r) => a + r.circled, 0)} circled — and the value each was given:`);
console.log(`    ${[...fb.entries()].sort((a, b) => b[1] - a[1]).map(([v, n]) => `${v} beats x${n}`).join(' · ')}`);
for (const r of rows) if (r.failed) console.log(`  FAILED ${r.file}: ${r.failed}`);
if (errs.length) console.log(`  ${errs.length} page errors, first: ${errs[0]}`);
await browser.close();
