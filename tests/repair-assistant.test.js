// REPAIR: calls that could hang, the card's footer, and the native bridge.
import { describe, test, expect, vi, afterEach } from 'vitest';
import { readFile } from 'node:fs/promises';
import { answerQuestion, modelStatus, AVAILABILITY_TIMEOUT_MS, LOAD_TIMEOUT_MS, within } from '../src/ai/assistant.js';
import { footerFor } from '../src/ui/ask.js';
import { rec, NOW } from './ai-eval/fixtures.js';
import { qualityOf } from '../src/analysis/quality.js';

afterEach(() => { vi.useRealTimers(); });
const library = [rec(1, 'Bach', 1, 9)];
const hangs = () => new Promise(() => {});

describe('availability() has a clock', () => {
  test('a model whose availability never returns is "unavailable", not a question that never ends', async () => {
    vi.useFakeTimers();
    const model = { availability: hangs, respond: vi.fn() };
    const p = answerQuestion({ question: 'how was my last take', library, model, now: NOW });
    await vi.advanceTimersByTimeAsync(AVAILABILITY_TIMEOUT_MS + 50);
    const r = await p;
    expect(r.source).toBe('measurements');
    expect(r.note).toMatch(/did not answer/);
    expect(r.text).toMatch(/notes heard/);
    expect(model.respond).not.toHaveBeenCalled();
  });
  test('modelStatus alone gives up too', async () => {
    vi.useFakeTimers();
    const p = modelStatus({ availability: hangs });
    await vi.advanceTimersByTimeAsync(AVAILABILITY_TIMEOUT_MS + 50);
    expect(await p).toMatchObject({ available: false });
  });
  test('a fast availability is not delayed, and a throw is still a reason', async () => {
    expect(await modelStatus({ availability: async () => ({ available: true }) })).toMatchObject({ available: true });
    expect(await modelStatus({ availability: () => { throw new Error('boom'); } })).toMatchObject({ available: false, reason: 'boom' });
  });
});

describe('reading a stored take has a clock', () => {
  test('a load that never returns leaves that take without tone facts and the question still ends', async () => {
    vi.useFakeTimers();
    const model = { availability: async () => ({ available: false, reason: 'off' }), respond: vi.fn() };
    const p = answerQuestion({ question: 'is my tone clear', library, model, load: hangs, qualityOf, now: NOW });
    await vi.advanceTimersByTimeAsync(LOAD_TIMEOUT_MS + 50);
    const r = await p;
    expect(r.source).toBe('measurements');
    expect(r.text).toMatch(/could not be measured/);
  });
});

describe('within', () => {
  test('passes a value through, passes a rejection through, clears its timer', async () => {
    vi.useFakeTimers();
    expect(await within(() => 5, 1000, 'x')).toBe(5);
    await expect(within(() => Promise.reject(new Error('no')), 1000, 'x')).rejects.toThrow('no');
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('the line under the card', () => {
  test('before the first status has come back it claims nothing about the model', () => {
    expect(footerFor(null, { source: 'measurements' })).toBe('');
    expect(footerFor(undefined, { source: 'measurements' })).toBe('');
  });
  test('after it has, a code answer on a phone with no model keeps the standing reason', () => {
    expect(footerFor({ available: false, reason: 'Apple Intelligence is turned off.' }, { source: 'measurements' })).toBe('Showing the measurements directly: Apple Intelligence is turned off.');
    expect(footerFor({ available: true }, { source: 'measurements' })).toBe('');
  });
});

describe('the native plugin is registered in the app that is built', () => {
  test('the window\'s root controller is the one that registers StandPartnerAI', async () => {
    const scene = await readFile(new URL('../ios/App/App/SceneDelegate.swift', import.meta.url), 'utf8');
    const main = await readFile(new URL('../ios/App/App/MainViewController.swift', import.meta.url), 'utf8');
    // the bare CAPBridgeViewController skips capacitorDidLoad: availability() rejected
    // UNIMPLEMENTED on a simulator and every answer fell back to the plain sentences
    expect(scene).toMatch(/rootViewController = MainViewController\(\)/);
    expect(scene).not.toMatch(/rootViewController = CAPBridgeViewController\(\)/);
    expect(main).toMatch(/registerPluginInstance\(StandPartnerAIPlugin\(\)\)/);
  });
  test('the privacy manifest does not state a stale line count', async () => {
    const plist = await readFile(new URL('../ios/App/App/PrivacyInfo.xcprivacy', import.meta.url), 'utf8');
    expect(plist).not.toMatch(/99 lines across three files/);
  });
});
