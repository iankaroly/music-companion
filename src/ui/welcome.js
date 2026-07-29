// First run.
//
// The app used to open on a tuner dial and the word "listening", which tells a
// new player nothing about why there are five tabs or what the coach is for.
// One screen, shown once: what this does, what you play, and what is behind
// each tab. Choosing an instrument here is the point — it is what stops the
// reports from talking to a flutist about shifts.

import { INSTRUMENTS, instrument, saveInstrument, instrumentChosen } from '../analysis/instruments.js';

export function initWelcome(doc = document, { onDone } = {}) {
  const screen = doc.querySelector('#welcome');
  if (!screen) return;
  if (instrumentChosen()) { screen.remove(); return; }

  const group = doc.querySelector('#welcome-instruments');
  const paint = () => {
    for (const b of group.querySelectorAll('[data-instrument]')) {
      b.setAttribute('aria-checked', String(b.dataset.instrument === instrument().id));
    }
  };
  group.replaceChildren(...INSTRUMENTS.map((i) => {
    const b = doc.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.dataset.instrument = i.id;
    b.innerHTML = `${i.label}<small>${i.examples}</small>`;
    b.addEventListener('click', () => { saveInstrument(i.id); paint(); });
    return b;
  }));
  paint();

  screen.hidden = false;
  // The button is the only way out, and it is also the first user gesture the
  // page gets — which is what the audio context wants before it can be resumed.
  doc.querySelector('#welcome-start').addEventListener('click', () => {
    // Choosing nothing is choosing the default; write it so the screen is done.
    saveInstrument(instrument().id);
    screen.remove();
    onDone?.(instrument());
  });
}
