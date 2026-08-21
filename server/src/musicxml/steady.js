// Steadying the clefs and keys a recogniser invented.
//
// A page of the Mozart flute concerto — clean, well lit, printed — came back
// with SEVEN bars in bass clef and ELEVEN with the key signature missing, on a
// page that is treble clef and one sharp from top to bottom. That is fourteen
// bars of thirty-six, sixty-two notes, wrong for a structural reason rather
// than a smudged notehead: every note under a wrong clef is displaced by a
// sixth, and every F under a lost key signature loses its sharp.
//
// These are the recogniser's most expensive mistakes and its most correctable
// ones, because a clef and a key persist. One misread symbol at the start of a
// system is not one wrong note, it is a system of wrong notes — and a system
// that disagrees with every system around it is nearly always the mistake
// rather than the music.
//
// WHAT THIS WILL NOT DO. It will not touch a part that genuinely changes clef
// often (a cello line moving between bass, tenor and treble), because the
// correction only applies where one clef or key dominates the part outright and
// the outlier is a small minority. A real clef change in an otherwise steady
// part is indistinguishable from a misread one on the evidence available here,
// so the threshold is set where a wrong answer is unlikely rather than where
// the most corrections are made.

const STEPS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const stepIndex = (step) => STEPS.indexOf(String(step).toUpperCase());
const diatonic = (step, octave) => octave * 7 + stepIndex(step);
const fromDiatonic = (value) => ({
  step: STEPS[((value % 7) + 7) % 7],
  octave: Math.floor(value / 7),
});

// Where a clef puts its own letter, as a diatonic value, and on which staff
// position. Position counts lines AND spaces from the bottom line: line 1 is 0,
// the space above it 1, line 2 is 2, and so on.
const CLEF_PITCH = { G: diatonic('G', 4), F: diatonic('F', 3), C: diatonic('C', 4) };

/** The diatonic value of the bottom line under this clef. */
function bottomLine(sign, line) {
  const at = CLEF_PITCH[String(sign).toUpperCase()];
  if (at === undefined) return null;
  return at - 2 * ((Number(line) || 1) - 1);
}

/** How far every note moves when a bar is re-read under a different clef. */
export function clefShift(wrong, right) {
  const from = bottomLine(wrong.sign, wrong.line);
  const to = bottomLine(right.sign, right.line);
  if (from === null || to === null) return 0;
  return to - from;
}

/** The letters a key signature sharpens or flattens, in the order it does. */
const SHARPS = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
const FLATS = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];

/** What a key signature does to a letter, with no accidental written. */
export function keyAlter(fifths, step) {
  const letter = String(step).toUpperCase();
  if (fifths > 0) return SHARPS.slice(0, fifths).includes(letter) ? 1 : 0;
  if (fifths < 0) return FLATS.slice(0, -fifths).includes(letter) ? -1 : 0;
  return 0;
}

const measuresOf = (xml) => {
  const out = [];
  const open = /<measure\b[^>]*>/g;
  let match = open.exec(xml);
  while (match) {
    const close = xml.indexOf('</measure>', open.lastIndex);
    if (close === -1) break;
    const to = close + '</measure>'.length;
    out.push({ from: match.index, to, text: xml.slice(match.index, to) });
    open.lastIndex = to;
    match = open.exec(xml);
  }
  return out;
};

const readClef = (text) => {
  const found = /<clef[^>]*>\s*<sign>([^<]+)<\/sign>\s*<line>(\d+)<\/line>/.exec(text);
  return found ? { sign: found[1], line: Number(found[2]) } : null;
};
const readKey = (text) => {
  const found = /<fifths>(-?\d+)<\/fifths>/.exec(text);
  return found ? Number(found[1]) : null;
};

/** The value that holds most of the part, and how much of it. */
function dominant(values) {
  const counts = new Map();
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const key = JSON.stringify(value);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let best = null;
  let most = 0;
  let total = 0;
  for (const [key, n] of counts) {
    total += n;
    if (n > most) { most = n; best = JSON.parse(key); }
  }
  return { value: best, share: total ? most / total : 0, kinds: counts.size };
}

// How much of a part one clef (or key) must hold before the rest is treated as
// misreadings, and how small the minority must be. Both have to be true.
const DOMINATES = 0.7;
const A_MINORITY = 0.3;

// OR IT KEEPS CHANGING ITS MIND, which is the better signal of the two.
//
// A real key change happens ONCE and stays: a part is in one key, then another.
// A misread one flips back and forth as the recogniser catches the signature on
// some systems and misses it on others — 1, 0, 1, 0, 1, 0, 1 down a page that
// is in G major throughout. The same is true of a clef.
//
// Counting those changes of mind separates the two far better than counting
// bars does. This page held its real key in 25 bars of 36 — 69%, which a
// share-based rule set at 70 misses by one bar, on a page where the answer is
// not in doubt at all.
const CHANGES_OF_MIND = 3;
const STILL_MOSTLY = 0.5;

/** How many times a value changes down the part, ignoring bars that say nothing. */
function changesOfMind(values) {
  let changes = 0;
  let last;
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const now = JSON.stringify(value);
    if (last !== undefined && now !== last) changes += 1;
    last = now;
  }
  return changes;
}

/**
 * Re-read the bars whose clef or key the recogniser almost certainly invented.
 *
 * @param {string} xml the engine's MusicXML
 * @returns {{xml:string, clefsFixed:number, keysFixed:number, notesMoved:number, notes:string[]}}
 */
export function steadyClefsAndKeys(xml) {
  if (typeof xml !== 'string' || !xml.includes('<measure')) {
    return { xml, clefsFixed: 0, keysFixed: 0, notesMoved: 0, notes: [] };
  }
  const bars = measuresOf(xml);
  if (bars.length < 4) return { xml, clefsFixed: 0, keysFixed: 0, notesMoved: 0, notes: [] };

  // What each bar is read under, carrying the last declaration forward.
  let clef = null;
  let key = null;
  const under = bars.map((bar) => {
    clef = readClef(bar.text) ?? clef;
    key = readKey(bar.text) ?? key;
    return { clef, key };
  });

  const clefRule = dominant(under.map((u) => u.clef));
  const keyRule = dominant(under.map((u) => u.key));
  const settled = (rule, values) => rule.kinds > 1 && (
    rule.share >= DOMINATES
    || (changesOfMind(values) >= CHANGES_OF_MIND && rule.share >= STILL_MOSTLY)
  );
  const steadyClef = settled(clefRule, under.map((u) => u.clef)) ? clefRule.value : null;
  const steadyKey = settled(keyRule, under.map((u) => u.key)) ? keyRule.value : null;
  if (!steadyClef && steadyKey === null) {
    return { xml, clefsFixed: 0, keysFixed: 0, notesMoved: 0, notes: [] };
  }
  const clefOutliers = under.filter((u) => u.clef && steadyClef
    && (u.clef.sign !== steadyClef.sign || u.clef.line !== steadyClef.line)).length;
  const keyOutliers = under.filter((u) => steadyKey !== null && u.key !== null && u.key !== steadyKey).length;
  if (clefOutliers / bars.length > A_MINORITY) return { xml, clefsFixed: 0, keysFixed: 0, notesMoved: 0, notes: [] };

  let clefsFixed = 0;
  let keysFixed = 0;
  let notesMoved = 0;
  const notes = [];

  const rewritten = bars.map((bar, i) => {
    const was = under[i];
    const wrongClef = steadyClef && was.clef
      && (was.clef.sign !== steadyClef.sign || was.clef.line !== steadyClef.line);
    const wrongKey = steadyKey !== null && was.key !== null && was.key !== steadyKey;
    if (!wrongClef && !wrongKey) return bar.text;

    let text = bar.text;
    if (wrongClef) {
      clefsFixed += 1;
      text = text.replace(/(<clef[^>]*>\s*<sign>)[^<]+(<\/sign>\s*<line>)\d+/,
        `$1${steadyClef.sign}$2${steadyClef.line}`);
    }
    if (wrongKey) {
      keysFixed += 1;
      text = text.replace(/(<fifths>)-?\d+(<\/fifths>)/, `$1${steadyKey}$2`);
    }

    const shift = wrongClef ? clefShift(was.clef, steadyClef) : 0;
    const fifths = steadyKey ?? was.key ?? 0;
    text = text.replace(/<note\b[\s\S]*?<\/note>/g, (note) => {
      const pitch = /<step>([A-G])<\/step>\s*(?:<alter>(-?\d+)<\/alter>\s*)?<octave>(\d+)<\/octave>/
        .exec(note);
      if (!pitch) return note;
      const [, step, , octave] = pitch;
      const moved = shift ? fromDiatonic(diatonic(step, Number(octave)) + shift) : { step, octave: Number(octave) };
      // An accidental element is what the recogniser SAW printed; without one,
      // the alteration is whatever the key signature says — so a bar re-read
      // under the right key gets its sharps back.
      const printed = /<accidental[^>]*>([^<]+)<\/accidental>/.exec(note);
      const alter = printed
        ? ({ sharp: 1, flat: -1, natural: 0, 'double-sharp': 2, 'flat-flat': -2 }[printed[1].trim()] ?? 0)
        : keyAlter(fifths, moved.step);
      notesMoved += 1;
      const rebuilt = `<step>${moved.step}</step>${alter ? `<alter>${alter}</alter>` : ''}`
        + `<octave>${moved.octave}</octave>`;
      return note.replace(
        /<step>[A-G]<\/step>\s*(?:<alter>-?\d+<\/alter>\s*)?<octave>\d+<\/octave>/,
        rebuilt,
      );
    });
    return text;
  });

  if (clefsFixed) notes.push(`${clefsFixed} bar(s) re-read in ${steadyClef.sign}${steadyClef.line}, `
    + 'which is the clef the rest of the part is in');
  if (keysFixed) notes.push(`${keysFixed} bar(s) given back the key signature the rest of the part has`);

  let out = '';
  let at = 0;
  bars.forEach((bar, i) => {
    out += xml.slice(at, bar.from) + rewritten[i];
    at = bar.to;
  });
  out += xml.slice(at);
  return { xml: out, clefsFixed, keysFixed, notesMoved, notes, keyOutliers };
}
