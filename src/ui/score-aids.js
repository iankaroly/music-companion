// The click and the pitch, on the page you are reading.
//
// Both of these already exist in this app, each on a tab of its own, and until
// now the reader's way of offering them was to CLOSE the score and take you
// there. That is the wrong side of the line: a metronome you have to leave the
// music to reach is a metronome you use before you start playing and never
// again, and a tuner you have to leave the music to reach is one you use once.
// forScore keeps both inside the score for exactly this reason.
//
// So this is a strip that lives over the foot of the page. It is not a second
// metronome or a second tuner — there is one of each in this app and there had
// better remain one, or two things will be listening to the same microphone and
// clicking over each other. The metronome is the same engine the tab uses; the
// tuner readout is fed the same stream of readings the dial on the tab is fed,
// and asks for the microphone by saying so out loud rather than by reaching
// into the recording machinery itself.

import { Metronome, tempoName } from '../audio/metronome.js';
import { freqToNote, midiToName } from '../analysis/note-utils.js';
import { intonationTolerance } from './chart-utils.js';

const BPM_KEY = 'readerBpm';
const MIN_BPM = 30;
const MAX_BPM = 260;

let strip = null;
let metro = null;
let showing = null;       // null | 'metronome' | 'tuner'
let onClose = null;

// What the tuner needs, asked for out loud.
//
// The microphone belongs to the recording machinery in main.js, which knows
// about permissions, about the parked stream, and about the tab you are on.
// Reaching into it from here would be a second thing that can start and stop a
// capture, and two of those is how a stream gets left open. A shout is enough.
function askForEars(on) {
  document.dispatchEvent(new CustomEvent('score-tuner', { detail: { on } }));
}

function savedBpm() {
  const stored = Number(globalThis.localStorage?.getItem(BPM_KEY));
  return Number.isFinite(stored) && stored >= MIN_BPM && stored <= MAX_BPM ? stored : 80;
}

function rememberBpm(bpm) {
  try { globalThis.localStorage?.setItem(BPM_KEY, String(bpm)); } catch { /* fine */ }
}

function chip(label, title, onClick, className = 'aid-chip') {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = label;
  button.title = title;
  button.setAttribute('aria-label', title);
  button.addEventListener('click', onClick);
  return button;
}

function build() {
  if (strip) return strip;
  strip = document.createElement('div');
  strip.id = 'reader-aids';
  strip.hidden = true;

  // --- the click ---
  const metroRow = document.createElement('div');
  metroRow.className = 'aid-row';
  metroRow.dataset.aid = 'metronome';

  const play = chip('▶', 'Start the click', () => toggleClick(), 'aid-chip aid-play');
  const beat = document.createElement('span');
  beat.className = 'aid-beat';
  beat.setAttribute('aria-hidden', 'true');
  const bpmOut = document.createElement('span');
  bpmOut.className = 'aid-bpm';
  const named = document.createElement('span');
  named.className = 'aid-tempo-name';

  metroRow.append(
    play,
    beat,
    chip('−', 'Slower', () => nudge(-2)),
    bpmOut,
    chip('+', 'Faster', () => nudge(2)),
    named,
  );

  // --- the pitch ---
  const tuneRow = document.createElement('div');
  tuneRow.className = 'aid-row';
  tuneRow.dataset.aid = 'tuner';
  const noteOut = document.createElement('span');
  noteOut.className = 'aid-note';
  noteOut.textContent = '—';
  const centsOut = document.createElement('span');
  centsOut.className = 'aid-cents';
  centsOut.textContent = 'listening…';
  const meter = document.createElement('div');
  meter.className = 'aid-meter';
  const needle = document.createElement('div');
  needle.className = 'aid-needle';
  meter.append(needle);
  tuneRow.append(noteOut, meter, centsOut);

  const shut = chip('✕', 'Put it away', () => hideAids(), 'aid-chip aid-shut');
  strip.append(metroRow, tuneRow, shut);

  strip.__parts = { play, beat, bpmOut, named, noteOut, centsOut, needle };
  return strip;
}

function paintTempo() {
  const { bpmOut, named } = strip.__parts;
  bpmOut.textContent = String(metro.bpm);
  named.textContent = tempoName(metro.bpm);
}

function nudge(by) {
  if (!metro) return;
  metro.bpm = Math.max(MIN_BPM, Math.min(MAX_BPM, metro.bpm + by));
  rememberBpm(metro.bpm);
  paintTempo();
}

function toggleClick() {
  if (!metro) return;
  const { play } = strip.__parts;
  if (metro.running) {
    metro.stop();
    play.textContent = '▶';
    play.title = 'Start the click';
  } else {
    metro.start();
    play.textContent = '❚❚';
    play.title = 'Stop the click';
  }
  play.setAttribute('aria-label', play.title);
}

// The beat, seen rather than only heard: on a stand, with the click turned
// down, a pulse at the foot of the page is what keeps a slow movement honest.
function flash(beatIndex) {
  const { beat } = strip?.__parts ?? {};
  if (!beat) return;
  beat.classList.toggle('on-one', beatIndex === 0);
  beat.classList.remove('tick');
  // Reflow, so the animation restarts on every beat rather than only the first.
  void beat.offsetWidth;
  beat.classList.add('tick');
}

// --- the door -----------------------------------------------------------------

export function aidsElement(closeHandler) {
  onClose = closeHandler;
  const node = build();
  if (!metro) {
    metro = new Metronome(flash);
    metro.bpm = savedBpm();
    metro.onTempo = () => { rememberBpm(metro.bpm); paintTempo(); };
    paintTempo();
  }
  return node;
}

export function showAids(which) {
  if (!strip) return;
  showing = which;
  strip.hidden = false;
  strip.dataset.showing = which;
  if (which === 'tuner') askForEars(true);
  else askForEars(false);
}

export function hideAids() {
  if (!strip) return;
  showing = null;
  strip.hidden = true;
  if (metro?.running) toggleClick();
  askForEars(false);
  onClose?.();
}

export function aidsShowing() {
  return showing;
}

// Fed the same readings the tuner tab's dial is fed. Nothing is computed twice
// and nothing else is listening.
export function feedReading(reading) {
  if (showing !== 'tuner' || !strip) return;
  const { noteOut, centsOut, needle } = strip.__parts;
  const heard = reading?.frequency && reading.confidence >= 0.6 && reading.rms >= 0.005;
  if (!heard) {
    noteOut.textContent = '—';
    centsOut.textContent = 'listening…';
    needle.style.setProperty('--at', '50%');
    needle.dataset.tone = '';
    return;
  }
  const { midi, cents } = freqToNote(reading.frequency);
  noteOut.textContent = midiToName(midi);
  const off = Math.round(cents);
  centsOut.textContent = `${off > 0 ? '+' : ''}${off}`;
  needle.style.setProperty('--at', `${Math.max(0, Math.min(100, 50 + cents))}%`);
  needle.dataset.tone = Math.abs(cents) <= intonationTolerance() ? 'good'
    : (cents > 0 ? 'sharp' : 'flat');
}

// Everything let go of: the reader is closing.
export function stopAids() {
  if (metro?.running) metro.stop();
  if (strip) { strip.hidden = true; }
  showing = null;
  askForEars(false);
}
