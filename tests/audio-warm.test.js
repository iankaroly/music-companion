import { describe, test, expect, beforeEach, afterEach } from 'vitest';

// A tap on iOS is pointerdown, then click ~100 ms later. Anything that starts
// a sound on click has that window to wake the audio engine in, and every
// control that makes a sound must use it — the drone buttons did not, and the
// first drone after a review came in late.

class FakeContext {
  constructor() { this.state = 'suspended'; this.resumes = 0; FakeContext.made++; }
  resume() { this.resumes++; this.state = 'running'; return Promise.resolve(); }
  suspend() { this.state = 'suspended'; return Promise.resolve(); }
}
FakeContext.made = 0;

function fakeRoot() {
  const listeners = {};
  return {
    addEventListener(type, fn) { (listeners[type] ??= []).push(fn); },
    fire(type, target) { for (const fn of listeners[type] ?? []) fn({ type, target }); },
  };
}

// An element is "audible" when it or an ancestor carries data-audible; closest
// is the only DOM call the wiring makes.
const audible = { closest: (sel) => (sel === '[data-audible]' ? {} : null) };
const silent = { closest: () => null };

let mod;
beforeEach(async () => {
  globalThis.AudioContext = FakeContext;
  globalThis.localStorage = { getItem: () => null, setItem() {} };
  FakeContext.made = 0;
  mod = await import('../src/audio/context.js?warm=' + Math.random());
});
afterEach(() => { delete globalThis.AudioContext; });

describe('warmAudibleOn', () => {
  test('pressing an audible control wakes the audio engine before the click', () => {
    const root = fakeRoot();
    mod.warmAudibleOn(root);
    root.fire('pointerdown', audible);
    expect(FakeContext.made).toBe(1);
    expect(mod.audioContext().state).toBe('running');
  });

  test('pressing anything else leaves the engine asleep', () => {
    const root = fakeRoot();
    mod.warmAudibleOn(root);
    root.fire('pointerdown', silent);
    expect(FakeContext.made).toBe(0);
  });
});
