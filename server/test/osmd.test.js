// Someone else's MusicXML reader has to open what we write.
//
// Every other test here checks our serialiser against our parser, which proves
// only that the two agree with each other. This one renders the output in
// OpenSheetMusicDisplay — an independent implementation, in a real browser —
// because "turn my scan into the XML" means a file that opens somewhere else.
//
// It caught two things a round trip could not: a zero-length rest from a real
// scan that made OSMD refuse the whole document, and parts of unequal length,
// which OSMD accepts and then silently renders truncated to the shortest.
//
// Skipped, loudly, when the headless browser or OSMD build is not present.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseMusicXml } from '../src/musicxml/parse.js';
import { joinScores } from '../src/musicxml/assemble.js';
import { scoreToMusicXml } from '../src/musicxml/serialise.js';
import { fixture } from './helpers.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OSMD = process.env.OSMD_BUILD
  ?? path.resolve(process.env.HOME, 'music-companion/node_modules/opensheetmusicdisplay/build/opensheetmusicdisplay.min.js');
const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';

const skip = existsSync(OSMD) && existsSync(SHELL)
  ? false
  : 'needs chrome-headless-shell and an opensheetmusicdisplay build';

const dir = skip ? null : mkdtempSync(path.join(tmpdir(), 'osmd-'));
test.after(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

/** Render with OSMD; returns what it made of the file, or throws. */
function render(xml, name) {
  const file = path.join(dir, `${name}.musicxml`);
  writeFileSync(file, xml);
  const out = execFileSync('node', [path.resolve(HERE, '../scripts/osmd-check.mjs'), file], {
    encoding: 'utf8',
    timeout: 120000,
  });
  return Object.fromEntries(
    out.split('\n').filter((l) => l.includes(' ')).map((l) => {
      // Values like "2 (staves: 1, 1)" — keep the whole thing, and let the
      // caller parseInt what it wants.
      const [key, ...rest] = l.trim().split(/\s+/);
      return [key, rest.join(' ')];
    }),
  );
}

for (const name of ['two-bar-tune.musicxml', 'pickup-and-voices.musicxml', 'oemer-real-page.musicxml']) {
  test(`OSMD opens what we write for ${name}`, { skip }, () => {
    const score = parseMusicXml(fixture(name));
    const result = render(scoreToMusicXml(score), name.replace(/\W/g, '-'));
    assert.equal(parseInt(result.measures, 10), score.measureCount);
  });
}

test('OSMD opens a joined multi-page score, all of it', { skip }, () => {
  // Pages that disagree about their part count: the failure that made a real
  // ten-page book render as its first 120 bars instead of its 230.
  const twoParts = parseMusicXml(`<score-partwise version="4.0">
    <part-list>
      <score-part id="P1"><part-name>a</part-name></score-part>
      <score-part id="P2"><part-name>b</part-name></score-part>
    </part-list>
    <part id="P1"><measure number="1"><attributes><divisions>1</divisions>
      <time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>
    </measure></part>
    <part id="P2"><measure number="1"><attributes><divisions>1</divisions>
      <time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>
    </measure></part></score-partwise>`);
  const joined = joinScores([twoParts, parseMusicXml(fixture('two-bar-tune.musicxml'))]);

  const result = render(scoreToMusicXml(joined), 'joined');
  assert.equal(parseInt(result.parts, 10), 2);
  assert.equal(parseInt(result.measures, 10), 5);   // not 1, which is what it used to show
});

test('OSMD refuses nothing over a zero-length note from a real scan', { skip }, () => {
  // Audiveris returned a rest with duration 0 and no type. Written out
  // literally, OSMD rejects the entire document: "The provided duration is not
  // valid". The serialiser drops it; the bar keeps its length.
  const score = parseMusicXml(fixture('two-bar-tune.musicxml'));
  score.parts[0].measures[1].notes = [{
    id: 'x', measureIndex: 1, voice: '1', staff: 1, startQuarter: 4, measureQuarter: 0,
    durationQuarters: 0, type: null, dots: 0, rest: true, chord: false, grace: false,
    midi: null, pitch: null, tieStart: false, tieStop: false, layout: {},
  }];
  const result = render(scoreToMusicXml(score), 'zero-length');
  assert.equal(parseInt(result.measures, 10), 4);
});
