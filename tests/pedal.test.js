import { describe, it, expect } from 'vitest';
import { pageTurn, pressName, DEFAULT_FORWARD, DEFAULT_BACK } from '../src/ui/pedal.js';

// A page turner is a keyboard. These are the keystrokes the pedals people own
// actually send, and the rule for what happens when somebody teaches it their
// own.

const press = (key, code = key) => ({ key, code });
const none = { forward: null, back: null };

describe('the pedals every page turner already sends', () => {
  it('turns forward on all of them', () => {
    for (const key of DEFAULT_FORWARD) {
      expect(pageTurn(press(key), none), key).toBe('forward');
    }
  });

  it('goes back on all of them', () => {
    for (const key of DEFAULT_BACK) {
      expect(pageTurn(press(key), none), key).toBe('back');
    }
  });

  it('ignores everything else', () => {
    expect(pageTurn(press('a'), none)).toBeNull();
    expect(pageTurn(press('Escape'), none)).toBeNull();
    expect(pageTurn(press('Tab'), none)).toBeNull();
  });
});

describe('a pedal that has been taught', () => {
  const mapping = { forward: { code: 'KeyN', key: 'n' }, back: { code: 'KeyB', key: 'b' } };

  it('answers to what it was taught', () => {
    expect(pageTurn(press('n', 'KeyN'), mapping)).toBe('forward');
    expect(pageTurn(press('b', 'KeyB'), mapping)).toBe('back');
  });

  it('still answers to the built-in keys alongside it', () => {
    expect(pageTurn(press('ArrowRight'), mapping)).toBe('forward');
    expect(pageTurn(press('PageUp'), mapping)).toBe('back');
  });

  it('matches on the physical key, so a different layout still turns pages', () => {
    // Same pedal, reported with another letter on a non-QWERTY layout.
    expect(pageTurn({ key: 'k', code: 'KeyN' }, mapping)).toBe('forward');
  });

  // The whole point of teaching a key is that it means what you said it means.
  it('does not leave a taught key doing its old job as well', () => {
    const spaceGoesBack = { forward: null, back: { code: 'Space', key: ' ' } };
    expect(pageTurn(press(' ', 'Space'), spaceGoesBack)).toBe('back');
  });
});

describe('saying which key that was', () => {
  it('names the keys nobody can read as characters', () => {
    expect(pressName({ key: ' ', code: 'Space' })).toBe('Space');
    expect(pressName({ key: 'ArrowRight', code: 'ArrowRight' })).toBe('→');
  });

  it('shows a letter as a letter', () => {
    expect(pressName({ key: 'n', code: 'KeyN' })).toBe('N');
  });

  it('says so when there is nothing to name', () => {
    expect(pressName(null)).toBe('not set');
  });
});
