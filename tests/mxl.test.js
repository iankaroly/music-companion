import { describe, test, expect } from 'vitest';
import { readScoreFile } from '../src/analysis/mxl.js';

const enc = new TextEncoder();

// Build a real zip, because a hand-faked one would only prove the reader
// agrees with my idea of the format.
async function zip(entries, { deflate = false } = {}) {
  const parts = [];
  const central = [];
  let offset = 0;

  for (const [name, text] of entries) {
    const raw = enc.encode(text);
    let body = raw;
    if (deflate) {
      const stream = new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate-raw'));
      body = new Uint8Array(await new Response(stream).arrayBuffer());
    }
    const nameBytes = enc.encode(name);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(8, deflate ? 8 : 0, true);
    local.setUint32(18, body.length, true);
    local.setUint32(22, raw.length, true);
    local.setUint16(26, nameBytes.length, true);
    parts.push(new Uint8Array(local.buffer), nameBytes, body);

    const dir = new DataView(new ArrayBuffer(46));
    dir.setUint32(0, 0x02014b50, true);
    dir.setUint16(10, deflate ? 8 : 0, true);
    dir.setUint32(20, body.length, true);
    dir.setUint32(24, raw.length, true);
    dir.setUint16(28, nameBytes.length, true);
    dir.setUint32(42, offset, true);
    central.push(new Uint8Array(dir.buffer), nameBytes);
    offset += 30 + nameBytes.length + body.length;
  }

  const centralBytes = central.reduce((n, p) => n + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, centralBytes, true);
  end.setUint32(16, offset, true);

  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of all) { out.set(p, at); at += p.length; }
  return out.buffer;
}

const SCORE = '<?xml version="1.0"?><score-partwise version="4.0"><part id="P1"/></score-partwise>';

const CONTAINER = `<?xml version="1.0" encoding="UTF-8"?>
  <container><rootfiles>
    <rootfile full-path="Sonata.xml" media-type="application/vnd.recordare.musicxml+xml"/>
  </rootfiles></container>`;

describe('readScoreFile', () => {
  test('plain xml comes back untouched', async () => {
    expect(await readScoreFile(enc.encode(SCORE).buffer, 'part.musicxml')).toBe(SCORE);
  });

  test('an mxl is opened at the rootfile its container names', async () => {
    const buffer = await zip([
      ['META-INF/container.xml', CONTAINER],
      ['Sonata.xml', SCORE],
      ['Other.xml', '<score-partwise><wrong/></score-partwise>'],
    ]);
    expect(await readScoreFile(buffer, 'sonata.mxl')).toBe(SCORE);
  });

  test('deflated entries are inflated', async () => {
    const padded = SCORE + ' '.repeat(500); // compresses, so method 8 is real
    const buffer = await zip([
      ['META-INF/container.xml', CONTAINER],
      ['Sonata.xml', padded],
    ], { deflate: true });
    expect(await readScoreFile(buffer, 'sonata.mxl')).toBe(padded);
  });

  test('with no container it falls back to the first score file outside META-INF', async () => {
    const buffer = await zip([['META-INF/junk.xml', '<junk/>'], ['Score.xml', SCORE]]);
    expect(await readScoreFile(buffer, 'score.mxl')).toBe(SCORE);
  });

  test('a zip holding no score says so instead of returning nothing', async () => {
    const buffer = await zip([['readme.txt', 'hello']]);
    await expect(readScoreFile(buffer, 'x.mxl')).rejects.toThrow(/no MusicXML/i);
  });

  test('an mxl is recognised by its bytes even when the name lies', async () => {
    const buffer = await zip([['Score.xml', SCORE]]);
    expect(await readScoreFile(buffer, 'score.musicxml')).toBe(SCORE);
  });
});
