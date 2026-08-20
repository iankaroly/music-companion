// The HTTP API.
//
// Shape of it, and why:
//
//   POST /v1/scores            upload -> 202 + a job id. OMR takes minutes; a
//                              request cannot wait, so the work is queued and
//                              the score id is handed out immediately.
//   GET  /v1/jobs/:id          poll. Carries stage, percent and the engine log.
//   GET  /v1/scores/:id/...    the structured score: measures, notes, timeline.
//   POST /v1/scores/:id/alignments   anchors -> a timemap.
//   GET  /v1/alignments/:id/cursor?t=41.2   what is sounding at 41.2 seconds.
//
// THE ALIGNMENT RESOURCE IS THE POINT. A score has many alignments — one per
// recording, and several per recording while you refine them — so an alignment
// is its own resource with its own id rather than a field on the score. That is
// what makes "same part, five takes" work, and it is why the audio work that
// comes next needs no new endpoints: an aligner is just something that POSTs
// better anchors.

import { timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import multer from 'multer';
import config from '../config.js';
import { ApiError, badRequest, errorHandler, notFound, unsupported } from './errors.js';
import { convert, sniffKind } from '../pipeline.js';
import { assembleUpload } from '../scan/assemble-upload.js';
import { enqueue, getJob, reporter } from '../jobs/queue.js';
import { probeEngines } from '../omr/registry.js';
import {
  AlignmentError, buildTimemap, constantTimemap, fitConstantTempo, quarterAtSeconds, secondsAt,
} from '../align/timemap.js';
import { cursorAt, measureSchedule, schedule } from '../align/lookup.js';
import { quarterAt } from '../musicxml/timeline.js';
import {
  deleteAlignment, deleteScore, listAlignments, listJobs, listScores,
  loadAlignment, loadMusicXml, loadScore, newId, publicSource, saveAlignment,
  saveScore, saveUpload, sha256, workDirFor,
} from '../storage/store.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// Uploads are held in memory, not streamed to disk, because the sniff needs the
// first bytes before anything is written and the size cap keeps it bounded.
// Several files are accepted under the same field name, so photographing a
// six-page part is one upload rather than six. They are combined before
// anything else looks at them — see scan/assemble-upload.js.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.upload.maxBytes, files: config.upload.maxPages },
});

/** Wrap an async handler so a rejected promise reaches the error middleware. */
const route = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

/** Load a score or 404. */
async function requireScore(id) {
  let record = null;
  try {
    record = await loadScore(id);
  } catch {
    throw badRequest('that is not a score id');
  }
  if (!record) throw notFound('score');
  if (record.status !== 'ready') {
    throw new ApiError(409, `this score is not ready yet (status: ${record.status})`, { jobId: record.jobId });
  }
  return record;
}

async function requireAlignment(id) {
  let record = null;
  try {
    record = await loadAlignment(id);
  } catch {
    throw badRequest('that is not an alignment id');
  }
  if (!record) throw notFound('alignment');
  const score = await requireScore(record.scoreId);
  return { alignment: record, score };
}

/**
 * Turn the anchors a client sent into {quarter, time} on the performance clock.
 *
 * Clients think in bars: `{"measure": 17, "beat": 3, "time": 41.2}`. The
 * timeline knows where bar 17 beat 3 sits. Accepting a raw `quarter` too is
 * what lets a machine aligner post hundreds of anchors without doing bar
 * arithmetic first.
 */
function resolveAnchors(timeline, anchors) {
  if (!Array.isArray(anchors) || anchors.length === 0) {
    throw badRequest('anchors must be a non-empty array');
  }
  return anchors.map((anchor, i) => {
    const time = Number(anchor.time ?? anchor.seconds);
    if (!Number.isFinite(time)) throw badRequest(`anchor ${i} has no time in seconds`);

    if (anchor.quarter !== undefined) {
      const quarter = Number(anchor.quarter);
      if (!Number.isFinite(quarter)) throw badRequest(`anchor ${i} has a quarter that is not a number`);
      return { quarter, time, label: anchor.label ?? null };
    }

    const resolved = quarterAt(timeline, {
      measureNumber: anchor.measure ?? anchor.measureNumber,
      measureIndex: anchor.measureIndex,
      ordinal: anchor.ordinal,
      pass: anchor.pass,
      beat: anchor.beat ?? 1,
    });
    if (!resolved) {
      throw badRequest(`anchor ${i} points at a bar that is not in this score`, { anchor });
    }
    return {
      quarter: resolved.quarter,
      time,
      label: anchor.label ?? `m${resolved.span.measureNumber}${anchor.beat ? `.${anchor.beat}` : ''}`,
    };
  });
}

/**
 * Build the timemap for an alignment request body.
 *
 * Everything AlignmentError covers — anchors that go backwards, two times for
 * one bar, a tempo of zero — is the CLIENT's mistake, so it is translated to a
 * 400 here. Letting it reach the error handler as an unknown throw would report
 * a bug in this server for a bad request, which sends whoever is debugging it
 * to the wrong place.
 */
function timemapFor(timeline, body) {
  try {
    return buildTimemapFor(timeline, body);
  } catch (err) {
    if (err instanceof AlignmentError) throw badRequest(err.message);
    throw err;
  }
}

function buildTimemapFor(timeline, body) {
  const mode = body.mode ?? (body.anchors ? 'anchors' : 'constant');

  if (mode === 'constant') {
    const quarterBpm = Number(body.quarterBpm ?? body.bpm);
    if (!Number.isFinite(quarterBpm)) throw badRequest('constant alignment needs quarterBpm');
    return {
      mode,
      timemap: constantTimemap({
        quarterBpm,
        offsetSeconds: Number(body.offsetSeconds ?? 0),
        totalQuarters: timeline.totalQuarters,
      }),
      anchors: [],
      fit: null,
    };
  }

  const anchors = resolveAnchors(timeline, body.anchors);

  if (mode === 'fit') {
    // Many noisy taps -> one straight line. A player tapping every bar wants
    // the average tempo, not a timemap that lurches at every early tap.
    const fit = fitConstantTempo(anchors);
    return {
      mode,
      anchors,
      fit,
      timemap: constantTimemap({
        quarterBpm: fit.quarterBpm,
        offsetSeconds: fit.offsetSeconds,
        totalQuarters: timeline.totalQuarters,
      }),
    };
  }

  if (mode !== 'anchors') throw badRequest(`unknown alignment mode "${mode}"`);
  // Build the map BEFORE fitting a tempo through the anchors: the map is what
  // validates them, and anchors that run backwards should be reported as that
  // rather than as the impossible tempo they happen to imply.
  const timemap = buildTimemap(anchors, {
    quarterBpm: Number(body.quarterBpm ?? body.bpm) || undefined,
    totalQuarters: timeline.totalQuarters,
  });
  return {
    mode,
    anchors,
    // The average tempo, reported alongside the piecewise map, for a UI that
    // wants to say "you played this at 92".
    fit: anchors.length >= 2 ? fitConstantTempo(anchors) : null,
    timemap,
  };
}


/** Local origins, unless told otherwise. See config.corsOrigins for why. */
const LOCAL_ORIGIN = /^(https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?|capacitor:\/\/localhost|ionic:\/\/localhost|file:\/\/)$/;

// The home network, so a phone can use the pipeline on the laptop.
//
// Scanning happens on a phone; the recogniser is a JVM and a neural network and
// runs on a computer. The one arrangement that makes the feature real is the
// app served off that computer and opened on the phone over the house wifi —
// and every request in it is then cross-origin from a private address. These
// are the private ranges and nothing else: 10/8, 172.16/12, 192.168/16 and
// link-local, which cannot be reached from outside the house.
const PRIVATE_ORIGIN = new RegExp(
  '^http://('
  + '10\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}'
  + '|172\\.(1[6-9]|2\\d|3[01])\\.\\d{1,3}\\.\\d{1,3}'
  + '|192\\.168\\.\\d{1,3}\\.\\d{1,3}'
  + '|169\\.254\\.\\d{1,3}\\.\\d{1,3}'
  + '|[a-z0-9-]+\\.local'
  + ')(:\\d+)?$',
);

function allowedOrigin(origin) {
  if (!origin) return null;                       // curl, or a same-origin page
  const configured = config.corsOrigins;
  if (configured === '*') return '*';
  // A PASSWORD MAKES THE ORIGIN LIST BESIDE THE POINT.
  //
  // Without one, the address is the protection and only the house may call in.
  // With one, the pipeline is deliberately reachable from anywhere — that is
  // what a tunnel is for — and the app doing the calling is served from
  // whatever host it is deployed at. Refusing that origin while accepting the
  // password would leave the feature broken in exactly the arrangement it was
  // set up for.
  if (config.token) return origin;
  if (configured) {
    const list = configured.split(',').map((o) => o.trim()).filter(Boolean);
    return list.includes(origin) ? origin : null;
  }
  return LOCAL_ORIGIN.test(origin) || PRIVATE_ORIGIN.test(origin) ? origin : null;
}

/**
 * Cross-origin access, for the app.
 *
 * The practice app is served by Vite on another port and the iOS build from
 * capacitor://localhost, so it is cross-origin to this service even though both
 * are on the same machine. Without this the browser refuses every call and the
 * app looks as though no pipeline is running.
 */
function cors(req, res, next) {
  const origin = allowedOrigin(req.headers.origin);
  if (origin) {
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Vary', 'Origin');
    // The score download names its own file; a browser cannot read that header
    // cross-origin unless it is exposed.
    res.set('Access-Control-Expose-Headers', 'Content-Disposition, X-Score-Generated');
  }
  if (req.method === 'OPTIONS') {
    res.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    res.set('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] ?? 'content-type');
    res.set('Access-Control-Max-Age', '600');
    res.status(204).end();
    return;
  }
  next();
}


/**
 * The password, when one is set.
 *
 * Checked on everything but the health probe, which says only that something is
 * listening — that is what a tunnel's own checks ask for, and it gives nothing
 * away. The demo page and its assets are behind it too: if the pipeline is
 * reachable from the open web, so is that page.
 *
 * Compared in constant time, because a token that can be guessed a character at
 * a time is not a token.
 */
function password(req, res, next) {
  const wanted = config.token;
  if (!wanted) return next();
  if (req.path === '/healthz') return next();

  const given = req.get('x-omr-token')
    ?? (typeof req.query.token === 'string' ? req.query.token : '');
  const a = Buffer.from(String(given));
  const b = Buffer.from(String(wanted));
  const ok = a.length === b.length && timingSafeEqual(a, b);
  if (!ok) {
    res.status(401).json({
      error: {
        message: 'this pipeline needs the password it was started with — see OMR_TOKEN',
        status: 401,
        details: null,
      },
    });
    return;
  }
  return next();
}

export function createApp() {
  const app = express();
  app.use(express.json({ limit: '4mb' }));       // anchor lists can be long
  app.disable('x-powered-by');

  app.use(cors);
  app.use(password);

  // A demo client at /. It is not the product — it is the API being used, in a
  // browser, so a change to an endpoint can be seen rather than only asserted.
  app.use(express.static(path.resolve(HERE, '../../public')));

  // --- health and capability ------------------------------------------------

  app.get('/healthz', (req, res) => res.json({ ok: true, uptime: process.uptime() }));

  // What this machine can read. A client should call this before offering an
  // "upload a scan" button, and warn if only the fixture engine is present.
  app.get('/v1/engines', route(async (req, res) => {
    res.json({ engines: await probeEngines(), configured: config.omr.engine });
  }));

  // --- upload ---------------------------------------------------------------

  app.post('/v1/scores', upload.array('file', config.upload.maxPages), route(async (req, res) => {
    const files = req.files ?? [];
    if (files.length === 0) throw badRequest('send the scan as multipart/form-data field "file"');

    const scoreId = newId('sc');
    const jobId = newId('job');

    // Two or more files: combine them into one document first. Photographs of
    // six pages become a six-page PDF, which is what the rest of the pipeline
    // can actually work with — page numbers, per-page fallback, re-rendering.
    let buffer = files[0].buffer;
    let uploadName = files[0].originalname;
    let assembled = null;
    if (files.length > 1) {
      try {
        assembled = await assembleUpload(
          files.map((f) => ({ buffer: f.buffer, name: f.originalname })),
          { workDir: workDirFor(scoreId) },
        );
      } catch (err) {
        throw badRequest(err.message);
      }
      buffer = assembled.buffer;
      uploadName = `${(req.body.title || 'scan').replace(/[^\w. -]/g, '_')}.pdf`;
    }

    const kind = sniffKind(buffer, uploadName);
    if (kind === 'unknown') {
      throw unsupported('that file is neither a PDF, an image, nor MusicXML');
    }

    const filePath = await saveUpload(scoreId, uploadName, buffer);

    // The score record exists from the moment of upload, in `converting` state,
    // so a client can hold onto one id for the whole life of the thing rather
    // than a job id that later turns into a score id.
    const record = {
      id: scoreId,
      status: 'converting',
      jobId,
      title: req.body.title || files[0].originalname.replace(/\.[^.]+$/, ''),
      source: {
        filename: files.length > 1 ? uploadName : files[0].originalname,
        bytes: buffer.length,
        sha256: sha256(buffer),
        kind,
        path: filePath,
        // What arrived, when it was more than one file — so a client can show
        // "6 photos → one 6-page PDF" rather than a mystery document.
        assembledFrom: assembled ? files.map((f) => f.originalname) : null,
        assemblyNote: assembled?.note ?? null,
      },
      createdAt: new Date().toISOString(),
      score: null,
      timeline: null,
    };
    await saveScore(record, '');

    const job = enqueue({ id: jobId, scoreId, kind, filename: uploadName }, async (liveJob) => {
      const report = reporter(liveJob);
      if (assembled) report.log(assembled.note);
      const result = await convert({
        scoreId,
        filePath,
        filename: uploadName,
        kind,
        engineId: req.body.engine || req.query.engine,
        // Only a title the client actually typed overrides what is printed on
        // the score; the filename is a fallback, not an instruction.
        title: req.body.title || null,
        report,
      });

      record.status = 'ready';
      record.pages = result.pages;
      record.score = result.score;
      record.timeline = result.timeline;
      record.omr = result.omr;
      record.quality = result.quality;
      record.title = result.score.title ?? record.title;
      record.readyAt = new Date().toISOString();
      await saveScore(record, result.musicXml);
      await result.cleanup();

      return {
        scoreId,
        measures: result.timeline.measureCount,
        notes: result.timeline.noteCount,
        engine: result.omr.engine,
        degraded: result.omr.degraded,
        quality: result.quality,
      };
    });

    res.status(202)
      .location(`/v1/scores/${scoreId}`)
      .json({
        scoreId,
        jobId: job.id,
        status: job.status,
        queuePosition: job.queuePosition,
        poll: `/v1/jobs/${job.id}`,
      });
  }));

  // --- jobs -----------------------------------------------------------------

  app.get('/v1/jobs', route(async (req, res) => {
    const jobs = await listJobs();
    res.json({ jobs: jobs.map(({ log, ...rest }) => rest) });
  }));

  app.get('/v1/jobs/:id', route(async (req, res) => {
    // The live copy has the newest log lines; the stored one survives restarts.
    const job = getJob(req.params.id) ?? (await listJobs()).find((j) => j.id === req.params.id);
    if (!job) throw notFound('job');
    res.json({ job });
  }));

  // --- scores ---------------------------------------------------------------

  app.get('/v1/scores', route(async (req, res) => {
    res.json({ scores: await listScores() });
  }));

  app.get('/v1/scores/:id', route(async (req, res) => {
    const record = await loadScore(req.params.id).catch(() => null);
    if (!record) throw notFound('score');
    // The default is a summary: a 40-page score is megabytes of notes and a
    // client asking "is it ready?" should not be made to download them.
    if (req.query.include === 'full') {
      res.json({ ...record, source: publicSource(record.source) });
      return;
    }
    const { score, timeline, ...summary } = record;
    res.json({
      ...summary,
      source: publicSource(summary.source),
      parts: score?.parts.map((p) => ({
        id: p.id, name: p.name, instrument: p.instrument, staves: p.staves,
        measures: p.measures.length, totalQuarters: p.totalQuarters,
      })) ?? null,
      totalQuarters: timeline?.totalQuarters ?? null,
      measureCount: timeline?.measureCount ?? null,
      noteCount: timeline?.noteCount ?? null,
      repeated: timeline?.repeated ?? null,
      pagesRead: record.pages?.filter((p) => p.status === 'read').length ?? null,
      pagesFailed: record.pages?.filter((p) => p.status === 'failed').length ?? null,
    });
  }));

  app.delete('/v1/scores/:id', route(async (req, res) => {
    await deleteScore(req.params.id);
    for (const alignment of await listAlignments(req.params.id)) await deleteAlignment(alignment.id);
    res.status(204).end();
  }));

  // The engine's own output, kept so a player can correct it by hand in
  // MuseScore and upload the result back through the passthrough engine.
  app.get('/v1/scores/:id/musicxml', route(async (req, res) => {
    const record = await requireScore(req.params.id);
    const xml = await loadMusicXml(req.params.id);
    if (!xml) throw notFound('musicxml');
    // When the engine read a page at a time, this file was written from the
    // joined model rather than by the engine. Say so in a header: it is a
    // complete score, but it carries notes and structure only — no engraving.
    if (record.omr?.generatedMusicXml) {
      res.set('X-Score-Generated', `joined from ${record.omr.documents} pages by score-pipeline`);
    }
    res.set('Content-Disposition',
      `attachment; filename="${(record.title ?? 'score').replace(/[^\w. -]/g, '_')}.musicxml"`);
    res.type('application/vnd.recordare.musicxml+xml').send(xml);
  }));

  app.get('/v1/scores/:id/measures', route(async (req, res) => {
    const record = await requireScore(req.params.id);
    const part = req.query.part
      ? record.score.parts.find((p) => p.id === req.query.part)
      : record.score.parts[0];
    if (!part) throw notFound('part');
    res.json({
      partId: part.id,
      // Printed order, one entry per bar as drawn.
      measures: part.measures.map(({ notes, ...measure }) => measure),
    });
  }));

  app.get('/v1/scores/:id/notes', route(async (req, res) => {
    const record = await requireScore(req.params.id);
    const part = req.query.part
      ? record.score.parts.find((p) => p.id === req.query.part)
      : record.score.parts[0];
    if (!part) throw notFound('part');
    const from = Number(req.query.fromMeasure ?? 0);
    const to = Number(req.query.toMeasure ?? Number.MAX_SAFE_INTEGER);
    const notes = part.measures
      .filter((m) => m.index >= from && m.index <= to)
      .flatMap((m) => m.notes);
    res.json({ partId: part.id, count: notes.length, notes });
  }));

  // The performance view: repeats unfolded, ties merged. This is what an audio
  // aligner works against.
  app.get('/v1/scores/:id/timeline', route(async (req, res) => {
    const record = await requireScore(req.params.id);
    if (req.query.include === 'events') { res.json(record.timeline); return; }
    const { events, ...rest } = record.timeline;
    res.json({ ...rest, eventCount: events.length });
  }));

  // What happened to each page of the upload. On a long scan this is the first
  // thing to look at: a page that failed is a hole, and an alignment that spans
  // a hole is wrong rather than short.
  app.get('/v1/scores/:id/pages', route(async (req, res) => {
    const record = await requireScore(req.params.id);
    const pages = record.pages ?? [];
    res.json({
      pages,
      read: pages.filter((p) => p.status === 'read').length,
      failed: pages.filter((p) => p.status === 'failed').length,
      truncated: record.omr?.meta?.truncated ?? false,
    });
  }));

  app.get('/v1/scores/:id/quality', route(async (req, res) => {
    const record = await requireScore(req.params.id);
    res.json({ quality: record.quality, omr: record.omr });
  }));

  // --- alignments -----------------------------------------------------------

  app.post('/v1/scores/:id/alignments', route(async (req, res) => {
    const record = await requireScore(req.params.id);
    const built = timemapFor(record.timeline, req.body ?? {});

    const alignment = {
      id: newId('al'),
      scoreId: record.id,
      label: req.body.label ?? null,
      mode: built.mode,
      // What the client sent, kept verbatim so an alignment can be edited by
      // adding one anchor rather than re-sending the whole list.
      anchors: built.anchors,
      fit: built.fit,
      timemap: built.timemap,
      // Opaque to this server: a URI, a local filename, a duration. The audio
      // itself is deliberately NOT stored here — recordings are large, private,
      // and already live in whatever app made them.
      audio: req.body.audio ?? null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await saveAlignment(alignment);
    res.status(201).location(`/v1/alignments/${alignment.id}`).json({ alignment });
  }));

  app.get('/v1/scores/:id/alignments', route(async (req, res) => {
    await requireScore(req.params.id);
    res.json({ alignments: await listAlignments(req.params.id) });
  }));

  app.get('/v1/alignments/:id', route(async (req, res) => {
    const { alignment } = await requireAlignment(req.params.id);
    res.json({ alignment });
  }));

  // Re-fit. Sending the anchors again with one more in the list is the whole
  // "tap along and watch it get better" interaction.
  app.patch('/v1/alignments/:id', route(async (req, res) => {
    const { alignment, score } = await requireAlignment(req.params.id);
    const body = {
      mode: req.body.mode ?? alignment.mode,
      anchors: req.body.anchors ?? alignment.anchors,
      quarterBpm: req.body.quarterBpm,
      offsetSeconds: req.body.offsetSeconds,
    };
    const built = timemapFor(score.timeline, body);
    const updated = {
      ...alignment,
      mode: built.mode,
      anchors: built.anchors,
      fit: built.fit,
      timemap: built.timemap,
      label: req.body.label ?? alignment.label,
      audio: req.body.audio ?? alignment.audio,
      updatedAt: new Date().toISOString(),
    };
    await saveAlignment(updated);
    res.json({ alignment: updated });
  }));

  app.delete('/v1/alignments/:id', route(async (req, res) => {
    await deleteAlignment(req.params.id);
    res.status(204).end();
  }));

  // --- the queries a player's screen makes ---------------------------------

  // Where are we? Called on every animation frame while audio plays.
  app.get('/v1/alignments/:id/cursor', route(async (req, res) => {
    const { alignment, score } = await requireAlignment(req.params.id);
    const t = Number(req.query.t ?? req.query.seconds);
    if (!Number.isFinite(t)) throw badRequest('pass ?t= seconds into the recording');
    res.json(cursorAt(score.timeline, alignment.timemap, t));
  }));

  // Every note with a start and end in seconds — the table an audio feature
  // actually consumes.
  app.get('/v1/alignments/:id/schedule', route(async (req, res) => {
    const { alignment, score } = await requireAlignment(req.params.id);
    const notes = schedule(score.timeline, alignment.timemap, {
      from: Number(req.query.from ?? -Infinity),
      to: Number(req.query.to ?? Infinity),
      includeRests: req.query.rests === '1',
    });
    res.json({ count: notes.length, notes });
  }));

  // The same, one row per bar. What a tap-along or page-turn UI draws.
  app.get('/v1/alignments/:id/measures', route(async (req, res) => {
    const { alignment, score } = await requireAlignment(req.params.id);
    res.json({ measures: measureSchedule(score.timeline, alignment.timemap) });
  }));

  // Both directions of the map, for a client doing its own maths.
  app.get('/v1/alignments/:id/convert', route(async (req, res) => {
    const { alignment, score } = await requireAlignment(req.params.id);
    if (req.query.t !== undefined) {
      const t = Number(req.query.t);
      if (!Number.isFinite(t)) throw badRequest('t must be a number');
      res.json({ seconds: t, quarter: quarterAtSeconds(alignment.timemap, t) });
      return;
    }
    const resolved = req.query.quarter !== undefined
      ? { quarter: Number(req.query.quarter) }
      : quarterAt(score.timeline, {
        measureNumber: req.query.measure,
        pass: req.query.pass ? Number(req.query.pass) : undefined,
        beat: req.query.beat ? Number(req.query.beat) : 1,
      });
    if (!resolved || !Number.isFinite(resolved.quarter)) throw badRequest('pass ?t=, ?quarter= or ?measure=');
    res.json({ quarter: resolved.quarter, seconds: secondsAt(alignment.timemap, resolved.quarter) });
  }));

  app.use((req, res, next) => next(notFound(`route ${req.method} ${req.path}`)));
  app.use(errorHandler);
  return app;
}
