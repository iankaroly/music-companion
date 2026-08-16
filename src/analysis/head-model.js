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
// middle of it. Logistic regression over a 16x16 patch — 256 weights, small
// enough that not enough data cannot hide in it, and small enough to read.
//
// TESTED ON PAGES IT HAD NEVER SEEN, which is the only test worth quoting:
//
//   trained on the Mozart, scored on the Bach     87.4% precision -> 99.4%
//   trained on the Bach, scored on the Mozart     68.2% precision -> 91.5%
//
// Both ways, so what it learned is the shape of a notehead rather than the
// habits of one engraver. The weights shipped here are then fitted to BOTH
// pages, which means any number measured against those two pages is optimistic
// by construction — the honest figures are the two above, and npm run scan:train
// reprints them from scratch whenever the pages change.
//
// The asymmetry is the useful part: the Bach contributes 46 negative examples
// and the Mozart 136, and the model trained on the richer set is the one that
// travels better. More marked pages, and especially pages with different things
// wrong on them, is what makes this better — not more tuning.

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
