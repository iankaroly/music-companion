// Where the blue outline actually lands, against paper drawn at known corners.
//
// The complaint this exists for is a real one, made about the real camera: the
// outline "lights up covering a lot more than just the sheet", and over an open
// book it covers the spread rather than stopping at one page. Nothing in this
// repo could see either of those. `scan:spread` proves a book comes back as two
// pages ON ONE DRAWING of a book — a dark table, a dark crease, a page filling
// its half of the frame — and a page found badly still passes it as long as two
// pages come back at all.
//
// So this draws camera frames whose corners are KNOWN, hands them to the same
// finder the live outline uses, and scores the quadrilateral it gets back
// against the paper it was drawn on:
//
//   IoU        how much of the outline is the page and how much of the page is
//              the outline, in one number. 1.0 is exact.
//   spill      the half of that the complaint is about: the fraction of what
//              was outlined that is NOT paper. A frame-sized outline on a page
//              filling a third of the frame is spill 0.66.
//   spans      the outline covered MORE THAN ONE PAGE of a spread — the second
//              half of the complaint, and a separate failure from a low IoU,
//              because an outline round both pages of a book is a perfectly
//              tight rectangle round the wrong thing.
//
// The frames are drawn rather than photographed because there is no photograph
// corpus in this repo, and the cases are the ones a phone over a music stand
// actually produces: paper on a light desk (where a global threshold has
// nothing to split), paper against a bright wall, a book whose fold is only
// just darker than its paper, the shadow of the phone lying across the page.
//
//   npm run dev                (in another terminal, on port 5199)
//   npm run scan:pages
//   npm run scan:pages -- --keep <dir>     write the frames out as PNGs
//
import puppeteer from 'puppeteer-core';
import { writeFileSync, mkdirSync } from 'node:fs';

const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const PORT = process.env.PORT ?? '5199';
const keepAt = process.argv.includes('--keep')
  ? process.argv[process.argv.indexOf('--keep') + 1] : null;
const only = process.argv.includes('--case')
  ? process.argv[process.argv.indexOf('--case') + 1] : null;

const browser = await puppeteer.launch({ executablePath: SHELL, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 900, height: 1200 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 1200));

const report = await page.evaluate(async (want, keep) => {
  const { findPages, probePages } = await import('/src/analysis/page-edges.js');
  // AND THE OUTLINE THE PLAYER IS ACTUALLY SHOWN. `findPages` is the finder;
  // `papersIn` is the finder plus the guard that decides whether a boundary it
  // found is really the edge of the paper, and the scanner draws the second
  // one. For eighteen cases they are the same answer, which is why this corpus
  // went its whole life measuring only the first — and then the one case where
  // they differ is the one he photographed. See `printReachesTo`.
  const { papersIn } = await import('/src/ui/straighten.js');

  // --- drawing a photograph -------------------------------------------------

  // Music on a leaf of paper: systems of five lines with beamed groups over
  // them, clipped to the quadrilateral the paper occupies. The ink matters —
  // it is what cuts a page into strips in a mask, and a finder tested on blank
  // paper is not tested.
  // `density` is how much of the paper is printed on, and it exists because
  // nothing in this corpus was ever a BUSY page. Every drawn sheet here reads
  // 20-39% ink, a real photographed cadenza reads 56%, and the finder refuses
  // anything over 62% as "not paper but ink" — so the case that fails was the
  // one case never drawn. 1 is the old page; 3 is a page of semiquaver runs.
  // `inset`: how far in from the paper's edge the printing starts, as a share
  // of the page's width. The default is a generous margin; a real part crammed
  // to the gutter is drawn with a small one, and the difference matters — an
  // outline that loses blank margin loses nothing, and one that loses the same
  // number of pixels of a tightly set page loses the end of every system.
  const musicOn = (g, quad, tone, density = 1, inset = 0.08) => {
    g.save();
    g.beginPath();
    quad.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.closePath();
    const left = Math.min(...quad.map((p) => p[0]));
    const top = Math.min(...quad.map((p) => p[1]));
    const w = Math.max(...quad.map((p) => p[0])) - left;
    const h = Math.max(...quad.map((p) => p[1])) - top;
    g.fillStyle = tone;
    g.fill();
    g.clip();
    g.fillStyle = '#1a1814';
    const systems = Math.round(8 * density);
    const step = 0.108 / density;
    for (let system = 0; system < systems; system++) {
      const y = top + h * (0.12 + system * step);
      for (let line = 0; line < 5; line++) {
        g.fillRect(left + w * inset, y + line * (h * 0.009 / density),
          w * (1 - inset * 2), Math.max(1, h * 0.0016));
      }
      const groups = Math.round(6 * density);
      const from = inset + 0.04;
      const across = (1 - inset * 2) - 0.06;
      for (let n = 0; n < groups; n++) {
        g.fillRect(left + w * (from + n * (across / groups)), y - h * 0.014,
          w * (0.08 / density) * 1.6, h * 0.006 * density);
      }
    }
    g.restore();
  };

  // The grain of a real frame: sensor noise and a little vignette. Without
  // them every threshold in the finder is being asked an easier question than
  // the camera asks it.
  const weather = (c, { noise = 7, vignette = 0.22 } = {}) => {
    const g = c.getContext('2d', { willReadFrequently: true });
    const image = g.getImageData(0, 0, c.width, c.height);
    const d = image.data;
    const cx = c.width / 2;
    const cy = c.height / 2;
    const far = Math.hypot(cx, cy);
    let seed = 12345;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff - 0.5;
    };
    for (let y = 0; y < c.height; y++) {
      for (let x = 0; x < c.width; x++) {
        const at = (y * c.width + x) * 4;
        const dim = 1 - vignette * (Math.hypot(x - cx, y - cy) / far) ** 2;
        const n = rand() * noise;
        for (let k = 0; k < 3; k++) d[at + k] = Math.max(0, Math.min(255, d[at + k] * dim + n));
      }
    }
    g.putImageData(image, 0, 0);
  };

  // A soft dark band, the way the phone's own shadow falls across a page.
  const shadow = (g, from, to, strength) => {
    const grad = g.createLinearGradient(from[0], from[1], to[0], to[1]);
    grad.addColorStop(0, `rgb(0 0 0 / 0)`);
    grad.addColorStop(0.5, `rgb(0 0 0 / ${strength})`);
    grad.addColorStop(1, `rgb(0 0 0 / 0)`);
    g.fillStyle = grad;
    g.fillRect(0, 0, 4000, 4000);
  };

  const norm = (quad, c) => quad.map(([x, y]) => [x / c.width, y / c.height]);

  // --- the corpus -----------------------------------------------------------
  //
  // Every case returns the frame and the paper that is really in it. `pages` is
  // the truth; `spread` says the two are one book, which is what makes an
  // outline round both of them a `spans` failure rather than a big page.

  const frame = (w, h, bg) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    return { c, g };
  };

  const CASES = [
    {
      name: 'sheet, dark table, square on',
      draw() {
        const { c, g } = frame(1200, 1600, '#2b2823');
        const quad = [[150, 150], [1050, 150], [1050, 1450], [150, 1450]];
        musicOn(g, quad, '#efeae2');
        weather(c);
        return { c, pages: [norm(quad, c)] };
      },
    },
    {
      name: 'sheet, dark table, tilted',
      draw() {
        const { c, g } = frame(1200, 1600, '#332e28');
        const quad = [[210, 180], [1040, 260], [980, 1430], [140, 1330]];
        musicOn(g, quad, '#f1ece4');
        weather(c);
        return { c, pages: [norm(quad, c)] };
      },
    },
    {
      // The one a global threshold cannot answer: pale wood, barely darker than
      // the paper. This is a music stand in a lit room, which is where the app
      // is used.
      name: 'sheet, PALE desk',
      draw() {
        const { c, g } = frame(1200, 1600, '#cfc3ae');
        const quad = [[170, 170], [1030, 170], [1030, 1440], [170, 1440]];
        musicOn(g, quad, '#f6f3ee');
        weather(c);
        return { c, pages: [norm(quad, c)] };
      },
    },
    {
      // A part on a black stand against a bright wall: the brightest large
      // thing in the frame is not the paper at all.
      name: 'sheet on stand, BRIGHT wall behind',
      draw() {
        const { c, g } = frame(1200, 1600, '#d9d5cd');
        g.fillStyle = '#26241f';                       // the stand's desk
        g.fillRect(90, 120, 1020, 1400);
        const quad = [[170, 200], [1030, 200], [1030, 1440], [170, 1440]];
        musicOn(g, quad, '#f4f1ea');
        weather(c);
        return { c, pages: [norm(quad, c)] };
      },
    },
    {
      name: 'sheet held close, filling the frame',
      draw() {
        const { c, g } = frame(1200, 1600, '#2b2823');
        const quad = [[24, 28], [1178, 22], [1182, 1574], [20, 1568]];
        musicOn(g, quad, '#efeae2');
        weather(c);
        return { c, pages: [norm(quad, c)] };
      },
    },
    {
      name: 'sheet with the phone\'s shadow across it',
      draw() {
        const { c, g } = frame(1200, 1600, '#2b2823');
        const quad = [[150, 150], [1050, 150], [1050, 1450], [150, 1450]];
        musicOn(g, quad, '#efeae2');
        shadow(g, [0, 500], [0, 1050], 0.42);
        weather(c);
        return { c, pages: [norm(quad, c)] };
      },
    },
    {
      // A part with the next sheet showing beside it on the desk. The outline
      // must take one of them, not the pair.
      name: 'sheet with another sheet beside it',
      draw() {
        const { c, g } = frame(1600, 1200, '#2b2823');
        const first = [[120, 130], [760, 130], [760, 1080], [120, 1080]];
        const second = [[860, 160], [1500, 160], [1500, 1110], [860, 1110]];
        musicOn(g, first, '#efeae2');
        musicOn(g, second, '#e9e4dc');
        weather(c);
        return { c, pages: [norm(first, c), norm(second, c)], apart: true };
      },
    },
    {
      name: 'open book, dark crease',
      draw() {
        const { c, g } = frame(1600, 1200, '#2b2823');
        const left = [[150, 130], [770, 165], [780, 1050], [140, 1075]];
        const right = [[830, 165], [1450, 130], [1460, 1075], [820, 1050]];
        musicOn(g, left, '#efeae2');
        musicOn(g, right, '#efeae2');
        g.fillStyle = 'rgb(60 55 48)';
        g.fillRect(775, 150, 50, 910);
        weather(c);
        return { c, pages: [norm(left, c), norm(right, c)], spread: true };
      },
    },
    {
      // The hard book: pressed flat under good light, so the gutter is a hint
      // rather than a crease, and the two leaves touch.
      name: 'open book, FAINT fold',
      draw() {
        const { c, g } = frame(1600, 1200, '#33302a');
        const left = [[140, 120], [795, 120], [795, 1080], [140, 1080]];
        const right = [[805, 120], [1460, 120], [1460, 1080], [805, 1080]];
        musicOn(g, left, '#f0ebe3');
        musicOn(g, right, '#f0ebe3');
        g.fillStyle = 'rgb(206 199 188)';              // barely a seam
        g.fillRect(790, 130, 20, 940);
        weather(c);
        return { c, pages: [norm(left, c), norm(right, c)], spread: true };
      },
    },
    {
      name: 'open book on a PALE desk',
      draw() {
        const { c, g } = frame(1600, 1200, '#c9bfae');
        const left = [[150, 140], [780, 140], [780, 1070], [150, 1070]];
        const right = [[820, 140], [1450, 140], [1450, 1070], [820, 1070]];
        musicOn(g, left, '#f6f3ee');
        musicOn(g, right, '#f6f3ee');
        g.fillStyle = 'rgb(150 141 128)';
        g.fillRect(782, 145, 36, 920);
        weather(c);
        return { c, pages: [norm(left, c), norm(right, c)], spread: true };
      },
    },
    {
      // THE COMPLAINT, and the one a book on a stand actually produces: the
      // phone is over ONE page, close enough to fill the frame with it, and a
      // BAND OF THE FACING PAGE is still in the picture down one side. The fold
      // is nowhere near the middle of what the camera sees — it is a fifth of
      // the way in — and both witnesses to a fold used to be looked for in the
      // middle third only, so there was no fold, no spread, and one outline
      // over the page and its neighbour's edge.
      // "when i scan a page from a book, it doesnt single out the page but
      // instead get part of the page to the right or left."
      name: 'book, ONE page, a BAND of the next one in shot',
      draw() {
        const { c, g } = frame(1500, 1100, '#2b2823');
        // The facing page is CUT BY THE PICTURE, which is what "part of the
        // page to the right or left" is: the phone is over one page and the
        // next one runs off the side of the frame rather than sitting neatly
        // inside it.
        const beside = [[-140, 100], [330, 80], [336, 1032], [-134, 1012]];
        const seen = [[0, 94], [330, 80], [336, 1032], [0, 1016]];
        const aimed = [[386, 78], [1442, 88], [1436, 1038], [380, 1028]];
        musicOn(g, beside, '#eae5dd');
        musicOn(g, aimed, '#efeae2');
        // A FAINT seam, because that is the one that goes wrong: a book
        // pressed flat under a lamp has a gutter a few levels darker than its
        // paper, so the two leaves are ONE bright region and nothing in the
        // mask parts them.
        g.fillStyle = 'rgb(204 197 186)';
        g.fillRect(336, 80, 50, 955);
        weather(c);
        return { c, pages: [norm(seen, c), norm(aimed, c)], spread: true, partial: [0] };
      },
    },
    {
      // The same thing with the phone further over: a SLIVER of the next page,
      // too little to be worth keeping as a page of its own. The answer here is
      // one page, cut at the fold — not one page with a strip of its neighbour
      // welded to it, which is what the spill column is counting.
      name: 'book, ONE page, a SLIVER of the next one',
      draw() {
        const { c, g } = frame(1500, 1100, '#2b2823');
        const beside = [[-140, 100], [150, 88], [156, 1030], [-134, 1012]];
        const aimed = [[206, 78], [1442, 88], [1436, 1038], [200, 1028]];
        musicOn(g, beside, '#eae5dd');
        musicOn(g, aimed, '#efeae2');
        g.fillStyle = 'rgb(204 197 186)';
        g.fillRect(156, 88, 50, 950);
        weather(c);
        return { c, pages: [norm(aimed, c)] };
      },
    },
    {
      // THE GUTTER SIDE FALLS INTO SHADOW, which is the mirror of the curl
      // below and is the frame he actually sent (`npm run scan:frame`, the
      // Bärenreiter Suites on a stand). A bound page does not lie flat: it
      // rises towards the spine, so the paper gets steadily darker over the
      // last tenth of its width, and the bright mask stops where the darkening
      // crosses the threshold — well short of the fold, and short of the ENDS
      // OF EVERY SYSTEM.
      //
      // Nothing pushed it back out. The guard that rescues a short outline is
      // refused on the side facing a neighbour, because on that side it used to
      // push the outline over the next page. MEASURED on his own frame: the
      // page was found at x..1064 with the fold at about 1135, so 70 pixels
      // carrying the last bar and a half of every line were outside the blue.
      //
      // This is what `printReachesTo` exists for. It is the ONLY case in this
      // corpus that can see it: with that code removed the corpus does not move
      // by a tenth of a point.
      name: 'book page whose GUTTER side falls into shadow',
      draw() {
        // DRAWN TO HIS FRAME'S OWN NUMBERS, read off it with
        // `npm run scan:frame -- <photo> --profile`. Averaged down the middle
        // half, the picture goes: table 26, his page 195-200 flat until about
        // four fifths across, then falling — 179, 171, 165, 144 — to a floor of
        // 135 that runs for a hundred pixels, then back up through 161, 186 to
        // 201 on the facing page.
        //
        // THE THING THAT FLOOR IS: not a crease. There is no dark seam in that
        // photograph at all. It is the two leaves' inner margins, both rising
        // towards the spine and both falling away from the lamp, meeting. The
        // Otsu cut lands INSIDE it, so the paper is parted there — which is
        // right, and gives two pages — and then the shave that separates two
        // touching regions eats fifty pixels off each of them, which is not.
        // Fifty pixels is the last bar and a half of every system.
        //
        // A drawn crease is what the earlier version of this case had, and it
        // does not reproduce the fault: with a real dark seam the split lands
        // on the seam and both edges are right. The absence of the crease is
        // the case.
        const { c, g } = frame(1500, 1100, '#1c1a17');
        const aimed = [[150, 86], [1046, 78], [1052, 1040], [156, 1032]];
        const facing = [[1052, 78], [1640, 86], [1646, 1042], [1046, 1040]];
        const seen = [[1052, 78], [1500, 82], [1500, 1040], [1046, 1040]];
        // A part set close to the paper's edge, the way an urtext cello part
        // is: on his photograph the systems run to within 4% of the fold, which
        // is exactly why fifty pixels of margin is not fifty pixels of nothing.
        musicOn(g, aimed, '#c9c5bd', 1, 0.035);
        musicOn(g, facing, '#c9c5bd', 1, 0.035);
        // Down into the gutter on this page…
        const into = g.createLinearGradient(880, 0, 1049, 0);
        into.addColorStop(0, 'rgb(0 0 0 / 0)');
        into.addColorStop(1, 'rgb(0 0 0 / 0.31)');
        g.fillStyle = into;
        g.fillRect(880, 78, 170, 962);
        // …and back out of it on the next one. No seam between them.
        const outOf = g.createLinearGradient(1049, 0, 1180, 0);
        outOf.addColorStop(0, 'rgb(0 0 0 / 0.31)');
        outOf.addColorStop(1, 'rgb(0 0 0 / 0)');
        g.fillStyle = outOf;
        g.fillRect(1049, 78, 132, 962);
        weather(c);
        return { c, pages: [norm(aimed, c), norm(seen, c)], spread: true, partial: [1] };
      },
    },
    {
      // THE OUTER EDGE OF A BOOK PAGE CURLS, and where it curls it goes into
      // shadow — a dark band down the page, a few per cent wide, in the same
      // place at the top, the middle and the bottom. That is every test a
      // CREASE has to pass. It is not a crease: there is nothing but margin
      // beyond it, where beyond a real gutter there is another page of music.
      // Drawn here because the round that widened the fold search to look for
      // gutters away from the middle made a curl on the right of a page into a
      // fold, cut the page at it, and outlined three quarters of the sheet:
      // "now its only highlighting blue for about 3/4s of the page, the far
      // right isnt in the blue."
      name: 'book page whose OUTER EDGE curls into shadow',
      draw() {
        const { c, g } = frame(1500, 1100, '#2b2823');
        const beside = [[-140, 100], [300, 82], [306, 1030], [-134, 1012]];
        const aimed = [[356, 78], [1420, 88], [1414, 1038], [350, 1028]];
        musicOn(g, beside, '#eae5dd');
        musicOn(g, aimed, '#efeae2');
        g.fillStyle = 'rgb(204 197 186)';              // the gutter, faint
        g.fillRect(306, 82, 50, 950);
        // …and the far edge of the sheet curling away from the lamp: a soft
        // dark band inside the paper, with the page's own margin beyond it.
        const curl = g.createLinearGradient(1240, 0, 1420, 0);
        curl.addColorStop(0, 'rgb(0 0 0 / 0)');
        curl.addColorStop(0.55, 'rgb(0 0 0 / 0.34)');
        curl.addColorStop(1, 'rgb(0 0 0 / 0.16)');
        g.fillStyle = curl;
        g.fillRect(1240, 80, 180, 960);
        weather(c);
        return { c, pages: [norm(beside, c), norm(aimed, c)], spread: true, partial: [0] };
      },
    },
    {
      // A BUSY PAGE, and the one nothing here has ever drawn. Every other sheet
      // in this corpus reads 20-39% ink; a photographed cadenza of semiquaver
      // runs reads 56%, and a page engraved by LilyPond at that density reads
      // 65%. The finder used to refuse anything over 62% as "not paper but
      // ink" — so the busier the music, the likelier the app was to fall back
      // to cropping the bright part of the frame, with no straightening at all
      // and nobody told. MEASURED, `npm run omr:truth`, before: a page found
      // and squared reads 85.5% of its notes in order, the same page merely
      // cropped reads 54.0%.
      name: 'sheet of DENSE music, semiquaver runs',
      draw() {
        const { c, g } = frame(1200, 1600, '#2b2823');
        const quad = [[150, 150], [1050, 150], [1050, 1450], [150, 1450]];
        musicOn(g, quad, '#efeae2', 2.5);
        weather(c);
        return { c, pages: [norm(quad, c)] };
      },
    },
    {
      // The complaint, drawn: a part lying on a desk barely darker than it is.
      // Paper and desk are one bright region, so the "page" is the frame.
      name: 'sheet on a WHITE desk',
      draw() {
        const { c, g } = frame(1200, 1600, '#e6e3dc');
        const quad = [[180, 190], [1020, 190], [1020, 1420], [180, 1420]];
        musicOn(g, quad, '#f8f6f2');
        weather(c);
        return { c, pages: [norm(quad, c)] };
      },
    },
    {
      // Paper TOUCHING something else bright — the ledge of a white stand, the
      // next part in the pile — which is how a bright region stops being one
      // page without anything looking wrong to a threshold.
      name: 'sheet touching a bright ledge',
      draw() {
        const { c, g } = frame(1200, 1600, '#2b2823');
        const quad = [[170, 170], [1030, 170], [1030, 1330], [170, 1330]];
        musicOn(g, quad, '#efeae2');
        g.fillStyle = '#e2ded6';                       // the stand's white lip
        g.fillRect(90, 1320, 1020, 150);
        weather(c);
        return { c, pages: [norm(quad, c)] };
      },
    },
    {
      // A window, a lamp, a white wall: a bright slab down one side of the
      // frame, not touching the paper. The outline must not reach for it.
      name: 'sheet with a bright slab beside it',
      draw() {
        const { c, g } = frame(1600, 1200, '#2b2823');
        const quad = [[140, 130], [820, 130], [820, 1080], [140, 1080]];
        musicOn(g, quad, '#efeae2');
        g.fillStyle = '#dcd8d0';
        g.fillRect(1010, 60, 540, 1100);
        weather(c);
        return { c, pages: [norm(quad, c)] };
      },
    },
    {
      // Nothing to find. A finder that answers here answers anywhere, which is
      // the failure that ruins a page rather than the one that annoys.
      name: 'no paper at all',
      draw() {
        const { c, g } = frame(1200, 1600, '#2b2823');
        g.fillStyle = '#3a352d';
        g.fillRect(200, 400, 300, 220);
        weather(c);
        return { c, pages: [] };
      },
    },
  ];

  // --- scoring --------------------------------------------------------------

  const areaOf = (poly) => {
    let sum = 0;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      sum += a[0] * b[1] - b[0] * a[1];
    }
    return Math.abs(sum) / 2;
  };

  // Sutherland–Hodgman: the part of `subject` inside convex `clip`.
  const clipTo = (subject, clip) => {
    let out = subject;
    for (let i = 0; i < clip.length && out.length; i++) {
      const a = clip[i];
      const b = clip[(i + 1) % clip.length];
      const side = ([x, y]) => (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
      const sign = areaOf(clip) && side(clip[(i + 2) % clip.length]) >= 0 ? 1 : -1;
      const inside = (p) => side(p) * sign >= 0;
      const next = [];
      for (let k = 0; k < out.length; k++) {
        const p = out[k];
        const q = out[(k + 1) % out.length];
        const pIn = inside(p);
        const qIn = inside(q);
        if (pIn) next.push(p);
        if (pIn !== qIn) {
          const sp = side(p);
          const sq = side(q);
          const t = sp / (sp - sq);
          next.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
        }
      }
      out = next;
    }
    return out;
  };

  const overlap = (a, b) => (a.length && b.length ? areaOf(clipTo(a, b)) : 0);
  const iou = (a, b) => {
    const both = overlap(a, b);
    const either = areaOf(a) + areaOf(b) - both;
    return either > 0 ? both / either : 0;
  };

  const rows = [];
  const shots = [];
  for (const one of CASES) {
    if (want && !one.name.includes(want)) continue;
    const { c, pages: truth, spread, apart, partial } = one.draw();
    const g = c.getContext('2d', { willReadFrequently: true });
    // The same reading the scanner takes: one luma value a pixel, at the width
    // the live outline is searched at.
    const w = 220;
    const h = Math.round((c.height / c.width) * w);
    const small = document.createElement('canvas');
    small.width = w; small.height = h;
    small.getContext('2d', { willReadFrequently: true }).drawImage(c, 0, 0, w, h);
    const { data } = small.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h);
    const luma = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) {
      luma[i] = data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114;
    }
    let found = [];
    let threw = null;
    let probe = null;
    try { found = findPages(luma, w, h); } catch (e) { threw = String(e); }
    let shown = [];
    try { shown = papersIn(c, c.width, c.height) ?? []; } catch { shown = []; }
    // WHICH OF THE TWO DIFFERENCES MOVED IT. `found` is `findPages` on the
    // canvas at full size; `shown` is `papersIn`, which is `findPages` on a
    // thumbnail PLUS the guard. When the two disagree, those are two suspects
    // and the column cannot tell them apart — so the middle term is taken here:
    // the finder at the scale the guard sees, before the guard runs.
    let raw = [];
    try {
      const { LOOK_AT } = await import('/src/ui/straighten.js');
      const lw = Math.min(LOOK_AT ?? 900, c.width);
      const lh = Math.max(1, Math.round(c.height * (lw / c.width)));
      const small = document.createElement('canvas');
      small.width = lw; small.height = lh;
      small.getContext('2d', { willReadFrequently: true }).drawImage(c, 0, 0, lw, lh);
      const sd = small.getContext('2d', { willReadFrequently: true })
        .getImageData(0, 0, lw, lh).data;
      const sl = new Float32Array(lw * lh);
      for (let i = 0; i < lw * lh; i++) {
        sl[i] = sd[i * 4] * 0.299 + sd[i * 4 + 1] * 0.587 + sd[i * 4 + 2] * 0.114;
      }
      raw = findPages(sl, lw, lh);
    } catch { raw = []; }
    try { probe = probePages(luma, w, h); } catch (e) { probe = [{ verdict: String(e) }]; }

    // Each found outline against the page it best fits, and how much of it is
    // not paper at all.
    const scored = found.map((quad) => {
      let best = 0;
      let onto = -1;
      truth.forEach((real, i) => {
        const score = iou(quad, real);
        if (score > best) { best = score; onto = i; }
      });
      const paper = truth.reduce((sum, real) => sum + overlap(quad, real), 0);
      const spans = truth.length > 1
        && truth.filter((real) => overlap(quad, real) > areaOf(real) * 0.35).length > 1;
      return {
        iou: best,
        onto,
        spill: areaOf(quad) ? 1 - paper / areaOf(quad) : 1,
        spans,
      };
    });
    const scoredShown = shown.map((quad) => {
      let best = 0;
      let onto = -1;
      truth.forEach((real, i) => {
        const score = iou(quad, real);
        if (score > best) { best = score; onto = i; }
      });
      return { iou: best, onto, spill: areaOf(quad) ? 1 - truth.reduce((sum, real) => sum + overlap(quad, real), 0) / areaOf(quad) : 1 };
    });
    // A page nobody outlined is a miss; it is not the same failure as a loose
    // outline and is counted apart.
    const missed = truth.filter((_, i) => !scored.some((s) => s.onto === i && s.iou > 0.3)).length;
    rows.push({
      name: one.name,
      spread: !!spread || !!apart,
      want: truth.length,
      got: found.length,
      threw,
      missed,
      iou: scored.map((s) => s.iou),
      onto: scored.map((s) => s.onto),
      spill: scored.map((s) => s.spill),
      // SPILL CANNOT BE SCORED AGAINST A PAGE THE PICTURE CUTS OFF. Where the
      // facing page runs off the side of the frame, the paper in the truth
      // stops at the frame's edge and the paper in the room does not, so an
      // outline that is exactly right still reads as spill. It is scored on the
      // pages that are wholly in shot — which includes, in every case here, the
      // page the shutter would actually keep.
      raw: raw.map((quad) => {
        let best = 0;
        truth.forEach((real) => { best = Math.max(best, iou(quad, real)); });
        return best;
      }),
      rawBoxes: raw.map((q) => [Math.min(...q.map((p) => p[0])), Math.max(...q.map((p) => p[0])),
        Math.min(...q.map((p) => p[1])), Math.max(...q.map((p) => p[1]))]),
      shownBoxes: shown.map((q) => [Math.min(...q.map((p) => p[0])), Math.max(...q.map((p) => p[0])),
        Math.min(...q.map((p) => p[1])), Math.max(...q.map((p) => p[1]))]),
      truthBoxes: truth.map((q) => [Math.min(...q.map((p) => p[0])), Math.max(...q.map((p) => p[0])),
        Math.min(...q.map((p) => p[1])), Math.max(...q.map((p) => p[1]))]),
      shown: scoredShown.map((s) => s.iou),
      shownLoose: scoredShown.map((s) => (partial ?? []).includes(s.onto)),
      shownSpill: scoredShown.map((s) => s.spill),
      loose: scored.map((s) => (partial ?? []).includes(s.onto)),
      spans: scored.some((s) => s.spans),
      probe,
    });
    if (keep) shots.push({ name: one.name, url: c.toDataURL('image/png') });
  }
  return { rows, shots };
}, only, !!keepAt);

if (keepAt) {
  mkdirSync(keepAt, { recursive: true });
  for (const shot of report.shots) {
    const file = `${keepAt}/${shot.name.replace(/[^a-z0-9]+/gi, '-')}.png`;
    writeFileSync(file, Buffer.from(shot.url.split(',')[1], 'base64'));
  }
  console.log(`frames written to ${keepAt}`);
}

const why = process.argv.includes('--why');
const pct = (n) => `${(n * 100).toFixed(1)}%`;
console.log('');
// WHY=<part of a case name> prints the sides, so a case that comes back at 84%
// says WHICH edge is short and by how much rather than only that it is.
const WHY = process.env.WHY ?? null;
console.log('case                                       want  got   IoU   SHOWN   spill  spans  missed');
let worstSpill = 0;
let spans = 0;
let wrongCount = 0;
let ious = [];
let shownIous = [];
let worstShownSpill = 0;
for (const row of report.rows) {
  const iou = row.iou.length ? row.iou.reduce((a, b) => a + b, 0) / row.iou.length : 0;
  const spill = row.spill.length ? Math.max(...row.spill) : 0;
  const scored = row.spill.filter((_, i) => !row.loose?.[i]);
  if (row.want) ious.push(...row.iou);
  if (row.want) shownIous.push(...(row.shown ?? []));
  if (WHY && row.name.toLowerCase().includes(WHY.toLowerCase())) {
    const say = (label, boxes) => {
      for (const [l, r, t, b] of boxes ?? []) {
        console.log(`      ${label.padEnd(22)} x ${l.toFixed(3)}..${r.toFixed(3)}`
          + `   y ${t.toFixed(3)}..${b.toFixed(3)}`);
      }
      if (!boxes?.length) console.log(`      ${label.padEnd(22)} —`);
    };
    console.log(`\n  ${row.name}`);
    say('the paper really is', row.truthBoxes);
    say('finder at 220 across', row.rawBoxes);
    say('…and after the guard', row.shownBoxes);
    console.log(`      route: ${JSON.stringify(row.probe)?.slice(0, 260)}`);
    console.log(`      IoU at full size ${row.iou?.map((v) => (v * 100).toFixed(1)).join(", ")}`
      + ` · at 220 ${row.raw?.map((v) => (v * 100).toFixed(1)).join(', ')}`
      + ` · shown ${row.shown?.map((v) => (v * 100).toFixed(1)).join(', ')}\n`);
  }
  const shownScored = (row.shownSpill ?? []).filter((_, i) => !row.shownLoose?.[i]);
  worstShownSpill = Math.max(worstShownSpill, shownScored.length ? Math.max(...shownScored) : 0);
  const shownIou = row.shown?.length ? row.shown.reduce((a, b) => a + b, 0) / row.shown.length : 0;
  worstSpill = Math.max(worstSpill, scored.length ? Math.max(...scored) : 0);
  if (row.spans) spans++;
  if (row.got !== row.want) wrongCount++;
  console.log(
    `${row.name.padEnd(42)}${String(row.want).padStart(3)}${String(row.got).padStart(5)}`
    + `${(row.iou.length ? pct(iou) : '   —').padStart(8)}`
    + `${(row.shown?.length ? pct(shownIou) : '   —').padStart(8)}`
    + `${(row.spill.length ? pct(spill) : '   —').padStart(8)}`
    + `${(row.spans ? 'YES' : '.').padStart(7)}`
    + `${String(row.missed).padStart(8)}`
    + `${row.threw ? `  THREW ${row.threw}` : ''}`,
  );
  if (!why) continue;
  // Each outline on its own. The row above is the mean IoU and the WORST spill,
  // which says a case is bad without saying which of its outlines is.
  row.iou.forEach((one, i) => {
    console.log(`      outline ${i + 1}: IoU ${pct(one)}  spill ${pct(row.spill[i])}`
      + `  onto page ${row.onto?.[i] ?? '?'}`);
  });
  for (const one of row.probe ?? []) {
    console.log(`      region ${pct(one.size ?? 0)} of frame  ink ${pct(one.ink ?? 0)}`
      + ` (before the trim ${pct(one.inkBefore ?? 0)}, kept ${pct(one.trimmed ?? 0)})`
      + `  fill ${pct(one.fill ?? 0)}  -> ${one.verdict}`);
    if (why && one.down) {
      console.log(`        paper down   ${one.down.join(' ')}`);
      console.log(`        paper across ${one.across.join(' ')}`);
    }
    if (one.span) {
      console.log(`        ink runs across ${one.span.across?.map((n) => n.toFixed(2)).join('..')}`
        + `  down ${one.span.down?.map((n) => n.toFixed(2)).join('..')}`);
    }
  }
}
const meanIou = ious.length ? ious.reduce((a, b) => a + b, 0) / ious.length : 0;
console.log('');
console.log(`mean IoU over every outline drawn on paper   ${pct(meanIou)}`);
// SHOWN is the outline the scanner DRAWS and shoots with — the finder plus the
// guard. It is the one the player sees and the only one that decides what is
// kept, and until this round no corpus measured it. On eighteen of nineteen
// cases it is the same number; on `book page whose GUTTER side falls into
// shadow` the guard is the whole answer.
const meanShown = shownIous.length ? shownIous.reduce((a, b) => a + b, 0) / shownIous.length : 0;
console.log(`…and of the outline the scanner SHOWS        ${pct(meanShown)}`);
console.log(`cases where the page count was wrong         ${wrongCount} of ${report.rows.length}`);
console.log(`cases where ONE outline spanned two pages    ${spans}`);
console.log(`worst spill (outline that was not paper)     ${pct(worstSpill)}`);
console.log(`…worst spill of the outline SHOWN            ${pct(worstShownSpill)}`);
console.log('   scored on the pages wholly in the picture; a page the frame cuts is not one');
// SPILL IS A GATE, not a printed number. An outline can be exactly the right
// COUNT and still be welded to a strip of the facing page — which is the
// complaint the two "book, ONE page" cases above are drawn from, and which
// `spans` cannot see, because the strip is not most of a page. The bar is the
// worst the corpus has ever read on a case that was right (9.0%, the page on a
// white desk) with a little room over it.
const SPILL_MOST = 0.12;
if (worstSpill > SPILL_MOST) console.log(`  ^ over the bar of ${pct(SPILL_MOST)}`);
if (errors.length) console.log(`page errors: ${errors.length}\n${errors.join('\n')}`);
await browser.close();
process.exit(spans || wrongCount || worstSpill > SPILL_MOST ? 1 : 0);
