import { describe, it, expect } from 'vitest';
import { THEMES, resolveTheme, readPreference, writePreference } from '../src/ui/theme.js';

function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
  };
}

describe('theme preferences', () => {
  it('offers exactly system, light and dark', () => {
    expect(THEMES).toEqual(['system', 'light', 'dark']);
  });

  it('resolves explicit choices regardless of the system setting', () => {
    expect(resolveTheme('dark', false)).toBe('dark');
    expect(resolveTheme('dark', true)).toBe('dark');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('light', false)).toBe('light');
  });

  it('follows the system when the preference is system', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });

  it('treats an unknown or missing preference as system', () => {
    expect(resolveTheme(undefined, true)).toBe('dark');
    expect(resolveTheme('sepia', true)).toBe('dark');
    expect(resolveTheme(null, false)).toBe('light');
  });

  it('round-trips a stored preference', () => {
    const store = fakeStorage();
    writePreference('dark', store);
    expect(readPreference(store)).toBe('dark');
  });

  it('defaults to system when nothing is stored', () => {
    expect(readPreference(fakeStorage())).toBe('system');
  });

  it('ignores a stored value that is not a real theme', () => {
    expect(readPreference(fakeStorage({ 'mc-theme': 'neon' }))).toBe('system');
  });

  it('survives storage that throws (private mode, blocked cookies)', () => {
    const hostile = {
      getItem() { throw new Error('blocked'); },
      setItem() { throw new Error('blocked'); },
    };
    expect(readPreference(hostile)).toBe('system');
    expect(() => writePreference('dark', hostile)).not.toThrow();
  });
});
