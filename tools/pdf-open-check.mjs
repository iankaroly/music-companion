// A PDF, imported the way a player imports one, and then OPENED.
//
// "when i uploaded a pdf i tried to open it and it said null and didnt work."
//
// Every other tool here builds a PDF-backed part by calling `savePagesScore`
// directly, which skips the two things a player actually does: hand the file to
// the picker, and then tap the part on the shelf. This does both — the real
// file input, the real import, the real open — and reports what the app says on
// the way.
//
//   npm run dev            (in another terminal, on port 5199)
//   npm run score:open
//
import { readFile } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';

const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const PORT = process.env.PORT ?? '5199';

// Any PDF on disk, so a part that failed can be tried directly:
//   npm run score:open -- ~/Downloads/whatever.pdf
const given = process.argv.slice(2).find((a) => !a.startsWith('-'));
const index = JSON.parse(await readFile(new URL('../pages/index.json', import.meta.url), 'utf8'));
const entry = given
  ? { name: given.split('/').pop().replace(/\.pdf$/i, ''), file: given.replace(/^~/, process.env.HOME) }
  : index[Number(process.env.PHOTO ?? 0)];
const bytes = (await readFile(entry.file)).toString('base64');

const browser = await puppeteer.launch({ executablePath: SHELL, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 900, height: 1200, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 1500));

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

const seen = await page.evaluate(async ({ b64, name }) => {
  const said = [];
  // Everything the app says while this happens, in order — the status line is
  // where "null" appeared.
  const status = document.querySelector('#score-status') ?? document.querySelector('#status');
  const watch = new MutationObserver(() => {
    const text = (status?.textContent ?? '').trim();
    if (text && said.at(-1) !== text) said.push(text);
  });
  if (status) watch.observe(status, { childList: true, characterData: true, subtree: true });

  const data = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const file = new File([data], `${name}.pdf`, { type: 'application/pdf' });

  // Through the app's own picker, which is the path a player takes.
  const input = document.querySelector('#score-pdf');
  let threw = null;
  let imported = null;
  try {
    if (input) {
      const bag = new DataTransfer();
      bag.items.add(file);
      input.files = bag.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      // The import is asynchronous behind the event; wait for the score to
      // appear in the library rather than for a fixed time.
      const { listScores } = await import('/src/store/db.js');
      for (let i = 0; i < 60 && !imported; i++) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, 250));
        // eslint-disable-next-line no-await-in-loop
        const rows = await listScores();
        imported = rows.find((r) => r.name?.startsWith(name)) ?? null;
      }
    }
  } catch (err) {
    threw = String(err?.message ?? err);
  }

  // …and then OPENED, which is the tap that produced "null".
  let opened = null;
  let openThrew = null;
  if (imported) {
    try {
      // THROUGH THE APP'S OWN DOOR — `openScoreFromLibrary`, which is what a
      // tap on the shelf calls. Reaching for `openReader` directly skips
      // whatever the library does on the way, and the library is where the
      // player's tap goes.
      const S = await import('/src/ui/score.js');
      await S.openScoreFromLibrary(imported.id);
      await new Promise((r) => setTimeout(r, 2500));
      const canvases = [...document.querySelectorAll('#reader canvas')];
      // Is there anything ON the page, or is it a blank rectangle?
      const inked = canvases.map((c) => {
        try {
          const ctx = c.getContext('2d', { willReadFrequently: true });
          const { data: px } = ctx.getImageData(0, 0, c.width, c.height);
          let dark = 0;
          for (let i = 0; i < px.length; i += 4 * 53) if (px[i] < 160) dark++;
          return dark;
        } catch { return -1; }
      });
      opened = {
        canvases: canvases.length,
        widest: Math.max(0, ...canvases.map((c) => c.width)),
        inked: Math.max(0, ...inked),
        text: (document.querySelector('#reader')?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 200),
      };
    } catch (err) {
      openThrew = String(err?.message ?? err);
    }
  }
  // AND WHAT THE READER MADE OF IT — the number a player sees as "N notes
  // found", and the one that came back as zero in a report.
  let read = null;
  if (imported) {
    try {
      const S2 = await import('/src/ui/score.js');
      const layout = await S2.measurePages(imported.id);
      const pages = (layout ?? []).filter(Boolean);
      read = {
        pages: pages.length,
        of: (layout ?? []).length,
        staves: pages.reduce((n, p) => n + (p.staves?.length ?? 0), 0),
        clefs: pages.reduce((n, p) => n + (p.staves ?? []).filter((st) => st.clef).length, 0),
        keys: pages.map((p) => (p.key ? (p.key.sharps ? p.key.sharps : -p.key.flats) : null)),
        keySource: pages.map((p) => p.keySource ?? null),
        clefKinds: (() => {
          const tally = {};
          for (const p of pages) {
            for (const st of p.staves ?? []) {
              const k = st.clef ?? 'none';
              tally[k] = (tally[k] ?? 0) + 1;
            }
          }
          return tally;
        })(),
        priced: (() => {
          const { headsOf } = window.__headsOf ?? {};
          return null;
        })(),
        heads: pages.reduce((n, p) => n
          + (p.staves ?? []).reduce((m, st) => m + (st.heads?.length ?? 0), 0), 0),
        space: pages[0]?.space ? Math.round(pages[0].space * 1400 * 1.4) : null,
      };
    } catch (err) {
      read = { threw: String(err?.message ?? err) };
    }
  }
  watch.disconnect();
  return {
    said, threw, opened, openThrew, read,
    imported: imported ? { id: imported.id, name: imported.name, kind: imported.kind, pageCount: imported.pageCount } : null,
  };
}, { b64: bytes, name: `open check ${entry.name}` });

console.log(`      the app said: ${seen.said.length ? seen.said.map((s) => `"${s}"`).join(' → ') : '(nothing)'}`);
console.log(`      imported: ${seen.imported ? JSON.stringify(seen.imported) : 'nothing'}`);
console.log(`      opened: ${seen.opened ? JSON.stringify(seen.opened).slice(0, 160) : seen.openThrew}`);
console.log(`      read: ${JSON.stringify(seen.read)}`);

check('the PDF imports through the picker', !!seen.imported && !seen.threw,
  seen.threw ?? (seen.imported ? `${seen.imported.pageCount} page(s)` : 'nothing was imported'));
check('nothing the app said was "null"',
  !seen.said.some((s) => /\bnull\b/i.test(s)), seen.said.find((s) => /\bnull\b/i.test(s)) ?? '');
check('it opens without throwing', !!seen.opened && !seen.openThrew, seen.openThrew ?? '');
check('and the page is drawn, with music on it',
  !!seen.opened && seen.opened.widest > 300 && seen.opened.inked > 50,
  seen.opened ? `${seen.opened.canvases} canvases, widest ${seen.opened.widest}px, ${seen.opened.inked} dark samples` : '');
check('the reader finds notes on it', (seen.read?.heads ?? 0) > 0,
  seen.read ? JSON.stringify(seen.read) : 'the reading pass did not run');
check('no errors on the page', errors.length === 0, errors[0] ?? '');

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
