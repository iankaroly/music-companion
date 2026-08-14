// The size the person reading this already asked for.
//
// Somebody who has turned text up on their phone has said something about
// their eyes, and every other app on the device heard it. This one did not:
// the root has always been whatever the browser's default happened to be, so
// the setting reached the app's own chrome exactly nowhere.
//
// It costs almost nothing to answer, because the answer was built in years
// ago by accident — there is not one fixed pixel font-size in the stylesheet
// and the spacing is in rem throughout, so moving the root moves the whole
// interface together rather than pushing text out of the boxes around it.
// That is the condition the whole idea rests on, and it already holds.
//
// WHY THIS IS NOT JUST `:root { font: -apple-system-body }`
//
// Two reasons, and the first one is a bug you would ship.
//
//   macOS Safari resolves -apple-system-body too, to THIRTEEN pixels. So the
//   one-line version quietly shrinks the entire desktop app by twenty per
//   cent, on a platform that never asked for anything. This is gated to touch
//   hardware for that reason and no other.
//
//   And the accessibility sizes run a very long way up — far enough that a
//   two-line label becomes five and a toolbar wraps into three rows. Honouring
//   the setting is right; honouring it without a ceiling is how you get an app
//   that respects your eyesight and then cannot be used. It is clamped, and
//   the clamp is generous: half again the default at the top.

const BASE = 16;        // what the root is when nobody has said otherwise
const FLOOR = 15;       // a shade smaller, for people who turned it down
const CEILING = 24;     // 1.5×, past which the layout stops being a layout

let probe = null;

// What the platform says "body text" is right now.
//
// Measured rather than assumed, because it is a live setting: it changes while
// the app is open, and the only honest way to know is to ask the engine to
// resolve the font and read back what it got.
function bodySize() {
  if (!CSS?.supports?.('font', '-apple-system-body')) return null;
  if (!probe) {
    probe = document.createElement('span');
    probe.setAttribute('aria-hidden', 'true');
    probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;'
      + 'top:-9999px;left:-9999px;font:-apple-system-body';
    document.documentElement.append(probe);
  }
  const size = parseFloat(getComputedStyle(probe).fontSize);
  return Number.isFinite(size) && size > 0 ? size : null;
}

// Touch hardware only — see the note above about macOS resolving this to 13px
// and silently shrinking a desktop that never asked.
function shouldFollow() {
  if (!globalThis.matchMedia?.('(pointer: coarse)')?.matches) return false;
  return (globalThis.navigator?.maxTouchPoints ?? 0) > 0;
}

function apply() {
  if (!shouldFollow()) return;
  const size = bodySize();
  if (size === null) return;
  // A resolved size a long way outside anything plausible means the probe
  // measured something else — leave the root alone rather than act on it.
  if (size < 8 || size > 80) return;
  const want = Math.max(FLOOR, Math.min(CEILING, size));
  const now = parseFloat(getComputedStyle(document.documentElement).fontSize);
  if (Math.abs(now - want) < 0.5) return;
  document.documentElement.style.fontSize = `${want}px`;
  // Anything that measured the page in pixels measured it against the old
  // root. Said out loud so the canvases can re-measure rather than each
  // growing its own way of noticing.
  document.dispatchEvent(new CustomEvent('text-size', { detail: { size: want } }));
}

// Followed rather than read once.
//
// iOS does not tell a web view that the text size changed; it changes what the
// font resolves to and says nothing. But the change is always made in Settings,
// which means leaving this app and coming back to it — so the return IS the
// notification, and it is the only one there is.
export function followTextSize() {
  apply();
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) apply();
  });
  globalThis.addEventListener?.('pageshow', apply);
  // A rotation or a split-view resize is another moment the platform may have
  // resolved things differently, and it is cheap to ask again.
  globalThis.addEventListener?.('resize', apply);
}

// For the check, and for anything that wants to know what was decided.
export function textSizeNow() {
  return {
    following: shouldFollow(),
    body: bodySize(),
    root: parseFloat(getComputedStyle(document.documentElement).fontSize),
    base: BASE,
  };
}
