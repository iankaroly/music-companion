// A page that has been read once is never replaced by "could not be read".
//
// The complaint: "after i open it, i see it for a few seconds and then it says
// page not read and i have to reopen it." The page was fine both times. The
// first decode worked; a later one — during a redraw, while the measuring pass
// was decoding the same pages beside it — did not, and the failure was drawn
// over a page that was already on the screen.
//
// This makes a decode fail ON PURPOSE, which is the only honest way to check
// what happens when one does: a page read normally, pushed out of the decoded
// cache by the pages around it, corrupted, and then asked for again. It must
// come back as the page, not as the card.
//
// WHAT IS GUARANTEED, exactly: a spare copy is kept of the last few pages that
// were looked at, so a page you are READING cannot turn into a card under you.
// A page you have never opened, on a device that cannot decode it, still says
// so — which is the only case that sentence was ever true of, and the second
// half of this check pins that too.
//
//   npm run dev        (in another terminal, on port 5199)
//   npm run reader:holds
//
import puppeteer from 'puppeteer-core';

const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const PORT = process.env.PORT ?? '5199';

const browser = await puppeteer.launch({ executablePath: SHELL, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
const problems = [];
page.on('pageerror', (err) => problems.push(`page error: ${err.message}`));
await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 900));

const result = await page.evaluate(async () => {
  const { openPaper } = await import('/src/ui/paper.js');

  const pageBlob = async (n) => {
    const c = document.createElement('canvas');
    c.width = 900;
    c.height = 1200;
    const x = c.getContext('2d');
    x.fillStyle = '#f4f2ec';
    x.fillRect(0, 0, c.width, c.height);
    x.fillStyle = '#111';
    x.font = 'bold 90px serif';
    x.fillText(`page ${n}`, 60, 140);
    for (let s = 0; s < 6; s++) {
      const top = 240 + s * 150;
      for (let l = 0; l < 5; l++) x.fillRect(60, top + l * 12, c.width - 120, 2);
    }
    return new Promise((res) => c.toBlob(res, 'image/jpeg', 0.9));
  };

  const pages = [];
  for (let i = 0; i < 12; i += 1) pages.push(await pageBlob(i + 1));
  const payload = { source: 'photos', pages };
  const paper = await openPaper(payload);

  const canvas = document.createElement('canvas');
  const drawn = async (index) => {
    await paper.draw(index, canvas, 800, 1000);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let ink = 0;
    for (let i = 0; i < data.length; i += 40) if (data[i] < 120) ink += 1;
    return ink;
  };

  const first = await drawn(0);
  // The pages around it, so page 1 is pushed out of the DECODED cache — which
  // is what happens while you read — but is still one of the pages recently
  // looked at.
  for (let i = 1; i < 9; i += 1) await drawn(i);

  // And now the page cannot be decoded at all. This is the phone refusing.
  pages[0] = new Blob([new Uint8Array([0x00, 0x01, 0x02, 0x03])], { type: 'image/jpeg' });

  const again = await drawn(0);
  const held = paper.trouble ? paper.trouble() : null;

  // And a page that has never been opened, which cannot be decoded: that one
  // must say so rather than pretend.
  pages[11] = new Blob([new Uint8Array([0x00, 0x01])], { type: 'image/jpeg' });
  const never = await drawn(11);
  return { first, again, trouble: held, after: paper.trouble ? paper.trouble() : null, never };
});

await browser.close();

console.log(`page 1, read normally      ${result.first} dark samples`);
console.log(`page 1, decode refused     ${result.again} dark samples`);
console.log(`fell back to a spare copy  ${result.trouble?.soft ?? '?'}`);
console.log(`showed the card            ${result.trouble?.card ?? '?'}`);

if (!(result.first > 0)) problems.push('the page did not draw at all the first time');
if (result.trouble?.card > 0) {
  problems.push('a page that had already been read was replaced by the "could not be read" card');
}
if (!(result.again > 0)) problems.push('nothing was drawn when the decode failed');
if (!(result.trouble?.soft > 0)) problems.push('the spare copy was not used');
// The other half: a page never read, which cannot be decoded, must still say so.
if (!(result.after?.card > result.trouble?.card)) {
  problems.push('a page that has never been read and cannot be decoded said nothing about it');
}
if (problems.length) {
  console.error(`\nFAILED:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  process.exit(1);
}
console.log('\nthe page held.');
