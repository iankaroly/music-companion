// A take, without a microphone.
//
// Every part of this app that has anything to say about a recording needs a
// recording to say it about, and there is exactly one way to get one on this
// machine: open the microphone. That is not available here. A browser check
// that calls getUserMedia turns the real webcam and the real microphone on,
// on somebody's actual laptop, in the middle of an automated run — so the
// whole review side of the app has never been measured end to end, and the
// scanned-page work that depends on it has been measured by reasoning about
// what the code probably does. Which, per CLAUDE.md, is where every dead end
// in this repo came from.
//
// So the take is SYNTHESISED, and it is synthesised to match a page this repo
// already holds ground truth for: the first two bars of BWV 1007, the opening
// of `Menuet.pdf`, whose 319 noteheads are hand-marked in
// pages/truth/bach.truth.json and whose first 32 are named — as steps, in bass
// clef — in pages/truth/bach.pitch.json.
//
// WHAT IS REAL HERE AND WHAT IS NOT
//
// Real: the notehead positions. `BACH_OPENING` below carries marks 0-31 of
// bach.truth.json verbatim, x and y as fractions of the page, together with
// that file's own staff space. They are where the ink is on a photograph of a
// real page, not where a generator decided to put them. `matchesTruthFiles()`
// re-reads both truth files and checks this copy against them, so a fixture
// that drifts away from the page it claims to be fails a test rather than
// quietly measuring something else.
//
// Real: the pitches. The steps come from bach.pitch.json's own bar list, and
// `pitchOf(step, 'bass', NO_KEY)` turns them into 43, 50, 59, 57 … — which is
// exactly what the pitch file says those steps are (0=G2, 4=D3, 8=A3, 9=B3,
// 10=C4). Checked by import, not by hand arithmetic.
//
// NO_KEY rather than the page's G major is not a shortcut and cannot bite
// here: bar 1 is G D B A B D B D and bar 2 is G E C B C E C E, so there is no
// F anywhere in these 32 notes and the one sharp alters nothing. That is why
// this fixture measures the time bridge and says nothing whatever about the
// key reader — and it is also why the fixture is indifferent to which route
// headsOf takes to a pitch. A second session is moving that line from
// `pitchOf(step, clef, NO_KEY)` to the midi notesInOrder already priced
// through the page's own key; on these 32 notes the two agree to the semitone,
// so this fixture does not take a side in that change and does not have to be
// re-cut when it lands.
//
// NOT real: the audio, and it does not have to be. Nothing downstream of here
// judges timbre — buildEmphasizedClip windows and gains samples, the report's
// playhead reads seconds — so a decaying sine at the note's own frequency is
// enough to exercise every path, and it is generated deterministically so two
// runs produce the same bytes.
//
// NOT real: the timing. A player does not put 32 notes on a 0.5-second grid.
// The grid is deliberate: an assertion about a bridge between noteheads and
// seconds is only readable if the seconds are readable, and every gap, edge
// and boundary case below is at a number you can hold in your head.
//
// WHY IT LIVES IN src/ AND NOT IN tests/
//
// Because the browser tools (score:review, score:playback, score:heads) drive
// the app's own modules through the vite dev server, and vite serves src/. A
// fixture under tests/ is invisible to exactly the checks that most need it —
// the ones that would otherwise reach for a microphone.

import { Recorder } from '../audio/recording.js';
import { pitchOf } from '../analysis/scan-notes.js';
import { NO_KEY } from '../analysis/scan-key.js';

// Marks 0-31 of pages/truth/bach.truth.json, in file order, each with the step
// bach.pitch.json gives it: [step, x, y]. File order IS reading order for
// these 32 — the pitch file says so under `matches`, and says it was checked
// rather than assumed: all of them are on system 1, x runs 0.154 to 0.909 with
// no gaps, and mark 32 is back at x=0.135 starting system 2.
//
// The step column and the y column agree, which is a fact about the page and
// not a fact about this array: the four G2s (step 0) lie at y 0.16295-0.16960,
// the D3s (step 4) at 0.15487-0.15819, the A3s (step 8) at 0.14489-0.14584,
// the B3s (step 9) at 0.13777-0.14442 and the C4s (step 10) at
// 0.13397-0.13824. Six ranges, no overlap, monotone in the right direction.
// If a future edit to either truth file breaks that, matchesTruthFiles() says
// so.
const BACH_MARKS = [
  [0, 0.15429, 0.16817],
  [4, 0.17714, 0.15724],
  [9, 0.2, 0.14299],
  [8, 0.22357, 0.14584],
  [9, 0.245, 0.14299],
  [4, 0.26857, 0.15819],
  [9, 0.29286, 0.14347],
  [4, 0.31714, 0.15772],
  [0, 0.33857, 0.1696],
  [4, 0.36357, 0.15724],
  [9, 0.385, 0.14442],
  [8, 0.41071, 0.14489],
  [9, 0.43357, 0.14157],
  [4, 0.45714, 0.15582],
  [9, 0.48143, 0.14062],
  [4, 0.505, 0.15487],
  [0, 0.545, 0.16627],
  [5, 0.57143, 0.15059],
  [10, 0.59571, 0.13539],
  [9, 0.62143, 0.13777],
  [10, 0.64571, 0.13492],
  [5, 0.67, 0.14964],
  [10, 0.69429, 0.13397],
  [5, 0.71857, 0.14822],
  [0, 0.745, 0.16295],
  [5, 0.76714, 0.14917],
  [10, 0.79214, 0.13397],
  [9, 0.81786, 0.13777],
  [10, 0.84143, 0.13587],
  [5, 0.865, 0.15154],
  [10, 0.88786, 0.13824],
  [5, 0.90857, 0.15487],
];

// bach.truth.json's own `space`, in the same fractional units as x and y. The
// scan view sizes a ring off it, so a fixture that made one up would draw
// rings the wrong size for the page it claims to be.
const BACH_SPACE = 0.004751;

export const BACH_OPENING = {
  source: 'Menuet.pdf',
  truth: 'pages/truth/bach.truth.json',
  pitchTruth: 'pages/truth/bach.pitch.json',
  clef: 'bass',
  marks: BACH_MARKS,
  space: BACH_SPACE,
};

// The page, as `headsOf(layout)` would have handed it over.
//
// Shaped to match scan-read.js:notesInOrder plus the two fields scan-view.js
// adds — page and space — and the midi it prices in. Anything the bridge or
// the pairing reads is here; `beats`, `beams` and the key fields are carried
// because notesInOrder carries them and a fixture that quietly drops a field
// is a fixture that hides a bug in whatever reads it.
export function bachHeads({ page = 0 } = {}) {
  return BACH_MARKS.map(([step, x, y], i) => ({
    staff: 0,
    bar: i < 16 ? 0 : 1,
    x,
    y,
    step,
    beats: null,
    beams: 0,
    via: 'shape',
    clef: 'bass',
    key: NO_KEY,
    keyConfidence: 1,
    page,
    space: BACH_SPACE,
    midi: pitchOf(step, 'bass', NO_KEY)?.midi ?? null,
  }));
}

// Where the grid starts. Not zero, so that "before the first note" is a real
// moment in the recording rather than a value that only exists off the end of
// it — the bridge has to answer null there and a test cannot ask if the
// recording begins on the downbeat.
const LEAD_IN = 0.75;
// One note every half second, sounding for four fifths of that. The tenth of a
// second left over at each end is the gap the bridge must answer null in:
// between two notes nothing is being played, and the head that was sounding a
// moment ago is not sounding now.
const SPACING = 0.5;
const SOUNDING = 0.4;

// Deterministic, and deliberately not random. `cents` exists so that anything
// drawing the take has something to colour with; a fixed sequence means the
// twelfth note is 5 cents sharp on every machine and in every run, so a test
// can name it.
function centsFor(i) {
  return ((i * 37) % 41) - 20;
}

// The 32 notes of the opening, as the note segmenter would have produced them:
// midi, cents, and start/end in SECONDS IN THE RECORDING. That last pair is
// the whole point of this fixture — it is the field the time bridge joins on,
// and until now nothing in the repo could produce one without a microphone.
export function bachPlayed({ from = LEAD_IN, spacing = SPACING, sounding = SOUNDING } = {}) {
  return BACH_MARKS.map(([step], i) => {
    const midi = pitchOf(step, 'bass', NO_KEY).midi;
    const start = from + i * spacing;
    return { midi, cents: centsFor(i), start, end: start + sounding, name: null };
  });
}

// The other piece, and it is the more important of the two.
//
// Refusing to place a take is a BEHAVIOUR, not an absence of one — CLAUDE.md
// rule 3 — and a behaviour that has no fixture is a behaviour nobody has ever
// watched happen. This is two octaves of a D major scale, played twice: 24
// notes, monotonically ascending, in a register the Bach opening never reaches
// at the top. Its contour agrees with the Bach's in no more than a chance
// number of places, which is the point — the shape route (findStart) and the
// pitch route (alignScore) are both being handed something that is genuinely
// not this page.
//
// What it is NOT is a claim that the app refuses it. See scan-sync.test.js for
// what was measured when this was actually run through pairNotes; alignScore
// has no refusal in it and always returns a path.
const D_MAJOR = [50, 52, 54, 55, 57, 59, 61, 62, 64, 66, 67, 69, 71, 73, 74];

export function wrongPiecePlayed({ from = LEAD_IN, spacing = SPACING, sounding = SOUNDING } = {}) {
  const midis = [...D_MAJOR, ...D_MAJOR.slice(0, 9)];
  return midis.map((midi, i) => {
    const start = from + i * spacing;
    return { midi, cents: centsFor(i), start, end: start + sounding, name: null };
  });
}

// One decaying sine per note, summed into a real Recorder.
//
// The real Recorder rather than a stand-in object, because it is the surface
// buildEmphasizedClip actually uses — sampleRate, duration and extract() — and
// because pushing in chunks exercises extract()'s chunk-boundary walk, which a
// single-array fake would not. A stand-in would pass a test the real class
// could fail.
//
// 8000 Hz: midi 43 is 98 Hz and midi 74 is 587 Hz, both far under the Nyquist
// limit, and seventeen seconds of it is half a megabyte instead of six.
const CHUNK = 1024;
const DEFAULT_RATE = 8000;
// Three quarters of a second of silence past the last note, so that "after the
// take" is a moment that EXISTS in the recording rather than a time off the end
// of it — the same reason LEAD_IN puts silence in front. A bridge answering
// null past the last note is only saying something if the recording is still
// running there; past the end it would be answering about nothing.
const TAIL = 0.75;

export function synthRecording(notes, { sampleRate = DEFAULT_RATE, gain = 0.4, decay = 6 } = {}) {
  const played = notes ?? [];
  const duration = played.length ? played.at(-1).end + TAIL : TAIL;
  const total = Math.ceil(duration * sampleRate);
  const buffer = new Float32Array(total);

  for (const note of played) {
    if (!Number.isFinite(note?.start) || !Number.isFinite(note?.end)) continue;
    const hz = 440 * 2 ** ((note.midi + (note.cents ?? 0) / 100 - 69) / 12);
    const first = Math.max(0, Math.floor(note.start * sampleRate));
    const last = Math.min(total, Math.ceil(note.end * sampleRate));
    for (let i = first; i < last; i++) {
      const age = (i - first) / sampleRate;
      buffer[i] += gain * Math.exp(-decay * age) * Math.sin(2 * Math.PI * hz * age);
    }
  }

  const recorder = new Recorder(sampleRate);
  for (let at = 0; at < total; at += CHUNK) {
    recorder.push(buffer.subarray(at, Math.min(total, at + CHUNK)));
  }
  return recorder;
}

// Everything a caller needs to stand in for a session: the page, the take, and
// the audio under it.
export function bachTake(options = {}) {
  const played = bachPlayed(options);
  return { heads: bachHeads(options), played, recording: synthRecording(played, options) };
}

export function wrongPieceTake(options = {}) {
  const played = wrongPiecePlayed(options);
  return { heads: bachHeads(options), played, recording: synthRecording(played, options) };
}

// Is this copy still the page it says it is?
//
// Rule 4 of CLAUDE.md says the truth files are what every number is measured
// against and that a bad edit to one is invisible afterwards. This fixture is
// a COPY of 32 of those marks, which adds a second way for the two to disagree
// — the truth file gets a mark removed, this array does not, and every test
// built on it goes on measuring a page that no longer exists.
//
// So the copy is checkable. Node only (it reads files); the browser tools
// import the arrays and skip this.
export async function matchesTruthFiles({ root = '.' } = {}) {
  const { readFile } = await import('node:fs/promises');
  const at = async (p) => JSON.parse(await readFile(`${root}/${p}`, 'utf8'));
  const truth = await at(BACH_OPENING.truth);
  const pitch = await at(BACH_OPENING.pitchTruth);
  const steps = pitch.bars.flatMap((bar) => bar.steps);
  const problems = [];

  if (truth.space !== BACH_SPACE) problems.push(`space ${truth.space} not ${BACH_SPACE}`);
  if (pitch.clef !== BACH_OPENING.clef) problems.push(`clef ${pitch.clef}`);
  for (const [i, [step, x, y]] of BACH_MARKS.entries()) {
    const mark = truth.notes[i];
    if (!mark) { problems.push(`mark ${i} is gone from the truth file`); continue; }
    if (mark.x !== x || mark.y !== y) problems.push(`mark ${i} moved to ${mark.x},${mark.y}`);
    if (steps[i] !== step) problems.push(`step ${i} is ${steps[i]}, not ${step}`);
  }
  return { ok: problems.length === 0, problems };
}
