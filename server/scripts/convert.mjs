#!/usr/bin/env node
// Turn a scan into MusicXML, right here, with no server involved.
//
//   npm run convert -- ~/Downloads/part.pdf
//   npm run convert -- scan.pdf -o out.musicxml --engine audiveris
//   npm run convert -- photo.jpg --json score.json
//
// Why this exists next to the HTTP API: the API is built around a job queue
// because a browser cannot hold a request open for ten minutes. A terminal can.
// For "I have a PDF and I want the XML", a command that blocks until it is done
// and writes a file is the whole interaction, and it uses exactly the same
// pipeline — same engines, same parser, same page rescue — so anything it can
// convert, the server can too.

import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { convert, sniffKind } from '../src/pipeline.js';
import { probeEngines } from '../src/omr/registry.js';
import { assembleUpload } from '../src/scan/assemble-upload.js';

const args = process.argv.slice(2);

// A tiny parser rather than a dependency: flags that take a value, flags that
// do not, and whatever is left over is the input file.
const VALUE_FLAGS = new Set(['-o', '--out', '--json', '--engine']);
const values = new Map();
const switches = new Set();
const positional = [];
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (VALUE_FLAGS.has(arg)) { values.set(arg.replace(/^--?/, ''), args[i + 1]); i += 1; }
  else if (arg.startsWith('-')) switches.add(arg.replace(/^--?/, ''));
  else positional.push(arg);
}
const flag = (name, fallback = null) => values.get(name) ?? fallback;
const has = (name) => switches.has(name);
const inputs = positional;
const input = inputs[0];

if (has('engines')) {
  for (const engine of await probeEngines()) {
    console.log(`${engine.ok ? '[yes]' : '[no ]'} ${engine.id.padEnd(10)} ${engine.label}`);
    if (!engine.ok) console.log(`      ${engine.reason}${engine.hint ? ` — ${engine.hint}` : ''}`);
  }
  process.exit(0);
}

if (!input || has('help') || has('h')) {
  console.log(`Usage: npm run convert -- <scan.pdf|image|musicxml> [more images...] [options]

  Several images are combined into one PDF first, in the order given:
      npm run convert -- page1.jpg page2.jpg page3.jpg -o part.musicxml

  -o, --out <file>     where to write the MusicXML (default: alongside the input)
      --json <file>    also write the parsed score model as JSON
      --engine <id>    audiveris | oemer | musicxml | fixture (default: best installed)
      --quiet          print only the output path
      --engines        list what this machine can read, then stop
      VERBOSE=1        show the engine's own output as it goes
`);
  process.exit(has('help') || has('h') ? 0 : 1);
}

const quiet = has('quiet');
const say = (line) => { if (!quiet) console.error(line); };

// The pipeline wants ONE document. Several photographs become a PDF first —
// which is not a formality: a PDF is what can carry page numbers, be re-rendered
// at another resolution, and fall back page by page when one page fails.
const workRoot = await mkdtemp(path.join(tmpdir(), 'score-convert-'));
let buffer;
let sourceName = input;
if (inputs.length > 1) {
  const files = [];
  for (const file of inputs) files.push({ buffer: await readFile(file), name: path.basename(file) });
  const assembled = await assembleUpload(files, { workDir: workRoot });
  buffer = assembled.buffer;
  sourceName = `${path.basename(input).replace(/\.[^.]+$/, '')}-and-${inputs.length - 1}-more.pdf`;
  const combined = path.join(workRoot, sourceName);
  await writeFile(combined, buffer);
  say(assembled.note);
  sourceName = combined;
} else {
  buffer = await readFile(input);
}
const kind = sniffKind(buffer, sourceName);
if (kind === 'unknown') {
  console.error(`${input} is neither a PDF, an image, nor MusicXML`);
  process.exit(1);
}

const outPath = flag('out') ?? flag('o') ?? `${input.replace(/\.[^.]+$/, '')}.musicxml`;

const started = Date.now();
let lastStage = '';
const report = {
  stage(stage, percent) {
    if (stage === lastStage) return;
    lastStage = stage;
    say(`  ${String(Math.round(percent)).padStart(3)}%  ${stage}`);
  },
  log(line) {
    // The engine's own chatter is behind VERBOSE, but decisions about PAGES
    // are not: "page 3 rescued by oemer" is the difference between a score with
    // a hole in it and one without, and it should not need a debug flag.
    if (process.env.VERBOSE) { say(`        ${line}`); return; }
    // Decisions about PAGES only — not the engine's own warnings, which are
    // what VERBOSE is for. Matching a bare /failed/ pulled in Tesseract
    // grumbling about language files, which tells a user nothing.
    if (/rescued|keeping|went badly|nearly empty|page \d+ (failed|rescued|read)|truncat|DEGRADED/i.test(line)) {
      say(`      · ${line}`);
    }
  },
};

try {
  say(`reading ${inputs.length > 1 ? `${inputs.length} files` : path.basename(input)} `
    + `(${kind}, ${(buffer.length / 1024 / 1024).toFixed(1)}MB)`);
  const result = await convert({
    scoreId: path.basename(workRoot),
    filePath: path.resolve(sourceName),
    filename: path.basename(input),
    kind,
    engineId: flag('engine') ?? undefined,
    report,
    workDir: workRoot,
  });

  await writeFile(outPath, result.musicXml);
  const jsonPath = flag('json');
  if (jsonPath) await writeFile(jsonPath, JSON.stringify({ score: result.score, timeline: result.timeline }, null, 2));

  if (!quiet) {
    const seconds = ((Date.now() - started) / 1000).toFixed(0);
    const rescued = result.omr.rescuedBy
      ? ` → ${result.omr.rescuedBy} re-read ${result.omr.rescuedPages.length ? `page(s) ${result.omr.rescuedPages.join(', ')}` : 'the book'}`
      : '';
    console.error(`\nengine       ${result.omr.engine}${rescued}${result.omr.degraded ? ' (DEGRADED — a fixture, not a reading)' : ''}`);
    console.error(`pages        ${result.pages.map((p) => `${p.page}:${p.status === 'read' ? `${p.measures} bars` : 'FAILED'}`).join('  ')}`);
    console.error(`score        ${result.score.measureCount} bars, ${result.quality.notes} notes, `
      + `${result.timeline.totalQuarters.toFixed(1)} quarters`
      + `${result.quality.parts.length > 1 ? ` across ${result.quality.parts.length} parts` : ''}`);
    console.error(`rhythm       ${result.quality.rhythmScore} (${result.quality.irregularCount} bars that do not add up)`);
    if (result.omr.partialMusicXml) {
      console.error('note         this engine read one page at a time; the XML written is PAGE 1 only.');
      console.error('             use --json for the whole score across every page.');
    }
    console.error(`took         ${seconds}s`);
  }
  console.log(outPath);
  await result.cleanup();
} catch (err) {
  console.error(`\nfailed: ${err.message}`);
  if (err.details?.stderr) console.error(err.details.stderr.slice(-1500));
  process.exitCode = 1;
} finally {
  await rm(workRoot, { recursive: true, force: true });
}
