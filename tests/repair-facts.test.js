// REPAIR: the sentences the facts are made of. Each fails at ceab50d.
import { describe, test, expect } from 'vitest';
import { factsFor } from '../src/ai/facts.js';
import { takeLabel } from '../src/ai/labels.js';
import { rec, NOW, DAY } from './ai-eval/fixtures.js';

const take = (id, name, stats, extra = {}) => ({ id, name, date: NOW - id * DAY, duration: 10, noteStats: stats, landingStats: [], scoreStats: null, ...extra });
const of = (n, name, cents) => Array.from({ length: n }, (_, i) => ({ midi: 50, name, cents: cents[i % cents.length] }));
const facts = (q, intents, chosen, all = chosen) => factsFor({ question: q, intents, chosen, all, now: NOW });

describe('the furthest note is the one whose notes are furthest, not whose average is', () => {
  // A3 is 30 cents off every time, half sharp and half flat: it averages 0.
  const t = take(1, 'Etude', [...of(4, 'A3', [30, -30]), ...of(4, 'D3', [8])]);
  test('the summary names A3 and does not call it fine', () => {
    const line = facts('how was my last take', ['summary'], [t]).facts.join(' ');
    expect(line).toMatch(/furthest from pitch was A3, 30¢ off/);
    expect(line).not.toMatch(/D3, 8¢ sharp/);
    expect(line).not.toMatch(/0¢ flat/);
  });
  test('the worst-notes list ranks by how far, and says a note goes both ways', () => {
    const line = facts('which notes am I worst at', ['worst'], [t]).facts.join(' ');
    expect(line).toMatch(/A3 \(30¢ off, sometimes above and sometimes below the pitch, 4 times\), D3 \(8¢ sharp, 4 times\)/);
  });
  test('a note that is always sharp is still called sharp', () => {
    const line = facts('how was my last take', ['summary'], [take(1, 'E', of(8, 'D3', [14, 16]))]).facts.join(' ');
    expect(line).toMatch(/D3, 15¢ sharp on average over 8 times/);
  });
  test('the comparison of one pitch uses how far, not where the average falls', () => {
    const a = take(1, 'Etude', of(4, 'A3', [20, -20]));
    const b = take(2, 'Etude', of(4, 'A3', [4]));
    const line = facts('compare my last two takes', ['compare'], [a, b]).facts.join(' ');
    expect(line).toMatch(/A3 moved from 4¢ to 20¢ off on average \(further\)/);
  });
});

describe('small wording faults', () => {
  test('one note is "1 note heard"', () => {
    expect(facts('x', ['summary'], [take(1, 'Solo', [{ midi: 50, name: 'D3', cents: 3 }])]).facts[0]).toMatch(/1 note heard/);
  });
  test('a note with no name is not "undefined"', () => {
    const t = take(1, 'X', [{ midi: 50, cents: 30 }, { midi: 50, cents: 30 }, ...of(4, 'D3', [8])]);
    expect(facts('x', ['summary'], [t]).facts.join(' ')).not.toMatch(/undefined/);
  });
  test('a take with no name and no date has a word, not "Invalid Date"', () => {
    const t = { id: 1, name: '', date: NaN, noteStats: of(4, 'D3', [8]) };
    expect(takeLabel(t)).toBe('an unnamed take');
    const line = facts('x', ['summary'], [t]).facts.join(' ');
    expect(line).not.toMatch(/Invalid/);
    expect(line).toMatch(/"an unnamed take": 4 notes heard/);
  });
  test('a timing change that rounds to nothing is not a direction', () => {
    const per = (c) => c.map((cents, i) => ({ scoreNoteId: i + 1, measure: 1 + Math.floor(i / 3), cents }));
    const a = take(1, 'S', of(6, 'D3', [5]), { scoreStats: { absMeanCents: 5, meanAbsMs: 40, perNote: per([5, 5, 5, 5, 5, 5]) } });
    const b = take(2, 'S', of(6, 'D3', [5]), { scoreStats: { absMeanCents: 5, meanAbsMs: 40.2, perNote: per([5, 5, 5, 5, 5, 5]) } });
    const line = facts('compare my last two takes', ['compare'], [a, b]).facts.join(' ');
    expect(line).not.toMatch(/0 ms (looser|tighter)/);
  });
  test('a clarity change reads on the single-take scale, so .80 to .84 is not "0.8 before, 0.8 now"', () => {
    const q = (clarity) => ({ steadinessCents: 3, vibrato: null, clarity, brightness: 3, dynamics: null, landing: null });
    const a = take(1, 'Aria', of(4, 'D3', [5]), { quality: q(0.84) });
    const b = take(2, 'Aria', of(4, 'D3', [5]), { quality: q(0.8) });
    const line = facts('how did my tone change', ['compare'], [a, b]).facts.join(' ');
    expect(line).toMatch(/tone clarity: 80 out of 100 before, 84 out of 100 now/);
  });
  test('units sit against the symbols the same way everywhere', () => {
    const q = (s) => ({ steadinessCents: s, vibrato: null, clarity: 0.8, brightness: 3, dynamics: null, landing: null });
    const a = take(1, 'Aria', of(4, 'D3', [5]), { quality: q(3.1) });
    const b = take(2, 'Aria', of(4, 'D3', [5]), { quality: q(6.2) });
    const line = facts('how did my tone change', ['compare'], [a, b]).facts.join(' ');
    expect(line).toMatch(/6\.2¢ before, 3\.1¢ now/);
    expect(line).not.toMatch(/ ¢/);
  });
});

describe('the "based on" list names the takes whose measurements are in the sentences', () => {
  const lib = [rec(1, 'Etude', 1, 7), rec(2, 'Bach', 2, 5), rec(3, 'Scales', 3, 9)];
  test('a worst-notes question reads one take and names one', () => {
    const f = facts('which notes am I worst at in my last 3 takes', ['worst'], lib, lib);
    expect(f.used).toEqual(['Etude']);
  });
});
