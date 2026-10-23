import { describe, test, expect } from 'vitest';
import { exampleQuestions, modelLine } from '../src/ui/ask.js';
import { plan } from '../src/ai/router.js';

const DAY = 24 * 60 * 60 * 1000;
const take = (id, name, daysAgo, notes = 12) => ({
  id,
  name,
  date: Date.UTC(2026, 9, 20) - daysAgo * DAY,
  duration: 20,
  noteStats: Array.from({ length: notes }, (_, i) => ({ midi: 50 + (i % 3), name: ['D3', 'E3', 'F3'][i % 3], cents: 4 })),
});

describe('the ask card examples', () => {
  test('an empty library, or takes with no notes, offers nothing to press', () => {
    expect(exampleQuestions([])).toEqual([]);
    expect(exampleQuestions([take(1, 'a', 1, 0)])).toEqual([]);
  });

  test('a comparison is only offered once there are two takes to compare', () => {
    const one = exampleQuestions([take(1, 'Bach', 1)]);
    const two = exampleQuestions([take(1, 'Bach', 3), take(2, 'Bach', 1)]);
    expect(one.some((q) => /compare/.test(q))).toBe(false);
    expect(two[0]).toMatch(/compare/);
    expect(one).toHaveLength(4);
    expect(two).toHaveLength(4);
  });

  test('every example is read by the router as the question it was written to be', () => {
    const lib = [take(1, 'Bach', 3), take(2, 'Bach', 1)];
    const asked = exampleQuestions(lib);
    expect(asked.map((q) => plan(q, lib).intents.join('+'))).toEqual(['compare', 'summary', 'tone', 'worst']);
    // the comparison reads the newest take first, then the one before it
    expect(plan(asked[0], lib).takeIds).toEqual([2, 1]);

    const solo = [take(1, 'Bach', 1)];
    expect(exampleQuestions(solo).map((q) => plan(q, solo).intents.join('+')))
      .toEqual(['summary', 'tone', 'worst', 'tempo']);
  });
});

describe('the model line', () => {
  test('says plainly why the measurements are shown directly', () => {
    expect(modelLine({ available: false, reason: 'Apple Intelligence is turned off.' }))
      .toBe('Showing the measurements directly: Apple Intelligence is turned off.');
    expect(modelLine({ available: false, reason: 'This needs iOS 26 or later.' }))
      .toBe('Showing the measurements directly: this needs iOS 26 or later.');
    expect(modelLine({ available: false, reason: '' }))
      .toBe('Showing the measurements directly: this device can\'t run the on-device model.');
  });

  test('when the model is there it says the numbers are checked', () => {
    expect(modelLine({ available: true })).toMatch(/checked against the measurements/);
  });
});

describe('the native model', () => {
  test('resolves instead of hanging when the plugin is a Capacitor proxy', async () => {
    // @capacitor/core's plugin proxy answers every property, `then` included,
    // so returning it from an async function never settles.
    globalThis.webkit = { messageHandlers: { bridge: {} } };
    globalThis.Capacitor = {
      isNativePlatform: () => true,
      PluginHeaders: [{ name: 'StandPartnerAI', methods: [{ name: 'availability', rtype: 'promise' }] }],
      nativePromise: async () => ({ available: true }),
    };
    const { nativeModel, modelStatus } = await import('../src/ai/assistant.js');
    const m = await Promise.race([nativeModel(), new Promise((r) => setTimeout(() => r('HUNG'), 2000))]);
    expect(m).not.toBe('HUNG');
    expect(await modelStatus(m)).toEqual({ available: true, reason: '' });
    delete globalThis.webkit;
    delete globalThis.Capacitor;
  });
});
