// The settings sheet: display preferences that belong to the whole app rather
// than to any one tab. Everything here persists to localStorage and is stamped
// on <html> so the inline head script can restore it before the first paint.

import { readPreference, writePreference, applyTheme, initTheme } from './theme.js';

const MOTION_KEY = 'mc-motion';

function readMotion() {
  try {
    return globalThis.localStorage?.getItem(MOTION_KEY) === 'off' ? 'off' : 'on';
  } catch {
    return 'on';
  }
}

function writeMotion(value) {
  try {
    globalThis.localStorage?.setItem(MOTION_KEY, value);
  } catch { /* survivable */ }
}

// A segmented radiogroup: one button carries aria-checked at a time.
function wireSegment(group, attr, current, onPick) {
  const buttons = [...group.querySelectorAll(`[${attr}]`)];
  const paint = (value) => {
    for (const b of buttons) b.setAttribute('aria-checked', String(b.getAttribute(attr) === value));
  };
  paint(current);
  for (const b of buttons) {
    b.addEventListener('click', () => {
      const value = b.getAttribute(attr);
      paint(value);
      onPick(value);
    });
  }
}

export function initSettings(doc = document) {
  const pref = initTheme(doc);

  const dialog = doc.querySelector('#settings-dialog');
  const openBtn = doc.querySelector('#settings-btn');
  if (!dialog || !openBtn) return;

  openBtn.addEventListener('click', () => dialog.showModal());

  wireSegment(doc.querySelector('#theme-seg'), 'data-theme-pick', pref, (value) => {
    writePreference(value);
    applyTheme(value, doc);
  });

  const motion = readMotion();
  doc.documentElement.dataset.motion = motion;
  wireSegment(doc.querySelector('#motion-seg'), 'data-motion-pick', motion, (value) => {
    writeMotion(value);
    doc.documentElement.dataset.motion = value;
  });
}

export { readPreference as readThemePreference };
