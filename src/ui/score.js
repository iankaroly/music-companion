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
import { saveScore, listScores, loadScore, deleteScore } from '../store/db.js';

let current = null;   // { id, name, xml, partIndex, notes }
let view = null;      // the rendered page, if one is up
let onPick = null;    // hand a chosen note back to the report

function el(id) { return document.querySelector(`#${id}`); }

function status(message, tone = '') {
  const hint = el('score-hint');
  if (!hint) return;
  hint.textContent = message;
  hint.dataset.tone = tone;
}

export function currentScoreId() {
  return current?.id ?? null;
}

async function refreshPicker(selectedId = null) {
  const pick = el('score-pick');
  if (!pick) return;
  const scores = await listScores();
  pick.replaceChildren();
  const none = document.createElement('option');
  none.value = '';
  none.textContent = 'no score';
  pick.append(none);
  for (const score of scores) {
    const option = document.createElement('option');
    option.value = String(score.id);
    option.textContent = score.name;
    pick.append(option);
  }
  pick.value = selectedId === null ? '' : String(selectedId);
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

async function chooseScore(id) {
  clearSheet();
  if (!id) {
    current = null;
    el('score-remove').hidden = true;
    status('MusicXML or .mxl — export one from MuseScore, or download it from IMSLP. Your playing is marked onto it when you stop.');
    return;
  }
  const row = await loadScore(id);
  if (!row) return;
  try {
    await adopt(row);
    el('score-remove').hidden = false;
    status(`${current.name} — ${current.notes.length} notes. Record, and it will be marked up when you stop.`);
  } catch (err) {
    current = null;
    status(err.message, 'bad');
  }
}

async function addFromFile(file) {
  status(`reading ${file.name}…`);
  const xml = await readScoreFile(await file.arrayBuffer(), file.name);
  const parsed = parseScore(xml);
  // Multi-part files are common (a duet, a piano reduction). Take the first
  // single-staff part, which for a part-book is the only one there is.
  const partIndex = Math.max(0, parsed.parts.findIndex((p) => p.staves === 1));
  const name = parsed.title || file.name.replace(/\.(musicxml|xml|mxl)$/i, '');
  const id = await saveScore({ name, xml, partIndex, parts: parsed.parts });
  await refreshPicker(id);
  await chooseScore(id);
}

export function clearSheet() {
  view?.destroy?.();
  view = null;
  const sheet = el('score-sheet');
  if (sheet) {
    sheet.replaceChildren();
    sheet.hidden = true;
  }
  el('score-summary')?.remove();
  el('score-legend')?.remove();
}

// One plain sentence before the page, because a wall of coloured noteheads is
// not an answer on its own.
function summarise(aligned, timing) {
  const played = aligned.attempts.filter((a) => a.played);
  if (played.length === 0) return 'None of that take lined up with this score.';

  const parts = [];
  const inTune = played.filter((a) => a.verdict === 'match').length;
  parts.push(`${inTune} of ${aligned.attempts.length - aligned.notTaken} notes landed on the written pitch`);
  if (aligned.wrong) parts.push(`${aligned.wrong} came out as a different note`);
  if (aligned.missed) parts.push(`${aligned.missed} never sounded`);
  if (aligned.notTaken) parts.push('the repeat was not taken');

  let sentence = `${parts.join(', ')}.`;
  if (timing?.bpm) {
    const off = timing.perNote.filter((n) => n.verdict === 'late' || n.verdict === 'early').length;
    sentence += ` You played at about ${Math.round(timing.bpm)} bpm`;
    sentence += off === 0 ? ', and every entry was on the beat.' : `, with ${off} ${off === 1 ? 'entry' : 'entries'} off the beat.`;
  }
  return sentence;
}

function legend(sheet) {
  const row = document.createElement('div');
  row.id = 'score-legend';
  row.innerHTML = [
    '<span><b style="color:var(--good)">■</b> in tune</span>',
    '<span><b style="color:var(--off)">■</b> slightly off</span>',
    '<span><b style="color:var(--bad)">■</b> badly off, or the wrong note</span>',
    '<span><b style="color:var(--muted)">■</b> never sounded</span>',
    '<span><b style="color:var(--bad)">›</b> came in late</span>',
    '<span><b style="color:var(--off)">‹</b> came in early</span>',
    '<span><b style="color:var(--primary)">↗</b> arrived flat and corrected</span>',
  ].join('');
  sheet.after(row);
}

// Called on Stop, and when a saved take is reopened.
export async function annotateTake(notes, { readings = null, a4 = 440 } = {}) {
  if (!current) return null;
  const sheet = el('score-sheet');
  if (!sheet) return null;

  sheet.hidden = false;
  status(`lining ${current.name} up with what you played…`);

  const aligned = alignScore(notes, current.notes);
  const timing = scoreTiming(aligned.attempts);

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

  try {
    view = await showScore(sheet, {
      xml: current.xml,
      scoreNotes: current.notes,
      partIndex: current.partIndex ?? 0,
      aligned,
      timing,
      landings,
      onPickNote: (attempt) => onPick?.(attempt.played),
    });
  } catch (err) {
    clearSheet();
    status(`could not engrave that score: ${err.message}`, 'bad');
    return null;
  }

  // An annotation on the wrong notehead is worse than no annotation, so if the
  // two readings of the file do not line up completely, the page is shown
  // plain and says so rather than quietly marking the wrong notes.
  if (!view.ok) {
    paint(view, { aligned: { byNote: new Map(), latest: new Map() } });
    status(`${view.unmatched.length} notes on the page could not be matched to the analysis, so this score is shown unmarked. The charts below still have the take in full.`, 'bad');
    return { aligned, timing, annotated: false };
  }

  const summary = document.createElement('p');
  summary.id = 'score-summary';
  summary.textContent = summarise(aligned, timing);
  sheet.before(summary);
  legend(sheet);
  status(`${current.name} — tap a notehead to hear it back.`);

  return { aligned, timing, annotated: true };
}

export function initScoreCard({ onPickNote } = {}) {
  onPick = onPickNote ?? null;
  const pick = el('score-pick');
  const add = el('score-add');
  const file = el('score-file');
  const remove = el('score-remove');
  if (!pick || !add || !file) return;

  pick.addEventListener('change', () => {
    const id = pick.value ? Number(pick.value) : null;
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

  remove.addEventListener('click', async () => {
    if (!current) return;
    const id = current.id;
    current = null;
    clearSheet();
    await deleteScore(id);
    await refreshPicker(null);
    status('score removed.');
  });

  refreshPicker(null).catch(() => { /* an empty picker is a fine starting point */ });
}
