import { describe, it, expect, beforeEach, afterEach } from 'vitest';

// Where the app looks for the recogniser, and whether it may send the pages
// there without asking.
//
// This decides whether "scan it and it converts" happens at all. The first
// version looked for the service at 127.0.0.1 always — right on a laptop,
// useless on a phone, where 127.0.0.1 is the phone and there is no recogniser
// on a phone. Scanning on the phone therefore never converted anything.

import {
  omrUrl, setOmrUrl, isOwnMachine, isHosted, maySendFreely,
} from '../src/analysis/omr-client.js';

// Nothing is cached in the module: both of these read the page's location and
// the stored setting when they are asked, so one import is enough.
const load = async () => ({ omrUrl, setOmrUrl, isOwnMachine, isHosted, maySendFreely });

const setLocation = (href) => {
  const url = new URL(href);
  globalThis.window = {
    location: { protocol: url.protocol, hostname: url.hostname, href },
  };
};

beforeEach(() => {
  globalThis.localStorage = {
    store: new Map(),
    getItem(k) { return this.store.get(k) ?? null; },
    setItem(k, v) { this.store.set(k, v); },
    removeItem(k) { this.store.delete(k); },
  };
});
afterEach(() => {
  delete globalThis.window;
  delete globalThis.localStorage;
});

describe('finding the recogniser', () => {
  it('looks on the machine that served the app, so a phone finds the laptop', async () => {
    setLocation('http://192.168.1.50:5199/');
    const { omrUrl } = await load();
    expect(omrUrl()).toBe('http://192.168.1.50:4000');
  });

  it('looks at this machine when the app is being run on it', async () => {
    setLocation('http://localhost:5199/');
    const { omrUrl } = await load();
    expect(omrUrl()).toBe('http://127.0.0.1:4000');
  });

  it('uses the service that runs for everybody when the app is the deployed one', async () => {
    // A page on https cannot call a plain-http service — it is blocked as mixed
    // content — so the machine that served it is no use here. The hosted
    // recogniser is what a player on a phone actually has.
    setLocation('https://practicepartner.vercel.app/');
    const { omrUrl, isHosted } = await load();
    expect(omrUrl()).toBe('https://score-pipeline.fly.dev');
    expect(isHosted(omrUrl())).toBe(true);
  });

  it('sends to the hosted one without asking, and says so in Settings', async () => {
    // Typing an address is consent; so is the app shipping with one, provided
    // the app SAYS where the pages go — which the words under the field do.
    setLocation('https://practicepartner.vercel.app/');
    const { maySendFreely, omrUrl } = await load();
    expect(maySendFreely(omrUrl())).toBe(true);
    expect(maySendFreely('https://someone-elses-recogniser.example')).toBe(false);
  });

  it('lets a person say where it is instead', async () => {
    setLocation('http://192.168.1.50:5199/');
    const { omrUrl, setOmrUrl } = await load();
    setOmrUrl('http://studio-mac.local:4000');
    expect(omrUrl()).toBe('http://studio-mac.local:4000');
  });
});

describe('deciding whether the pages may go by themselves', () => {
  it('counts the machine that served the app as this machine', async () => {
    setLocation('http://192.168.1.50:5199/');
    const { isOwnMachine } = await load();
    expect(isOwnMachine('http://192.168.1.50:4000')).toBe(true);
    expect(isOwnMachine('http://127.0.0.1:4000')).toBe(true);
  });

  it('does not count somebody else, who has to be asked for', async () => {
    setLocation('http://192.168.1.50:5199/');
    const { isOwnMachine } = await load();
    expect(isOwnMachine('http://192.168.1.99:4000')).toBe(false);
    expect(isOwnMachine('https://omr.example.com')).toBe(false);
    expect(isOwnMachine('nonsense')).toBe(false);
  });
});
