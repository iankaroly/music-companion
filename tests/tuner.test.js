// THE TWO NOTES OF A DOUBLE STOP ARE NAMED IN ONE KEY.
//
// A transposing player sets Settings → instrument → B♭ (+2) and plays a double
// stop. The big note is named with `midi + transpose`; the line under it was
// named straight off the frequency, so concert C4 over concert G4 read "D4"
// with "double stop: + G4" beneath — a fourth on the screen where the player
// hears a fifth, and two notes in two different keys.
//
// The Tuner writes into the DOM, so this stands up the smallest document that
// its constructor and `update` actually touch. It is a display test: nothing
// here is about the detector.
import { describe, it, expect, beforeEach } from 'vitest';
import { Tuner } from '../src/ui/tuner.js';

function el() {
  const node = {
    textContent: '',
    dataset: {},
    setAttribute() {},
    append() {},
  };
  return node;
}

function stand() {
  const nodes = {
    '#note': el(), '#cents': el(), '#second': el(), '#freq': el(),
    '#tuner-say': el(), '#gauge-svg': el(),
  };
  globalThis.document = { createElementNS: () => el() };
  return { root: { querySelector: (sel) => nodes[sel] }, nodes };
}

// A held note, fed the way the analyzer feeds it: the pitch-center tracker
// averages over a window, so one frame is not a reading.
function hold(tuner, frequency, secondary = null) {
  for (let i = 0; i < 12; i++) {
    tuner.update({
      frequency, confidence: 0.95, rms: 0.05, time: i * 0.01, secondary,
    });
  }
}

const C4 = 261.626;
const G4 = 392.0;

describe('the tuner names both notes of a double stop in one key', () => {
  let rig;
  beforeEach(() => { rig = stand(); });

  it('names the second note concert on a concert-pitch instrument', () => {
    const tuner = new Tuner(rig.root);
    tuner.transpose = 0;
    hold(tuner, C4, { frequency: G4, confidence: 0.9 });
    expect(rig.nodes['#note'].textContent).toBe('C4');
    expect(rig.nodes['#second'].textContent).toBe('double stop: + G4 +0¢');
  });

  it('transposes the second note with the first on a B♭ instrument', () => {
    const tuner = new Tuner(rig.root);
    tuner.transpose = 2;
    hold(tuner, C4, { frequency: G4, confidence: 0.9 });
    expect(rig.nodes['#note'].textContent).toBe('D4');
    expect(rig.nodes['#second'].textContent).toBe('double stop: + A4 +0¢');
  });

  it('keeps the interval between the two notes whatever the transposition', () => {
    // The bug this is for did not move a name at random: it left the second
    // note in concert pitch, which SHRANK a fifth to a fourth on the screen.
    const midi = (name) => ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
      .indexOf(name.slice(0, -1)) + (Number(name.slice(-1)) + 1) * 12;
    for (const transpose of [-3, 0, 2, 5]) {
      const r = stand();
      const tuner = new Tuner(r.root);
      tuner.transpose = transpose;
      hold(tuner, C4, { frequency: G4, confidence: 0.9 });
      const second = /\+ ([A-G]#?-?\d)/.exec(r.nodes['#second'].textContent)[1];
      expect(midi(second) - midi(r.nodes['#note'].textContent)).toBe(7);
    }
  });

  it('leaves the second note’s cents alone — a transposition renames, it does not detune', () => {
    const tuner = new Tuner(rig.root);
    tuner.transpose = 2;
    // 25 cents above concert G4.
    hold(tuner, C4, { frequency: G4 * 2 ** (0.25 / 12), confidence: 0.9 });
    expect(rig.nodes['#second'].textContent).toBe('double stop: + A4 +25¢');
  });

  it('says nothing about a double stop when there is no second note', () => {
    const tuner = new Tuner(rig.root);
    tuner.transpose = 2;
    hold(tuner, C4, null);
    expect(rig.nodes['#second'].textContent).toBe('');
  });
});

// THE DIAL HOLDS A NOTE. "It bugs back and forth and doesn't register the
// pitch a lot of the time." Each case below is one of the shapes measured on
// real playing through the tuner's own analyzer (tools/tuner-check.mjs), fed
// at the analyzer's real rate: a reading every 512 samples at 48 kHz.
describe('the tuner holds a note through what the analyzer gets wrong', () => {
  const HOP = 512 / 48000;
  const A3 = 220;
  let rig;
  beforeEach(() => { rig = stand(); });

  // Feed a list of readings, one per hop, and record what the big note said
  // after each.
  function play(tuner, frames, from = 0) {
    return frames.map((f, i) => {
      tuner.update({ confidence: 0.95, rms: 0.05, secondary: null, ...f, time: from + i * HOP });
      return rig.nodes['#note'].textContent;
    });
  }
  const steady = (n, frequency = A3) => Array.from({ length: n }, () => ({ frequency }));

  it('does not jump to a one-frame octave or phantom-fundamental error', () => {
    const tuner = new Tuner(rig.root);
    const shown = play(tuner, [
      ...steady(20),
      { frequency: A3 / 2 }, { frequency: A3 / 3 }, { frequency: A3 / 3 }, { frequency: A3 * 2 },
      ...steady(20),
    ]);
    expect(shown.slice(10)).toEqual(Array(shown.length - 10).fill('A3'));
  });

  it('does not blank at a bow change where the confidence dips', () => {
    const tuner = new Tuner(rig.root);
    const shown = play(tuner, [
      ...steady(20),
      { frequency: null, confidence: 0.3 }, { frequency: null, confidence: 0.5 }, { frequency: A3, confidence: 0.5 },
      ...steady(20),
    ]);
    expect(shown.slice(10).every((n) => n === 'A3')).toBe(true);
  });

  it('keeps the note when the analyzer calls a note change a double stop and swaps the halves', () => {
    const tuner = new Tuner(rig.root);
    const pair = (a, b) => ({ frequency: a, secondary: { frequency: b, confidence: 0.9 } });
    const shown = play(tuner, [
      ...steady(20, 698.5),
      pair(784, 698.5), pair(784, 698.5), pair(698.5, 784), pair(698.5, 784), pair(784, 698.5),
      ...steady(10, 698.5),
    ]);
    expect(shown.slice(10).every((n) => n === 'F5')).toBe(true);
  });

  it('shows a soft note a phone hears quietly', () => {
    const tuner = new Tuner(rig.root);
    const shown = play(tuner, steady(30).map((f) => ({ ...f, rms: 0.002 })));
    expect(shown.at(-1)).toBe('A3');
  });

  it('moves to a new note once it has really been played, within a tenth of a second', () => {
    const tuner = new Tuner(rig.root);
    const shown = play(tuner, [...steady(20), ...steady(20, 246.94)]);
    const at = shown.indexOf('B3');
    expect(at).toBeGreaterThan(20);
    expect((at - 20) * HOP).toBeLessThan(0.1);
  });

  it('goes back to listening once the playing stops, and at once when told to stop', () => {
    const tuner = new Tuner(rig.root);
    const shown = play(tuner, [...steady(20), ...Array(60).fill({ frequency: null, confidence: 0, rms: 0.0005 })]);
    expect(shown.at(-1)).toBe('–');
    play(tuner, steady(20), 10);
    expect(rig.nodes['#note'].textContent).toBe('A3');
    tuner.update({ frequency: null, confidence: 0, rms: 0 });
    expect(rig.nodes['#note'].textContent).toBe('–');
  });
});

// A new capture builds a new analyzer, whose readings start from zero again.
// The strip over the music keeps one lock for the life of the page, so the
// lock has to notice time going backwards or it holds the last take's note.
describe('a new capture starts the lock afresh', () => {
  it('does not carry the last session’s note or frames into the next', async () => {
    const { TunerLock } = await import('../src/analysis/tuner-lock.js');
    const lock = new TunerLock();
    const HOP = 512 / 48000;
    for (let i = 0; i < 30; i++) lock.push({ frequency: 220, confidence: 0.95, rms: 0.05, time: 100 + i * HOP });
    let out;
    for (let i = 0; i < 60; i++) out = lock.push({ frequency: null, confidence: 0, rms: 0.0005, time: 0.04 + i * HOP });
    expect(out).toBeNull();
    // 10 cents sharp now, and the reading must be of the new frames alone.
    const sharp = 220 * 2 ** (10 / 1200);
    for (let i = 0; i < 30; i++) lock.push({ frequency: 220, confidence: 0.95, rms: 0.05, time: 200 + i * HOP });
    for (let i = 0; i < 30; i++) out = lock.push({ frequency: sharp, confidence: 0.95, rms: 0.05, time: 0.04 + i * HOP });
    expect((out.centerMidiFloat - 57) * 100).toBeCloseTo(10, 1);
  });
});
