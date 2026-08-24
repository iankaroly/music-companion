// The score tab of the analyze screen: pick the piece, play it, see it marked.
//
// Nothing happens while you record. On Stop the take is lined up against the
// score and the page comes back coloured — which was a deliberate choice over
// a cursor that follows you as you play. A follower has to commit to a position
// with no view of what comes next, so the moment you stop to fix a bar it bolts
// ahead and every mark after that lands on the wrong note. Aligning afterwards
// can see the whole take before it decides anything, which is why a false start
// or a skipped repeat comes out right.

import { parseScore } from '../analysis/musicxml.js';
import { saying, why } from './why.js';
import { readScoreFile } from '../analysis/mxl.js';
import { alignScore } from '../analysis/align-score.js';
import { scoreTiming } from '../analysis/score-timing.js';
import { noteLanding } from '../analysis/landing.js';
import { rhythmReport } from '../analysis/rhythm.js';
import { scanRhythm } from '../analysis/scan-rhythm.js';
// Imported rather than rewritten here: the evenness of a list of bar lengths is
// scan-timing.js's own arithmetic and a second copy of it in the UI is how two
// numbers that should be the same come to disagree.
import { spread } from '../analysis/scan-timing.js';
import { showScore, paint } from './score-view.js';
import { showScanScore } from './scan-view.js';
import { openReader, standAside as readerStandAside } from './reader.js';
import { intonationBounds } from './chart-utils.js';
import { takeStats } from '../analysis/score-history.js';
import {
  mountScore, follow, stopFollowing, clearScoreTab, showReviewCard, showBrowser,
  syncDockVisibility, borrowPanel, scoreTabIsShowing, initScoreFullScreen,
} from './score-tab.js';
import {
  saveScore, savePagesScore, listScores, loadScore, deleteScore, setRecordingScore,
  pairScoreNotation, loadScorePages, saveScoreLayout, markAsRead, wasReadFromPages,
} from '../store/db.js';
import {
  isPdf, isImage, sniffPdf, sniffImage, nameFromFile, pdfPageCount, readPages, pdfTrouble,
} from './paper.js';
import { openScanner } from './scanner.js';

// The long edge under which a photographed page starts losing its beams — see
// the note in readNotesFromPipeline for where the number comes from.
const SHARP_ENOUGH = 2000;

let current = null;   // { id, name, xml, partIndex, notes }
let view = null;      // the rendered page, if one is up
let onPick = null;    // hand a chosen note back to the report
// The bar layer over the scanned pages: tap one, hear that moment. Kept so it
// can be taken down when the pages under it are replaced.
let barSync = null;

// The take on screen, so choosing a score AFTER recording still marks it up.
// Recording first and picking the piece second is the order this actually gets
// used in.
let pending = null;   // { notes, readings, a4 }
// The finished analysis, waiting for the Score tab to be looked at. The page
// is NOT engraved here: an inactive tab panel is display:none, so a container
// inside one measures zero and the engraver would lay the music out to a width
// that does not exist. It is drawn the first time the tab is shown.
let ready = null;     // { aligned, timing, landings, summary }
let openTab = null;   // ask main.js to switch tabs
let scoreChanged = null; // tell the app the chosen piece changed
// The tempo you are TRYING to hold, or null for "read the one I played".
let targetBpm = Number(localStorage.getItem('scoreTargetBpm')) || null;

// Not the empty string: controls.js reads an empty value as a placeholder and
// leaves that row out of the pop-over, which would make "no score" the one
// choice a player could never get back to.
const NO_SCORE = 'none';

function el(id) { return document.querySelector(`#${id}`); }

function status(message, tone = '') {
  // Said twice, in the two places a player can be standing when a score is
  // loaded. #score-hint is in the Record tab's card; #score-tab-hint sits in
  // the Score tab outside both of its cards, so it is readable whether or not
  // a piece is open. Without the second one, a file refused from the Score
  // tab's own Load button was explained to an element on another screen —
  // which looked exactly like nothing happening.
  for (const id of ['score-hint', 'score-tab-hint']) {
    const hint = el(id);
    if (!hint) continue;
    hint.textContent = message;
    hint.dataset.tone = tone;
  }
  // And once more into the app's aria-live region, for a screen reader.
  const line = document.querySelector('#status');
  if (line) line.textContent = message;
}

// The one line of feedback the Score tab has, for jobs that live elsewhere in
// the app but happen to the scores on this shelf.
export function scoreStatus(message, tone = '') {
  status(message, tone);
}

export function currentScoreId() {
  return current?.id ?? null;
}

// The piece currently chosen, for anything that wants to say its name.
export function scoreName() {
  return current?.name ?? null;
}

// Is there a take read against this piece, sitting behind the shelf? The Score
// tab shows one thing at a time, so leaving the review by its ← would otherwise
// strand the take: it is not saved yet, so no row in the shelf leads back to
// it, and with it goes the button that would have saved it.
export function reviewIsWaiting() {
  return !!ready && !!current;
}

export function showTakeReview() {
  if (reviewIsWaiting()) showReviewCard(true);
}

async function refreshPicker(selectedId = null) {
  const pick = el('score-pick');
  if (!pick) return;
  // Everything, scans included. A scan on its own cannot be lined up with a
  // take — nothing in a photograph says which note is which — but leaving it
  // out of the list makes the app look broken to somebody who has just scanned
  // a part and wants to play it. It is offered, and choosing it says plainly
  // what is missing and offers to fix it.
  const scores = await listScores();
  pick.replaceChildren();
  const none = document.createElement('option');
  none.value = NO_SCORE;
  none.textContent = 'no score';
  pick.append(none);
  for (const score of scores) {
    const option = document.createElement('option');
    option.value = String(score.id);
    option.textContent = score.name;
    pick.append(option);
  }
  pick.value = selectedId === null ? NO_SCORE : String(selectedId);
  // The custom pop-over menus mirror the native select; this is how the rest
  // of the app tells them their options changed without firing 'change'.
  pick.dispatchEvent(new CustomEvent('refresh-label'));
  el('score-remove').hidden = !selectedId;
}

// Parse once when the score is chosen, not once per take.
async function adopt(row) {
  // Settled first, because it changes how the score is READ as well as how a
  // take is lined up against it: on a score a recogniser read off a page, a bar
  // that came up short is a missed note rather than a cadenza, and letting it
  // shorten the clock moves every bar after it. See `steadyBars`.
  const fromPages = await wasReadFromPages(row).catch(() => false);
  const parsed = parseScore(row.xml, { partIndex: row.partIndex ?? 0, steadyBars: fromPages });
  const part = parsed.parts[row.partIndex ?? 0];
  if (part?.staves > 1) {
    throw new Error(`"${part.name}" is written on ${part.staves} staves — this reads one line at a time`);
  }
  if (parsed.notes.length === 0) throw new Error('that part has no notes in it');
  current = { ...row, notes: parsed.notes, parsed, readFromPages: fromPages };
  return current;
}

// A scan that was chosen for recording but has no notation behind it yet.
let unpaired = null;

async function chooseScore(id) {
  resetSheet();
  unpaired = null;
  el('score-pair').hidden = true;
  if (!id) {
    current = null;
    el('score-remove').hidden = true;
    showReviewCard(false);
    scoreChanged?.();
    status('MusicXML or .mxl — export one from MuseScore, or download it from IMSLP. Your playing is marked onto it when you stop.');
    return;
  }
  const row = await loadScore(id);
  if (!row) return;
  try {
    if (row.kind === 'pages') {
      // The piece is the scan — it keeps its name, its id and its takes — but
      // the notes come from the notation paired with it.
      const notation = row.notationId != null ? await loadScore(row.notationId) : null;
      if (!notation?.xml) {
        // A scan with no notation behind it is not a dead end. The page IS
        // read — staves, bars and where every notehead sits — which is what
        // marks a take onto the photograph. What is not read is what those
        // noteheads SAY: that needs clefs, key signatures and accidentals off
        // the paper, and none of that is attempted here. (The older note in
        // this spot said optical music recognition "does not run in a browser".
        // Half of it does now, in analysis/scan-read.js; it is the pitch half
        // that is missing, which is a different and more honest sentence.)
        //
        // So the take gets everything the SOUND can support — see
        // analyseScanTake — and only "you played the wrong note" is absent,
        // with the offer to add notation and get that too on the card.
        current = { ...row, paper: row, notes: [], plain: true };
        unpaired = row;
        showReviewCard(false);
        el('score-pair').hidden = false;
        el('score-remove').hidden = false;
        scoreChanged?.();
        status(`${row.name} — record, then tap a bar to hear that moment of it.`
          + ' Add its MusicXML too if you want wrong notes caught.');
        return;
      }
      await adopt({ ...notation, id: row.id, name: row.name, paper: row });
    } else {
      await adopt(row);
    }
    el('score-remove').hidden = false;
    showReviewCard(true);
    scoreChanged?.();
    status(`${current.name} — ${current.notes.length} notes. Record, and it will be marked up when you stop.`);
    // A take already on screen gets marked up straight away, so recording
    // first and choosing the piece afterwards works the same as the other way
    // round.
    if (pending) {
      const take = pending;
      await annotateTake(take.notes, take);
      // Picking a score for a take that is already in the library attaches it,
      // so reopening that take tomorrow finds the same piece.
      if (take.recordingId != null) await setRecordingScore(take.recordingId, id);
    }
  } catch (err) {
    current = null;
    status(err.message, 'bad');
  }
}

// Paper in: a PDF, or one photograph per page. Nothing is parsed and nothing
// can be — this is a picture of music, and the app is honest about that: it can
// be read from, paged through and drawn on, and it is never offered as
// something to record against.
// Exported so the import can be measured from outside — see
// tools/scan-once-check.mjs, which is what keeps a scanned page from being
// straightened a second time.
export async function addPaper(files, { name: given = null, raws = null, straightened = false } = {}) {
  const list = [...files];
  if (list.length === 0) return null;
  status(`reading ${list.length === 1 ? list[0].name : `${list.length} pages`}…`);
  let id = null;
  let trouble = null;   // pages that could not be read, said out loud at the end
  // What the file SAYS it is comes second to what is inside it. A part that has
  // been exported out of another app and handed over by iOS arrives often
  // enough with an empty type and no extension, and being refused as "not pages
  // of music" is not a thing anybody can act on.
  if (isPdf(list[0]) || await sniffPdf(list[0])) {
    const data = await list[0].arrayBuffer();
    let opened;
    try {
      opened = await pdfPageCount(data, { askPassword: askPdfPassword });
    } catch (err) {
      // Named, so "there was a problem" becomes something to do about it.
      throw new Error(pdfTrouble(err));
    }
    id = await savePagesScore({
      name: given ?? nameFromFile(list[0]),
      source: 'pdf',
      pageCount: opened.count,
      data,
      // Kept beside the part, so a locked PDF is unlocked once rather than
      // every time it is opened. It never leaves this device — nothing here
      // does — and it is the difference between a part you can play from and a
      // file you have to unlock in another app first.
      password: opened.password,
    });
  } else {
    // Photographs come back in whatever order the picker felt like; by name is
    // the only order that means anything, and phones name them in sequence.
    // Same again for pictures: a photograph handed over with no type and no
    // extension is still a photograph, and the first bytes say so.
    const named = list.filter(isImage);
    const anonymous = await Promise.all(list
      .filter((file) => !isImage(file))
      .map(async (file) => ((await sniffImage(file)) ? file : null)));
    const pages = [...named, ...anonymous.filter(Boolean)]
      .sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { numeric: true }));
    if (pages.length === 0) throw new Error('those were not pages of music');
    // Every photograph becomes a page before it is stored: the sheet of paper
    // found in it, pulled square, with the lighting taken off. A picture of a
    // book on a table is not a page of music, and the whole app downstream —
    // the reader, the crop, the page reader — is measuring the paper.
    const { straightenFile, readableImage, unreadableReason } = await import('./straighten.js');
    const flattened = [];
    // The photograph behind each page and the corners in it are built in THIS
    // loop rather than passed straight through, because a page that cannot be
    // decoded is dropped from `flattened` and the other two arrays have to drop
    // it too. They did not: `pages` came out short, `raws` came out full length,
    // and every page after the refused one was paired with the photograph of
    // its neighbour. Latent while the photographs were only there for "change
    // the edges later"; not latent now that they decide WHICH PICTURE the
    // recogniser is sent for which page.
    const keptRaws = [];
    // A page that cannot be decoded is refused HERE, before anything is
    // written, and named while the player still knows which one it was. It used
    // to be stored anyway and the score simply would not open afterwards.
    const refused = [];
    for (const [at, file] of pages.entries()) {
      try {
        // STRAIGHTENED ONCE, NEVER TWICE.
        //
        // The scanner squares its own pages — it has the corners the player
        // adjusted, which is better information than anything that can be
        // recovered afterwards — and this used to square them again on the way
        // in. A second pass over a page that is already nothing but paper finds
        // "paper" inside the printed area and crops to THAT, divides the
        // lighting out of an image the lighting has already been divided out
        // of, and re-encodes a JPEG that was encoded a moment ago.
        //
        // MEASURED on a photographed page, first pass then second:
        //   2000x2339 -> 2000x1784   a portrait page came out landscape
        //   pure white 37% -> 50%    half the page burnt out
        // which is exactly "it zooms in, the quality goes, the lighting goes
        // strange". One pass. The scanner's, when the scanner took it.
        if (straightened) {
          if (!await readableImage(file)) throw new Error(unreadableReason(file));
          flattened.push(file);
        } else {
          status(`straightening ${pages.length === 1 ? 'the page' : `page ${at + 1} of ${pages.length}`}…`);
          flattened.push(await straightenFile(file));
        }
        keptRaws.push((raws ?? pages)[at] ?? null);
      } catch (err) {
        refused.push(`page ${at + 1}: ${why(err, 'it could not be read')}`);
      }
    }
    if (flattened.length === 0) throw new Error(refused[0] ?? 'those pages could not be read');
    id = await savePagesScore({
      name: given ?? nameFromFile(pages[0]), source: 'photos', pageCount: flattened.length,
      pages: flattened,
      // The photographs as taken, so the edges can be changed later. From the
      // scanner these are the frames it kept; from the picker they are the
      // files themselves, which is the same thing. One per page KEPT, in step
      // with `pages` — see keptRaws above.
      raws: keptRaws,
    });
    // Some pages in, some refused: the part is still worth having, and the ones
    // that did not make it have to be said out loud rather than quietly missing.
    if (refused.length) {
      trouble = `${refused.length} of ${pages.length} pages could not be read — ${refused[0]}`;
    }
  }
  scoreChanged?.();
  // The Record tab's picker is built from the list of scores; a scan that has
  // just been taken has to appear in it without a reload, or "record against the
  // thing I just scanned" needs the app restarted first.
  await refreshPicker(currentScoreId());
  const row = await loadScore(id);
  if (trouble) status(trouble, 'bad');
  else status(`${row.name} — ${row.pageCount} ${row.pageCount === 1 ? 'page' : 'pages'}. Open it to read.`);
  // …and it is the piece you are about to play. Somebody who has just
  // photographed a page did it to play from that page, and without this the
  // take they record against it is marked onto whatever was chosen before —
  // which is nothing, most of the time. Same reason as the library door above.
  await selectScore(id);
  await readPaperScore(row);
  // And then, quietly, read the SHAPE of the pages — where the staves, bars and
  // noteheads are. It is what lets a take be marked onto a photograph, it takes
  // about a second a page, and nothing waits for it.
  // …and it STANDS ASIDE while the player is using the reader, which it did not
  // before. The pass is about a second a page of uninterruptible arithmetic; a
  // scan is opened the moment it is taken; and the two were competing for the
  // one processor on the device this runs on. A page turn must never wait on
  // the reading, so the reading waits on the page turns.
  measurePages(id, { note: trouble, standAside: readerStandAside })
    .catch(() => { /* an unreadable scan is still a readable score */ });
  // NOTHING IS SENT ANYWHERE. A scan used to go to a recogniser the moment it
  // was imported, to be told what its noteheads SAY. That route is gone — see
  // the note on `offerPipeline` below — and what replaces it needs no service
  // and no notation: the bars on the page, and the moment each was played.
  return id;
}


/**
 * THE RECOGNISER IS GONE, and this is what stood in its place.
 *
 * A scan used to be sent to an optical music recognition service, which handed
 * back MusicXML, which was paired to the pages so the app could say what each
 * notehead was called. It is removed rather than left switched off, because
 * what it produced on a photographed page was not usable and leaving it there
 * would offer it again.
 *
 * MEASURED, `npm run omr:truth` before it went: on a clean engraving handed
 * straight to the engine, 86.6% of the notes came back in the order printed; on
 * a photograph of ordinary music, 85.6%; on a photographed page of semiquaver
 * runs — which is what a cadenza is — 78.4%, with a fifth of the bars holding
 * the wrong number of beats. On a real Bärenreiter page of BWV 1007 the opening
 * came back `E4 B4 G5 F5` where the paper says `G2 D3 B3 A3`: the same music, a
 * thirteenth out, because one symbol at the top of the system was read as a
 * treble clef.
 *
 * What replaces it asks a smaller question and answers it: a bar is a rectangle
 * on the page, a moment is a second of the recording, and the two are joined by
 * shape — see analysis/bar-map.js, analysis/scan-align.js and
 * analysis/practice-runs.js. No note is ever named, so no clef can be misread,
 * and nothing leaves the device.
 */


// Reading the geometry of a scan, in the background, and remembering it.
//
// One pass per score at a time, and the second caller gets the first one's
// promise rather than a second scan. Two things ask for this now — importing a
// part, and opening one that was never finished — and at an import they ask
// within a moment of each other, which without this is the whole part rendered
// twice at once: double the work, double the memory, on the one device where
// both are scarce, and two writers racing over the same rows.
const running = new Map();

// The staff space, in pixels at the width the reader works at, under which a
// scan starts losing notes badly. Read off `npm run scan:import`: 6 px is 51%
// of the noteheads and 10 px is 86%, so the line sits between them and errs
// toward saying nothing.
const SPACE_ENOUGH = 8;

export async function measurePages(scoreId, { note = null, standAside = null } = {}) {
  const already = running.get(scoreId);
  if (already) return already;
  const pass = measureNow(scoreId, note, standAside).finally(() => running.delete(scoreId));
  running.set(scoreId, pass);
  return pass;
}

// WHO IS LOOKING AT A SCORE WHILE IT IS BEING READ.
//
// Reading a scan takes seconds and it happens behind whatever is on screen, so
// a page opened straight after scanning is opened before anything is known
// about it — and the two views that draw a scan both say so out loud ("these
// pages have not been read yet"). Nothing then told them when it WAS read, so
// the sentence stayed until the score was closed and opened again, which is
// exactly what a user reported: "when I scan something, I'll look at the page
// for a moment and then it says page not read so I have to reopen the score."
//
// One subscription, fired per page as the reading pass finishes it. A view that
// is showing that score refreshes itself; one that is not ignores it.
const layoutWatchers = new Set();

export function onLayoutRead(fn) {
  layoutWatchers.add(fn);
  return () => layoutWatchers.delete(fn);
}

function layoutRead(scoreId, layout) {
  for (const fn of layoutWatchers) {
    try { fn(scoreId, layout); } catch { /* a view that throws must not stop the reading */ }
  }
}

async function measureNow(scoreId, note, standAside = null) {
  const payload = await loadScorePages(scoreId);
  if (!payload) return null;
  const { layout, crops, sizes } = await readPages(payload, (page, total) => {
    status(`reading the pages… ${page + 1} of ${total}`);
  }, (sofar) => {
    saveScoreLayout(scoreId, sofar.layout, sofar);
    layoutRead(scoreId, sofar.layout);
  }, standAside);
  await saveScoreLayout(scoreId, layout, { crops, sizes });
  layoutRead(scoreId, layout);
  const found = layout.filter(Boolean).length;
  const heads = layout.filter(Boolean)
    .reduce((n, page) => n + page.staves.reduce((m, st) => m + st.heads.length, 0), 0);
  // HOW BIG THE MUSIC CAME OUT, said out loud when it is too small to read
  // properly.
  //
  // `space` is the gap between two staff lines, as a fraction of the page's
  // height, and it is the one number that decides how much of a scan can be
  // read at all. MEASURED, `npm run scan:import`: at six pixels the three
  // marked pages come back at 51% of their noteheads and one of them finds no
  // staves whatsoever; at ten they come back at 86%. The reader works at 1400
  // pixels across, so those are the pixels a page has when it is read.
  //
  // Saying so is the whole of it. There is nothing to be done to a photograph
  // that was taken too far away — the detail is not in the file — and the
  // person holding the phone is the only one who can fix it, in five seconds,
  // by standing closer and taking it again.
  const spaces = layout.filter(Boolean).map((p) => (p.space ?? 0) * 1400 * 1.4);
  const smallest = spaces.length ? Math.min(...spaces) : null;
  // A page that was refused on the way in outlives this narration: it is the
  // thing the player has to do something about, and the note count is not.
  const tooSmall = smallest !== null && smallest < SPACE_ENOUGH;
  status(note ?? (found
    ? `read ${found} of ${layout.length} ${layout.length === 1 ? 'page' : 'pages'}`
      + ` — ${heads} notes found, so your playing can be marked onto them`
      + (tooSmall
        ? '. The music came out small on the page, so some of it will have been'
          + ' missed — scanning again with the phone closer reads far more of it.'
        : '')
    : 'the music on those pages could not be made out — they are still yours to read from'
      + (tooSmall ? ' The page came out too small to read: hold the phone closer and take it again.' : '')),
  note || tooSmall ? 'bad' : '');
  return layout;
}

// Paper opens straight into the reader: there is no picking a part, no marking
// up, nothing to choose. It is a score to play from.
// The programme this piece is being played as part of, if any: the reader asks
// for it so that the page after the last page is the next piece.
let programme = null;

async function readPaperScore(row) {
  try {
    // The take on screen goes with it: on a scan the reader marks the notes it
    // can — how in tune each one was — onto the noteheads read off the page.
    await openReader(row, {
      take: pending ? { notes: pending.notes } : null,
      setlist: programme,
      onSetlistMove: playFromSetlist,
    });
  } catch (err) {
    status(saying('could not open that score', err), 'bad');
  }
}

// Everything the app could put behind a scan: the notation it already has.
export async function notationScores() {
  return (await listScores()).filter((score) => score.kind !== 'pages');
}

// Say that this scan and that MusicXML are the same piece.
export async function pairWithNotation(paperId, notationId) {
  await pairScoreNotation(paperId, notationId);
  // The picker on the Record tab is what pairing is FOR: the scan can now be
  // the piece you record against, so it has to appear there without a reload.
  await refreshPicker(currentScoreId());
  scoreChanged?.();
}

// Import a MusicXML file and pair it with a scan in one go — the second half of
// "scan it, recognise it somewhere that can, bring it back".
export async function importNotationFor(paperId, file) {
  const id = await addFromFile(file);
  if (id == null) return null;
  await pairWithNotation(paperId, id);
  return id;
}

// A locked part. Publishers encrypt PDFs as a matter of course, and a reader
// that answers "there was a problem" to the commonest kind of file in the shop
// is a reader that cannot open half of what people have paid for. Resolves with
// null if they would rather not.
function askPdfPassword(wasWrong = false) {
  const dialog = document.querySelector('#pdf-password-dialog');
  const input = document.querySelector('#pdf-password-input');
  const note = dialog?.querySelector('.set-hint');
  if (!dialog || !input) return Promise.resolve(null);
  input.value = '';
  if (note) {
    note.textContent = wasWrong
      ? 'That was not the password for this PDF. Try again.'
      : 'This PDF is locked. The password stays on this device, with the part.';
    note.dataset.tone = wasWrong ? 'bad' : '';
  }
  return new Promise((resolve) => {
    const done = () => {
      dialog.removeEventListener('close', done);
      resolve(dialog.returnValue === 'save' ? input.value : null);
    };
    dialog.addEventListener('close', done);
    dialog.showModal();
    setTimeout(() => input.focus(), 50);
  });
}

// The name dialog, shared by scanning and by renaming. Resolves with null if
// the player would rather not say.
export function askScoreName(subtitle = '') {
  const dialog = document.querySelector('#score-name-dialog');
  const input = document.querySelector('#score-name-input');
  const heading = dialog?.querySelector('h2');
  if (!dialog || !input) return Promise.resolve(null);
  input.value = '';
  if (heading) heading.textContent = subtitle ? `Name it — ${subtitle}` : 'Name this score';
  return new Promise((resolve) => {
    const done = () => {
      dialog.removeEventListener('close', done);
      if (heading) heading.textContent = 'Name this score';
      resolve(dialog.returnValue === 'save' ? input.value.trim() : null);
    };
    dialog.addEventListener('close', done);
    dialog.showModal();
    setTimeout(() => input.focus(), 50);
  });
}

// The camera, page after page, until you say stop. Everything it takes goes in
// as one score in the order it was shot.
export async function scanPages() {
  try {
    const taken = await openScanner();
    if (!taken?.pages?.length) return null;
    // Named on the way in. A shelf of "Scanned score", "Scanned score 2" is a
    // shelf you cannot read, and the moment you have just photographed the
    // thing is the moment you know what it is called.
    const count = taken.pages.length;
    const name = await askScoreName(`${count} ${count === 1 ? 'page' : 'pages'} scanned`);
    // `straightened`: the scanner has already squared these, with the corners
    // the player saw and could move. Doing it again is the bug this flag exists
    // to prevent — see addPaper.
    return await addPaper(taken.pages, {
      name: name || 'Scanned score', raws: taken.raws, straightened: true,
    });
  } catch (err) {
    status(err.message, 'bad');
    return null;
  }
}

async function addFromFile(file) {
  if (isPdf(file) || isImage(file)) return addPaper([file]);
  status(`reading ${file.name}…`);
  const xml = await readScoreFile(await file.arrayBuffer(), file.name);
  const parsed = parseScore(xml);
  // Multi-part files are common (a duet, a piano reduction). Take the first
  // single-staff part, which for a part-book is the only one there is.
  const partIndex = parsed.parts.findIndex((p) => p.staves === 1);
  // Refuse BEFORE saving. Storing it first and discovering the problem in
  // adopt() would leave a row in the picker that can never be opened.
  if (partIndex === -1) {
    const staves = parsed.parts.map((p) => `${p.name} (${p.staves} staves)`).join(', ');
    throw new Error(`this reads one line at a time, and that file has none — ${staves || 'no parts'}`);
  }
  const name = parsed.title || file.name.replace(/\.(musicxml|xml|mxl)$/i, '');
  const id = await saveScore({ name, xml, partIndex, parts: parsed.parts });
  await refreshPicker(id);
  await chooseScore(id);
  scoreChanged?.();
  return id;
}

// The page and everything hung around it. The summary and the legend are
// SIBLINGS of the sheet, so showScore's replaceChildren does not touch them —
// annotating twice without this leaves two of each.
function resetSheet() {
  stopFollowing();
  view?.destroy?.();
  view = null;
  ready = null;
  const sheet = el('score-sheet');
  if (sheet) {
    sheet.replaceChildren();
    sheet.hidden = true;
  }
  el('score-summary')?.remove();
  el('score-legend')?.remove();
  clearScoreTab();
}

// Used when the take itself goes away, not merely its page.
export function clearSheet() {
  pending = null;
  resetSheet();
}

// What this take did, note by note — saved alongside the recording so the next
// take can be compared with it without re-aligning anything.
export function currentScoreStats() {
  if (!ready?.aligned) return null;
  return takeStats(ready.aligned.attempts, ready.timing, { targetBpm });
}

// The take was kept, so it is now part of this piece's history — which is read
// in the library, under the piece, rather than in a list under the score.
export async function takeSaved(recordingId) {
  if (pending) pending.recordingId = recordingId;
}

// Choose a score without anyone touching the picker — how a take reopened from
// the library gets the score it was actually played from.
export async function selectScore(id) {
  const pick = el('score-pick');
  if (pick) {
    pick.value = id === null || id === undefined ? NO_SCORE : String(id);
    pick.dispatchEvent(new CustomEvent('refresh-label'));
  }
  await chooseScore(id ?? null);
}

// One plain sentence before the page, because a wall of coloured noteheads is
// not an answer on its own.
function summarise(aligned, timing) {
  const played = aligned.attempts.filter((a) => a.played);
  if (played.length === 0) return 'None of that take lined up with this score.';

  const parts = [];
  const inTune = played.filter((a) => a.verdict === 'match').length;
  const octaves = played.filter((a) => a.verdict === 'octave').length;
  const wrong = played.filter((a) => a.verdict === 'wrong').length;
  // Semitones, on a score read off a page — see the 'near' mark in score-view.
  const near = played.filter((a) => a.verdict === 'near').length;
  parts.push(`${inTune} of ${aligned.attempts.length - aligned.notTaken} notes landed on the written pitch`);
  if (wrong) parts.push(`${wrong} came out as a different note`);
  // Worth its own words rather than being folded into "a different note": a
  // take that is entirely an octave out is a whole take read in the wrong
  // register, and being told 29 wrong notes sends you looking for 29 problems
  // instead of one.
  if (octaves) {
    parts.push(octaves === played.length
      ? 'every note was an octave out — check the register'
      : `${octaves} ${octaves === 1 ? 'was' : 'were'} an octave out`);
  }
  // A semitone apart from a page a recogniser read is not an accusation: it is
  // a disagreement between the take and the reading, and the player is the one
  // who can settle it — by ear, or by tapping the note and correcting the page.
  if (near) {
    parts.push(`${near} ${near === 1 ? 'is' : 'are'} a semitone from what the page says`
      + ' — the page was read off a photograph, so check those against the paper');
  }
  if (aligned.missed) parts.push(`${aligned.missed} never sounded`);
  if (aligned.notTaken) parts.push('the repeat was not taken');

  let sentence = `${parts.join(', ')}.`;
  if (timing?.bpm) {
    const off = timing.perNote.filter((n) => n.verdict === 'late' || n.verdict === 'early').length;
    sentence += ` You played at about ${Math.round(timing.bpm)} bpm`;
    if (timing.targetBpm) {
      sentence += ` against ${timing.targetBpm}`;
      const drift = Math.abs(Math.round(timing.driftFromTargetMs));
      if (drift >= 100) {
        // Seconds gained or lost over the whole passage is the figure that
        // means something out loud — "half a second ahead by the end" is a
        // thing you can hear, a percentage is not.
        sentence += `, ending about ${(drift / 1000).toFixed(1)}s ${timing.aheadOfTarget ? 'ahead of' : 'behind'} it`;
      }
    }
    sentence += off === 0 ? ', and every entry was on the beat.' : `, with ${off} ${off === 1 ? 'entry' : 'entries'} off the beat.`;
  }
  return sentence;
}

function legend(sheet) {
  const row = document.createElement('div');
  row.id = 'score-legend';
  // Three colours, so three swatches. The colour says only which way a note
  // missed — how far is on the tiles and the chart, in cents, which is more
  // exact than a shade could ever be. The in-tune door is the live setting, so
  // changing the tolerance changes what the legend claims.
  const { good } = intonationBounds();
  const swatch = (token, label) => `<span><b style="color:var(${token})">■</b> ${label}</span>`;
  row.innerHTML = [
    swatch('--good', `in tune (within ${good}¢)`),
    swatch('--sharp', 'sharp'),
    swatch('--flat', 'flat'),
    swatch('--muted', 'never sounded'),
    '<span><b style="color:var(--bad)">✕</b> a different note</span>',
    '<span><b style="color:var(--bad)">›</b> late in</span>',
    '<span><b style="color:var(--off)">‹</b> early in</span>',
    '<span><b style="color:var(--primary)">↗</b> arrived flat, corrected</span>',
  ].join('');
  sheet.after(row);
}

// The review for a scanned score: no marked-up engraving, because there is no
// engraving — a sentence about the take, and the page it belongs on.
// What a take against a scan can honestly be told about itself.
//
// Everything here comes out of the AUDIO. Nothing in it needs to know which
// note was written, which is the whole reason it can exist for a photograph of
// a page: how far from centre each note sat, how each one spoke as it started,
// and whether your own pulse held. `rhythmReport` infers the beat from the
// onsets you actually played rather than from a written tempo, and `noteLanding`
// reads the shape of a single note out of the raw pitch trace.
//
// The one thing missing is the one thing that genuinely needs the notation:
// whether the note you played is the note that was printed. The page reader
// finds where the noteheads ARE — that is what marks a take onto the scan — but
// not what they say, which needs clefs, key signatures and accidentals read off
// the paper. So it is stated rather than quietly left out. A report with a
// silent hole in it reads as broken; one that says what it does not know reads
// as honest, and the way to fill the hole is one row away.
function analyseScanTake(notes, readings, a4) {
  const played = (notes ?? []).filter((n) => Number.isFinite(n?.midi));
  if (!played.length) return null;

  const landings = new Map();
  if (readings?.length) {
    for (const [i, note] of played.entries()) {
      const landing = noteLanding(note, readings, a4);
      if (landing) landings.set(i, landing);
    }
  }

  const cents = played.map((n) => Math.abs(n.cents ?? 0));
  const off = cents.reduce((sum, c) => sum + c, 0) / cents.length;
  const tight = cents.filter((c) => c <= intonationBounds().good).length;

  // The pulse you kept, worked out from your own onsets. A scan has no written
  // tempo to be judged against, and that is not the same as having no timing:
  // evenness is a property of the playing.
  let rhythm = null;
  try { rhythm = rhythmReport(played); } catch { /* a take with no usable pulse */ }

  return { played, landings, rhythm, off, tight, count: played.length };
}

function scanSummary(analysis) {
  if (!analysis) return 'Nothing was heard in that take.';
  const { count, off, tight, rhythm } = analysis;
  const parts = [`${tight} of ${count} ${count === 1 ? 'note' : 'notes'} landed in tune`];
  parts.push(`${off.toFixed(1)}¢ from centre on average`);
  if (Number.isFinite(rhythm?.bpm)) {
    parts.push(`your own pulse ran about ${Math.round(rhythm.bpm)}`);
  }
  if (Number.isFinite(rhythm?.evenness)) {
    parts.push(`${Math.round(rhythm.evenness * 100)}% even`);
  }
  return `${parts.join(', ')}.`;
}

// The way through to the page, built fresh for wherever it is being put.
function openScoreButton() {
  const open = document.createElement('button');
  open.className = 'ctl primary';
  open.type = 'button';
  open.textContent = 'Open the score →';
  open.addEventListener('click', () => readCurrentScore());
  return open;
}

// Said out loud, and next to the thing that would fix it. This is the only part
// of the analysis a scan cannot do, and a player who is not told that is a
// player who thinks the app looked at their notes and had no opinion.
function scanGapNote() {
  const gap = document.createElement('p');
  gap.className = 'score-scan-gap';
  gap.textContent = 'Read from the sound: intonation, how each note spoke, and'
    + ' your own pulse. Whether you played the written note needs the notation —';
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'linkish';
  add.textContent = 'add its MusicXML';
  add.addEventListener('click', () => el('score-pair')?.click());
  gap.append(' ', add, '.');
  return gap;
}

function showScanReview(analysis) {
  const title = el('score-review-title');
  if (title) title.textContent = current.name ?? '';
  const summary = el('score-tab-summary');
  if (summary) summary.textContent = scanSummary(analysis);

  // On BOTH screens, because the sentence and the button were on different
  // ones.
  //
  // This is the "it tells me to open the score and there is nothing to press"
  // bug, and it is entirely a matter of geography. #score-hint — the line that
  // says open the score — lives in the Record tab's card, which is where you
  // are standing when you press Stop. #score-stage lives in the Score tab's
  // review card, which is a tab switch away and gives no sign it has anything
  // on it. So the instruction was on one screen and the only way to obey it
  // was on another, and a player who never thought to go looking simply had a
  // take that went nowhere.
  //
  // A take against notation never had this problem because it fills
  // #score-sheet, which is in the Record card an inch under the hint. So this
  // does the same thing, and keeps the Score tab's copy for the player who
  // arrives from that side.
  // The Record card keeps a way through to the review, on the same screen as
  // the sentence about it — see the note on that bug below. What it is NOT any
  // more is the way to the full-screen reader: being thrown onto a music stand
  // the moment you stop recording is the app deciding you have finished
  // thinking about the take. The page is in the review now, under the
  // transport, with the graph beside it; the stand is a second choice for when
  // you want to play FROM it.
  //
  // (The bug that put this here: #score-hint, the line telling you to open the
  // score, lives in the Record tab's card, where you are standing when you
  // press Stop. The only button that did it lived in the Score tab's review
  // card, a tab switch away with nothing to suggest it had anything on it.)
  const sheet = el('score-sheet');
  if (sheet) {
    sheet.replaceChildren(reviewButton(), fullScreenLink(), scanGapNote());
    sheet.hidden = false;
  }

  const tempo = el('score-tempo-row');
  if (tempo) tempo.hidden = true;    // there is no written tempo to play against
  showReviewCard(true);
}

// Through to the review, which is where the page now is.
function reviewButton() {
  const button = document.createElement('button');
  button.className = 'ctl primary';
  button.type = 'button';
  button.textContent = 'See it on the score →';
  button.addEventListener('click', () => openTab?.());
  return button;
}

// …and the stand, for playing from rather than looking at.
function fullScreenLink() {
  const button = document.createElement('button');
  button.className = 'ctl';
  button.type = 'button';
  button.textContent = 'Full screen';
  button.addEventListener('click', () => readCurrentScore());
  return button;
}

// Called on Stop, and when a saved take is reopened.
export async function annotateTake(notes, { readings = null, a4 = 440, recordingId = null } = {}) {
  pending = { notes, readings, a4, recordingId };
  if (!current) return null;
  // A scan on its own: there is nothing to line the take up AGAINST, so nothing
  // is aligned. The take is remembered, and the reader draws what the audio
  // proved onto the noteheads the page reader found.
  if (current.plain) {
    // A scan has nothing to line the take up AGAINST, and for a long time that
    // was taken to mean it had nothing to say about the take at all — a note
    // count and an average, and the rest of the analysis simply absent.
    //
    // But almost none of that analysis was ever about the notation. Intonation
    // is the audio. How a note spoke is the audio. Whether your pulse held is
    // the audio. Only "that was the wrong note" needs to know what was printed.
    // So the take gets everything the sound can support, it is stamped like any
    // other take so it can be reopened tomorrow, and the single missing half is
    // named on the card rather than left as a hole.
    const analysis = analyseScanTake(notes, readings, a4);
    ready = {
      plain: true,
      played: analysis?.played ?? [],
      landings: analysis?.landings ?? new Map(),
      rhythm: analysis?.rhythm ?? null,
      summary: scanSummary(analysis),
      takeDate: Date.now(),
    };
    showScanReview(analysis);
    status(`${current.name} — ${scanSummary(analysis)}`);
    // Drawn now if the player is already on the Score tab, exactly as a take
    // against notation is: waiting for a tab switch that may never come leaves
    // somebody looking at last week's page.
    if (scoreTabIsShowing()) {
      borrowPanel();
      await renderScoreTab();
    }
    return { plain: true, annotated: true };
  }
  const sheet = el('score-sheet');
  if (!sheet) return null;

  resetSheet();
  sheet.hidden = false;
  status(`lining ${current.name} up with what you played…`);

  // A SCORE THE RECOGNISER READ IS NOT A SCORE SOMEBODY TYPESET.
  //
  // alignScore prices a semitone miss as a wrong note — right for a file whose
  // notes are what the composer wrote, and wrong for one read off a
  // photograph, where an accidental the reader dropped is a semitone that was
  // never played wrongly. `nearMiss` exists for exactly this and was never
  // switched on for the one route that produces it.
  //
  // Measured on the recogniser's own output, playing the page EXACTLY as
  // printed: 73 notes accused of being wrong across takes of forty, three
  // notes left with no mark at all, and 55 played notes put on the wrong
  // notehead. With it on: none, none, and none.
  const aligned = alignScore(notes, current.notes, { nearMiss: current.readFromPages === true });
  const timing = scoreTiming(aligned.attempts, { targetBpm });

  // How each note SPOKE, not just where it ended up. Needs the raw readings,
  // which only the live take and the stored payload have.
  const landings = new Map();
  if (readings?.length) {
    for (const attempt of aligned.attempts) {
      if (!attempt.played) continue;
      const landing = noteLanding(attempt.played, readings, a4);
      if (landing) landings.set(attempt.scoreNoteId, landing);
    }
  }

  // Stamped once per take, so redrawing after a tempo change or a tab switch
  // does not read as another go at the passage.
  ready = {
    aligned, timing, landings, summary: summarise(aligned, timing), takeDate: Date.now(),
  };

  const title = el('score-review-title');
  if (title) title.textContent = current.name ?? '';

  const tempoRow = el('score-tempo-row');
  if (tempoRow) tempoRow.hidden = false;

  const summary = document.createElement('p');
  summary.id = 'score-summary';
  summary.textContent = ready.summary;
  sheet.before(summary);

  const open = document.createElement('button');
  open.id = 'score-open';
  open.className = 'ctl primary';
  open.type = 'button';
  open.textContent = 'Open the score →';
  open.addEventListener('click', () => openTab?.());
  sheet.replaceChildren(open);
  showReviewCard(true);
  status(`${current.name} — marked up. Open the score to read it.`);

  // If the player is already looking at the Score tab, draw it now rather than
  // leaving them on a stale page waiting for a tab switch that will not come.
  // The reset above handed the controls back and hid the dock button, which is
  // right when the take is going away and wrong when a new one is arriving on
  // the tab you are standing on — so take them again here. onScoreTabShown
  // does this on a real tab switch; a same-tab redraw never fires it.
  if (scoreTabIsShowing()) {
    borrowPanel();
    await renderScoreTab();
  }
  return { aligned, timing, annotated: true };
}

// The longest the review will wait for the pages to be read before drawing
// what it has. Long enough for a part of a dozen pages on a tablet, short
// enough that a pass which is standing aside for something else cannot turn
// this into a blank card.
const READ_WAIT = 20000;

// The scanned page, in the review, with everything on it live.
//
// Everything the engraved review does, done against a photograph: the note
// being heard lights up, any note can be pressed for the drone and the
// close-up, and the transport and the zoomed graph are the same borrowed
// controls sitting under it. The one thing it cannot say is whether a note was
// the note that was WRITTEN, which is the only half of this that ever needed
// the notation.
async function renderScanTab() {
  // Finish reading the pages FIRST, because this is the moment to.
  //
  // This is the "it only marked five of my hundred notes" bug. The reading
  // pass stands aside whenever the player is doing anything — which is right,
  // a page turn must never wait on it — and importing a part and recording
  // straight away is doing something continuously. So the pass gets a page or
  // two in and then politely waits, and the take is paired against the handful
  // of noteheads that happened to be found: `Math.min(heads, played)` quietly
  // throws the rest of the take away and nothing anywhere says so.
  //
  // A review is the one moment nobody is playing. Nothing is standing aside
  // for here, so the reading is finished now, at full speed, and the take is
  // paired against the whole part rather than against however much of it the
  // pass had managed between page turns.
  let payload = await loadScorePages(current.id).catch(() => null);
  if (!payload) return null;
  const pageCount = payload.layout?.length ?? payload.pages?.length ?? payload.pageCount ?? 0;
  const readSoFar = (payload.layout ?? []).filter(Boolean).length;
  // What this drawing is based on, so the redraw above fires when there is more
  // and not when there is the same.
  drewWithRead = readSoFar;
  if (pageCount && readSoFar < pageCount) {
    // Something on the screen FIRST.
    //
    // Reading a part takes a second or two a page, and everything below waits
    // for it — so the panel sat empty for as long as it took, with the summary
    // above it saying the take had been analysed. An empty box under a sentence
    // claiming success reads as a failure, and it is the one moment the app
    // genuinely is working.
    const waiting = document.createElement('p');
    waiting.className = 'score-scan-gap';
    waiting.textContent = pageCount === 1
      ? 'Reading the page, so every note can be put where it belongs…'
      : `Reading the ${pageCount} pages, so every note can be put where it belongs…`;
    mountScore(waiting, ready.summary);
    // No `standAside` handed over on purpose: that argument is the reader's,
    // for keeping a page turn instant, and there are no page turns here. The
    // pass narrates its own progress.
    //
    // Raced against a clock, though, because measurePages hands back the pass
    // that is ALREADY running if there is one — and that pass may be the
    // reader's, which stands aside for as long as somebody is touching the
    // reader. Awaiting it flat would make this review wait on a screen behind
    // it. Whatever has been read by the time the clock runs out is what the
    // page is drawn from; the pass carries on either way and the next look at
    // this take gets the rest.
    const finished = measurePages(current.id).catch(() => null);
    await Promise.race([
      finished,
      new Promise((go) => { setTimeout(go, READ_WAIT); }),
    ]);
    payload = await loadScorePages(current.id).catch(() => payload);
    drewWithRead = (payload?.layout ?? []).filter(Boolean).length;
    status(`${current.name} — ${ready.summary}`);
  }
  const page = document.createElement('div');
  const stage = mountScore(page, ready.summary);
  if (!stage) return null;

  try {
    view = await showScanScore(page, {
      payload,
      layout: payload.layout,
      notes: ready.played,
    });
  } catch (err) {
    view = null;
    stage.replaceChildren();
    status(saying('could not lay the pages out', err), 'bad');
    return null;
  }
  // THE BARS GO ON WHATEVER THE PAIRING DID.
  //
  // Tapping a bar to hear that moment does not go through a single notehead —
  // see bar-sync.js — so it is attached before the refusal below is even
  // considered. It is most useful precisely where the review has nothing to
  // show: a page whose clef was misread places no marks at all, and a
  // photograph with a sentence under it is the whole of what a player used to
  // get from one.
  try {
    const { attachBarSync } = await import('./bar-sync.js');
    const { playTakeFrom, followPlayback } = await import('./report.js');
    const { saveBarAnchors } = await import('../store/db.js');
    // The marks belong to THIS take: an anchor is a second of one recording,
    // and yesterday's run of the same page was a different set of seconds. A
    // take that has not been saved yet has no id to keep them under, so its
    // marks live for as long as the review does — see saveBarAnchors.
    const takeId = pending?.recordingId ?? null;
    const scoreId = current.id;
    barSync?.destroy();
    barSync = attachBarSync(page, {
      layout: payload.layout,
      play: playTakeFrom,
      follow: followPlayback,
      anchors: takeId != null ? (payload.barAnchors?.[takeId] ?? []) : [],
      // What was played, so the layer can place the systems itself before
      // anybody taps anything.
      notes: ready?.played ?? null,
      onAnchors: (marks) => {
        saveBarAnchors(scoreId, takeId, marks).catch(() => {
          /* the marks still work for this sitting */
        });
      },
    });
  } catch {
    barSync = null;   // a page without bars is still a page to look at
  }

  if (!view || !view.pairing?.marks?.length) {
    // Two different silences, and they want two different sentences: no
    // noteheads at all means the pages have not been read, and noteheads but
    // no marks means the take could not be found among them.
    const note = view?.pairing && view.pairing.heads > 0
      ? scanUnplacedNote(view.pairing)
      : scanUnreadNote(payload);
    // …AND THE MUSIC STAYS ON THE SCREEN UNDER IT, where the view managed to
    // draw any. A refusal is about where the notes were PLAYED; it is not a
    // reason to take away the page somebody just photographed, and replacing
    // the whole stage with one sentence is what it used to do. Where nothing
    // was drawn the sentence is all there is, and the view is torn down.
    const drawn = page.querySelector('.scan-page canvas');
    if (drawn) {
      stage.prepend(note);
    } else {
      stage.replaceChildren(note);
      view?.destroy?.();
    }
    view = null;
    return null;
  }

  // How much of the take actually landed on a notehead. Never silent: with a
  // drone and a close-up behind every ring, a pairing that has slipped is
  // making specific claims about specific notes.
  const { pairing } = view;
  // AN OCTAVE OUT, SAID OUT LOUD.
  //
  // The take was recognised on the page only after it was moved a register, and
  // that is a fact about the take that the player is entitled to. It is
  // deliberately not called a mistake: the two things that put a take an octave
  // out are playing it 8va — ordinary, and sometimes what the part asks for —
  // and the pitch reader hearing an instrument's second harmonic rather than
  // its first, which is ordinary on a flute. Nothing here can tell those apart,
  // so it says what happened and not whose fault it was.
  if (pairing.octaveShift) {
    const line = el('score-tab-summary');
    if (line) {
      const said = document.createElement('small');
      said.className = 'scan-pairing';
      const octaves = Math.abs(pairing.octaveShift) / 12;
      const how = octaves === 1 ? 'an octave' : `${octaves} octaves`;
      // The shift is what the PAGE had to move to meet the take, so its sign is
      // the other way round from how the playing sounded.
      said.textContent = ` These came back ${how} ${pairing.octaveShift < 0 ? 'above' : 'below'}`
        + ' what is written — either played that way, or heard that way. They are marked'
        + ' where they are written.';
      line.append(said);
    }
  }
  if (pairing.unmarked > 0 || pairing.spare > 0) {
    const line = el('score-tab-summary');
    if (line) {
      const extra = document.createElement('small');
      extra.className = 'scan-pairing';
      extra.textContent = pairing.unmarked > 0
        ? ` ${pairing.played} notes played, ${pairing.heads} noteheads found on the pages read`
          + ` — the last ${pairing.unmarked} are not on the page.`
        : ` ${pairing.played} notes played onto ${pairing.heads} noteheads, in the order you played them.`;
      line.append(extra);
    }
  }

  // The dashed circles, explained.
  //
  // Inside the passage you played there are noteheads no note landed on —
  // either you skipped them, or the aligner could not place a note there. They
  // are drawn, faintly, and they are pressable, and a mark on a page that
  // nothing accounts for reads as a bug. Said in the same breath as what
  // pressing one does, because the honest half of that answer is the surprising
  // half: it sounds what is WRITTEN, synthesised, and never anything out of the
  // recording — there is no recording of a note nobody played.
  if (view.quiet > 0) {
    const line = el('score-tab-summary');
    if (line) {
      const extra = document.createElement('small');
      extra.className = 'scan-pairing';
      // "on these pages" rather than "in that passage": the dashed noteheads
      // are now every head on the pages being shown that this take did not
      // play, not only the ones beside it. See the note above quietWanted.
      extra.textContent = ` ${view.quiet} noteheads on these pages were not played in this take`
        + ' — the dashed ones. Press one to hear what is written there, synthesised.';
      line.append(extra);
    }
  }

  // …and now the timing, which needed the marks to exist.
  //
  // Until the take was on the noteheads there were no bars to measure it
  // against, so a scan could only report the pulse a player kept — true, and
  // not what a page of music offers. The page has bars on it, and a bar is the
  // unit a player thinks in. Said here rather than in analyseScanTake because
  // it is the pairing, not the audio, that makes it possible.
  // scanRhythm and not scanTiming, and the difference is a whole second half.
  //
  // scanTiming answers "was the PULSE steady", which is true of any take and
  // says nothing about the music. scanRhythm (scan-rhythm.js) asks the page's
  // own note values whether they may be believed, bar by bar, and where they
  // may it measures each note against the duration PRINTED there — the same
  // early/on/late an engraved score gets. It returns scanTiming's whole report
  // unchanged as `.timing`, so `ready.bars` keeps the exact shape it had and no
  // consumer of it had to be found.
  //
  // WHICH BRANCH FIRES ON A PHOTOGRAPH TODAY, so the sentences below are read
  // in the right order: `npm run scan:values` says validateValues believes ZERO
  // bars on all three marked photographs (0 of 39, 0 of 38, 0 of 37) because the
  // bar GROUPING is doubled upstream in notesInOrder, so on real paper
  // `notesJudged` is 0 and the coarse sentence is the whole answer. The written
  // sentence is not dead code — `npm run score:follow` watches it fire on an
  // engraved page — but nobody should read this block and think a photograph
  // gets it.
  const rhythm = scanRhythm(view.pairing?.marks);
  const bars = rhythm.timing;
  if (bars) {
    ready.bars = bars;
    // NOT stored whole. `scanRhythm`'s per-note half is used right here to
    // write the sentence and nothing else reads it, and a field parked on
    // `ready` that nobody reads is the next round's dead parameter. It is one
    // call away for whoever needs it.
    const line = el('score-tab-summary');
    if (line) {
      // WHAT A BAR IS HERE, AND WHY THIS SENTENCE NOW HAS TWO FORMS.
      //
      // `bars.steadiness` is the spread of the LENGTHS of the stretches the
      // reader's barlines cut the take into, and two such stretches are only
      // comparable when they hold the same amount of written music. This line
      // used to print that number flat, as "47% steady across 17 bars,
      // dragging".
      //
      // MEASURED, npm run score:follow, on the walk's own engraved page: the
      // take there is synthesised on a 0.45 s grid — even by construction, and
      // the free review beside it says "100% even" — and the reader's barlines
      // cut it into groups of 1, 1, 1, 1, 4, 4, 3, 2, 1, 3 … notes, so a group
      // holding one note of a four-note bar measured a quarter of that bar and
      // stood in the same list as groups holding all four. The number was a
      // statement about the GROUPING, worded as a statement about the player,
      // and wrong in the direction that flatters nobody.
      //
      // MEASURED on real paper, this round, by cropping the page at 6x and
      // looking at it (tools/crop.mjs, the Bach photograph at 274,1277): what
      // findBars accepts there is the STEM of a beamed semiquaver group whose
      // head sits on the top line and whose beam sits on the bottom one — it
      // fills the column, nothing wide touches it over most of its height, and
      // it does not overhang, so all three of findBars' tests pass. Nineteen of
      // that page's thirty-nine bar-groups are fragments cut out by stems like
      // that one, and four of its ten systems are barred exactly right.
      //
      // So the comparison is only offered where it can be checked: across the
      // bars whose PRINTED VALUES ADD UP to the page's own bar, which therefore
      // hold the same written length. Everywhere else this says what the
      // stretches are and refuses to compare them — the take's own free review
      // measures a pulse directly and needs no page to do it.
      const extra = document.createElement('small');
      // NOT `scan-bars`, which is the LAYER of invisible boxes drawn over a
      // photographed page — `position: absolute; inset: 0; z-index: 3`. This is
      // a sentence ABOUT the barlines, and naming it after them turned a line of
      // prose into a transparent sheet 390 by 1383 over the whole review.
      // MEASURED at 390x844: `elementFromPoint` in the middle of the graph's
      // play button, of Save and of Discard answered this <small> for all three,
      // so not one of them could be pressed. "when I click the pause button on
      // the graph below, it doesn't pause… when I click Save or Discard, none of
      // those are working." The class is scoped to a page as well now, so the
      // same collision cannot be made again by picking the same word.
      extra.className = 'scan-pairing scan-barlines';
      const whole = (rhythm.bars ?? []).filter((b) => b.believed && b.length > 0);
      if (whole.length >= 3) {
        // NO RUSHING-OR-DRAGGING WORD HERE, and it is deliberate rather than
        // forgotten. `bars.verdict` comes off scanTiming's `drift`, which is
        // computed over every stretch the barlines cut — fragments included —
        // so printing it beside an evenness taken over the BELIEVED bars only
        // would put a comparable number next to an incomparable word and
        // undo exactly what this branch is for. Drift over the believed bars
        // alone is the thing to add, and it is not added on a guess: this
        // branch has no executor anywhere (`barsBelieved >= 3` is false on
        // every page in the repo), so a second number here could not be
        // measured either.
        const even = Math.max(0, 1 - spread(whole.map((b) => b.length)));
        extra.dataset.route = 'believed';
        extra.textContent = ` Against the bars on the page: ${whole.length} of the`
          + ` ${rhythm.bars.length} stretches you played through hold a whole bar of the`
          + ` values printed in them, and across those your bar lengths were`
          + ` ${Math.round(even * 100)}% even.`;
      } else {
        extra.dataset.route = 'groups';
        extra.textContent = ` The barlines found on this page cut what you played into`
          + ` ${bars.bars} stretches, and the values printed inside them do not add up to`
          + ' equal bars — so one stretch running longer than another is not a fact about'
          + ' your pulse, and nothing here is claiming it is. How even you played is'
          + ' measured directly in the review of the take itself, which needs no page.';
      }
      line.append(extra);

      // …and then the note values, in ONE of two sentences that are never
      // blended. The two routes measure different things against different
      // references — see the header of scan-rhythm.js — so there is no field
      // here that could be worded once and filled from either.
      const said = document.createElement('small');
      said.className = 'scan-pairing scan-rhythm';
      if (rhythm.notesJudged > 0) {
        // The written route. `on`, `late` and `early` are score-timing's own
        // words and they are only ever printed for notes that came back from
        // it; the anchors are counted apart because a run's first note has
        // nothing to be early against and reads as a free 'on' otherwise.
        const on = rhythm.perNote.filter((n) => n.verdict === 'on').length;
        const late = rhythm.perNote.filter((n) => n.verdict === 'late').length;
        const early = rhythm.perNote.filter((n) => n.verdict === 'early').length;
        // THE THREE WORDS ARE THEIR OWN TOTAL, and are not counted out of
        // `notesJudged`. They do not partition it: score-timing.js can give a
        // note a deviation and still not name it (a run of one, a note whose
        // start was lost), and scan-rhythm.js carries that through as a null
        // verdict rather than inventing a word for it. Written as "N of them
        // named", the sentence would visibly fail to add up.
        const named = on + late + early;
        const off = Number.isFinite(rhythm.meanAbsMsWritten)
          ? `, ${Math.round(rhythm.meanAbsMsWritten)}ms out on average` : '';
        said.dataset.route = 'written';
        said.textContent = ` And against the note values PRINTED on the page:`
          + ` ${rhythm.barsBelieved} of the ${rhythm.bars.length} bars you played in`
          + ' could be believed,'
          + ` and ${named} of the ${rhythm.notesJudged} notes measured against them`
          + ` came back ${on} on time, ${late} late and ${early} early${off}.`;
      } else {
        // The refusal, said out loud with its reason, because the sentence
        // above it is otherwise read as a verdict about the RHYTHM. It is not:
        // an equal division of a bar is an assumption about the printing, and
        // nothing here read whether the printing agrees. Rule 5, in words.
        said.dataset.route = 'even';
        // Punctuated so the reason reads as an aside and not as the start of
        // the next clause: "could not be believed — the bars do not agree on
        // how long a bar is, so nothing here can say" was one sentence saying
        // two things.
        const why = rhythm.valuesWhy ? ` (${rhythm.valuesWhy})` : '';
        // …AND WHERE THE EVEN-ROUTE NUMBER NOW LIVES. It used to hang off the
        // bar sentence above as "notes 120ms from where the bar wants them",
        // which says the BAR wanted them there. Nothing read that: it is the
        // distance from an equal division of a stretch of page, and an equal
        // division is an assumption about the printing that this branch has
        // just finished saying it could not check. It belongs under the
        // refusal, worded as what it measures.
        const equal = Number.isFinite(rhythm.meanOffMsEven) && rhythm.notesFromEven > 0
          ? ` What is measured instead is spacing: ${rhythm.notesFromEven} notes fell`
            + ` ${Math.round(rhythm.meanOffMsEven)}ms on average from an EQUAL division of`
            + ' their own stretch of page, which is a fact about how you spread them and'
            + ' not about what is written there.'
          : '';
        said.textContent = ` The note values printed on this page could not be`
          + ` believed${why}, so nothing here can say whether a note was written`
          + ` long or short.${equal}`;
      }
      line.append(said);
    }
  }

  follow(view.noteheadFor);
  // The dock holds the transport and the close-up, and it hides itself when
  // there is no take to control. A scan take is a take: without this the page
  // came up with every note clickable and nothing to play them with.
  syncDockVisibility();
  return view;
}

// The take could not be found on these pages, and why.
//
// Refused rather than guessed. Placing it anyway is what put every ring on a
// title page, and with a drone and a close-up behind each one that is not a
// slightly-wrong picture — it is a lot of confident false statements about
// particular notes.
function scanUnplacedNote(pairing) {
  const note = document.createElement('p');
  note.className = 'score-scan-gap';
  // …AND THE EVIDENCE FOR THE REFUSAL, WHERE THERE IS ANY.
  //
  // "what was played does not match the notes on these pages" is a strong thing
  // to tell somebody about their own playing, and until this round the app
  // could not say it at all — the pairing believed a wrong piece and reported
  // "26 notes played onto 50 noteheads, in the order you played them". Now that
  // pairNotes has a confidence floor it CAN say it, and a flat assertion with no
  // number behind it is the same failure in the other direction: unarguable.
  // So where the refusal came from the floor, the count it was read off is
  // quoted. MEASURED, npm run scan:floor: two octaves of D major over the Bach
  // photograph score 14 of 24, and the floor is 0.70 — which is the sentence
  // below, filled in.
  //
  // `exactAgreement` is null (never 0) when too few marks were judgeable, and
  // that refusal has its own `why` and gets no number, because there was none.
  const judged = Number.isFinite(pairing?.judged) ? pairing.judged : null;
  const agreed = Number.isFinite(pairing?.exactAgreement) && judged
    ? Math.round(pairing.exactAgreement * judged)
    : null;
  const evidence = agreed === null
    ? ''
    : ` Of the ${judged} notes it could compare against a notehead it had priced,`
      + ` ${agreed} were the pitch printed there.`;
  note.textContent = `${pairing.played} notes played, and ${pairing.heads} noteheads`
    + ` read off the pages — but ${pairing.why}.${evidence}`
    + ' The marks are held back rather than put somewhere they might not belong.';
  return note;
}

// Why there is nothing to press, and what to do about it.
function scanUnreadNote(payload) {
  const read = (payload?.layout ?? []).filter(Boolean).length;
  const total = payload?.layout?.length ?? payload?.pages?.length ?? 0;
  const note = document.createElement('p');
  note.className = 'score-scan-gap';
  note.textContent = read === 0
    ? 'The pages have not been read yet — that happens in the background while'
      + ' the score is open and idle, so open it once and leave it a moment.'
    : `Only ${read} of ${total} pages have been read so far, and no noteheads`
      + ' were found on them. Opening the score and leaving it idle lets the'
      + ' reading finish.';
  return note;
}

// Engrave and mark up the page. Called the first time the Score tab is shown,
// because only then does its panel have a width to lay the music out to.
// One render at a time, and one per take.
//
// The tab machinery calls this on every switch to the Score tab, and a take
// arriving while that tab is already up calls it too. Both are right, and
// both were allowed to run at once — on a scan that means two passes reading
// the same pages and two sets of rings racing to replace each other in the
// same box, with whichever finishes second winning. Held on a promise so the
// second caller waits for the first rather than starting again.
let rendering = null;

// HOW MUCH OF THE PART WAS READ WHEN THE REVIEW WAS DRAWN.
//
// The review does not wait for a long part to be read — it races the pass for
// READ_WAIT and draws whatever is known by then, because a blank panel under a
// sentence claiming success reads as a failure. What it never did was come back
// when the rest arrived, so a take reviewed against three pages of a
// twelve-page part stayed that way until something else redrew it.
let drewWithRead = -1;

// …so the review redraws itself as the pass finishes pages, and only then: the
// guard is what stops a run of page-by-page events redrawing a review that is
// already complete, and `view` is cleared first because renderScoreTabOnce
// returns the drawing it already has unless there is a reason not to.
onLayoutRead((id, fresh) => {
  if (!current || current.id !== id || !ready) return;
  const read = (fresh ?? []).filter(Boolean).length;
  if (read <= drewWithRead) return;
  view?.destroy?.();
  view = null;
  // Drawn again where somebody is looking, and left for the next look where
  // they are not: an inactive tab panel is display:none, and anything measured
  // inside one measures zero — the reason this whole function is called on the
  // way in rather than when the take arrives.
  if (scoreTabIsShowing()) renderScoreTab();
});

export async function renderScoreTab() {
  if (rendering) return rendering;
  rendering = renderScoreTabOnce().finally(() => { rendering = null; });
  return rendering;
}

async function renderScoreTabOnce() {
  if (!current || !ready) return null;
  if (view) return view; // already drawn for this take
  // A scan gets the photograph, with the same things live on it.
  //
  // Drawn HERE rather than when the take arrives, for the reason this whole
  // function exists: an inactive tab panel is display:none, so anything
  // measured inside one measures zero and the page lays itself out to a width
  // that does not exist.
  if (ready.plain) return renderScanTab();

  const page = document.createElement('div');
  const stage = mountScore(page, ready.summary);
  if (!stage) return null;

  // Engrave FIRST and paint only once the reconciliation is known to be
  // complete. Painting on the way in and undoing it afterwards does not undo:
  // a notehead that has been given a colour keeps it, so a partial match would
  // leave a half-marked page under a line of text claiming it was unmarked —
  // exactly the wrong-notehead failure this design exists to avoid.
  try {
    view = await showScore(page, {
      xml: current.xml,
      scoreNotes: current.notes,
      partIndex: current.partIndex ?? 0,
      asPrinted: await wasReadFromPages(current),
    });
  } catch (err) {
    view = null;
    stage.replaceChildren();
    status(saying('could not engrave that score', err), 'bad');
    return null;
  }

  if (!view.ok) {
    status(`${view.unmatched.length} notes on the page could not be matched to the analysis, so this score is shown unmarked. The charts on the Record tab still have the take in full.`, 'bad');
    return view;
  }

  paint(view, {
    aligned: ready.aligned,
    timing: ready.timing,
    landings: ready.landings,
    // Just the one path. onPick is already selectPlayedNote, and calling it
    // twice ran the whole selection — teardown, zoom inset, playback, drones —
    // over the top of itself, which looks identical once it settles and is not.
    onPickNote: (attempt) => onPick?.(attempt.played),
  });
  legend(stage);
  follow(view.noteheadFor);
  syncDockVisibility();
  return view;
}

// The tempo you are working at is a number you already know — the one written
// at the top of the page, or the one on the metronome in front of you. It used
// to be chosen from the seventeen traditional metronome marks, which is a list
// whose whole purpose is to not contain 137. So: type it.
//
// Two rows in the picker, and no more: "no tempo", and whatever number was
// typed. Nothing is lost by that — "no tempo" is the old default, where the
// take is read against the pulse you actually played rather than a fixed grid.
const MIN_BPM = 20;
const MAX_BPM = 300;
const CUSTOM = 'custom';

// What was last typed, whether or not it is the one in force — so turning the
// tempo off and on again does not make you type it a second time.
let typedBpm = Number(localStorage.getItem('scoreTargetBpm')) || null;

function paintTempoPicker() {
  const pick = el('score-target');
  const input = el('score-target-bpm');
  if (!pick) return;
  pick.replaceChildren();
  const none = document.createElement('option');
  none.value = 'none';
  none.textContent = 'no tempo';
  pick.append(none);
  if (typedBpm) {
    const mine = document.createElement('option');
    mine.value = CUSTOM;
    mine.textContent = `${typedBpm} bpm`;
    pick.append(mine);
  }
  pick.value = targetBpm ? CUSTOM : 'none';
  // The custom pickers mirror the native select; this is how they are told the
  // options changed without firing 'change' and re-running the analysis.
  pick.dispatchEvent(new CustomEvent('refresh-label'));
  if (input && document.activeElement !== input) {
    input.value = typedBpm ? String(typedBpm) : '';
  }
}

// Put the take back through the timing with whatever the tempo is now. Nothing
// is re-recorded and nothing is re-engraved — only the timing marks and the
// sentence change.
async function applyTempo(bpm) {
  targetBpm = bpm;
  if (bpm) localStorage.setItem('scoreTargetBpm', String(bpm));
  else localStorage.removeItem('scoreTargetBpm');
  paintTempoPicker();
  if (pending) await annotateTake(pending.notes, pending);
}

function initTempoPicker() {
  const pick = el('score-target');
  const input = el('score-target-bpm');
  if (!pick) return;
  paintTempoPicker();

  pick.addEventListener('change', () => {
    applyTempo(pick.value === CUSTOM ? typedBpm : null).catch(() => {});
  });

  if (!input) return;
  // Typing a tempo IS choosing it — having to type 96 and then pick "96 bpm"
  // from a menu of one is a step that exists only because the markup has two
  // controls in it.
  const commit = () => {
    const raw = input.value.trim();
    if (!raw) {
      typedBpm = null;
      applyTempo(null).catch(() => {});
      return;
    }
    const bpm = Math.round(Number(raw));
    if (!Number.isFinite(bpm) || bpm < MIN_BPM || bpm > MAX_BPM) {
      paintTempoPicker(); // put the last good number back
      return;
    }
    typedBpm = bpm;
    applyTempo(bpm).catch(() => {});
  };
  input.addEventListener('change', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
  });
}

// Opened from the Library: this is the piece you are about to play, so it
// becomes the chosen one (the next take is marked against it) and the reader
// opens on it straight away.
export async function openScoreFromLibrary(id, { setlist = null } = {}) {
  const row = await loadScore(id);
  if (!row) return;
  programme = setlist;
  // Paper is not notation and must not go through the parser: it has no XML to
  // parse and no part to choose. It IS still the chosen piece, though, and that
  // sentence was false here for as long as this function has existed.
  //
  // WHAT IT COST. `annotateTake` opens with `if (!current) return null`, so a
  // scan opened off the shelf and recorded from — which is now one tap, on the
  // dot on the music — produced a take that was analysed, stamped, and marked
  // onto nothing at all. "when i record on an opened score, and stop recording,
  // it should take me to a new window to analyze the recording. right now
  // nothing happens." Nothing happened because the app did not think any score
  // was open; the reader knew, and it was the only thing that did.
  if (row.kind === 'pages') {
    await selectScore(id);
    await readPaperScore(row);
    return;
  }
  await selectScore(id);
  await readCurrentScore();
}

// Turning past the end of one piece in a programme, or back before the start of
// it: the reader asks, and this opens the neighbour with the programme intact.
export async function playFromSetlist(setlist, index) {
  if (!setlist?.items?.length) return false;
  const at = Math.max(0, Math.min(setlist.items.length - 1, index));
  if (at === setlist.index) return false;
  await openScoreFromLibrary(setlist.items[at], {
    setlist: { ...setlist, index: at },
  });
  return true;
}

// The music, full screen, to play from — with this take's marks on it if there
// is one. Called by the ⤢ button and by a tap on the page.
export async function readCurrentScore() {
  if (!current) return;
  // A paired piece is read from its own pages, not from an engraving of the
  // notation behind it: the point of scanning it was that this is the copy with
  // your fingerings on it.
  if (current.paper) {
    await readPaperScore({ ...current.paper, notes: current.notes });
    return;
  }
  try {
    await openReader(current, {
      take: ready ? { aligned: ready.aligned, timing: ready.timing } : null,
      setlist: programme,
      onSetlistMove: playFromSetlist,
    });
  } catch (err) {
    status(saying('could not open that score', err), 'bad');
  }
}

export function initScoreCard({
  onPickNote, onOpenScoreTab, onScoreChanged,
} = {}) {
  scoreChanged = onScoreChanged ?? null;
  initTempoPicker();
  initScoreFullScreen(() => { readCurrentScore(); });
  // Out of the review and back to the shelf. The take is not thrown away — it
  // is still the one on screen, and opening it again from the piece brings it
  // straight back.
  el('score-review-back')?.addEventListener('click', () => showBrowser());
  onPick = onPickNote ?? null;
  openTab = onOpenScoreTab ?? null;
  const pick = el('score-pick');
  const add = el('score-add');
  const file = el('score-file');
  const remove = el('score-remove');
  if (!pick || !add || !file) return;

  pick.addEventListener('change', () => {
    const id = pick.value && pick.value !== NO_SCORE ? Number(pick.value) : null;
    chooseScore(id).catch((err) => status(err.message, 'bad'));
  });

  add.addEventListener('click', () => file.click());

  file.addEventListener('change', async () => {
    const chosen = file.files?.[0];
    file.value = ''; // so picking the same file twice still fires
    if (!chosen) return;
    try {
      await addFromFile(chosen);
    } catch (err) {
      status(saying('could not read that file', err), 'bad');
    }
  });

  for (const id of ['score-pdf', 'score-photos']) {
    el(id)?.addEventListener('change', async (e) => {
      const chosen = [...(e.target.files ?? [])];
      e.target.value = '';
      if (chosen.length === 0) return;
      try {
        await addPaper(chosen);
      } catch (err) {
        status(saying('could not read that', err), 'bad');
      }
    });
  }

  // The way out of the dead end, one tap from the words that describe it.
  el('score-pair')?.addEventListener('click', () => {
    const paperId = unpaired?.id;
    if (paperId == null) return;
    const input = el('score-notation-file');
    if (!input) return;
    input.onchange = async () => {
      const chosen = input.files?.[0];
      input.value = '';
      if (!chosen) return;
      try {
        status('reading the notation…');
        const notationId = await importNotationFor(paperId, chosen);
        if (notationId != null) {
          el('score-pair').hidden = true;
          await selectScore(paperId);   // now it can be marked up
        }
      } catch (err) {
        status(saying('could not read that file', err), 'bad');
      }
    };
    input.click();
  });

  remove.addEventListener('click', async () => {
    if (!current) return;
    const id = current.id;
    current = null;
    clearSheet();
    await deleteScore(id);
    await refreshPicker(null);
    scoreChanged?.(); // the shelf is still showing the piece that just went
    status('score removed.');
  });

  refreshPicker(null).catch(() => { /* an empty picker is a fine starting point */ });
}
