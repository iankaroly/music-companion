// THE PROMISE THE SERVICE WORKER MAKES IN ITS OWN FIRST LINE.
//
//   "the cached app shell keeps the whole tool working offline in the
//    practice room"
//
// That is the reason this app is worth adding to a home screen — a practice
// room is very often a room with no signal — and nothing checked it. It could
// not: the worker registered only on `https:`, so the one place it never ran
// was any way of running the app as it ships. It registers in a secure context
// now, which includes localhost, and stays off the dev server on purpose.
//
// This serves the REAL BUILD with `vite preview`, lets the worker take the page
// over, cuts the network at the browser, and reloads.
//
//   npm run app:offline          (builds and serves by itself)
//
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';

const PORT = Number(process.env.PREVIEW_PORT ?? 5200);
const APP = `http://localhost:${PORT}`;
const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

// `vite preview` serves dist, which is the build with DEV false — the only
// configuration in which the worker registers at all.
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'],
  { stdio: 'ignore', detached: false });
const bye = () => { try { server.kill('SIGTERM'); } catch { /* already gone */ } };
process.on('exit', bye);
process.on('SIGINT', () => { bye(); process.exit(130); });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await wait(2500);

const browser = await puppeteer.launch({
  executablePath: SHELL, headless: true, args: ['--no-sandbox'], protocolTimeout: 240000,
});
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

try {
  await page.goto(APP, { waitUntil: 'load' });

  // The worker has to be installed AND controlling before the network can be
  // cut; a page that is merely open is still being served by the server.
  const took = await page.evaluate(async () => {
    const wait2 = (ms) => new Promise((r) => setTimeout(r, ms));
    if (!('serviceWorker' in navigator)) return 'no serviceWorker in this browser';
    try {
      await navigator.serviceWorker.ready;
    } catch (e) { return `never became ready: ${e}`; }
    for (let i = 0; i < 100 && !navigator.serviceWorker.controller; i += 1) await wait2(100);
    return navigator.serviceWorker.controller ? 'controlling' : 'installed but never took the page';
  });
  check('the built app registers a service worker and it takes the page over',
    took === 'controlling', took);

  // Everything the shell needs has to have gone through the worker at least
  // once for the cache to hold it, so the app is used a little before the plug
  // is pulled: the tabs are the shell, and each one draws from a chunk.
  await page.evaluate(async () => {
    const wait2 = (ms) => new Promise((r) => setTimeout(r, ms));
    document.querySelector('#welcome-start')?.click();
    for (const tab of ['analyze', 'library', 'score', 'coach', 'metronome', 'tuner']) {
      document.querySelector(`.tab-btn[data-tab="${tab}"]`)?.click();
      await wait2(350);
    }
  });
  await wait(1200);

  // ── AND NOW THERE IS NO NETWORK ───────────────────────────────────────────
  await page.setOfflineMode(true);
  const offlineErrors = [];
  page.on('pageerror', (e) => offlineErrors.push(String(e)));
  await page.reload({ waitUntil: 'load' });
  await wait(2500);

  const alive = await page.evaluate(() => ({
    tabs: document.querySelectorAll('.tab-btn').length,
    // Not merely that HTML came back — that the SCRIPT ran. A cached shell with
    // a missing module is a blank screen that looks exactly like a served one.
    wired: !!document.querySelector('#start'),
    title: document.title,
    body: (document.body.textContent ?? '').trim().length,
  }));
  check('with the network cut, the app comes back at all',
    alive.tabs >= 5 && alive.body > 0, `${alive.tabs} tabs, ${alive.body} characters of page`);
  check('…and it is the app, not just its HTML — the scripts ran too',
    alive.wired, `Record button present: ${alive.wired}`);

  // The tuner and the metronome need no network and no stored take; they are
  // what "the whole tool works offline" has to mean at minimum.
  const usable = await page.evaluate(async () => {
    const wait2 = (ms) => new Promise((r) => setTimeout(r, ms));
    document.querySelector('#welcome-start')?.click();
    await wait2(300);
    document.querySelector('.tab-btn[data-tab="metronome"]')?.click();
    await wait2(500);
    const on = document.querySelector('#tab-metronome')?.classList.contains('active');
    document.querySelector('.tab-btn[data-tab="library"]')?.click();
    await wait2(500);
    return { metronome: !!on, library: !!document.querySelector('#tab-library')?.classList.contains('active') };
  });
  check('…and it can still be used offline — tabs move, panels draw',
    usable.metronome && usable.library, JSON.stringify(usable));
  check('nothing was thrown while offline', offlineErrors.length === 0,
    offlineErrors.slice(0, 2).join(' | '));
  check('nothing was thrown at all', errors.length === 0, errors.slice(0, 2).join(' | '));
} finally {
  await browser.close();
  bye();
}

const failed = results.filter((r) => !r.pass);
console.log(failed.length ? `\n${failed.length} FAILED` : '\nALL PASS');
process.exit(failed.length ? 1 : 0);
