// Holds a model's reply to the facts it was given.
//
// A small language model asked "was I flatter on Friday?" will happily produce
// a number that sounds right. Instructions telling it not to do that lower the
// rate; they do not make it zero, and there is no measurement here that could
// ever tell the two apart after the fact. So the check is mechanical and does
// not ask the model for anything. A reply that fails is thrown away and the
// facts are shown as they stand, which is always correct if a little stiff.
//
// The first version read digits and compared them with the digits in the
// facts. tests/ai-guard.test.js is the red team that came after it: sixty-odd
// replies built to get a wrong claim past that check, every one of which now
// fails, beside forty honest replies that must still pass. What it found:
//
//   - a number written as a word ("twelve cents", "a third", "twice", "half")
//   - a number in the facts reused with another unit (22¢ read out as 22 ms,
//     a count of notes read out as cents, "bar 3" from "3 notes")
//   - a fraction, ratio, range, date or signed number assembled from digits
//     that each appear in the facts ("1/2", "10-20", "2026-10-20", "-12")
//   - the digit in a note name ("D3") standing in for a "3" the facts never gave
//   - a comma used as the decimal point ("12,5"), digits in other scripts,
//     fullwidth or superscript digits, zero-width characters between digits
//   - a take name the facts never contained, in quotes, with a number in it
//   - a direction opposite to the facts ("improved" when the fact says further
//     from pitch; a note called flat that the facts call sharp)
//   - a confident answer about something the facts say was not measured
//
// A second verifier, working against the replies the real on-device model gave
// (tools/ai-model/results), found what the red team above had not:
//
//   - "12.8¢ further" passing when the truth was 12.8¢ closer (a pattern that
//     needed a letter before "further"), and the axis check giving up entirely
//     when the facts held both directions, which is where swapped numbers live
//     -> a direction word is now tied to the number beside it (8b)
//   - a taste verdict with no digit passing on 10 of 13 questions, because the
//     taste check ran only when the shaping caveat was in the facts -> it runs
//     on every reply, and praise words ("great job", "went well") joined it
//   - "twelve cents closer" built from the 12 that belongs to the vibrato
//     -> a number must sit in a sentence about what the reply uses it for (8c)
//   - "Yes, your vibrato is 27¢ wide" to "is my vibrato too wide", and an
//     instrument, voice or key repeated from the question (violin, cello,
//     soprano, "D Major") as if it had been measured (9b, 9c)
//   - "Not measured." where there was a measurement (9d)
//
// What it cannot do is check that a sentence that is made only of true words
// and true numbers means something true. "Your 9¢ was the 22¢ take" passes. The
// model is told to use short sentences and the facts are shown under every
// reply for that reason.

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';

// ---- reading text ------------------------------------------------------------

function digitValue(ch) {
  const cp = ch.codePointAt(0);
  let start = cp;
  while (start > 0 && /\p{Nd}/u.test(String.fromCodePoint(start - 1))) start--;
  return String((cp - start) % 10);
}

// One spelling of everything a person or a model can use to write the same
// characters: compatibility forms (fullwidth, superscript, vulgar fractions),
// digits of any script, invisible characters, curly quotes.
export function clean(s) {
  return String(s ?? '')
    .normalize('NFKC')
    .replace(/\p{Cf}/gu, '')
    .replace(/\p{Nd}/gu, digitValue)
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[   ]/g, ' ');
}

// The tags assistant.js puts in front of a few facts to say what part of the
// playing they describe. They are the app's bookkeeping, not wording, and a
// small model sometimes echoes one back at the start of its answer. Stripped
// before the reply is checked or shown; one that is still in a text handed to
// checkReply directly is rejected, because it would reach the player.
const SCOPE_TAG = /\[\s*(?:the whole take|one note only|the two takes compared)\s*\]\s*/gi;
export function stripScopeTags(text) {
  return String(text ?? '').replace(SCOPE_TAG, '');
}

const DIGITS = /\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:[.,]\d+)?/g;
const toNumber = (t) => {
  if (/^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(t)) return Number(t.replace(/,/g, ''));
  return Number(t.replace(',', '.'));
};

// A pitch name such as D3, F#4, Bb2: its digit is an octave, not a measurement.
const NOTE_NAME = /\b[A-G][#♯b♭]?\d\b/g;

export function numbersIn(text) {
  return (clean(text).replace(NOTE_NAME, ' ').match(DIGITS) ?? []).map(toNumber);
}

// What a number is measured in, from the characters right after it.
const UNITS = [
  [/^\s*(?:-\s*)?(?:¢|cents?\b)/i, 'cents'],
  [/^\s*(?:-\s*)?(?:ms\b|msec\b|milliseconds?\b)/i, 'ms'],
  [/^\s*(?:-\s*)?(?:seconds?\b|secs?\b|s\b)/i, 'sec'],
  [/^\s*(?:-\s*)?(?:hz\b|hertz\b)/i, 'hz'],
  [/^\s*(?:-\s*)?(?:db\b|decibels?\b)/i, 'db'],
  [/^\s*(?:-\s*)?(?:%|percent\b|per ?cent\b)/i, 'pct'],
  [/^\s*(?:-\s*)?(?:semitones?\b|half[- ]steps?\b|whole[- ]steps?\b)/i, 'semitone'],
  [/^\s*(?:-\s*)?(?:bpm\b|beats? per minute\b)/i, 'bpm'],
  [/^\s*(?:-\s*)?(?:takes?\b|recordings?\b|versions?\b|attempts?\b)/i, 'take'],
  [/^\s*(?:-\s*)?(?:notes?\b|pitches\b)/i, 'notes'],
  [/^\s*(?:-\s*)?times?\b/i, 'times'],
  [/^\s*(?:-\s*)?days?\b/i, 'days'],
  [/^\s*(?:-\s*)?weeks?\b/i, 'weeks'],
  [/^\s*(?:-\s*)?months?\b/i, 'months'],
  [/^\s*(?:-\s*)?(?:bars?|measures?)\b/i, 'bars'],
  [/^\s*(?:-\s*)?beats?\b/i, 'beats'],
  [/^\s*(?:-\s*)?points?\b/i, 'points'],
  [/^\s*(?:-\s*)?sessions?\b/i, 'sessions'],
  [/^\s*(?:-\s*)?(?:×|x\b)/i, 'multiple'],
  [/^(?:st|nd|rd|th)\b/i, 'ordinal'],
];
function unitAfter(text, end) {
  const rest = text.slice(end, end + 24);
  for (const [re, name] of UNITS) if (re.test(rest)) return name;
  return null;
}

// ---- counts of days and of takes ---------------------------------------------

// A number followed by "days" is one of three things in this app's facts, and
// the same digit can be any of them: the length of a window ("the last 7 days"),
// a count inside it ("practised on 3 of the last 7 days") or a streak ("streak
// 2 days"). A fourth, a GAP ("not practised in 7 days", "7 days since"), is
// never in the facts at all. The number rules only asked whether the digit and
// the unit exist somewhere, and "7 days" does, so a gap passed built from the
// window's length. Each use is told from its neighbours and must meet the same
// use in the facts.
function dayRole(text, tok) {
  const before = text.slice(Math.max(0, tok.index - 40), tok.index).toLowerCase();
  const after = text.slice(tok.end, tok.end + 30).toLowerCase();
  if (/\b(?:last|past|previous|recent)\s+(?:\w+\s+)?$/.test(before) || /\bof the\s+$/.test(before)) return 'window';
  if (/\bstreak\W+(?:\w+\W+){0,2}$/.test(before) || /^\s*(?:days?\s+)?(?:in a row|straight|running|consecutive|streak)/.test(after) || /\bconsecutive\s+$/.test(before)) return 'streak';
  if (/^\s*(?:days?\s+)?(?:ago|since|without|off|missed|apart)\b/.test(after) || /\b(?:not|never|n't|haven't|hasn't|without|no|since|missed|skipped)\b[^.;]{0,40}$/.test(before)) return 'gap';
  return 'count';
}
// "3 of the last 7 days": the 3 has no unit of its own, and it is a count of days
const COUNT_OF_WINDOW = /(\d+)\s+of\s+(?:the\s+)?(?:last|past)\s+\d+\s+days?/g;

// ---- number words ------------------------------------------------------------

const ONES = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS = { twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const ORDINALS = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12 };
const isNumWord = (w) => w in ONES || w in TENS || w === 'hundred' || w === 'thousand';

// "one" on its own is a pronoun far more often than a number ("the one before",
// "one of your notes"); it counts only when a measurement unit follows.
const ONE_UNITS = /^(cents?|ms|milliseconds?|hz|hertz|db|decibels?|percent|per|semitones?|seconds?|bpm|beats?)\b/;

// -> [{ v, index, end, cls, word: true }]
function wordNumbers(text) {
  const out = [];
  const re = /[a-z]+(?:-[a-z]+)*/gi;
  const words = [];
  let m;
  while ((m = re.exec(text))) {
    const parts = m[0].toLowerCase().split('-');
    let at = m.index;
    for (const p of parts) { words.push({ w: p, index: at, end: at + p.length }); at += p.length + 1; }
  }
  for (let i = 0; i < words.length; i++) {
    if (!isNumWord(words[i].w)) continue;
    let total = 0;
    let current = 0;
    let j = i;
    let used = false;
    for (; j < words.length; j++) {
      const w = words[j].w;
      if (w === 'and' && used && j + 1 < words.length && isNumWord(words[j + 1].w) && current >= 100) continue;
      if (!isNumWord(w)) break;
      used = true;
      if (w in ONES) current += ONES[w];
      else if (w in TENS) current += TENS[w];
      else if (w === 'hundred') current = (current || 1) * 100;
      else if (w === 'thousand') { total += (current || 1) * 1000; current = 0; }
    }
    let v = total + current;
    let end = words[j - 1].end;
    // "twelve point five"
    if (words[j]?.w === 'point') {
      let frac = '';
      let k = j + 1;
      while (k < words.length && words[k].w in ONES && ONES[words[k].w] < 10) { frac += ONES[words[k].w]; k++; }
      if (frac) { v = Number(`${v}.${frac}`); end = words[k - 1].end; j = k; }
    }
    const rest = text.slice(end).trimStart().toLowerCase();
    const single = j - i === 1 && words[i].w === 'one';
    if (single && !ONE_UNITS.test(rest)) { i = j - 1; continue; }
    out.push({ v, index: words[i].index, end, cls: unitAfter(text, end), word: true });
    i = j - 1;
  }
  return out;
}

// ---- what a text claims ------------------------------------------------------

// Everything numeric a text states, after the pieces that are checked on their
// own (note names, dates, bar numbers, quoted names, fractions) are taken out.
// Returns { tokens, notes, dates, bars, quotes, joined, signed, spans }.
function read(textIn) {
  let text = clean(textIn);
  const out = { notes: new Set(), dates: [], quotes: [], joined: [], signed: [], tokens: [], text: '' };
  const blank = (re, f) => { text = text.replace(re, (...a) => { f(...a); return ' '.repeat(a[0].length); }); };

  // quoted names: "Bach prelude, Oct 19"
  blank(/"([^"]{1,80})"/g, (_, inner) => out.quotes.push(inner));

  // note names
  blank(NOTE_NAME, (n) => out.notes.add(n.replace('♯', '#').replace('♭', 'b')));

  // dates: "Oct 19", "October 19th", "19 October"
  blank(new RegExp(`\\b${MONTH_RE}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, 'gi'), (_, mo, d) => out.dates.push(`${mo.slice(0, 3).toLowerCase()} ${Number(d)}`));
  blank(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH_RE}\\b`, 'gi'), (_, d, mo) => out.dates.push(`${mo.slice(0, 3).toLowerCase()} ${Number(d)}`));

  // numbers joined to each other: fractions, ratios, ranges, ISO dates
  blank(/\d+(?:[.,]\d+)?\s*(?:[/⁄:]|[-–—−](?=\s?\d))\s*\d+(?:[.,]\d+)?(?:\s*(?:[/⁄:]|[-–—−])\s*\d+(?:[.,]\d+)?)*/g, (m) => out.joined.push(m.replace(/\s+/g, '')));

  // signed numbers: "-12", "+9", "minus 12"
  blank(/(^|[\s(\[:,])([-−+])(?=\d)/g, (_, pre, sign) => out.signed.push(sign));
  blank(new RegExp(`\\b(minus|negative)\\s+(?=\\d|(?:${[...Object.keys(ONES), ...Object.keys(TENS)].join('|')})\\b)`, 'gi'), (m) => out.signed.push(m.trim()));

  // bar and measure numbers
  const bars = [];
  blank(/\b(?:bars?|measures?|mm?\.)\s+(\d+)(?:\s*(?:,|and|&|to)\s*(\d+))*/gi, (m) => { for (const n of m.match(/\d+/g)) bars.push(Number(n)); });
  out.bars = bars;

  // digits
  for (const m of text.matchAll(DIGITS)) {
    const end = m.index + m[0].length;
    out.tokens.push({ v: toNumber(m[0]), index: m.index, end, cls: unitAfter(text, end), word: false });
  }
  out.tokens.push(...wordNumbers(text));
  // Roman numerals written in capitals: XIII
  for (const m of text.matchAll(/\b[IVXLCDM]{2,}\b/g)) {
    if (!/^M{0,3}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/.test(m[0])) continue;
    const val = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
    let v = 0;
    for (let i = 0; i < m[0].length; i++) v += val[m[0][i]] < (val[m[0][i + 1]] ?? 0) ? -val[m[0][i]] : val[m[0][i]];
    out.tokens.push({ v, index: m.index, end: m.index + m[0].length, cls: null, word: true });
  }
  out.text = text;
  return out;
}

const near = (x, a) => Math.abs(x - a) <= 0.051 || (Number.isInteger(x) && Math.round(a) === x);

// A number with no unit in the facts (a take count the player typed, a day of
// the month) can be repeated bare, as an ordinal or as a count of takes, and
// nothing else: "two weeks" is not "last two takes".
function compatible(reply, fact) {
  if (reply === null) return true;
  if (reply === fact) return true;
  if (fact === null) return reply === 'take' || reply === 'ordinal' || reply === 'multiple';
  return false;
}

// ---- words that say which way something moved --------------------------------

// Each axis has a good/up side and a bad/down side. A reply that leans one way
// where the facts lean only the other is a contradiction; a reply that leans
// either way where the facts say nothing on that axis is a claim nobody
// measured. When the facts hold BOTH sides of an axis (one metric closer, one
// further) the words cannot be told apart by this check and it lets them by:
// that is the one gap in it, and the comparison facts that hold both are
// listed in the test file.
const AXES = {
  closeness: {
    pos: /\b(closer|nearer|better|improv(?:ed|es|ing)|(?<!(?:room|scope|need|areas?) for )improvement|more accurate|more in tune|more notes arrive in tune|less off(?: pitch)?|less out of tune|more consistent|more secure|tidier|stronger|progressed|gained|ahead(?! of the beat)|outpac(?:ed|es|ing)|off (?:pitch|target)\b(?:[^.!?;]|\.\d){0,25}\b(?:less|fewer) than)\b(?! look)/,
    // "further" is the one word here that is also a discourse word ("further
    // work", "for further questions", "Further, ..."), so it is kept out of those
    // uses by what follows and precedes it. It used to be kept out by requiring a
    // WORD character before it, `(?<=\w\s)`, which also kept it out after "¢",
    // "%" and ")": "The Oct 22 take is 12.8¢ further from pitch" was not read as
    // a direction at all, in a reply (so the flip of a true "closer" passed) or in
    // the facts (so a true "further" was rejected as a change nobody measured).
    neg: /\b((?<!\b(?:any|for|no|see) )further(?!\s+(?:work|practice|study|questions?|detail|information|reading|help)\b|\s+on in\b)|farther|lost ground|backslid|slid back|went backwards?|set back|fell behind|less consistent|less secure|worse|worsen(?:ed|s|ing)?|declin(?:ed|es|ing|e)|regress(?:ed|ion)?|deteriorat(?:ed|es|ing)|less accurate|less in tune|fewer notes arrive in tune|more off(?: pitch)?|more out of tune|lost (?:\S+ ){0,3}accuracy|(?:accuracy|intonation|tuning) (?:dropped|fell|declined|decreased|worsened|slipped)|slipped|drifted|behind(?! the beat)|lags?|lagg(?:ed|ing)|trail(?:s|ed|ing)?|off (?:pitch|target)\b(?:[^.!?;]|\.\d){0,25}\bmore than)\b/,
  },
  steadiness: { pos: /\b(steadier|more steady|more stable)\b/, neg: /\b(shakier|less steady|less stable|wobblier|unsteadier)\b/ },
  timing: { pos: /\b(tighter)\b/, neg: /\b(looser|sloppier|less tight)\b/ },
  // "more precise" is said of pitch, of timing and of steadiness alike, so it has
  // no axis of its own in the facts: it is held against whichever of those the
  // facts do state (see PRECISION_OF).
  precision: { pos: /\b(more precise|more exact)\b/, neg: /\b(less precise|less exact)\b/ },
  speed: { pos: /\b(faster|quicker|speeds? up|speeding up|rush(?:es|ed|ing)?|more (?:quickly|rapidly)|accelerat(?:es|ed|ing|e))\b/, neg: /\b(slower|slows? down|slowing down|drag(?:s|ged|ging)?|less quick(?:ly)?|less rapid(?:ly)?|sluggish|decelerat(?:es|ed|ing|e)|more slowly)\b/ },
  width: { pos: /\b(wider|broader|more wide|widen(?:ed|s|ing)?|broaden(?:ed|s|ing)?)\b/, neg: /\b(narrower|less wide|narrow(?:ed|s|ing)?)\b/ },
  brightness: { pos: /\b(brighter)\b/, neg: /\b(darker|duller)\b/ },
  loudness: { pos: /\b(louder)\b/, neg: /\b(quieter|softer)\b/ },
  clarity: { pos: /\b(clearer|purer|cleaner)\b/, neg: /\b(rougher|breathier|muddier)\b/ },
  lead: { pos: /\b(sharper|sharp)\b/, neg: /\b(flatter|flat)\b/ },
};
// Words that say a quantity went up or down without saying which way is good:
// "the error fell" is the pitch error getting smaller, which is closer to pitch;
// "the vibrato rose" is the width. Which AXIS they speak of is read from what
// the sentence is about (MOTION_TOPICS, nearest topic word wins), and a sentence
// that is about none of them leaves the word unresolved. They are read in REPLIES
// only: the facts say what they mean in the explicit words of AXES, and a fact
// sentence's own "(lower can mean breathy or rough)" is not a direction.
//   upIsPos: when the quantity goes up, is that the pos side of the axis?
// An error, a wander and a lateness going up are the neg side; a width, a
// loudness, a clarity going up are the pos side.
const UP = /\b(?:went up|goes up|go up|going up|moved up|up by|rose|rises?|rising|increas(?:ed|es|ing|e)|grew|grows?|growing|climb(?:ed|s|ing)?|jump(?:ed|s|ing)?|higher|greater|larger|bigger)\b/g;
const DOWN = /\b(?:went down|goes down|go down|going down|moved down|down by|dropp?(?:ed|s|ing)|drop|fell|falls|fallen|falling|shrank|shrunk|shrinks?|shrinking|smaller|lower|reduc(?:ed|es|ing|e)|shorter|decreas(?:ed|es|ing|e))\b/g;
const MOTION_TOPICS = [
  ['closeness', false, /\b(?:errors?|off pitch|from pitch|cents off|out of tune|off target|inaccuracy|deviation|mistakes?)\b/],
  ['closeness', true, /\b(?:accuracy|intonation|in tune|tuning|precision)\b/],
  ['steadiness', false, /\b(?:wander|wobble|wobbling|shake|shaking|jitter|unsteadiness|drift)\b/],
  ['steadiness', true, /\b(?:steadiness|stability)\b/],
  ['width', true, /\b(?:vibrato|width|wide|depth)\b/],
  ['loudness', true, /\b(?:loudness|volume|dynamics?|decibels?|db|louder|quieter)\b/],
  ['speed', true, /\b(?:tempo|bpm|pulse|speed|pace)\b/],
  ['speed', false, /\b(?:time to settle|settle time|settling time|ms to settle|to settle)\b/],
  ['clarity', true, /\b(?:clarity|brightness)\b/],
  ['timing', false, /\b(?:timing|beat|rhythm)\b/],
];
// With no topic word in the sentence, the axis of the measurement the number
// belongs to decides, where a size word has one obvious meaning there.
const SIZE_UP_IS_POS = { closeness: false, steadiness: false, timing: false, width: true, loudness: true, clarity: true, brightness: true };

// -> [{ at, end, dir: 'up'|'down', axis: string|null, upIsPos }] in `lower`
function changeWords(lower) {
  const out = [];
  for (const [re, dir] of [[UP, 'up'], [DOWN, 'down']]) {
    for (const m of lower.matchAll(new RegExp(re.source, 'g'))) {
      const at = m.index;
      const end = at + m[0].length;
      const from = Math.max(0, lower.slice(0, at).search(/[^.!?;\n]*$/));
      const to = at + (lower.slice(end).search(/[.!?;\n]/) < 0 ? lower.length : lower.slice(end).search(/[.!?;\n]/)) ;
      const sentence = lower.slice(from, Math.min(lower.length, Math.max(end, to)));
      let best = null;
      for (const [axis, upIsPos, tre] of MOTION_TOPICS) {
        for (const t of sentence.matchAll(new RegExp(tre.source, 'g'))) {
          const d = Math.abs(from + t.index - at);
          if (!best || d < best.d) best = { d, axis, upIsPos };
        }
      }
      out.push({ at, end, dir, axis: best?.axis ?? null, upIsPos: best?.upIsPos ?? null });
    }
  }
  return out;
}
const NEGATORS = /\b(not|no|never|hardly|without|isn't|wasn't|didn't|doesn't|don't|aren't|weren't|cannot|can't)\b/;

function leanOf(text, { negation, contextual = false }) {
  // "Further, ..." at the start of a sentence is a connective, not a direction
  const t = text.toLowerCase().replace(/(^|[.!?]\s+)further,/g, '$1 ');
  const out = {};
  for (const [axis, { pos, neg }] of Object.entries(AXES)) {
    let p = false;
    let n = false;
    for (const [re, isPos] of [[pos, true], [neg, false]]) {
      const g = new RegExp(re.source, 'g');
      for (const m of t.matchAll(g)) {
        let flip = false;
        if (negation) {
          const before = t.slice(Math.max(0, m.index - 22), m.index);
          flip = NEGATORS.test(before) && !/[.;!?](?!\d)/.test(before.split(NEGATORS).pop());
        }
        if (isPos !== flip) p = true; else n = true;
      }
    }
    if (p || n) out[axis] = { pos: p, neg: n };
  }
  if (contextual) {
    for (const w of changeWords(t)) {
      if (!w.axis) continue;
      let flip = false;
      if (negation) {
        const before = t.slice(Math.max(0, w.at - 22), w.at);
        flip = NEGATORS.test(before) && !/[.;!?](?!\d)/.test(before.split(NEGATORS).pop());
      }
      const pos = ((w.dir === 'up') === w.upIsPos) !== flip;
      out[w.axis] = { pos: (out[w.axis]?.pos ?? false) || pos, neg: (out[w.axis]?.neg ?? false) || !pos };
    }
  }
  return out;
}

// Which notes a text calls sharp or flat. A sharp/flat word belongs to the note
// it is followed by through a preposition ("14 cents sharp on D3"), else to the
// note before it with no other sharp/flat between ("D3 runs 14¢ sharp"), else
// to the note after it. English puts it both ways and a nearest-name rule gets
// "D3 runs 14¢ sharp and A3 runs 12¢ flat" wrong.
function noteLeans(text) {
  const map = new Map();
  for (const sentence of clean(text).split(/(?<=[.!?])\s+|\n+/)) {
    const names = [...sentence.matchAll(/\b[A-G][#♯b♭]?\d\b/g)].map((m) => ({ at: m.index, end: m.index + m[0].length, name: m[0] }));
    if (names.length === 0) continue;
    const words = [...sentence.matchAll(/\b(sharp|flat)(?:er)?\b/gi)];
    for (const [i, m] of words.entries()) {
      const end = m.index + m[0].length;
      const prep = sentence.slice(end).match(/^\s*(?:on|for|in|at|with|of|from)\s+(?:the\s+|your\s+)?([A-G][#♯b♭]?\d)\b/);
      let name = prep ? prep[1] : null;
      if (!name) {
        const lastWord = i > 0 ? words[i - 1].index + words[i - 1][0].length : 0;
        const before = names.filter((n) => n.end <= m.index && n.at >= lastWord).pop();
        name = before?.name ?? names.find((n) => n.at >= end)?.name ?? null;
      }
      if (!name) continue;
      if (!map.has(name)) map.set(name, new Set());
      map.get(name).add(m[1].toLowerCase());
    }
  }
  return map;
}

// ---- which direction word belongs to which number ------------------------------

// leanOf asks whether the facts lean one way on an axis AT ALL, and gives up
// when they lean both ways ("9 notes landed closer, 1 note landed further"),
// which is exactly where a reply can swap the two numbers. This asks the finer
// question: the reply puts a direction word next to a number, the facts put the
// same number next to a word on the same axis, and the two are on opposite
// sides. "1 note landed closer" against "1 note landed further" is caught here
// and nowhere else.
//
// A word belongs to the number nearest it inside one clause (a clause ends at
// a full stop, colon, semicolon, comma, dash, or "and / but / so / which"); a
// clause with a word and no number of its own hands the word to the last number
// before it ("78% now — more notes arrive in tune") or, failing that, the first
// number after it ("fewer: 78% of notes arrive in tune"). When the facts put
// no word next to the number at all, nothing is said: the number is then
// checked only by the rules above, because "the vibrato is 12¢ wide" and "12¢
// closer" being the same 12 is a different fault (see topicsOfNumber).
const AMOUNT = { pos: /\bmore\b/, neg: /\b(?:fewer|less)\b/ };
// "more precise" is said of pitch, timing and steadiness alike
const PRECISION_OF = ['closeness', 'timing', 'steadiness'];

// -> [[start, end, opensSentence]]; a clause that opens a sentence (after a stop
// or a colon) has no "previous clause" to lend it a number.
function clauseSpans(lower) {
  const spans = [];
  let from = 0;
  let opens = true;
  let hard = true;
  for (const m of lower.matchAll(/[.!?;:](?=\s|$)|\n|\s[—–-]\s|,(?!\d)|\s(?:and|but|while|whereas|so|which)\s/g)) {
    spans.push([from, m.index, opens, hard]);
    from = m.index + m[0].length;
    opens = /^[.!?;:\n]/.test(m[0]);
    hard = /^[.!?;\n]/.test(m[0]);
  }
  spans.push([from, lower.length, opens, hard]);
  return spans.filter(([a, b]) => b > a);
}

// -> [{ v, cls, hits: [{ axis, pos }] }] for every number in a read() result
function numbersWithDirections(R, { negation, contextual = false }) {
  const lower = R.text.toLowerCase().replace(/(^|[.!?]\s+)further,/g, '$1        ');
  const spans = clauseSpans(lower);
  const cws = contextual ? changeWords(lower) : [];
  const out = R.tokens.map((t) => ({ ...t, hits: [] }));
  const perClause = spans.map(([s, e, opens, hard]) => {
    const seg = lower.slice(s, e);
    const taken = [];
    const hits = [];
    const scan = (axis, re, isPos) => {
      for (const m of seg.matchAll(new RegExp(re.source, 'g'))) {
        const a = m.index;
        const b = a + m[0].length;
        if (taken.some(([x, y]) => a < y && b > x)) continue;
        taken.push([a, b]);
        let flip = false;
        if (negation) {
          const before = seg.slice(Math.max(0, a - 22), a);
          flip = NEGATORS.test(before) && !/[.;!?](?!\d)/.test(before.split(NEGATORS).pop());
        }
        hits.push({ axis, pos: isPos !== flip, at: s + a, end: s + b });
        // "more notes arrive in tune" is also a MORE, so a reply that says
        // "fewer" next to the same number is on the other side of it ("less
        // off pitch" is not: a lower error is the good side)
        if (axis !== 'amount' && /^(more|less|fewer) /.test(m[0]) && !/ off\b/.test(m[0])) hits.push({ axis: 'amount', pos: m[0].startsWith('more') !== flip, at: s + a, end: s + b });
      }
    };
    // the named axes first, so "more accurate" is closeness and not "more"
    for (const [axis, { pos, neg }] of Object.entries(AXES)) { scan(axis, pos, true); scan(axis, neg, false); }
    scan('amount', AMOUNT.pos, true);
    scan('amount', AMOUNT.neg, false);
    // went up / dropped / smaller: the axis comes from what the sentence is about,
    // and is left null (to be read from the fact the number quotes) when it is
    // about none of them
    for (const w of cws.filter((x) => x.at >= s && x.at < e)) {
      if (taken.some(([x, y]) => w.at - s < y && w.end - s > x)) continue;
      let flip = false;
      if (negation) {
        const before = seg.slice(Math.max(0, w.at - s - 22), w.at - s);
        flip = NEGATORS.test(before) && !/[.;!?](?!\d)/.test(before.split(NEGATORS).pop());
      }
      if (w.axis) hits.push({ axis: w.axis, pos: ((w.dir === 'up') === w.upIsPos) !== flip, at: w.at, end: w.end });
      else hits.push({ axis: null, dir: w.dir, flip, at: w.at, end: w.end });
    }
    return { s, e, opens, hard, hits, tokens: out.filter((t) => t.index >= s && t.index < e) };
  });
  const give = (hit, tokens) => {
    const nearest = [...tokens].sort((x, y) => {
      const dx = x.end <= hit.at ? hit.at - x.end : x.index - hit.end;
      const dy = y.end <= hit.at ? hit.at - y.end : y.index - hit.end;
      return dx - dy || (x.end <= hit.at ? -1 : 1);
    })[0];
    nearest.hits.push({ axis: hit.axis, pos: hit.pos, dir: hit.dir, flip: hit.flip, at: hit.at, end: hit.end });
  };
  perClause.forEach((c, i) => {
    if (c.hits.length === 0) return;
    if (c.tokens.length > 0) { for (const h of c.hits) give(h, c.tokens); return; }
    // a word with no number in its own clause: the number before it when that
    // one has no word yet ("78% now - more notes arrive in tune"), else the
    // number after it ("A3 flat, by 12 cents")
    const prev = c.opens ? null : perClause[i - 1];
    const next = perClause[i + 1];
    const last = prev?.tokens.at(-1);
    const target = last && last.hits.length === 0 ? last : next && !next.hard && next.tokens.length && next.tokens[0].hits.length === 0 ? next.tokens[0] : null;
    if (target) for (const h of c.hits) target.hits.push({ axis: h.axis, pos: h.pos, dir: h.dir, flip: h.flip, at: h.at, end: h.end });
  });
  // every word that was read as a direction, so that what is NOT is findable
  out.consumed = perClause.flatMap((c) => c.hits.filter((h) => h.axis).map((h) => [h.at, h.end]));
  return out;
}

// Words that read as a direction by their shape, for the conservative default.
// Comparatives (-er), "more/less/fewer X" and -ed / -ing verbs are the shapes a
// direction takes in English; -s is only a verb of change if it is one of these
// (the plural noun "notes" is -s too).
const NOT_COMPARATIVE = new Set(['number', 'numbers', 'other', 'others', 'another', 'after', 'under', 'over', 'answer', 'order', 'center', 'centre', 'power', 'paper', 'cover', 'offer', 'never', 'ever', 'either', 'neither', 'whether', 'together', 'player', 'finger', 'character', 'remember', 'newer', 'older', 'later', 'earlier', 'former', 'latter', 'latest', 'meter', 'letter', 'matter', 'water', 'consider', 'during', 'inner', 'outer', 'upper', 'sooner', 'closer', 'quieter', 'louder']);
const NEUTRAL_WORDS = new Set(['measured', 'averaged', 'played', 'playing', 'heard', 'recorded', 'recording', 'reached', 'landed', 'arrived', 'settled', 'settling', 'called', 'named', 'based', 'compared', 'comparing', 'shown', 'showing', 'given', 'remaining', 'following', 'including', 'according', 'being', 'having', 'going', 'getting', 'making', 'taking', 'using', 'sounded', 'looked', 'saved', 'tuned', 'tuning', 'listed', 'counted', 'counting', 'rated', 'worked', 'working', 'practised', 'practising', 'practiced', 'practicing', 'timing', 'pitched', 'feeling', 'morning', 'evening', 'something', 'nothing', 'anything', 'everything', 'phrasing', 'breathing', 'asked', 'asking', 'noted', 'found', 'looking', 'wanted', 'needed', 'held', 'said', 'worth', 'based', 'listened', 'listening', 'started', 'finished', 'finishing', 'repeated', 'repeating', 'detected', 'read', 'reading', 'recorded', 'sustained', 'applied', 'counted', 'expected', 'related', 'detached', 'connected', 'tuned', 'asked', 'noted', 'saved', 'used', 'rated', 'named', 'fixed', 'mixed', 'ended', 'added', 'owned', 'aimed', 'ranked', 'timed', 'paced', 'based', 'ruled', 'issued', 'needed', 'sized', 'shared', 'scored', 'tested']);
const MOTION_S = /^(?:trails?|lags?|eases|dips|slips|slides|sags|sinks|surges|climbs|jumps|tapers|fades|drifts|falls|drops|rises|grows|shrinks|slows|speeds|gains|loses|outpaces|leads|trails)$/;
const UNIT_OR_NOUN = new Set(['notes', 'note', 'times', 'time', 'cents', 'cent', 'ms', 'db', 'hz', 'percent', 'points', 'point', 'seconds', 'second', 'beats', 'beat', 'bars', 'bar', 'takes', 'take', 'days', 'day', 'than', 'of', 'in', 'on', 'to', 'and', 'or', 'about']);

// -> the first such word near the number at `at` that nothing accounts for, or ''.
// "Near" is the same sentence and five words either way: the unknown word is
// often in the clause before ("The take sagged: 12.8¢ against before").
const FIVE = 5;
const BEFORE_A_NOUN = new Set(['of', 'the', 'a', 'an', 'your', 'my', 'this', 'that', 'any', 'some', 'no', 'with', 'for', 'to', 'each', 'every', 'its', 'their', 'his', 'her', 'our']);
const COPULAS = new Set(['is', 'are', 'was', 'were', 'got', 'get', 'gets', 'become', 'became', 'be', 'been', 'felt', 'feels', 'sounds', 'sounded', 'looks', 'looked']);
const AFTER_A_COMPARATIVE = new Set(['than', 'by', 'now', 'from', 'at', 'in', 'on', 'still', 'again', 'overall', 'today']);
function unknownDirectionWord(lower, at, consumed, factsWords) {
  // a sentence ends at . ! ? ; or a newline, and a full stop before a digit is a decimal point
  const brk = [...lower.matchAll(/[!?;\n]|\.(?!\d)/g)].map((m) => m.index);
  const from = (brk.filter((b) => b < at).pop() ?? -1) + 1;
  const to = brk.find((b) => b >= at) ?? lower.length;
  const seg = lower.slice(from, to);
  const toks = [...seg.matchAll(/[a-z][a-z'-]*|\d+(?:\.\d+)?/g)].map((m) => ({ w: m[0], a: from + m.index, b: from + m.index + m[0].length, num: /^\d/.test(m[0]) }));
  const here = toks.findIndex((t) => t.a >= at);
  const center = here < 0 ? toks.length - 1 : here;
  const inFacts = (w) => {
    if (new RegExp(`\\b${w}\\b`).test(factsWords)) return true;
    const stem = w.replace(/(?:ing|ed|er|es|s)$/, '');
    return stem.length >= 4 && factsWords.includes(stem);
  };
  const covered = (a, b) => consumed.some(([x, y]) => a < y && b > x);
  for (let i = Math.max(0, center - FIVE); i < Math.min(toks.length, center + FIVE + 1); i++) {
    const t = toks[i];
    if (t.num || inFacts(t.w)) continue;
    const prev = toks[i - 1];
    const next = toks[i + 1];
    if (/^(?:more|less|fewer)$/.test(t.w)) {
      // "more" alone is read as an amount word whatever follows it, so what
      // matters is whether the PAIR is one the lexicon read ("more accurate")
      if (!next || next.num || UNIT_OR_NOUN.has(next.w) || inFacts(next.w) || consumed.some(([x, y]) => x <= t.a && y >= next.b)) continue;
      return `${t.w} ${next.w}`;
    }
    if (covered(t.a, t.b)) continue;
    if (NEUTRAL_WORDS.has(t.w) || NOT_COMPARATIVE.has(t.w)) continue;
    if (/^[a-z]{4,}er$/.test(t.w)) {
      // a comparative stands after a number, after "is", or before "than"; "of
      // wander", "the number" and "your player" are nouns that end the same way
      const stands = (prev && (prev.num || UNIT_OR_NOUN.has(prev.w) || COPULAS.has(prev.w))) || (next && AFTER_A_COMPARATIVE.has(next.w)) || !next;
      if (stands && !(prev && BEFORE_A_NOUN.has(prev.w))) return t.w;
      continue;
    }
    if (/^[a-z]{3,}ed$/.test(t.w) && !(prev && COPULAS.has(prev.w)) || /^[a-z]{4,}ing$/.test(t.w) || MOTION_S.test(t.w) || /^(?:sped|slid|sank|swung|shot|crept)$/.test(t.w)) return t.w;
  }
  return '';
}

// numbers in the facts that a number in the reply could be quoting
const quotes = (reply, fact) => near(reply.v, fact.v) && compatible(reply.cls, fact.cls);

// ---- what a number is about --------------------------------------------------------

// "twelve cents closer" was built from the 12 in "...at about 5.4 Hz and 12¢
// wide": the number is in the facts, with a unit the reply also uses, and it is
// the vibrato's. The number rules cannot see that, because they ask only
// whether the digit (and its unit) exists somewhere. So a number that sits in a
// clause about one thing in the reply must sit in a sentence about the same
// thing in the facts.
//
// What it cannot see, and the test file says so: two numbers about the SAME
// thing in the same sentence swapped ("9¢ now against 22¢ before" read back as
// "22¢ now"), a number in the right sentence of the wrong TAKE, and a clause
// with none of these words in it (nothing is said about it).
const NUMBER_TOPICS = {
  pitch: /\b(pitch|in tune|out of tune|sharp|flat|closer|nearer|further|farther|accura\w*|error|off|leans?|runs?)\b/,
  vibrato: /\b(vibrato|wide|width|wider|narrow\w*|hz|hertz|speed|rate)\b/,
  steadiness: /\b(stead\w*|wander\w*|wobbl\w*|shak\w*|stable)\b/,
  arrival: /\b(settle\w*|arriv\w*|land\w*)\b/,
  loudness: /\b(loud\w*|quiet\w*|soft\w*|dynamics?|volume|db|decibels?)\b/,
  tempo: /\b(tempo|pulse|beats?|bpm|rush\w*|drag\w*|even\w*|timing|tight\w*|loose\w*|rhythm)\b/,
  tone: /\b(clarity|bright\w*|dark\w*|breathy|rough|harmonics?|tone)\b/,
  shaping: /\b(phras\w*|articulat\w*|legato|detach\w*|rubato|shap\w*|contrast\w*|swell\w*|repeat\w*|alike)\b/,
  practice: /\b(streak|practis\w*|practic\w*|days?|week)\b/,
};
const topicsIn = (s) => new Set(Object.entries(NUMBER_TOPICS).filter(([, re]) => re.test(s)).map(([k]) => k));

// ---- which number the words beside it belong to --------------------------------

// 8c above asks whether a number sits in a sentence about the same sort of thing,
// and cannot see two numbers in ONE sentence swapped: the range and the step of
// the loudness ("12 dB between the quietest and loudest ...; neighbouring notes
// differ by 1.8 dB"), a note's lean and its spread ("D3 runs 14¢ sharp (spread
// ±2¢ ...)"). Each number has a LABEL, the content words between it and the
// number or the comma, colon or bracket before it, and the ones after it up to
// the next. The rule is deliberately one-sided: a reply number is refused when
// its words are the words of a different number of the same unit and share
// none with the number it quotes. A reply that says nothing the facts' words
// recognise ("your dynamics span 12 dB") is left to the other rules, because
// synonyms are most of what a paraphrase is.
const LABEL_STOP = new Set(('a an the and or but of at by in on to for with from as is are was were be been it its this that these those your you my i about around roughly '
  + 'approximately nearly almost over under than then so now before after average mean overall each every per about up down off out also just only still about '
  + 'cent cents db decibels decibel hz hertz ms milliseconds millisecond s sec secs second seconds percent bpm beats beat points point notes note times time take takes '
  + 'where which what who how when').split(/\s+/));
const SEGMENT_BREAK = /[;:()\n]|[.!?](?=\s|$)|,(?!\d)/g;
function wordsOf(s) {
  return (s.toLowerCase().match(/[a-z][a-z']*|[a-g][#b]?\d/g) ?? [])
    .map((w) => (/^[a-g][#b]?\d$/.test(w) ? w : w.replace(/'s$/, '').replace(/(?:ing|ed|es|s)$/, (m, i, all) => (all.length > 5 ? '' : m))))
    .filter((w) => w.length > 1 && !LABEL_STOP.has(w));
}
// A take's name and its date are words too, and they sit beside half the numbers
// in a comparison; they say WHICH take, not what was measured, so they are blanked.
const blankNames = (s) => s
  .replace(/"[^"]{1,80}"/g, (m) => ' '.repeat(m.length))
  .replace(new RegExp(`\\b${MONTH_RE}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?\\b`, 'gi'), (m) => ' '.repeat(m.length));
function labelled(tokens, txtIn) {
  const txt = blankNames(txtIn);
  const breaks = [...txt.matchAll(SEGMENT_BREAK)].map((m) => m.index);
  const ordered = [...tokens].sort((a, b) => a.index - b.index);
  return ordered.map((t, i) => {
    const segStart = (breaks.filter((b) => b < t.index).pop() ?? -1) + 1;
    const segEnd = breaks.find((b) => b >= t.end) ?? txt.length;
    const prev = ordered[i - 1];
    const next = ordered[i + 1];
    const from = prev && prev.end > segStart ? prev.end : segStart;
    const to = next && next.index < segEnd ? next.index : segEnd;
    const unitEnd = t.end + (/^\s*(?:¢|%|cents?|ms|db|hz|s\b)/i.exec(txt.slice(t.end))?.[0].length ?? 0);
    // the words AFTER a number run only to the next connector: in "D3 runs 2¢
    // sharp with a spread of ±14¢", "a spread of" leads into the 14 and is not
    // the 2's
    const after = txt.slice(Math.min(unitEnd, to), to).split(/\b(?:with|and|but|over|while|at|by|for|of|in|from|where|between|against|than|compared)\b/i)[0];
    return { ...t, words: new Set(wordsOf(`${txt.slice(from, t.index)} ${after}`)) };
  });
}
const sharesAny = (a, b) => [...a].some((w) => b.has(w));
const NOTE_WORD = /^[a-g][#b]?\d$/;
function misattached(R, replyTxt, F, factsTxt) {
  const out = [];
  const theirs = labelled(F.tokens, factsTxt);
  for (const r of labelled(R.tokens, replyTxt)) {
    if (!r.cls || r.words.size === 0) continue;
    const same = theirs.filter((f) => quotes(r, f));
    if (same.length === 0) continue;
    const others = theirs.filter((f) => f.cls === r.cls && !near(r.v, f.v));
    const rn = [...r.words].filter((w) => NOTE_WORD.test(w));
    // which NOTE: D3's figure given to A3
    if (rn.length && same.every((f) => { const fn = [...f.words].filter((w) => NOTE_WORD.test(w)); return fn.length && !fn.some((n) => rn.includes(n)); })) {
      out.push(`${r.v}${r.cls ? ` ${r.cls}` : ''} belongs to ${[...same[0].words].filter((w) => NOTE_WORD.test(w)).join('/')}, not ${rn.join('/')}`);
      continue;
    }
    // a number whose own words are empty in the facts (a take's average in a
    // comparison, "9¢" after a quoted name) says nothing to hold the reply to
    if (same.some((f) => f.words.size === 0 || sharesAny(r.words, f.words))) continue;
    const stolen = others.find((f) => sharesAny(r.words, f.words));
    if (stolen) out.push(`${r.v}${r.cls ? ` ${r.cls}` : ''} is the measurement beside "${[...stolen.words].slice(0, 3).join(' ')}" in the facts, and the number beside "${[...same[0].words].slice(0, 3).join(' ')}" is ${stolen.v}`);
  }
  return out;
}

// ---- things the facts say were not measured ------------------------------------

const HEDGE = /\bno [\w ]{0,30}(measurement|data|reading)s?\b|not measured|wasn't measured|weren't measured|could not|couldn't|cannot|can't|\bunable\b|no (data|measurement|steady|pulse)|not available|don't have|do not have|didn't|did not|isn't|aren't|not enough|too few|nothing|unmeasured|not able|only one|no saved/i;
const TOPICS = {
  tone: /\b(vibrato|tone|timbre|clarity|brightness|bright|breathy|rough|steadiness|wander)\b/i,
  dynamics: /\b(loud|loudness|quiet|dynamics?|volume|decibels?|db)\b/i,
  tempo: /\b(rush|rushing|drag|dragging|tempo|pulse|bpm|rhythm|timing|evenly|evenness)\b|\bspeeds? up\b|\bslows? down\b/i,
  compare: /\b(closer|further|farther|improv\w*|better|worse|declin\w*|than before|than last time|since (last|before))\b/i,
  worst: /\b(weakest|worst|trouble|struggl\w*)\b/i,
  everything: /\d|\b(closer|further|sharp|flat|improv\w*|vibrato|tone|rush\w*|drag\w*)\b/i,
};
const MARKERS = [
  [/could not be measured|cannot compare|not enough long notes|could not be read/i, ['tone', 'dynamics']],
  [/no steady pulse/i, ['tempo']],
  [/only one take is saved|nothing to compare/i, ['compare']],
  [/too few repeated notes/i, ['worst']],
  [/no saved takes|nothing to answer from/i, ['everything']],
];

// Things no measurement here can support. A phrase is allowed only when the
// facts or the question already use it.
const SUPERLATIVE = [/\b(best (take|ever|yet|so far|one)|personal (best|record)|all[- ]time|lowest ever|highest ever|worst ever|ever recorded|your best)\b/];
const BENCHMARK = [
  /\b(most|other|average|typical) (players|cellists|violinists|musicians|singers|students|people|performers|pianists|guitarists)\b/,
  /\bthan (most|others|everyone|anyone|average)\b/,
  /\b(for|as) an? (beginner|intermediate|advanced|amateur|professional)\b/,
  /\b(beginner|intermediate|advanced|professional|amateur|conservatoire)\b/,
  /\bat your (level|stage|age)\b/,
];
// The model never hears the audio; claiming to is claiming a measurement.
const HEARING = [
  /\bi (listened|can hear|could hear|hear|noticed)\b|\blistened to\b/,
  /\b(sounds?|sounded|sounding) (like |as if )?(warm|rich|thin|tense|beautiful|great|good|lovely|nice|harsh|pinched|forced|relaxed|natural|musical|mushy|clean|full|dark|bright|wide|steady|even|smooth|rough|breathy|expressive)\b/,
];
// Taste and praise. "Your playing was beautiful and very musical, with lovely
// feeling." has no digit for the number rules to catch and no direction word for
// the direction rules, and nothing the app measured says it. The first version
// of this check ran only when the facts carried the shaping caveat ("not a
// judgement of taste"), so it protected the questions about phrasing and let
// the same sentence through on 10 of 13 other questions (summary, habits,
// tone, tempo, trend). Now it runs on every reply, and a word is allowed only
// if the FACTS use it: not the question (a player asking "does it sound
// musical" must not be answered "yes, it is musical"), and not the caveat.
//
// Three kinds of word, because each needs its own shape to avoid catching a
// description: words that are a verdict wherever they appear; a praise or
// blame adjective in front of the thing it grades ("good phrasing", "great
// intonation"); and a verdict after "is/was/sounds/went" ("your tone was
// good", "it went well"). Direction words ("closer to pitch", "steadier") are
// NOT here: those restate what the facts say and are held to them by the
// direction rules.
const TASTE_NOUNS = 'phrasing|shaping|articulation|rubato|feeling|playing|take|tone|intonation|sound|work|job|progress|improvement|session|practice|performance|result|results|rhythm|timing|pitch|vibrato|technique';
const TASTE = new RegExp(`\\b(beautiful(?:ly)?|lovely|gorgeous|musical(?:ly|ity)?|expressive(?:ly|ness)?|emotional(?:ly)?|soulful|soulless|lifeless|boring|dull|passionate|artistic(?:ally)?|wonderful(?:ly)?|amazing(?:ly)?|impressive(?:ly)?|excellent(?:ly)?|perfect(?:ly)?|superb(?:ly)?|fantastic|brilliant(?:ly)?|terrific|outstanding|awesome|mechanical|robotic|stiff|well[- ]phrased|(?:better|poorly|badly|nicely|beautifully)[- ]phrased|(?:well|nicely) (?:done|played)|(?:good|great|nice) (?:job|work)|keep (?:it|up)|congratulations|bravo|(?:good|great|poor|bad|lovely|nice|wonderful|natural|fine|terrible|awful|strong|weak|solid|decent) (?:${TASTE_NOUNS})|(?:is|are|was|were|looks?|sounds?|sounded|seems?|seemed|feels?) (?:very |really |pretty |quite |so |fairly |rather )?(?:good|great|fine|ok|okay|alright|bad|poor|nice|terrible|awful|decent)|(?:went|go|goes|going|did|doing|played|playing|play|plays) (?:very |really |pretty |quite |so |fairly )?well)\\b`, 'g');

// Verdicts with no digit and no direction word. "Your intonation is solid",
// "your pitch is accurate", "no problems here", "you nailed it", "your playing was
// in tune" give the number rules nothing to read, and TASTE above knew "good",
// "great" and "fine" and not "solid", "accurate" or "clean". Three shapes, all
// rejected unless the FACTS say the same thing:
//   - a copula and an adjective, "X is ADJ": the facts must have ADJ in a
//     sentence that is about X. Asking only whether the facts contain the word
//     let "your vocal range is wide" ride on the vibrato's "27¢ wide" and "your
//     playing was in tune" ride on "notes arrive in tune within 60 ms".
//   - a stock phrase ("nailed it", "no problems", "steady progress", "too fast"):
//     the facts must contain the phrase itself.
//   - an adverb on a verb of playing ("played it accurately").
// "X is 27¢ wide" is a description and is not matched: a number between the
// copula and the adjective is a measurement, which the number rules hold. The
// facts are read without their parentheses, because "(lower can mean breathy or
// rough)" is a caveat about what a low clarity can mean and not a statement that
// the tone is breathy.
const EVAL_ADJ = 'breathy|raspy|muddy|nasal|pinched|forced|mushy|airy|scratchy|solid|accurate|inaccurate|precise|exact|reliable|consistent|inconsistent|steady|unsteady|stable|secure|insecure|clean|clear|warm|cold|rich|full|thin|bright|dark|dull|wide|narrow|broad|tight|loose|even|uneven|smooth|rough|strong|weak|healthy|controlled|confident|hesitant|shaky|wobbly|sloppy|messy|tidy|harsh|tense|relaxed|natural|lively|lovely|on pitch|on point|on target|spot on|in tune|out of tune|in time|out of time|fast|slow|quick|loud|quiet|soft|excellent|impressive|polished|rounded|focused|resonant|expressive|musical|sweet|pure|stiff|correct|incorrect|fine|good|great|ok|okay|poor|bad|decent|nice';
const COPULA = `(?:is|are|was|were|am|'s|'re|isn't|aren't|wasn't|weren't|looks?|looked|sounds?|sounded|seems?|seemed|feels?|felt|stays?|stayed|remains?|remained|came out|comes out|came across|comes across|has been|have been|had been|become|became|becomes|getting|got|gets)`;
const INTENSIFIER = `(?:(?:not|never|very|really|pretty|quite|so|fairly|rather|extremely|incredibly|remarkably|particularly|especially|generally|mostly|largely|still|also|always|usually|consistently|just|too|a bit|a little|somewhat|reasonably|perfectly|nicely|overall|all in all)\\s+)*`;
const PREDICATE = new RegExp(`((?:\\b[a-z][a-z'-]*\\s+){0,3})\\b${COPULA}\\s+${INTENSIFIER}(?:(?:the|a|an)\\s+)?(${EVAL_ADJ})\\b`, 'g');
// "too fast", "too wide": a judgement of degree. Held to the exact phrase.
const TOO_X = /\btoo (?!few\b|much\b|many\b)([a-z]+)/g;
const STOCK = [
  /\bnail(?:ed|ing|s)? it\b/, /\bspot on\b/, /\bon point\b/, /\bon the (?:mark|money|right track)\b/, /\bright track\b/, /\bright direction\b/,
  /\bno (?:problems?|issues?|concerns?|worries|faults?|complaints?|mistakes?|errors?|trouble)\b/, /\bnothing (?:to worry about|wrong|to fix|to improve)\b/, /\bnot a (?:problem|concern|worry)\b/,
  /\ball (?:good|fine|well)\b/, /\beverything (?:is|was|looks|sounds) (?:in tune|fine|good|great)\b/, /\bkeep (?:going|it up)\b/, /\byou(?:'re| are) getting there\b/,
  /\b(?:steady|solid|clear|real|great|good|noticeable|visible|significant|big|huge|major|slow|rapid|fast|consistent|continued|measurable) (?:progress|improvement|gains?)\b/,
  /\b(?:making|show(?:ing|s)?|shown) (?:progress|improvement)\b/,
];
const ATTRIBUTIVE = new RegExp(`\\b(solid|accurate|precise|clean|warm|steady|reliable|secure|confident|tidy|rich|full|healthy|controlled|consistent|tight|polished|focused|even|smooth|strong) (intonation|pitch|tuning|tone|sound|playing|vibrato|rhythm|timing|technique|take|performance|range|phrasing|bowing|breath|control|foundation)\\b`, 'g');
const ADVERB_ON_PLAYING = /\b(?:play(?:ed|ing|s)?|sang|sing(?:ing|s)?|perform(?:ed|ing|s)?|did|nailed) (?:it |that |this |them |the \w+ |your \w+ )?(accurately|cleanly|precisely|reliably|confidently|solidly|steadily|beautifully|perfectly|flawlessly|in tune|on pitch|in time)\b/g;
const DETERMINERS = new Set(['your', 'the', 'my', 'this', 'that', 'these', 'those', 'a', 'an', 'and', 'but', 'so', 'then', 'now', 'overall', 'also', 'both', 'all', 'of', 'in', 'on', 'at', 'to', 'for', 'with', 'by', 'is', 'are']);
const PRONOUNS = new Set(['it', 'this', 'that', 'they', 'there', 'which', 'what', 'everything', 'something', 'anything']);
const headStem = (w) => w.replace(/s$/, '');

// -> ["intonation is solid", ...] the verdicts in `text` that `factsText` does not make
function verdictsIn(text, factsText) {
  const noParens = factsText.replace(/\([^)]*\)/g, ' ').toLowerCase();
  const sents = noParens.split(/(?<=[.!?])\s+|[\n;]+/).filter(Boolean);
  const has = (re) => sents.some((s) => re.test(s));
  const word = (w) => new RegExp(`\\b${w.replace(/ /g, '\\s+')}\\b`);
  const out = [];
  const lower = clean(text).toLowerCase().replace(/'/g, "'");
  for (const m of lower.matchAll(PREDICATE)) {
    // "so I cannot say whether your playing is even": a word inside a whether-
    // or if-clause is being asked about, not asserted
    if (/\b(?:whether|if)\b[^.;!?]*$/.test(lower.slice(Math.max(0, m.index - 60), m.index + m[1].length))) continue;
    const adj = m[2];
    const lead = m[1].trim().split(/\s+/).filter(Boolean);
    while (lead.length && DETERMINERS.has(lead[0])) lead.shift();
    const headWord = lead.at(-1);
    const head = headWord && !PRONOUNS.has(headWord) ? headStem(headWord) : null;
    // the subject "you" / "I" / "we" is not a thing the facts are about
    const onlyAdj = head === null;
    const adjRe = word(adj);
    const said = onlyAdj ? has(adjRe) : sents.some((s) => adjRe.test(s) && new RegExp(`\\b${head}`).test(s));
    if (!said) out.push(`${headWord ? `${headWord} ` : ''}${m[0].trim().split(/\s+/).slice(lead.length ? -1 : 0).join(' ')}`.trim());
  }
  for (const m of lower.matchAll(TOO_X)) if (!noParens.includes(m[0])) out.push(m[0]);
  for (const re of STOCK) { const m = lower.match(re); if (m && !noParens.includes(m[0])) out.push(m[0]); }
  for (const m of lower.matchAll(ATTRIBUTIVE)) if (!noParens.includes(m[0])) out.push(m[0]);
  for (const m of lower.matchAll(ADVERB_ON_PLAYING)) if (!noParens.includes(m[1])) out.push(m[0]);
  return [...new Set(out)];
}

// Instruments and voice types, by name. An explicit list and not router.js's
// PLAYS, which also holds "scale", "part", "range" and "solo": those are words a
// description can use. "bass" alone is left out (a bass clef, a bass note).
const PLAYERS = /\b(violin|viola|cello|violoncello|double bass|contrabass|bass guitar|guitar|ukulele|banjo|mandolin|harp|piano|keyboard|organ|flute|piccolo|oboe|clarinet|bassoon|saxophone|sax|trumpet|trombone|tuba|french horn|horn|cornet|euphonium|drums|percussion|soprano|mezzo|mezzo-soprano|contralto|alto|tenor|baritone|choir)\b/g;
// "D Major", "F# minor", "Bb-major", never a bare "minor" (a minor difference).
// The letter must be a capital, and an "A" that is the article ("A minor
// difference ...") counts only when what follows is a thing a key is of.
const KEYS = /\b([A-G][#♯♭b]?)[- ]([Mm]ajor|[Mm]inor)\b(?:\s+([a-z]+))?/g;
const KEY_NOUNS = new Set(['scale', 'scales', 'key', 'arpeggio', 'arpeggios', 'chord', 'piece', 'etude', 'study', 'prelude', 'sonata', 'concerto', 'suite', 'triad', 'take', 'one', 'passage', 'exercise']);
function keysIn(text) {
  const out = [];
  for (const m of clean(text).matchAll(KEYS)) {
    if (m[1] === 'A' && m[3] && !KEY_NOUNS.has(m[3])) continue;
    out.push(`${m[1]} ${m[2]}`.toLowerCase().replace('♯', '#').replace('♭', 'b'));
  }
  for (const m of clean(text).matchAll(/\bkey of ([A-G][#♯♭b]?)\b/g)) out.push(`key of ${m[1]}`.toLowerCase());
  return out;
}

// A question that asks for a verdict, and a reply that gives one.
const YES_NO_QUESTION = /^\s*(?:(?:so|ok|okay|hey|and|also|um)[,\s]+)*(?:is|am|are|was|were|do|does|did|have|has|had|can|could|should|would|will|isn't|aren't|wasn't|don't|doesn't|didn't)\b/;
const JUDGEMENT = /\btoo \w+|\b(?:good|bad|fine|ok|okay|alright|correct|incorrect|right|wrong|great|decent|acceptable|terrible|awful|any good|in tune|out of tune|off|enough|ready|problem)\b/;
const OPENS_WITH_VERDICT = /^\s*(?:(?:yes|yeah|yep|yup|correct|absolutely|definitely|indeed|exactly|sure|certainly)\b|(?:no|nope)\b\s*[,.!:;—-])/i;
// "not measured", said of something
const ABSENT = /\b(?:not measured|wasn't measured|was not measured|weren't measured|were not measured|isn't measured|no measurements?|not available|could not be measured|couldn't be measured|cannot be measured|can't be measured|nothing was measured)\b/i;

const SPECULATION =/\b(probably|likely|presumably|perhaps|maybe|i guess|i'd guess|i suspect|might be|could be(?! (?:found|measured|read|compared|determined|told))|most likely)\b/;

const sentences = (t) => t.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);

// ---- the check ---------------------------------------------------------------

const MULTIPLIER = /\b(twice|thrice|double[ds]?|doubling|triple[ds]?|tripling|(?:two|three|four|five|ten)-?fold|half|halves|halved|halving|quarters?(?! note| rest)|(?:a|one|two|three|by a|over a|under a|nearly a|about a|almost a|only a|just a) (?:third|fifth|tenth)s?|(?:third|fifth|tenth)s? of|a couple|dozens?|semitones?|half[- ]steps?|whole[- ]steps?|octaves?|quarter[- ]tones?|twenties|thirties|forties|fifties|teens|double digits|single digits)\b/gi;
const WEEKDAY = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi;
const FULL_MONTH = /\b(january|february|march|april|june|july|august|september|october|november|december)\b/gi;

// reply, facts: strings; question: what the player typed.
// opts.takeCount: how many takes the facts were built from, so "the two takes"
// is allowed exactly when two were used.
// -> { ok, stray: [numbers that are not in the facts], reason, problems: [{ kind, text }] }
export function checkReply(reply, facts, question = '', opts = {}) {
  const text = String(reply ?? '').trim();
  if (text.length === 0) return { ok: false, stray: [], reason: 'empty', problems: [{ kind: 'empty', text: '' }] };
  if (text.length > 1200) return { ok: false, stray: [], reason: 'too long', problems: [{ kind: 'long', text: '' }] };

  const problems = [];
  const stray = [];
  const add = (kind, what) => problems.push({ kind, text: what });
  if (stripScopeTags(text) !== text) add('echo', 'a scope tag from the prompt');

  const factList = Array.isArray(facts) ? facts : [facts];
  const factsText = clean(factList.join('\n'));
  const qText = clean(question);
  const factsLower = factsText.toLowerCase();
  const qLower = qText.toLowerCase();
  const everything = `${factsLower}\n${qLower}`;

  const F = read(factsText);
  const Q = read(qText);
  const R = read(text);

  // days: each use must meet the same use in the facts, and the count of days
  // practised ("3 of the last 7") is a count in its own right
  const dayUses = F.tokens.filter((t) => t.cls === 'days').map((t) => ({ v: t.v, role: dayRole(F.text, t) }));
  for (const m of F.text.matchAll(COUNT_OF_WINDOW)) dayUses.push({ v: Number(m[1]), role: 'count' });

  // numbers inside a take name are the name's, usable only as plain numbers
  const nameNumbers = [...F.quotes, ...Q.quotes].flatMap((q) => numbersIn(q)).map((v) => ({ v, cls: 'name' }));
  // A count of takes the PLAYER typed ("my last 3 takes") says what was asked,
  // not how many takes there are: licensing it back let "over the last 3 takes"
  // through on sentences built from one. Counts of takes are held to takeCount
  // and to the facts below.
  const allowed = [...F.tokens, ...Q.tokens.filter((t) => t.cls !== 'take'), ...nameNumbers].map((t) => ({ v: t.v, cls: t.cls }));
  for (const u of dayUses) allowed.push({ v: u.v, cls: 'days' });
  // "88 out of 100" used to be allowed as a percentage said another way. It let
  // "vibrato is on 88% of notes" through (88 is the tone clarity, and the facts'
  // own percentages are about notes), and no reply the real model gave in
  // tools/ai-model/results ever wrote the clarity as a percentage: the one that
  // mentioned it said "88 out of 100". So a number out of 100 stays a number out
  // of 100.
  const allowedBars = new Set([...F.bars, ...Q.bars]);
  // a take's name carries its date ("Bach prelude, Oct 19"), and a reply that
  // says "the Oct 19 take" is quoting it
  const allowedDates = new Set([...F.dates, ...Q.dates, ...[...F.quotes, ...Q.quotes].flatMap((q) => read(q).dates)]);
  for (const d of allowedDates) allowed.push({ v: Number(d.split(' ')[1]), cls: null });

  // 1. digits and number words, each with its unit
  for (const t of R.tokens) {
    let ok = allowed.some((a) => near(t.v, a.v) && compatible(t.cls, a.cls));
    if (!ok && t.cls === 'take' && opts.takeCount != null && t.v === opts.takeCount) ok = true;
    if (ok && t.cls === 'days') {
      const role = dayRole(R.text, t);
      if (!dayUses.some((u) => u.role === role && near(t.v, u.v))) { ok = false; add('count', `${t.v} days used as a ${role === 'gap' ? 'gap between sessions' : role}, which the measurements do not state`); stray.push(t.v); continue; }
    }
    if (!ok) {
      const wordOf = t.word ? ' (spelled out)' : '';
      const sameNumberOtherUnit = allowed.some((a) => near(t.v, a.v));
      stray.push(t.v);
      add(sameNumberOtherUnit ? 'unit' : 'number', `${t.v}${t.cls ? ` ${t.cls}` : ''}${wordOf}`);
    }
  }

  // 2. bar and measure numbers, which are names, not quantities
  for (const b of R.bars) if (!allowedBars.has(b)) { stray.push(b); add('bar', `bar ${b}`); }

  // 3. dates
  for (const d of R.dates) if (!allowedDates.has(d)) add('date', d);
  for (const m of text.matchAll(FULL_MONTH)) {
    const key = m[0].slice(0, 3).toLowerCase();
    if (![...allowedDates].some((d) => d.startsWith(key)) && !qLower.includes(m[0].toLowerCase())) add('date', m[0]);
  }
  for (const m of text.matchAll(WEEKDAY)) if (!qLower.includes(m[0].toLowerCase())) add('date', m[0]);

  // 4. fractions, ratios, ranges and signs assembled from digits that each exist
  for (const j of R.joined) {
    const compact = (s) => s.replace(/\s+/g, '');
    if (!compact(factsText).includes(j) && !compact(qText).includes(j)) add('joined', j);
  }
  for (const s of R.signed) {
    const seen = /^[-−+]$/.test(s)
      ? /(^|[\s(\[:,])[-−+]\d/.test(`${factsText} ${qText}`)
      : new RegExp(`\\b${s}\\b`, 'i').test(`${factsText} ${qText}`);
    if (!seen) add('sign', s);
  }

  // 5. pitch names and take names the facts never contained
  for (const n of R.notes) if (!F.notes.has(n) && !Q.notes.has(n)) add('note', n);
  for (const q of R.quotes) {
    const ql = q.toLowerCase().trim();
    if (everything.includes(ql)) continue;
    const words = ql.match(/[\p{L}\p{N}']+/gu) ?? [];
    const known = new Set(everything.match(/[\p{L}\p{N}']+/gu) ?? []);
    const named = /[A-Z]/.test(q) || /\d/.test(q);
    if (named && (/\d/.test(q) || !words.every((w) => known.has(w)))) add('name', q);
  }

  // 6. quantities spoken as ratios and fractions
  const qMult = new Set([...qLower.matchAll(MULTIPLIER)].map((m) => m[0]));
  // A fraction word is a claim unless the facts already say it: "half" for a
  // 50% in the facts, or the phrase copied out of them ("the loudest tenth of notes").
  const pcts = allowed.filter((a) => a.cls === 'pct').map((a) => a.v);
  const SAYS = { half: 50, halves: 50, quarter: 25, quarters: 25 };
  for (const m of text.matchAll(MULTIPLIER)) {
    const w = m[0].toLowerCase();
    if (qMult.has(w) || factsLower.includes(w)) continue;
    if (w in SAYS && pcts.some((p) => near(SAYS[w], p))) continue;
    add('multiplier', m[0]);
  }

  // 7. ordinals that name a bar or a note: "the third bar"
  for (const m of text.toLowerCase().matchAll(/\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|\d+(?:st|nd|rd|th))\s+(bar|measure|note|beat|week|day|session)\b/g)) {
    const n = ORDINALS[m[1]] ?? Number(m[1].replace(/\D/g, ''));
    const found = allowedBars.has(n) || allowed.some((a) => near(n, a.v) && (a.cls === null || a.cls === 'count' || a.cls === 'ordinal'));
    if (!found) add('ordinal', m[0]);
  }

  // 8. direction
  const replyLean = leanOf(text, { negation: true, contextual: true });
  const factLean = leanOf(factsText, { negation: false });
  const factsNeutral = /about the same|unchanged/i.test(factsText);
  for (const [axis, r] of Object.entries(replyLean)) {
    if (r.pos && r.neg) continue;
    let f = factLean[axis];
    if (axis === 'precision') {
      const held = PRECISION_OF.map((a) => factLean[a]).filter(Boolean);
      f = held.length ? { pos: held.some((x) => x.pos), neg: held.some((x) => x.neg) } : undefined;
    }
    if (axis === 'lead') {
      // sharp or flat is held per note when the facts name notes, below
      if (!f) add('direction', `${r.pos ? 'sharp' : 'flat'} (not in the measurements)`);
      else if (!(f.pos && f.neg) && (r.pos ? !f.pos : !f.neg)) add('direction', `${r.pos ? 'sharp' : 'flat'} where the measurements say ${f.pos ? 'sharp' : 'flat'}`);
      continue;
    }
    if (!f) { add('direction', `${axis}: a change the measurements do not show${factsNeutral ? ' (they say about the same)' : ''}`); continue; }
    if (f.pos && f.neg) continue;
    if (r.pos && !f.pos) add('direction', `${axis}: reply says up, measurements say down`);
    if (r.neg && !f.neg) add('direction', `${axis}: reply says down, measurements say up`);
  }
  const factNotes = noteLeans(factsText);
  if (factNotes.size) {
    for (const [name, dirs] of noteLeans(text)) {
      const f = factNotes.get(name);
      if (f && f.size === 1) for (const d of dirs) if (!f.has(d)) add('direction', `${name} called ${d}`);
    }
  }

  // 8b. a direction word next to a number, against the same number in the facts
  const factNums = numbersWithDirections(F, { negation: false });
  const replyNums = numbersWithDirections(R, { negation: true, contextual: true });
  const replyLowerAll = R.text.toLowerCase();
  const factsWordsLower = factsLower.replace(/\([^)]*\)/g, ' ');
  for (const r of replyNums) {
    const there = factNums.filter((f) => quotes(r, f));
    const twinAxes = [...new Set(there.flatMap((f) => f.hits).map((x) => x.axis).filter((a) => a && a !== 'amount'))];
    for (const h of r.hits) {
      if (h.axis !== null) continue;
      // "27¢ smaller than before": the sentence names no topic, so the measurement
      // the number belongs to does; with one obvious meaning there it is read so,
      // with none it is an unknown direction word and the default below holds it
      const ax = twinAxes.length === 1 && twinAxes[0] in SIZE_UP_IS_POS ? twinAxes[0] : null;
      if (!ax) continue;
      h.axis = ax;
      h.pos = ((h.dir === 'up') === SIZE_UP_IS_POS[ax]) !== h.flip;
      replyNums.consumed.push([h.at, h.end]);
    }
    // The conservative default. When the number's twin in the facts carries a
    // direction, a word beside it that LOOKS like a direction (a comparative, a
    // "more X", a verb of change) and that neither the lexicon above nor the facts
    // know is refused: the lexicon will never hold every word a model or a
    // skeptic reaches for ("dipped", "sagged", "ballooned"), and a synonym that
    // is not recognised passes as if it said nothing. The cost is an honest
    // paraphrase in a word the guard has not heard of, which falls back to the
    // sentences; tests/ai-eval/direction-redteam.mjs counts both sides.
    if (there.some((f) => f.hits.some((x) => x.axis))) {
      const word = unknownDirectionWord(replyLowerAll, r.index, replyNums.consumed, factsWordsLower);
      if (word) add('direction', `${r.v}${r.cls ? ` ${r.cls}` : ''}: "${word}" beside it reads as a direction, and neither the guard nor the measurements use that word`);
    }
    if (r.hits.length === 0) continue;
    for (const h of r.hits) {
      if (h.axis === null) continue;
      const axes = h.axis === 'precision' ? PRECISION_OF : [h.axis];
      const theirs = there.flatMap((f) => f.hits).filter((x) => axes.includes(x.axis));
      if (theirs.length > 0 && !theirs.some((x) => x.pos === h.pos)) {
        add('direction', `${r.v}${r.cls ? ` ${r.cls}` : ''}: reply says ${h.pos ? 'up' : 'down'} (${h.axis}), measurements say ${h.pos ? 'down' : 'up'} for that number`);
        break;
      }
    }
  }

  // 8c. a number that is in the facts, but about something else
  const factSentences = (() => {
    const cuts = [0];
    for (const m of F.text.matchAll(/(?<=[.!?])\s+|\n+/g)) cuts.push(m.index + m[0].length);
    cuts.push(F.text.length + 1);
    return cuts.slice(0, -1).map((s, i) => ({ s, e: cuts[i + 1], topics: topicsIn(F.text.slice(s, cuts[i + 1]).toLowerCase()) }));
  })();
  const replyLower = R.text.toLowerCase();
  const clauses = clauseSpans(replyLower);
  for (const r of R.tokens) {
    const clause = clauses.find(([s, e]) => r.index >= s && r.index < e);
    if (!clause) continue;
    const mine = topicsIn(replyLower.slice(clause[0], clause[1]));
    if (mine.size === 0) continue;
    const homes = F.tokens.filter((f) => quotes(r, f)).map((f) => factSentences.find((x) => f.index >= x.s && f.index < x.e));
    if (homes.length === 0 || homes.some((x) => !x || x.topics.size === 0)) continue;
    if (homes.every((x) => [...mine].every((t) => !x.topics.has(t)))) {
      add('attached', `${r.v}${r.cls ? ` ${r.cls}` : ''} is in the measurements, but about ${[...homes[0].topics].join('/')} and the reply uses it for ${[...mine].join('/')}`);
    }
  }

  // 8d. a number next to the words of a DIFFERENT number of the same unit
  for (const w of misattached(R, clean(text), F, factsText)) add('attached', w);

  // 9. claims about the player's level, other players, or the best ever
  const lower = clean(text).toLowerCase();
  for (const re of SUPERLATIVE) { const m = lower.match(re); if (m && !everything.includes(m[0])) add('superlative', m[0]); }
  for (const re of BENCHMARK) { const m = lower.match(re); if (m && !everything.includes(m[0])) add('benchmark', m[0]); }
  for (const re of HEARING) { const m = lower.match(re); if (m && !everything.includes(m[0])) add('hearing', m[0]); }
  {
    // the caveat itself says "how beautiful the tone is", which must not make
    // "beautiful" an allowed word
    const allowedTaste = factsLower.replace(/these describe the shaping[^.]*\./g, ' ');
    for (const m of lower.matchAll(TASTE)) if (!allowedTaste.includes(m[0])) { add('taste', m[0]); break; }
  }
  {
    // a question that asks "is my vibrato too wide" is not the facts: the words
    // must come from the measurements, as with taste
    const v = verdictsIn(text, factsText);
    if (v.length) add('verdict', v[0]);
  }
  const guess = lower.match(SPECULATION);
  if (guess) add('speculation', guess[0]);

  // 9b. words from the question that the measurements never held. "is my Violin
  // in tune" was answered "The Violin ... 9¢", "how is my Soprano range" with
  // "The Soprano range is 10¢ sharp", and "how was my D Major scale" with "The D
  // Major scale was 5¢ off": the measurements say nothing about an instrument, a
  // voice or a key, so a reply that names one is repeating the player's premise
  // as if it had been measured. Held to the FACTS only: a take called "Cello
  // suite" has the word in its facts and may be called that.
  for (const m of lower.matchAll(PLAYERS)) if (!factsLower.includes(m[0])) { add('premise', m[0]); break; }
  for (const key of keysIn(text)) if (!factsLower.replace(/[- ]+/g, ' ').includes(key)) { add('premise', key); break; }

  // 9c. a yes or a no to a question whose premise is a judgement. "is my
  // vibrato too wide" is not a question the measurements can confirm: they say
  // how wide it is, not whether that is too wide, and a reply that opens with
  // "Yes, your vibrato is 27¢ wide" has turned a description into a verdict. The
  // yes/no is allowed for a question about a change or a habit the facts DO say
  // ("did I improve", "do I play sharp"); the direction rules hold those.
  if (YES_NO_QUESTION.test(qLower) && JUDGEMENT.test(qLower) && OPENS_WITH_VERDICT.test(text)) add('premise', `"${text.slice(0, 12).trim()}" to a question about ${qLower.match(JUDGEMENT)[0]}`);

  // 9d. "not measured" where something was. A bare "Not measured." to "how is my
  // voice" (the facts held the pitch summary) and "Tone was not measured." with
  // the tone measurements in front of it are the model giving up, and the player
  // is told nothing is known about something that is. It is only an absence when
  // the facts SAY so about that topic, or about anything at all when the reply
  // names no topic.
  const factLines = sentences(factsText);
  for (const sentence of sentences(text)) {
    // "X is not measured, but Y is steady": only X is the absence
    for (const clause of sentence.split(/\b(?:but|however|although|though|yet|while)\b|[;—]/i)) {
      if (!ABSENT.test(clause)) continue;
      const topics = Object.keys(TOPICS).filter((t) => t !== 'everything' && TOPICS[t].test(clause));
      if (clause.trim().split(/\s+/).length <= 4 && topics.length === 0) {
        if (!factLines.some((f) => HEDGE.test(f))) add('absent', clause.trim());
        continue;
      }
      for (const t of topics) {
        if (TOPICS[t].test(factsText) && !factLines.some((f) => TOPICS[t].test(f) && HEDGE.test(f))) { add('absent', `${t}: "${clause.trim().slice(0, 60)}"`); break; }
      }
    }
  }

  // 10. answering what was not measured. The hedge has to sit in the same
  // clause as the topic: "the pulse could not be found; you rush" is a hedge
  // and then an answer.
  const hasWordsOf = (re) => re.test(factsText);
  const asked = [];
  for (const [marker, topics] of MARKERS) if (marker.test(factsText)) asked.push(...topics);
  for (const topic of ['tone', 'dynamics', 'tempo']) if (!hasWordsOf(TOPICS[topic])) asked.push(topic);
  for (const sentence of sentences(text)) {
    for (const clause of sentence.split(/\b(?:but|however|although|though|yet|while)\b|[;—]/i)) {
      if (HEDGE.test(clause)) continue;
      for (const topic of new Set(asked)) {
        if (TOPICS[topic].test(clause)) { add('unmeasured', `${topic}: "${clause.trim().slice(0, 60)}"`); break; }
      }
    }
  }

  if (problems.length === 0) return { ok: true, stray: [], reason: '', problems: [] };
  const first = problems[0];
  const reason = {
    number: 'numbers not in the measurements',
    unit: 'a measured number with a different unit',
    bar: 'a bar number not in the measurements',
    date: 'a date not in the measurements',
    joined: 'a fraction, ratio or range the measurements do not contain',
    sign: 'a signed number the measurements do not contain',
    note: 'a note name not in the measurements',
    name: 'a name not in the measurements',
    multiplier: 'a quantity spoken as a fraction or multiple',
    ordinal: 'a numbered bar or note not in the measurements',
    direction: 'a direction the measurements do not support',
    attached: 'a measured number used for something else',
    unmeasured: 'an answer about something that was not measured',
    taste: 'a verdict on taste that the measurements do not make',
    echo: 'text copied from the prompt',
    verdict: 'a verdict on the playing that the measurements do not make',
    count: 'a number of days or takes used for something the measurements do not state',
    hearing: 'a claim about how it sounds that the measurements do not make',
    benchmark: 'a comparison with other players that the measurements do not make',
    speculation: 'a guess the measurements do not support',
    premise: 'something taken from the question that the measurements do not state',
    absent: 'a claim that something was not measured when it was',
    superlative: 'a best or worst the measurements do not state',
  }[first.kind] ?? 'a statement the measurements do not support';
  return { ok: false, stray, reason, problems };
}
