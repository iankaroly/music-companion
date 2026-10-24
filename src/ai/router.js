// What a player asked, turned into WHICH measurements are needed — before any
// model is involved.
//
// This is deliberately keyword rules and not a model. The model's job in this
// feature is to put finished numbers into words; picking the measurements with
// it as well would put the part that can be wrong in front of the part that
// cannot. A rule that misreads a question costs an answer about the wrong
// thing, which the player can see in the "based on" list under every reply. A
// model that misreads one costs the same and cannot be unit-tested.
//
// The same rules also decide WHETHER a question can be answered at all. A
// question about the capital of France, or about whether a tone is beautiful,
// or about a piece that is not in the library, is refused by code (assistant.js
// writes the refusal) rather than being handed to a model that would answer it.
//
// tests/ai-eval/ holds the fixed set of questions these rules are scored on.
// Its first run, before the changes below, found `last take` read as a
// comparison (so "how was my last take" compared two takes), "am I improving"
// read as both a comparison and a trend, a named piece matched only when its
// whole name was typed, and no refusal path at all.

import { daysAgo } from '../analysis/coach.js';

const norm = (s) => String(s ?? '').toLowerCase().replace(/[’]/g, "'").replace(/\s+/g, ' ').trim();

// ---- typos -----------------------------------------------------------------
// A word is snapped to the keyword it is one slip away from, so "compre",
// "rushin" and "vibrao" still reach their rule. Only words that cannot be
// another ordinary word are in the list (no "tone", whose neighbour "tune" is
// a word players use), a five-letter word snaps only on a swapped pair
// ("shrap" -> "sharp", never "share" -> "sharp"), and a word that is part of a
// take's name is left alone so a piece called "Study" is not read as "steady".
const SNAP = ['compare', 'comparing', 'comparison', 'rushing', 'dragging', 'vibrato', 'intonation',
  'improve', 'improving', 'progress', 'worst', 'sharp', 'flat', 'flatter', 'sharper', 'rhythm', 'tempo',
  'dynamics', 'loudness', 'summary', 'practice', 'recording', 'trouble', 'struggling', 'streak'];

function swapped(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length - 1; i++) {
    if (a[i] !== b[i]) return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2);
  }
  return false;
}

function oneEdit(a, b) {
  if (Math.abs(a.length - b.length) > 1) return false;
  if (swapped(a, b)) return true;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
  const [long, short] = a.length > b.length ? [a, b] : [b, a];
  return long.slice(i + 1) === short.slice(i);
}

// Ordinary words that sit one slip from a keyword. "bragging" is not
// "dragging" and "flutter" is not "flatter"; neither is a typo. A typo keeps
// its first letter far more often than not, which alone keeps "bragging" and
// "pushing" out; the few that share one are listed.
const REAL_WORDS = new Set(['flutter', 'flutters', 'fluttering', 'stream', 'shaper', 'brushing', 'crushing', 'pushing', 'bragging']);
function snapWord(w, protect) {
  if (w.length < 5 || SNAP.includes(w) || protect.has(w) || REAL_WORDS.has(w)) return w;
  for (const k of SNAP) {
    if (k[0] !== w[0]) continue;
    if (w.length === 5 || k.length === 5) {
      if (k.length === w.length && swapped(w, k)) return k;
    } else if (oneEdit(w, k)) return k;
  }
  return w;
}

// ---- take names ------------------------------------------------------------
const NAME_STOP = new Set(['the', 'and', 'for', 'with', 'from', 'take', 'takes', 'piece', 'recording', 'my', 'op', 'no', 'in', 'of', 'a', 'an']);
const stem = (w) => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w);
const wordsOf = (s) => norm(s).split(/[^\p{L}\p{N}']+/u).filter(Boolean);
const nameTokens = (name) => wordsOf(name).filter((w) => w.length >= 3 && !NAME_STOP.has(w)).map(stem);

// Words that are measurements and exercises as much as names. A take called
// "Long tones" is not what "is my tone clear" asks about, and "how long are my
// notes" is not about it either; such a word names the take only when the whole
// name is typed.
const GENERIC = new Set(['tone', 'long', 'note', 'vibrato', 'tempo', 'rhythm', 'pitch', 'dynamic', 'loudness', 'sound', 'timing', 'intonation', 'tuning',
  'slow', 'fast', 'practice', 'practise', 'steady', 'soft', 'loud', 'short', 'high', 'low']);

// A number that counts ("my last 3 takes", "5 days ago") is not a number out of
// a name.
const COUNTED = /\b(?:last|first|past|previous|recent|latest|top)\s+(?:\d+|one|two|three|four)\b|\b\d+\s*(?:takes?|recordings?|days?|weeks?|months?|hours?|times?|notes?|bars?|measures?|sessions?)\b/g;
const numeralsOf = (s) => norm(s).match(/\d+/g) ?? [];
const typedNumerals = (q) => numeralsOf(norm(q).replace(COUNTED, ' '));
// the question or name as its words, stemmed, with a space either side, so a
// phrase is found only on word boundaries ("take 1" is not in "take 12")
const seq = (s) => ` ${wordsOf(s).map(stem).join(' ')} `;

// A numbered take is named by its number as much as by its words. "Etude 3" in
// a library of Etude 1, 2 and 3 used to share the word "etude" with all three
// (the digit is too short to be a token), so the newest won and the answer, and
// the "3" the guard then allowed back because the player typed it, were another
// take's. When the question carries a number and a name carries a different
// one, that name is not the one asked for.
function mentions(question, take) {
  const q = norm(question);
  const name = norm(take.name);
  const mine = numeralsOf(name);
  const typed = typedNumerals(q);
  if (mine.length && typed.length && !mine.every((n) => typed.includes(n))) return false;
  if (name.length >= 3 && seq(q).includes(seq(name))) return true;
  const have = new Set(wordsOf(q).map(stem));
  return nameTokens(take.name).filter((t) => !GENERIC.has(t)).some((t) => have.has(t) || (t.length >= 6 && [...have].some((h) => h.length >= 6 && oneEdit(h, t))));
}

export const mentionsTake = mentions;

// "etude 3" when the library has Etude 1 and Etude 2 only: the question names a
// numbered take that is not there, and answering about Etude 1 instead would be
// answering about the wrong take. -> "etude 3", or null.
function numberedMiss(question, takes) {
  const q = norm(question).replace(COUNTED, ' ');
  if (numeralsOf(q).length === 0) return null;
  for (const t of takes) {
    const ws = wordsOf(t.name);
    for (let i = 1; i < ws.length; i++) {
      if (!/^\d+$/.test(ws[i]) || /^\d+$/.test(ws[i - 1])) continue;
      const m = q.match(new RegExp(`(?:^|[^\\p{L}\\p{N}])${ws[i - 1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+(\\d+)(?![\\p{L}\\p{N}])`, 'u'));
      if (m && m[1] !== ws[i]) return `${ws[i - 1]} ${m[1]}`;
    }
  }
  return null;
}

// ---- intents ---------------------------------------------------------------
const COMPARE = /compar|versus|\bvs\b|differ|contrast|stack(s|ed)? up|better|worse|improv|chang|last time|previous|the one before|than before|\bbefore\b|since|than\b|against/;
// A comparison the player SAID, as against one the word "better" merely
// suggests ("am I getting better over time" is a trend).
const COMPARE_EXPLICIT = /compar|versus|\bvs\b|\bthan\b|\bdiffer|contrast|stack(s|ed)? up|last time|previous|the one before|since (my|the|that|this) (last|previous|first)/;
const TREND = /trend|progress|over time|this week|last week|this month|last month|month|streak|getting better|improving|improvement|am i improv|lately|recently|these days|so far|consisten/;
// How a take is SHAPED rather than how in tune it is. Kept narrower than
// MUSICALITY_PATTERN in musicality-facts.js on purpose: that one also catches
// "tempo", "dynamic", "consistent", "steady" and "shape", which already belong
// to the tempo and tone rules and would have pulled every pulse and loudness
// question into a third set of facts. Words that ask for a VERDICT on taste
// ("expressive", "emotional", "beautiful") are not here either; they stay in
// UNMEASURABLE below and are refused.
const MUSICALITY = /musical|phras|articulat|legato|staccato|detach|rubato|mechanical|robotic|lifeless|monoton|with feeling|feeling|\bshaping\b|swell|crescendo|diminuendo|\bcharacter\b|connected|smooth|\bstiff\b|repeated (figure|phrase|passage)|same way (each|every)|plays? it the same/;
const INTENTS = [
  ['musicality', MUSICALITY],
  ['worst', /worst|hardest|struggl|trouble|problem|mistake|wrong|out of tune|which (notes|bars?|measures?|pitches)|where (am|do|did)|weak|need(s)? (work|fixing|attention)|\bfix\b|work on|focus on|most (errors|mistakes)/],
  ['habits', /habit|\btend|always|usually|typically|\bpull|\blean|sharp|flat/],
  ['tone', /\btones?\b|vibrato|\bbright|\bdark|\bsound|quality|\bclear|breath|\brough\b|\bdynamic|\bloud|\bsoft(er|ly)?\b|volume|wobbl|shak|wander|held note|arriv|\bland(s|ed|ing)?\b|settl/],
  ['tempo', /tempo|rhythm|\brush|\bdrag|timing|\bbeat\b|\bevenly\b|\bevenness\b|\buneven|\b(?:how|more|less|very|really|fairly|too|pretty|quite|not|so|rather) even\b|\beven (?:tempo|pulse|timing|rhythm|beat)|\bis (?:it|my [a-z ]{0,20}|the [a-z ]{0,20}) even\b|\bpulse\b|metronome|\bbpm\b|in time|speed(ing)? up|slow(ing)? down|too (fast|slow)|play(ing)? (too )?(fast|slow)/],
];

function snapped(question, takes = []) {
  const protect = new Set((takes ?? []).flatMap((t) => wordsOf(t.name)));
  return wordsOf(question).map((w) => snapWord(w, protect)).join(' ');
}

export function intentsOf(question, takes = []) {
  const q = snapped(question, takes);
  const topic = Object.fromEntries(INTENTS.map(([name, re]) => [name, re.test(q)]));
  // "tend", "always" and "usually" are habits only about pitch; "do I tend to
  // rush" is about the pulse and "does my vibrato usually shake" about tone.
  if (topic.habits && (topic.tempo || topic.tone) && !/sharp|flat|habit|pitch|in tune/.test(q)) topic.habits = false;
  // "how fast do my notes settle" asks how quickly a note arrives in tune.
  if (topic.tempo && topic.tone && /settl|arriv|land|vibrato/.test(q) && !/tempo|rhythm|beat|rush|drag|timing|pulse/.test(q)) topic.tempo = false;

  // "steady" is tone (steadiness inside a held note) unless it is about the pulse
  if (/stead(y|i)/.test(q) && !topic.tempo) topic.tone = true;

  // "is it too flat or mechanical" asks about lifeless playing, and "flat" there
  // is not a pitch habit; "sharp", "pitch" or "in tune" would still make it one.
  if (topic.habits && topic.musicality && !/sharp|habit|pitch|in tune|tend|always|usually/.test(q)) topic.habits = false;
  // "smooth" and "connected" are articulation; "even" in "evenly connected"
  // stays with them and does not also ask about the pulse
  if (topic.tempo && topic.musicality && !/tempo|rhythm|beat|rush|drag|timing|pulse|metronome|bpm|in time|fast|slow/.test(q)) topic.tempo = false;

  // "does it sound musical" is about shaping; "sound" there is not a request for
  // the tone readings, nor is "dynamic" in "dynamic shaping"
  if (topic.tone && topic.musicality && !/\btones?\b|vibrato|\bbright|\bdark|quality|\bclear|\brough\b|\bloud|\bsoft(er|ly)?\b|volume|wobbl|shak|wander|held note|arriv|\bland(s|ed|ing)?\b|settl/.test(q)) topic.tone = false;

  let compare = COMPARE.test(q);
  let trend = TREND.test(q);
  // "has my vibrato changed since last week" asks about two takes' vibrato; the
  // weekly trend only knows pitch error
  if (trend && (topic.tone || topic.tempo) && !/trend|progress|streak|over time|improving|getting better/.test(q)) trend = false;
  if (trend && !COMPARE_EXPLICIT.test(q)) compare = false;
  // "this week compared with last week" is the weekly trend, not two takes
  if (trend && compare && /\b(week|month)\b/.test(q) && !topic.tone && !topic.tempo) compare = false;

  const found = [];
  if (compare) found.push('compare');
  for (const [name] of INTENTS) if (topic[name]) found.push(name);
  if (trend) found.push('trend');
  return found.length ? found : ['summary'];
}

// ---- what can and cannot be answered ---------------------------------------
const OFFTOPIC = new RegExp([
  'poem|poetry|haiku|\\bjoke|riddle|\\bstory\\b|recipe|pasta|weather|capital of|translate|horoscope|stock market|bitcoin|president|\\bnews\\b|movie|lyrics to',
  'who (won|is the|was the)|\\b(dinner|lunch|breakfast|eat|food|cook)\\b|how tall|square root|your (day|name|favou?rite)|about you(rself)?\\b|how are you|who are you|what time|what day|what year|\\bcalculat|\\d+\\s*(times|plus|minus|divided|\\*|x)\\s*\\d+',
  'system prompt|your (instructions|rules|prompt)|(ignore|disregard|forget) (all |your |the |any )?(previous|prior|above|instructions|rules)|you are now|pretend (to be|you)|\\bact as\\b|jailbreak|developer mode',
  'write (me )?(a|an|some|the)\\b|\\bcode\\b|\\bessay\\b|\\bemail\\b|\\bjavascript\\b|\\bpython\\b',
  '^(hi|hello|hey|yo|thanks|thank you|ok|okay|help|test|testing)\\W*$',
].join('|'));

// Things a recording cannot show, however carefully it is measured. The app
// measures pitch, timing, steadiness, vibrato, loudness and tone colour as
// numbers; it has no way to hear whether any of it is beautiful, and it never
// sees a hand, a bow or a posture.
const UNMEASURABLE = new RegExp([
  // "musical" and "phrasing" as TOPICS are measured now (src/analysis/musicality.js
  // says how a take is shaped); what stays refused is the verdict on the player
  // ("am I musical", "do I have talent") and on taste ("expressive", "emotional").
  'beautiful|lovely|gorgeous|\\bpretty\\b|move (people|me|the audience)|audience|\\bas good as\\b|\\bbow(ing|ed)?\\b|\\b(am|are) (i|we) (a |an |very |really )?musical|musicianship|expressive|emotion|interpretation|artistic|talent|\\bstyle\\b|stage presence',
  '\\bgrade\\b|rate (my|this|me)|score me|out of (ten|10|100)|audition|\\bexam\\b|professional|\\bpros?\\b|better than (other|everyone|most|anyone)|compared to (other|everyone|anyone|the best)',
  'sounds? (good|nice|great|bad|ugly|terrible|amazing|awful)',
  '\\bbreath(e|ed|ing)?\\b|posture|fingering|hand (position|shape|frame)|embouchure|breathing|breath support|diction|pronunciation|lyric',
].join('|'));

// Ranking the whole library ("which was my best take") is not something the
// facts can say; answering with the latest take's summary would look like an
// answer and be about the wrong thing.
const RANKING = /\b(best|top|worst|highest|lowest|most accurate|cleanest)\s+(take|recording|performance|session|attempt|one)\b|\bhow many (takes|recordings|sessions)\b|\bwhich (take|recording|session) (was|is|has|did)\b/;

// "what is a semitone", "how many cents in a fifth": general knowledge, not a
// question about the player's own takes.
const GENERAL = /\b(mean|means|meaning|define|definition|stand for|what is an? |what's an? |what are the|difference between|how many [\w ]{0,20}\b(in|are in|per) an?)\b/;
// Words that make a question the player's OWN: "what is the difference between
// my last two takes" and "what was my mean error" share "difference between"
// and "mean" with the definitions GENERAL is for. A bare "note" or "piece" is
// not one: "what is the difference between sharp and flat notes" is general.
const OWN = /\b(my|mine|myself|i|i'm|im|i've|ive|me|last|latest|today|yesterday)\b/;
// Short open questions that mean "how am I doing".
const VAGUE = /\bhow (am|did|was|is|are|were|do|does|have)\b|tell me|summary|overview|feedback|thoughts|update|report|so far|what about|how'?s|\bany good\b/;
const DOMAIN = /error|accura|average|session|tuning|voice|vocal|\bsing|\bsang|register|take|record|play|practi|note|\bbar|measure|pitch|tune|intonation|sharp|flat|cents?\b|tempo|rhythm|rush|drag|vibrato|tone|sound|dynamic|loud|scale|piece|etude|beat|timing|progress|streak|week|compar|summary|doing|habit|worst/;

// Names in the question that are not take names: capitalised words that are
// really days, months or the app.
const NOT_A_NAME = new Set(['i', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'january', 'february', 'march', 'april', 'may',
  'june', 'july', 'august', 'september', 'october', 'november', 'december', 'apple', 'stand', 'partner', 'the', 'what', 'how', 'which', 'where', 'when',
  'why', 'who', 'does', 'did', 'was', 'were', 'are', 'can', 'could', 'should', 'would', 'tell', 'show', 'give', 'compare',
  // the short forms the app prints in its own sentences ("Oct 19")
  'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec', 'mon', 'tue', 'tues', 'wed', 'thu', 'thur', 'thurs', 'fri', 'sat', 'sun']);

// Words that mean "a take by position or time", never by name.
const RELATIVE = new Set(['last', 'latest', 'first', 'previous', 'recent', 'newest', 'newer', 'new', 'old', 'older', 'oldest', 'earlier', 'best', 'worst', 'whole',
  'entire', 'current', 'other', 'same', 'one', 'two', 'three', 'four', 'this', 'that', 'these', 'those', 'today', 'yesterday', 'morning', 'evening', 'tonight',
  'every', 'all', 'each', 'next', 'second', 'third', 'vibrato', 'tone', 'tempo', 'rhythm', 'timing', 'pitch', 'intonation', 'playing', 'practice', 'practise',
  'sound', 'dynamics', 'loudness', 'streak', 'progress', 'habits', 'habit', 'scale', 'scales', 'rushing', 'dragging', 'bow', 'posture', 'takes', 'take']);

// Instruments, voices and the words of a key: capitalised or not, they describe
// what the player plays, not which take. This app is for every instrument and
// for singers, and a spot check found "is my Violin in tune" and "how is my
// Soprano range" refused as an unknown take called Violin and Soprano. Tempo
// markings (Allegro, Adagio) are deliberately NOT here: they are also movement
// names, and "how was my Allegro" may well mean a take.
const PLAYS = new Set(['violin', 'viola', 'cello', 'bass', 'double', 'contrabass', 'piano', 'keyboard', 'organ', 'harp', 'guitar', 'ukulele', 'banjo', 'mandolin',
  'flute', 'piccolo', 'oboe', 'clarinet', 'bassoon', 'saxophone', 'sax', 'horn', 'trumpet', 'trombone', 'tuba', 'cornet', 'euphonium', 'drums', 'percussion',
  'voice', 'vocal', 'vocals', 'soprano', 'mezzo', 'alto', 'contralto', 'tenor', 'baritone', 'treble', 'choir', 'major', 'minor', 'scale', 'scales', 'arpeggio',
  'arpeggios', 'chord', 'chords', 'key', 'range', 'register', 'line', 'part', 'solo']);

// The name the question gives a take that is NOT in the library, or null. Only
// reached when no take was matched by name, so it cannot refuse "my Bach" while
// a take called Bach exists.
function unknownName(question, takes) {
  const known = new Set(takes.flatMap((t) => nameTokens(t.name)));
  const isKnown = (w) => known.has(stem(w));
  const original = String(question ?? '');
  // 1) a capitalised word that is not the first word of the question
  // (no lookbehind: it needs Safari 16.4 and the app supports iOS 15)
  const caps = [...original.matchAll(/\b[A-Z][\p{L}'-]{2,}/gu)]
    .filter((m) => m.index > 0 && !/[.?!]\s$/.test(original.slice(Math.max(0, m.index - 2), m.index)))
    .map((m) => m[0]);
  for (const raw of caps) {
    const w = raw.toLowerCase();
    if (NOT_A_NAME.has(w) || RELATIVE.has(w) || PLAYS.has(w) || isKnown(w)) continue;
    return raw;
  }
  // 2) "my X take", "the X recording", "take of X", "my X go/went"
  const q = norm(original);
  const patterns = [
    /\b(?:my|the)\s+([a-z' -]{3,40}?)\s+(?:take|takes|recording|recordings|performance|run-through|attempt)\b/,
    /\b(?:take|recording|performance|version)\s+of\s+(?:the\s+|my\s+)?([a-z' -]{3,40}?)(?:\s*[?.!,]|\s+(?:and|with|from|last|today|yesterday)\b|$)/,
    /\bmy\s+([a-z' -]{3,40}?)\s+(?:go|went|sound|sounded|come out|came out)\b/,
  ];
  for (const re of patterns) {
    const m = q.match(re);
    if (!m) continue;
    const ws = wordsOf(m[1]);
    if (ws.length === 0 || ws.length > 3) continue;
    if (ws.some((w) => RELATIVE.has(w) || PLAYS.has(w) || /^\d+$/.test(w) || NAME_STOP.has(w) || NOT_A_NAME.has(w) || isKnown(w))) continue;
    return m[1];
  }
  return null;
}

// -> { kind: 'answer' | 'offtopic' | 'unmeasurable' | 'unsupported' | 'notfound' | 'nodata', label? }
export function scopeOf(question, takes = [], now = Date.now()) {
  const q = norm(question);
  if (OFFTOPIC.test(q)) return { kind: 'offtopic' };
  if (UNMEASURABLE.test(q)) return { kind: 'unmeasurable' };
  const named = (takes ?? []).some((t) => mentions(q, t));
  if (RANKING.test(q)) return { kind: 'unsupported' };
  if (!named && GENERAL.test(q) && !OWN.test(q)) return { kind: 'offtopic' };
  // A question with nothing about playing in it, and no way of reading it as
  // "tell me about my takes", is not answered. Saying "I" is not enough: "what
  // should I eat" has one.
  if (!named && !DOMAIN.test(snapped(q, takes)) && !VAGUE.test(q) && intentsOf(q, takes)[0] === 'summary' && dayRefs(q, now).length === 0) return { kind: 'offtopic' };
  const usable = usableTakes(takes);
  if (usable.length === 0) return { kind: 'nodata' };
  if (!named) {
    const miss = numberedMiss(q, takes);
    if (miss) return { kind: 'notfound', label: miss };
    const label = unknownName(question, takes);
    if (label) return { kind: 'notfound', label };
  }
  const days = dayRefs(q, now);
  if (days.length > 0 && !named) {
    const have = new Set(usable.map((t) => dayKey(t.date)));
    const missing = days.find((d) => !have.has(d.key));
    if (missing) return { kind: 'notfound', label: missing.word };
  }
  return { kind: 'answer' };
}

// ---- which takes -----------------------------------------------------------
const MAX_TAKES = 4;

const usableTakes = (takes) => (takes ?? [])
  .filter((t) => (t.noteStats?.length ?? 0) > 0)
  .sort((a, b) => b.date - a.date);

function dayKey(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

// "friday" is the latest Friday that is not in the future; "last friday" is
// never today.
function weekdayRef(q, now) {
  const m = q.match(/\b(last |on |this past )?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  if (!m) return null;
  const back = (new Date(now).getDay() - WEEKDAYS.indexOf(m[2]) + 7) % 7;
  return { word: `${m[1] ? 'last ' : ''}${m[2]}`.trim(), key: dayKey(daysAgo(now, back === 0 && m[1] && m[1].trim() !== 'on' ? 7 : back)) };
}

// "october 14", "Oct 14", "14 october", "the 14th". The app prints a take's day
// as "Oct 19", so that is how a player will write one. These used to be
// unread: the question fell through to the LATEST take, and because the guard
// allows a date back when the player typed it, "Your October 14 take was 9
// cents off" passed with the Oct 19 take's number.
//
// A month and day is the latest such date that is not in the future (so
// "december 30" in January is last year's); a bare ordinal is the latest day of
// the month with that number.
const MONTH_NAMES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_WORD = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
// a month word followed by "5 times" or "20 notes" is a count, not a date
const NOT_A_DAY = '(?!\\s*(?:times?|days?|takes?|weeks?|months?|notes?|bars?|cents?|¢|%|hz|ms|bpm|db|sessions?|minutes?|hours?|seconds?))';
function dateKey(now, month, day) {
  const t = new Date(now);
  for (const year of [t.getFullYear(), t.getFullYear() - 1]) {
    const d = new Date(year, month, day, 12);
    if (d.getMonth() !== month || d.getDate() !== day) continue; // 31 april, 30 february
    if (d.getTime() <= now || dayKey(d.getTime()) === dayKey(now)) return dayKey(d.getTime());
  }
  return null;
}
function dateRefs(q, now) {
  const out = [];
  const re1 = new RegExp(`\\b${MONTH_WORD}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b${NOT_A_DAY}`, 'g');
  const re2 = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH_WORD}\\b`, 'g');
  for (const m of q.matchAll(re1)) out.push({ mo: m[1], day: Number(m[2]), word: m[0].trim() });
  for (const m of q.matchAll(re2)) out.push({ mo: m[2], day: Number(m[1]), word: m[0].trim() });
  const refs = [];
  for (const r of out) {
    const key = dateKey(now, MONTH_NAMES.indexOf(r.mo.slice(0, 3)), r.day);
    refs.push({ word: r.word, key: key ?? `none-${r.mo}-${r.day}` });
  }
  if (refs.length === 0) {
    for (const m of q.matchAll(/\b(?:on |the )(\d{1,2})(?:st|nd|rd|th)\b/g)) {
      const day = Number(m[1]);
      let key = null;
      for (let back = 0; back < 62 && !key; back++) {
        const d = new Date(daysAgo(now, back));
        if (d.getDate() === day) key = dayKey(d.getTime());
      }
      refs.push({ word: m[0].replace(/^on /, '').trim(), key: key ?? `none-${day}` });
    }
  }
  return refs;
}

function dayRefs(q, now = Date.now()) {
  const out = [];
  const wd = weekdayRef(q, now);
  if (wd) out.push(wd);
  out.push(...dateRefs(q, now));
  if (/\btoday\b|this morning|this afternoon|tonight|earlier today/.test(q)) out.push({ word: 'today', key: dayKey(now) });
  if (/\byesterday/.test(q)) out.push({ word: 'yesterday', key: dayKey(daysAgo(now, 1)) });
  return out;
}

// Which takes the question is about. A take is named by what the player called
// it (any distinctive word of the name will do: "the bach one", "my scale
// take"), or by a day, or by position; with none of those it is the latest
// take, or the latest two when the question is a comparison.
export function takesFor(question, takes, intents, now = Date.now()) {
  const q = norm(question);
  const usable = usableTakes(takes);
  if (usable.length === 0) return [];

  const countWords = { two: 2, three: 3, four: 4 };
  const cm = q.match(/\blast (\d|two|three|four)\b(?! ?(days?|weeks?|months?|hours?))/)
    // "these two takes", "my two recordings", "both takes"
    ?? q.match(/\b(?:these|those|the|my|both)\s+(two|three|four)\s+(?:\w+\s+)?(?:takes?|recordings?|attempts?)\b/)
    ?? (/\bboth (?:of )?(?:my |the |these )?(?:takes|recordings)\b/.test(q) ? ['', 'two'] : null);
  const count = cm ? Math.min(MAX_TAKES, Math.max(1, Number.isFinite(Number(cm[1])) ? Number(cm[1]) : countWords[cm[1]])) : null;
  const comparing = intents.includes('compare');

  const days = dayRefs(q, now);
  if (days.length > 0) {
    const want = new Set(days.map((d) => d.key));
    const onDays = usable.filter((t) => want.has(dayKey(t.date)));
    if (onDays.length > 0) {
      // one take per day asked about; a comparison of two days is those two
      const perDay = [...want].map((k) => onDays.find((t) => dayKey(t.date) === k)).filter(Boolean).sort((a, b) => b.date - a.date);
      if (comparing && perDay.length === 1) {
        // "what changed since yesterday": one day named, so the other side is
        // the latest take (or, when the day's take IS the latest, the one
        // before it, of the same name if there is one). It used to stop at one
        // take and say that only one take was saved.
        const day = perDay[0];
        if (usable[0] !== day) return [usable[0], day];
        const older = usable.slice(1);
        const mate = older.find((t) => norm(t.name) === norm(day.name) && day.name) ?? older[0];
        return mate ? [day, mate] : [day];
      }
      return (comparing && perDay.length >= 2 ? perDay : perDay.slice(0, 1)).slice(0, MAX_TAKES);
    }
  }

  let named = usable.filter((t) => mentions(q, t));
  // "etude 3" beside an unnumbered "Etude": the numbered one is the one asked for
  if (typedNumerals(q).length) {
    const numbered = named.filter((t) => numeralsOf(t.name).length);
    if (numbered.length) named = numbered;
  }
  if (named.length > 0) {
    if (count) return named.slice(0, count);
    if (comparing) {
      const names = [...new Set(named.map((t) => norm(t.name)))];
      if (names.length >= 2) return names.map((n) => named.find((t) => norm(t.name) === n)).slice(0, 2);
      return named.slice(0, 2);
    }
    if (intents.includes('trend') || intents.includes('habits')) return named.slice(0, MAX_TAKES);
    return named.slice(0, 1);
  }

  if (count) return usable.slice(0, count);

  if (comparing) {
    // Two takes of the same piece when the latest has a name to match on —
    // comparing a Bach prelude with a scale says nothing about either.
    const latest = usable[0];
    const same = latest.name ? usable.filter((t) => norm(t.name) === norm(latest.name)) : [];
    return (same.length >= 2 ? same : usable).slice(0, 2);
  }
  return usable.slice(0, 1);
}

// What has to be loaded from the stored audio before the facts can be built.
// Loading a take decodes it, so it is only done for the intents that need it.
export function needsOf(intents) {
  return {
    quality: intents.includes('tone') || intents.includes('compare'),
    rhythm: intents.includes('tempo'),
    // Shaping is read from the same decoded take as the tone, so it costs no
    // second decode: a comparison already loads the audio for quality, and the
    // phrase-level comparison rides along with it.
    musicality: intents.includes('musicality') || intents.includes('compare'),
  };
}

export function plan(question, takes, now = Date.now()) {
  const scope = scopeOf(question, takes, now);
  if (scope.kind !== 'answer' && scope.kind !== 'nodata') {
    return { intents: [], takeIds: [], needs: { quality: false, rhythm: false, musicality: false }, scope };
  }
  const intents = intentsOf(question, takes);
  const chosen = takesFor(question, takes, intents, now);
  return { intents, takeIds: chosen.map((t) => t.id), needs: needsOf(intents), scope };
}
