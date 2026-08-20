// Every knob in one file, read from the environment once.
//
// Nothing else in the server reads process.env: a setting that is looked up in
// three places is a setting that behaves differently in three places, and the
// limits here (upload size, page count, timeouts) are the ones that decide
// whether a hostile or merely enormous PDF can take the process down.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const number = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);

export const config = {
  port: number(process.env.PORT, 4000),
  host: process.env.HOST ?? '127.0.0.1',

  // Where uploads, scores and alignments live. One directory, so a deployment
  // is a volume mount and a reset is `rm -rf`.
  dataDir: path.resolve(process.env.SCORE_DATA_DIR ?? path.join(HERE, '../data')),

  // OMR is CPU-bound and memory-hungry; running two at once on a laptop makes
  // both slower and can swap. One at a time, queued, is the honest default.
  concurrency: number(process.env.OMR_CONCURRENCY, 1),

  upload: {
    maxBytes: number(process.env.MAX_UPLOAD_BYTES, 60 * 1024 * 1024),
    // A 200-page PDF would be a book, not a part, and would tie up the queue
    // for an hour. Refuse early and say so.
    maxPages: number(process.env.MAX_PAGES, 30),
  },

  omr: {
    engine: process.env.OMR_ENGINE ?? 'auto',
    dpi: number(process.env.OMR_DPI, 300),
    timeoutMs: number(process.env.OMR_TIMEOUT_MS, 20 * 60 * 1000),
    // A second opinion is opportunistic: the score is already in hand, and the
    // rescue only replaces a page if it reads MORE of it. Letting it run as
    // long as the real conversion means one slow page can double the job —
    // measured, a rescue that hit the 20-minute limit turned a 4-minute
    // conversion into 22 for a page it did not improve.
    rescueTimeoutMs: number(process.env.RESCUE_TIMEOUT_MS, 8 * 60 * 1000),
    // Keep the engine's scratch files after a job. Off by default (they are
    // large), on when you are debugging why a page read badly.
    keepWork: process.env.OMR_KEEP_WORK === '1',
  },

  // A PASSWORD FOR THE PIPELINE, when it is reachable from outside the house.
  //
  // On a home network the address itself is the protection: nobody outside can
  // route to 192.168.x.x. Put the service behind a tunnel so a phone can reach
  // it from anywhere and that protection is gone — the URL is public, and a
  // stranger who finds it can queue twenty-minute recognition jobs on somebody's
  // laptop and read whatever is uploaded.
  //
  // So: set OMR_TOKEN and every call must carry it. Unset, nothing changes and
  // the service stays as open as the network it is on — which is the right
  // default for loopback and the wrong one for a tunnel, so the tunnel script
  // makes one up if there is none.
  token: process.env.OMR_TOKEN ?? null,

  // Who may call this from a browser.
  //
  // The app is served by Vite on another port, and the iOS build runs from
  // capacitor://localhost, so every real caller is cross-origin even though
  // nothing here leaves the machine. The default allows LOCAL origins only —
  // anything on localhost, 127.0.0.1 or ::1, plus Capacitor's own scheme — so a
  // page on the open web cannot quietly use somebody's pipeline. CORS_ORIGINS
  // ("https://a.example,https://b.example", or "*") widens it deliberately.
  corsOrigins: process.env.CORS_ORIGINS ?? null,

  // Trim the job list so a long-running server does not grow without bound.
  jobRetention: number(process.env.JOB_RETENTION, 200),
};

export default config;
