// The engine that does no recognition at all.
//
// It returns a MusicXML file that ships with the repo (or one named by
// OMR_FIXTURE), ignoring the upload entirely. That sounds useless; it is the
// most-used engine in this codebase, for three reasons:
//
//   1. Tests. Everything above the OMR layer — parsing, the timeline, repeats,
//      the timemap, the HTTP API — is exercised without a 400MB model or a JVM,
//      so `npm test` runs in a second and CI needs no extra installs.
//   2. Development. A front-end being built against this API needs a score to
//      draw, not a correct one.
//   3. Diagnosis. When a real conversion looks wrong, running the same upload
//      through `?engine=fixture` says instantly whether the problem is in the
//      recognition or in everything after it.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readMusicXmlBuffer } from '../musicxml/mxl.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_FIXTURE = path.resolve(HERE, '../../fixtures/two-bar-tune.musicxml');

export const fixtureEngine = {
  id: 'fixture',
  label: 'Fixture (no recognition — returns a canned score)',
  accepts: ['pdf', 'image', 'musicxml'],
  needsRaster: false,

  async available() {
    return { ok: true, bin: process.env.OMR_FIXTURE ?? DEFAULT_FIXTURE };
  },

  async convert({ onLog }) {
    const file = process.env.OMR_FIXTURE ?? DEFAULT_FIXTURE;
    onLog?.(`fixture: returning ${path.basename(file)} without reading the upload`);
    return {
      documents: [{ page: null, musicXml: readMusicXmlBuffer(await readFile(file)) }],
      meta: { engine: 'fixture', fixture: file, recognised: false },
    };
  },
};
