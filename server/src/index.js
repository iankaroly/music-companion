// Server entry point.
import config from './config.js';
import { createApp } from './http/app.js';
import { initStore } from './storage/store.js';
import { recoverJobs } from './jobs/queue.js';
import { probeEngines } from './omr/registry.js';

await initStore();
await recoverJobs();

const app = createApp();
const server = app.listen(config.port, config.host, async () => {
  console.log(`score pipeline listening on http://${config.host}:${config.port}`);
  console.log(`data directory: ${config.dataDir}`);
  const engines = (await probeEngines()).filter((e) => e.ok).map((e) => e.id);
  console.log(`engines available: ${engines.join(', ')}`);
  if (!engines.includes('audiveris') && !engines.includes('oemer')) {
    console.warn('WARNING: no real OMR engine is installed — uploads will return the fixture score.');
    console.warn('         run scripts/install-oemer.sh or scripts/install-audiveris.sh');
  }
});

// Finish in-flight requests on a signal rather than cutting them off; an OMR
// job that is already running is left to finish or die with the process, which
// `recoverJobs` will report as failed on the next boot.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log(`\n${signal} — shutting down`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  });
}
