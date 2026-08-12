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
import { readScoreFile } from '../analysis/mxl.js';
import { alignScore } from '../analysis/align-score.js';
import { scoreTiming } from '../analysis/score-timing.js';
import { noteLanding } from '../analysis/landing.js';
import { showScore, paint } from './score-view.js';
import { openReader } from './reader.js';
import { intonationBounds } from './chart-utils.js';
import { takeStats } from '../analysis/score-history.js';
import {
  mountScore, follow, stopFollowing, clearScoreTab, showReviewCard, showBrowser,
  syncDockVisibility, borrowPanel, scoreTabIsShowing, initScoreFullScreen,
} from './score-tab.js';
import {
  saveScore, savePagesScore, listScores, loadScore, deleteScore, setRecordingScore,
  pairScoreNotation, loadScorePages, saveScoreLayout,
} from '../store/db.js';
import {
  isPdf, isImage, sniffPdf, sniffImage, nameFromFile, pdfPageCount, readPages, pdfTrouble,
} from './paper.js';
import { openScanner } from './scanner.js';

let current = null;   // { id, name, xml, partIndex, notes }
let view = null;      // the rendered page, if one is up
let onPick = null;    // hand a chosen note back to the report
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
  const parsed = parseScore(row.xml, { partIndex: row.partIndex ?? 0 });
  const part = parsed.parts[row.partIndex ?? 0];
  if (part?.staves > 1) {
    throw new Error(`"${part.name}" is written on ${part.staves} staves — this reads one line at a time`);
  }
  if (parsed.notes.length === 0) throw new Error('that part has no notes in it');
  current = { ...row, notes: parsed.notes, parsed };
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
        // A scan with no notation behind it is no longer a dead end. It cannot
        // be told which note is WRITTEN — that is optical music recognition and
        // it does not run in a browser — but the page has been read for where
        // its noteheads are, and how in tune you played comes from the audio.
        // So the take attaches to the piece and is marked onto the photograph;
        // only "you played the wrong note" is missing, and the offer to add
        // notation and get that too stays on the card.
        current = { ...row, paper: row, notes: [], plain: true };
        unpaired = row;
        showReviewCard(false);
        el('score-pair').hidden = false;
        el('score-remove').hidden = false;
        scoreChanged?.();
        status(`${row.name} — record and your playing is marked onto the scan, note by note.`
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
async function addPaper(files, { name: given = null } = {}) {
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
    const { straightenFile } = await import('./straighten.js');
    const flattened = [];
    // A page that cannot be decoded is refused HERE, before anything is
    // written, and named while the player still knows which one it was. It used
    // to be stored anyway and the score simply would not open afterwards.
    const refused = [];
    for (const [at, file] of pages.entries()) {
      status(`straightening ${pages.length === 1 ? 'the page' : `page ${at + 1} of ${pages.length}`}…`);
      try {
        flattened.push(await straightenFile(file));
      } catch (err) {
        refused.push(`page ${at + 1}: ${err.message}`);
      }
    }
    if (flattened.length === 0) throw new Error(refused[0] ?? 'those pages could not be read');
    id = await savePagesScore({
      name: given ?? nameFromFile(pages[0]), source: 'photos', pageCount: flattened.length,
      pages: flattened,
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
  await readPaperScore(row);
  // And then, quietly, read the SHAPE of the pages — where the staves, bars and
  // noteheads are. It is what lets a take be marked onto a photograph, it takes
  // about a second a page, and nothing waits for it.
  measurePages(id, { note: trouble })
    .catch(() => { /* an unreadable scan is still a readable score */ });
  return id;
}

// Reading the geometry of a scan, in the background, and remembering it.
export async function measurePages(scoreId, { note = null } = {}) {
  const payload = await loadScorePages(scoreId);
  if (!payload) return null;
  const layout = await readPages(payload, (page, total) => {
    status(`reading the pages… ${page + 1} of ${total}`);
  });
  await saveScoreLayout(scoreId, layout);
  const found = layout.filter(Boolean).length;
  const heads = layout.filter(Boolean)
    .reduce((n, page) => n + page.staves.reduce((m, st) => m + st.heads.length, 0), 0);
  // A page that was refused on the way in outlives this narration: it is the
  // thing the player has to do something about, and the note count is not.
  status(note ?? (found
    ? `read ${found} of ${layout.length} ${layout.length === 1 ? 'page' : 'pages'}`
      + ` — ${heads} notes found, so your playing can be marked onto them`
    : 'the music on those pages could not be made out — they are still yours to read from'),
  note ? 'bad' : '');
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
    status(`could not open that score: ${err.message}`, 'bad');
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
    if (!taken?.length) return null;
    // Named on the way in. A shelf of "Scanned score", "Scanned score 2" is a
    // shelf you cannot read, and the moment you have just photographed the
    // thing is the moment you know what it is called.
    const name = await askScoreName(`${taken.length} ${taken.length === 1 ? 'page' : 'pages'} scanned`);
    return await addPaper(taken, { name: name || 'Scanned score' });
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
  // The colours ARE the cents, so the legend says cents. "A little sharp" is a
  // word for a number the app already knows, and the number is the thing you
  // can check against the tuner. The boundaries come from the live setting, so
  // changing the in-tune tolerance changes what the legend claims.
  const { good, badly } = intonationBounds();
  const swatch = (token, label) => `<span><b style="color:var(${token})">■</b> ${label}</span>`;
  row.innerHTML = [
    swatch('--good', `within ${good}¢`),
    swatch('--off', `${good}–${badly}¢ sharp`),
    swatch('--bad', `over ${badly}¢ sharp`),
    swatch('--flat-off', `${good}–${badly}¢ flat`),
    swatch('--flat-bad', `over ${badly}¢ flat`),
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
function showScanReview(notes) {
  const played = notes ?? [];
  const title = el('score-review-title');
  if (title) title.textContent = current.name ?? '';
  const summary = el('score-tab-summary');
  if (summary) {
    const off = played.length
      ? played.reduce((sum, n) => sum + Math.abs(n.cents ?? 0), 0) / played.length
      : 0;
    summary.textContent = played.length
      ? `${played.length} ${played.length === 1 ? 'note' : 'notes'}, `
        + `${off.toFixed(1)}¢ from centre on average. Open the score to see them on the page.`
      : 'Nothing was heard in that take.';
  }
  const stage = el('score-stage');
  if (stage) {
    const open = document.createElement('button');
    open.className = 'ctl primary';
    open.type = 'button';
    open.textContent = 'Open the score →';
    open.addEventListener('click', () => readCurrentScore());
    stage.replaceChildren(open);
  }
  const tempo = el('score-tempo-row');
  if (tempo) tempo.hidden = true;    // there is no written tempo to play against
  showReviewCard(true);
}

// Called on Stop, and when a saved take is reopened.
export async function annotateTake(notes, { readings = null, a4 = 440, recordingId = null } = {}) {
  pending = { notes, readings, a4, recordingId };
  if (!current) return null;
  // A scan on its own: there is nothing to line the take up AGAINST, so nothing
  // is aligned. The take is remembered, and the reader draws what the audio
  // proved onto the noteheads the page reader found.
  if (current.plain) {
    // A scan has nothing to line the take up against, but it does have a page
    // with noteheads on it — so the Score tab says what was played and offers
    // the page, rather than leaving the take looking like it went nowhere.
    showScanReview(notes);
    status(`${current.name} — open the score to see your playing on the page.`);
    return null;
  }
  const sheet = el('score-sheet');
  if (!sheet) return null;

  resetSheet();
  sheet.hidden = false;
  status(`lining ${current.name} up with what you played…`);

  const aligned = alignScore(notes, current.notes);
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

// Engrave and mark up the page. Called the first time the Score tab is shown,
// because only then does its panel have a width to lay the music out to.
export async function renderScoreTab() {
  if (!current || !ready) return null;
  if (view) return view; // already drawn for this take

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
    });
  } catch (err) {
    view = null;
    stage.replaceChildren();
    status(`could not engrave that score: ${err.message}`, 'bad');
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
  // parse, no part to choose and no review to open. Straight to the reader.
  if (row.kind === 'pages') {
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
    status(`could not open that score: ${err.message}`, 'bad');
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
      status(`could not read that file: ${err.message}`, 'bad');
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
        status(`could not read that: ${err.message}`, 'bad');
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
        status(`could not read that file: ${err.message}`, 'bad');
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
