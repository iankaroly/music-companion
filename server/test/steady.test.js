// A clef and a key persist, so a misread one is not one wrong note — it is a
// system of them. A page of the Mozart flute concerto, printed and clean, came
// back with seven bars in bass clef and eleven with the key signature missing,
// on a page that is treble and one sharp throughout: fourteen bars of
// thirty-six, sixty-two notes wrong for a structural reason.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { steadyClefsAndKeys, clefShift, keyAlter } = await import('../src/musicxml/steady.js');

const bars = (list) => `<score-partwise><part-list><score-part id="P1"/></part-list><part id="P1">${
  list.join('')}</part></score-partwise>`;
const bar = (n, { clef, fifths, notes = '' } = {}) => `<measure number="${n}">`
  + (clef || fifths !== undefined
    ? `<attributes>${fifths !== undefined ? `<key><fifths>${fifths}</fifths></key>` : ''}`
      + `${clef ? `<clef><sign>${clef[0]}</sign><line>${clef[1]}</line></clef>` : ''}</attributes>`
    : '')
  + notes + '</measure>';
const noteOf = (step, octave, extra = '') => `<note><pitch><step>${step}</step><octave>${octave}</octave></pitch>`
  + `<duration>4</duration><voice>1</voice><type>quarter</type>${extra}</note>`;

test('the interval between two clefs is the one a reader would move a note by', () => {
  // The same line is G2 in bass and E4 in treble: twelve diatonic steps apart.
  assert.equal(clefShift({ sign: 'F', line: 4 }, { sign: 'G', line: 2 }), 12);
  assert.equal(clefShift({ sign: 'G', line: 2 }, { sign: 'F', line: 4 }), -12);
  assert.equal(clefShift({ sign: 'C', line: 4 }, { sign: 'C', line: 4 }), 0);
});

test('a key signature sharpens the letters it is supposed to', () => {
  assert.equal(keyAlter(1, 'F'), 1);
  assert.equal(keyAlter(1, 'C'), 0);
  assert.equal(keyAlter(2, 'C'), 1);
  assert.equal(keyAlter(-1, 'B'), -1);
  assert.equal(keyAlter(0, 'F'), 0);
});

test('a clef that keeps flipping is the reading, not the music', () => {
  // Treble, treble, "bass", treble, treble — with a note on the bottom line.
  const xml = bars([
    bar(1, { clef: 'G2', fifths: 0, notes: noteOf('E', 4) }),
    bar(2, { notes: noteOf('E', 4) }),
    bar(3, { clef: 'F4', notes: noteOf('G', 2) }),
    bar(4, { clef: 'G2', notes: noteOf('E', 4) }),
    bar(5, { notes: noteOf('E', 4) }),
    bar(6, { notes: noteOf('E', 4) }),
  ]);
  const out = steadyClefsAndKeys(xml);
  assert.equal(out.clefsFixed, 1);
  assert.ok(!out.xml.includes('<sign>F</sign>'), 'the invented bass clef is still there');
  // And the note that was under it is re-read as what that line means in treble.
  assert.equal((out.xml.match(/<step>E<\/step>/g) ?? []).length, 6);
});

test('a key that keeps flipping gets its sharps back', () => {
  const list = [];
  for (let i = 1; i <= 8; i += 1) {
    list.push(bar(i, { clef: i === 1 ? 'G2' : null, fifths: i % 2 ? 1 : 0, notes: noteOf('F', 5) }));
  }
  const out = steadyClefsAndKeys(bars(list));
  assert.equal(out.keysFixed, 4);
  assert.ok(!/<fifths>0<\/fifths>/.test(out.xml), 'a bar still has no key signature');
  // The four bars that LOST the signature get their sharps back — one sharp
  // means every F is sharp. The bars that already declared it are left exactly
  // as they were: a reading that was right is not re-read.
  assert.equal((out.xml.match(/<alter>1<\/alter>/g) ?? []).length, 4);
});

test('an accidental the recogniser SAW is not overwritten by the key', () => {
  const list = [];
  for (let i = 1; i <= 8; i += 1) {
    list.push(bar(i, {
      clef: i === 1 ? 'G2' : null,
      fifths: i % 2 ? 1 : 0,
      notes: noteOf('F', 5, '<accidental>natural</accidental>'),
    }));
  }
  const out = steadyClefsAndKeys(bars(list));
  assert.ok(out.keysFixed > 0);
  assert.equal((out.xml.match(/<alter>1<\/alter>/g) ?? []).length, 0,
    'a printed natural was turned into a sharp by the key');
});

test('a part that really does change clef is left alone', () => {
  // A cello line: bass for a while, then tenor, then treble — each change once,
  // each staying. Nothing here is a misreading and nothing should be touched.
  const list = [];
  for (let i = 1; i <= 12; i += 1) {
    const clef = i === 1 ? 'F4' : i === 5 ? 'C4' : i === 9 ? 'G2' : null;
    list.push(bar(i, { clef, fifths: i === 1 ? 0 : undefined, notes: noteOf('G', 3) }));
  }
  const out = steadyClefsAndKeys(bars(list));
  assert.equal(out.clefsFixed, 0, 'a real clef change was "corrected" away');
  assert.equal(out.xml, bars(list));
});

test('and a real page comes out in the clef and key it is printed in', () => {
  const xml = readFileSync(new URL('../../test/fixtures/recognised-page.musicxml', import.meta.url), 'utf8');
  const out = steadyClefsAndKeys(xml);
  const keys = new Set([...out.xml.matchAll(/<fifths>(-?\d+)<\/fifths>/g)].map((m) => m[1]));
  assert.equal(keys.size, 1, `the page still has ${keys.size} different key signatures`);
});

// A RECOGNISER THAT MISSES THE BARLINES PUTS BOTH CLEFS IN ONE "MEASURE", and
// that is the shape of the failure on a photographed page rather than a
// rendered one. The Bärenreiter page of BWV 1007, photographed as a book, came
// back as 4 measures for 20 printed bars — the first holding 192 of the 297
// notes, declaring a TREBLE clef part way down a page that is bass clef
// throughout, and then correcting itself to bass INSIDE the same measure. One
// clef read per measure sees only the first of those, so the part looks like it
// has one clef, nothing is an outlier, and the correction written for exactly
// this mistake never runs. The opening read `E4 B4 G5 F5` where the paper says
// `G2 D3 B3 A3`: the same music, every note a thirteenth out.
test('a runaway measure is cut at its clef changes, and the wrong half re-read', () => {
  // One "measure" of sixty notes in treble, the clef corrected to bass half way
  // through, then three ordinary bars of bass. No bar of one line of music
  // holds sixty notes; this is a page whose barlines were missed.
  const wrong = Array.from({ length: 30 }, () => noteOf('E', 4)).join('');
  const right = Array.from({ length: 30 }, () => noteOf('G', 2)).join('');
  const runaway = `<measure number="1"><attributes><key><fifths>0</fifths></key>`
    + `<clef><sign>G</sign><line>2</line></clef></attributes>${wrong}`
    + `<attributes><clef><sign>F</sign><line>4</line></clef></attributes>${right}</measure>`;
  const xml = bars([
    runaway,
    bar(2, { notes: noteOf('G', 2) }),
    bar(3, { notes: noteOf('G', 2) }),
    bar(4, { notes: noteOf('G', 2) }),
  ]);
  const out = steadyClefsAndKeys(xml);
  assert.equal(out.clefsFixed, 1, 'the treble half of the runaway measure is re-read');
  // E4 under a treble clef sits on the same line as G2 under a bass one, so the
  // thirty wrong notes come back as G2 and the thirty right ones do not move.
  const steps = [...out.xml.matchAll(/<step>([A-G])<\/step><octave>(\d+)<\/octave>/g)]
    .map((m) => m[1] + m[2]);
  assert.equal(steps.filter((s) => s === 'G2').length, 63, 'every note is now a G2');
  assert.equal(steps.filter((s) => s === 'E4').length, 0, 'and none is still an E4');
});

test('a bar the length of a bar is left alone, however its clef moves', () => {
  // The case the file says it will not touch: a cello line that really does
  // change clef inside a bar. Four notes, a clef change, four more — a bar, not
  // a page with its barlines missing. Nothing may move.
  const before = Array.from({ length: 4 }, () => noteOf('G', 2)).join('');
  const after = Array.from({ length: 4 }, () => noteOf('E', 4)).join('');
  const real = `<measure number="1"><attributes><key><fifths>0</fifths></key>`
    + `<clef><sign>F</sign><line>4</line></clef></attributes>${before}`
    + `<attributes><clef><sign>G</sign><line>2</line></clef></attributes>${after}</measure>`;
  const xml = bars([
    real,
    bar(2, { notes: noteOf('G', 2) }),
    bar(3, { notes: noteOf('G', 2) }),
    bar(4, { notes: noteOf('G', 2) }),
  ]);
  const out = steadyClefsAndKeys(xml);
  assert.equal(out.clefsFixed, 0, 'a real mid-bar clef change is not a misreading');
  assert.match(out.xml, /<step>E<\/step><octave>4<\/octave>/, 'and its notes stay where they are');
});
