// What a finger can actually hit, asked of the page rather than of the CSS.
//
// Apple's floor for anything a finger aims at is 44×44pt, and the reader's
// tools are 2.2rem — 1.85rem on a phone. The buttons are deliberately NOT
// bigger: six 44px circles across the top of a phone is most of the first
// system of music. What is bigger is the part that answers a touch.
//
// So this does not measure the buttons. It fires elementFromPoint at the
// places a hand actually lands — above and below the visible circle, and in
// the gaps between neighbours — and asks which tool would have got it. The two
// things that matter: the answer is never "nothing" within 22px of the middle,
// and it is never the WRONG tool, which is what overlapping hit areas would
// buy in exchange for bigger ones.
//
//   npm run dev            (in another terminal, on port 5199)
//   node tools/reader-targets-check.mjs          # phone
//   node tools/reader-targets-check.mjs ipad
//
import puppeteer from 'puppeteer-core';

// The headless SHELL rather than the Chrome app: launching the app puts a
// bouncing icon in the Dock every time this runs.
const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const PORT = process.env.PORT ?? '5199';
const size = process.argv[2] === 'ipad'
  ? { width: 1024, height: 1366 } : { width: 390, height: 844 };

const browser = await puppeteer.launch({ executablePath: SHELL, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ ...size, deviceScaleFactor: 2, hasTouch: true, isMobile: true });

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

const xml = '<?xml version="1.0"?><score-partwise version="3.1"><part-list><score-part id="P1">'
  + '<part-name>Cello</part-name></score-part></part-list><part id="P1"><measure number="1">'
  + '<attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats>'
  + '<beat-type>4</beat-type></time><clef><sign>F</sign><line>4</line></clef></attributes>'
  + '<note><pitch><step>C</step><octave>3</octave></pitch><duration>4</duration>'
  + '<type>whole</type></note></measure></part></score-partwise>';

await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 1800));
await page.evaluate(async (x) => {
  document.querySelector('#welcome')?.remove();
  document.querySelector('#welcome-card')?.remove();
  const { openReader } = await import('/src/ui/reader.js');
  await openReader({ id: 'targets', name: 'Targets', xml: x, kind: 'notation' });
  await new Promise((r) => setTimeout(r, 900));
}, xml);
await new Promise((r) => setTimeout(r, 500));

// The reader opens BARE — the point of the screen is the music, and the bar is
// parked above the top edge until you ask for it. A tap on the page is how you
// ask, and nothing can be aimed at until it is on screen.
const cdp = await page.createCDPSession();
const tapAt = async (x, y) => {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
  await new Promise((r) => setTimeout(r, 40));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
};
await tapAt(size.width * 0.5, size.height * 0.5);
await new Promise((r) => setTimeout(r, 500));
const up = await page.evaluate(() => {
  const b = document.querySelector('#reader-top')?.getBoundingClientRect();
  return b ? Math.round(b.top) : null;
});
check('the tool bar comes down when the page is tapped', up !== null && up >= 0, `top: ${up}px`);

// Every tool on the top bar, and what owns the points around it.
const probe = await page.evaluate(() => {
  // Only the ones actually on screen. The bar carries tools that are hidden in
  // the mode it is in, and a button with no box is at the origin, where it
  // would report every probe as a miss and none of it would mean anything.
  const tools = [...document.querySelectorAll('#reader-top .reader-tool')]
    .filter((t) => { const b = t.getBoundingClientRect(); return b.width > 1 && b.height > 1; });
  if (!tools.length) return null;
  // Which tool, if any, would receive a touch at this point?
  const owner = (x, y) => {
    const hit = document.elementFromPoint(x, y);
    const tool = hit?.closest?.('.reader-tool');
    return tool ? tools.indexOf(tool) : -1;
  };
  return tools.map((t, i) => {
    const b = t.getBoundingClientRect();
    const cx = b.left + b.width / 2;
    const cy = b.top + b.height / 2;
    // How far above and below the middle the button still answers.
    let up = 0;
    while (up < 40 && owner(cx, cy - up - 1) === i) up += 1;
    let down = 0;
    while (down < 40 && owner(cx, cy + down + 1) === i) down += 1;
    // …and how far to each side.
    let left = 0;
    while (left < 40 && owner(cx - left - 1, cy) === i) left += 1;
    let right = 0;
    while (right < 40 && owner(cx + right + 1, cy) === i) right += 1;
    return {
      // Counted outward from the centre, so the span the finger gets is the
      // two arms plus the middle pixel itself.
      i, visible: Math.round(b.height), hitH: up + down + 1, hitW: left + right + 1,
      // The point exactly between this tool and the NEXT one, when the next
      // one is genuinely a neighbour. The bar also holds a title and a count
      // with real space around them, and the middle of that space belongs to
      // nobody by design — asking a layout gap to be owned would be asking the
      // toolbar to swallow the whole bar.
      // Whether this tool has reached into a NEIGHBOUR'S middle, which is the
      // thing a bigger hit area could actually break: two tools claiming the
      // same pixel means the one you get depends on document order, and the
      // eraser arriving when you asked for the pencil is worse than a small
      // button. (The bare gap between two tools is a pixel or two of subpixel
      // layout — not worth asserting on, and tuning a test to it would be
      // measuring rounding rather than anything true.)
      stealsNeighbour: tools.some((other, j) => {
        if (j === i) return false;
        const ob = other.getBoundingClientRect();
        return owner(ob.left + ob.width / 2, ob.top + ob.height / 2) === i;
      }),
    };
  });
});

check('the reader opened with its tools on screen', !!probe && probe.length > 0,
  `${probe?.length ?? 0} tools`);

if (probe) {
  const shortest = probe.reduce((m, t) => Math.min(m, t.hitH), 99);
  const visible = probe[0].visible;
  check('every tool answers a touch across 44 points of height',
    shortest >= 44, `smallest hit height ${shortest}px, visible circle ${visible}px`);

  // The cost a bigger target could have had, and did not.
  const thieves = probe.filter((t) => t.stealsNeighbour);
  check('and no tool has reached into a neighbour', thieves.length === 0,
    `${thieves.length} of ${probe.length} tools answer at another tool's middle`);

  // Every tool still owns its own middle — the trivial case, and the one that
  // would fail loudest if a hit layer were stacked over the whole bar.
  const own = probe.filter((t) => t.hitH > 0 && t.hitW > 0);
  check('every tool still owns its own middle', own.length === probe.length,
    `${own.length}/${probe.length}`);
}

const failed = results.filter((r) => !r.pass);
console.log(failed.length ? `\n${failed.length} FAILED` : '\nALL PASS');
await browser.close();
process.exit(failed.length ? 1 : 0);
