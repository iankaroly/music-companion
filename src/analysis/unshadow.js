// Taking the lighting out of a photograph of a page — and finishing the job.
//
// A phone photograph of paper is unevenly lit: the lamp is on one side, your
// own head is on the other, and one corner of the page goes grey-brown. Blur
// the picture until the notes disappear and what is left is exactly that
// lighting; divide the photograph by it and the page comes back as if it had
// been lit evenly.
//
// THEN THE PAPER IS TAKEN TO WHITE, which this deliberately would not do until
// a player asked for it: "notice how an app like Scanner Pro makes the lighting
// better by making the page brighter and eliminating shadows. can you add that
// to my scanner". Dividing the light out flattens a shadow but leaves the whole
// page the shade it was photographed at — a grey-brown sheet, evenly grey-brown
// — and that is not what a scanner app hands you. So after the division the
// page is stretched: whatever the local paper is worth becomes white, and
// everything darker keeps its distance from it.
//
// WHAT IS STILL REFUSED, and why the stretch is gentle. Scanner apps have a
// second mode that pushes the ink to black and the paper to pure white, and on
// a page of music that mode is a lie: a pencilled fingering comes back looking
// like print, a faint slur like a beam, an editor's grey hairpin like a black
// smudge. So there is no threshold here and nothing is snapped to either end —
// the curve is monotonic and shallow (`INK_KEEP`), so a pencil mark stays a
// shade lighter than the print it sits beside, exactly as it does on the paper.
// What changes is that the paper under it is now white.
//
// MEASURED, `npm run scan:import` — the three marked pages photographed and
// brought in the way the app brings a scan in, then read and scored against the
// hand marks: the brightening does not cost the reader a note.

const GAIN = 2.2;      // the most a shadow may be lifted
// Where the paper ends up, and how much of the way ink comes with it.
//
// `PAPER_AT` is the reflectance the local paper is taken to be — a shade under
// 1, so that paper reaches white rather than nearly-white, and the odd bright
// speck does not decide the level for everything around it.
//
// AND THERE IS NO SECOND TERM PULLING THE INK DOWN, which was written, measured
// and taken out again. A knee at the foot of the curve — everything darker than
// the paper pushed a further 12% away from it — is what makes a scanner app's
// output look crisp, and `test/scan-enhance.test.js` has held the opposite
// since before this round: "the ink may be lifted with the paper around it — it
// must never be pushed down towards black, which is what 'enhancing' a scan
// usually means and what turns a pencilled fingering into print." The knee took
// the print from 53 to 49 out of 255, which is small and is the wrong
// direction. The page is brightened by lifting the PAPER, and the ink comes up
// with it rather than being driven down.
// WHERE THE PAPER LANDS, and why it is not 255.
//
// Taking the paper to white by overshooting and letting the clamp do the work
// looks right and is not: everything within a few per cent of the paper clips
// to white WITH it, and on a photograph the faintest staff lines are exactly a
// few per cent under the paper. MEASURED, `npm run scan:import` with the paper
// overshot: recall over the three marked pages fell from 51.4% to 41.1%, the
// Concerto lost two of its ten staves and its key signature with them. The page
// looked splendid and the reader could no longer read it.
//
// So the paper lands just under white, with headroom left for whatever is
// barely darker than it. The page is still transformed — a cream sheet
// photographed at 214 comes back at 248 — and nothing near it is thrown away.
const PAPER_TO = 248;

// HOW CLOSE TO THE PAPER A PIXEL HAS TO BE BEFORE IT IS LIFTED WITH IT.
//
// The brightening used to scale every pixel by the same ratio — paper and ink
// together — which takes the paper to white and the ink most of the way there
// with it. On a page of dense semiquavers, where the local paper level is held
// up by FLOOR, a black notehead came back mid-grey: "it makes it more white and
// harder to see the black notes. if anything it should be easier to see the
// notes."
//
// So the lift now fades out as a pixel gets darker than the paper. At 1 it is
// paper and goes to white; at INK_AT and below it is ink and is left exactly as
// photographed. Between the two it is blended, so a faint staff line is not
// snapped either way.
//
// This only ever REDUCES the lift, so it cannot push ink towards black — the
// thing `test/scan-enhance.test.js` has forbidden since long before this round,
// and the reason a pencilled fingering still looks like pencil.
const INK_AT = 0.82;

// The lighting, taken out of a page of RGBA pixels in place. Kept apart from
// the canvas so it can be looked at on its own: given a page with a shadow
// across it, the paper should come out one shade all over and the ink should
// come out no darker than it went in.
export function unshadow(data, w, h, { lift = false } = {}) {
  const count = w * h;
  const gray = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    gray[i] = data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114;
  }
  // The lighting: the picture, very blurred. The radius is a fraction of the
  // page, so it follows the shadow without following the notes.
  const radius = Math.max(8, Math.round(Math.min(w, h) / 14));
  const light = blur(gray, w, h, radius);
  // What the paper is worth where the light is best — the ninetieth percentile
  // rather than the average, because the average is paper mixed with ink and
  // would leave the whole page a shade grey.
  const sample = [];
  for (let i = 0; i < count; i += Math.max(1, Math.floor(count / 4000))) sample.push(light[i]);
  sample.sort((a, b) => a - b);
  const target = Math.max(1, sample[Math.floor(sample.length * 0.9)] ?? 200);
  // …AND THE LOCAL PAPER LEVEL IS NOT ALLOWED TO FALL BELOW A SHARE OF IT.
  //
  // The blur is the paper's own lighting only where the page is mostly paper.
  // Over a heavily inked passage — a page of semiquavers, a thick beamed group,
  // a black rehearsal box — the blur follows the INK down, and a ratio taken
  // against it says "this is paper" about a notehead and takes it to white.
  // That is the one way an enhancement like this can delete music rather than
  // reveal it. Under 45% of the page's own paper, the reading is treated as ink
  // and gets no lift at all.
  const FLOOR = target * 0.45;
  // …AND THE COLOUR OF THE PAPER, taken out when the page is being brightened.
  //
  // Paper photographed under a lamp is tea-coloured, and dividing the LIGHTNESS
  // out leaves it tea-coloured — brighter tea. A scanner app hands you white
  // paper, so each channel is scaled by what that channel's own paper is worth:
  // the same page, the same ink, with the room's colour taken off it. Left
  // alone entirely when the page is only being flattened for the reader, which
  // reads a grey and does not care.
  const balance = [1, 1, 1];
  if (lift) {
    for (let c = 0; c < 3; c++) {
      const seen = [];
      for (let i = 0; i < count; i += Math.max(1, Math.floor(count / 4000))) seen.push(data[i * 4 + c]);
      seen.sort((a, b) => a - b);
      const paperC = Math.max(1, seen[Math.floor(seen.length * 0.9)] ?? 200);
      balance[c] = paperC;
    }
    const most = Math.max(...balance);
    for (let c = 0; c < 3; c++) balance[c] = most / balance[c];
  }

  for (let i = 0; i < count; i++) {
    // What this pixel is worth against the paper AROUND it, rather than against
    // the page as a whole: 1 is paper, and a notehead on a page in shadow reads
    // the same as a notehead in the light. That is the whole of the division,
    // and it is what makes the stretch below safe to do at all — stretching a
    // photograph that still has its lighting in it deepens the shadow.
    const paper = Math.max(1, FLOOR, light[i]);
    const r = gray[i] / paper;
    // Paper to just under white, everything else lifted with it in proportion —
    // or, without `lift`, only the lighting divided out and the page left the
    // shade it was photographed at.
    //
    // THE TWO ARE SEPARATE BECAUSE THEY ARE FOR DIFFERENT EYES, and that is
    // measured rather than assumed. MEASURED, `npm run scan:import`: brightening
    // the page the READER works from costs it notes — 51.4% of the marks on the
    // three photographed pages down to 49.9% — because taking the paper up
    // takes the faintest staff lines with it, and they are what a stave is
    // found by. So the reader gets the page with its lighting flattened and
    // nothing else, and the player looking at it gets the bright one.
    // How paper-like this pixel is: 1 at the paper's own level, 0 once it is
    // ink. Only the paper end of that is lifted.
    const paperness = Math.max(0, Math.min(1, (r - INK_AT) / (1 - INK_AT)));
    const want = lift
      // Ink stays where it was photographed, paper goes to just under white,
      // and what is in between moves in proportion. The gap between the two —
      // which is the only thing that makes a note easy to see — widens.
      ? Math.min(255, gray[i] + (r * PAPER_TO - gray[i]) * paperness)
      // AND THE SAME ON THE PAGE THAT IS STORED, which is the half of this that
      // was missed the first time. Flattening the lighting multiplies every
      // pixel where the light was poor — INCLUDING THE INK. A black notehead in
      // the shadowed corner of a photograph, at 40, comes back at 88: grey, on
      // a page that has just been made whiter around it. That is the whole of
      // "it makes it more white and harder to see the black notes", and fixing
      // only the brightening left it in place, because this is the page a
      // player actually looks at.
      //
      // The lift is the same shape as above: full on paper, none on ink.
      : Math.min(255, gray[i] + (Math.min(255, gray[i] * Math.min(GAIN, target / paper)) - gray[i]) * paperness);
    // Applied as one scale on all three channels, so the page keeps whatever
    // colour it had — cream stays cream, a blue-lit page stays blue-lit, and
    // nothing here can turn a photograph into a two-tone facsimile.
    //
    // Capped, because past a point a pixel is not shadowed paper, it is a dark
    // photograph, and multiplying it up multiplies its noise with it.
    const was = Math.max(1, gray[i]);
    const scale = Math.min(GAIN, want / was);
    const at = i * 4;
    data[at] = Math.min(255, data[at] * scale * balance[0]);
    data[at + 1] = Math.min(255, data[at + 1] * scale * balance[1]);
    data[at + 2] = Math.min(255, data[at + 2] * scale * balance[2]);
  }
  return data;
}

// A separable box blur — two passes, no per-pixel cost beyond a running sum.
function blur(src, w, h, radius) {
  const tmp = new Float32Array(w * h);
  const dst = new Float32Array(w * h);
  const span = radius * 2 + 1;
  for (let y = 0; y < h; y++) {
    let sum = 0;
    for (let x = -radius; x <= radius; x++) sum += src[y * w + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = sum / span;
      sum += src[y * w + Math.min(w - 1, x + radius + 1)] - src[y * w + Math.max(0, x - radius)];
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = -radius; y <= radius; y++) sum += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      dst[y * w + x] = sum / span;
      sum += tmp[Math.min(h - 1, y + radius + 1) * w + x] - tmp[Math.max(0, y - radius) * w + x];
    }
  }
  return dst;
}

