// Marking and listing passages inside a take.
//
// Marking is two taps on the chart — first note, last note — because the chart
// already owns dragging (seeking and the zoom knob), and a two-tap flow reads
// the same on a trackpad and a phone. The span is then named, and the name is
// what links today's attempt to the last one.

import { passageStats } from '../analysis/passages.js';
import { savePassage, listPassages, deletePassage } from '../store/db.js';

let marking = null;      // { first } while waiting for the second tap
let context = null;      // { root, notes, recordingId, onPlaySpan }

function statusEl() {
  return context?.root.querySelector('#passage-status');
}

function setStatus(text, isMarking = false) {
  const el = statusEl();
  if (!el) return;
  el.textContent = text;
  el.classList.toggle('marking', isMarking);
}

function formatSpan(startSec, endSec) {
  const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  return `${fmt(startSec)}–${fmt(endSec)}`;
}

function stopMarking() {
  marking = null;
  const btn = context?.root.querySelector('#mark-passage');
  if (btn) btn.textContent = 'Mark a passage';
}

// Called by the chart whenever a note is picked. Returns true if the tap was
// consumed by marking, so the caller knows not to also play the note.
export function offerNote(note) {
  if (!marking || !note) return false;
  if (!marking.first) {
    marking.first = note;
    setStatus('now tap the LAST note of the passage', true);
    return true;
  }
  const a = marking.first;
  const startSec = Math.min(a.start, note.start);
  const endSec = Math.max(a.end, note.end);
  stopMarking();
  promptForName(startSec, endSec);
  return true;
}

function promptForName(startSec, endSec) {
  const { root, notes, recordingId } = context;
  const dialog = root.querySelector('#passage-dialog');
  const input = root.querySelector('#passage-name');
  const stats = passageStats(notes, startSec, endSec);
  if (!stats) {
    setStatus('that span had no notes in it');
    return;
  }
  setStatus(`${formatSpan(startSec, endSec)} · ${stats.noteCount} notes — name it to start tracking`);

  // Offer names already in use, so "the same passage" is one keystroke away.
  listPassages().then((all) => {
    const list = root.querySelector('#passage-names');
    if (!list) return;
    const names = [...new Set(all.map((p) => p.name).filter(Boolean))];
    list.replaceChildren(...names.map((n) => {
      const opt = document.createElement('option');
      opt.value = n;
      return opt;
    }));
  }).catch(() => { /* the datalist is a convenience, not a requirement */ });

  input.value = '';
  const onClose = async () => {
    dialog.removeEventListener('close', onClose);
    const name = input.value.trim();
    if (dialog.returnValue !== 'save' || !name) {
      setStatus('');
      return;
    }
    try {
      await savePassage({ name, recordingId, startSec, endSec, stats });
      setStatus(`saved “${name}” — it'll show up in your coach`);
      refreshPassageList();
    } catch (err) {
      setStatus(`could not save that passage: ${err.message}`);
    }
  };
  dialog.addEventListener('close', onClose);
  dialog.showModal();
}

async function refreshPassageList() {
  if (!context) return;
  const { root, recordingId, onPlaySpan } = context;
  const list = root.querySelector('#passage-list');
  if (!list) return;
  let all = [];
  try {
    all = await listPassages();
  } catch { return; }
  const mine = all.filter((p) => p.recordingId === recordingId);
  list.replaceChildren();
  for (const p of mine) {
    const li = document.createElement('li');
    li.className = 'pg-item';
    const name = document.createElement('span');
    name.className = 'pg-name';
    name.textContent = p.name;
    const stat = document.createElement('span');
    stat.className = 'pg-stat';
    const cents = Number.isFinite(p.stats?.absMeanCents)
      ? `${p.stats.absMeanCents.toFixed(1)}¢`
      : '–';
    const ms = Number.isFinite(p.stats?.meanAbsMs) ? ` · ${Math.round(p.stats.meanAbsMs)}ms` : '';
    stat.textContent = `${formatSpan(p.startSec, p.endSec)} · ${cents}${ms}`;
    const play = document.createElement('button');
    play.type = 'button';
    play.textContent = 'Play';
    play.addEventListener('click', () => onPlaySpan?.(p.startSec, p.endSec));
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'pg-del';
    del.textContent = 'Delete';
    del.addEventListener('click', async () => {
      await deletePassage(p.id);
      refreshPassageList();
    });
    li.append(name, stat, play, del);
    list.append(li);
  }
}

// Wire the passage block for the take currently in the report. `recordingId`
// is null for a take that hasn't been saved yet — there'd be nothing for a
// passage to point at.
export function initPassages(root, notes, { recordingId = null, onPlaySpan } = {}) {
  context = { root, notes, recordingId, onPlaySpan };
  marking = null;

  const section = root.querySelector('#passages');
  const btn = root.querySelector('#mark-passage');
  if (!section || !btn) return;
  section.hidden = false;
  btn.textContent = 'Mark a passage';

  if (recordingId === null) {
    btn.disabled = true;
    setStatus('save this take to the library first, then you can mark passages in it');
    root.querySelector('#passage-list')?.replaceChildren();
    return;
  }
  btn.disabled = false;
  setStatus('');

  btn.onclick = () => {
    if (marking) {
      stopMarking();
      setStatus('');
      return;
    }
    marking = { first: null };
    btn.textContent = 'Cancel';
    setStatus('tap the FIRST note of the passage on the graph', true);
  };

  refreshPassageList();
}

export function hidePassages(root) {
  marking = null;
  context = null;
  const section = root.querySelector('#passages');
  if (section) section.hidden = true;
}
