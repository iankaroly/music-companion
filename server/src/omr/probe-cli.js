#!/usr/bin/env node
// `npm run engines:probe` — what can this machine read?
import { probeEngines } from './registry.js';
import { findRasteriser } from './pdf.js';

const engines = await probeEngines();
const rasteriser = await findRasteriser();

for (const engine of engines) {
  const mark = engine.ok ? 'yes' : 'no ';
  console.log(`[${mark}] ${engine.id.padEnd(10)} ${engine.label}`);
  if (!engine.ok) console.log(`     ${engine.reason}${engine.hint ? ` — ${engine.hint}` : ''}`);
  else if (engine.bin) console.log(`     ${engine.bin}`);
}
console.log(`\nPDF rasteriser: ${rasteriser ?? 'none (install poppler or ghostscript)'}`);
