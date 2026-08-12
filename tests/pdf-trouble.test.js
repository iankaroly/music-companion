import { describe, it, expect } from 'vitest';
import { pdfTrouble, needsPassword } from '../src/ui/paper.js';

// What pdf.js throws, and what the player is told about it.
//
// "There was a problem" is not a diagnosis, and it was all a refused PDF ever
// got. Every one of these is a different thing to do next — unlock it, download
// it again, photograph it instead — and the difference has to reach the screen.

const thrown = (name, message, code) => Object.assign(new Error(message), { name, code });

describe('why a PDF would not open', () => {
  it('knows a locked part from a broken one', () => {
    expect(needsPassword(thrown('PasswordException', 'No password given', 1))).toBe(true);
    expect(needsPassword(thrown('InvalidPDFException', 'Invalid PDF structure'))).toBe(false);
    expect(needsPassword(null)).toBe(false);
  });

  it('asks for the password rather than refusing the file', () => {
    expect(pdfTrouble(thrown('PasswordException', 'No password given', 1)))
      .toMatch(/locked and needs its password/);
  });

  it('says when the password was simply wrong', () => {
    expect(pdfTrouble(thrown('PasswordException', 'Incorrect Password', 2)))
      .toMatch(/not right/);
  });

  it('sends a truncated download back to be downloaded again', () => {
    expect(pdfTrouble(thrown('InvalidPDFException', 'Invalid PDF structure.')))
      .toMatch(/incomplete.*Download it again/s);
  });

  it('offers photographs when there is no room left', () => {
    expect(pdfTrouble(thrown('QuotaExceededError', 'The quota has been exceeded.')))
      .toMatch(/no room left/);
  });

  it('passes anything it does not recognise through as it was said', () => {
    expect(pdfTrouble(thrown('WeirdError', 'something specific and unforeseen')))
      .toBe('something specific and unforeseen');
  });

  it('has something to say about nothing at all', () => {
    expect(typeof pdfTrouble(undefined)).toBe('string');
  });
});
