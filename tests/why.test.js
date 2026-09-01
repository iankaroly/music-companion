// Whatever is thrown, a player is told something they can act on.
//
// "when i uploaded a pdf i tried to open it and it said null and didnt work."
import { describe, it, expect } from 'vitest';
import { why, saying, sayingRefused } from '../src/ui/why.js';

describe('what went wrong, in words', () => {
  it('never says null, whatever it is handed', () => {
    for (const thrown of [null, undefined, '', '   ', 'null', {}, { message: null },
      { message: '' }, { message: 'null' }, new Error(), new Error(''), 0, NaN]) {
      const said = why(thrown, 'that page could not be drawn');
      expect(said).toBeTruthy();
      expect(said.toLowerCase()).not.toBe('null');
      expect(said.toLowerCase()).not.toBe('undefined');
      expect(said).not.toBe('[object Object]');
    }
  });

  it('uses the message when there is one', () => {
    expect(why(new Error('the file is locked'))).toBe('the file is locked');
    expect(why('that is not a PDF')).toBe('that is not a PDF');
  });

  it('names a DOMException that has no message of its own', () => {
    expect(why({ name: 'QuotaExceededError', message: '' })).toMatch(/no room/);
    expect(why({ name: 'NotReadableError', message: '' })).toMatch(/read off the disk/);
  });

  it('falls back to what the CALLER was doing, with the error named', () => {
    expect(why({ name: 'WeirdError', message: '' }, 'that page could not be drawn'))
      .toBe('that page could not be drawn (WeirdError)');
  });

  it('does not throw on a null, which is the bug it exists for', () => {
    expect(() => why(null)).not.toThrow();
    expect(saying('could not open that score', null)).toMatch(/could not open that score/);
    expect(saying('could not open that score', null)).not.toMatch(/null/);
  });
});

// A REFUSAL IS NOT AN ERROR, IT IS AN ANSWER.
//
// `why` prefers a thrown message over its own name, and what browsers throw
// when somebody presses Don't Allow carries the message "Permission denied".
// True, and no use at all to the player, who is the only one who can fix it —
// so a refusal gets the way back rather than the browser's word for it.
// Measured by `app:first`: the first thing a new player saw after pressing this
// app's one big button was "mic unavailable — Permission denied".
describe('sayingRefused', () => {
  const denied = () => new DOMException('Permission denied', 'NotAllowedError');

  it('a refusal says what to turn on and what to press after', () => {
    const said = sayingRefused({ thing: 'microphone', again: 'press Record again' },
      denied(), 'mic unavailable');
    expect(said).toMatch(/microphone was not allowed/);
    expect(said).toMatch(/settings/i);
    expect(said).toMatch(/press Record again/);
    // The browser's word for it is exactly what this replaces.
    expect(said).not.toMatch(/Permission denied/);
  });

  it('the camera gets the same answer, in its own words', () => {
    const said = sayingRefused({ thing: 'camera', again: 'try scanning again' },
      denied(), 'the camera would not open');
    expect(said).toMatch(/camera was not allowed/);
    expect(said).toMatch(/try scanning again/);
  });

  // A device that is BROKEN and one that was REFUSED are not the same news, and
  // sending both down the refusal sentence would tell somebody with no
  // microphone at all to go and permit one.
  it('anything that is not a refusal is reported as before', () => {
    const broken = new DOMException('Requested device not found', 'NotFoundError');
    const said = sayingRefused({ thing: 'microphone', again: 'press Record again' },
      broken, 'mic unavailable');
    expect(said).toMatch(/^mic unavailable — /);
    expect(said).not.toMatch(/was not allowed/);
  });

  it('and it never returns "null", whatever it is handed', () => {
    for (const thrown of [null, undefined, '', 'null', {}, 0]) {
      const said = sayingRefused({ thing: 'microphone', again: 'press Record again' },
        thrown, 'mic unavailable');
      expect(said.length).toBeGreaterThan(0);
      expect(said).not.toMatch(/\bnull\b|\bundefined\b/);
    }
  });
});
