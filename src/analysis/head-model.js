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

const BIAS = -5.47588;
const WEIGHTS = Float64Array.from([
  -0.00495, 0.05274, 0.28558, 0.44265, 0.0909, -0.35888, -0.76276, -0.60003,
  -0.29748, -0.16176, -0.09125, 0.14684, 0.49344, 0.49968, 0.35184, 0.1885,
  0.108, 0.09829, 0.23733, 0.38947, 0.09952, -0.28036, -0.62357, -0.34984,
  0.03747, 0.06849, 0.03189, 0.19942, 0.39796, 0.33231, 0.17169, 0.08286,
  0.0395, -0.01647, -0.01598, 0.09199, -0.10202, -0.30247, -0.49686, -0.18538,
  0.17321, -0.02306, -0.25332, -0.16013, 0.0727, 0.11897, -0.10617, -0.28232,
  -0.13125, -0.18817, -0.22669, -0.05553, -0.13994, -0.3528, -0.62169, -0.141,
  0.24207, -0.12524, -0.48596, -0.3231, -0.01447, 0.10996, -0.13515, -0.39751,
  -0.33327, -0.34903, -0.25632, -0.0037, -0.04139, -0.27345, -0.39884, 0.244,
  0.52848, 0.04359, -0.13995, -0.03244, 0.08042, 0.16149, -0.04948, -0.27535,
  -0.35359, -0.35937, -0.24022, 0.0259, 0.00376, -0.29704, -0.18077, 0.58527,
  0.80985, 0.39714, 0.17869, 0.1861, 0.06776, 0.08849, 0.01166, -0.20697,
  -0.41761, -0.51805, -0.47283, -0.22918, -0.19767, -0.21126, 0.41908, 0.96584,
  1.02613, 0.72614, 0.37649, 0.29266, -0.12665, -0.31255, -0.46778, -0.48743,
  -0.18969, -0.24768, -0.28995, -0.01333, 0.14568, 0.04962, 0.55156, 0.92253,
  0.9876, 0.71529, 0.33363, 0.33705, 0.07664, -0.11624, -0.22213, -0.23305,
  -0.3105, -0.35627, -0.10137, 0.34074, 0.27794, 0.10054, 0.40803, 0.7996,
  0.88106, 0.49307, -0.00952, 0.03042, -0.10943, -0.13902, -0.06345, -0.15494,
  -0.41579, -0.43818, -0.02722, 0.42595, 0.21299, 0.04754, 0.49587, 0.81296,
  0.66857, 0.17133, -0.50169, -0.43143, -0.23933, -0.0238, 0.06218, -0.1113,
  -0.39087, -0.33151, 0.12208, 0.38035, 0.07853, -0.04751, 0.47555, 0.83433,
  0.53648, -0.24903, -0.71721, -0.48088, -0.08271, 0.10218, -0.05157, -0.43155,
  -0.31653, -0.2471, 0.06684, 0.32704, 0.14771, 0.08718, 0.59343, 0.90963,
  0.52655, -0.1951, -0.47004, -0.26456, -0.1034, 0.00429, -0.25897, -0.64716,
  -0.31554, -0.33661, -0.07698, 0.07401, 0.08545, 0.08512, 0.31578, 0.51834,
  0.0995, -0.27011, -0.4302, -0.26565, -0.11669, 0.01126, -0.22035, -0.53401,
  -0.16574, -0.18291, 0.05994, 0.14927, -0.00804, 0.01119, 0.1979, 0.3226,
  -0.03657, -0.35297, -0.41892, -0.22843, -0.0084, 0.14475, -0.00716, -0.34071,
  0.37546, 0.31533, 0.34104, 0.27714, 0.26243, 0.22123, 0.16431, 0.09755,
  -0.38458, -0.6113, -0.37701, -0.03836, 0.34396, 0.45269, 0.22903, -0.01448,
  0.37639, 0.27102, 0.30444, 0.37663, 0.369, 0.21633, -0.0798, -0.34438,
  -0.73765, -0.78913, -0.38893, -0.0693, 0.32065, 0.34785, 0.12981, -0.07798,
]);
