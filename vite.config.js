import { defineConfig } from 'vite';

// Which build is this?
//
// Added on the day a bug could not be told apart from a bug already fixed:
// installed on an iPad from Safari's "Add to Home Screen", the app holds its
// page for days, so "it still does nothing" and "it is still running last
// week's code" look exactly the same from here. A build stamp the app can show
// settles that in one glance, and the service worker registers under it, so a
// deploy is a new worker rather than a hope.
const stamp = [
  (process.env.VERCEL_GIT_COMMIT_SHA || 'local').slice(0, 7),
  new Date().toISOString().slice(0, 16).replace('T', ' '),
].join(' · ');

export default defineConfig({
  define: {
    __BUILD__: JSON.stringify(stamp),
  },
});
