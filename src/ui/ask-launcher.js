import { listRecordingsWithStats } from '../store/db.js';

// The button in the corner and the sheet it opens. The card inside the sheet is
// ui/ask.js and nothing about it changed: this file only decides when it is
// shown. ask.js is loaded the first time the sheet opens, not with the app —
// it is 114 kB (41 kB gzipped) that a player who never asks never needs.

export function initAskLauncher() {
  const fab = document.querySelector('#ask-fab');
  const sheet = document.querySelector('#ask-sheet');
  const backdrop = document.querySelector('#ask-backdrop');
  const close = document.querySelector('#ask-close');
  if (!fab || !sheet || !backdrop) return;

  let opener = null;
  const isOpen = () => !sheet.hidden;

  async function open() {
    if (isOpen()) return;
    opener = document.activeElement;
    sheet.hidden = false;
    backdrop.hidden = false;
    fab.hidden = true;
    fab.setAttribute('aria-expanded', 'true');
    document.documentElement.dataset.askOpen = '';
    // Drawn before the data arrives; the card says what it needs when there is
    // nothing to ask about, and a failed load leaves it as drawn.
    let library = [];
    try { library = await listRecordingsWithStats(); } catch { /* blocked IndexedDB: treated as no takes */ }
    try {
      const { renderAsk } = await import('./ask.js');
      await renderAsk(document, library);
    } catch { /* offline with a cold cache: the card stays as drawn */ }
    const input = document.querySelector('#ask-input');
    if (isOpen()) (input && !input.disabled ? input : close)?.focus({ preventScroll: true });
  }

  function shut() {
    if (!isOpen()) return;
    sheet.hidden = true;
    backdrop.hidden = true;
    fab.hidden = false;
    fab.setAttribute('aria-expanded', 'false');
    delete document.documentElement.dataset.askOpen;
    (opener && opener.isConnected ? opener : fab).focus?.({ preventScroll: true });
    opener = null;
  }

  fab.addEventListener('click', open);
  close?.addEventListener('click', shut);
  backdrop.addEventListener('click', shut);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen()) { e.preventDefault(); shut(); }
  });
}
