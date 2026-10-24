// THE ASK CARD, ASKED REAL QUESTIONS THROUGH THE REAL SCREEN.
//
// The assistant underneath (src/ai) is unit-tested, and every line of that test
// would pass on an app where the card never opens, the send button is covered
// by something, or a reply that lied is shown to the player anyway. So this
// drives the Coach tab the way a hand does: a library seeded through the real
// db (saveRecording, with audio, notes and readings, so a tone question really
// decodes a take and runs qualityOf on it), a question typed and sent with
// Enter, a chip pressed, and what is on the glass read back.
//
// THE MODEL IS A STUB, AND IT IS INJECTED AT THE BOTTOM, NOT THE TOP. Nothing
// here replaces answerQuestion or nativeModel. The page is given what iOS gives
// it — `webkit.messageHandlers.bridge` (which is how @capacitor/core decides it
// is native), `Capacitor.PluginHeaders` for "StandPartnerAI" and a
// `Capacitor.nativePromise` — so the real registerPlugin, the real
// availability() / respond() calls and the real guard all run. Four stubs:
//   honest      words the first measurement back, using only its numbers
//   lying       states "47 cents" and "9 notes", which no measurement says
//   unavailable availability() says Apple Intelligence is off; respond() must
//               never be called, and a counter says whether it was
//   failing     respond() rejects
//
// NOTHING LEAVES THE DEVICE. Every request the page makes is intercepted, and
// any that is not same-origin (or data:/blob:) is aborted AND counted; the
// check fails if there is one at all from the moment the first screen settles.
//
// NO MICROPHONE, NO CAMERA: getUserMedia is replaced with a function that
// counts its calls, and the check fails if it is ever called.
//
//   npm run dev             (on 5199)
//   npm run ask:card
//
// THE BUILT BUNDLE: the same check runs against `vite preview` of dist/ (what
// Vercel serves), where /src/*.js does not exist and the app's modules are
// minified chunks. BUILT=1 finds the db chunk in dist/assets and picks
// saveRecording / renameRecording out of it by what their source says, so the
// library is still written through the app's own storage code.
//
//   npm run build && npx vite preview --port 5199 --strictPort
//   BUILT=1 npm run ask:card
//
import { mkdir, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';

const APP = process.env.APP ?? 'http://localhost:5199';
const SHOTS = process.env.SHOTS ?? join(tmpdir(), 'ask-card');
const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';
await mkdir(SHOTS, { recursive: true });
const BUILT = process.env.BUILT === '1';
const DB_CHUNK = BUILT
  ? `/assets/${(await readdir('dist/assets')).find((f) => /^db-.*\.js$/.test(f))}`
  : null;

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: SHELL,
  headless: true,
  args: ['--no-sandbox'],
});

// ── the stand-in for iOS ─────────────────────────────────────────────────────
// Runs before the page's own scripts. `mode` picks the model.
function installNative(mode) {
  window.__native = { respondCalls: 0, availabilityCalls: 0, prompts: [] };
  window.__mic = 0;
  const md = navigator.mediaDevices ?? {};
  md.getUserMedia = async () => { window.__mic += 1; throw new Error('no microphone in a test'); };
  try { Object.defineProperty(navigator, 'mediaDevices', { value: md, configurable: true }); } catch { /* already there */ }
  if (mode === 'none') return; // a plain browser: no bridge, no Capacitor

  window.webkit = { messageHandlers: { bridge: { postMessage() {} } } };
  window.Capacitor = {
    // the native bridge injects these before any page script runs
    isNativePlatform: () => true,
    getPlatform: () => 'ios',
    PluginHeaders: [{
      name: 'StandPartnerAI',
      methods: [{ name: 'availability', rtype: 'promise' }, { name: 'respond', rtype: 'promise' }],
    }],
    nativePromise: async (plugin, method, options) => {
      if (plugin !== 'StandPartnerAI') throw new Error(`unexpected plugin ${plugin}`);
      if (method === 'availability') {
        window.__native.availabilityCalls += 1;
        return mode === 'unavailable'
          ? { available: false, reason: 'Apple Intelligence is turned off.' }
          : { available: true };
      }
      window.__native.respondCalls += 1;
      window.__native.prompts.push(options.prompt);
      await new Promise((r) => setTimeout(r, 350));
      if (mode === 'failing') throw new Error('The model stopped before it answered.');
      if (mode === 'lying') return { text: 'You improved by 47 cents and nailed 9 notes more than before.' };
      // honest: the first measurement, as a sentence, using nothing it was not given
      const first = (options.prompt.split('\n').find((l) => l.startsWith('- ')) ?? '- ').slice(2);
      return { text: `Short version: ${first}` };
    },
  };
}

// ── a library through the real db ───────────────────────────────────────────
// Deterministic: a seeded generator, and notes whose pitch error is chosen so
// the true answer to "which take is closer to pitch" is known before anything
// runs. Take B is steadier, with a narrower vibrato, than take A.
async function seed(page, which) {
  await page.evaluate(async (kind, chunk) => {
    let saveRecording;
    let renameRecording;
    if (!chunk) {
      ({ saveRecording, renameRecording } = await import('/src/store/db.js'));
    } else {
      // minified names; the two functions are told apart by what they do
      const fns = Object.values(await import(chunk)).filter((f) => typeof f === 'function').map((f) => [f, f.toString()]);
      saveRecording = fns.find(([, src]) => /scoreStats/.test(src) && /sampleRate/.test(src) && /recording-data/.test(src))?.[0];
      renameRecording = fns.find(([, src]) => /recordings/.test(src) && src.length < 600 && /\.name\s*=/.test(src))?.[0];
      if (!saveRecording || !renameRecording) throw new Error('could not find saveRecording/renameRecording in the built db chunk');
    }
    let seedv = 12345;
    const rnd = () => { seedv = (seedv * 1664525 + 1013904223) % 4294967296; return seedv / 4294967296; };
    const SR = 44100;
    const PITCHES = [[50, 'D3'], [57, 'A3'], [53, 'F3'], [55, 'G3']];

    const makeTake = ({ bias, vibCents }) => {
      const notes = [];
      const readings = [];
      let t = 0.2;
      for (let i = 0; i < 14; i += 1) {
        const [midi, name] = PITCHES[i % 4];
        const cents = bias + (rnd() - 0.5) * 6;
        notes.push({ midi, name, cents, start: t, end: t + 0.6, frequency: 440 * 2 ** ((midi - 69) / 12) });
        t += 0.7;
      }
      const duration = t + 0.2;
      const audio = new Float32Array(Math.floor(duration * SR));
      let phase = 0;
      for (let k = 0; k < audio.length; k += 1) {
        const time = k / SR;
        const n = notes.find((x) => time >= x.start && time < x.end);
        if (!n) continue;
        const vib = vibCents * Math.sin(2 * Math.PI * 5.5 * (time - n.start));
        const f = 440 * 2 ** ((n.midi - 69) / 12 + (n.cents + vib) / 1200);
        phase += (2 * Math.PI * f) / SR;
        const env = Math.min(1, (time - n.start) / 0.03) * Math.min(1, (n.end - time) / 0.05);
        audio[k] = env * 0.2 * (Math.sin(phase) + 0.5 * Math.sin(2 * phase) + 0.25 * Math.sin(3 * phase));
      }
      for (let time = 0; time < duration; time += 0.01) {
        const n = notes.find((x) => time >= x.start && time < x.end);
        if (!n) continue;
        const vib = vibCents * Math.sin(2 * Math.PI * 5.5 * (time - n.start));
        readings.push({
          time,
          frequency: 440 * 2 ** ((n.midi - 69) / 12 + (n.cents + vib) / 1200),
          confidence: 0.92,
          rms: 0.14,
        });
      }
      return { notes, readings, audio, duration };
    };

    const DAY = 86400000;
    const rows = kind === 'two'
      ? [{ name: 'Bach prelude', ago: 6, bias: 18, vib: 35 }, { name: 'Bach prelude', ago: 1, bias: 6, vib: 12 }]
      : kind === 'one'
        ? [{ name: 'Bach prelude', ago: 1, bias: 6, vib: 12 }]
        : [];
    for (const r of rows) {
      const take = makeTake({ bias: r.bias, vibCents: r.vib });
      const id = await saveRecording({
        date: Date.now() - r.ago * DAY, duration: take.duration, sampleRate: SR,
        audio: take.audio, notes: take.notes, readings: take.readings, a4: 440,
      });
      await renameRecording(id, r.name);
    }
  }, which, DB_CHUNK);
}

// A fresh page per scenario: `evaluateOnNewDocument` scripts accumulate, and
// the stub of one scenario would otherwise leak into the next.
async function open({ mode, library, width = 390, height = 844, theme = 'light', mobile = true }) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  const probes = { crossOrigin: [], errors: [], armed: false };
  await page.setViewport({ width, height, deviceScaleFactor: 2, hasTouch: mobile, isMobile: mobile });
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: theme }]);
  await page.evaluateOnNewDocument(installNative, mode);
  await page.evaluateOnNewDocument((t) => {
    try {
      localStorage.setItem('mc-theme', t);
      // the welcome card and tour belong to a first launch, not to this check
      localStorage.setItem('tab', 'coach');
    } catch { /* blocked */ }
  }, theme);
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const url = req.url();
    const local = url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('about:')
      || new URL(url).origin === new URL(APP).origin;
    if (!local) {
      if (probes.armed) probes.crossOrigin.push(url);
      req.abort();
    } else req.continue();
  });
  page.on('pageerror', (e) => probes.errors.push(String(e)));
  await page.goto(APP, { waitUntil: 'load' });
  await sleep(1500);
  await page.evaluate(() => {
    document.querySelector('#welcome')?.remove();
    document.querySelector('#welcome-card')?.remove();
    document.querySelector('#tour')?.remove();
  });
  await seed(page, library);
  await page.reload({ waitUntil: 'load' });
  await sleep(1500);
  await page.evaluate(() => {
    document.querySelector('#welcome')?.remove();
    document.querySelector('#welcome-card')?.remove();
    document.querySelector('#tour')?.remove();
  });
  // the Coach tab, pressed until it takes (the app restores the last tab AFTER load)
  await page.evaluate(async () => {
    for (let i = 0; i < 20; i += 1) {
      if (document.querySelector('#tab-coach')?.classList.contains('active')) break;
      document.querySelector('.tab-btn[data-tab="coach"]')?.click();
      await new Promise((r) => setTimeout(r, 150));
    }
    await new Promise((r) => setTimeout(r, 700));
  });
  probes.armed = true;
  return { page, ctx, probes };
}

const read = (page) => page.evaluate(() => {
  const $ = (s) => document.querySelector(s);
  const vis = (s) => { const e = $(s); return !!e && !e.hidden && e.getClientRects().length > 0; };
  return {
    answer: $('#ask-answer')?.innerText ?? '',
    answerVisible: vis('#ask-out'),
    state: $('#ask-out')?.dataset.state ?? '',
    wait: vis('#ask-wait') ? $('#ask-wait').textContent : '',
    note: vis('#ask-note') ? $('#ask-note').textContent : '',
    from: vis('#ask-from') ? $('#ask-from').textContent : '',
    basedVisible: vis('#ask-based'),
    based: [...document.querySelectorAll('#ask-based-list li')].map((l) => l.textContent),
    model: $('#ask-model')?.textContent ?? '',
    modelVisible: vis('#ask-model'),
    chips: [...document.querySelectorAll('.ask-chip')].map((c) => c.textContent),
    emptyVisible: vis('#ask-empty'),
    inputDisabled: $('#ask-input')?.disabled,
    sendDisabled: $('#ask-send')?.disabled,
    chipsVisible: vis('#ask-examples'),
  };
});

// Wait for an answer or an error, recording every "thinking" line on the way.
async function settle(page, ms = 15000) {
  await page.evaluate(() => {
    window.__waits = [];
    window.__ob?.disconnect();
    const w = document.querySelector('#ask-wait');
    window.__ob = new MutationObserver(() => { if (!w.hidden && w.textContent) window.__waits.push(w.textContent); });
    window.__ob.observe(w, { childList: true, characterData: true, subtree: true, attributes: true });
  });
}
async function waitDone(page, ms = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const s = await read(page);
    if (s.answerVisible && (s.state === 'answer' || s.state === 'error')) return s;
    await sleep(60);
  }
  return read(page);
}
const waits = (page) => page.evaluate(() => [...new Set(window.__waits ?? [])]);

async function type(page, q) {
  await page.click('#ask-input');
  await page.evaluate(() => { document.querySelector('#ask-input').value = ''; });
  await page.keyboard.type(q);
}

const shot = async (page, name, { full = false } = {}) => {
  await page.evaluate(() => document.querySelector('#ask-card')?.scrollIntoView({ block: 'start', behavior: 'instant' }));
  await sleep(250);
  const path = join(SHOTS, `${name}.png`);
  await page.screenshot({ path, fullPage: full });
  return path;
};

const cardFits = (page) => page.evaluate(() => {
  const card = document.querySelector('#ask-card');
  const vw = document.documentElement.clientWidth;
  const bad = [];
  for (const e of card.querySelectorAll('*')) {
    if (e.hidden || !e.getClientRects().length) continue;
    const b = e.getBoundingClientRect();
    if (b.right > vw + 0.5 || b.left < -0.5) bad.push(`${e.tagName.toLowerCase()}#${e.id || e.className} ${Math.round(b.left)}..${Math.round(b.right)}`);
  }
  const cb = card.getBoundingClientRect();
  return { bad: bad.slice(0, 4), cardLeft: Math.round(cb.left), cardRight: Math.round(cb.right), vw, docScroll: document.documentElement.scrollWidth > vw };
});

// ═══ 1. a plain browser: no model at all ════════════════════════════════════
{
  const { page, ctx, probes } = await open({ mode: 'none', library: 'two' });
  let s = await read(page);
  check('browser: four example questions, built from this library', s.chips.length === 4 && s.chips[0].includes('compare'),
    s.chips.join(' | '));
  check('browser: the empty state is not showing and the field is live', !s.emptyVisible && s.inputDisabled === false && s.sendDisabled === false);
  check('browser: the card says why the measurements are shown directly',
    /^Showing the measurements directly: /.test(s.model), s.model);
  check('browser: the reason reads as a plain fact about the web, not as a fault',
    /iPhone and iPad app/.test(s.model) && !/cannot|can't|error|failed|unable/i.test(s.model) && s.model.length < 100, s.model);

  // labels
  const a11y = await page.evaluate(() => {
    const input = document.querySelector('#ask-input');
    const label = document.querySelector('label[for="ask-input"]');
    const send = document.querySelector('#ask-send');
    return {
      label: label?.textContent.trim(),
      sendName: send.getAttribute('aria-label') ?? send.textContent.trim(),
      status: document.querySelector('#ask-out').getAttribute('role'),
      live: document.querySelector('#ask-out').getAttribute('aria-live'),
      form: document.querySelector('#ask-form').getAttribute('role'),
      inputType: input.type,
      fontPx: parseFloat(getComputedStyle(input).fontSize),
      enterkey: input.getAttribute('enterkeyhint'),
    };
  });
  check('accessible: the field has a label, the button a name, the answer is a polite live region',
    !!a11y.label && !!a11y.sendName && a11y.status === 'status' && a11y.live === 'polite', JSON.stringify(a11y));
  check('the field is 16px or larger, so iOS does not zoom the page when it is touched', a11y.fontPx >= 16, `${a11y.fontPx}px`);

  // typed and sent with Enter
  await settle(page);
  await type(page, 'How does my last take compare to the one before?');
  await page.keyboard.press('Enter');
  s = await waitDone(page);
  const w = await waits(page);
  check('Enter sends, and the answer is the measurements', s.state === 'answer' && /Average pitch error/.test(s.answer), s.answer.slice(0, 160));
  check('the comparison states the true direction (the newer take is closer to pitch)',
    /closer to pitch/.test(s.answer) && !/further from pitch/.test(s.answer), '');
  check('progress is shown per take, only the two takes the plan names',
    w.some((x) => /\(1 of 2\)/.test(x)) && w.some((x) => /\(2 of 2\)/.test(x)) && !w.some((x) => /of 3/.test(x)), w.join(' | '));
  check('with no model there is no "based on" list (the sentences are the answer) and the foot line says why',
    !s.basedVisible && /Showing the measurements directly/.test(s.model) && s.from.startsWith('from: '), s.from);
  check('the field and button are back after the answer', !s.inputDisabled && !s.sendDisabled);
  check('the answer contains a tone line only if audio was measured (the tone comparison ran)',
    /Vibrato|Pitch steadiness|before, .* now/.test(s.answer) || /could not be measured/.test(s.answer), '');

  // a chip that needs no audio must not decode anything
  await settle(page);
  await page.evaluate(() => [...document.querySelectorAll('.ask-chip')].find((c) => /latest take go/.test(c.textContent)).click());
  s = await waitDone(page);
  const w2 = await waits(page);
  check('a chip works with one press, and a question that needs no audio decodes no take',
    s.state === 'answer' && /notes heard/.test(s.answer) && !w2.some((x) => /listening back/.test(x)), `${s.answer.slice(0, 100)} · waits: ${w2.join('|')}`);

  await settle(page);
  await page.evaluate(() => [...document.querySelectorAll('.ask-chip')].find((c) => /tone and vibrato/.test(c.textContent)).click());
  s = await waitDone(page);
  const w3 = await waits(page);
  check('the tone chip loads exactly one take and measures its vibrato from the stored audio',
    /Vibrato is on \d+% of notes/.test(s.answer) && w3.filter((x) => /listening back/.test(x)).length >= 1 && !w3.some((x) => /of 2/.test(x)),
    `${s.answer.slice(0, 200)} · waits: ${w3.join('|')}`);

  check('no request left the device and nobody asked for a microphone',
    probes.crossOrigin.length === 0 && (await page.evaluate(() => window.__mic)) === 0, probes.crossOrigin.join(' ') || 'none');
  check('no page error', probes.errors.length === 0, probes.errors.join(' | '));
  await shot(page, 'browser-light-390');
  await ctx.close();
}

// ═══ 2. empty library ═══════════════════════════════════════════════════════
{
  const { page, ctx, probes } = await open({ mode: 'none', library: 'none' });
  const s = await read(page);
  check('empty library: says what it needs, nothing to press, the field is held',
    s.emptyVisible && !s.chipsVisible && s.inputDisabled && s.sendDisabled && s.chips.length === 0);
  check('empty library: no error', probes.errors.length === 0, probes.errors.join(' | '));
  await shot(page, 'empty-light-390');
  await ctx.close();
}

// ═══ 3. one take: no comparison offered ═════════════════════════════════════
{
  const { page, ctx } = await open({ mode: 'none', library: 'one' });
  const s = await read(page);
  check('one take: no comparison chip, still four questions', s.chips.length === 4 && !s.chips.some((c) => /compare/.test(c)), s.chips.join(' | '));
  await settle(page);
  await page.evaluate(() => [...document.querySelectorAll('.ask-chip')].find((c) => /phrasing in my latest/.test(c.textContent)).click());
  const r = await waitDone(page);
  check('one take: the phrasing chip answers from the stored take (honestly, even if too little could be read)',
    r.state === 'answer' && /phrase|shaped|shaping|reads as|could not be measured/i.test(r.answer), r.answer.slice(0, 200));
  await settle(page);
  await type(page, 'Do I rush or drag?');
  await page.keyboard.press('Enter');
  const r2 = await waitDone(page);
  check('one take: a typed rhythm question still answers (honestly, even if no pulse was found)', r2.state === 'answer' && /Pulse|pulse/.test(r2.answer), r2.answer.slice(0, 140));
  await ctx.close();
}

// ═══ 4. the model is there and tells the truth ══════════════════════════════
{
  const { page, ctx, probes } = await open({ mode: 'honest', library: 'two' });
  let s = await read(page);
  check('model on: the foot line says the numbers are checked', /checked against the measurements/.test(s.model), s.model);
  await settle(page);
  // ONE take: a question about two never reaches the model (section 4b)
  await type(page, 'How was my last take?');
  await page.keyboard.press('Enter');
  await sleep(200);
  const mid = await read(page);
  check('thinking: the field and button are held and a line says what it is doing',
    mid.state === 'thinking' && mid.inputDisabled && mid.sendDisabled && mid.wait.length > 0 && !mid.answer,
    `${mid.state} / ${mid.wait}`);
  await shot(page, 'thinking-light-390');
  s = await waitDone(page);
  const w4 = await waits(page);
  check('thinking: it says when it hands the sentences to the model', w4.some((x) => /putting it into words/.test(x)), w4.join(' | '));
  const calls = await page.evaluate(() => window.__native.respondCalls);
  check('honest model: its wording is shown, and "based on" lists the measured sentences',
    s.state === 'answer' && s.answer.startsWith('Short version:') && s.basedVisible && s.based.length >= 2 && calls === 1, `${s.answer.slice(0, 110)} · ${s.based.length} sentences`);
  check('honest model: the disclosure is closed until asked for', await page.evaluate(() => !document.querySelector('#ask-based').open));
  await page.evaluate(() => { document.querySelector('#ask-based').open = true; });
  await shot(page, 'model-honest-light-390');
  check('honest model: the sentences are the measurements, numbers and all', s.based.some((f) => /notes heard/.test(f)), s.based[0]);
  check('honest model: the prompt\'s own scope tag, echoed by the stand-in, never reaches the glass',
    !/[\[\]]/.test(s.answer) && (await page.evaluate(() => window.__native.prompts[0])).includes('[the whole take]'), s.answer.slice(0, 80));
  check('honest model: the foot line says THIS answer was worded by Apple\'s model and checked', s.modelVisible && /Worded by Apple's on-device model; every number in it was checked/.test(s.model), s.model);
  check('honest model: no network, no microphone', probes.crossOrigin.length === 0 && (await page.evaluate(() => window.__mic)) === 0);
  await ctx.close();
}

// ═══ 4b. a question about two takes is never put to the model ═══════════════
{
  const { page, ctx, probes } = await open({ mode: 'honest', library: 'two' });
  await settle(page);
  await type(page, 'How does my last take compare to the one before?');
  await page.keyboard.press('Enter');
  const s = await waitDone(page);
  const w = await waits(page);
  const calls = await page.evaluate(() => window.__native.respondCalls);
  check('comparison: the model is never asked, so nothing was waited for', calls === 0 && !w.some((x) => /putting it into words/.test(x)), `${calls} calls · ${w.join(' | ')}`);
  check('comparison: the app\'s own sentences are the answer, with the true direction',
    s.state === 'answer' && /Average pitch error/.test(s.answer) && /closer to pitch/.test(s.answer) && !/further from pitch/.test(s.answer) && !s.basedVisible, s.answer.slice(0, 120));
  check('comparison: the note says plainly why, and does not read like a failure',
    /^This question is about more than one take, so the answer is written by the app/.test(s.note) && !/set aside|Showing the measurements directly|could not|failed/.test(s.note), s.note);
  check('comparison: the foot line makes no claim about Apple\'s model, because it did not word this', !s.modelVisible && !/Apple|checked/.test(s.model), `${s.modelVisible} · ${s.model}`);
  await shot(page, 'comparison-code-light-390');
  check('comparison: no network, no microphone', probes.crossOrigin.length === 0 && (await page.evaluate(() => window.__mic)) === 0);
  await ctx.close();
}

// ═══ 4c. a refusal is the app\'s own words too ══════════════════════════════
{
  const { page, ctx } = await open({ mode: 'honest', library: 'two' });
  await settle(page);
  await type(page, 'Is my tone beautiful?');
  await page.keyboard.press('Enter');
  const s = await waitDone(page);
  const calls = await page.evaluate(() => window.__native.respondCalls);
  check('refusal: the model is never asked and the foot line does not claim its wording',
    calls === 0 && /I can only answer from what the app measured/.test(s.answer) && !s.modelVisible && !/Apple|checked/.test(s.model), `${calls} · ${s.model}`);
  await ctx.close();
}

// ═══ 4d. every kind of refusal, in a plain browser, light and dark ══════════
// The card went blank on every refusal once (see answerLines), so each kind is
// asked through the real screen and what is on the glass is read back.
for (const [theme, width, height, mobile] of [['light', 390, 844, true], ['dark', 390, 844, true], ['light', 1280, 900, false], ['dark', 1280, 900, false]]) {
  const { page, ctx, probes } = await open({ mode: 'none', library: 'two', theme, width, height, mobile });
  const kinds = [
    ['offtopic', "what's the capital of France", /not about them/],
    ['unmeasurable', 'is my tone beautiful', /not something it measures/],
    ['unsupported', 'which was my best take', /ranking all of your takes/],
    ['notfound', 'how was my Paganini caprice take', /could not find "/],
  ];
  for (const [kind, q, re] of kinds) {
    await settle(page);
    await type(page, q);
    await page.keyboard.press('Enter');
    const s = await waitDone(page);
    check(`refusal ${kind} (${theme} ${width}): printed, not blank, and the field is back`,
      s.state === 'answer' && re.test(s.answer) && !s.inputDisabled, s.answer.slice(0, 90));
    check(`refusal ${kind} (${theme} ${width}): no error styling, no failure note`, s.state !== 'error' && s.note === '', s.note);
    await shot(page, `refusal-${kind}-${theme}-${width}`);
  }
  check(`refusals (${theme} ${width}): no request left the device, no page error`, probes.crossOrigin.length === 0 && probes.errors.length === 0, probes.crossOrigin.concat(probes.errors).join(' | '));
  await ctx.close();
}

// ═══ 5. the model invents a number ═════════════════════════════════════════
{
  const { page, ctx } = await open({ mode: 'lying', library: 'two' });
  await settle(page);
  await type(page, 'How was my last take?');
  await page.keyboard.press('Enter');
  const s = await waitDone(page);
  const calls = await page.evaluate(() => window.__native.respondCalls);
  check('lying model: the model WAS asked', calls === 1);
  check('lying model: its invented numbers never reach the glass', !/47|nailed/.test(s.answer) && !/47/.test(s.based.join(' ')), s.answer.slice(0, 120));
  check('lying model: the measurements are shown instead, and the player is told the wording was set aside',
    /notes heard/.test(s.answer) && /^Showing the measurements directly\. The model's reply was set aside/.test(s.note), s.note);
  check('lying model: the foot line does not claim the wording was Apple\'s', !s.modelVisible, s.model);
  await shot(page, 'model-lying-light-390');
  await ctx.close();
}

// ═══ 6. Apple Intelligence is off ═══════════════════════════════════════════
{
  const { page, ctx } = await open({ mode: 'unavailable', library: 'two' });
  let s = await read(page);
  check('unavailable: the foot line carries the reason in the house wording',
    s.model === 'Showing the measurements directly: Apple Intelligence is turned off.', s.model);
  await settle(page);
  await type(page, 'Which notes am I worst at?');
  await page.keyboard.press('Enter');
  s = await waitDone(page);
  const calls = await page.evaluate(() => window.__native.respondCalls);
  check('unavailable: the feature still works, and respond() was never called',
    s.state === 'answer' && /furthest from pitch/.test(s.answer) && calls === 0, s.answer.slice(0, 140));
  check('unavailable: the per-answer note does not repeat the standing line', s.note === '', s.note);
  await ctx.close();
}

// ═══ 7. the model fails part way ════════════════════════════════════════════
{
  const { page, ctx } = await open({ mode: 'failing', library: 'two' });
  await settle(page);
  await type(page, 'Which notes am I worst at?');
  await page.keyboard.press('Enter');
  const s = await waitDone(page);
  check('failing model: the measurements are shown and the failure is said, once',
    s.state === 'answer' && /furthest from pitch/.test(s.answer) && /stopped before it answered/.test(s.note), s.note);
  await ctx.close();
}

// ═══ 8. something throws: the error state ═══════════════════════════════════
{
  const { page, ctx } = await open({ mode: 'none', library: 'two' });
  await settle(page);
  await type(page, 'How did my latest take go?');
  // forced failure: the clock the card hands the assistant stops working
  await page.evaluate(() => { window.__now = Date.now; Date.now = () => { throw new Error('the clock stopped'); }; });
  await page.keyboard.press('Enter');
  const s = await waitDone(page);
  await page.evaluate(() => { Date.now = window.__now; });
  check('error: says it did not work, says nothing was sent, and the field is back',
    s.state === 'error' && /did not work/.test(s.answer) && /Nothing was sent/.test(s.answer) && !s.inputDisabled && /clock stopped/.test(s.note), `${s.answer} · ${s.note}`);
  await shot(page, 'error-light-390');
  await settle(page);
  await page.click('#ask-input');
  await page.keyboard.press('Enter');
  const again = await waitDone(page);
  check('error: asking again works', again.state === 'answer' && /notes heard/.test(again.answer), again.answer.slice(0, 80));
  await ctx.close();
}

// ═══ 9. fit at every phone width, and a look at light, dark and desktop ═════
for (const width of [320, 360, 390, 430]) {
  const { page, ctx } = await open({ mode: 'honest', library: 'two', width });
  await settle(page);
  await type(page, 'How was my last take?');
  await page.keyboard.press('Enter');
  await waitDone(page);
  await page.evaluate(() => { document.querySelector('#ask-based').open = true; });
  const f = await cardFits(page);
  check(`${width} wide: the card sits inside the screen, nothing runs off, the page does not scroll sideways`,
    f.bad.length === 0 && f.cardLeft >= 0 && f.cardRight <= f.vw && !f.docScroll, JSON.stringify(f));
  const reach = await page.evaluate(() => {
    const out = [];
    for (const e of document.querySelectorAll('#ask-card button, #ask-card input, #ask-card summary')) {
      if (e.hidden || !e.getClientRects().length) continue;
      e.scrollIntoView({ block: 'center', behavior: 'instant' });
      const b = e.getBoundingClientRect();
      const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      if (!(hit === e || e.contains(hit))) out.push(`${e.id || e.textContent.slice(0, 20)} under ${hit?.tagName}`);
      if (b.height < 30) out.push(`${e.id || e.textContent.slice(0, 20)} only ${Math.round(b.height)}px tall`);
    }
    return out;
  });
  check(`${width} wide: every control in the card can be pressed and is tall enough to`, reach.length === 0, reach.join(' · '));
  if (width === 320) await shot(page, 'model-honest-light-320');
  await ctx.close();
}

for (const [theme, width, height, mobile, tag] of [
  ['dark', 390, 844, true, 'dark-390'],
  ['light', 1280, 900, false, 'light-desktop'],
  ['dark', 1280, 900, false, 'dark-desktop'],
]) {
  const { page, ctx } = await open({ mode: 'honest', library: 'two', theme, width, height, mobile });
  await settle(page);
  await page.evaluate(() => { document.querySelector('#ask-input').focus(); });
  await shot(page, `idle-${tag}`);
  await type(page, 'How was my last take?');
  await page.keyboard.press('Enter');
  await sleep(150);
  await shot(page, `thinking-${tag}`);
  await waitDone(page);
  await page.evaluate(() => { document.querySelector('#ask-based').open = true; });
  await shot(page, `answer-${tag}`);
  const dark = await page.evaluate(() => document.documentElement.dataset.theme);
  check(`${tag}: the theme really was ${theme}`, dark === theme, dark);
  await ctx.close();
}

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed. Screenshots in ${SHOTS}`);
process.exit(failed.length ? 1 : 0);
