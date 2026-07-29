// The settings sheet: preferences that belong to the whole app rather than to
// any one tab. Everything here persists to localStorage; the display ones are
// stamped on <html> so the inline head script can restore them before the
// first paint.
//
// Changes are announced as a `settings-change` event on the document rather
// than through callbacks, because this module is initialised before the tuner,
// the metronome or any chart exists — main.js listens and applies.

import { readPreference, writePreference, applyTheme, initTheme } from './theme.js';
import { getVolume, setVolume } from '../audio/context.js';
import { setIntonationTolerance } from './chart-utils.js';
import { micRetains, setMicRetains } from '../audio/capture.js';
import { refreshDroneLevel } from '../audio/drone.js';
import { storageReport, requestPersistence, exportLibrary, importLibrary } from '../store/db.js';

const MOTION_KEY = 'mc-motion';
const TOLERANCE_KEY = 'tolerance';
const AWAKE_KEY = 'keepAwake';

// Preferences only — the library, the presets and anything the player made
// stay put. "Restore defaults" that quietly deleted takes would be a trap.
const PREFERENCE_KEYS = [
  'mc-theme', MOTION_KEY, TOLERANCE_KEY, AWAKE_KEY, 'micRetain',
  'volume', 'droneLevel', 'clickLevel',
  'a4', 'tunerSettings', 'timbre', 'vizMode',
  'bpm', 'beatsPerBar', 'subdivision', 'trainer',
  'chartPxPerSec', 'chartMode', 'anyDrone', 'timingPulse', 'tab',
];

function read(key, fallback) {
  try {
    return globalThis.localStorage?.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch { /* private mode: not remembering it is survivable */ }
}

function announce(doc, key) {
  doc.dispatchEvent(new CustomEvent('settings-change', { detail: { key } }));
}

export function readTolerance() {
  const v = Number(read(TOLERANCE_KEY, '8'));
  return Number.isFinite(v) && v > 0 ? v : 8;
}

// A segmented radiogroup: one button carries aria-checked at a time.
function wireSegment(group, attr, current, onPick) {
  if (!group) return;
  const buttons = [...group.querySelectorAll(`[${attr}]`)];
  const paint = (value) => {
    for (const b of buttons) b.setAttribute('aria-checked', String(b.getAttribute(attr) === value));
  };
  paint(String(current));
  for (const b of buttons) {
    b.addEventListener('click', () => {
      const value = b.getAttribute(attr);
      paint(value);
      onPick(value);
    });
  }
}

// A labelled slider that shows its own value.
function wireLevel(root, id, { get, set, format }) {
  const input = root.querySelector(id);
  const out = root.querySelector(`${id}-out`);
  if (!input) return null;
  const paint = () => {
    if (out) out.textContent = format(Number(input.value));
    input._paintFill?.();
  };
  input.value = String(get());
  paint();
  input.addEventListener('input', () => { set(Number(input.value)); paint(); });
  return { sync: () => { input.value = String(get()); paint(); } };
}

// --- keep the screen awake --------------------------------------------------
//
// A practice app that dims the screen mid-étude is a practice app you put down.
// The lock is dropped whenever the tab is hidden (the browser insists) and
// taken again on return, so it survives a glance at something else.

let wakeLock = null;

function wantsAwake() {
  return read(AWAKE_KEY, 'off') === 'on';
}

async function acquireWakeLock() {
  if (!wantsAwake() || wakeLock || document.visibilityState !== 'visible') return;
  try {
    wakeLock = await navigator.wakeLock?.request('screen');
    wakeLock?.addEventListener?.('release', () => { wakeLock = null; });
  } catch { /* unsupported, or refused while backgrounded */ }
}

function releaseWakeLock() {
  wakeLock?.release?.().catch(() => {});
  wakeLock = null;
}

export function initSettings(doc = document) {
  const pref = initTheme(doc);
  setIntonationTolerance(readTolerance());

  const dialog = doc.querySelector('#settings-dialog');
  const openBtn = doc.querySelector('#settings-btn');
  if (!dialog || !openBtn) return;

  const levels = [];
  openBtn.addEventListener('click', () => {
    for (const l of levels) l?.sync(); // the tuner tab has its own volume slider
    dialog.showModal();
  });

  wireSegment(doc.querySelector('#theme-seg'), 'data-theme-pick', pref, (value) => {
    writePreference(value);
    applyTheme(value, doc);
  });

  const motion = read(MOTION_KEY, 'on') === 'off' ? 'off' : 'on';
  doc.documentElement.dataset.motion = motion;
  wireSegment(doc.querySelector('#motion-seg'), 'data-motion-pick', motion, (value) => {
    write(MOTION_KEY, value);
    doc.documentElement.dataset.motion = value;
  });

  wireSegment(doc.querySelector('#tolerance-seg'), 'data-tolerance', readTolerance(), (value) => {
    write(TOLERANCE_KEY, value);
    setIntonationTolerance(Number(value));
    announce(doc, 'tolerance');
  });

  wireSegment(doc.querySelector('#mic-seg'), 'data-mic', micRetains() ? 'on' : 'off', (value) => {
    setMicRetains(value === 'on');
  });

  wireSegment(doc.querySelector('#awake-seg'), 'data-awake', wantsAwake() ? 'on' : 'off', (value) => {
    write(AWAKE_KEY, value);
    if (value === 'on') acquireWakeLock();
    else releaseWakeLock();
  });

  levels.push(wireLevel(doc, '#set-volume', {
    get: getVolume,
    set: (v) => { setVolume(v); announce(doc, 'volume'); },
    format: (v) => `${Math.round((v / 1.6) * 100)}%`,
  }));
  levels.push(wireLevel(doc, '#set-drone', {
    get: () => Number(read('droneLevel', '1')),
    set: (v) => { write('droneLevel', String(v)); refreshDroneLevel(); },
    format: (v) => `${Math.round(v * 100)}%`,
  }));
  levels.push(wireLevel(doc, '#set-click', {
    get: () => Number(read('clickLevel', '1')),
    set: (v) => write('clickLevel', String(v)),
    format: (v) => `${Math.round(v * 100)}%`,
  }));

  // --- practice history: how big it is, and getting it off the device -------

  const mb = (bytes) => (bytes >= 1048576
    ? `${(bytes / 1048576).toFixed(bytes > 10485760 ? 0 : 1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`);

  const storageLine = doc.querySelector('#storage-line');
  const refreshStorage = async () => {
    if (!storageLine) return;
    try {
      const { takes, audioBytes, quota } = await storageReport();
      const persisted = await requestPersistence();
      const room = quota ? ` of about ${mb(quota)} available` : '';
      storageLine.textContent = takes === 0
        ? 'Nothing saved yet.'
        : `${takes} ${takes === 1 ? 'take' : 'takes'}, ${mb(audioBytes)} of audio${room}.`
          + (persisted ? ' Stored persistently.' : '');
    } catch {
      storageLine.textContent = 'Could not read storage.';
    }
  };
  levels.push({ sync: refreshStorage }); // refreshed whenever the sheet opens

  doc.querySelector('#set-backup')?.addEventListener('click', async () => {
    try {
      const backup = await exportLibrary();
      const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
      const a = doc.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `music-companion-history-${new Date(backup.exported).toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      announce(doc, 'backup');
    } catch (err) {
      storageLine.textContent = `Backup failed: ${err.message}`;
    }
  });

  const restoreInput = doc.querySelector('#restore-file');
  doc.querySelector('#set-restore')?.addEventListener('click', () => restoreInput?.click());
  restoreInput?.addEventListener('change', async () => {
    const file = restoreInput.files?.[0];
    restoreInput.value = '';
    if (!file) return;
    try {
      const { added, skipped } = await importLibrary(JSON.parse(await file.text()));
      storageLine.textContent = `Restored ${added} ${added === 1 ? 'take' : 'takes'}`
        + (skipped ? `, skipped ${skipped} already here.` : '.');
      announce(doc, 'library');
    } catch (err) {
      storageLine.textContent = `Restore failed: ${err.message}`;
    }
  });

  const reset = doc.querySelector('#set-reset');
  if (reset) {
    reset.addEventListener('click', () => {
      if (reset.dataset.armed !== 'yes') {
        // Two taps, no dialog: the first turns the button into the warning.
        reset.dataset.armed = 'yes';
        reset.textContent = 'Tap again to restore defaults';
        reset.classList.add('danger');
        setTimeout(() => {
          reset.dataset.armed = 'no';
          reset.textContent = 'Restore default settings';
          reset.classList.remove('danger');
        }, 4000);
        return;
      }
      for (const key of PREFERENCE_KEYS) {
        try { globalThis.localStorage?.removeItem(key); } catch { /* survivable */ }
      }
      location.reload();
    });
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') acquireWakeLock();
  });
  acquireWakeLock();
}

export { readPreference as readThemePreference };
