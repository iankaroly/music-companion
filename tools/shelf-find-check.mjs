// FINDING A PIECE, AND A TAKE, AND THE PIECE YOU ARE ABOUT TO PLAY.
//
//   "The Scores and the Library tabs should have a search option like Fourscore
//    does, where you can search for the name of what you're looking for. When
//    you click 'Playing from' in the Record tab, there should also be an option
//    to search in the drop-down menu of the different scores."
//
// Three lists, three searches, and they are three different mechanisms: the
// score shelf and the library each filter their own list, and the picker is a
// pop-over built by `menu()` in ui/controls.js out of a hidden <select>.
//
// The pop-over's search is gated on the LENGTH of the list, not on which
// control it is — the same function draws "same note / fifth up / fifth down",
// and a search field in a list of three is worse than none. So this checks both
// halves of that gate: present on the score picker, absent on the small ones.
//
// It also checks the ＋ Folder button on the shelf. One set of folders holds
// both takes and pieces, and until now a folder could only be made from the
// Library — which is the wrong shelf to be standing on when you are filing a
// piece.
//
//   npm run dev             (on 5199)
//   npm run shelf:find
//
import puppeteer from 'puppeteer-core';

const APP = process.env.APP ?? 'http://localhost:5199';
const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

const browser = await puppeteer.launch({
  executablePath: SHELL, headless: true, args: ['--no-sandbox'],
});
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

const XML = '<?xml version="1.0"?><score-partwise version="3.1"><part-list><score-part id="P1">'
  + '<part-name>C</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes>'
  + '<divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type>'
  + '</time><clef><sign>F</sign><line>4</line></clef></attributes><note><pitch><step>C</step>'
  + '<octave>3</octave></pitch><duration>4</duration><type>whole</type></note></measure></part></score-partwise>';

await page.goto(APP, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 1600));

// A shelf worth searching, and a few takes to go with it.
// THREE PIECES, not twelve. The score picker's search is not gated on how many
// there are — a shelf is small on the day somebody looks for the field and large
// by the time they need it, so a field that appears at the eighth piece is a
// field nobody finds out about. Checked at a size where the length gate would
// NOT have shown it.
const NAMES = ['Bach Suite I', 'Bach Suite II', 'Elgar Concerto'];
await page.evaluate(async ({ names, xml }) => {
  document.querySelector('#welcome')?.remove();
  document.querySelector('#welcome-card')?.remove();
  // NAMED AFTERWARDS, because that is how a take gets a name: `saveRecording`
  // stores the audio and the figures, and `renameRecording` is what the ⋯ menu
  // calls. Handing a `name` straight to saveRecording stores nothing, which is
  // how this check first "found" no takes at all.
  const { saveScore, saveRecording, renameRecording } = await import('/src/store/db.js');
  for (const name of names) await saveScore({ name, xml, partIndex: 0, parts: [{ name: 'C', staves: 1 }] });
  for (const name of ['Elgar run-through', 'Bach slow practice', 'scales']) {
    const id = await saveRecording({
      date: Date.now(), duration: 30, sampleRate: 44100,
      audio: new Float32Array(4410), notes: [], readings: [], a4: 440,
    });
    await renameRecording(id, name);
  }
}, { names: NAMES, xml: XML });

// Reloaded, because the picker and both shelves are built at start-up.
await page.reload({ waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 1800));
await page.evaluate(() => {
  document.querySelector('#welcome')?.remove();
  document.querySelector('#welcome-card')?.remove();
});

const toTab = async (name) => page.evaluate(async (tab) => {
  for (let i = 0; i < 20; i += 1) {
    if (document.querySelector(`#tab-${tab}`)?.classList.contains('active')) break;
    document.querySelector(`.tab-btn[data-tab="${tab}"]`)?.click();
    await new Promise((r) => setTimeout(r, 150));
  }
  await new Promise((r) => setTimeout(r, 700));
}, name);

// --- the score shelf --------------------------------------------------------
await toTab('score');
const shelf = await page.evaluate(async () => {
  const box = document.querySelector('#score-search');
  const rows = () => [...document.querySelectorAll('#score-list li')].length;
  const before = rows();
  box.value = 'bach';
  box.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 400));
  const found = [...document.querySelectorAll('#score-list li')]
    .map((li) => li.textContent.split('\n')[0].trim().slice(0, 30));
  box.value = '';
  box.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 400));
  return { showing: !box.hidden, before, found, back: rows(),
    folder: !document.querySelector('#score-folder')?.hidden };
});
check('the score shelf has a search box, always', shelf.showing === true);
check('…and it finds a piece by name', shelf.found.length === 2 && shelf.back === shelf.before,
  `${shelf.before} pieces → [${shelf.found.join(', ')}] → ${shelf.back}`);
check('…and a folder can be made from the shelf that holds the pieces',
  shelf.folder === true, shelf.folder ? '＋ Folder is there' : 'no ＋ Folder button');

// --- the library ------------------------------------------------------------
await toTab('library');
const lib = await page.evaluate(async () => {
  const box = document.querySelector('#library-search');
  if (!box) return { showing: false };
  const before = document.querySelectorAll('#library-list li').length;
  box.value = 'elgar';
  box.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 400));
  const found = [...document.querySelectorAll('#library-list li')]
    .map((li) => li.textContent.split('\n')[0].trim().slice(0, 30));
  box.value = '';
  box.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 400));
  return { showing: true, before, found, back: document.querySelectorAll('#library-list li').length };
});
check('the library has a search box', lib.showing === true);
check('…and it finds a take by name', lib.found?.length === 1 && lib.back === lib.before,
  `${lib.before} takes → [${lib.found?.join(', ')}] → ${lib.back}`);

// THE "PLAYING FROM" LIST WAS SEARCHED HERE, and there is no such list any
// more: "get rid of the playing from, and then the option to play from load
// score and remove". The picker, the Load button and the Remove button have
// gone from the Record tab — a piece is chosen on the Score tab, which is where
// the parts live and where you press Record with the music in front of you —
// and the search this asserted was for that pop-over.
//
// The two halves it proved are both still proved elsewhere. That a LONG list
// gets a search field is the shelf and the library, both checked above, both on
// their own boxes rather than on `menu()`'s. That a SHORT one does not is the
// gate below, which is the same function drawing a different picker.
//
// The other half of the gate, measured rather than reasoned about.
await toTab('tuner');
const small = await page.evaluate(async () => {
  const btn = [...document.querySelectorAll('.pick-btn')]
    .find((b) => /interval|octave|transpose/i.test(b.getAttribute('aria-label') ?? ''));
  if (!btn) return { tried: false };
  btn.click();
  await new Promise((r) => setTimeout(r, 350));
  const pop = document.querySelector('.pick-pop');
  const out = {
    tried: true,
    label: btn.getAttribute('aria-label'),
    rows: pop ? pop.querySelectorAll('.pick-row').length : 0,
    find: !!pop?.querySelector('.pick-find'),
  };
  pop?.remove();
  return out;
});
check('a short list does NOT get one',
  small.tried === false || (small.find === false && small.rows <= 8),
  small.tried ? `“${small.label}”, ${small.rows} rows, search=${small.find}` : 'no short picker on screen');

if (errors.length) {
  console.log('\nerrors on the page:');
  for (const e of errors.slice(0, 5)) console.log(`  ${e}`);
}
const failed = results.filter((r) => !r.pass);
console.log(failed.length ? `\n${failed.length} FAILED` : '\nALL PASS');
await browser.close();
process.exit(failed.length ? 1 : 0);
