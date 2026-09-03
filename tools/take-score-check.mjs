// A TAKE PLAYED OFF THE MUSIC BELONGS TO THE MUSIC — from the save right
// through to opening it again a week later.
//
// Two things used to go wrong between those, and they are the same thing seen
// from either end:
//
//   THE SAVE. Filing a take under the piece was a SECOND decision, made with a
//   second button at the foot of the Score tab. "when I record on a score and
//   then I save it, it should just save to the library" — so pressing Save on
//   the Record tab kept the recording with no piece attached at all, and the
//   one thing the app knew for certain about it was thrown away.
//
//   THE REOPENING. That take then opened on the Record tab, which put up a
//   button reading "See it on the score →": an instruction, on the wrong
//   screen, to reach the thing you had just asked for. "it should automatically
//   show this score like it did after I finished recording it."
//
// AND THE HAZARD THE FIX WALKS PAST. A piece can be open from an hour ago, so
// "a score is loaded" is the wrong question — a run of scales recorded from the
// Record tab while the Bach is still on screen must NOT be filed under the
// Bach. What is asked instead is which door the take came through: the dot on
// the music, or the button on the Record tab. Both are driven here.
//
// NO MICROPHONE IS EVER OPENED — `getUserMedia` is replaced before the app
// loads, and the fake device plays real separated notes, because a take the
// segmenter finds nothing in is discarded and never reaches a save.
//
//   npm run dev            (on 5199)
//   npm run take:score
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
  // A LONG EVALUATE NEEDS A LONG PROTOCOL TIMEOUT, and puppeteer's default is
  // three minutes. This check records a real take through the fake microphone
  // and waits for the analysis inside one call: MEASURED, 36s end to end on a
  // quiet machine — and about five times that with the rest of the suite and a
  // second browser competing for the CPU, which is over the default and comes
  // back as `Runtime.callFunctionOn timed out`. A loaded machine then reads as
  // a broken app, which cost three false alarms in one sitting.
  //
  // It does not make anything faster; it stops the wait being mistaken for a
  // fault. `press-hear-check.mjs`, which records the same way, has had this
  // since it was written — these three were simply missed.
  protocolTimeout: 240000,
});
const page = await browser.newPage();
await page.setViewport({ width: 900, height: 1000, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

// The fake microphone, as `take:save` builds it: a cello-ish tone rather than a
// sine (YIN wants a harmonic series) and a fresh stream every time, because the
// app stops the tracks when a take ends and this records twice.
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
  await browser.close();
  process.exit(1);
}
await page.reload({ waitUntil: 'domcontentloaded' });
await new Promise((r) => setTimeout(r, 1600));
await page.evaluate((id) => { window.__fixtureScoreId = id; }, made.id);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// --- (1) recorded from the music, saved with the Record tab's own button -----
const fromTheMusic = await page.evaluate(async ({ notes, piece }) => {
  const hold = (ms) => new Promise((r) => setTimeout(r, ms));
  [...document.querySelectorAll('button')]
    .find((b) => /start playing/i.test(b.textContent ?? ''))?.click();
  await hold(400);
  const nav = document.querySelector('nav[role="tablist"]');
  const toTab = (name) => [...nav.querySelectorAll('button')]
    .find((b) => new RegExp(name, 'i').test(b.textContent ?? ''))?.click();
  toTab('score');
  await hold(1200);
  const row = [...document.querySelectorAll('#score-list .lib-open')]
    .find((b) => (b.textContent ?? '').includes(piece));
  if (!row) return { failed: 'the piece is not on the shelf' };
  row.click();
  await hold(3000);
  const reader = document.querySelector('#reader');
  if (!reader || reader.hidden) return { failed: 'the piece did not open' };
  const dot = document.querySelector('#reader-record');
  if (!dot || dot.hidden) return { failed: 'no record button on the music' };
  dot.click();
  for (let i = 0; i < 200 && !dot.classList.contains('recording'); i += 1) await hold(100);
  if (!dot.classList.contains('recording')) return { failed: 'the take never started' };
  const seconds = await window.__playNotes(notes.slice(0, 8), 0.4);
  await hold(seconds * 1000 + 600);
  dot.click();
  await hold(6000);

  // KEPT ON ITS OWN. There is no Save to press any more: a finished take is in
  // the library the moment it finishes, and the Record tab's bar offers only
  // Discard (Save comes back only if keeping it failed).
  toTab('record');
  await hold(900);
  const bar = document.querySelector('#save-bar');
  const discard = document.querySelector('#discard-rec');
  const save = document.querySelector('#save-rec');
  if (!bar || bar.hidden || !discard) return { failed: 'the Record tab offered no way to discard the take' };
  if (save && !save.hidden) return { failed: 'Save was offered for a take that should already be kept' };
  await hold(1500);
  const { listRecordings } = await import('/src/store/db.js');
  const takes = await listRecordings();
  // …AND WHAT THE PIECE'S OWN SHELF SHOWS AFTERWARDS. "not to the take you just
  // played in the score tab": that row is `pendingReviewRow`, and it exists so
  // a take with no row of its own is not stranded behind the review. Once the
  // take is kept the shelf has its real row, and both were being drawn.
  toTab('score');
  await hold(1500);
  const shelf = [...document.querySelectorAll('#score-list .lib-name')].map((n) => n.textContent);
  return {
    takes: takes.length,
    scoreIds: takes.map((t) => t.scoreId ?? null),
    shelf,
    said: document.querySelector('#status')?.textContent ?? '',
  };
}, { notes: made.midi, piece: PIECE });

if (fromTheMusic.failed) {
  check('a take recorded from the music', false, fromTheMusic.failed);
} else {
  check('a take recorded from the music is kept the moment it finishes',
    fromTheMusic.takes === 1, `${fromTheMusic.takes} in the library`);
  check('…and it carries the piece it was played from, with no second decision',
    fromTheMusic.scoreIds[0] === made.id,
    `scoreId ${fromTheMusic.scoreIds[0]} (the piece is ${made.id})`);
  check('…and the Score tab stops offering it as "the take you just played"',
    !fromTheMusic.shelf.some((row) => /the take you just played/i.test(row ?? '')),
    fromTheMusic.shelf.join(' | ') || 'the shelf is empty');
}

// --- (2) …and a take from the Record tab, with the piece still open ---------
const fromTheTab = await page.evaluate(async ({ notes }) => {
  const hold = (ms) => new Promise((r) => setTimeout(r, ms));
  const nav = document.querySelector('nav[role="tablist"]');
  [...nav.querySelectorAll('button')].find((b) => /record/i.test(b.textContent ?? ''))?.click();
  await hold(800);
  const start = document.querySelector('#start');
  if (!start) return { failed: 'no Record button' };
  // THE PIECE, OPENED ON PURPOSE. This read whatever happened to be left over
  // from the lap above, and what the hazard needs is a piece that IS open when
  // a take is recorded from the Record tab — leaving that to leftover state
  // makes the test say nothing on the day the leftover changes.
  const { selectScore, currentScoreId } = await import('/src/ui/score.js');
  await selectScore(window.__fixtureScoreId ?? null);
  const open = currentScoreId();
  start.click();
  for (let i = 0; i < 200 && start.textContent === 'Record'; i += 1) await hold(100);
  if (start.textContent === 'Record') return { failed: 'the take never started' };
  const seconds = await window.__playNotes(notes.slice(0, 6), 0.4);
  await hold(seconds * 1000 + 600);
  start.click();
  await hold(5000);
  const bar = document.querySelector('#save-bar');
  if (!bar || bar.hidden) return { failed: 'the bar with Discard on it did not appear' };
  await hold(1500);
  const { listRecordings } = await import('/src/store/db.js');
  const takes = await listRecordings();
  // …AND DISCARD TAKES IT BACK OUT. The take was kept on its own; the one
  // decision left is to undo that, and it has to reach the library.
  document.querySelector('#discard-rec')?.click();
  await hold(1500);
  const after = await listRecordings();
  return { openScore: open, takes: takes.length, scoreIds: takes.map((t) => t.scoreId ?? null),
    afterDiscard: after.length, barGone: document.querySelector('#save-bar')?.hidden };
}, { notes: [55, 57, 59, 60, 62, 64] });

if (fromTheTab.failed) {
  check('a second take, from the Record tab', false, fromTheTab.failed);
} else {
  check('a second take, recorded from the Record tab, is kept too',
    fromTheTab.takes === 2, `${fromTheTab.takes} in the library`);
  // The piece was still open — that is the point of the assertion.
  check('…and is NOT filed under the piece that happened to be open',
    fromTheTab.openScore !== null && fromTheTab.scoreIds.filter((id) => id === made.id).length === 1,
    `the ${PIECE} was open (${fromTheTab.openScore}); scoreIds now ${JSON.stringify(fromTheTab.scoreIds)}`);
  check('…and Discard takes it back out of the library',
    fromTheTab.afterDiscard === 1 && fromTheTab.barGone === true,
    `${fromTheTab.afterDiscard} left in the library, bar hidden=${fromTheTab.barGone}`);
}

// --- (3) opening the score-backed take again -------------------------------
const reopened = await page.evaluate(async ({ piece }) => {
  const hold = (ms) => new Promise((r) => setTimeout(r, ms));
  const nav = document.querySelector('nav[role="tablist"]');
  [...nav.querySelectorAll('button')].find((b) => /library/i.test(b.textContent ?? ''))?.click();
  await hold(1400);
  // The row for the take that carries the piece: the library says which piece
  // a take came from in its own line, so that is what is looked for.
  const rows = [...document.querySelectorAll('#library .lib-open, #lib-list .lib-open')];
  const wanted = rows.find((b) => (b.textContent ?? '').includes(piece));
  if (!wanted) {
    return { failed: 'no library row mentions the piece', why: rows.map((r) => r.textContent).join(' | ') };
  }
  wanted.click();
  await hold(4000);
  const active = document.querySelector('.tab-panel.active')?.id ?? null;
  const stage = document.querySelector('#score-stage');
  return {
    tab: active,
    pages: document.querySelectorAll('#score-stage .scan-page, #score-stage svg').length,
    stageHasMusic: !!stage && stage.children.length > 0,
    reviewShowing: document.querySelector('#playback')?.hidden === false,
    // ON THE SCREEN, not in the document. The button still exists — it is the
    // Record tab's way through for somebody who is standing there — and what
    // was asked for is not to be SENT to the score but taken to it. So what is
    // checked is whether a player looking at this take is being offered an
    // instruction: `offsetParent` is null for anything inside a hidden card or
    // an inactive tab panel.
    seeItOnTheScore: [...document.querySelectorAll('button')]
      .filter((b) => /see it on the score/i.test(b.textContent ?? ''))
      .some((b) => b.offsetParent !== null),
    // The take's own view inside the library, and whether the review and the
    // page were actually borrowed into it rather than merely left elsewhere.
    takeView: document.querySelector('#library-take')?.hidden === false,
    listHidden: document.querySelector('#library')?.hidden === true,
    reportInLibrary: !!document.querySelector('#library-take-report #report'),
    stageInLibrary: !!document.querySelector('#library-take-stage #score-stage'),
    // THE NODE BEING THERE IS NOT THE MUSIC BEING THERE, and the difference was
    // a real bug that this check passed straight over: the stage was borrowed
    // into the library and left EMPTY, because the engraving is deferred until
    // the Score tab is shown and opening a take here never shows it. "now when
    // i open a recording from the score it doesnt show it."
    musicInLibrary: (document.querySelector('#library-take-stage #score-stage')
      ?.childElementCount ?? 0) > 0,
    backThere: !!document.querySelector('#library-take-back')?.offsetParent,
    scoreToggle: (document.querySelector('#library-take-score')?.offsetParent
      ? document.querySelector('#library-take-score')?.textContent?.trim() : null) ?? null,
  };
}, { piece: PIECE });

if (reopened.failed) {
  check('the take opens again from the library', false, `${reopened.failed}: ${reopened.why ?? ''}`);
} else {
  // A TAKE OPENS WHERE IT WAS FOUND, and this assertion has now been reversed
  // TWICE — first from the Score tab to the Record tab, and now to the library
  // itself. Both times on instruction, and this one is the one that stops the
  // tab switching being visible at all: "it shouldnt open in the scores tab,
  // should just be in the library tab and then you can click back or click on
  // the tab at the bottom to bring you back to the library."
  //
  // What stood in the way was an implementation detail — `#report` lives in the
  // Record tab and there is only one of it — and the answer is the one
  // `#score-dock` has used all along: the review and the page are BORROWED into
  // the library's take view and handed back on the way out. So the assertions
  // are about where those nodes actually ARE, not merely about which panel is
  // lit: a tab that is showing with the review still somewhere else is the
  // failure this is written to catch.
  check('opening it again stays in the library', reopened.tab === 'tab-library',
    `landed on ${reopened.tab}`);
  check('…with the review borrowed into it, and the list out of the way',
    reopened.reportInLibrary && reopened.takeView && reopened.listHidden,
    `report in the take view=${reopened.reportInLibrary},`
    + ` view showing=${reopened.takeView}, list hidden=${reopened.listHidden}`);
  check('…and the music with it, rather than a button pointing at another tab',
    reopened.stageInLibrary && reopened.musicInLibrary && reopened.seeItOnTheScore === false,
    `stage in the take view=${reopened.stageInLibrary},`
    + ` with music on it=${reopened.musicInLibrary},`
    + ` "see it on the score" offered=${reopened.seeItOnTheScore}`);
  check('…and a way back to the list, and a way to put the page away',
    reopened.backThere && /score/i.test(reopened.scoreToggle ?? ''),
    `back=${reopened.backThere}, toggle="${reopened.scoreToggle}"`);
  check('…with the review up under it',
    reopened.reviewShowing === true,
    `#playback showing=${reopened.reviewShowing}`);

}

// --- (4) …and the analysis on the score is the whole analysis --------------
//
// "when I click Held at least and it's a certain amount of seconds, it shows
// the boxes with those notes underneath like it does when it's just on the
// record tab", and "it also shows the mark passage landing thing". The picker
// was on this screen and the buttons it builds were not: `#held-list`,
// `#passages` and `#landing` stayed behind on the Record tab, so choosing a
// duration here filtered the graph and produced nothing to press.
const analysis = await page.evaluate(async () => {
  const hold = (ms) => new Promise((r) => setTimeout(r, ms));
  const seen = (node) => !!node && node.offsetParent !== null;
  const dock = document.querySelector('#score-dock');
  // TYPED, at a threshold this fixture can meet. The ladder's lowest rung is
  // 0.5s and the fake instrument plays each note for about three tenths, so
  // every preset would correctly answer "0 of 13" and prove nothing about the
  // list. The field and the ladder are one value — see wireHeldFilter — so
  // this drives the same filter the rungs do.
  const field = document.querySelector('#held-least');
  const before = document.querySelectorAll('#held-list button').length;
  if (field) {
    field.value = '0.15';
    field.dispatchEvent(new Event('input', { bubbles: true }));
  }
  await hold(700);
  return {
    pickerOnScreen: seen(document.querySelector('#held-least-line')),
    passagesOnScreen: seen(document.querySelector('#mark-passage')),
    landingOnScreen: seen(document.querySelector('#landing')),
    inTheDock: ['held-list', 'passages', 'landing']
      .filter((id) => dock?.contains(document.querySelector(`#${id}`))),
    before,
    after: document.querySelectorAll('#held-list button').length,
    listOnScreen: seen(document.querySelector('#held-list')),
    said: document.querySelector('#notes-summary')?.textContent ?? '',
  };
});

check('the held-for picker, the passages and the landing are all on this screen',
  analysis.pickerOnScreen && analysis.passagesOnScreen && analysis.landingOnScreen,
  `picker=${analysis.pickerOnScreen} passages=${analysis.passagesOnScreen}`
  + ` landing=${analysis.landingOnScreen}`);
// WHICH TAB HOLDS THEM depends on which one you are standing on, and a take now
// opens on the Record tab — where these three live in the first place. The
// borrow is the SCORE tab's, and `score:review` is where it is held down: it
// checks the dock takes all seven panels and hands them back in their own
// order. What matters here is that the picker, the passages and the landing are
// on the screen with the take, which the assertion above measures.
check('…and they are the Record tab’s own, not a copy',
  analysis.inTheDock.length === 0 || analysis.inTheDock.length === 3,
  analysis.inTheDock.length ? `in the score dock: ${analysis.inTheDock.join(', ')}`
    : 'on the Record tab, where they live');
check('choosing a duration here puts up the notes that qualified',
  analysis.after > 0 && analysis.listOnScreen,
  `${analysis.before} buttons before, ${analysis.after} after — “${analysis.said}”`);

// AND THE SCORE TAB IS NOT DRAGGED ALONG WITH IT.
//
// Opening a take here borrows the page into the library AND selects that
// take's piece, because that is how its marks get onto the music — two
// changes to a tab the player was not asking about. Pressing Score afterwards
// showed the take that had been opened somewhere else, with its page pulled
// out of the library view mid-look: "it shouldnt show the take on there and
// drag it from the library tab.. just the menu of scores or watever i last
// ahd on that tab."
const overThere = await page.evaluate(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  document.querySelector('.tab-btn[data-tab="score"]')?.click();
  await wait(1200);
  const stage = document.querySelector('#score-stage');
  return {
    tab: document.querySelector('.tab-panel.active')?.id ?? null,
    // The shelf, not a review of somebody else's take.
    reviewShowing: document.querySelector('#score-review')?.hidden === false,
    shelfShowing: document.querySelector('#score-browser')?.offsetParent !== null,
    // The borrowed nodes are home, and the library has let go of them.
    reportHome: !document.querySelector('#library-take-report #report'),
    stageHome: !document.querySelector('#library-take-stage #score-stage'),
    // …and nothing of the take is left painted on the page it borrowed.
    stageEmpty: (stage?.childElementCount ?? 0) === 0,
    takeViewShut: document.querySelector('#library-take')?.hidden !== false,
  };
});
check('pressing Score afterwards lands on the Score tab', overThere.tab === 'tab-score',
  `landed on ${overThere.tab}`);
check('…and it shows its own shelf, not the take opened in the library',
  overThere.shelfShowing && !overThere.reviewShowing && overThere.stageEmpty,
  `shelf=${overThere.shelfShowing}, a review is up=${overThere.reviewShowing},`
  + ` stage empty=${overThere.stageEmpty}`);
check('…and the borrowed page and review went home rather than being dragged there',
  overThere.reportHome && overThere.stageHome && overThere.takeViewShut,
  `report home=${overThere.reportHome}, stage home=${overThere.stageHome},`
  + ` the take view shut=${overThere.takeViewShut}`);

check('nothing was thrown', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(failed.length ? `\n${failed.length} FAILED` : '\nALL PASS');
process.exit(failed.length ? 1 : 0);
