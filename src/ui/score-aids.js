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

const CLICK_KEY = 'readerClick';
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

// The click as you last set it: tempo, time signature, subdivision. A player
// who sets 6/8 at 52 for a movement wants 6/8 at 52 the next time they open it.
function savedClick() {
  try {
    const kept = JSON.parse(globalThis.localStorage?.getItem(CLICK_KEY) ?? 'null');
    if (kept && typeof kept === 'object') return kept;
  } catch { /* a click that will not be remembered still clicks */ }
  return {};
}

function remember() {
  if (!metro) return;
  try {
    globalThis.localStorage?.setItem(CLICK_KEY, JSON.stringify({
      bpm: metro.bpm, beatsPerBar: metro.beatsPerBar, subdivision: metro.subdivision,
    }));
  } catch { /* fine */ }
}

// Four taps say a tempo better than a number does. Anything slower than a bar
// apart is a new attempt rather than the next beat of this one.
const TAP_GIVE_UP = 2500;
let taps = [];

function tapTempo() {
  const now = Date.now();
  if (taps.length && now - taps.at(-1) > TAP_GIVE_UP) taps = [];
  taps.push(now);
  if (taps.length > 5) taps.shift();
  if (taps.length < 2) return;
  const gaps = [];
  for (let i = 1; i < taps.length; i++) gaps.push(taps[i] - taps[i - 1]);
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  const bpm = Math.round(60000 / mean);
  if (bpm < MIN_BPM || bpm > MAX_BPM) return;
  metro.bpm = bpm;
  remember();
  paintTempo();
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

  // How many beats to the bar, which is the one thing a metronome on a page of
  // music can know that a metronome on a tab cannot: you are looking at the
  // time signature while you set it.
  const meter = document.createElement('select');
  meter.className = 'aid-select';
  meter.title = 'Beats in a bar';
  meter.setAttribute('aria-label', 'Beats in a bar');
  for (const n of [2, 3, 4, 5, 6, 7, 9, 12]) {
    const option = document.createElement('option');
    option.value = String(n);
    option.textContent = `${n}/4`;
    meter.append(option);
  }
  meter.addEventListener('change', () => {
    metro.beatsPerBar = Number(meter.value);
    remember();
  });

  // Subdivisions, because half the reason to put a click on is that the passage
  // is in semiquavers and the beat alone is not enough to hold it together.
  const subs = document.createElement('select');
  subs.className = 'aid-select';
  subs.title = 'Subdivision';
  subs.setAttribute('aria-label', 'Subdivision');
  for (const [value, label] of [['quarter', '♩'], ['eighth', '♪♪'],
    ['triplet', '♪♪♪'], ['sixteenth', '♬♬']]) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    subs.append(option);
  }
  subs.addEventListener('change', () => {
    metro.subdivision = subs.value;
    remember();
  });

  // Tapped, because the tempo you want is usually one you can already feel and
  // not one you can name.
  const tap = chip('tap', 'Tap the tempo', () => tapTempo());

  // Small by default, and the rest a tap away.
  //
  // Everything a metronome can do does not need to be on the music. What is
  // wanted while playing is start, stop, and a shade faster or slower; the
  // time signature and the subdivision are set once at the beginning of a
  // movement and then left alone for an hour. So those live behind one button
  // and the strip stays the size of the thing you actually reach for.
  const extras = document.createElement('span');
  extras.className = 'aid-extras';
  extras.hidden = true;
  extras.append(meter, subs, tap);
  const more = chip('⋯', 'More of the metronome', () => {
    extras.hidden = !extras.hidden;
    more.classList.toggle('on', !extras.hidden);
  });

  metroRow.append(
    play,
    beat,
    chip('−', 'Slower', () => nudge(-2)),
    bpmOut,
    chip('+', 'Faster', () => nudge(2)),
    named,
    more,
    extras,
  );
  strip.__meter = meter;
  strip.__subs = subs;

  // --- the pitch ---
  const tuneRow = document.createElement('div');
  tuneRow.className = 'aid-row';
  tuneRow.dataset.aid = 'tuner';
  const noteOut = document.createElement('span');
  noteOut.className = 'aid-note';
  noteOut.textContent = '—';
  const centsOut = document.createElement('span');
  centsOut.className = 'aid-cents';
  centsOut.textContent = 'opening the mic…';
  const dial = document.createElement('div');
  dial.className = 'aid-meter';
  const needle = document.createElement('div');
  needle.className = 'aid-needle';
  dial.append(needle);
  tuneRow.append(noteOut, dial, centsOut);

  // The way to actually get a microphone.
  //
  // Asking for one has to happen inside the tap that asked, or iOS refuses it:
  // the permission check the app does first is a promise, and awaiting it ends
  // the gesture. Opening the tuner from a MENU row therefore cannot reliably
  // start listening — and when it failed, the only thing that said so was a
  // button on the tuner tab, which is not a screen you can see from here. So
  // there is one on the strip, and tapping it is the gesture.
  const listen = chip('Listen', 'Ask for the microphone', () => {
    document.dispatchEvent(new CustomEvent('score-tuner', { detail: { on: true, tap: true } }));
    listen.hidden = true;
    strip.__parts.centsOut.textContent = 'opening the mic…';
  }, 'aid-chip aid-listen');
  tuneRow.append(listen);

  const shut = chip('✕', 'Put it away', () => hideAids(), 'aid-chip aid-shut');

  // Somewhere to take hold of it.
  //
  // Where this sits is a matter of what the music is doing: over the last
  // system it is in the way, in a corner it is not, and which corner depends on
  // the page and on which hand is free. So it is draggable anywhere, and it
  // stays where it was put.
  const grip = document.createElement('span');
  grip.className = 'aid-grip';
  grip.setAttribute('aria-hidden', 'true');
  // Held by the grip OR by any part of the strip that is not a control.
  //
  // A grip a centimetre wide is a thing you have to notice before you can use
  // it, and "I cannot move it" is what happens when you do not. The whole
  // strip is now a handle except for the parts that do something when pressed,
  // which is the rule people already expect from every window they have ever
  // dragged.
  makeDraggable(strip, grip);
  makeDraggable(strip, strip, (e) => !e.target.closest('button, select, input'));

  strip.append(grip, metroRow, tuneRow, shut);

  strip.__parts = { play, beat, bpmOut, named, noteOut, centsOut, needle, listen };
  return strip;
}

// --- moving it -----------------------------------------------------------

const WHERE_KEY = 'readerAidsAt';

function placeStrip(at) {
  if (!strip || !at) return;
  // Kept on the glass: a strip dragged half off the screen, on a device with no
  // way to scroll to it, would be gone for good.
  const box = strip.getBoundingClientRect();
  const w = box.width || 260;
  const h = box.height || 48;
  const x = Math.max(6, Math.min(window.innerWidth - w - 6, at.x));
  const y = Math.max(6, Math.min(window.innerHeight - h - 6, at.y));
  strip.style.left = `${Math.round(x)}px`;
  strip.style.top = `${Math.round(y)}px`;
  strip.style.right = 'auto';
  strip.style.bottom = 'auto';
  strip.style.transform = 'none';
}

function rememberWhere(at) {
  try { globalThis.localStorage?.setItem(WHERE_KEY, JSON.stringify(at)); } catch { /* fine */ }
}

function recallWhere() {
  try {
    const kept = JSON.parse(globalThis.localStorage?.getItem(WHERE_KEY) ?? 'null');
    if (kept && Number.isFinite(kept.x) && Number.isFinite(kept.y)) return kept;
  } catch { /* it can sit where it starts */ }
  return null;
}

function makeDraggable(node, handle, when = null) {
  let from = null;

  // The moves are listened for on the WINDOW, not on the grip.
  //
  // A grip is a centimetre across and a drag leaves it immediately, so a
  // listener bound to the grip stops hearing about the drag one pixel in.
  // Pointer capture is supposed to solve that and does not always take — it
  // throws on a pointer the browser has already reassigned, and then the drag
  // dies silently. The window hears everything, always.
  const move = (e) => {
    if (!from || from.id !== e.pointerId) return;
    placeStrip({ x: e.clientX - from.dx, y: e.clientY - from.dy });
    if (e.cancelable) e.preventDefault();
  };
  const done = (e) => {
    if (!from || from.id !== e.pointerId) return;
    from = null;
    node.classList.remove('moving');
    window.removeEventListener('pointermove', move, true);
    window.removeEventListener('pointerup', done, true);
    window.removeEventListener('pointercancel', done, true);
    const box = node.getBoundingClientRect();
    rememberWhere({ x: box.left, y: box.top });
  };

  handle.addEventListener('pointerdown', (e) => {
    if (when && !when(e)) return;
    const box = node.getBoundingClientRect();
    from = { dx: e.clientX - box.left, dy: e.clientY - box.top, id: e.pointerId };
    node.classList.add('moving');
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', done, true);
    window.addEventListener('pointercancel', done, true);
    if (e.cancelable) e.preventDefault();
  });
}

function paintTempo() {
  const { bpmOut, named } = strip.__parts;
  bpmOut.textContent = String(metro.bpm);
  named.textContent = tempoName(metro.bpm);
}

function nudge(by) {
  if (!metro) return;
  metro.bpm = Math.max(MIN_BPM, Math.min(MAX_BPM, metro.bpm + by));
  remember();
  paintTempo();
}

function paintPlay() {
  const { play } = strip.__parts;
  const on = !!metro?.running;
  play.textContent = on ? '❚❚' : '▶';
  play.title = on ? 'Stop the click' : 'Start the click';
  play.setAttribute('aria-label', play.title);
}

function toggleClick() {
  if (!metro) return;
  if (metro.running) metro.stop();
  else metro.start();
  paintPlay();
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
    const kept = savedClick();
    if (Number.isFinite(kept.bpm) && kept.bpm >= MIN_BPM && kept.bpm <= MAX_BPM) metro.bpm = kept.bpm;
    if (Number.isFinite(kept.beatsPerBar)) metro.beatsPerBar = kept.beatsPerBar;
    if (typeof kept.subdivision === 'string') metro.subdivision = kept.subdivision;
    metro.onTempo = () => { remember(); paintTempo(); };
    if (strip.__meter) strip.__meter.value = String(metro.beatsPerBar);
    if (strip.__subs) strip.__subs.value = metro.subdivision;
    paintTempo();
  }
  return node;
}

export function showAids(which) {
  if (!strip) return;
  showing = which;
  strip.hidden = false;
  strip.dataset.showing = which;
  // Wherever it was left. Measured after it is on screen, because a hidden
  // element has no size to clamp against.
  const where = recallWhere();
  if (where) requestAnimationFrame(() => placeStrip(where));
  if (which !== 'tuner') { askForEars(false); return; }
  // One at a time. Holding the microphone puts iOS into a record-capable audio
  // session, which drops the output level for as long as it is held — so a
  // click left running under the tuner is a click you can barely hear, and it
  // would be the tuner's own fault.
  if (metro?.running) toggleClick();
  heardAnything = false;
  strip.__parts.listen.hidden = true;
  strip.__parts.centsOut.textContent = 'opening the mic…';
  askForEars(true);
  // If nothing has been heard shortly, the microphone was never opened — say
  // so, and offer the tap that can actually open it.
  clearTimeout(silence);
  silence = setTimeout(() => {
    if (showing !== 'tuner' || heardAnything) return;
    strip.__parts.centsOut.textContent = 'no microphone yet';
    strip.__parts.listen.hidden = false;
  }, 2200);
}

let heardAnything = false;
let silence = null;

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
  if (!heardAnything) {
    heardAnything = true;
    clearTimeout(silence);
    strip.__parts.listen.hidden = true;
  }
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
  // Through the same repaint that owns the button, or a reopened strip shows a
  // stop glyph over a stopped click — after which the first tap STARTS it and
  // changes nothing on screen, and the second stops it. Half of every tap
  // doing the opposite of what the button says is a metronome that reads as
  // broken whatever the audio is doing.
  if (metro?.running) metro.stop();
  if (strip?.__parts) paintPlay();
  if (strip) { strip.hidden = true; }
  showing = null;
  askForEars(false);
}
