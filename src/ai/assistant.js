// Ask a question about your playing and get an answer built from what the app
// measured.
//
// The order matters and is the point of the design:
//   1. rules pick the measurements the question needs (router.js)
//   2. plain code computes them into sentences (facts.js)
//   3. a language model, if the device has one, puts them into words
//   4. the reply is checked against the sentences and dropped if it states
//      anything they do not (guard.js)
// Step 3 is optional. Without a model — a browser, an older phone, a device
// with Apple Intelligence off — the player gets step 2 as it stands. The
// numbers are never the model's.

import { plan, intentsOf } from './router.js';
import { factsFor } from './facts.js';
import { checkReply, stripScopeTags } from './guard.js';
import { musicalityOf } from '../analysis/musicality.js';
import { MUSICALITY_INSTRUCTION } from './musicality-facts.js';
import { instrument, instrumentChosen } from '../analysis/instruments.js';

// Rewritten after running the eval questions through the real on-device model
// (tools/ai-model/README.md). What the first wording did at temperature 0, and
// which line below answers it:
//   - "9¢ sharp on average over 6 times" is one note's figure; it came back as
//     the whole take's ("your last take was 9¢ sharp over 6 times")
//   - playing called "good", "not good", "in tune", "went well" on no evidence
//   - its own subtraction ("90 ms faster" from 140 and 90, "18¢ wider")
//   - a steadier tone and a closer vibrato invented for a question about progress
// Rules alone moved little; examples did, with two costs found by running them.
// An example laid out like the prompt (MEASUREMENTS: / QUESTION:) made the model
// print the prompt back before its answer in 11 of 104 replies, so the examples
// are prose. And a figure inside a rule or example is a figure the model copies
// into an answer where it does not belong ("over 6 times" turned up in answers
// about a different habit), so the examples use numbers no real measurement
// produces and the rules quote none.
export const INSTRUCTIONS = [
  'You are the practice coach inside a music practice app. A player asked a question about their own recordings.',
  'You are given MEASUREMENTS written by the app. Answer the QUESTION using only those, in one to three short plain sentences. Start with the answer. Never repeat the measurements list or the question.',
  'Reuse the wording of the measurement sentences and change as little as you can. Pick the ones that answer the question. Never turn a figure into a different claim.',
  'Copy each figure exactly as written, with its unit and the words it belongs to. Never add, subtract, round or compare numbers yourself. When something changed, give the two figures, "from this to that", never the difference.',
  'A figure about one note belongs to that note. The take as a whole has its own figure. Never give a note\'s figure as the take\'s.',
  'Never say the playing is good, bad, fine, ok, well, correct, in tune or out of tune. Give the figures and let the player judge.',
  'Say "not measured" only when no measurement is about the thing asked. If one is, use it.',
  'Do not repeat an instrument, key, piece or day from the question unless the measurements contain it.',
  'Example: the measurements say an etude was 31¢ off pitch on average with 20% of notes within 10¢, and its furthest note was E4, 44¢ sharp on average over 3 times. Asked "how was my last take" or "was the etude any good", you answer: "The etude was 31¢ off pitch on average, and 20% of notes were within 10¢. Its furthest note was E4, 44¢ sharp."',
].join('\n');

// The standing rules, plus the musicality rule only when shaping facts are in
// the prompt: it forbids "more musical" and advice about taste, which would be
// noise in an answer about pitch.
export function instructionsFor(intents = []) {
  // A comparison is never worded by the model (see modelMaySpeak), so only a
  // question about one take's shaping needs the shaping rule.
  const shaping = intents.includes('musicality');
  return shaping ? `${INSTRUCTIONS}\n${MUSICALITY_INSTRUCTION}` : INSTRUCTIONS;
}

// A tag on the facts that a small model confuses, saying which part of the
// playing the sentence is about. Digit-free on purpose (the guard reads the
// reply against the facts, never the prompt, so a tag cannot make a number
// legal). Found by running the real model: given "The note furthest from pitch
// was D3, 9¢ sharp on average over 6 times." after the take's own average, it
// answered "how was my last take" with "Your last take was 9¢ sharp on average
// over 6 times" in 7 of 104 replies, through five rewrites of the instructions.
export function scopeTag(fact) {
  if (/notes heard/.test(fact)) return '[the whole take] ';
  if (/^The note furthest from pitch was/.test(fact)) return '[one note only] ';
  if (/^[A-G][#b]?\d moved from/.test(fact)) return '[one note only] ';
  return '';
}

// Whether the model is asked at all. The guard reads a reply against the
// sentences it was given as a bag of words and numbers, and it cannot tell which
// TAKE a claim is about: "The Oct 14 take is 13¢ closer" passes when it is the
// Oct 19 take, because both dates and the 13 are in the facts. A skeptic's ~160
// false replies got ~60% through it, and the swapped-take ones were the biggest
// group. With one take's measurements in the prompt there is nothing to swap, so
// the model words those; anything built from several takes (a comparison, a
// trend, a habit over the library, "my last 3 takes") is the sentences as the
// code wrote them. Decided from how many takes the facts were built from
// (factsFor), not from how many the player named.
export function modelMaySpeak(takesInFacts) {
  return !(takesInFacts > 1);
}

// Said in the app's own voice, and plainly: nothing went wrong, this kind of
// question is simply not worded by the model.
export const SEVERAL_TAKES_NOTE = 'This question is about more than one take, so the answer is written by the app from the measurements. The on-device model words answers about a single take.';

export function promptFor(question, facts) {
  return `MEASUREMENTS:\n${facts.map((f) => `- ${scopeTag(f)}${f}`).join('\n')}\n\nQUESTION: ${question}\n\nAnswer in one to three sentences, only from the measurements above.`;
}

// The on-device model reads 4096 tokens in all, prompt and reply together
// (SystemLanguageModel.contextSize). Measured here with the real model on
// facts repeated to length: a 8877-character instructions-plus-prompt (2970
// tokens) answered, a 12459-character one (4230 tokens) came back as
// exceededContextWindowSize in under a second. The longest real prompt in the
// 156 eval questions is 3181 characters (867 tokens). The budget sits between,
// with room for the reply, and what is over it is shown as the plain
// measurements instead of being sent to fail.
export const MAX_PROMPT_CHARS = 7000;

// A reply that is not a finished answer, whatever its numbers say. The plugin
// caps the reply length, because one question ("which bars should I work on",
// asked of a take with no score) ran the model for 49 s counting bars up to the
// end of the window; the cap cuts such a reply off mid-sentence. And a reply
// that begins by printing the prompt back is the instructions talking, not an
// answer.
export function unfinished(text) {
  if (/MEASUREMENTS:|QUESTION:|ANSWER:/.test(text)) return 'the reply repeated the prompt';
  if (!/[.!?)"”]$/.test(text)) return 'the reply was cut off';
  return '';
}

// The native model, if this build has one. Loaded on demand so the web bundle
// and every browser that will never have it do not carry the plugin.
let native = null;
export async function nativeModel() {
  if (native) return native;
  try {
    if (!globalThis.Capacitor?.isNativePlatform?.()) return null;
    const { registerPlugin } = await import('@capacitor/core');
    const plugin = registerPlugin('StandPartnerAI');
    // NOT `return plugin`. A Capacitor plugin is a Proxy that answers EVERY
    // property with a method, `then` included, so handing it back from an async
    // function makes the promise treat it as a thenable and wait on a `then`
    // that never settles: `await nativeModel()` hung forever and no question
    // was ever answered. Found by tools/ask-check.mjs, which runs the real
    // registerPlugin against a stand-in for the native bridge; the unit tests
    // pass a plain object as the model and could not see it. A plain wrapper
    // has no `then`.
    native = {
      availability: (...a) => plugin.availability(...a),
      respond: (...a) => plugin.respond(...a),
    };
    return native;
  } catch {
    return null;
  }
}

export async function modelStatus(model = null) {
  try {
    const m = model ?? await nativeModel();
    if (!m) return { available: false, reason: 'This device cannot run the on-device model.' };
    const s = await m.availability();
    return { available: !!s?.available, reason: s?.reason ?? '' };
  } catch (err) {
    return { available: false, reason: String(err?.message ?? err) };
  }
}

// The whole round trip. `load(id)` returns { notes, readings, audio?, sampleRate?, a4? }
// for a stored take; it is only called for the takes the question is about and
// only when the plan needs the audio-derived measurements.
// What the player is told when the question is not one the app can answer from
// its measurements. Written here, in code, and never by the model: a model asked
// "what is the capital of France" answers it, and one asked "is my tone
// beautiful" gives an opinion it has no way to hold. The sentence is short and
// says what the app CAN be asked, so the refusal is also the way back in.
// No digits in any of them, so the guard's rule about numbers has nothing to say.
const ASKABLE = 'Try asking how your last take went, which notes are your weakest, or how it compares with the one before.';
export function refusalFor(scope = {}) {
  const base = 'I can only answer from what the app measured in your takes';
  if (scope.kind === 'unmeasurable') {
    return `${base}, and that is not something it measures. It can tell you how in tune, how steady, how even in time and how loud a take was, and what its vibrato and tone clarity measured; whether the playing is beautiful, expressive or right is for you and your teacher. ${ASKABLE}`;
  }
  if (scope.kind === 'unsupported') {
    return `${base}, and ranking all of your takes against each other is not something it does yet. Ask about one take, or compare two of them. ${ASKABLE}`;
  }
  if (scope.kind === 'notfound') {
    const label = String(scope.label ?? '').replace(/["\r\n]/g, ' ').trim().slice(0, 40);
    return `${base}, and I could not find ${label ? `"${label}"` : 'that take'} in your library. ${ASKABLE}`;
  }
  return `${base}. That question is not about them. ${ASKABLE}`;
}

// The range a take's notes are held to, so musicalityOf can say a take was heard
// in the wrong octave (its reliability check is silent without one). A stored
// take carries no instrument, and the family is one setting for the whole app, so
// the range is, in order: one the take itself carries, the chosen family's, and
// the widest any instrument here reaches (a piano's A0 to C8), which no
// legitimate take of any instrument leaves. The family ranges are deliberately
// generous (a family is many instruments: strings runs from a bass's E1 to a
// violin's G7), because a net that flags a real take lowers every confidence in
// its facts and says the pitch was mis-heard.
export const GENERIC_RANGE = { lowMidi: 21, highMidi: 108 };
const FAMILY_RANGE = {
  strings: { lowMidi: 28, highMidi: 103 },
  winds: { lowMidi: 34, highMidi: 108 },
  brass: { lowMidi: 28, highMidi: 96 },
  voice: { lowMidi: 36, highMidi: 88 },
  keys: GENERIC_RANGE,
};
export function rangeFor(data = {}) {
  const own = data?.range;
  if (Number.isFinite(own?.lowMidi) && Number.isFinite(own?.highMidi)) return own;
  try {
    if (!instrumentChosen()) return GENERIC_RANGE;
    return FAMILY_RANGE[instrument().id] ?? GENERIC_RANGE;
  } catch {
    return GENERIC_RANGE;
  }
}

export async function answerQuestion({ question, library, load, qualityOf, rhythmReport, model = null, now = Date.now() }) {
  const p = plan(question, library, now);
  if (p.scope && ['offtopic', 'unmeasurable', 'unsupported', 'notfound'].includes(p.scope.kind)) {
    // Nothing is loaded and no model is asked: the refusal is the whole answer.
    return { text: refusalFor(p.scope), facts: [], used: [], source: 'refusal', note: '', scope: p.scope.kind };
  }
  const byId = new Map(library.map((t) => [t.id, t]));
  const chosen = p.takeIds.map((id) => byId.get(id)).filter(Boolean).map((t) => ({ ...t }));

  // One load per take, then everything the plan needs is computed from that one
  // decode: tone from the audio, shaping and pulse from the notes and readings.
  if ((p.needs.quality || p.needs.rhythm || p.needs.musicality) && load) {
    for (const t of chosen) {
      try {
        const data = await load(t.id);
        if (!data) continue;
        if (p.needs.quality && qualityOf) {
          t.quality = qualityOf({ notes: data.notes, readings: data.readings, audio: data.samples ?? null, sampleRate: data.sampleRate, a4: data.a4 ?? 440 });
        }
        if (p.needs.rhythm && rhythmReport) t.rhythm = rhythmReport(data.notes);
        if (p.needs.musicality) t.musicality = musicalityOf({ notes: data.notes, readings: data.readings, a4: data.a4 ?? 440, range: rangeFor(data) });
      } catch { /* an unreadable take just has no tone or rhythm facts */ }
    }
  }

  const { facts, used, takesInFacts } = factsFor({ question, intents: p.intents, chosen, all: library, now });
  const plain = facts.join(' ');

  const m = model ?? await nativeModel();
  const status = await modelStatus(m);
  if (!status.available || chosen.length === 0) {
    return { text: plain, facts, used, source: 'measurements', note: status.available ? '' : status.reason };
  }
  // Decided before the prompt is built or the model is touched.
  if (!modelMaySpeak(takesInFacts)) {
    return { text: plain, facts, used, source: 'measurements', why: 'several-takes', note: SEVERAL_TAKES_NOTE };
  }

  const instructions = instructionsFor(p.intents);
  const prompt = promptFor(question, facts);
  if (instructions.length + prompt.length > MAX_PROMPT_CHARS) {
    return { text: plain, facts, used, source: 'measurements', note: 'There was too much to read to the on-device model at once, so these are the measurements as they stand.' };
  }

  try {
    const reply = await m.respond({ instructions, prompt });
    // The scope tags in the prompt are the app's own bookkeeping. A model that
    // echoes one back ("[the whole take] Your take was...") is not wrong, and the
    // player is not shown a tag.
    const text = stripScopeTags(String(reply?.text ?? '')).trim();
    const bad = text ? unfinished(text) : '';
    if (bad) return { text: plain, facts, used, source: 'measurements', note: `The model's reply was set aside (${bad}).`, stray: [] };
    const verdict = checkReply(text, facts, question, { takeCount: takesInFacts });
    if (verdict.ok) return { text, facts, used, source: 'model', note: '' };
    return { text: plain, facts, used, source: 'measurements', note: `The model's reply was set aside (${verdict.reason}).`, stray: verdict.stray };
  } catch (err) {
    return { text: plain, facts, used, source: 'measurements', note: String(err?.message ?? err) };
  }
}

export { intentsOf };
