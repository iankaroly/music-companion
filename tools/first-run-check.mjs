// THE TWO SCREENS EVERY NEW PLAYER MEETS, AND NOTHING ELSE HERE TOUCHES.
//
// Every other browser check in this repo begins by deleting the welcome screen
// —  `document.querySelector('#welcome')?.remove()` — and every check that
// records installs a fake microphone that grants itself permission. Both are
// right for what those checks are about, and together they mean the FIRST TWO
// THINGS a new install does had no coverage at all:
//
//   1. the welcome screen on an empty device, and getting past it
//   2. pressing Record and saying no to the microphone
//
// The second is the one that matters. This app opens on "tap Record"; if a
// refusal leaves a dead button, a stuck spinner or a silent screen, that is the
// first thing a new player sees and the last thing they do.
//
// NO REAL DEVICE IS EVER OPENED. `getUserMedia` is replaced with one that
// rejects exactly as a browser does on a refusal, which is both safer and more
// deterministic than driving a permission prompt.
//
//   npm run dev            (on 5199)
//   npm run app:first
//
import puppeteer from 'puppeteer-core';

const APP = process.env.APP ?? 'http://localhost:5199';
const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

const browser = await puppeteer.launch({
  executablePath: SHELL,
  headless: true,
  args: ['--no-sandbox'],
  protocolTimeout: 240000,
});

// ── A COLD DEVICE ───────────────────────────────────────────────────────────
// A fresh profile, so IndexedDB and localStorage are empty exactly as they are
// on a first install.
{
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await new Promise((r) => setTimeout(r, 1800));

  const first = await page.evaluate(() => {
    const screen = document.querySelector('#welcome');
    const shown = !!screen && !screen.hidden;
    return {
      shown,
      instruments: document.querySelectorAll('#welcome-instruments [data-instrument]').length,
      hasWayOut: !!document.querySelector('#welcome-start'),
      // A modal that a screen reader cannot see is a wall, not a screen.
      labelled: screen?.querySelector('[role="dialog"]')?.getAttribute('aria-modal') === 'true',
    };
  });
  check('a cold device opens on the welcome screen', first.shown && first.hasWayOut,
    `shown ${first.shown}, start button ${first.hasWayOut}`);
  check('…which offers instruments to choose from', first.instruments > 0,
    `${first.instruments} instruments`);
  check('…and is announced as a dialog rather than as a wall', first.labelled);

  const after = await page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    document.querySelector('#welcome-instruments [data-instrument]')?.click();
    document.querySelector('#welcome-start')?.click();
    await wait(600);
    return {
      gone: !document.querySelector('#welcome'),
      // The app behind it has to be a working app, not a blank one.
      tabs: document.querySelectorAll('.tab-btn').length,
      canRecord: !!document.querySelector('#start') && !document.querySelector('#start').disabled,
    };
  });
  check('choosing an instrument and starting puts the app in front of you',
    after.gone && after.tabs >= 5 && after.canRecord,
    `welcome gone ${after.gone}, ${after.tabs} tabs, Record pressable ${after.canRecord}`);

  // AND IT IS SHOWN ONCE. A welcome screen on every launch is a fault people
  // uninstall over, and the only thing standing between here and that is one
  // written setting — so the reload is the assertion.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await new Promise((r) => setTimeout(r, 1600));
  const again = await page.evaluate(() => {
    const screen = document.querySelector('#welcome');
    return { back: !!screen && !screen.hidden };
  });
  check('…and it does not come back on the next launch', !again.back);
  check('nothing was thrown on a cold start', errors.length === 0, errors.slice(0, 2).join(' | '));
  await page.close();
}

// ── AND THE MICROPHONE IS REFUSED ───────────────────────────────────────────
{
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  // Exactly what a browser hands back when somebody presses Don't Allow.
  await page.evaluateOnNewDocument(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(
      new DOMException('Permission denied', 'NotAllowedError'),
    );
  });
  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await new Promise((r) => setTimeout(r, 1800));

  const said = await page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    document.querySelector('#welcome-start')?.click();
    await wait(500);
    document.querySelector('.tab-btn[data-tab="analyze"]')?.click();
    await wait(400);

    const start = document.querySelector('#start');
    start.click();
    await wait(3500);

    return {
      status: (document.querySelector('#status')?.textContent ?? '').trim(),
      recNote: (document.querySelector('#rec-note')?.textContent ?? '').trim(),
      label: start.textContent.trim(),
      disabled: start.disabled,
      // A pause button left on screen is a take that looks like it is running.
      pauseShowing: !document.querySelector('#pause-rec')?.hidden,
    };
  });

  // Not merely that it says SOMETHING — that it says the way back. "Permission
  // denied" is the browser's word for it and tells a player nothing they can
  // act on, and this is the one screen where the player is the fix.
  check('a refused microphone says so, and says what to do about it',
    /allow/i.test(said.status) && /settings/i.test(said.status) && /record again/i.test(said.status),
    `status: "${said.status}"`);
  // Not a spinner and not a lie: the button has to be pressable again, because
  // the way out of a refusal is granting it and pressing Record a second time.
  check('…and the Record button is pressable again, not stuck',
    !said.disabled && !/stop/i.test(said.label),
    `label "${said.label}", disabled ${said.disabled}`);
  check('…and nothing is left on screen claiming a take is running',
    !said.pauseShowing, `pause showing ${said.pauseShowing}`);
  // And the app has to still BE an app afterwards — a refusal is not a state
  // to be stuck in. Its own step, because moving tab is not instantaneous.
  const stillWorks = await page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    document.querySelector('.tab-btn[data-tab="metronome"]')?.click();
    await wait(600);
    return document.querySelector('#tab-metronome')?.classList.contains('active') ?? false;
  });
  check('…and the rest of the app still works', stillWorks);
  check('nothing was thrown on a refusal', errors.length === 0, errors.slice(0, 2).join(' | '));
  await page.close();
}

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(failed.length ? `\n${failed.length} FAILED` : '\nALL PASS');
process.exit(failed.length ? 1 : 0);
