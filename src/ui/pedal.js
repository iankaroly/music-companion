// The foot pedal.
//
// Every Bluetooth page turner sold to musicians — AirTurn, PageFlip, Donner,
// iRig BlueTurn — is a KEYBOARD. It pairs as one, and each pedal sends a
// keystroke: arrows in one mode, page up and page down in another, space and
// return in a third, and a few send letters. There is no pairing to do here and
// no driver to write; the pedal is already talking, and all a reader has to do
// is listen for the right keys.
//
// (Web Bluetooth, which would let a page talk to a device directly, does not
// exist in Safari and so does not exist on an iPad. It would be the wrong tool
// anyway: a keyboard works with everything, needs no permission, and keeps
// working when this app is not the thing in front.)
//
// So two things. The keys every pedal on the market sends are understood out of
// the box, and anything else can be TAUGHT — press the pedal once and whatever
// it sent is the pedal from then on. That covers the ones with their own idea
// of what a page turn is, and the ones that can be reprogrammed.

const KEY = 'pagePedal';

// What the pedals send, by mode, across the pedals people actually own.
// Space and Enter are here because that is one of AirTurn's modes; the reader
// stands them down whenever anything is being typed into.
export const DEFAULT_FORWARD = ['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'];
export const DEFAULT_BACK = ['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'];

function stored() {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    const saved = raw ? JSON.parse(raw) : null;
    return saved && typeof saved === 'object' ? saved : {};
  } catch {
    return {};   // private mode, or something else's data under our key
  }
}

// A pedal press, as something that can be compared and stored. `code` is the
// physical key and survives layouts; `key` is what a pedal sending a letter
// gives. Either will do, so both are kept.
export function pressOf(event) {
  return { code: event.code || null, key: event.key || null };
}

export function taught() {
  const saved = stored();
  return {
    forward: saved.forward ?? null,
    back: saved.back ?? null,
  };
}

export function teach(direction, press) {
  const saved = { ...stored(), [direction]: press };
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(saved));
  } catch { /* survivable: the built-in keys still work */ }
  return saved;
}

export function forgetPedal() {
  try {
    globalThis.localStorage?.removeItem(KEY);
  } catch { /* nothing to forget */ }
}

const matches = (press, event) => !!press
  && ((press.code && press.code === event.code) || (press.key && press.key === event.key));

// Which way this keystroke turns the page, if it turns it at all. A pedal that
// has been taught wins over the built-in keys, so teaching Space to go BACK
// does not leave it also going forward.
export function pageTurn(event, mapping = taught()) {
  if (matches(mapping.forward, event)) return 'forward';
  if (matches(mapping.back, event)) return 'back';
  // A taught key must not also answer to its old meaning.
  const claimed = (list) => list.filter((k) => !matches(mapping.forward, { code: k, key: k })
    && !matches(mapping.back, { code: k, key: k }));
  if (claimed(DEFAULT_FORWARD).includes(event.key)) return 'forward';
  if (claimed(DEFAULT_BACK).includes(event.key)) return 'back';
  return null;
}

// How to describe a press to somebody who has just made it.
export function pressName(press) {
  if (!press) return 'not set';
  const named = { ' ': 'Space', ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓' };
  return named[press.key] ?? (press.key?.length === 1 ? press.key.toUpperCase() : press.key)
    ?? press.code ?? 'a key';
}
