import { describe, it, expect } from 'vitest';
import { repairForEngraving } from '../src/analysis/musicxml-repair.js';

// An engraver refuses a WHOLE score over one note it cannot draw, so a single
// badly-measured bar costs every other bar on the page. A ten-page book already
// in the library did exactly that: "The provided duration is not valid".
describe('a score that can be drawn', () => {
  it('gives a note of no length one tick, so the score is not refused over it', () => {
    const xml = '<note><rest measure="yes"/><duration>0</duration><voice>1</voice></note>';
    const out = repairForEngraving(xml);
    expect(out.repaired).toBe(2);            // the length, and the missing type
    expect(out.xml).toContain('<duration>1</duration>');
    expect(out.xml).toContain('<type>whole</type>');
  });

  it('tells a whole-measure rest what to draw', () => {
    const xml = '<note><rest measure="yes"/><duration>96</duration><voice>1</voice></note>';
    const out = repairForEngraving(xml);
    expect(out.repaired).toBe(1);
    expect(out.xml).toContain('<type>whole</type>');
    expect(out.xml).toContain('<duration>96</duration>');   // untouched
  });

  it('leaves a grace note alone, which has no duration by definition', () => {
    const xml = '<note><grace/><pitch><step>C</step><octave>5</octave></pitch>'
      + '<voice>1</voice><type>16th</type></note>';
    expect(repairForEngraving(xml)).toEqual({ xml, repaired: 0 });
  });

  it('leaves a score that can already be drawn exactly as it is', () => {
    const xml = '<note><pitch><step>C</step><octave>4</octave></pitch>'
      + '<duration>24</duration><voice>1</voice><type>quarter</type></note>';
    expect(repairForEngraving(xml)).toEqual({ xml, repaired: 0 });
  });
});
