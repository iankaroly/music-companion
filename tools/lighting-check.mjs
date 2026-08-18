// The page a player looks at, against the page the reader reads.
//
// A player asked for what a scanner app does — "makes the page brighter and
// eliminating shadows" — and the answer is two pages rather than one: the
// stored page keeps its lighting divided out and nothing else, because
// brightening what the READER reads costs it notes (`npm run scan:import`:
// 51.4% of the marks on three photographed pages down to 49.9%), while the
// pixels that go to the SCREEN are taken the rest of the way.
//
// This holds both halves at once, through the app's own drawing path: the same
// photograph, drawn twice, with `plain` the only difference.
//
//   npm run dev            (in another terminal, on port 5199)
//   npm run scan:light
//
import puppeteer from 'puppeteer-core';

const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const PORT = process.env.PORT ?? '5199';

const browser = await puppeteer.launch({ executablePath: SHELL, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1000, height: 1200 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 1200));

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

const seen = await page.evaluate(async () => {
  // A photograph of a page: cream paper, printed staves, a pencil mark, and a
  // lamp on the left so the right-hand side falls away.
  const shot = document.createElement('canvas');
  shot.width = 1000;
  shot.height = 1400;
  const g = shot.getContext('2d', { willReadFrequently: true });
  for (let y = 0; y < shot.height; y++) {
    const lamp = 1;
    g.fillStyle = `rgb(${214 * lamp} ${208 * lamp} ${192 * lamp})`;
    g.fillRect(0, y, shot.width, 1);
  }
  g.fillStyle = '#1c1a16';
  for (let system = 0; system < 8; system++) {
    const top = 90 + system * 150;
    for (let line = 0; line < 5; line++) g.fillRect(80, top + line * 12, 840, 2);
    for (let n = 0; n < 9; n++) g.fillRect(110 + n * 90, top + 20, 26, 16);
  }
  g.fillStyle = 'rgb(120 116 108)';           // a pencilled fingering
  g.fillRect(300, 60, 40, 14);
  const lamp = g.createLinearGradient(0, 0, shot.width, shot.height);
  lamp.addColorStop(0, 'rgb(0 0 0 / 0)');
  lamp.addColorStop(1, 'rgb(20 14 4 / 0.5)');
  g.fillStyle = lamp;
  g.fillRect(0, 0, shot.width, shot.height);

  const blob = await new Promise((go) => shot.toBlob(go, 'image/jpeg', 0.9));
  const { savePagesScore, loadScorePages } = await import('/src/store/db.js');
  const id = await savePagesScore({
    name: 'lighting check', source: 'camera', pageCount: 1, pages: [blob],
  });
  const payload = await loadScorePages(id);
  const { openPaper } = await import('/src/ui/paper.js');
  const paper = await openPaper(payload);

  const drawn = async (plain) => {
    const canvas = document.createElement('canvas');
    const from = performance.now();
    await paper.draw(0, canvas, 900, 1300, null, { plain });
    const took = performance.now() - from;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const lumas = [];
    for (let i = 0; i < data.length; i += 4 * 37) {
      lumas.push(data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
    }
    lumas.sort((a, b) => a - b);
    const at = (q) => lumas[Math.min(lumas.length - 1, Math.floor(lumas.length * q))];
    // The paper is the bright end, the ink the dark end, and the difference
    // between the two corners of the page is what a shadow IS.
    const corner = (x, y) => {
      const px = Math.round(canvas.width * x);
      const py = Math.round(canvas.height * y);
      const i = (py * canvas.width + px) * 4;
      return data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    };
    return {
      took: Math.round(took),
      paper: Math.round(at(0.9)),
      ink: Math.round(at(0.02)),
      lit: Math.round(corner(0.06, 0.03)),
      shadowed: Math.round(corner(0.94, 0.97)),
      wide: canvas.width,
    };
  };

  return { bright: await drawn(false), plain: await drawn(true) };
});

console.log(`      what the player sees: paper ${seen.bright.paper}, ink ${seen.bright.ink},`
  + ` corners ${seen.bright.lit} / ${seen.bright.shadowed}, drawn in ${seen.bright.took}ms`);
console.log(`      what the reader reads: paper ${seen.plain.paper}, ink ${seen.plain.ink},`
  + ` corners ${seen.plain.lit} / ${seen.plain.shadowed}, drawn in ${seen.plain.took}ms`);

check('the page on screen comes back with white paper',
  seen.bright.paper >= 240, `paper reads ${seen.bright.paper} of 255`);
check('and the shadow is gone — both corners the same paper',
  Math.abs(seen.bright.lit - seen.bright.shadowed) <= 14,
  `${seen.bright.lit} lit against ${seen.bright.shadowed} shadowed`);
check('with the print still print',
  seen.bright.ink <= 110, `ink reads ${seen.bright.ink}`);
check('the reader is handed the page unbrightened',
  seen.plain.paper < seen.bright.paper - 10,
  `${seen.plain.paper} against ${seen.bright.paper}`);
check('and brightening a page costs a fraction of a page turn',
  seen.bright.took - seen.plain.took < 400,
  `${seen.bright.took}ms against ${seen.plain.took}ms plain`);
check('no errors on the page', errors.length === 0, errors[0] ?? '');

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
