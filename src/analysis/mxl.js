// Opening whatever file the player actually hands us.
//
// MuseScore, Sibelius and Finale all offer a compressed .mxl — a zip holding
// the score plus a META-INF/container.xml naming which entry is the score. It
// is by far the most common thing to be sitting in someone's downloads, so
// refusing it would mean telling players to re-export before they can start.
//
// No zip library: the browser inflates with DecompressionStream('deflate-raw'),
// and the rest of the format is four fixed-size headers. Read from the central
// directory rather than the local headers, because an entry written with a data
// descriptor carries zero for its sizes at the front of the file.

import { parseXml } from './xml.js';

const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const END = 0x06054b50;

const decoder = new TextDecoder();

function findEndRecord(view) {
  // The end record is last, but a zip comment can follow it — so scan back.
  // 22 bytes of record, up to 0xffff of comment.
  const earliest = Math.max(0, view.byteLength - 22 - 0xffff);
  for (let at = view.byteLength - 22; at >= earliest; at--) {
    if (view.getUint32(at, true) === END) return at;
  }
  return -1;
}

async function inflate(bytes, method) {
  if (method === 0) return bytes;
  if (method !== 8) throw new Error(`unsupported zip compression method ${method}`);
  if (typeof DecompressionStream !== 'function') {
    throw new Error('this browser cannot open compressed .mxl files — export as uncompressed MusicXML');
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// name → Uint8Array, read lazily so a 40-page score is not inflated four times.
export async function unzip(buffer) {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const endAt = findEndRecord(view);
  if (endAt === -1) throw new Error('not a zip file');

  const count = view.getUint16(endAt + 10, true);
  let at = view.getUint32(endAt + 16, true);
  const entries = [];

  for (let i = 0; i < count; i++) {
    if (view.getUint32(at, true) !== CENTRAL) throw new Error('damaged zip directory');
    const method = view.getUint16(at + 10, true);
    const compressedSize = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const localAt = view.getUint32(at + 42, true);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));

    entries.push({ name, method, compressedSize, localAt });
    at += 46 + nameLength + extraLength + commentLength;
  }

  const files = new Map();
  for (const entry of entries) {
    files.set(entry.name, async () => {
      if (view.getUint32(entry.localAt, true) !== LOCAL) throw new Error(`damaged entry: ${entry.name}`);
      const nameLength = view.getUint16(entry.localAt + 26, true);
      const extraLength = view.getUint16(entry.localAt + 28, true);
      const start = entry.localAt + 30 + nameLength + extraLength;
      return inflate(bytes.subarray(start, start + entry.compressedSize), entry.method);
    });
  }
  return files;
}

function looksLikeZip(buffer) {
  if (buffer.byteLength < 4) return false;
  return new DataView(buffer).getUint32(0, true) === LOCAL;
}

// The one call the UI makes: bytes in, MusicXML text out.
export async function readScoreFile(buffer, filename = '') {
  if (!looksLikeZip(buffer)) return decoder.decode(new Uint8Array(buffer));

  const files = await unzip(buffer);

  // The container names the real score; anything else in the zip may be a
  // thumbnail, a second arrangement, or the exporter's own leftovers.
  const container = files.get('META-INF/container.xml');
  if (container) {
    try {
      const xml = parseXml(decoder.decode(await container()));
      const rootfile = xml.child('rootfiles')?.child('rootfile');
      const path = rootfile?.attrs['full-path'];
      const read = path && files.get(path);
      if (read) return decoder.decode(await read());
    } catch {
      // A broken container is not a broken score — fall through and look.
    }
  }

  for (const [name, read] of files) {
    if (name.startsWith('META-INF/') || name.startsWith('__MACOSX/')) continue;
    if (!/\.(musicxml|xml)$/i.test(name)) continue;
    return decoder.decode(await read());
  }

  throw new Error(`no MusicXML found inside ${filename || 'the file'}`);
}
