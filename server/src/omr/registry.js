// Which engine runs, and who decides.
//
// The adapter interface is four things — `id`, `accepts`, `available()`,
// `convert()` — and that is the whole extension point. Adding homr, Mozart, a
// hosted API or your own model is a new file next to these and one line here;
// nothing else in the pipeline changes, because everything downstream is
// written against MusicXML rather than against an engine.
//
// Selection order for an upload with no explicit engine:
//   1. the file is already MusicXML  -> passthrough (never re-recognise)
//   2. OMR_ENGINE names one          -> use it, fail loudly if it is missing
//   3. the best engine installed     -> audiveris, then oemer
//   4. nothing installed             -> fixture, with `degraded: true` on the
//      job so a caller can tell a canned score from a real one. Silently
//      returning made-up notes would be the worst possible failure here.

import { audiverisEngine } from './engine-audiveris.js';
import { oemerEngine } from './engine-oemer.js';
import { fixtureEngine } from './engine-fixture.js';
import { passthroughEngine } from './engine-passthrough.js';

/** Best first — the order `auto` walks. */
export const ENGINES = [audiverisEngine, oemerEngine, fixtureEngine, passthroughEngine];

export function getEngine(id) {
  return ENGINES.find((e) => e.id === id) ?? null;
}

/** What this machine can actually do, with the reason when it cannot. */
export async function probeEngines() {
  return Promise.all(ENGINES.map(async (engine) => ({
    id: engine.id,
    label: engine.label,
    accepts: engine.accepts,
    needsRaster: engine.needsRaster,
    ...(await engine.available()),
  })));
}

/**
 * @param {{kind:'pdf'|'image'|'musicxml', requested?:string}} input
 * @returns {Promise<{engine:object, degraded:boolean, note:string|null}>}
 */
export async function chooseEngine({ kind, requested }) {
  if (kind === 'musicxml' && (!requested || requested === 'auto')) {
    return { engine: passthroughEngine, degraded: false, note: null };
  }

  const wanted = requested && requested !== 'auto' ? requested : process.env.OMR_ENGINE;
  if (wanted && wanted !== 'auto') {
    const engine = getEngine(wanted);
    if (!engine) throw new Error(`unknown OMR engine "${wanted}"`);
    const state = await engine.available();
    if (!state.ok) throw new Error(`engine "${wanted}" is not available: ${state.reason} — ${state.hint ?? ''}`.trim());
    if (!engine.accepts.includes(kind)) throw new Error(`engine "${wanted}" cannot read a ${kind}`);
    return { engine, degraded: engine.id === 'fixture', note: null };
  }

  for (const engine of [audiverisEngine, oemerEngine]) {
    if (!engine.accepts.includes(kind)) continue;
    if ((await engine.available()).ok) return { engine, degraded: false, note: null };
  }

  return {
    engine: fixtureEngine,
    degraded: true,
    note: 'no OMR engine is installed on this machine, so the score returned is a fixture, '
      + 'not a reading of the upload. Install one with scripts/install-oemer.sh '
      + 'or scripts/install-audiveris.sh.',
  };
}
