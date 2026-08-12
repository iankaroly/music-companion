import { describe, it, expect } from 'vitest';
import { isPdf, isImage, sniffPdf, sniffImage } from '../src/ui/paper.js';

// What the file SAYS it is, against what is actually inside it.
//
// A part exported out of another app and handed over by iOS — from Files, from
// iCloud Drive, from a share sheet — arrives often enough with an empty type
// and a name with no extension on it. Judged on the label alone that is neither
// a PDF nor a picture, and "those were not pages of music" is not something
// anybody can act on when the thing plainly is one.

const file = (bytes, name, type = '') => new File([new Uint8Array(bytes)], name, { type });
const ascii = (text) => [...text].map((c) => c.charCodeAt(0));

describe('what the label claims', () => {
  it('believes a proper PDF', () => {
    expect(isPdf(file([], 'suite.pdf', 'application/pdf'))).toBe(true);
    expect(isPdf(file([], 'suite.PDF'))).toBe(true);
  });

  it('believes a proper photograph', () => {
    expect(isImage(file([], 'IMG_1.jpg', 'image/jpeg'))).toBe(true);
    expect(isImage(file([], 'page.HEIC'))).toBe(true);
  });

  // The case that started this: no extension, no type, and both of the above
  // say no.
  it('has nothing to go on when the label is empty', () => {
    const anonymous = file(ascii('%PDF-1.7 ...'), 'Bach Suite I');
    expect(isPdf(anonymous)).toBe(false);
    expect(isImage(anonymous)).toBe(false);
  });
});

describe('what the bytes say', () => {
  it('knows a PDF by its header', async () => {
    expect(await sniffPdf(file(ascii('%PDF-1.4\n1 0 obj'), 'Bach Suite I'))).toBe(true);
  });

  // A PDF is allowed a little rubbish in front of its header, and files that
  // have been through a few apps often have some.
  it('finds the header behind a preamble', async () => {
    expect(await sniffPdf(file(ascii('\n\n   %PDF-1.6'), 'exported'))).toBe(true);
  });

  it('is not fooled by something that merely mentions PDF', async () => {
    expect(await sniffPdf(file(ascii('this text is about PDF files'), 'notes.txt'))).toBe(false);
  });

  it('knows a JPEG, a PNG and a HEIC', async () => {
    expect(await sniffImage(file([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0], 'a'))).toBe(true);
    expect(await sniffImage(file([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 0, 0, 0, 0], 'b'))).toBe(true);
    expect(await sniffImage(file([0, 0, 0, 24, ...ascii('ftypheic')], 'c'))).toBe(true);
  });

  it('says no to bytes that are neither', async () => {
    expect(await sniffImage(file(ascii('%PDF-1.4 not a picture'), 'd'))).toBe(false);
    expect(await sniffPdf(file([0xff, 0xd8, 0xff, 0xe0], 'e'))).toBe(false);
  });
});
