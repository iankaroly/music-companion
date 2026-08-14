// The feeling of a thing having happened.
//
// The reader already asked for this once — a single `navigator.vibrate(8)` on
// the hold that snaps a shape straight — and on the only hardware this app is
// built for, that line does nothing whatsoever. iOS has never implemented the
// Vibration API, in Safari or in the WKWebView a Capacitor app runs inside. So
// the one place the app tried to answer a gesture with a feeling was answering
// it on Android and on nothing else.
//
// The Taptic Engine is reachable, though, and only through the native side.
// This is the one door to it.
//
// WHAT GETS ONE, AND WHAT DOES NOT
//
// From Apple's own rules for combining senses:
//
//   causality — it has to be obvious what caused it. So a tap fires on the
//     thing committing, not on the touch that asked, and never on a timer.
//   harmony  — the feeling and the sight of it happen on the same frame. A
//     haptic that trails its own animation reads as a second event.
//   utility  — only where it earns its place. This is the rule that decides
//     what is NOT in the list below: a metronome that buzzes on every beat is
//     two taps a second at 120, which is not feedback, it is a texture, and
//     within a minute it is one you have stopped feeling. If a haptic click
//     is wanted it should be a setting somebody turns on, not the default.
//
// So: four moments, all of them discrete, all of them something the player
// did rather than something the app decided.
const STYLES = {
  // A mark landing on the page. Light — it is a pencil, not a stamp press.
  place: 'light',
  // A shape snapping straight under a held finger. This is the one that was
  // already asking, and it is the most physical thing in the reader: a line
  // you drew has just become a line somebody engraved.
  snap: 'medium',
  // A page committing. Frequent, so the lightest thing available — the
  // detent of a picker rather than a knock.
  turn: 'selection',
  // The page refusing to grow any further. Pairs with the rubber-band: the
  // resistance is the picture and this is the sound of it.
  edge: 'light',
};

// Vibration lengths for the browsers that do have the API, roughly matched to
// the weights above. Android only in practice, which is fine — it is a
// fallback, not the target.
const MILLIS = { light: 8, medium: 14, selection: 5 };

let native = null;      // the plugin, once it has been found
let looked = false;     // …and whether looking has been done at all
let on = true;

// Asked for once, lazily, and never again.
//
// A static import would put the plugin in the main bundle for every browser
// that will never have it, and — worse — a build where the native side has not
// been synced yet would fail to resolve it at load and take the whole app down
// with it. Nothing here is important enough to be able to do that.
async function plugin() {
  if (looked) return native;
  looked = true;
  try {
    const mod = await import('@capacitor/haptics');
    // On a plain browser the plugin resolves and then throws "not implemented"
    // on every call, which is noise rather than an error. Only keep it where
    // there is a native side to talk to.
    const cap = globalThis.Capacitor;
    if (cap?.isNativePlatform?.() && mod?.Haptics) {
      native = { Haptics: mod.Haptics, ImpactStyle: mod.ImpactStyle };
    }
  } catch { /* no plugin, no native side, no feeling. The app is unchanged. */ }
  return native;
}

// Warmed up at a moment nobody is waiting on, so the first tap of a session is
// not the one that pays for resolving a module.
export function readyHaptics() {
  plugin().catch(() => {});
}

export function setHaptics(enabled) { on = !!enabled; }

// Say that something happened.
//
// Never awaited by a caller. A feeling that arrives a frame late is worth
// nothing, and a feeling that throws must not be able to take a page turn with
// it — so this returns immediately and swallows everything.
export function tap(what) {
  if (!on) return;
  const style = STYLES[what];
  if (!style) return;
  plugin().then((found) => {
    if (found) {
      const { Haptics, ImpactStyle } = found;
      if (style === 'selection') Haptics.selectionChanged().catch(() => {});
      else {
        Haptics.impact({
          style: style === 'medium' ? ImpactStyle.Medium : ImpactStyle.Light,
        }).catch(() => {});
      }
      return;
    }
    globalThis.navigator?.vibrate?.(MILLIS[style] ?? 8);
  }).catch(() => {});
}
