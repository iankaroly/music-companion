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
