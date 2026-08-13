// Theme: a three-way preference resolved to one concrete palette, stamped on
// <html data-theme> so CSS and the canvases agree on what colour anything is.
//
// The canvases can't read CSS custom properties, so palette() pulls them off
// the root element once per theme and hands the drawing code plain strings.

export const THEMES = ['system', 'light', 'dark'];
const KEY = 'mc-theme';

export function resolveTheme(pref, systemPrefersDark) {
  if (pref === 'dark' || pref === 'light') return pref;
  return systemPrefersDark ? 'dark' : 'light';
}

export function readPreference(storage = globalThis.localStorage) {
  try {
    const stored = storage?.getItem(KEY);
    return THEMES.includes(stored) ? stored : 'system';
  } catch {
    return 'system'; // private mode / blocked storage
  }
}

export function writePreference(pref, storage = globalThis.localStorage) {
  try {
    storage?.setItem(KEY, THEMES.includes(pref) ? pref : 'system');
  } catch { /* not being able to remember it is survivable */ }
}

// --- the live side: applying a theme and telling the canvases to repaint ----

const listeners = new Set();
let cachedPalette = null;

// Colours the canvases need. Each maps to a CSS custom property so a single
// palette block in the stylesheet drives both the DOM and the drawings.
const PALETTE_VARS = {
  ink: '--ink',
  muted: '--muted',
  grid: '--chart-grid',
  gridStrong: '--line-strong',
  primary: '--primary',
  onPrimary: '--on-primary',
  good: '--good',
  off: '--off',
  bad: '--bad',
  sharp: '--sharp',
  flat: '--flat',
  goodFill: '--chart-good-fill',
  sharpFill: '--chart-sharp-fill',
  flatFill: '--chart-flat-fill',
  wave: '--chart-wave',
  tickMinor: '--chart-tick-minor',
};

export function palette(doc = document) {
  if (cachedPalette) return cachedPalette;
  const cs = getComputedStyle(doc.documentElement);
  const out = {};
  for (const [key, cssVar] of Object.entries(PALETTE_VARS)) {
    out[key] = cs.getPropertyValue(cssVar).trim();
  }
  cachedPalette = out;
  return out;
}

// Anything that paints to a canvas registers here and gets called after a
// theme switch. Returns an unsubscribe so views can clean up.
export function onThemeChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function systemPrefersDark() {
  return globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

export function applyTheme(pref, doc = document) {
  const resolved = resolveTheme(pref, systemPrefersDark());
  doc.documentElement.dataset.theme = resolved;
  cachedPalette = null; // the CSS variables just changed under us

  // The installed PWA reads this for the status bar, so keep it in step.
  const meta = doc.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute('content', getComputedStyle(doc.documentElement).getPropertyValue('--bg').trim());
  }
  for (const fn of listeners) fn(resolved);
  return resolved;
}

// Call once at startup: apply the stored preference and keep following the
// system if that's what the user chose.
export function initTheme(doc = document) {
  const pref = readPreference();
  applyTheme(pref, doc);
  globalThis.matchMedia?.('(prefers-color-scheme: dark)')
    .addEventListener?.('change', () => {
      if (readPreference() === 'system') applyTheme('system', doc);
    });
  return pref;
}
