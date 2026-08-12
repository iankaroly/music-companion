import { describe, it, expect } from 'vitest';
import { straightenFile, unreadableReason, sizeOfImage } from '../src/ui/straighten.js';

// A page nobody can decode must never become a page in the library.
//
// This is the whole of the bug that made a fresh scan open as "could not open
// that score": the importer swallowed the decode failure, stored the bytes
// anyway, and the reader found out about it several steps later, by which time
// all it could say was that the score was broken. Refusing here — loudly, with
// the file named — is the fix, and this is the test that keeps it.
//
// There is no image decoder in this environment at all, which is exactly the
// condition being tested: whatever the engine cannot read, the importer refuses.

describe('bringing a photograph in', () => {
  it('refuses a page it cannot decode rather than storing it', async () => {
    const file = new File([new Uint8Array(64).fill(9)], 'page-01.jpg', { type: 'image/jpeg' });
    await expect(straightenFile(file)).rejects.toThrow(/could not be read as an image/);
  });

  it('names HEIC for what it is, because the fix is in the phone settings', async () => {
    const file = new File([new Uint8Array(64).fill(9)], 'IMG_4021.heic', { type: 'image/heic' });
    await expect(straightenFile(file)).rejects.toThrow(/HEIC/);
  });
});

describe('saying why a page could not be read', () => {
  it('names the file', () => {
    expect(unreadableReason({ name: 'movement-2.png', type: 'image/png' }))
      .toMatch(/^movement-2\.png/);
  });

  it('points an iPhone photo at Most Compatible', () => {
    expect(unreadableReason({ name: 'IMG_0001.HEIC', type: '' })).toMatch(/Most Compatible/);
    expect(unreadableReason({ name: 'shot.heif', type: '' })).toMatch(/Most Compatible/);
  });

  it('has something to say about a file with no name at all', () => {
    expect(unreadableReason({})).toBe('that page could not be read as an image');
  });
});

describe('measuring whatever the decoder handed back', () => {
  // An <img> answers in naturalWidth, an ImageBitmap in width. Both are pages.
  it('reads an image element', () => {
    expect(sizeOfImage({ naturalWidth: 1200, naturalHeight: 1600 })).toEqual({ w: 1200, h: 1600 });
  });

  it('reads a bitmap', () => {
    expect(sizeOfImage({ width: 800, height: 600 })).toEqual({ w: 800, h: 600 });
  });

  it('reads nothing as nothing', () => {
    expect(sizeOfImage(null)).toEqual({ w: 0, h: 0 });
  });
});
