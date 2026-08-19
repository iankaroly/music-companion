// The question box: a button on the right edge, and a chat that pops out of it.
//
// It started as a card at the bottom of a take's review, which is where the
// answer belongs but not where the question gets asked from — you scroll past
// the chart, the timing and the landing to reach it, and a question you have
// while looking at the chart is a question you have stopped having by the time
// the box is on screen. So it floats: reachable from anywhere, out of the way
// until it is wanted, and closed by pressing anything else.
//
// It is off until the player turns it on, and it is the only part of this app
// that sends anything off the device — see the hint under "Ask about a take" in
// the settings sheet, and the note at the top of src/ai/ask-handler.js about
// exactly what goes.
//
// What it sends is the DIGEST, not the recording: there is no audio content
// block in the Messages API, so a model cannot listen to a take however it is
// packaged. It reads what this app already measured, which is a great deal more
// precise about pitch and timing than any general audio model — and completely
// silent about tone, which is why the system prompt makes it say so.
import { digestTake, digestLibrary } from '../ai/digest.js';
import { askEnabled, readTolerance } from './settings.js';
import { listRecordings } from '../store/db.js';

const ENDPOINT = '/api/ask';

// The take on the screen, if there is one. Set by the review; read at the
// moment of asking, so nothing is digested for a question nobody asks.
let context = null;
let history = [];
let fab = null;
let pop = null;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function svg(paths, { fill = 'none' } = {}) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  node.setAttribute('viewBox', '0 0 24 24');
  node.setAttribute('fill', fill);
  node.setAttribute('stroke', 'currentColor');
  node.setAttribute('stroke-width', '1.9');
  node.setAttribute('stroke-linecap', 'round');
  node.setAttribute('stroke-linejoin', 'round');
  node.innerHTML = paths;
  return node;
}

function bubble(list, role, text) {
  const row = el('div', `ask-turn ask-${role}`);
  row.appendChild(el('div', 'ask-bubble', text));
  list.appendChild(row);
  list.scrollTop = list.scrollHeight;
  return row.firstChild;
}

// The one-line-per-take index of the library, so "is this better than last
// week" is answerable. Read from the META records only — no take's audio is
// decoded and no take's notes are loaded — and read at the moment of asking,
// because a take saved since the panel opened belongs in the answer.
async function libraryDigest() {
  try {
    return digestLibrary(await listRecordings());
  } catch {
    // A library that will not open is not a reason to refuse the question:
    // the take on the screen answers most of them on its own.
    return '';
  }
}

async function send(question) {
  const list = pop.querySelector('.ask-log');
  const field = pop.querySelector('.ask-field');
  const button = pop.querySelector('.ask-send');

  bubble(list, 'you', question);
  const answer = bubble(list, 'app', '…');
  button.disabled = true;

  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        question,
        digest: context ? digestTake({ ...context, tolerance: readTolerance() }) : '',
        library: await libraryDigest(),
        history: history.slice(-10),
      }),
    });
    if (!response.ok || !response.body) {
      answer.textContent = await response.text()
        || `The question could not be answered (${response.status}).`;
      answer.classList.add('ask-failed');
      return;
    }
    // Streamed as plain text, so the words appear as they are written rather
    // than after a silence long enough to look broken.
    const reader = response.body.getReader();
    const decode = new TextDecoder();
    let full = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      full += decode.decode(value, { stream: true });
      answer.textContent = full;
      list.scrollTop = list.scrollHeight;
    }
    history.push({ role: 'user', content: question }, { role: 'assistant', content: full });
  } catch (err) {
    answer.textContent = `The question could not be sent: ${err.message}`;
    answer.classList.add('ask-failed');
  } finally {
    button.disabled = false;
    field.disabled = false;
    field.focus();
  }
}

// What the panel says it is looking at. It changes with the take, because
// "reads this take" is a promise the panel cannot keep when no take is open —
// and a player who asks about a recording that is not on the screen should be
// told what was actually read instead of getting a confident answer about
// something else.
function describe() {
  const note = pop?.querySelector('.ask-note');
  const field = pop?.querySelector('.ask-field');
  if (!note) return;
  if (context) {
    note.textContent = 'Reads the take on screen — every note\'s pitch and timing — and the list of your saved takes. It has not heard the recording, so it can say nothing about tone.';
    field.placeholder = 'Which notes went flat?';
  } else {
    note.textContent = 'No take is open, so this reads the list of your saved takes. Open one to ask about its notes.';
    field.placeholder = 'How has my intonation moved this month?';
  }
}

function open() {
  pop.hidden = false;
  fab.setAttribute('aria-expanded', 'true');
  describe();
  pop.querySelector('.ask-field').focus();
}

function close() {
  pop.hidden = true;
  fab.setAttribute('aria-expanded', 'false');
}

function build(doc) {
  fab = el('button', 'ask-fab');
  fab.id = 'ask-fab';
  fab.type = 'button';
  fab.setAttribute('aria-label', 'Ask about your playing');
  fab.setAttribute('aria-expanded', 'false');
  // A speech bubble with a note in it: the two things this is.
  fab.appendChild(svg('<path d="M20.5 11.7c0 3.9-3.8 7-8.5 7-1 0-2-.15-2.9-.42L4 20l1.4-3.4A6.6 6.6 0 0 1 3.5 11.7c0-3.9 3.8-7 8.5-7s8.5 3.1 8.5 7Z" /><circle cx="10.4" cy="13" r="1.5" fill="currentColor" stroke="none" /><path d="M11.9 13V8.3l3.4 1" />'));

  pop = el('div', 'ask-pop');
  pop.id = 'ask-pop';
  pop.hidden = true;
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', 'Ask about your playing');

  const head = el('div', 'ask-head');
  head.appendChild(el('span', 'timing-title', 'ask'));
  const shut = el('button', 'ask-close');
  shut.type = 'button';
  shut.setAttribute('aria-label', 'Close');
  shut.appendChild(svg('<path d="M6 6 l12 12 M18 6 l-12 12" />'));
  head.appendChild(shut);
  pop.appendChild(head);

  pop.appendChild(el('p', 'ask-note', ''));
  pop.appendChild(el('div', 'ask-log'));

  const row = el('div', 'ask-row');
  const field = el('textarea', 'ask-field');
  field.rows = 1;
  field.setAttribute('aria-label', 'Ask about your playing');
  const button = el('button', 'ctl primary ask-send', 'Ask');
  button.type = 'button';
  row.append(field, button);
  pop.appendChild(row);

  const ask = () => {
    const question = field.value.trim();
    // The button's own disabled state is what says a question is in flight,
    // rather than a variable outside the panel: a panel torn down mid-answer —
    // the setting turned off, the app reloaded — used to leave that variable
    // true and the NEXT panel refusing every question silently.
    if (!question || button.disabled) return;
    field.value = '';
    send(question);
  };
  button.addEventListener('click', ask);
  field.addEventListener('keydown', (e) => {
    // Enter asks; shift-enter is a newline, because a question can be two lines.
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(); }
  });

  fab.addEventListener('click', () => (pop.hidden ? open() : close()));
  shut.addEventListener('click', close);

  // Anything else closes it. A chat that has to be dismissed by its own button
  // is a chat sitting over the notes you opened it to look at.
  doc.addEventListener('pointerdown', (e) => {
    if (pop.hidden) return;
    if (pop.contains(e.target) || fab.contains(e.target)) return;
    close();
  });
  doc.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !pop.hidden) { close(); fab.focus(); }
  });

  doc.body.append(fab, pop);
}

// Show or hide the whole thing, following the setting live: turning it off in
// the sheet takes the button away without a reload, which is what a privacy
// switch has to do to be believed.
function follow() {
  const on = askEnabled();
  fab.hidden = !on;
  if (!on) close();
}

/**
 * Builds the button and the chat, once, and keeps them following the setting.
 * Called from main.js after the settings sheet is initialised.
 */
export function initAsk(doc = document) {
  if (fab) return;
  build(doc);
  follow();
  doc.addEventListener('settings-change', (e) => {
    if (e.detail?.key === 'askEnabled') follow();
  });
}

// Which take is on the screen. A saved take has an id; an unsaved one has
// nothing, and keying every unsaved take as "unsaved" meant the second take of
// a session inherited the transcript of the first — the model answering about a
// recording that had been replaced. The fallback fingerprints the notes
// instead: stable across the several re-renders of one review, different for
// any other take.
function identify(take) {
  if (!take?.notes?.length) return 'none';
  if (take.key && take.key !== 'unsaved') return String(take.key);
  const notes = take.notes;
  const first = notes[0];
  const last = notes.at(-1);
  return `take:${notes.length}:${first?.start?.toFixed(3)}:${last?.end?.toFixed(3)}:${first?.midi}`;
}

/**
 * Tells the chat which take is on the screen — or none, when a review closes.
 *
 * Called on every render of a review, so it must be cheap: it is, because
 * nothing is digested until a question is actually asked.
 */
export function setAskTake(take) {
  if (!fab) return;
  const key = identify(take);
  context = key === 'none' ? null : take;
  if (fab.dataset.take !== key) {
    // A different take is a different conversation. Comparing this take with
    // the last one is a fair question, but it has to be asked, not inherited
    // from a transcript about a recording that is no longer on the screen.
    fab.dataset.take = key;
    history = [];
    pop.querySelector('.ask-log').replaceChildren();
    describe();
  }
}
