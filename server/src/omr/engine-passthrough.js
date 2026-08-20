// Not an OMR engine: the path for a file that is ALREADY MusicXML.
//
// A player who owns a .musicxml or .mxl of the piece should never be made to
// print it, scan it and run recognition on it to get a worse copy back. The
// upload endpoint sniffs the file, routes it here, and every stage after this
// point is identical — same score model, same timeline, same alignment API.

import { readFile } from 'node:fs/promises';
import { readMusicXmlBuffer } from '../musicxml/mxl.js';

export const passthroughEngine = {
  id: 'musicxml',
  label: 'MusicXML passthrough (no recognition needed)',
  accepts: ['musicxml'],
  needsRaster: false,

  async available() { return { ok: true }; },

  async convert({ inputPath, onLog }) {
    onLog?.('the upload is already MusicXML — skipping recognition');
    return {
      documents: [{ page: null, musicXml: readMusicXmlBuffer(await readFile(inputPath)) }],
      meta: { engine: 'musicxml', recognised: false },
    };
  },
};
