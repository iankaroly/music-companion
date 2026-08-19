// The Ask panel, driven the way a player drives it — and the one sentence it
// has to be able to prove: NOTHING LEAVES THIS DEVICE UNTIL YOU TURN IT ON AND
// ASK SOMETHING.
//
// Every request to /api/ask is intercepted and answered here, so this check
// needs no key and sends nothing anywhere. What it reads is the BODY the app
// tried to send: whether a request happened at all, and what was in it. A panel
// that appeared is not the thing being tested — an earlier version of this
// check asserted exactly that and would have passed over a digest that carried
// the audio.
//
//   npm run dev            (in another terminal, on port 5199)
//   node tools/ask-check.mjs
//
import puppeteer from 'puppeteer-core';

// The headless SHELL rather than the Chrome app: launching the app puts a
// bouncing icon in the Dock every time this runs.
const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const PORT = process.env.PORT ?? '5199';

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

const browser = await puppeteer.launch({ executablePath: SHELL, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
// A phone, because that is the tight case: the tab bar nearly spans the width
// there, so the button has nowhere to go but above it.
const SIZE = process.env.WIDE ? { width: 900, height: 1200 } : { width: 390, height: 844 };
await page.setViewport({ ...SIZE, deviceScaleFactor: 2 });

// Every ask is answered from here. The bodies are kept so the check can read
// what the app tried to send.
const sent = [];
await page.setRequestInterception(true);
page.on('request', (req) => {
  if (!req.url().endsWith('/api/ask')) { req.continue(); return; }
  sent.push(JSON.parse(req.postData() ?? '{}'));
  req.respond({
    status: 200,
    contentType: 'text/plain; charset=utf-8',
    body: 'The F sharp at 1.2 s sat 30 cents sharp, and so did the one at 7.2 s.',
  });
});

const open = async (askSetting) => {
  await page.evaluateOnNewDocument((value) => {
    localStorage.setItem('askEnabled', value);
  }, askSetting);
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
  await new Promise((r) => setTimeout(r, 1400));
  await page.evaluate(() => {
    document.querySelector('#welcome')?.remove();
    document.querySelector('#welcome-card')?.remove();
  });
  // The review lives on the Record tab, and a button on a hidden tab panel is
  // not a button anybody can press — puppeteer says so out loud, which is the
  // only reason this line is here rather than a silent pass.
  await page.click('.tab-btn[data-tab="analyze"]');
  await new Promise((r) => setTimeout(r, 400));
};

// A take, rendered through the app's own review: a D major scale with every
// F sharp 30 cents sharp, and readings inside each note so the landing section
// exists. NO MICROPHONE ANYWHERE IN THIS FILE and none may ever be added.
const renderTake = (shift = 0) => page.evaluate(async (offset) => {
  const { renderFreeReview } = await import('/src/ui/report.js');
  const A4 = 440;
  const scale = [62, 64, 66, 67, 69, 71, 73, 74, 73, 71, 69, 67, 66, 64, 62, 64, 66, 67];
  const NAMES = { 62: 'D4', 64: 'E4', 66: 'F#4', 67: 'G4', 69: 'A4', 71: 'B4', 73: 'C#5', 74: 'D5' };
  const notes = scale.map((midi, i) => {
    const start = i * 0.6 + offset;
    return {
      start, end: start + 0.45, midi, name: NAMES[midi], cents: midi % 12 === 6 ? 30 : 1,
    };
  });
  const readings = [];
  for (const n of notes) {
    for (let t = n.start; t < n.end; t += 0.0116) {
      readings.push({
        time: t, confidence: 0.9,
        frequency: A4 * 2 ** ((n.midi + n.cents / 100 - 69) / 12),
      });
    }
  }
  renderFreeReview(document, notes, null, { readings, a4: A4 });
  await new Promise((r) => setTimeout(r, 300));
  return notes.length;
}, shift);

// --- 1. off is off -----------------------------------------------------------
await open('off');
await renderTake();
check('with the setting off there is no button at all',
  await page.evaluate(() => document.querySelector('#ask-fab')?.hidden !== false));
check('and nothing was sent', sent.length === 0, `${sent.length} requests`);

// --- 2. on, but silent until asked -------------------------------------------
await open('on');
const count = await renderTake();
check('with the setting on the button is on the edge of the app',
  await page.evaluate(() => document.querySelector('#ask-fab')?.hidden === false),
  `${count} notes rendered`);
check('the chat is shut until the button is pressed',
  await page.evaluate(() => document.querySelector('#ask-pop').hidden === true));
check('opening a review still sends nothing', sent.length === 0, `${sent.length} requests`);

// THE TABS ARE HOW YOU MOVE AROUND THE APP and nothing may sit on top of them.
// The button floats over the same corner, so this is measured rather than
// eyeballed once and assumed.
const clearance = await page.evaluate(() => {
  const f = document.querySelector('#ask-fab').getBoundingClientRect();
  const nav = document.querySelector('nav[role=tablist]').getBoundingClientRect();
  const gap = Math.round(nav.top - f.bottom);
  const overlaps = !(f.right < nav.left || f.left > nav.right || f.bottom < nav.top || f.top > nav.bottom);
  return { gap, overlaps, bottom: Math.round(f.bottom), height: window.innerHeight };
});
check('the button never covers the tab bar',
  !clearance.overlaps && clearance.bottom <= clearance.height,
  `${clearance.gap}px above it`);

// --- 3. asking ---------------------------------------------------------------
await page.click('#ask-fab');
await page.waitForFunction(() => document.querySelector('#ask-pop').hidden === false);
check('pressing the button opens the chat',
  await page.evaluate(() => document.querySelector('#ask-fab').getAttribute('aria-expanded') === 'true'));
await page.type('.ask-field', 'Which notes went sharp?');
await page.click('.ask-send');
await page.waitForFunction(() => document.querySelectorAll('.ask-bubble').length >= 2
  && document.querySelectorAll('.ask-bubble')[1].textContent !== '…', { timeout: 6000 });

check('asking sends exactly one request', sent.length === 1, `${sent.length} requests`);
const body = sent[0] ?? {};
check('the question is in it', body.question === 'Which notes went sharp?', body.question);
check('the digest carries the notes it will be asked about',
  (body.digest ?? '').includes('F#4 +30c'),
  `${(body.digest ?? '').length} characters`);
check('the digest carries the pulse the app inferred',
  /implied 10[01] bpm/.test(body.digest ?? ''));
check('the saved library goes with it, so "better than last week" is answerable',
  typeof body.library === 'string' && body.library.length > 0,
  JSON.stringify((body.library ?? '').slice(0, 40)));

// THE ONE THAT MATTERS. Anything that could reconstruct the sound — the audio,
// the frame-by-frame readings, a sample rate — must not be in what was sent.
const asText = JSON.stringify(body);
check('NO AUDIO AND NO READINGS LEFT THE DEVICE',
  !/"audio"|"readings"|"sampleRate"|"frequency"|"confidence"/.test(asText),
  `${asText.length} characters sent in total`);

check('the answer is shown where the question was asked',
  await page.evaluate(() => document.querySelectorAll('.ask-bubble')[1].textContent.includes('30 cents sharp')));

// --- 4. a second question keeps the thread -----------------------------------
await page.type('.ask-field', 'And the timing?');
await page.click('.ask-send');
// Waiting on the BUBBLE count would race the request: the panel draws both
// bubbles before it fetches, so a check that counts them can read `sent` before
// the request has left. Wait on the answer arriving instead.
await page.waitForFunction(() => {
  const bubbles = document.querySelectorAll('.ask-bubble');
  return bubbles.length >= 4 && bubbles[3].textContent !== '…';
}, { timeout: 6000 });
check('a follow-up carries the conversation with it',
  (sent[1]?.history ?? []).length === 2,
  `${(sent[1]?.history ?? []).length} earlier turns`);

// --- 4b. it closes the way a pop-over has to ---------------------------------
await page.keyboard.press('Escape');
check('Escape closes it',
  await page.evaluate(() => document.querySelector('#ask-pop').hidden === true));
await page.click('#ask-fab');
await page.mouse.click(20, 20);
check('and so does pressing anything else',
  await page.evaluate(() => document.querySelector('#ask-pop').hidden === true));
await page.click('#ask-fab');

// --- 4c. the setting is believed the moment it changes -----------------------
await page.evaluate(() => {
  localStorage.setItem('askEnabled', 'off');
  document.dispatchEvent(new CustomEvent('settings-change', { detail: { key: 'askEnabled' } }));
});
check('turning the setting off takes the button away without a reload',
  await page.evaluate(() => document.querySelector('#ask-fab').hidden === true
    && document.querySelector('#ask-pop').hidden === true));
await page.evaluate(() => {
  localStorage.setItem('askEnabled', 'on');
  document.dispatchEvent(new CustomEvent('settings-change', { detail: { key: 'askEnabled' } }));
});
await page.click('#ask-fab');

// --- 5. a second, unsaved take is a different conversation -------------------
//
// Both takes are unsaved and neither has an id, which is exactly the case that
// used to carry take A's transcript into take B: the model would answer about a
// recording that was no longer on the screen.
await renderTake(0.25);
check('a different take clears the transcript',
  await page.evaluate(() => document.querySelectorAll('.ask-bubble').length === 0),
  `${await page.evaluate(() => document.querySelectorAll('.ask-bubble').length)} bubbles left`);
check('and re-rendering the SAME take does not',
  await (async () => {
    await page.type('.ask-field', 'anything');
    await page.click('.ask-send');
    await page.waitForFunction(() => {
      const bubbles = document.querySelectorAll('.ask-bubble');
      return bubbles.length >= 2 && bubbles[1].textContent !== '…';
    });
    await renderTake(0.25);
    return page.evaluate(() => document.querySelectorAll('.ask-bubble').length >= 2);
  })());

// --- 6. the chat stays on the screen, whatever is in it ----------------------
//
// It is anchored to the bottom right and grows upward, so a long conversation
// is the case that pushes its head off the top of the display.
await page.evaluate(() => {
  const list = document.querySelector('.ask-log');
  for (let i = 0; i < 20; i++) {
    const row = document.createElement('div');
    row.className = 'ask-turn ask-app';
    row.innerHTML = '<div class="ask-bubble">a long answer about the third phrase, twenty times over</div>';
    list.appendChild(row);
  }
});
await new Promise((r) => setTimeout(r, 200));
const box = await page.evaluate(() => {
  const p = document.querySelector('#ask-pop').getBoundingClientRect();
  const nav = document.querySelector('nav[role=tablist]').getBoundingClientRect();
  return {
    top: Math.round(p.top), bottom: Math.round(p.bottom), left: Math.round(p.left),
    navTop: Math.round(nav.top), h: window.innerHeight, w: window.innerWidth,
  };
});
check('a long conversation never pushes the chat off the screen',
  box.top >= 0 && box.bottom <= box.h && box.left >= 0 && box.bottom <= box.navTop,
  `top ${box.top}, bottom ${box.bottom}, window ${box.h}, tab bar at ${box.navTop}`);

const failed = results.filter((r) => !r.pass);
console.log(failed.length ? `\n${failed.length} FAILED` : '\nALL PASS');
await browser.close();
process.exit(failed.length ? 1 : 0);
