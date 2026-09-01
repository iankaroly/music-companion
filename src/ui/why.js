// What went wrong, in words, whatever was thrown.
//
// A player reported this: "when i uploaded a pdf i tried to open it and it said
// null and didnt work." Every user-facing message in the app was built the same
// way — `` `could not open that score: ${err.message}` `` — and that line has
// three ways of saying nothing:
//
//   - `err` is not an Error. A rejected fetch, a DOMException with no message,
//     a library that rejects with a string or with a plain object, or code that
//     does `reject(null)`: `err.message` is then undefined or null, and the
//     template prints it as "undefined" or "null".
//   - `err` is null. `err.message` THROWS — inside a catch block — so the
//     failure that was being reported is replaced by a second failure nobody
//     catches, and whatever was supposed to happen afterwards does not. A blank
//     page with no explanation is what that looks like.
//   - `err.message` is the empty string, which several DOMExceptions on Safari
//     are, and the player is told "could not open that score: ".
//
// So nothing formats an error by hand any more. This does it, it always returns
// something a person can act on, and it never returns "null".

// The name of the thing that went wrong, where the message is silent. A
// DOMException with no message is still a QuotaExceededError, and knowing that
// is the difference between "the app is broken" and "this device is full".
const NAMED = {
  QuotaExceededError: 'there is no room left on this device',
  NotAllowedError: 'the browser would not allow that',
  NotFoundError: 'that could not be found',
  NotReadableError: 'that file could not be read off the disk',
  SecurityError: 'the browser refused that for security',
  AbortError: 'that was interrupted before it finished',
  DataCloneError: 'that could not be stored on this device',
  InvalidStateError: 'the app was not in a state to do that',
  RangeError: 'that was too big for this device to hold',
};

/**
 * `err` may be anything at all: an Error, a DOMException, a string, an object,
 * undefined, null. Returns a sentence — never empty, never "null".
 *
 * `fallback` is what to say when the thrown thing carries no information of its
 * own, and it should describe the ACTION rather than the error: the caller
 * knows what it was trying to do and the error does not.
 */
export function why(err, fallback = 'something went wrong') {
  if (err === null || err === undefined) return fallback;
  // A thrown STRING that is itself the word "null" carries no more information
  // than a null does — and it is exactly what a template literal makes of one
  // somewhere further up. Treated as silence.
  if (typeof err === 'string') {
    const said = err.trim();
    return said && said !== 'null' && said !== 'undefined' ? said : fallback;
  }

  const message = typeof err?.message === 'string' ? err.message.trim() : '';
  const name = typeof err?.name === 'string' ? err.name.trim() : '';
  if (message && message !== 'null' && message !== 'undefined') {
    // The name as well, where it adds something the message does not. "not
    // enough memory" and "QuotaExceededError: not enough memory" are the same
    // sentence to a player, but a name with a silent message is all there is.
    return message;
  }
  if (name && NAMED[name]) return NAMED[name];
  if (name && name !== 'Error') return `${fallback} (${name})`;

  // A plain object, a number, a rejected promise carrying data rather than an
  // error. Anything that stringifies to something readable is better than
  // nothing; "[object Object]" is not, and is thrown away.
  const said = String(err ?? '').trim();
  if (said && said !== '[object Object]' && said !== 'null' && said !== 'undefined') return said;
  return fallback;
}

/**
 * The same thing, as a whole sentence: "could not open that score — the file is
 * locked". Kept apart from `why` so the two halves are not glued together in
 * twenty places, each slightly differently.
 */
export function saying(doing, err) {
  return `${doing} — ${why(err, 'no reason given')}`;
}

/**
 * What to say when a device was REFUSED rather than broken.
 *
 * A refusal is not an error, it is an answer, and it is the one failure in this
 * app where the PLAYER is the fix — so it needs the way back rather than the
 * browser's word for it. `why()` above prefers a thrown message over its own
 * name, and the message browsers throw here is "Permission denied": true, and
 * no use at all to somebody who has just pressed the app's one big button and
 * been told "mic unavailable — Permission denied".
 *
 * `thing` is what was refused, `again` is the press that retries it. Anything
 * that is not a refusal falls through to `saying`, because a camera that is
 * broken and a camera that was refused are not the same news.
 */
export function sayingRefused({ thing, again }, err, doing) {
  if (err?.name !== 'NotAllowedError') return saying(doing, err);
  return `the ${thing} was not allowed — turn it on for this app in your`
    + ` browser or phone settings, then ${again}`;
}
