// THE FLUTE CASE, DRIVEN THROUGH THE MICROPHONE, WITH NOBODY PLAYING.
//
// "there has to be a way you can check without me playing the music."
//
// There is, and it is the check that was missing. `take:tuning` builds the
// notes by hand and hands them to the review, so it proves the SENTENCE and
// nothing else — worse, it folds the cents into ±50 with its own copy of the
// rule, so it would still pass if the app folded differently. Everything
// between a sound and a name went untested.
//
// This plays a flute-ish tone into the app's own microphone at a chosen A and
// reads what comes back out, so the whole path is under test: YIN, the cents,
// the segmenter, the naming, and the sentence.
//
// It reproduces the report rather than asserting around it. An instrument at
// A=427 is 52¢ below the app's A, which is PAST the halfway line, so every name
// lands a semitone low — "the app would say it's an A, but it's actually an
// A#". At A=432 it is 32¢ below, still on the near side, so every name is
// right and the sentence is the only thing that knows anything is off. Both are
// the same instrument being flat; only the naming differs, which is the whole
// point of the fix.
//
//   npm run dev            (on 5199)
//   npm run take:flute
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

// A phrase in the flute's own register, up and back down.
const TUNE = [72, 74, 76, 77, 79, 81, 83, 84, 83, 81, 79, 77, 76, 74];
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const midiOf = (name) => {
  const m = /^([A-G]#?)(-?\d+)$/.exec(name);
  return m ? NAMES.indexOf(m[1]) + (Number(m[2]) + 1) * 12 : null;
};
const centsFrom440 = (a4) => 1200 * Math.log2(a4 / 440);

const browser = await puppeteer.launch({
  executablePath: SHELL,
  headless: true,
  args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  protocolTimeout: 240000,
});
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

// The fake microphone from `take:save`, with one thing added: the tone is built
// against the INSTRUMENT's A rather than the app's, which is the only way to
// put a flute that is not at 440 in front of the detector.
await page.evaluateOnNewDocument(() => {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const level = ctx.createGain();
  level.gain.value = 0;
  const partials = [1, 2, 3, 4].map((n) => {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    g.gain.value = 0.6 / n;
    osc.connect(g).connect(level);
    osc.start();
    return { osc, n };
  });
  window.__playAt = async (midi, each, a4) => {
    await ctx.resume();
    const now = ctx.currentTime + 0.1;
    midi.forEach((m, i) => {
      const at = now + i * each;
      const hz = a4 * (2 ** ((m - 69) / 12));
      for (const { osc, n } of partials) osc.frequency.setValueAtTime(hz * n, at);
      level.gain.setValueAtTime(0.0001, at);
      level.gain.exponentialRampToValueAtTime(0.8, at + 0.03);
      level.gain.setValueAtTime(0.8, at + each * 0.72);
      level.gain.exponentialRampToValueAtTime(0.0001, at + each * 0.84);
    });
    return midi.length * each + 0.4;
  };
  navigator.mediaDevices.getUserMedia = async () => {
    await ctx.resume();
    const out = ctx.createMediaStreamDestination();
    level.connect(out);
    return out.stream;
  };
});

await page.goto(APP, { waitUntil: 'domcontentloaded' });
await new Promise((r) => setTimeout(r, 1600));

async function playInto(a4) {
  return page.evaluate(async ({ midi, a4: theirA }) => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    document.querySelector('#welcome')?.remove();
    document.querySelector('.tab-btn[data-tab="analyze"]')?.click();
    await wait(400);

    const start = document.querySelector('#start');
    if (!start) return { failed: 'no Record button' };

    // The button flipping is the UI starting, not the sound arriving; the take
    // is only really running once the clock is up. The FIRST take on a cold
    // page has to open the microphone, and that can lose a press — so the press
    // is repeated rather than waited on forever, and a lap that quietly started
    // and stopped the take is not mistaken for one that never began.
    const pause = document.querySelector('#pause-rec');
    let tries = 0;
    while (pause.hidden && tries < 3) {
      start.click();
      tries += 1;
      for (let i = 0; i < 60 && pause.hidden; i += 1) await wait(100);
    }
    if (pause.hidden) {
      return {
        failed: 'the take never started',
        why: `${tries} presses / status "${document.querySelector('#status')?.textContent ?? ''}"`
          + ` / rec-note "${document.querySelector('#rec-note')?.textContent ?? ''}"`,
      };
    }

    const seconds = await window.__playAt(midi, 0.45, theirA);
    await wait(seconds * 1000 + 700);
    start.click();
    await wait(4500);

    const said = (document.querySelector('#notes-summary')?.textContent ?? '').trim();
    const names = [...document.querySelectorAll('#report-grid .degree')]
      .map((t) => t.querySelector('b')?.textContent?.trim())
      .filter(Boolean);
    return { said, names, note: document.querySelector('#rec-note')?.textContent ?? '' };
  }, { midi: TUNE, a4 });
}

// A shift of a whole semitone, or of none, has to be the SAME shift on every
// note — a mixture would be a detector that is merely wrong rather than an
// instrument that is somewhere else, and those are not the same finding.
function shiftOf(names) {
  const raw = names.map(midiOf).filter((m) => m !== null);
  // A detector that splits one held note in two says the same pitch twice in a
  // row; that is one note, not two.
  const heard = raw.filter((m, i) => i === 0 || m !== raw[i - 1]);
  if (heard.length < 8) {
    return { shift: null, steady: false, heard: heard.length, share: 0, names };
  }
  // NOT PAIRED BY POSITION. A change of pitch can throw a transient reading in
  // between two notes, and one inserted note puts every pair after it out of
  // step — which reads as a detector that is wrong all over rather than as an
  // instrument sitting somewhere else. So each candidate shift is scored by how
  // much of the phrase it can match IN ORDER, which an insertion cannot break.
  const inOrder = (moved) => {
    const grid = Array.from({ length: moved.length + 1 }, () => new Array(TUNE.length + 1).fill(0));
    for (let i = 1; i <= moved.length; i += 1) {
      for (let j = 1; j <= TUNE.length; j += 1) {
        grid[i][j] = moved[i - 1] === TUNE[j - 1]
          ? grid[i - 1][j - 1] + 1
          : Math.max(grid[i - 1][j], grid[i][j - 1]);
      }
    }
    return grid[moved.length][TUNE.length];
  };
  let best = { shift: 0, matched: -1 };
  for (let s = -3; s <= 3; s += 1) {
    const matched = inOrder(heard.map((m) => m - s));
    if (matched > best.matched) best = { shift: s, matched };
  }
  const share = best.matched / TUNE.length;
  return { shift: best.shift, steady: share >= 0.85, heard: heard.length, share, names };
}

// ── 32¢ below A440: every name still lands right ────────────────────────────
const near = await playInto(432);
if (near.failed) {
  check('a flute 32¢ below A440 is recorded', false, `${near.failed} — ${near.why ?? ''}`);
} else {
  const shift = shiftOf(near.names);
  check('a flute at A=432 is heard, and every name still lands right',
    shift.shift === 0 && shift.steady,
    `${shift.heard} notes, shift ${shift.shift}, ${(shift.share * 100).toFixed(0)}% agree — ${shift.names.join(' ')}`);
  check('…and the review says the instrument is flat, and which A it is',
    /below A440/.test(near.said) && /A of about 43[0-9]/.test(near.said),
    near.said);
}

// ── 52¢ below A440: past the halfway line, and the names move with it ───────
const past = await playInto(427);
if (past.failed) {
  check('a flute 52¢ below A440 is recorded', false, `${past.failed} — ${past.why ?? ''}`);
} else {
  const shift = shiftOf(past.names);
  // This is the complaint itself, reproduced: "it would say it's an A, but it's
  // actually an A#".
  check('a flute at A=427 has EVERY name land a semitone low — the report, reproduced',
    shift.shift === -1 && shift.steady,
    `${shift.heard} notes, shift ${shift.shift}, ${(shift.share * 100).toFixed(0)}% agree — ${shift.names.join(' ')}`);
  check('…and the review says so, instead of leaving the names to be believed',
    /half a semitone from A440/.test(past.said)
      && /names on this take may be a semitone out/.test(past.said),
    past.said);
  // The fold has destroyed the direction by this point: a flute 52¢ flat and
  // one 48¢ sharp write down the same readings. Guessing would point at the
  // opposite of the problem half the time.
  check('…and does not guess a direction it cannot know',
    !/(above|below) A440/.test(past.said), past.said);
}

check(`the instrument's distance was ${centsFrom440(432).toFixed(1)}¢ and `
  + `${centsFrom440(427).toFixed(1)}¢ — one either side of the halfway line`,
  centsFrom440(432) > -40 && centsFrom440(427) < -40);
check('nothing was thrown', errors.length === 0, errors.slice(0, 2).join(' | '));

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(failed.length ? `\n${failed.length} FAILED` : '\nALL PASS');
process.exit(failed.length ? 1 : 0);
