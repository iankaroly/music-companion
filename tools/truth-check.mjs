// The reader scored against a page somebody actually looked at.
//
// WHY THIS EXISTS
//
// Every number about noteheads until now came from pages the benchmark drew
// itself. Those pages have no pencil bowings on them, no fingerings, no editor's
// heading, no bar numbers and no half-erased anything — which is to say they are
// missing precisely the marks that the reader is mistaking for notes. So a
// filter could be measured at 100% on the corpus and still be the filter that
// collapsed a real page from 477 heads to 190.
//
// The other half of the measurement is ground truth on a REAL page, and the only
// thing that can produce it is a person looking. tools/reader-look.html has a
// marking mode for exactly that: reject the rings that are not notes, add the
// ones that were missed, save. This scores a run of the shipped reader against
// what came out.
//
//   npm run scan:truth -- <file.pdf|png> --truth <file.truth.json>
//
// It prints precision and recall, and then — the part a count cannot give you —
// WHERE every false notehead is and WHERE every missed one is, in staff and bar
// terms, so the populations can be named and attacked one at a time.
//
// Matching is by position, at half a staff space. See the note in reader-look
// about why labels are positions: a label keyed to "note number 231" is a label
// about a build of the reader and is void the moment the detector changes, which
// is the one thing the labels exist to permit.

import { readFile, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import puppeteer from 'puppeteer-core';

const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const PORT = process.env.PORT ?? '5199';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--truth');
const flag = (name) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : null;
};
const truthPath = flag('truth');
const wantJson = args.includes('--json');
const showAll = args.includes('--all');

if (!file || !truthPath) {
  console.log('usage: npm run scan:truth -- <file.pdf|png> --truth <file.truth.json>');
  console.log('       mark the page first in tools/reader-look.html and press "save truth"');
  process.exit(1);
}

const truth = JSON.parse(await readFile(truthPath, 'utf8'));
if (!Array.isArray(truth.notes) || !truth.notes.length) {
  console.log(`${truthPath} holds no marked notes.`);
  process.exit(1);
}

const bytes = await readFile(file);
const base64 = bytes.toString('base64');
const isPdf = /\.pdf$/i.test(file);

const browser = await puppeteer.launch({ executablePath: SHELL, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 1800, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 1600));

const report = await page.evaluate(async ({ b64, pdf, want }) => {
  const { readPage, notesInOrder, beamMask } = await import('/src/analysis/scan-read.js');

  // The app's own path to pixels. sips and pdf.js do not agree and the reader
  // can tell; see tools/real-check.mjs, which learned that the hard way.
  async function toCanvas() {
    const binary = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
    if (!pdf) {
      const bitmap = await createImageBitmap(new Blob([binary]));
      const c = document.createElement('canvas');
      c.width = bitmap.width; c.height = bitmap.height;
      c.getContext('2d').drawImage(bitmap, 0, 0);
      bitmap.close?.();
      return c;
    }
    const pdfjs = await import('/node_modules/pdfjs-dist/build/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = '/node_modules/pdfjs-dist/build/pdf.worker.mjs';
    const doc = await pdfjs.getDocument({ data: binary }).promise;
    const first = await doc.getPage(1);
    const scale = 1800 / first.getViewport({ scale: 1 }).width;
    const viewport = first.getViewport({ scale });
    const c = document.createElement('canvas');
    c.width = viewport.width; c.height = viewport.height;
    await first.render({ canvasContext: c.getContext('2d'), viewport }).promise;
    return c;
  }

  const source = await toCanvas();
  const W = Math.min(1400, source.width);
  const work = document.createElement('canvas');
  work.width = W;
  work.height = Math.round(source.height * (W / source.width));
  work.getContext('2d').drawImage(source, 0, 0, work.width, work.height);

  const read = readPage(work, work.width, work.height);
  if (!read) return { failed: 'the reader found no stave on this page' };
  const found = notesInOrder(read);
  // The staves' own space, not the page-wide estimate the comb was built from —
  // that comes out about a sixth low, so half of it is 0.41 of a space, not
  // half. reader-look.html computes this identically and the two MUST agree:
  // a label made at one tolerance and scored at another means two things.
  const spaces = read.staves.map((s) => s.space * work.height).sort((a, b) => a - b);
  const space = spaces.length
    ? spaces[Math.floor((spaces.length - 1) / 2)]
    : (read.space ?? 0.012) * work.height;
  const near = space * 0.5;

  // Greedy nearest matching, closest pairs first, so a detection cannot claim a
  // truth note that another detection sits right on top of.
  const pairs = [];
  for (const [fi, f] of found.entries()) {
    for (const [ti, t] of want.entries()) {
      const d = Math.hypot((f.x - t.x) * work.width, (f.y - t.y) * work.height);
      if (d < near) pairs.push({ fi, ti, d });
    }
  }
  pairs.sort((a, b) => a.d - b.d);
  const tookF = new Set(); const tookT = new Set();
  for (const p of pairs) {
    if (tookF.has(p.fi) || tookT.has(p.ti)) continue;
    tookF.add(p.fi); tookT.add(p.ti);
  }

  // Is this point standing on the furniture at the head of a system?
  //
  // "In the clef band" and "on the key signature" are two different populations
  // with two different fixes, and both of them look like "a false circle near
  // the left edge" in a list of coordinates. The reader now reports both bands,
  // so the question is asked of what it actually found rather than of a guess
  // at where the furniture usually is.
  //
  // Asked of the point's OWN system, not of any system that happens to print
  // its key signature at that x. Every system on a page starts at the same
  // margin, so "some stave has a band here" is true of all of them and says
  // nothing — and the interesting case is precisely the system whose band was
  // NOT found while its neighbours' were.
  const furniture = (sys, x) => {
    const s = read.staves[sys];
    if (!s) return null;
    if (s.keyBand && x >= s.keyBand.x - s.space * 0.6 && x <= s.keyBand.x + s.keyBand.w + s.space * 0.6) return 'key';
    if (s.clefZone && x >= (s.edge ?? s.clefZone.x) && x <= s.clefZone.x + s.clefZone.w) return 'clef';
    // The x where the OTHER systems print their signature, on a system that
    // found none of its own. This is the population that says the suppression
    // did not run rather than that it ran and let something through.
    //
    // Measured from each stave's OWN left end, not in absolute x. An engraver
    // indents the first system of a piece, so on the Scanned score system 2
    // begins at x = 193 and prints its signature at 241 while systems 3 to 11
    // begin at 57 and print theirs at 101 to 120. Unioned in absolute x that is
    // a band from 101 to 277 — a fifth of the page width — and an invented head
    // at x = 281, nowhere near where any system prints a signature, came back
    // labelled `key-unfound`. Which was the one piece of evidence pointing at a
    // furniture escape in a population that turned out to be the stem pass.
    // This is the same correction dropFurniture's own comment describes.
    const relative = read.staves
      .filter((k) => k.keyBand && k.edge != null)
      .map((k) => [k.keyBand.x - k.edge, k.keyBand.x + k.keyBand.w - k.edge]);
    if (relative.length && s.edge != null) {
      const x0 = Math.min(...relative.map((b) => b[0])) + s.edge;
      const x1 = Math.max(...relative.map((b) => b[1])) + s.edge;
      if (x >= x0 - s.space * 0.6 && x <= x1 + s.space * 0.6) return 'key-unfound';
    }
    return null;
  };

  const where = (x, y) => {
    // Which system a stray mark belongs to, said by nearest stave rather than
    // by containment: half of what the reader invents is ABOVE or BELOW the
    // stave it came from, and those are the interesting ones.
    let sys = 0; let gap = Infinity;
    for (const [i, s] of read.staves.entries()) {
      const mid = (s.lines[2][Math.min(s.lines[2].length - 1,
        Math.round(x * (s.lines[2].length - 1)))]);
      const d = Math.abs(mid - y);
      if (d < gap) { gap = d; sys = i; }
    }
    const staff = read.staves[sys];
    let bar = 0;
    for (const bx of staff.bars ?? []) if (x > bx) bar++;
    const bottom = staff.lines[4][Math.min(staff.lines[4].length - 1,
      Math.round(x * (staff.lines[4].length - 1)))];
    return {
      system: sys + 1,
      bar: bar + 1,
      step: Math.round((bottom - y) * work.height / (staff.space * work.height / 2)),
    };
  };

  // WHAT IS THE INK UNDER THIS CIRCLE ARRANGED AS?
  //
  // The user's first complaint, in their words, is that "many false circles
  // still happen oftentimes in the stem at the bottom". Every round so far has
  // answered that with the `by pass` line above — shape against stem — and that
  // line is NOT a measurement of it. `by pass` says which code path PROPOSED a
  // head; the complaint is about WHERE THE CIRCLE SITS. The two are different
  // populations and the difference is not small: hand-classified, 45 of the 83
  // false circles on the three marked pages sit in a stem, and only 13 of those
  // 45 came from the stem pass. Quoting `by pass` at the user understates their
  // complaint by a factor of three, and five candidate rules have been rejected
  // after being scored against the wrong population.
  //
  // The Bach's circle at (117,1815) is the case that settles it: it is a ring at
  // the foot of a stem where the stem meets the beam, and `by pass` calls it
  // `shape`. So this asks the page instead. A circle "at the foot of a stem" is
  // an arrangement of ink and is detectable as one:
  //
  //   - a thin vertical run of ink passes through or ends at the candidate;
  //   - a real notehead stands on that same run, a note's height away or more;
  //   - and the candidate is therefore somewhere along the stem rather than on
  //     the head the stem belongs to.
  //
  // THE HEADS IT ASKS ABOUT ARE THE TRUTH MARKS, not the reader's own output,
  // so the classification cannot be moved by the thing being measured. On a page
  // whose truth file is incomplete that costs a label: a stem whose head nobody
  // marked comes back `stem` rather than `stem-foot`. That is the safe
  // direction — it can only ever UNDER-count the population being complained
  // about — and it is why both lines are printed.
  //
  // Every bound below is the reader's own, taken from `stemHeads` in
  // scan-read.js, except where a comment says otherwise:
  //   STEM_TALL 2.0 spaces — shorter than this is a flag or a bar
  //   STEM_WIDE 0.35      — wider than this is not a stem
  // The width test is applied to the LOW QUARTILE of the width down the run,
  // where the reader asks it of the width at the run's MIDPOINT. That is not a
  // liberty, it is the same correction `beamMask` already makes about its own
  // baseline four hundred lines above: "the low quartile is the beam where it is
  // only itself". A stem is wide exactly where something joins it — its own
  // head at one end, the beam at the other — and the midpoint of a short
  // photographed stem is inside one of those. MEASURED on the Bach's circle at
  // (117,1815), which is the case that started this round: the columns at
  // x = 112..114 run 3.29 to 3.46 spaces and their MEDIAN width is 1.07 spaces
  // against a stem's 0.35, because the beam under them is a third of the run.
  // Their low quartile is 0.25. The median rejects the named example; the low
  // quartile finds it, at the reader's own 0.35.
  const shapeOf = (() => {
    const px = work.getContext('2d', { willReadFrequently: true })
      .getImageData(0, 0, work.width, work.height).data;
    const W = work.width; const H = work.height;
    const gray = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) {
      gray[i] = px[i * 4] * 0.299 + px[i * 4 + 1] * 0.587 + px[i * 4 + 2] * 0.114;
    }
    // The same local threshold findHeads works from — box blur, then ink is
    // anything 16 grey levels under its own neighbourhood. Copied from
    // tools/head-probe.mjs, which copied it from scan-read.js; nothing in
    // src/analysis is touched by this tool.
    const rad = Math.max(4, Math.round(W / 36)); const span = rad * 2 + 1;
    const t1 = new Float32Array(W * H); const bg = new Float32Array(W * H);
    for (let y = 0; y < H; y++) {
      let s = 0;
      for (let x = -rad; x <= rad; x++) s += gray[y * W + Math.min(W - 1, Math.max(0, x))];
      for (let x = 0; x < W; x++) {
        t1[y * W + x] = s / span;
        s += gray[y * W + Math.min(W - 1, x + rad + 1)] - gray[y * W + Math.max(0, x - rad)];
      }
    }
    for (let x = 0; x < W; x++) {
      let s = 0;
      for (let y = -rad; y <= rad; y++) s += t1[Math.min(H - 1, Math.max(0, y)) * W + x];
      for (let y = 0; y < H; y++) {
        bg[y * W + x] = s / span;
        s += t1[Math.min(H - 1, y + rad + 1) * W + x] - t1[Math.max(0, y - rad) * W + x];
      }
    }
    const ink = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) ink[i] = gray[i] < bg[i] - 16 ? 1 : 0;
    // The beams, by difference. beamMask erases a long horizontal run of short
    // columns and spares any column with something tall joining it, so ink the
    // mask removed is beam or rule with nothing attached — which is precisely
    // "the circle is sitting on a beam BETWEEN the stems" as opposed to at the
    // junction where a stem meets one.
    const body = beamMask(ink, W, H, space);

    // THE STEM IS MEASURED IN `body`, NOT IN `ink`, and that is the single
    // change that made this instrument work at all. In `ink` a stem crosses a
    // staff line every space, and a staff line is a horizontal run hundreds of
    // pixels long — so "how wide is the ink across this stem" answers three
    // hundred at every line it crosses, and on a page whose stems are short
    // (the Concerto's are two spaces between head and beam) most of the run is
    // line-crossing rather than stem. MEASURED on the Concerto's circle at
    // (238,686): in `ink` the stem columns at x = 241..243 run 3.8 spaces with a
    // low-quartile width of 1.10 spaces — wider than a notehead, so no stem is
    // recognised and the point is filed as `beam`. The same columns in `body`
    // run the same 3.8 spaces at a low-quartile width of 0.40. Fifteen of the
    // Concerto's thirty-seven false circles moved on that one line.
    //
    // `body` is also the layer `findHeads` itself looks at, which is the honest
    // choice for a measurement about what the head finder did.
    // A SECOND LOOK IN THE RAW INK WAS TRIED AND IS NOT WORTH KEEPING. The case
    // it was written for is the Scanned score's circle at (306,1100), where
    // `body`'s columns at x = 299..301 run only 1.76 spaces because the mask
    // erased the beam column the stem was hanging from. Searching both layers and
    // keeping the longer qualifying run changed NOT ONE of the 83 false circles
    // or the 1037 correct heads on the three pages, and the reason is that the
    // raw ink puts the staff lines back: those same columns read a low-quartile
    // width of 3.11 spaces. Cropped, that circle turns out not to be a stem case
    // at all — it stands on the beam 1.2 spaces to the right of the stem, which
    // is what `beam` already says about it.
    const inBody = (x, y) => (x >= 0 && x < W && y >= 0 && y < H ? body[y * W + x] : 0);
    const inInk = (x, y) => (x >= 0 && x < W && y >= 0 && y < H ? ink[y * W + x] : 0);
    // THE WALK STEPS OVER A BREAK, and it has to. A photographed stem at a
    // ten-pixel staff space is four pixels wide and thresholds into pieces: the
    // Concerto's stem at x = 977 comes back as a run of 2.41 spaces that STOPS
    // 1.3 spaces short of its own notehead, so a strict walk says the head is
    // not on the stem and the arrangement goes unrecognised. Two pixels — a
    // fifth of a space — is the same bridge `ledgerRun` uses and it is bounded
    // by the thing it must not do: a fifth of a space cannot join one staff line
    // to the next, which are a whole space apart.
    const BRIDGE = Math.max(1, Math.round(space * 0.2));
    const column = (on, x, y) => {
      if (!on(x, y)) return null;
      let t = y;
      for (;;) {
        let step = 0;
        while (step < BRIDGE && t - step - 1 >= 0 && !on(x, t - step - 1)) step++;
        const to = t - step - 1;
        if (!on(x, to)) break;
        t = to;
      }
      let b = y;
      for (;;) {
        let step = 0;
        while (step < BRIDGE && b + step + 1 < H && !on(x, b + step + 1)) step++;
        const to = b + step + 1;
        if (!on(x, to)) break;
        b = to;
      }
      return { t, b };
    };
    const across = (on, x, y) => {
      if (!on(x, y)) return 0;
      let n = 1;
      for (let k = x - 1; k >= 0 && on(k, y); k--) n++;
      for (let k = x + 1; k < W && on(k, y); k++) n++;
      return n;
    };

    // Every truth mark in working pixels, which is what "a real notehead" means
    // on a marked page.
    const heads = want.map((t) => [t.x * W, t.y * H]);

    const STEM_TALL = 2.0;     // spaces — the reader's own floor
    // THE READER'S OWN 0.35 IS TOO TIGHT TO SEE ITS OWN MISTAKE, and that is
    // measured rather than assumed. `stemHeads` computes `wide =
    // max(1, round(space * 0.35))`, which is 3 pixels at the Concerto's
    // ten-pixel staff space, and that page's printed stems measure 4 — so the
    // reader's stem scan cannot see them at all, which is why the Concerto's
    // stem pass proposes four heads on a page of six hundred stem runs. Half a
    // space is still unambiguously thin: a notehead is a whole space across.
    // Rounded to whole pixels, the way `stemHeads` rounds its own `wide`, because
    // at the Concerto's 9.97-pixel space half a space is 4.985 and a printed stem
    // there measures exactly 5 — an unrounded comparison rejects the page's own
    // stems by fifteen thousandths of a pixel.
    const STEM_WIDE = 0.5;     // spaces — asked of the low quartile down the run
    // Nine tenths of a space either side, because the circle is not required to
    // be ON the stem: a false head is drawn where a notehead would be, which is
    // half a head off the stem, and the head finder then re-centres it on its own
    // ink. Still well under the two spaces that separate consecutive stems in a
    // beamed group at this repertoire's speed.
    const LOOK_X = 0.9;        // spaces — how far either side of the circle to look
    const OWN_HEAD = 0.9;      // spaces — nearer than this and the head IS this circle
    const HEAD_X = 1.0;        // spaces — how far a head's centre stands off its stem

    return (cx, cy) => {
      const x0 = Math.round(cx); const y0 = Math.round(cy);
      // The stem: the longest thin vertical run whose ink reaches this point.
      let stem = null;
      const reach = Math.max(1, Math.round(space * LOOK_X));
      const slack = Math.max(1, Math.round(space * 0.5));
      {
        const on = inBody;
        for (let x = x0 - reach; x <= x0 + reach; x++) {
          let col = null;
          for (let dy = 0; dy <= slack && !col; dy++) {
            col = column(on, x, y0 - dy) ?? column(on, x, y0 + dy);
          }
          if (!col) continue;
          const len = col.b - col.t + 1;
          if (len < space * STEM_TALL) continue;
          // Only the inked rows: a bridged row is zero wide and would drag the
          // quartile to nothing, which would let anything through.
          const ws = [];
          for (let y = col.t; y <= col.b; y++) if (on(x, y)) ws.push(across(on, x, y));
          if (!ws.length) continue;
          ws.sort((a, b) => a - b);
          const thin = ws[Math.floor((ws.length - 1) * 0.25)];
          if (thin > Math.max(2, Math.round(space * STEM_WIDE))) continue;
          if (!stem || len > stem.len) stem = { x, t: col.t, b: col.b, len, wide: thin };
        }
      }
      // A real notehead standing on that same stem, far enough away to be a
      // different note from whatever this circle is on.
      let head = null;
      if (stem) {
        for (const [hx, hy] of heads) {
          if (Math.abs(hx - stem.x) > space * HEAD_X) continue;
          if (hy < stem.t - space * 0.6 || hy > stem.b + space * 0.6) continue;
          const away = Math.hypot(hx - cx, hy - cy) / space;
          if (away < OWN_HEAD) continue;
          if (!head || away < head.away) head = { x: hx, y: hy, away };
        }
      }
      // What the point is standing on, when it is not a stem. Asked of the raw
      // ink, because a beam and a printed rule are precisely what `body` erases.
      let bar = null;
      for (let dy = 0; dy <= slack && !bar; dy++) {
        for (const y of [y0 - dy, y0 + dy]) {
          if (!inInk(x0, y)) continue;
          let t = y; while (t > 0 && ink[(t - 1) * W + x0]) t--;
          let b = y; while (b < H - 1 && ink[(b + 1) * W + x0]) b++;
          bar = { run: across(inInk, x0, y) / space, thick: (b - t + 1) / space, y };
          break;
        }
      }
      // Ink the beam mask took out: a beam or a printed rule with nothing
      // joining it. Thickness tells the two apart — a beam is about half a
      // space and a staff line is a tenth of one.
      const wiped = bar != null && !body[bar.y * W + x0] && inInk(x0, bar.y) === 1;

      let shape;
      if (stem && head) shape = 'stem-foot';
      else if (stem) shape = 'stem';
      else if (bar && bar.run >= 2.4 && bar.thick >= 0.3) shape = 'beam';
      else if (bar && bar.run >= 2.4) shape = 'rule';
      else if (!bar) shape = 'paper';
      else shape = 'other';
      return {
        shape,
        stem: stem ? +(stem.len / space).toFixed(2) : 0,
        away: head ? +head.away.toFixed(2) : 0,
        beamInk: wiped ? 1 : 0,
      };
    };
  })();

  // Labels that sit where a clef is drawn.
  //
  // Marking a page by hand is not error-free, and one error is systematic: the
  // reader draws a ring on the bass clef of every system, and a ring on a clef
  // looks exactly like a ring on a note to somebody clicking through four
  // hundred of them. Nine such labels came back on the first marked page. They
  // are not a judgement call — there is no music between a stave's left end and
  // its key signature — so they are reported, and `--clean` writes a corrected
  // copy rather than anybody hand-editing four hundred coordinates.
  //
  // …AND LABELS THAT SIT ON THE KEY SIGNATURE, which is the same mistake made
  // by the same hand for a better reason.
  //
  // A sharp is two thin uprights crossed by two thick slanted bars, and at a
  // ten-pixel staff space each of those bars is exactly the size, shape and
  // darkness of a notehead. The reader used to circle both of them on every
  // system; a person clicking through four hundred rings accepted the circles
  // because they looked like circles on notes. LOOKED AT, on the Scanned score
  // — crop at 114,497 and 114,1199 — the two marks stand on the two crossbars
  // of the printed sharp, with the first real note of the bar correctly ringed
  // a centimetre to the right.
  //
  // This matters more than a point of recall. A truth file that calls the key
  // signature a note REWARDS the reader for circling it, which is the exact bug
  // this round exists to fix: every improvement to the key-signature
  // suppression shows up as a recall regression, and the measurement argues
  // against the fix.
  //
  // The window is the page's OWN answer, not a guess at where a signature goes:
  // the systems that found a key band agree on where it is, so their union —
  // measured from each stave's own left end, because an engraver indents the
  // first system — is where the signature is printed on this page. A page whose
  // systems found no band at all contributes no window and nothing is removed.
  const keyWindow = (() => {
    const offsets = read.staves
      .filter((s) => s.keyBand && s.edge != null)
      .map((s) => [(s.keyBand.x - s.edge) / s.space, (s.keyBand.x + s.keyBand.w - s.edge) / s.space]);
    if (offsets.length < 3) return null;
    // THE MEDIAN of the systems' answers, not their union.
    //
    // The union is one bad band away from reaching into the music, and it does:
    // on the Bärenreiter Bach one system reads its signature 1.56 spaces wide
    // against 0.57 to 1.16 for the rest, which stretches the union to 6.5
    // spaces past the stave's left end — and a beamed pair of quavers in the
    // first bar of the indented system sits at 6.67. Cropped at 216,354, both
    // are plainly notes, correctly ringed, and the union would have deleted one
    // of them from the ground truth. A truth file edited by a rule that eats
    // notes is worse than no cleaning at all.
    //
    // The median cannot be moved by one over-wide band, and every system on a
    // printed page carries the same signature in the same place, so the median
    // IS the answer rather than a robust approximation to it.
    const mid = (xs) => xs.slice().sort((a, b) => a - b)[Math.floor((xs.length - 1) / 2)];
    // Padded by three fifths of a space each way: a mark is a click, not a
    // measurement, and it lands where the person's finger went.
    return [mid(offsets.map((o) => o[0])) - 0.6, mid(offsets.map((o) => o[1])) + 0.6];
  })();

  // How far LEFT of a stave's measured edge a clef is really drawn on this page.
  //
  // The median across systems, in staff spaces, and never positive: this exists
  // to widen the clef window on a system whose edge came back too far right, not
  // to narrow it on one that is correct.
  const clefWindow = (() => {
    const offs = read.staves
      .filter((s) => s.clefZone && s.edge != null)
      .map((s) => (s.clefZone.x - s.edge) / s.space);
    if (offs.length < 3) return null;
    const m = offs.slice().sort((a, b) => a - b)[Math.floor((offs.length - 1) / 2)];
    return Math.min(0, m - 0.6);
  })();

  const suspect = [];
  for (const [ti, t] of want.entries()) {
    let onKey = false;
    for (const s of read.staves) {
      if (!keyWindow || s.edge == null) continue;
      const top = s.lines[0][0] - s.space * 4;
      const bottom = s.lines[4][0] + s.space * 4;
      if (t.y < top || t.y > bottom) continue;
      const off = (t.x - s.edge) / s.space;
      if (off >= keyWindow[0] && off <= keyWindow[1]) { onKey = true; break; }
    }
    if (onKey) {
      suspect.push({
        i: ti, on: 'key',
        x: Math.round(t.x * work.width), y: Math.round(t.y * work.height), ...where(t.x, t.y),
      });
      continue;
    }
    for (const s of read.staves) {
      if (!s.clefZone) continue;
      // From the stave's own left end, and ALSO from the page's answer, because
      // the stave's own left end is exactly what is wrong on the system where
      // this matters most.
      //
      // The original rule ran from `s.edge` rightwards. On the Bärenreiter Bach
      // the first system is indented under the title and its edge measures 136
      // where the clef is drawn near 100 — so a hand mark ON THE ROUND HEAD OF
      // THE BASS CLEF (crop at 100,310: it is unmistakable) fell to the LEFT of
      // the zone and was never looked at. The detector was blind in precisely
      // the region it exists to police, and on precisely the system the reader
      // is documented as measuring wrong. "No suspect labels printed" then reads
      // as "this page is clean", which is how the Bach came to be the control
      // page for everybody else's contamination while carrying three of its own.
      //
      // So the window opens at whichever is further left: the stave's own edge,
      // or the page's median clef offset carried back to this stave. A page
      // whose systems disagree about where they start cannot hide a clef behind
      // the disagreement.
      // …which means: NO LEFT BOUND AT ALL, up to where the clef band ends.
      //
      // Nothing is printed to the left of a clef. Not on any system, of any
      // page, in any edition — the clef is the first thing on the stave, and
      // what is further left is the margin, the brace, or blank paper. So the
      // honest test is one-sided, and a one-sided test cannot be defeated by a
      // system whose left edge was measured in the wrong place.
      //
      // The rule this replaces ran from the stave's own edge rightwards, which
      // is a bound built out of the number most likely to be wrong. On the
      // Bärenreiter Bach the indented first system reports edge = 136 where the
      // clef is drawn near 95, so a mark on the bass clef's round head at x=100
      // fell into the gap between the two and was never tested. The detector was
      // blind exactly where the reader is documented as measuring badly, and the
      // page it was blind on was the one the other pages' contamination was
      // being compared against.
      //
      // A pencil mark far out in the margin is caught by this too. That is the
      // right answer: it is not a notehead either.
      const x1 = s.clefZone.x + s.clefZone.w;
      const top = s.lines[0][0] - s.space * 4;
      const bottom = s.lines[4][0] + s.space * 4;
      if (t.x <= x1 && t.y >= top && t.y <= bottom) {
        suspect.push({
          i: ti, on: 'clef',
          x: Math.round(t.x * work.width), y: Math.round(t.y * work.height), ...where(t.x, t.y),
        });
        break;
      }
    }
  }

  // …AND A NOTE THAT WAS MARKED TWICE.
  //
  // The third systematic error of a marking hand, after the clef and the key
  // signature, and the only one that is not about WHERE the click landed: two
  // clicks on ONE printed notehead. It happens because marking is done in
  // passes — a page is worked through once, then the misses are swept up
  // afterwards — and a head that was already marked gets marked again. The
  // index numbers say so out loud: on the Concerto the four pairs are notes
  // 99/128, 85/100, 214/238 and 159/187, and on the Scanned score 163/198,
  // 141/165, 337/371, 347/377 and 341/374. Every second member is far later in
  // the file than its twin, which is what a second pass looks like from inside
  // the data.
  //
  // THE BOUND IS NOT A NEW CONSTANT AND MUST NOT BECOME ONE. It is `near`, the
  // radius this same file already uses to decide whether a detection matches a
  // mark, and the argument is structural rather than fitted: two marks closer
  // together than the matching radius CANNOT BOTH BE SCORED. One detection
  // lands inside both radii, the greedy pass gives it to whichever is nearer,
  // and the other is counted missed no matter what the reader does. A page can
  // never score 100% recall while it holds such a pair, and no change to the
  // reader can ever move it — so the pair is not measuring the reader at all.
  //
  // Measured, and the two populations do not touch. On the Concerto (`near` =
  // 5.0px) the four pairs stand 0.0, 2.0, 3.1 and 4.1 pixels apart and the next
  // closest pair on the page is 9.0. On the Scanned score (`near` = 4.8px) the
  // five stand 0.0, 1.4, 2.2, 2.2 and 4.1 and the next closest is 8.0. The Bach
  // has no pair inside 14px at all. So the cut sits in the middle of a gap of
  // more than two to one, and everything above it is a real interval: dy of 8
  // to 10 pixels at a staff space of 9.6 to 10 is two diatonic steps, which is a
  // third, which is a chord.
  //
  // LOOKED AT, all nine, `CROP_MARKS=1 CROP_TRUTH=… npm run scan:crop`: every
  // one is a single filled notehead on a ledger line above the stave with its
  // own stem, carrying two red dots that overlap into a figure of eight, and in
  // eight of the nine two concentric green rings as well — because the reader
  // was reporting the same ink twice too, from two staves, which is the bug
  // these marks were hiding. Crops kept at crop-979-911, crop-1249-770,
  // crop-759-1474, crop-925-1198 (Concerto) and crop-989-885, crop-1246-748,
  // crop-784-1440, crop-1026-1440, crop-919-1441 (Scanned).
  //
  // The LATER mark goes, not the earlier one, and not the one further from any
  // detection: the first pass is the considered one and the sweep is where the
  // duplicate came from. Which of two coincident points is kept cannot change a
  // score — they are inside each other's matching radius by construction — so
  // this is a rule about being reproducible, not about being right.
  const already = new Set(suspect.map((s) => s.i));

  // …AND A MARK IN THE TITLE BLOCK.
  //
  // The fourth systematic error of a marking hand, and the last one of the
  // three this page was known to carry. `fillMissedStaves` extrapolates one
  // system ABOVE the first real one and lands on the page's printed heading, so
  // the reader draws twenty-one rings on the É of CARATGÉ, the o of Solo and
  // five on W. A. MOZART — and the hand marking the page accepted thirteen of
  // them. Looked at, all thirteen, `--zoom 14` contact sheets: every one is a
  // ring and a mark sitting on a printed LETTER of "Édition · F. CARATGÉ ·
  // Solo · Concert · Lamoureux · Comique" and "W. A. MOZART". Nothing in a
  // title block is a notehead.
  //
  // THE BOUND IS THE READER'S OWN, in the same way `near` is above. A mark is
  // suspect when it stands further above the topmost stave that READ A CLEF
  // than `findHeads` will ever look — `reach = space * 7`, scan-read.js:1806,
  // four ledger lines, as high as this repertoire goes. Two things follow from
  // borrowing that number rather than fitting one. It is unfalsifiable in the
  // right direction: a mark the reader cannot reach cannot be scored against
  // it, exactly as two marks inside one matching radius cannot both be scored.
  // And a stave with NO CLEF is not a witness — which is the whole point, since
  // the phantom the marks were made on is precisely a stave with no clef.
  //
  // MEASURED, and the populations do not touch. Distance above the first
  // clef-bearing stave's top line, in staff spaces, every mark on every page:
  //   Scanned   13 marks at 11.9 to 19.9 spaces · the next nearest stands 2.7
  //   Concerto   nothing past 7 · the highest mark on the page stands 2.1
  //   Bach       nothing past 7 · the highest mark on the page stands 2.4
  // So the cut sits in a gap of more than four to one on the page that has the
  // population, and on the two pages that do not it fires on nothing. Note what
  // the stave list looks like from here: the Concerto and the Scanned score
  // both carry a top stave reading `none` at confidence 0.00 — the phantom —
  // and every other stave on all three pages reads a clef at 0.61 or better.
  const firstClef = read.staves
    .filter((s) => s.clef && (s.clefConfidence ?? 0) > 0)
    .sort((a, b) => a.lines[0][0] - b.lines[0][0])[0];
  if (firstClef) {
    const ceiling = firstClef.lines[0][0] - firstClef.space * 7;
    for (const [ti, t] of want.entries()) {
      if (already.has(ti) || suspect.some((s) => s.i === ti)) continue;
      if (t.y >= ceiling) continue;
      already.add(ti);
      suspect.push({
        i: ti, on: 'title',
        x: Math.round(t.x * work.width), y: Math.round(t.y * work.height),
        above: +((firstClef.lines[0][0] - t.y) / firstClef.space).toFixed(1),
        ...where(t.x, t.y),
      });
    }
  }

  for (let i = 0; i < want.length; i++) {
    for (let j = i + 1; j < want.length; j++) {
      if (already.has(j)) continue;
      const d = Math.hypot(
        (want[i].x - want[j].x) * work.width,
        (want[i].y - want[j].y) * work.height,
      );
      if (d >= near) continue;
      already.add(j);
      suspect.push({
        i: j, on: 'twice',
        x: Math.round(want[j].x * work.width), y: Math.round(want[j].y * work.height),
        twin: i, apart: +d.toFixed(1),
        ...where(want[j].x, want[j].y),
      });
    }
  }

  return {
    size: `${work.width}x${work.height}`,
    space: +space.toFixed(1),
    suspect,
    // Barlines have no ground truth here, but the COUNT belongs in the report
    // anyway. This tool measured noteheads and nothing else, and while it read
    // 90% on a page the reader was finding four barlines on it where there are
    // thirty-five — which is what somebody looking at the screen actually sees,
    // and it stayed invisible for a day because no number went near it.
    bars: read.staves.reduce((a, st) => a + (st.bars?.length ?? 0), 0),
    systems: read.staves.length,
    clefs: read.staves.filter((st) => st.clef).length,
    found: found.length,
    truth: want.length,
    hit: tookT.size,
    // The matched ones too, and their step — because a rule that throws away
    // what sits outside the stave is only worth having if the notes do not.
    // Ledger notes are notes, and this is the number that says how many.
    matched: found
      .map((f, i) => ({ f, i }))
      .filter(({ i }) => tookF.has(i))
      .map(({ f }) => ({
        x: Math.round(f.x * work.width), y: Math.round(f.y * work.height),
        step: where(f.x, f.y).step, beats: f.beats, via: f.via ?? 'shape',
        ...shapeOf(f.x * work.width, f.y * work.height),
      })),
    falsePositives: found
      .map((f, i) => ({ f, i }))
      .filter(({ i }) => !tookF.has(i))
      .map(({ f }) => ({
        x: Math.round(f.x * work.width), y: Math.round(f.y * work.height),
        beats: f.beats, via: f.via ?? 'shape',
        on: furniture(where(f.x, f.y).system - 1, f.x), ...where(f.x, f.y),
        ...shapeOf(f.x * work.width, f.y * work.height),
      })),
    missed: want
      .map((t, i) => ({ t, i }))
      .filter(({ i }) => !tookT.has(i))
      .map(({ t }) => ({
        x: Math.round(t.x * work.width), y: Math.round(t.y * work.height),
        ...where(t.x, t.y),
      })),
  };
}, { b64: base64, pdf: isPdf, want: truth.notes });

await browser.close();

if (report.failed) {
  console.log(`\n${report.failed}\n`);
  process.exit(1);
}

const precision = report.hit / report.found;
const recall = report.hit / report.truth;
const f1 = (2 * precision * recall) / (precision + recall || 1);

if (wantJson) {
  // WAIT FOR THE WRITE BEFORE EXITING, and this is not tidiness — it is a bug
  // that cost `npm run bench` two of its three pages.
  //
  // `console.log` to a PIPE is asynchronous in node. `process.exit` does not
  // flush it: whatever has not reached the operating system is thrown away, and
  // the pipe's own buffer is 64 kB. So a report over 64 kB arrived at bench
  // truncated at exactly that byte, and bench — which does
  // `JSON.parse(stdout.slice(stdout.indexOf('{')))` — reported "Unexpected end
  // of JSON input" against the PAGE, then computed its mean from the pages that
  // happened to fit. Redirecting the same command to a file hid it completely,
  // because a write to a file IS synchronous.
  //
  // It was latent for as long as this tool has printed JSON. The Scanned score's
  // report measured 52 kB of the 64 available, and the round that added a third
  // breakdown took it to 90.
  await new Promise((done) => {
    process.stdout.write(`${JSON.stringify({ file, precision, recall, f1, ...report, errors }, null, 2)}\n`, done);
  });
  process.exit(0);
}

console.log(`\n${basename(file)} against ${basename(truthPath)}`);
console.log(`  ${report.size} · staff space ${report.space}px · marked ${truth.marked ?? 'undated'}\n`);
console.log(`  ${String(report.found).padStart(4)}  found`);
console.log(`  ${String(report.truth).padStart(4)}  really there`);
console.log(`  ${String(report.hit).padStart(4)}  matched\n`);
console.log(`  PRECISION  ${(precision * 100).toFixed(1)}%   `
  + `${report.falsePositives.length} invented`);
console.log(`  RECALL     ${(recall * 100).toFixed(1)}%   ${report.missed.length} missed`);
console.log(`  F1         ${(f1 * 100).toFixed(1)}%\n`);

// Grouped, because a list of ninety-seven coordinates is not a finding and
// "system 1 bar 1 has eleven of them" is.
function group(rows, title) {
  if (!rows.length) return;
  console.log(`  ${title}`);
  const bySystem = new Map();
  for (const r of rows) {
    const k = r.system;
    if (!bySystem.has(k)) bySystem.set(k, []);
    bySystem.get(k).push(r);
  }
  for (const [sys, rs] of [...bySystem.entries()].sort((a, b) => a[0] - b[0])) {
    const off = rs.filter((r) => r.step < 0 || r.step > 8).length;
    console.log(`    system ${String(sys).padStart(2)}  ${String(rs.length).padStart(3)}`
      + `  ${off ? `${off} outside the stave` : 'all within the stave'}`);
    const show = showAll ? rs : rs.slice(0, 6);
    for (const r of show) {
      console.log(`        x=${String(r.x).padStart(4)} y=${String(r.y).padStart(4)}`
        + `  bar ${String(r.bar).padStart(2)}  step ${String(r.step).padStart(3)}`
        + (r.via ? `  ${r.via.padEnd(5)}` : '')
        + (r.shape ? `  ${(`${r.shape}${r.stem ? ` ${r.stem}sp` : ''}`
          + `${r.away ? ` head ${r.away}sp` : ''}`).padEnd(28)}` : '')
        + (r.on ? `  on the ${r.on}` : '')
        + (r.beats != null ? `  ${r.beats} beats` : ''));
    }
    if (!showAll && rs.length > show.length) console.log(`        …and ${rs.length - show.length} more (--all)`);
  }
  console.log('');
}

// WHICH PASS invented them, and WHAT they are standing on.
//
// A count of false circles says a page is wrong. This says which half of the
// reader is wrong on it — the shape scan or the stem hunt — and how many are
// the clef and the key signature rather than the music, which is the
// difference between a filter to write and a filter that already exists and is
// not firing.
{
  const fp = report.falsePositives;
  const by = (key) => {
    const m = new Map();
    for (const r of fp) {
      const k = r[key] ?? 'music';
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };
  if (fp.length) {
    console.log('  WHERE THE INVENTED HEADS COME FROM');
    console.log(`    by pass       ${by('via').map(([k, n]) => `${k} ${n}`).join('   ')}`);
    console.log(`    by furniture  ${by('on').map(([k, n]) => `${k} ${n}`).join('   ')}`);
    const outside = fp.filter((r) => r.step < 0 || r.step > 8).length;
    console.log(`    outside the stave  ${outside} of ${fp.length}\n`);
  }
  const hit = report.matched ?? [];
  // WHERE THE CIRCLE SITS, which is a different question from which pass
  // proposed it, and it is the one the user asked. See the long note above
  // `shapeOf` in the browser half of this file.
  //
  // THE CORRECT HEADS ARE SCORED THE SAME WAY, and that column is the whole
  // point of the line: a rule that removes circles standing in a stem is only
  // worth having if real noteheads do not also stand there. A notehead at the
  // far end of ANOTHER note's stem is a real arrangement in engraved music —
  // a chord, or two voices sharing a stem — and until this line existed nobody
  // had measured how often it happens.
  {
    const label = {
      'stem-foot': 'in a stem, a real head on it',
      stem: 'in a stem, no head on it',
      beam: 'on a beam',
      rule: 'on a printed rule',
      paper: 'on bare paper',
      other: 'on ink of some other shape',
    };
    const tally = (rows) => {
      const m = new Map();
      for (const r of rows) m.set(r.shape ?? 'other', (m.get(r.shape ?? 'other') ?? 0) + 1);
      return m;
    };
    const bad = tally(fp); const good = tally(hit);
    const pct = (n, d) => (d ? `${((n / d) * 100).toFixed(1)}%` : '   — ');
    console.log('  BY SHAPE OF ERROR — what the ink under the circle is arranged as');
    console.log('                                    invented              correct');
    for (const k of ['stem-foot', 'stem', 'beam', 'rule', 'paper', 'other']) {
      const a = bad.get(k) ?? 0; const b = good.get(k) ?? 0;
      if (!a && !b) continue;
      console.log(`    ${label[k].padEnd(30)}${String(a).padStart(4)}  ${pct(a, fp.length).padStart(6)}`
        + `  ${String(b).padStart(5)}  ${pct(b, hit.length).padStart(6)}`);
    }
    // THE SMOKE ALARM, and it is the reason this breakdown can be trusted at all.
    //
    // Almost every notehead in this repertoire has a stem — a semibreve does not
    // and nothing else is exempt — so the share of CORRECT heads under which this
    // code finds a stem is a measurement of the stem finder itself, on a
    // population of a thousand points that are known to be noteheads. It reads
    // 96% on the Bach, 97% on the Concerto and 95% on the Scanned score. If a
    // later change drops it, the `stem-foot` column has stopped meaning what it
    // says and nothing below it should be quoted. Written the same way
    // tools/head-probe.mjs checks itself against findHeads: an instrument that
    // cannot say when it has drifted is worse than none.
    const anyStem = hit.filter((r) => r.shape === 'stem-foot' || r.shape === 'stem').length;
    console.log(`    a stem is found under ${anyStem} of ${hit.length} CORRECT heads`
      + ` (${((anyStem / (hit.length || 1)) * 100).toFixed(0)}%) — a notehead has a stem, so`
      + ` a\n    number well below 90 here means the stem finder has drifted and this table is void`);
    const beamy = fp.filter((r) => r.shape === 'stem-foot' && r.beamInk).length;
    console.log(`    of the invented in a stem with a head on it, ${beamy} also carry beam ink`);
    const cross = fp.filter((r) => r.shape === 'stem-foot' && (r.via ?? 'shape') !== 'stem').length;
    console.log(`    …and ${cross} of them were proposed by the SHAPE pass, not the stem pass\n`);
  }
  const stemHits = hit.filter((r) => r.via === 'stem').length;
  const stemFp = fp.filter((r) => r.via === 'stem').length;
  if (stemHits || stemFp) {
    console.log(`  THE STEM PASS ON ITS OWN   ${stemHits} real, ${stemFp} invented`
      + `  (${((stemHits / (stemHits + stemFp || 1)) * 100).toFixed(1)}% precision)\n`);
  }
}

group(report.falsePositives, 'INVENTED — ink the reader called a notehead');
group(report.missed, 'MISSED — notes on the page the reader never offered');

if (report.suspect?.length) {
  const onClef = report.suspect.filter((t) => t.on === 'clef').length;
  const onKey = report.suspect.filter((t) => t.on === 'key').length;
  const onTwice = report.suspect.filter((t) => t.on === 'twice').length;
  const onTitle = report.suspect.filter((t) => t.on === 'title').length;
  console.log(`  SUSPECT LABELS — ${report.suspect.length}: ${onClef} inside a clef band, ${onKey} on the`);
  console.log(`  key signature, ${onTwice} a second click on a note already marked, ${onTitle} in the title block.`);
  console.log('  No music is printed at the head of a system. Those are rings drawn on the clef,');
  console.log('  or on the two crossbars of a sharp, accepted by a hand clicking through four');
  console.log('  hundred. A doubled mark is the same hand marking one head in two passes, and');
  console.log('  it stands closer to its twin than the radius this file matches with — so the');
  console.log('  pair can never both be scored, whatever the reader does. A title-block mark');
  console.log('  stands further above the first stave that read a clef than findHeads ever');
  console.log('  looks, so it cannot be scored either — and the stave it was marked on has no');
  console.log('  clef, because it is not a stave.');
  for (const t of report.suspect.slice(0, 16)) {
    console.log(`      system ${String(t.system).padStart(2)}  x=${String(t.x).padStart(4)}`
      + ` y=${String(t.y).padStart(4)}  step ${String(t.step).padStart(3)}  on the ${t.on}`);
  }
  if (report.suspect.length > 16) console.log(`      …and ${report.suspect.length - 16} more`);
  const clean = flag('clean');
  if (clean) {
    const drop = new Set(report.suspect.map((t) => t.i));
    const out = { ...truth, notes: truth.notes.filter((_, i) => !drop.has(i)) };
    // The provenance survives in the file, because a truth file that quietly
    // disagrees with the marking tool is worse than one that is wrong out loud.
    //
    // APPENDED, never replaced. These two fields were being overwritten, and
    // both files had already been cleaned once by hand: the Scanned score's
    // `removed` holds seventeen entries and the Bach's three, none of which
    // this run would reproduce, because a mark that is gone cannot be detected
    // again. One `--clean` would have deleted the whole record of why the
    // denominator is 436 and not 453 — the single most load-bearing sentence
    // in either file. The history is cumulative or it is not history.
    const already = Array.isArray(truth.removed) ? truth.removed : [];
    out.cleaned = [truth.cleaned, `${report.suspect.length} suspect labels removed`
      + ` (${onClef} clef, ${onKey} key signature, ${onTwice} marked twice,`
      + ` ${onTitle} in the title block)`]
      .filter(Boolean).join('; ');
    out.removed = [
      ...already,
      ...report.suspect.map((t) => ({
        x: t.x, y: t.y, system: t.system, on: t.on,
        ...(t.twin != null ? { apart: t.apart } : {}),
      })),
    ];
    await writeFile(clean, JSON.stringify(out, null, 2));
    console.log(`\n  written to ${clean}: ${out.notes.length} notes, ${report.suspect.length} removed`);
  } else {
    console.log('\n  pass --clean <out.json> to write a copy without them.');
  }
  console.log('');
}
if (errors.length) console.log('page errors:', errors.slice(0, 3));
