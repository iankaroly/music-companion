// Persistence: JSON files under one directory.
//
// WHY NOT A DATABASE: everything stored here is a document that is written once
// and read whole — a score, an alignment, a job record. There are no queries,
// no joins and no partial updates. A file per document plus an in-memory index
// is less code than a schema, survives a restart, and is inspectable with `cat`
// when a conversion goes wrong at three in the morning.
//
// The swap to Postgres or SQLite, if a multi-user deployment ever needs one, is
// this file and nothing else: the rest of the server only calls these methods.
//
// Writes are atomic (write a temp file, rename) because a half-written score
// that parses as valid JSON is worse than no score at all.

import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import config from '../config.js';

const dirs = {
  uploads: path.join(config.dataDir, 'uploads'),
  work: path.join(config.dataDir, 'work'),
  scores: path.join(config.dataDir, 'scores'),
  alignments: path.join(config.dataDir, 'alignments'),
  jobs: path.join(config.dataDir, 'jobs'),
};

export async function initStore() {
  await Promise.all(Object.values(dirs).map((d) => mkdir(d, { recursive: true })));
}

export const newId = (prefix) => `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 20)}`;

export const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

async function writeJsonAtomic(file, value) {
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2));
  await rename(temp, file);
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

// --- uploads ---------------------------------------------------------------

/** Save the uploaded bytes; returns where they landed. */
export async function saveUpload(scoreId, filename, buffer) {
  const dir = path.join(dirs.uploads, scoreId);
  await mkdir(dir, { recursive: true });
  // The name is attacker-controlled, so only its extension is kept.
  const extension = (path.extname(filename) || '.bin').toLowerCase().replace(/[^.a-z0-9]/g, '');
  const file = path.join(dir, `source${extension}`);
  await writeFile(file, buffer);
  return file;
}

export function workDirFor(scoreId) {
  return path.join(dirs.work, scoreId);
}

export async function clearWork(scoreId) {
  await rm(workDirFor(scoreId), { recursive: true, force: true });
}

// --- scores ----------------------------------------------------------------

export async function saveScore(record, musicXml) {
  await writeFile(path.join(dirs.scores, `${record.id}.musicxml`), musicXml);
  await writeJsonAtomic(path.join(dirs.scores, `${record.id}.json`), record);
  return record;
}

export const loadScore = (id) => readJson(path.join(dirs.scores, `${safe(id)}.json`));

export const loadMusicXml = (id) => readFile(path.join(dirs.scores, `${safe(id)}.musicxml`), 'utf8')
  .catch((err) => { if (err.code === 'ENOENT') return null; throw err; });

export async function listScores() {
  const files = await readdir(dirs.scores).catch(() => []);
  const records = await Promise.all(
    files.filter((f) => f.endsWith('.json')).map((f) => readJson(path.join(dirs.scores, f))),
  );
  return records
    .filter(Boolean)
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
    // The list is a list. Both the score and the timeline hold every note, which
    // on a long piece is megabytes each — a listing that returned them would be
    // the slowest endpoint here by two orders of magnitude.
    .map(({ score, timeline, ...summary }) => ({
      ...summary,
      source: publicSource(summary.source),
      measureCount: timeline?.measureCount ?? null,
      noteCount: timeline?.noteCount ?? null,
      totalQuarters: timeline?.totalQuarters ?? null,
    }));
}

export async function deleteScore(id) {
  const clean = safe(id);
  await Promise.all([
    rm(path.join(dirs.scores, `${clean}.json`), { force: true }),
    rm(path.join(dirs.scores, `${clean}.musicxml`), { force: true }),
    rm(path.join(dirs.uploads, clean), { recursive: true, force: true }),
    rm(workDirFor(clean), { recursive: true, force: true }),
  ]);
}

// --- alignments ------------------------------------------------------------

export const saveAlignment = (record) => writeJsonAtomic(path.join(dirs.alignments, `${record.id}.json`), record).then(() => record);
export const loadAlignment = (id) => readJson(path.join(dirs.alignments, `${safe(id)}.json`));
export const deleteAlignment = (id) => rm(path.join(dirs.alignments, `${safe(id)}.json`), { force: true });

export async function listAlignments(scoreId) {
  const files = await readdir(dirs.alignments).catch(() => []);
  const records = await Promise.all(files.map((f) => readJson(path.join(dirs.alignments, f))));
  return records
    .filter(Boolean)
    .filter((a) => !scoreId || a.scoreId === scoreId)
    .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
}

// --- jobs ------------------------------------------------------------------

export const saveJob = (job) => writeJsonAtomic(path.join(dirs.jobs, `${job.id}.json`), job).then(() => job);
export const loadJob = (id) => readJson(path.join(dirs.jobs, `${safe(id)}.json`));

export async function listJobs() {
  const files = await readdir(dirs.jobs).catch(() => []);
  const jobs = await Promise.all(files.map((f) => readJson(path.join(dirs.jobs, f))));
  return jobs.filter(Boolean).sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
}

/** Drop the oldest finished jobs so the directory cannot grow forever. */
export async function trimJobs(keep = config.jobRetention) {
  const jobs = await listJobs();
  const finished = jobs.filter((j) => j.status === 'done' || j.status === 'failed');
  for (const job of finished.slice(keep)) {
    await rm(path.join(dirs.jobs, `${job.id}.json`), { force: true });
  }
}

/**
 * The upload's details minus where it sits on this disk.
 *
 * `source.path` is an absolute filesystem path. It is needed internally and has
 * no business in an HTTP response, which is the kind of detail that is easy to
 * leave in and hard to notice.
 */
export function publicSource(source) {
  if (!source) return source;
  const { path: _omitted, ...rest } = source;
  return rest;
}

/** Ids come from us, but they arrive back over HTTP — never let one be a path. */
function safe(id) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
    throw new Error(`bad id: ${String(id).slice(0, 40)}`);
  }
  return id;
}

export { dirs };
