// Whatever is thrown, a player is told something they can act on.
//
// "when i uploaded a pdf i tried to open it and it said null and didnt work."
import { describe, it, expect } from 'vitest';
import { why, saying } from '../src/ui/why.js';

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
