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
