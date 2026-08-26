// A TAKE RECORDED FROM THE MUSIC HAS TO LAND SOMEWHERE YOU CAN FIND IT.
//
// "when you record from the score and then save it, it just saves to the
// library under that name or whatever name you want it. If you save another
// take, then that one in the library turns into a folder where it shows both
// the takes, because right now when you save it, it's not going anywhere."
//
// It WAS going somewhere. `saveRecording` ignored every name it was handed, so
// a take saved from a piece arrived with none — and `libraryRow` draws a take
// with no name as its DATE, with the piece it came from in the grey line
// underneath. Nothing on the shelf was called what he had just played, which is
// what "not going anywhere" means from the outside.
//
// TWO TAKES, THROUGH THE DOORS HE USES: the dot on the music, the save bar
// under the review, the name dialog with the piece already in it. The first is
// a row called by its name; the second makes a folder of that name with BOTH in
// it, and neither of them left loose outside it.
//
// NO MICROPHONE IS EVER OPENED — `getUserMedia` is replaced before the app
// loads, and the fake device plays real separated notes, because a take the
// segmenter finds nothing in is discarded and never reaches a save at all.
//
//   npm run dev            (on 5199)
//   npm run take:save
//
import puppeteer from 'puppeteer-core';
import { readFile } from 'node:fs/promises';

const APP = process.env.APP ?? 'http://localhost:5199';
const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const PIECE = 'Elgar — Salut d’Amour';

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

const browser = await puppeteer.launch({
  executablePath: SHELL,
  headless: true,
  args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
});
const page = await browser.newPage();
await page.setViewport({ width: 900, height: 1000, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

// The fake microphone from `reader:review`, verbatim in spirit: a cello-ish
// tone rather than a sine (YIN wants a harmonic series), a FRESH stream every
// time it is asked for (the app stops the tracks when a take ends, and this
// records twice), and a context that is resumed before anything is played.
await page.evaluateOnNewDocument(() => {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const fake = ctx.createMediaStreamDestination();
  const level = ctx.createGain();
  level.gain.value = 0;
  const partials = [1, 2, 3, 4].map((n) => {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    g.gain.value = 0.6 / n;
    osc.connect(g).connect(level);
    osc.start();
    return { osc, n };
  });
  level.connect(fake);
  window.__playNotes = async (midi, each = 0.4) => {
    await ctx.resume();
    const now = ctx.currentTime + 0.1;
    midi.forEach((m, i) => {
      const at = now + i * each;
      const hz = 440 * (2 ** ((m - 69) / 12));
      for (const { osc, n } of partials) osc.frequency.setValueAtTime(hz * n, at);
      level.gain.setValueAtTime(0.0001, at);
      level.gain.exponentialRampToValueAtTime(0.8, at + 0.03);
      level.gain.setValueAtTime(0.8, at + each * 0.72);
      level.gain.exponentialRampToValueAtTime(0.0001, at + each * 0.84);
    });
    return midi.length * each + 0.4;
  };
  navigator.mediaDevices.getUserMedia = async () => {
    await ctx.resume();
    const out = ctx.createMediaStreamDestination();
    level.connect(out);
    return out.stream;
  };
});

await page.goto(APP, { waitUntil: 'domcontentloaded' });
await new Promise((r) => setTimeout(r, 1400));

// An engraved part, because a page with no clef is a page the review can say
// nothing about — see the note in CLAUDE.md about the scan fixtures.
const font = (await readFile(new URL('./fonts/Bravura.otf', import.meta.url))).toString('base64');
const made = await page.evaluate(async ({ base64, piece }) => {
  [...document.querySelectorAll('button')]
    .find((b) => /start playing/i.test(b.textContent ?? ''))?.click();
  await new Promise((r) => setTimeout(r, 500));
  try {
    const { engravePart } = await import('/src/fixtures/engraved-page.js');
    const built = await engravePart({ base64, name: piece, pages: 1 });
    return { id: built.scoreId, midi: built.written.map((w) => w.midi).filter((m) => m != null) };
  } catch (err) { return { error: String(err) }; }
}, { base64: font, piece: PIECE });

if (made.error) {
  check('a piece to play from', false, made.error);
} else {
  // Reloaded: the fixture writes behind the app's back and the shelf is built
  // when the app starts.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await new Promise((r) => setTimeout(r, 1600));
}

// One take, from the dot on the music, saved under the piece with the name the
// dialog offers. Run twice.
async function aTake(midi, { name = null } = {}) {
  return page.evaluate(async ({ notes, piece, rename }) => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const out = {};
    [...document.querySelectorAll('button')]
      .find((b) => /start playing/i.test(b.textContent ?? ''))?.click();
    await wait(400);
    // The shelf on the Score tab, and a press on the piece's row: the Library
    // lists TAKES, so a score is opened from the other shelf.
    const nav = document.querySelector('nav[role="tablist"]');
    [...nav.querySelectorAll('button')].find((b) => /score/i.test(b.textContent ?? ''))?.click();
    await wait(1200);
    // THE SHELF'S OWN ROW, `#score-list`, and not any button whose words happen
    // to contain the piece's name. On the second lap the Score tab is showing
    // the REVIEW of the first take, whose save bar says "Add this take to
    // Elgar — Salut d'Amour" — pressing that opened nothing, and the check
    // then measured a lap that had not happened.
    const row = [...document.querySelectorAll('#score-list .lib-open')]
      .find((b) => (b.textContent ?? '').includes(piece));
    if (!row) {
      return {
        failed: 'the piece is not on the shelf',
        why: [...document.querySelectorAll('#score-list .lib-name')]
          .map((n) => n.textContent).join(' | ') || 'the shelf is empty',
      };
    }
    row.click();
    await wait(3000);
    // OPEN, not merely un-hidden. `#reader` may not be in the document at all,
    // and `querySelector('#reader')?.hidden` is `undefined` then — which reads
    // as "not hidden" and let a lap where nothing opened run on to record a
    // take that nothing was watching.
    const reader = document.querySelector('#reader');
    if (!reader || reader.hidden) return { failed: 'the piece did not open' };
    const dot = document.querySelector('#reader-record');
    if (!dot || dot.hidden) {
      const { takeState } = await import('/src/ui/take-control.js');
      return {
        failed: 'no record button on the music',
        why: `dot ${dot ? 'there' : 'missing'}, hidden ${dot?.hidden}, in `
          + `${dot?.parentElement?.id ?? dot?.parentElement?.className ?? '—'}, `
          + `state ${JSON.stringify(takeState())}`,
      };
    }
    dot.click();
    for (let i = 0; i < 200 && !dot.classList.contains('recording'); i += 1) await wait(100);
    if (!dot.classList.contains('recording')) {
      return {
        failed: 'the take never started',
        why: `${document.querySelector('#status')?.textContent ?? ''} / `
          + `${document.querySelector('#rec-note')?.textContent ?? ''} / `
          + `reader ${document.querySelector('#reader')?.hidden ? 'shut' : 'open'}`,
      };
    }
    const seconds = await window.__playNotes(notes.slice(0, 8), 0.4);
    await wait(seconds * 1000 + 600);
    dot.click();
    // Stopping closes the reader, runs the analysis and draws the review.
    await wait(6000);

    // THE SAVE BAR UNDER THE REVIEW, which is where the take is kept.
    const save = document.querySelector('#score-save-take');
    out.saveOffered = !!save && !save.closest('[hidden]') && !!save.textContent.trim();
    out.saveSays = save?.textContent?.trim() ?? null;
    if (!out.saveOffered) return { ...out, failed: 'the review offered no way to save the take' };
    save.click();
    await wait(500);

    // …AND IT ASKS WHAT TO CALL IT, with the piece already in the box.
    const dialog = document.querySelector('#rename-dialog');
    const input = document.querySelector('#rename-input');
    out.asked = !!dialog?.open;
    out.offeredName = input?.value ?? null;
    if (!out.asked) return { ...out, failed: 'saving never asked what to call the take' };
    if (rename) input.value = rename;
    dialog.querySelector('button[value="save"]').click();
    await wait(2500);
    out.said = document.querySelector('#score-saved')?.textContent ?? null;
    return out;
  }, { notes: midi, piece: PIECE, rename: name });
}

// What the library actually holds, and what it actually DRAWS — both, because
// the rows are the thing he is looking at and the store is the thing that is
// wrong if they disagree.
async function theLibrary() {
  return page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const nav = document.querySelector('nav[role="tablist"]');
    [...nav.querySelectorAll('button')].find((b) => /library/i.test(b.textContent ?? ''))?.click();
    await wait(1200);
    const { listRecordings, listFolders } = await import('/src/store/db.js');
    const takes = await listRecordings();
    const folders = await listFolders();
    return {
      takes: takes.map((t) => ({ id: t.id, name: t.name ?? null, folderId: t.folderId ?? null })),
      folders: folders.map((f) => ({ id: f.id, name: f.name })),
      rows: [...document.querySelectorAll('#library-list .lib-item')].map((li) => ({
        name: li.querySelector('.lib-name')?.textContent ?? '',
        sub: li.querySelector('.lib-sub')?.textContent ?? '',
        folder: !!li.querySelector('.lib-folder'),
      })),
    };
  });
}

const first = made.error ? { failed: 'no piece' } : await aTake(made.midi);
if (first.failed) {
  check('a take recorded from the music can be saved', false, `${first.failed} — ${first.why ?? ''}`);
} else {
  check('saving asks what to call the take, with the piece already in the box',
    first.offeredName === PIECE, `offered “${first.offeredName}”`);
  const lib = await theLibrary();
  const named = lib.rows.find((r) => r.name === PIECE && !r.folder);
  check('the first take is a row in the library, called what the piece is called',
    !!named, named ? `“${named.name}” · ${named.sub}` : `rows: ${lib.rows.map((r) => r.name).join(' | ') || 'none'}`);
  check('one take is a row and NOT a folder',
    lib.rows.filter((r) => r.folder).length === 0,
    `${lib.rows.filter((r) => r.folder).length} folders`);

  // A NEW SESSION FOR THE SECOND TAKE, which is also what a second take is:
  // the Score tab is showing the review of the first one, not the shelf, and
  // the piece is opened again the way it is opened on any other day.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await new Promise((r) => setTimeout(r, 1600));
  const second = await aTake(made.midi);
  if (second.failed) {
    check('a second take of the same piece can be saved', false, `${second.failed} — ${second.why ?? ''}`);
  } else {
    const after = await theLibrary();
    const folder = after.folders.find((f) => f.name === PIECE);
    const inside = after.takes.filter((t) => t.folderId != null && t.folderId === folder?.id);
    const loose = after.takes.filter((t) => t.name === PIECE && t.folderId == null);
    check('the second take turns that row into a folder of the piece',
      !!folder, folder ? `folder “${folder.name}”` : `folders: ${after.folders.map((f) => f.name).join(' | ') || 'none'}`);
    // BOTH OF THEM. A folder with the new take in it and the first one still
    // loose beside it is the same complaint in a different shape.
    check('and it holds both takes',
      inside.length === 2, `${inside.length} in the folder, ${loose.length} still loose`);
    const drawn = after.rows.find((r) => r.folder && r.name === PIECE);
    check('and that is what the library draws',
      !!drawn && /2 takes/.test(drawn.sub),
      drawn ? `“${drawn.name}” · ${drawn.sub}` : `rows: ${after.rows.map((r) => r.name).join(' | ') || 'none'}`);
    check('with neither take left as a loose row beside it',
      after.rows.filter((r) => !r.folder).length === 0,
      `${after.rows.filter((r) => !r.folder).length} loose rows`);
  }
}

if (errors.length) {
  console.log('\nerrors on the page:');
  for (const e of errors.slice(0, 5)) console.log(`  ${e}`);
}
const failed = results.filter((r) => !r.pass);
console.log(failed.length ? `\n${failed.length} FAILED` : '\nALL PASS');
await browser.close();
process.exit(failed.length ? 1 : 0);
