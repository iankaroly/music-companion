import test from 'node:test';
import assert from 'node:assert/strict';
import { parseXml } from '../src/musicxml/xml.js';

test('reads elements, attributes and text in document order', () => {
  const root = parseXml('<a x="1"><b>one</b><b>two</b></a>');
  assert.equal(root.name, 'a');
  assert.equal(root.attrs.x, '1');
  assert.deepEqual(root.all('b').map((b) => b.text), ['one', 'two']);
  assert.equal(root.textOf('b'), 'one');
});

test('decodes entities, including numeric ones', () => {
  const root = parseXml('<a>1 &lt; 2 &amp;&#65;&#x42;</a>');
  assert.equal(root.text, '1 < 2 &AB');
});

test('skips declarations, comments, DOCTYPEs and internal subsets', () => {
  const root = parseXml(
    '<?xml version="1.0"?><!DOCTYPE score [<!ENTITY x "y">]><!-- hi --><a><!--c--><b/></a>',
  );
  assert.equal(root.name, 'a');
  assert.equal(root.all('b').length, 1);
});

test('keeps CDATA verbatim', () => {
  assert.equal(parseXml('<a><![CDATA[<not a tag> & co]]></a>').text, '<not a tag> & co');
});

test('self-closing elements are children, not text', () => {
  const root = parseXml('<a><b n="1"/><c/></a>');
  assert.equal(root.children.length, 2);
  assert.equal(root.child('b').attrs.n, '1');
});

test('refuses a mismatched closing tag rather than guessing', () => {
  assert.throws(() => parseXml('<a><b></c></a>'), /does not match/);
});

test('refuses an unclosed element', () => {
  assert.throws(() => parseXml('<a><b></a>'), /does not match|never closed/);
});

test('numberOf falls back when the child is missing or not a number', () => {
  const root = parseXml('<a><n>7</n><m>x</m></a>');
  assert.equal(root.numberOf('n', 0), 7);
  assert.equal(root.numberOf('m', 3), 3);
  assert.equal(root.numberOf('absent', 3), 3);
});
