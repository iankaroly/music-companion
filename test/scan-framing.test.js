import { describe, it, expect } from 'vitest';
import { paperRunsOffTheFrame } from '../src/ui/straighten.js';

// A page held too close runs off the picture, and what is outside the picture
// was never photographed: no straightening, cropping or brightening afterwards
// can put the title back. The scanner used to ask for the page to FILL the
// frame and never ask whether it overflowed, so it would take that shot and
// call it a page.
describe('knowing when the page is bigger than the picture', () => {
  const frame = [[0, 0], [1, 0], [1, 1], [0, 1]];

  it('sees a sheet that reaches both sides across', () => {
    expect(paperRunsOffTheFrame(frame)).toBe(true);
    expect(paperRunsOffTheFrame([[0, 0.08], [1, 0.08], [1, 0.9], [0, 0.9]])).toBe(true);
  });

  it('sees a sheet that reaches top and bottom', () => {
    expect(paperRunsOffTheFrame([[0.1, 0], [0.8, 0], [0.8, 1], [0.1, 1]])).toBe(true);
  });

  it('is happy with a page that has room all round it', () => {
    expect(paperRunsOffTheFrame([[0.08, 0.06], [0.92, 0.05], [0.93, 0.94], [0.07, 0.95]])).toBe(false);
  });

  it('is happy with a page that nearly fills the frame but does not touch', () => {
    // 96% across: close, framed, and the shot worth taking.
    expect(paperRunsOffTheFrame([[0.02, 0.03], [0.98, 0.03], [0.98, 0.97], [0.02, 0.97]])).toBe(false);
  });

  it('reads a page photographed on a slant by its widest span', () => {
    // Tilted, and still off both edges: the corners are inside the frame but
    // the sheet is not.
    expect(paperRunsOffTheFrame([[0, 0.1], [0.99, 0], [1, 0.9], [0.01, 1]])).toBe(true);
  });
});
