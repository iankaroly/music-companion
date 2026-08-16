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

export const GRID = 16;
export const SPAN = 2.4;   // staff spaces across the patch

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

const BIAS = -5.33557;
const WEIGHTS = Float64Array.from([
  -0.02781, 0.01461, 0.2449, 0.40214, 0.04344, -0.3706, -0.70259, -0.55073,
  -0.28922, -0.1527, -0.08705, 0.12853, 0.50482, 0.47933, 0.27473, 0.18395,
  0.05381, 0.03769, 0.21405, 0.38109, 0.08637, -0.25434, -0.56376, -0.30724,
  0.00426, 0.03213, -0.00275, 0.13291, 0.34131, 0.26608, 0.11413, 0.1054,
  0.01268, -0.04784, -0.04189, 0.06017, -0.16141, -0.36186, -0.58286, -0.28317,
  0.08414, -0.08477, -0.33895, -0.22543, 0.07619, 0.10217, -0.14056, -0.31421,
  -0.11686, -0.17876, -0.19623, -0.03463, -0.18226, -0.39977, -0.66715, -0.19615,
  0.23765, -0.15011, -0.4913, -0.29984, 0.08838, 0.14193, -0.16015, -0.38206,
  -0.28648, -0.30746, -0.19364, 0.05028, -0.03967, -0.24917, -0.38092, 0.22216,
  0.63797, 0.17689, -0.09519, -0.02976, 0.13448, 0.1806, -0.04778, -0.24959,
  -0.37107, -0.38494, -0.23166, 0.03002, -0.02269, -0.30227, -0.22643, 0.52228,
  0.86966, 0.47742, 0.11989, 0.06561, 0.07549, 0.08151, -0.02079, -0.21957,
  -0.44303, -0.52, -0.46451, -0.24289, -0.2394, -0.20622, 0.40861, 0.93623,
  1.04366, 0.69616, 0.24337, 0.18519, -0.06797, -0.297, -0.51751, -0.48939,
  -0.19089, -0.25688, -0.29577, -0.02803, 0.15472, 0.13337, 0.67227, 0.96967,
  1.00059, 0.70868, 0.26948, 0.31256, 0.16966, -0.03657, -0.26068, -0.27786,
  -0.28988, -0.34987, -0.08553, 0.3364, 0.33069, 0.22062, 0.44365, 0.68897,
  0.8792, 0.4942, 0.08439, 0.15628, -0.04897, -0.09062, -0.09266, -0.20326,
  -0.42933, -0.41816, -0.02956, 0.39517, 0.2412, 0.1096, 0.34205, 0.62403,
  0.59922, 0.18012, -0.3473, -0.27047, -0.19664, -0.00205, 0.02905, -0.14443,
  -0.48963, -0.37692, 0.03356, 0.34702, 0.06043, -0.04644, 0.34478, 0.71695,
  0.54733, -0.20457, -0.67125, -0.47375, -0.1275, 0.05459, -0.13147, -0.48539,
  -0.3766, -0.26657, 0.03658, 0.36337, 0.15316, 0.13086, 0.5652, 0.88142,
  0.59219, -0.09142, -0.44999, -0.30704, -0.11442, -0.00654, -0.30044, -0.67472,
  -0.32412, -0.32032, -0.05471, 0.1162, 0.07635, 0.11049, 0.21424, 0.42966,
  0.14269, -0.24372, -0.503, -0.34271, -0.04996, 0.08291, -0.18441, -0.50518,
  -0.23458, -0.16424, 0.03428, 0.14135, -0.00655, 0.03038, 0.09515, 0.23034,
  -0.0244, -0.3589, -0.44869, -0.27639, 0.09851, 0.26269, 0.045, -0.35161,
  0.34579, 0.37375, 0.3293, 0.32023, 0.24022, 0.20917, 0.08603, 0.01526,
  -0.28753, -0.53873, -0.4095, -0.10149, 0.38543, 0.50547, 0.17911, -0.15743,
  0.37978, 0.27354, 0.27333, 0.38539, 0.33075, 0.20715, -0.11289, -0.37802,
  -0.63513, -0.73749, -0.44037, -0.11249, 0.37313, 0.42896, 0.08765, -0.23586,
]);
