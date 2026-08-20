// The job queue.
//
// OMR takes tens of seconds to several minutes on a real scan, which is far too
// long to hold an HTTP request open: the upload returns 202 with a job id, and
// the client polls (or, later, subscribes). That shape is the reason the API
// looks the way it does, and it is worth being explicit about the trade:
//
// WHAT THIS IS: an in-process queue with a concurrency limit, persisted to disk
// so a job's history and log survive being read later.
// WHAT THIS IS NOT: durable. If the process dies mid-conversion the job is lost
// — at boot, anything left `running` is marked failed rather than pretending it
// is still going. For one machine serving one musician that is the right size;
// the swap to BullMQ/Redis or a hosted queue is this file, because everything
// else only calls `enqueue`.

import config from '../config.js';
import { listJobs, saveJob, trimJobs } from '../storage/store.js';

const MAX_LOG_LINES = 400;   // enough to debug a failed page, bounded for memory
const MAX_LINE_LENGTH = 300; // and no single line can blow that bound either

/** @type {{job:object, work:Function}[]} */
const waiting = [];
let running = 0;

/** Jobs are cached in memory so polling does not hit the disk every 500ms. */
const live = new Map();

export function getJob(id) {
  return live.get(id) ?? null;
}

/** Anything that says "running" after a restart is a lie; correct it once. */
export async function recoverJobs() {
  for (const job of await listJobs()) {
    if (job.status === 'running' || job.status === 'queued') {
      job.status = 'failed';
      job.error = { message: 'the server restarted while this job was running' };
      job.finishedAt = new Date().toISOString();
      await saveJob(job);
    }
  }
  await trimJobs();
}

/**
 * @param {object} seed fields to record on the job (scoreId, filename, engine…)
 * @param {(job:object)=>Promise<object>} work the actual conversion
 * @returns {object} the job record, already queued
 */
export function enqueue(seed, work) {
  const job = {
    ...seed,
    status: 'queued',
    progress: { stage: 'queued', percent: 0 },
    log: [],
    createdAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null,
    error: null,
    result: null,
    // How many jobs are in front of this one, answered at enqueue time so a
    // client can say "3rd in the queue" rather than "please wait".
    queuePosition: waiting.length + running,
  };
  live.set(job.id, job);
  saveJob(job).catch(() => { /* the in-memory copy is authoritative while it runs */ });

  waiting.push({ job, work });
  pump();
  return job;
}

/** Attach progress reporting to a running job. */
export function reporter(job) {
  let repeats = 0;
  const stamp = () => new Date().toISOString().slice(11, 19);
  return {
    stage(stage, percent) {
      job.progress = { stage, percent: Math.max(0, Math.min(100, Math.round(percent))) };
      job.updatedAt = new Date().toISOString();
    },
    log(line) {
      const text = String(line).slice(0, MAX_LINE_LENGTH);
      const last = job.log[job.log.length - 1];
      // A tool that redraws a progress bar sends the same line hundreds of
      // times. Count the repeats instead of storing them: the log is polled
      // over HTTP, and a job that downloads an 80MB model must not turn its
      // own progress into an 800KB response body.
      if (last && last.endsWith(text)) {
        repeats += 1;
        job.log[job.log.length - 1] = `${stamp()} ${text} (x${repeats + 1})`;
        return;
      }
      repeats = 0;
      job.log.push(`${stamp()} ${text}`);
      if (job.log.length > MAX_LOG_LINES) job.log.splice(0, job.log.length - MAX_LOG_LINES);
    },
  };
}

function pump() {
  while (running < Math.max(1, config.concurrency) && waiting.length) {
    const next = waiting.shift();
    running += 1;
    void execute(next);
  }
  // Positions shift as the queue drains; keep them honest.
  waiting.forEach((entry, index) => { entry.job.queuePosition = index + running; });
}

async function execute({ job, work }) {
  job.status = 'running';
  job.startedAt = new Date().toISOString();
  job.queuePosition = 0;
  await saveJob(job).catch(() => {});

  try {
    job.result = await work(job);
    job.status = 'done';
    job.progress = { stage: 'done', percent: 100 };
  } catch (err) {
    job.status = 'failed';
    // The message a human reads and the detail a developer needs are different
    // things; keep both rather than stringifying one into the other.
    job.error = {
      message: err.message,
      details: err.details ?? null,
      stack: process.env.NODE_ENV === 'production' ? undefined : err.stack,
    };
    job.progress = { stage: 'failed', percent: 100 };
  } finally {
    job.finishedAt = new Date().toISOString();
    running -= 1;
    await saveJob(job).catch(() => {});
    trimJobs().catch(() => {});
    pump();
  }
}

/** For tests and for a graceful shutdown: resolve when nothing is left. */
export function idle() {
  return new Promise((resolve) => {
    const check = () => (running === 0 && waiting.length === 0 ? resolve() : setTimeout(check, 25));
    check();
  });
}
