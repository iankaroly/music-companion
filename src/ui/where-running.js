// WHERE THIS COPY OF THE APP IS RUNNING — and why the answer has three values
// and not two.
//
// The app ships three ways and only two of them are a browser: the site in
// Safari, the site added to the Home Screen, and the App Store build, which is
// a WKWebView Capacitor serves from `capacitor://localhost`. Every sentence
// that tells somebody where to go and switch the microphone on depends on
// telling those three apart, and getting it wrong is worse than saying nothing:
// Settings → Safari → Microphone is not the switch holding the native app
// shut, and sending somebody there costs them ten minutes at a toggle that was
// always right.
//
// THE TEST ORDER IS THE POINT. `navigator.standalone` is a Safari-only property
// and is undefined inside a WKWebView, and nothing in @capacitor/ios sets
// `display-mode: standalone` — so a two-way test written on those two alone
// reads the App Store build as a browser. The protocol is the only witness that
// is definitely there: `capacitor.config.json` names no `iosScheme`, and
// CAPInstanceDescriptor.swift's default is "capacitor", so the shipped app
// loads from `capacitor:`. It is tested FIRST for that reason.
//
// This was already known once, in the tuner's Listen note, and the fix was
// written inline there and never propagated: the settings sheet's microphone
// report and both pieces of mic-failure advice kept the two-way test and kept
// telling the App Store build it was a browser. It is one function now so
// there is one place left to get it wrong.

export const APP = 'app'; // the App Store build: a WKWebView, no browser around it
export const HOME_SCREEN = 'home-screen'; // the site added to the Home Screen
export const BROWSER = 'browser'; // the site in Safari, with an address bar

/**
 * The decision, apart from the globals so it can be checked without one:
 * `protocol` from location, `standalone` from navigator, `displayStandalone`
 * from `matchMedia('(display-mode: standalone)').matches`.
 */
export function whereRunning({ protocol, standalone, displayStandalone } = {}) {
  if (protocol === 'capacitor:') return APP;
  if (standalone === true || displayStandalone === true) return HOME_SCREEN;
  return BROWSER;
}

/** The same decision, read off this device. */
export function runningIn() {
  return whereRunning({
    protocol: globalThis.location?.protocol,
    standalone: globalThis.navigator?.standalone,
    displayStandalone: globalThis.matchMedia?.('(display-mode: standalone)')?.matches === true,
  });
}

/** True wherever the app was installed rather than merely visited — either way. */
export function installed(where = runningIn()) {
  return where !== BROWSER;
}

/** What the settings sheet calls this place, in its own report. */
export function placeName(where = runningIn()) {
  if (where === APP) return 'The installed app';
  if (where === HOME_SCREEN) return 'Added to the home screen';
  return 'Running in the browser';
}
