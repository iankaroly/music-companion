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
import { checkReply } from './guard.js';
import { musicalityOf } from '../analysis/musicality.js';
import { MUSICALITY_INSTRUCTION } from './musicality-facts.js';

export const INSTRUCTIONS = [
  'You are the practice coach inside a music practice app. A player asked a question about their own recordings.',
  'You are given MEASUREMENTS. Answer using only those.',
  'Rules: use only numbers that appear in the measurements, copied exactly. Never calculate, estimate or round a number yourself.',
  'If the measurements do not cover what was asked, say plainly that it was not measured. Do not guess.',
  'Tone, vibrato and loudness are descriptions, not grades: say what changed, not whether it is good, unless a measurement says closer to pitch or steadier.',
  'Answer in two to four short sentences in plain words. No lists, no headings, no advice that a measurement does not support.',
].join('\n');

// The standing rules, plus the musicality rule only when shaping facts are in
// the prompt: it forbids "more musical" and advice about taste, which would be
// noise in an answer about pitch.
export function instructionsFor(intents = []) {
  const shaping = intents.includes('musicality') || intents.includes('compare');
  return shaping ? `${INSTRUCTIONS}\n${MUSICALITY_INSTRUCTION}` : INSTRUCTIONS;
}

export function promptFor(question, facts) {
  return `MEASUREMENTS:\n${facts.map((f) => `- ${f}`).join('\n')}\n\nQUESTION: ${question}`;
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
        if (p.needs.musicality) t.musicality = musicalityOf({ notes: data.notes, readings: data.readings, a4: data.a4 ?? 440 });
      } catch { /* an unreadable take just has no tone or rhythm facts */ }
    }
  }

  const { facts, used } = factsFor({ question, intents: p.intents, chosen, all: library, now });
  const plain = facts.join(' ');

  const m = model ?? await nativeModel();
  const status = await modelStatus(m);
  if (!status.available || chosen.length === 0) {
    return { text: plain, facts, used, source: 'measurements', note: status.available ? '' : status.reason };
  }

  try {
    const reply = await m.respond({ instructions: instructionsFor(p.intents), prompt: promptFor(question, facts) });
    const text = String(reply?.text ?? '').trim();
    const verdict = checkReply(text, facts, question, { takeCount: chosen.length });
    if (verdict.ok) return { text, facts, used, source: 'model', note: '' };
    return { text: plain, facts, used, source: 'measurements', note: `The model's reply was set aside (${verdict.reason}).`, stray: verdict.stray };
  } catch (err) {
    return { text: plain, facts, used, source: 'measurements', note: String(err?.message ?? err) };
  }
}

export { intentsOf };
