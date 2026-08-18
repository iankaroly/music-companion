import { describe, it, expect } from 'vitest';
import { writtenPitchSay } from '../src/ui/scan-view.js';

// A notehead nobody played, pressed.
//
// The browser check (tools/scan-follow-check.mjs) watches this happen on a real
// page and proves the tone that sounds is the pitch the page reads. What it
// CANNOT reach is the other branch: on an engraved page with a clef and a
// signature every head is priced, so the case where the reader could not name
// the note — which is the commoner one on a photograph, and the one where the
// answer has to be a refusal — never comes up there. It is pinned here.
describe('what an unplayed notehead says when it is pressed', () => {
  it('names the written pitch and says the tone is synthesised', () => {
    const said = writtenPitchSay({ midi: 43 });
    expect(said.midi).toBe(43);
    expect(said.text).toContain('G2');
    expect(said.text).toContain('Not played');
    expect(said.text).toContain('synthesised');
    expect(said.label).toContain('G2');
  });

  // The whole point of the feature. A head the page could not price gets NO
  // sound, and the sentence says why rather than pretending there was nothing
  // to press.
  it('refuses, with a reason, when the page could not name the notehead', () => {
    for (const head of [{ midi: null }, { midi: undefined }, {}, null, undefined, { midi: NaN }]) {
      const said = writtenPitchSay(head);
      expect(said.midi).toBe(null);
      expect(said.text).toContain('Not played');
      expect(said.text).toContain('nothing to sound');
      // Nothing that could be read as a pitch, so nothing a caller could mine
      // a frequency out of by accident.
      expect(said.text).not.toMatch(/[A-G][#b]?-?\d/);
    }
  });

  // Rule 5, stated as a test: the answer for an unpriced head must not be the
  // answer for some other head. There is no fallback pitch anywhere in it.
  it('never invents a pitch for a head that has none', () => {
    expect(writtenPitchSay({ midi: null, step: 4, clef: 'bass' }).midi).toBe(null);
    expect(writtenPitchSay({ midi: null, x: 0.5, y: 0.5, page: 0 }).midi).toBe(null);
  });
});
