import { describe, test, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { answerQuestion, modelStatus } from '../src/ai/assistant.js';
import { exampleQuestions } from '../src/ui/ask.js';
import { qualityOf } from '../src/analysis/quality.js';
import { rhythmReport } from '../src/analysis/rhythm.js';

// The promise on the privacy page is that a question about a recording never
// leaves the device. This reads the source of everything the question touches
// for any way of making a request, so a later "just ask a cloud model for the
// hard ones" fails here and not in a review of what the network tab shows.
describe('nothing in the ask path can make a network request', () => {
  const files = [
    ...readdirSync('src/ai').filter((f) => f.endsWith('.js')).map((f) => join('src/ai', f)),
    'src/analysis/musicality.js',
    'src/analysis/quality.js',
    'src/ui/ask.js',
  ];
  const BANNED = [
    [/\bfetch\s*\(/, 'fetch('],
    [/\bXMLHttpRequest\b/, 'XMLHttpRequest'],
    [/\bWebSocket\b/, 'WebSocket'],
    [/\bEventSource\b/, 'EventSource'],
    [/\bsendBeacon\b/, 'sendBeacon'],
    [/import\s*\(\s*['"`]https?:/, "import('http"],
    [/\bfrom\s+['"]https?:/, 'import from http'],
  ];
  // Prose in a comment may say "fetch"; only code is held to this.
  const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([^:'"])\/\/.*$/gm, '$1');
  for (const f of files) {
    test(f, () => {
      const src = code(readFileSync(f, 'utf8'));
      const hits = BANNED.filter(([re]) => re.test(src)).map(([, name]) => name);
      expect(hits).toEqual([]);
    });
  }
});

describe('the card in a browser', () => {
  test('the reason there is no on-device model reads as a plain fact, not a fault', async () => {
    const s = await modelStatus();
    expect(s.available).toBe(false);
    expect(s.reason).toMatch(/iPhone and iPad app/);
    expect(s.reason).not.toMatch(/cannot|error|fail|unable/i);
  });
});

describe('a library written by an older version of the app', () => {
  // Old rows: no name, no noteStats, no duration, no landing stats, no date.
  const old = [
    { id: 1, date: Date.UTC(2026, 8, 1) },
    { id: 2, name: 'Etude', date: Date.UTC(2026, 8, 5), duration: 12 },
    { id: 3, name: 'Etude', date: Date.UTC(2026, 8, 9), noteStats: [] },
    { id: 4 },
  ];
  const questions = [
    ...exampleQuestions(old),
    'How did my latest take go?', 'How does my last take compare to the one before?',
    'Which notes am I worst at?', 'Do I rush or drag?', 'How is the tone and vibrato in my latest take?',
    'How is the phrasing in my latest take?', 'Which notes do I tend to play sharp or flat?',
    'is my tone beautiful', 'how was my Etude take',
  ];

  test('offers no example to press when no take has notes', () => {
    expect(exampleQuestions(old)).toEqual([]);
  });

  for (const q of questions) {
    test(`answers or refuses without throwing: ${q}`, async () => {
      // `load` hands back what a take stored before readings and a4 existed.
      const load = async () => ({ notes: [], readings: [] });
      const r = await answerQuestion({ question: q, library: old, load, qualityOf, rhythmReport, model: null, now: Date.UTC(2026, 9, 20) });
      expect(typeof r.text).toBe('string');
      expect(r.text.length).toBeGreaterThan(0);
      expect(['measurements', 'refusal']).toContain(r.source);
    });
  }

  test('three old-shaped takes that do have notes but no readings, no a4, no landing, still answer', async () => {
    const notes = (bias) => Array.from({ length: 10 }, (_, i) => ({ midi: 50 + (i % 3), name: ['D3', 'E3', 'F3'][i % 3], cents: bias, start: i * 0.5, end: i * 0.5 + 0.4 }));
    const lib = [1, 2, 3].map((id) => ({ id, name: 'Old', date: Date.UTC(2026, 8, id), noteStats: notes(id * 4).map(({ midi, name, cents }) => ({ midi, name, cents })) }));
    const load = async (id) => ({ notes: notes(id * 4) });
    for (const q of ['How did my latest take go?', 'How does my last take compare to the one before?', 'How is the phrasing in my latest take?', 'How is the tone and vibrato in my latest take?', 'Do I rush or drag?']) {
      const r = await answerQuestion({ question: q, library: lib, load, qualityOf, rhythmReport, model: null, now: Date.UTC(2026, 9, 20) });
      expect(r.text.length).toBeGreaterThan(0);
    }
  });
});
