// Is there a notehead in the middle of this patch of page?
//
// The reader localises well and judges badly. On two marked pages it finds 99%
// and 88% of the notes and a third of what it draws on the Mozart is a rest, an
// accidental, the word SOLO or the p of a dynamic — and every geometric rule
// left is a straight trade, because at a ten-pixel staff space a notehead and a
// rest are the same size and the same kind of shape. Six sweeps in a row bought
// a point of recall for a point of precision and back again.
//
// So the question is asked as what it is: here is a small picture of the page,
// centred on something the shape tests already liked, is a notehead in the
// middle of it. Logistic regression over a GRID x GRID patch — see the constant
// below, which is 20, so 400 weights: small enough that not enough data cannot
// hide in it, and small enough to read. (This note said "16x16, 256 weights"
// for a long while after GRID was raised. Read the constant, not the prose.)
//
// TESTED ON PAGES IT HAD NEVER SEEN, which is the only test worth quoting.
// These weights are the fit over the Bach and the Mozart, and this is what that
// same fit read at HEAD_CUT on the page it was NOT trained on:
//
//   trained on the Mozart, scored on the Bach     98.1% precision / 99.4% recall
//   trained on the Bach, scored on the Mozart     93.3% / 89.5%
//
// Both ways, so what it learned is the shape of a notehead rather than the
// habits of one engraver. The weights shipped here are then fitted to BOTH
// pages, which means any number measured against those two pages is optimistic
// by construction.
//
// ── AND NO COMMAND IN THIS REPO REPRINTS THOSE TWO LINES ANY MORE. ───────────
// This is the one thing to know before quoting them. `npm run scan:train` reads
// pages/patches.json, and that file is now the THREE-page, 1267-row dump
// (Bach 360 rows / 41 negative, Mozart 443 / 145, Scanned 464 / 103). It holds
// out one page of three, so it prints three blocks and NOT ONE OF THEM
// DESCRIBES THE FIT INSTALLED HERE — not even "trained on Mozart, Scanned —
// tested on Bach", which is a two-page fit but not THAT two-page fit, because
// the dump those weights came from no longer exists to re-fit from. The two
// lines above are a historical measurement of the shipped model, kept because
// they are the only honest figures it has, and they are not reproducible.
//
// What scan:train prints TODAY, at cut 0.4, is the refit — the right-hand
// column of the table further down. If you want a live held-out number for what
// actually ships, there is no way to get one short of re-dumping the two old
// pages alone and re-fitting, which is the "third fit" experiment recorded
// below; it produced a DIFFERENT model from this one and is not a measurement
// of these weights either.
//
// The asymmetry between pages is the useful part, and the argument survives its
// numbers going stale: the model trained on the richer set of negatives travels
// better. The old two-page dump ran Bach 46 negatives against Mozart 152. Those
// exact counts cannot be recovered — the dump was overwritten — and in the
// current three-page dump the same asymmetry reads Bach 41, Mozart 145,
// Scanned 103. More marked pages, and especially pages with different things
// wrong on them, is what makes this better — not more tuning.
//
// ─────────────────────────────────────────────────────────────────────────────
// THESE WEIGHTS ARE DELIBERATELY NOT THE CURRENT FIT, AND pages/head-model.json
// DISAGREES WITH THEM ON PURPOSE. DO NOT "FIX" THAT BY COPYING IT IN.
//
// pages/index.json now lists three marked pages, and pages/patches.json has
// been re-dumped against the shape tests as they stand — 1267 patches from
// Bach, Mozart and the Scanned score (360 / 443 / 464), where these weights
// were fitted to 813 from two. The retrain was run exactly as the handover
// prescribes
// (scan:patches with the judge off, then scan:train), and the model it produced
// IS A BETTER CLASSIFIER AND A WORSE READER. Both halves of that are measured:
//
//   the classifier, cross-page, at cut 0.4, which is the honest table
//     held out    these weights (2 pages)    the 3-page refit
//     Bach            98.1% / 99.4%            99.1% / 99.4%
//     Mozart          93.3% / 89.5%            89.6% / 98.0%
//     Scanned         (not in that fit)        96.2% / 90.9%
//
//   ONLY THE RIGHT-HAND COLUMN IS LIVE. npm run scan:train reprints it every
//   run and it was re-run this round unchanged to the digit — 99.1/99.4,
//   89.6/98.0, 96.2/90.9. The left-hand column is the historical, no longer
//   reproducible measurement described at the head of this file.
//
//   the reader, npm run bench, all three marked pages, AS MEASURED ON THE DAY
//   OF THAT EXPERIMENT — both rows taken against the same reader and the same
//   truth files, which is what makes the comparison mean anything:
//     these weights   92.1% precision / 94.0% recall
//     the refit       90.0% / 92.1%      — 23 real notes lost on the Scanned
//                                          score alone, spread through the
//                                          music, not on the contaminated marks
//   Do NOT read 92.1 / 94.0 as the reader's current score. Two things have
//   moved it since and neither is the classifier: thirteen bad marks came out
//   of pages/truth/scanned.truth.json (recall), and the page now agrees how far
//   its key signature reaches (precision). npm run bench reads 92.8 / 94.9
//   today. The two points of recall the refit costs are the number that matters
//   here, and they are far outside what the handover's standard allows.
//
// WHERE THE READER LOSES THEM IS THE STEM PASS, and the reason is STEM_CUT in
// scan-read.js: 0.95 on this same score, chosen for THESE weights, sitting in
// the extreme tail where the hunt's max-over-a-hundred-positions lands. With
// the refit installed the Scanned score's stem pass reads 26 real / 22 invented
// against 48 / 14 here, and no value of STEM_CUT recovers it — the sweep is in
// the note above STEM_CUT. Raising HEAD_CUT does not either: at 0.5 and 0.6 the
// stem pass does not move a digit (26/22 at both) and the mean recall keeps
// falling. See the handover's dead-end entry for the corpus columns, which
// split: HARD invents 55 fewer heads with the refit and CORE invents 71 more.
//
// A THIRD FIT SEPARATES THE TWO THINGS THAT CHANGED, and it has to be quoted
// because without it the story above is two changes at once. The candidate dump
// moved AND a page was added, so the same trainer was run over the new dump
// with only the two old pages in it (803 rows). That fit reads:
//
//   npm run bench     91.0% / 92.9%   — Scanned 89.3 / 88.7, stem pass 36 / 20
//   scan:corpus CORE  111 spurious heads, against 119 for these weights
//
// So the two effects belong to different causes, and neither is what the first
// reading of this suggested:
//
//   THE RE-DUMP ALONE COSTS THE BENCH A POINT, through the stem pass, with no
//   new page and no new labels involved. That is the portable finding: any
//   change to the shape tests will do this until STEM_CUT stops being a number.
//
//   THE CORE LOOSENING IS THE THIRD PAGE, not the re-dump. Two pages over the
//   new dump invents FEWER heads on CORE than these weights do, and only the
//   three-page fit invents 190 — which points at the Scanned score's labels,
//   whose truth file is contaminated three ways over and hands training twelve
//   positives standing on the letters of the title block.
//
// WHY A REFIT MOVES THE WEIGHTS AT ALL, since it is not the optimiser: 3000
// steps against 12000 on identical data moves them by 0.30 of vector length
// against a norm of 6.10, while the re-dump moves them by 1.83. The candidates
// themselves changed. Every kept head is re-centred on its own ink now, so 132
// of the Bach's 365 rows and 158 of the Mozart's 448 come back as different
// pixels, and the false candidates the last round's fixes removed were the
// HARDEST negatives in the file: the ones that went away score a median of
// 0.088 under these weights against 0.048 for the ones that remain, and the
// Bach's hardest surviving negative reads 0.204 where the deleted one read
// 0.531. **A shape test that gets better at rejecting a false circle deletes
// the example that taught the classifier to reject it.** That is measured on
// the dump itself; what it is NOT is the explanation of CORE's 190, which the
// two-page fit above rules out.
//
// So the retraining rule in the handover is right and it is not sufficient: a
// retrain cannot be shipped until STEM_CUT is either page-relative or has an
// honest held-out measurement of its own, because it is the one constant on
// this score's scale that npm run scan:train never sees.
// ─────────────────────────────────────────────────────────────────────────────

export const GRID = 20;
export const SPAN = 4.8;   // staff spaces across the patch

// A patch of page, sampled in STAFF SPACES and normalised against the paper.
//
// Both the trainer and the reader call this. A second copy of it would drift
// from the first the day either changed, and a classifier fed patches built a
// different way is a classifier fed noise.
export function headPatch(gray, background, w, h, space, cx, cy) {
  const out = new Float32Array(GRID * GRID);
  const half = (SPAN * space) / 2;
  for (let gy = 0; gy < GRID; gy++) {
    for (let gx = 0; gx < GRID; gx++) {
      const x = Math.round(cx - half + ((gx + 0.5) / GRID) * half * 2);
      const y = Math.round(cy - half + ((gy + 0.5) / GRID) * half * 2);
      if (x < 0 || x >= w || y < 0 || y >= h) continue;
      const i = y * w + x;
      const paper = Math.max(1, background[i]);
      // How dark, as a fraction of how light the paper is here: zero is paper,
      // one is as black as this page gets. A patch from a 10px page and one
      // from a 12px page are then the same picture of the same thing, and the
      // classifier cannot learn the scanner instead of the music.
      out[gy * GRID + gx] = Math.max(0, Math.min(1, (paper - gray[i]) / paper));
    }
  }
  return out;
}

// Rounded to a byte on the way in, as the trainer sees them, so the reader and
// the trainer agree to the last bit.
export function headScore(patch) {
  let z = BIAS;
  for (let k = 0; k < patch.length; k++) z += WEIGHTS[k] * (Math.round(patch[k] * 255) / 255);
  return 1 / (1 + Math.exp(-z));
}

const BIAS = -3.99532;
const WEIGHTS = Float64Array.from([
  0.18097, 0.09654, -0.00462, 0.04694, 0.00443, -0.07059, -0.06635, -0.07081,
  -0.02385, 0.21778, 0.28258, 0.11025, 0.15885, 0.14377, -0.06491, -0.00089,
  0.08569, 0.16757, 0.113, 0.16281, 0.26992, 0.03368, 0.00399, 0.13136,
  0.17623, 0.1101, -0.03226, -0.04827, -0.1065, 0.10207, 0.17881, -0.26823,
  0.12323, 0.2251, 0.05265, 0.02693, 0.06256, 0.11058, -0.00215, 0.00995,
  0.08177, -0.08836, -0.07039, 0.06356, -0.0126, -0.12966, -0.15927, -0.11527,
  -0.22306, -0.05992, 0.01206, -0.36966, 0.08084, 0.14921, -0.04846, -0.03723,
  0.09604, 0.0131, -0.04452, 0.00868, 0.15584, 0.03993, 0.04216, 0.10269,
  -0.02229, -0.14238, 0.0076, 0.02078, -0.15122, -0.21931, -0.28417, -0.48811,
  0.01851, 0.24264, 0.12193, 0.07043, 0.13076, 0.12045, 0.08277, 0.09318,
  -0.2979, -0.07221, -0.06734, -0.01867, -0.10414, -0.14165, 0.08719, 0.11951,
  -0.34034, -0.52932, -0.54405, -0.58275, 0.03496, 0.35089, 0.13668, -0.00088,
  0.07055, 0.1458, 0.21237, 0.24239, 0.06521, 0.307, 0.28454, 0.17036,
  -0.01823, -0.02173, 0.25296, 0.37297, -0.40997, -0.42091, -0.11623, 0.03745,
  0.48243, 0.50903, 0.17238, 0.01555, 0.02579, 0.0974, 0.06379, 0.19198,
  0.09931, 0.10239, 0.00734, -0.02312, -0.05298, -0.05958, -0.07043, -0.11497,
  -0.64513, -0.5464, -0.1744, -0.34576, 0.0384, 0.12978, -0.24396, -0.32055,
  -0.25027, -0.30998, -0.25205, 0.12529, -0.00306, -0.04408, -0.08275, -0.05439,
  -0.11737, -0.1586, -0.18639, -0.12943, -0.76978, -0.29414, 0.37991, -0.18533,
  0.08012, 0.18508, -0.21296, -0.26525, -0.33352, -0.32494, -0.18834, 0.11719,
  -0.18373, -0.31147, -0.29915, -0.16229, -0.34856, -0.4815, -0.45407, -0.26591,
  -0.54175, 0.6788, 1.56522, 0.68084, 0.20948, -0.0051, -0.28152, -0.2965,
  -0.44557, -0.30918, -0.14111, -0.04083, -0.2619, -0.06496, 0.01208, 0.02328,
  -0.25606, -0.34302, -0.43669, 0.11393, 0.30373, 1.45301, 1.60085, 0.5091,
  0.12147, -0.24852, -0.36912, -0.21603, -0.18692, -0.13389, -0.07295, 0.11133,
  -0.35496, -0.34169, -0.08515, -0.12135, -0.36815, -0.44815, -0.2077, 0.49386,
  0.58424, 1.23656, 1.21157, 0.14873, 0.00709, -0.23496, -0.20623, -0.18115,
  -0.0444, -0.09199, -0.01585, 0.18088, -0.60627, -0.30949, -0.04877, -0.03303,
  -0.31494, -0.50497, 0.10099, 0.62451, 0.659, 1.27987, 0.83778, -0.44685,
  -0.22012, 0.03452, -0.14254, -0.45109, -0.41639, -0.39405, -0.23302, 0.04677,
  -0.12087, 0.2649, 0.07879, 0.05824, -0.17669, -0.3158, 0.05398, 0.31138,
  0.36251, 0.74744, 0.43835, -0.33002, -0.09472, 0.13967, -0.04769, -0.40795,
  -0.63675, -0.43283, -0.20521, 0.26142, -0.17802, -0.07142, -0.17283, -0.21583,
  -0.24656, -0.33129, 0.03194, 0.1664, -0.00259, -0.01013, -0.16811, -0.52444,
  -0.22495, 0.11023, -0.02736, -0.53556, -0.6189, -0.37926, -0.18109, 0.18447,
  0.54128, 0.18757, 0.15587, 0.19907, 0.07857, 0.05492, 0.17315, 0.22972,
  0.13536, -0.32037, -0.49136, -0.4529, 0.02425, 0.26961, 0.11869, -0.04623,
  0.10146, 0.05824, 0.2663, 0.48905, 0.36524, -0.01394, 0.06774, 0.09675,
  0.07962, -0.11227, 0.18249, 0.21622, -0.16576, -0.61419, -0.59434, -0.52255,
  -0.12858, 0.02868, -0.10885, -0.23601, -0.13556, 0.20833, 0.40199, 0.22838,
  0.00341, -0.23983, -0.14806, -0.01689, 0.13622, 0.15778, 0.45611, 0.25406,
  0.15097, -0.24873, -0.2523, -0.28435, 0.03459, -0.00882, -0.05807, -0.05174,
  -0.00307, 0.24552, 0.32624, 0.10393, 0.27176, -0.0392, -0.22484, -0.14326,
  -0.00845, -0.05375, 0.31076, 0.22887, 0.19781, 0.03118, -0.16712, -0.12691,
  0.18691, -0.0621, -0.08612, -0.07678, 0.05027, 0.26058, 0.33211, 0.30054,
  0.2725, -0.02135, -0.17991, -0.01395, 0.20614, 0.01502, 0.28562, 0.21145,
  0.16661, 0.05299, 0.10512, 0.1494, 0.00107, -0.06331, -0.04834, 0.07841,
  0.18723, 0.38212, 0.47536, 0.48625, 0.30368, 0.20454, 0.1412, 0.07223,
  -0.06562, -0.21156, 0.12105, 0.20587, 0.31929, 0.12543, 0.1559, -0.00859,
  -0.02441, 0.07382, -0.03947, 0.01666, 0.07697, 0.27546, 0.32352, 0.14555,
]);
