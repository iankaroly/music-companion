// Reading a .mxl — the compressed MusicXML container.
//
// Audiveris exports .mxl by default, and so does every notation program, so a
// pipeline that only reads bare .xml would reject most of what arrives. The
// format is a zip holding META-INF/container.xml, which names the real score
// entry.
//
// No zip dependency: Node inflates raw deflate streams itself, and the rest of
// the format is three fixed-size headers. Entries are read from the CENTRAL
// DIRECTORY rather than the local headers because an entry written with a data
// descriptor carries zero for its sizes at the front of the file.

import { inflateRawSync } from 'node:zlib';
import { parseXml } from './xml.js';

const CENTRAL = 0x02014b50;
const END = 0x06054b50;
const END_ZIP64_LOCATOR = 0x07064b50;

/** A cheap sniff so callers can route a buffer without try/catch. */
export function looksLikeZip(buffer) {
  return buffer.length > 4 && buffer.readUInt32LE(0) === 0x04034b50;
}

function findEndRecord(buffer) {
  // The end-of-central-directory record is last, but a zip comment may follow
  // it — so scan backwards over the largest comment the format allows.
  const earliest = Math.max(0, buffer.length - 22 - 0xffff);
  for (let at = buffer.length - 22; at >= earliest; at -= 1) {
    if (buffer.readUInt32LE(at) === END) return at;
  }
  return -1;
}

/**
 * Read every entry of a zip into a Map of name -> Buffer.
 * @param {Buffer} buffer
 */
export function unzip(buffer) {
  const endAt = findEndRecord(buffer);
  if (endAt === -1) throw new Error('not a zip file');
  if (endAt >= 20 && buffer.readUInt32LE(endAt - 20) === END_ZIP64_LOCATOR) {
    // A zip64 .mxl would mean a 4GB score. Refuse clearly rather than read
    // truncated offsets and hand back a corrupt document.
    throw new Error('zip64 archives are not supported');
  }

  const count = buffer.readUInt16LE(endAt + 10);
  let at = buffer.readUInt32LE(endAt + 16);
  const entries = new Map();

  for (let i = 0; i < count; i += 1) {
    if (at + 46 > buffer.length || buffer.readUInt32LE(at) !== CENTRAL) {
      throw new Error('damaged zip directory');
    }
    const method = buffer.readUInt16LE(at + 10);
    const compressedSize = buffer.readUInt32LE(at + 20);
    const nameLength = buffer.readUInt16LE(at + 28);
    const extraLength = buffer.readUInt16LE(at + 30);
    const commentLength = buffer.readUInt16LE(at + 32);
    const localAt = buffer.readUInt32LE(at + 42);
    const name = buffer.toString('utf8', at + 46, at + 46 + nameLength);

    // The local header repeats the name and extra fields, at their own lengths.
    const localNameLength = buffer.readUInt16LE(localAt + 26);
    const localExtraLength = buffer.readUInt16LE(localAt + 28);
    const dataAt = localAt + 30 + localNameLength + localExtraLength;
    const data = buffer.subarray(dataAt, dataAt + compressedSize);

    if (method === 0) entries.set(name, Buffer.from(data));
    else if (method === 8) entries.set(name, inflateRawSync(data));
    else throw new Error(`unsupported zip compression method ${method} for ${name}`);

    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/**
 * MusicXML text out of whatever the OMR engine wrote.
 *
 * Accepts a bare .xml/.musicxml buffer or a .mxl container; for the container it
 * follows META-INF/container.xml, and falls back to "the only .xml that is not
 * the container" when that file is missing or malformed — which OMR output
 * sometimes is.
 *
 * @param {Buffer} buffer
 * @returns {string} MusicXML text
 */
export function readMusicXmlBuffer(buffer) {
  if (!looksLikeZip(buffer)) return stripBom(buffer.toString('utf8'));

  const entries = unzip(buffer);
  const container = entries.get('META-INF/container.xml');
  if (container) {
    try {
      const root = parseXml(container.toString('utf8'));
      const rootfile = root.child('rootfiles')?.child('rootfile');
      const path = rootfile?.attrs['full-path'];
      if (path && entries.has(path)) return stripBom(entries.get(path).toString('utf8'));
    } catch {
      // fall through to the guess below
    }
  }
  for (const [name, data] of entries) {
    if (name.startsWith('META-INF/')) continue;
    if (/\.(xml|musicxml)$/i.test(name)) return stripBom(data.toString('utf8'));
  }
  throw new Error('this .mxl holds no MusicXML entry');
}

function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
