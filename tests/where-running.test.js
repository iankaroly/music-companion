import { describe, it, expect } from 'vitest';
import {
  APP, HOME_SCREEN, BROWSER, whereRunning, installed, placeName,
} from '../src/ui/where-running.js';

// The state a Capacitor WKWebView is actually in: no navigator.standalone (a
// Safari-only property), no display-mode: standalone (nothing in @capacitor/ios
// sets it), and `capacitor:` as the protocol.
const nativeApp = { protocol: 'capacitor:', standalone: undefined, displayStandalone: false };
const homeScreenSafari = { protocol: 'https:', standalone: true, displayStandalone: false };
const homeScreenByDisplay = { protocol: 'https:', standalone: undefined, displayStandalone: true };
const safari = { protocol: 'https:', standalone: false, displayStandalone: false };

describe('where the app is running', () => {
  // THE BUG: read as BROWSER, this sends the App Store build to Settings →
  // Safari → Microphone, which does not govern the WKWebView.
  it('knows the App Store build from its protocol alone', () => {
    expect(whereRunning(nativeApp)).toBe(APP);
  });

  it('knows a home-screen app either way it announces itself', () => {
    expect(whereRunning(homeScreenSafari)).toBe(HOME_SCREEN);
    expect(whereRunning(homeScreenByDisplay)).toBe(HOME_SCREEN);
  });

  it('calls the site in a browser a browser', () => {
    expect(whereRunning(safari)).toBe(BROWSER);
    expect(whereRunning({ protocol: 'http:' })).toBe(BROWSER);
    expect(whereRunning()).toBe(BROWSER);
  });

  // capacitor: wins even if a future WebKit starts reporting standalone too,
  // because the native app's switch is its own and not Safari's.
  it('reads the native app as the native app whatever else is set', () => {
    expect(whereRunning({ protocol: 'capacitor:', standalone: true, displayStandalone: true }))
      .toBe(APP);
  });

  it('still groups both installed places together where that is the question', () => {
    expect(installed(APP)).toBe(true);
    expect(installed(HOME_SCREEN)).toBe(true);
    expect(installed(BROWSER)).toBe(false);
  });
});

describe('what the settings sheet calls each place', () => {
  it('never calls the App Store build a browser', () => {
    expect(placeName(APP)).toBe('The installed app');
    expect(placeName(HOME_SCREEN)).toBe('Added to the home screen');
    expect(placeName(BROWSER)).toBe('Running in the browser');
  });
});
