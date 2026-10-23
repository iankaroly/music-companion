import { loadRecording } from '../store/db.js';
import { answerQuestion, modelStatus, nativeModel } from '../ai/assistant.js';
import { plan } from '../ai/router.js';
import { qualityOf } from '../analysis/quality.js';
import { rhythmReport } from '../analysis/rhythm.js';

// The ask card on the Coach tab: a question about your own takes, answered from
// what the app measured.
//
// This file is the screen and nothing else. Which measurements a question needs
// is router.js, the sentences are facts.js, the wording is Apple's on-device
// model when the phone has one, and a reply that states a number the sentences
// do not is thrown away by guard.js (all of that is wired in
// ai/assistant.js). Nothing here makes a network request and nothing here is
// allowed to: the app's promise is that a recording never leaves the device,
// and a question about a recording is a recording.

const MAX_EXAMPLES = 4;

// The examples are built from what the player has, because a chip that can only
// say "there is nothing to compare" teaches them not to press the others. Each
// one is a sentence the router reads as the intent in the comment beside it —
// tests/ask-card.test.js holds every one to that, so rewording a chip cannot
// quietly turn it into a different question.
export function exampleQuestions(library) {
  const usable = (library ?? []).filter((t) => (t.noteStats?.length ?? 0) > 0);
  if (usable.length === 0) return [];
  const out = [];
  if (usable.length >= 2) out.push('How does my last take compare to the one before?'); // compare
  // "latest", not "last": the router reads "last take" as a comparison, so
  // "how did my last take go?" would load two takes and answer a different
  // question from the one the chip says.
  out.push('How did my latest take go?');                     // summary
  out.push('How is the tone and vibrato in my latest take?'); // tone (decodes audio)
  // How the take is shaped, beside the pitch questions: phrasing, articulation
  // and tempo give, read from the notes with no second decode (decodes audio).
  out.push('How is the phrasing in my latest take?');         // musicality
  out.push('Which notes am I worst at?');                     // worst
  if (usable.length >= 2) out.push('Which notes do I tend to play sharp or flat?'); // habits
  else out.push('Do I rush or drag?');                        // tempo (decodes audio)
  // Four is the most that fits; with two or more takes the worst-notes and the
  // sharp-or-flat questions fall off the end, and they are still one typed line away in two rows at 320 wide without turning the card
  // into a menu.
  return out.slice(0, MAX_EXAMPLES);
}

const frame = () => new Promise((resolve) => {
  // A background tab never fires rAF, so a timer races it rather than hanging.
  let done = false;
  const go = () => { if (!done) { done = true; resolve(); } };
  requestAnimationFrame(() => setTimeout(go, 0));
  setTimeout(go, 50);
});

function sentence(s) {
  const t = String(s ?? '').trim();
  return t.replace(/[.\s]+$/, '');
}

// What the player is told about the model, in one line. The feature works
// without it by design, so this is a quiet fact and not an apology.
export function modelLine(status) {
  if (status?.available) return 'Wording comes from Apple\'s on-device model; every number in it is checked against the measurements.';
  const why = sentence(status?.reason);
  // The reason arrives as its own sentence from the native side; joined after a
  // colon it reads better with a lower-case start, except where it opens on a
  // product name.
  const joined = why.startsWith('Apple') ? why : why.charAt(0).toLowerCase() + why.slice(1);
  return `Showing the measurements directly: ${why ? joined : 'this device can\'t run the on-device model'}.`;
}

let state = null; // { library, status, busy, token }

function el(root, id) { return root.querySelector(id); }

export async function renderAsk(root, library) {
  const card = el(root, '#ask-card');
  if (!card) return;
  const usable = (library ?? []).filter((t) => (t.noteStats?.length ?? 0) > 0);
  state ??= { library: [], status: null, busy: false, token: 0, bound: false };
  state.library = library ?? [];

  const input = el(root, '#ask-input');
  const send = el(root, '#ask-send');
  const chips = el(root, '#ask-examples');
  const empty = el(root, '#ask-empty');
  const hasTakes = usable.length > 0;

  empty.hidden = hasTakes;
  chips.hidden = !hasTakes;
  input.disabled = !hasTakes || state.busy;
  send.disabled = !hasTakes || state.busy;
  if (!hasTakes) {
    // Anything left over from a library that has since been emptied is gone
    // with it.
    el(root, '#ask-out').hidden = true;
    input.value = '';
  }

  chips.replaceChildren();
  for (const q of exampleQuestions(library)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ask-chip';
    b.textContent = q;
    b.addEventListener('click', () => {
      input.value = q;
      ask(root, q);
    });
    chips.append(b);
  }

  if (!state.bound) {
    state.bound = true;
    el(root, '#ask-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const q = input.value.trim();
      if (q) ask(root, q);
    });
  }

  // Asked once per visit, not per question: it is a plugin round trip and the
  // answer to "can this phone run it" does not change while the tab is open.
  // Awaited after the card is drawn so the tab never waits for the plugin.
  state.status = await modelStatus();
  el(root, '#ask-model').textContent = modelLine(state.status);
}

async function ask(root, question) {
  if (!state || state.busy) return;
  const input = el(root, '#ask-input');
  const send = el(root, '#ask-send');
  const out = el(root, '#ask-out');
  const say = el(root, '#ask-answer');
  const wait = el(root, '#ask-wait');
  const based = el(root, '#ask-based');
  const from = el(root, '#ask-from');
  const note = el(root, '#ask-note');
  const token = ++state.token;

  state.busy = true;
  input.disabled = true;
  send.disabled = true;
  out.hidden = false;
  out.dataset.state = 'thinking';
  say.replaceChildren();
  based.hidden = true;
  from.hidden = true;
  note.hidden = true;
  wait.hidden = false;
  wait.textContent = 'working it out…';

  // The decode is the only slow part and it is only done for the takes the plan
  // names, so the player can be told how many that is before it starts.
  // Planned INSIDE the try below, not here: plan() reads the clock, and a throw
  // out here left the card on "working it out" forever with the field held.
  // (Found by ask:card when the router's new plan(question, takes, now) met this
  // call; each branch passed alone.)
  let p = null;
  let n = 0;
  const load = async (id) => {
    n += 1;
    const t = state.library.find((x) => x.id === id);
    const who = t?.name?.trim() ? `“${t.name.trim()}”` : 'a take';
    wait.textContent = `listening back to ${who} (${n} of ${p?.takeIds.length ?? 1})…`;
    await frame();
    return loadRecording(id);
  };

  try {
    await frame();
    const now = Date.now();
    p = plan(question, state.library, now);
    const wantsAudio = p.needs.quality || p.needs.rhythm || p.needs.musicality;
    // The same model the assistant would have found, with one addition: the
    // line under the spinner changes when the measuring is done and the model
    // has the sentences, so the wait never reads "listening back" while the
    // phone is in fact writing.
    const native = await nativeModel();
    const model = native && {
      availability: () => native.availability(),
      respond: (o) => { wait.textContent = 'putting it into words…'; return native.respond(o); },
    };
    const result = await answerQuestion({
      question,
      library: state.library,
      load: wantsAudio ? load : null,
      qualityOf,
      rhythmReport,
      model,
      now,
    });
    if (token !== state.token) return; // a newer question owns the card
    show(root, result);
  } catch (err) {
    if (token !== state.token) return;
    out.dataset.state = 'error';
    wait.hidden = true;
    say.textContent = 'That did not work. Nothing was sent anywhere; try asking again.';
    note.hidden = false;
    note.textContent = String(err?.message ?? err);
  } finally {
    if (token === state.token) {
      state.busy = false;
      const has = state.library.some((t) => (t.noteStats?.length ?? 0) > 0);
      input.disabled = !has;
      send.disabled = !has;
    }
  }
}

// What the card prints, as separate lines. Pulled out of show() because the
// card went blank on EVERY refusal: show() looped result.facts for any source
// but the model, and a refusal ({ text: refusalFor(...), facts: [], source:
// 'refusal' }) has no facts, only text, so an off-topic, unmeasurable,
// unknown-take or unsupported question printed an empty box. answerQuestion
// has four result shapes and each keeps its words in a different field:
//   model         text is the wording (the facts go behind "based on")
//   measurements  the facts are the answer, one line each
//   refusal       text is the answer and facts is empty
//   neither       a sentence, never a blank
// The unit tests read result.text and never drew a refusal, and ask:card never
// asked one, so nothing saw it.
export const EMPTY_ANSWER = 'There was nothing to say about that. Nothing was sent anywhere; try asking another way.';
export function answerLines(result) {
  const facts = (result?.facts ?? []).map((f) => String(f ?? '').trim()).filter(Boolean);
  const text = String(result?.text ?? '').trim();
  if (result?.source === 'model') return [text || EMPTY_ANSWER];
  if (facts.length) return facts;
  return [text || EMPTY_ANSWER];
}

export function show(root, result) {
  const out = el(root, '#ask-out');
  const say = el(root, '#ask-answer');
  const wait = el(root, '#ask-wait');
  const based = el(root, '#ask-based');
  const list = el(root, '#ask-based-list');
  const from = el(root, '#ask-from');
  const note = el(root, '#ask-note');

  out.dataset.state = 'answer';
  wait.hidden = true;
  say.replaceChildren();
  list.replaceChildren();

  if (result.source === 'model') {
    // The model's wording is the answer; the sentences it was given sit behind
    // "based on" so the player can check it against them.
    say.textContent = answerLines(result)[0];
    for (const f of result.facts ?? []) {
      const li = document.createElement('li');
      li.textContent = f;
      list.append(li);
    }
    based.hidden = false;
    based.open = false;
    note.hidden = true;
  } else {
    // No model, its reply set aside, or a refusal: the lines ARE the answer, so
    // a "based on" list underneath would only say the same thing twice.
    for (const line of answerLines(result)) {
      const p = document.createElement('p');
      p.textContent = line;
      say.append(p);
    }
    based.hidden = true;
    // A standing "model unavailable" is already on the card's foot; only a
    // reply that was set aside or a model that failed mid-question is news.
    const standing = !state?.status?.available;
    note.hidden = standing || !result.note;
    note.textContent = result.note ? `Showing the measurements directly. ${result.note}` : '';
  }

  // Two takes of one piece share a name; "Bach prelude, Bach prelude" reads as
  // a typo, so repeats collapse to a count.
  const counts = new Map();
  for (const u of result.used ?? []) counts.set(u, (counts.get(u) ?? 0) + 1);
  const names = [...counts].map(([u, c]) => (c > 1 ? `${u} (${c} takes)` : u));
  from.hidden = names.length === 0;
  from.textContent = names.length ? `from: ${names.join(', ')}` : '';
}
