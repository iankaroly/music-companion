// The .mxl path: a compressed MusicXML container, which is what Audiveris and
// every notation program export by default. The fixture is a real zip written
// by a real zip writer, not one this repo made up.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { looksLikeZip, readMusicXmlBuffer, unzip } from '../src/musicxml/mxl.js';
import { parseMusicXml } from '../src/musicxml/parse.js';
import { sniffKind } from '../src/pipeline.js';
import { fixturePath } from './helpers.js';

const mxl = readFileSync(fixturePath('two-bar-tune.mxl'));

test('a .mxl is recognised as a zip and as music', () => {
  assert.equal(looksLikeZip(mxl), true);
  assert.equal(looksLikeZip(readFileSync(fixturePath('two-bar-tune.musicxml'))), false);
  assert.equal(sniffKind(mxl, 'tune.mxl'), 'musicxml');
});

test('every entry inflates, stored and deflated alike', () => {
  const entries = unzip(mxl);
  assert.equal(entries.get('mimetype').toString(), 'application/vnd.recordare.musicxml');
  assert.match(entries.get('META-INF/container.xml').toString(), /rootfile/);
  assert.match(entries.get('score.xml').toString(), /score-partwise/);
});

test('the score is found through META-INF/container.xml and parses', () => {
  const xml = readMusicXmlBuffer(mxl);
  const score = parseMusicXml(xml);
  assert.equal(score.title, 'Fixture Tune');
  assert.equal(score.parts[0].measures.length, 4);
});

test('a bare .musicxml goes through the same door untouched', () => {
  const xml = readMusicXmlBuffer(readFileSync(fixturePath('two-bar-tune.musicxml')));
  assert.match(xml, /^<\?xml/);
  assert.equal(parseMusicXml(xml).title, 'Fixture Tune');
});

test('a zip that is not music fails with a reason', () => {
  const notMusic = Buffer.from(mxl);
  // Corrupt the end-of-central-directory signature.
  notMusic.writeUInt32LE(0, notMusic.length - 22);
  assert.throws(() => readMusicXmlBuffer(notMusic), /not a zip file/);
});
