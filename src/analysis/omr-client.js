// Asking the score pipeline to read a scan, from inside the app.
//
// WHAT THIS BREAKS, SAID FIRST: everything else in this app happens on the
// device. This does not. The pages are sent to a service — by default one
// running on this same machine at 127.0.0.1:4000, which is why it is the
// default — and a person who points it somewhere else is sending their sheet
// music there. So it is never automatic: nothing leaves until someone presses
// the button, and the button is only offered when the service answers.
//
// WHY IT EXISTS: a scan with no MusicXML behind it is the app's one dead end.
// The page reader finds the staves, the bars and every notehead, which is what
// marks a take onto the photograph — but not what those noteheads SAY, so
// "you played a wrong note" is the one thing it cannot tell you. The way out
// has been to find the MusicXML yourself and pair it by hand. Optical music
// recognition is what removes that errand, and it does not run in a browser:
// it is a JVM and a neural network, so it runs beside the app instead.
//
// The pipeline lives in server/ of this repo. `npm start` there.

const LOOPBACK = 'http://127.0.0.1:4000';

// THE ONE THAT IS RUNNING FOR EVERYBODY.
//
// The recogniser is a JVM and a neural network: it cannot run on a phone, and
// asking every player to run a laptop for it is not a feature anybody would
// use. So there is a service, it sleeps when nobody is scanning, and the app
// finds it without being told.
//
// It carries no password, and that is deliberate rather than lax: a secret
// shipped inside a public app is not a secret. What protects it is that it
// keeps nothing — the pages are deleted the moment they have been read — and
// that one caller may only convert so many scans an hour.
const HOSTED = 'https://score-pipeline.fly.dev';
const URL_KEY = 'omr-service-url';
const TOKEN_KEY = 'omr-service-token';
const PORT = 4000;

/**
 * Where the service is, by default: THE MACHINE THAT SERVED THE APP.
 *
 * This used to be 127.0.0.1 always, which is right on a laptop and useless on a
 * phone — where 127.0.0.1 is the phone, and there is no pipeline on a phone.
 * Scanning on the phone therefore never converted anything, which is not what
 * "it converts by itself" is supposed to mean.
 *
 * If the app is being served from a machine on the network — you opened
 * http://192.168.1.50:5199 on your phone, off the Mac running `npm run dev` —
 * then that same machine is where the pipeline will be, on its own port. So
 * that is the default, and there is nothing to set up.
 *
 * Only over plain http, which means a dev or home-network server. A page served
 * over https cannot call a plain-http service at all — the browser refuses it as
 * mixed content — so on the deployed app the default stays loopback, finds
 * nothing, and the feature stays quietly hidden. That is the honest behaviour:
 * pretending otherwise would put a button there that can never work.
 */
function defaultUrl() {
  try {
    const { protocol, hostname } = window.location;
    if (protocol === 'http:' && hostname && !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(hostname)) {
      return `http://${hostname}:${PORT}`;
    }
  } catch { /* no window, or a locked-down one */ }
  // A page served over https cannot call a plain-http service, so the hosted
  // one is the only thing it can use — and it is the one people will have.
  try {
    if (window.location.protocol === 'https:') return HOSTED;
  } catch { /* no window */ }
  return LOOPBACK;
}

/** Is this the service that runs for everybody? */
export function isHosted(url) {
  return String(url).replace(/\/+$/, '') === HOSTED;
}

/** Where the service is. Overridable, because it need not be this machine. */
export function omrUrl() {
  try {
    return localStorage.getItem(URL_KEY) || defaultUrl();
  } catch {
    return defaultUrl();   // private browsing, or storage refused
  }
}

/**
 * Is this service on the machine the app came from?
 *
 * The rule that decides whether the pages go by themselves or wait for a
 * button. Loopback is obviously this machine. So is the host that served the
 * page — if you are reading the app off that Mac, its pipeline is not
 * "somewhere else", it is the same computer, and asking twice is pedantry.
 * Anything else waits to be asked.
 */
export function isOwnMachine(url) {
  try {
    const at = new URL(url);
    if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(at.hostname)) return true;
    return typeof window !== 'undefined' && at.hostname === window.location.hostname;
  } catch {
    return false;
  }
}

/**
 * May the pages go without asking?
 *
 * Yes for the machine the app came from, which is the same computer. And yes
 * for an address somebody typed into Settings: typing the address of a
 * recogniser IS the asking, and being asked again on every scan afterwards is
 * the kind of politeness that makes a feature not worth having. Anything the
 * app guessed at, and is not this machine, still waits for the button.
 */
export function maySendFreely(url) {
  return isOwnMachine(url) || isHosted(url) || omrChosen();
}

export function setOmrUrl(url) {
  try {
    if (url) localStorage.setItem(URL_KEY, url.replace(/\/+$/, ''));
    else localStorage.removeItem(URL_KEY);
  } catch { /* the default still works */ }
}

/** The password the service was started with, if it has one. */
export function omrToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

export function setOmrToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* it will simply be refused */ }
}

/** Was the address chosen by hand, rather than guessed from the page? */
export function omrChosen() {
  try {
    return Boolean(localStorage.getItem(URL_KEY));
  } catch {
    return false;
  }
}

/** Every call carries the password, when there is one. */
function headers() {
  const token = omrToken();
  return token ? { 'x-omr-token': token } : {};
}

/**
 * An address that was never going to last.
 *
 * `npm run tunnel` hands out a fresh trycloudflare address every run and it
 * dies with the window that made it. One of those typed into the settings
 * outlives the tunnel by months, and `omrUrl` prefers whatever was typed over
 * everything else — so every scan afterwards fails at the network, which Safari
 * reports as "Load failed" and which looks exactly like the recogniser being
 * broken.
 *
 * Nobody chooses one of these on purpose for keeps, so a dead one is forgotten
 * rather than honoured. An address somebody actually runs — a machine on the
 * wifi, their own server — is never touched: it may be down for a minute and
 * it is still their choice.
 */
export function isTemporary(url) {
  try {
    return /\.trycloudflare\.com$/i.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** Forget a dead tunnel, so the app goes back to the recogniser everyone uses. */
function forgetTemporary() {
  try { localStorage.removeItem(URL_KEY); } catch { /* nothing to forget */ }
}

/**
 * How long to wait for a service to say hello.
 *
 * A pipeline on this machine either answers at once or is not running, and
 * nobody should watch a spinner to be told the second one.
 *
 * A HOSTED ONE IS ASLEEP. It stops when nobody is scanning — that is what makes
 * it cost nothing to leave running — and waking it takes time: measured at 7.8s
 * cold against 0.4s warm. At 1.5s the deployed app asked, gave up, and decided
 * there was no recogniser anywhere; the scan imported with no notes and nothing
 * said why. Twenty seconds is that measurement with room for a phone on a slow
 * connection, and it costs nothing on the warm answer that follows.
 *
 * @param {string} url
 * @returns {number} milliseconds
 */
export function probePatience(url) {
  return isOwnMachine(url) ? 1500 : 20000;
}

/**
 * Is the service there, and can it actually read music?
 *
 * The difference matters: a pipeline with no OMR engine installed answers
 * happily and returns a FIXTURE score — a canned piece that has nothing to do
 * with the scan. Offering "read the notes for me" and handing back somebody
 * else's tune would be the worst thing this could do, so `real` is what the
 * button waits for, not `ok`.
 *
 * @returns {Promise<{ok:boolean, real:boolean, engines:string[], url:string}>}
 */
export async function omrAvailable({ timeoutMs } = {}) {
  const first = await askService(omrUrl(), timeoutMs);
  if (first.ok || !isTemporary(first.url)) return first;
  // A tunnel that is gone: forget it and ask the one that is always there,
  // which is what a fresh install would have used anyway.
  forgetTemporary();
  return askService(omrUrl(), timeoutMs);
}

async function askService(url, timeoutMs) {
  timeoutMs ??= probePatience(url);
  const stop = AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined;
  try {
    const response = await fetch(`${url}/v1/engines`, { signal: stop, headers: headers() });
    if (!response.ok) return { ok: false, real: false, engines: [], url };
    const { engines } = await response.json();
    const ready = engines.filter((e) => e.ok).map((e) => e.id);
    return {
      ok: true,
      // musicxml passthrough and the fixture cannot read a photograph.
      real: ready.some((id) => id === 'audiveris' || id === 'oemer'),
      engines: ready,
      url,
    };
  } catch {
    // Not running, wrong port, blocked — all the same thing to a caller: the
    // button stays hidden and the app behaves exactly as it did before.
    return { ok: false, real: false, engines: [], url };
  }
}

/** The pages of a stored scan, as files to send. */
async function filesFrom(payload, name) {
  const stem = String(name || 'score').replace(/[^\w. -]/g, '_');

  // A PDF goes as it is. It is the best input the pipeline can have — it can
  // choose its own resolution from it, retry a page bigger, and fall back page
  // by page — and re-rendering it here would only throw detail away.
  if (payload?.source === 'pdf' && payload.data) {
    return [new File([payload.data], `${stem}.pdf`, { type: 'application/pdf' })];
  }

  // PHOTOGRAPHS GO AS PHOTOGRAPHS, CUT TO THE PAPER — not as the squared-up
  // pages, which is what they used to be and which is why a scan could come
  // back as music nobody played.
  //
  // The squared page is the right page to READ FROM. A photograph of a book
  // taken at arm's length is unpleasant to read music off, and the reader wants
  // a rectangle with the shadows taken out. But every pixel of that rectangle
  // has been resampled to make it, and a staff line is one pixel of black on
  // white: rotate a raster three degrees and each line becomes two grey ones.
  // Audiveris finds staves by looking for long dark runs, and deskews the page
  // itself — on the marks, not on the pixels, which is the better way round.
  //
  // MEASURED, `npm run omr:truth` — 352 notes engraved by LilyPond,
  // photographed, and scored as the longest run of the page's own notes that
  // comes back in the order they are printed:
  //
  //   the engraving itself, no camera        86.6%    <- the ceiling
  //   the photograph, as taken               85.5%
  //   the photograph, cut to the paper       78.4%    <- what now goes
  //   the page the app squared up            49.7%    <- what used to go
  //
  // Cut rather than whole, because the cut is what keeps the facing page and
  // the table out of it — and a rectangle of original pixels costs nothing to
  // take.
  const pages = payload?.pages ?? [];
  const raws = payload?.raws ?? [];
  const quads = payload?.quads ?? [];
  if (!pages.length) throw new Error('there are no pages in that score to send');
  const { pageForReading } = await import('../ui/straighten.js');
  const named = (file, i) => new File(
    [file],
    `${stem}-page-${String(i + 1).padStart(3, '0')}.${file.type === 'image/png' ? 'png' : 'jpg'}`,
    { type: file.type || 'image/jpeg' },
  );
  const out = [];
  for (const [i, page] of pages.entries()) {
    const raw = raws[i];
    let best = null;
    if (raw) {
      // The corners the scanner kept, when it kept any: on a book they are the
      // only thing that says which of the two sheets this page was.
      best = await pageForReading(raw, quads[i] ?? null).catch(() => null);
    }
    out.push(named(best ?? page, i));
  }
  return out;
}

/** Was this the network giving out, rather than the service answering? */
function droppedOut(err) {
  return err instanceof TypeError || /load failed|network|fetch/i.test(err?.message ?? '');
}

/**
 * A request that survives one blip.
 *
 * @param {string} where
 * @param {object} init
 * @param {Function|null} onProgress
 */
async function sending(where, init, onProgress = null) {
  try {
    return await fetch(where, init);
  } catch (err) {
    if (init.signal?.aborted || !droppedOut(err)) throw err;
    onProgress?.({ stage: 'the connection dropped — sending it again', percent: 0 });
    await new Promise((r) => setTimeout(r, 1500));
    return fetch(where, init);
  }
}

/**
 * Send a stored scan to the service and wait for the MusicXML.
 *
 * @param {object} payload from loadScorePages
 * @param {{name?:string, onProgress?:Function, signal?:AbortSignal}} [options]
 * @returns {Promise<{xml:string, quality:object, pages:object[], engine:string}>}
 */
export async function readWithOmr(payload, { name = 'score', onProgress = null, signal = null } = {}) {
  const url = omrUrl();
  const files = await filesFrom(payload, name);

  const form = new FormData();
  for (const file of files) form.append('file', file);
  form.append('title', name);

  onProgress?.({ stage: files.length > 1 ? `sending ${files.length} pages` : 'sending the scan', percent: 0 });

  // ONE RETRY, BECAUSE THIS IS A PHONE.
  //
  // A scan is megabytes, going out over whatever the wifi is doing while
  // somebody stands over a music stand. A connection that drops mid-upload is
  // a `TypeError` with no status and no body — Safari calls it "Load failed" —
  // and it reached the player as "could not read the notes — Load failed",
  // which sounds like the recogniser refusing the music rather than a blip.
  // Nothing has been created on the far side when this happens, so sending it
  // again is safe.
  const started = await sending(`${url}/v1/scores`, {
    method: 'POST', body: form, signal, headers: headers(),
  }, onProgress);
  if (!started.ok) {
    const body = await started.json().catch(() => null);
    throw new Error(body?.error?.message ?? `the service refused the upload (${started.status})`);
  }
  const { scoreId, jobId } = await started.json();

  // Recognition is minutes, not seconds — a JVM and a neural network reading
  // every stave — so the upload returns a job and this waits on it. Polling
  // rather than a socket because there is nothing to keep open: a poll every
  // second for a five-minute job is three hundred requests to a service on this
  // same machine.
  // A POLL THAT DROPS IS NOT A CONVERSION THAT FAILED.
  //
  // The reading goes on at the far end whether or not this phone can hear it,
  // and a minute of polling from a pocket will lose a request or two. Giving up
  // on the first one threw away a job that was busy succeeding.
  let missed = 0;
  for (;;) {
    if (signal?.aborted) throw new Error('stopped');
    let response;
    try {
      response = await fetch(`${url}/v1/jobs/${jobId}`, { signal, headers: headers() });
    } catch (err) {
      if (signal?.aborted || !droppedOut(err)) throw err;
      missed += 1;
      if (missed > 5) throw new Error(`lost contact with ${url} while it was reading`);
      onProgress?.({ stage: 'waiting for the connection', percent: 0 });
      await new Promise((resolve) => setTimeout(resolve, 2000));
      continue;
    }
    if (!response.ok) throw new Error('lost contact with the service');
    missed = 0;
    const { job } = await response.json();

    onProgress?.({ stage: job.progress?.stage ?? job.status, percent: job.progress?.percent ?? 0 });
    if (job.status === 'failed') throw new Error(job.error?.message ?? 'the service could not read it');
    if (job.status === 'done') break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  const get = (path) => fetch(`${url}${path}`, { signal, headers: headers() });
  const [xml, quality, pages] = await Promise.all([
    get(`/v1/scores/${scoreId}/musicxml`).then((r) => r.text()),
    get(`/v1/scores/${scoreId}/quality`).then((r) => r.json()),
    get(`/v1/scores/${scoreId}/pages`).then((r) => r.json()),
  ]);

  return { xml, quality: quality.quality, omr: quality.omr, pages, scoreId };
}

/**
 * What to say about a reading before anyone trusts it.
 *
 * `rhythmScore` is the number that matters: it is the share of bars whose notes
 * add up to the bar. A scan that reads at 0.3 has two thirds of its bars wrong
 * somewhere, and marking a take against it will disagree with the player in
 * places where the player was right. Better to say so on the card than to be
 * argued with later.
 */
export function sayQuality({ quality, pages }) {
  const read = pages?.read ?? 0;
  const failed = pages?.failed ?? 0;
  const bars = quality?.measures ?? 0;
  const notes = quality?.notes ?? 0;
  const score = quality?.rhythmScore ?? 0;

  const parts = [`${bars} bars, ${notes} notes`];
  if (failed) parts.push(`${failed} page${failed === 1 ? '' : 's'} could not be read`);
  else if (read > 1) parts.push(`${read} pages`);

  // SAY WHAT THE NUMBER IS ABOUT.
  //
  // "only 21% of bars add up" was read as "it found 21% of the notes", which is
  // a different and much worse claim — and an easy one to make, because the
  // sentence leads with a small percentage next to a note count. It is not
  // about how much of the page was found: it is about how many bars hold the
  // beats their time signature asks for, which is what tells you whether a
  // rhythm can be trusted. So it says so, in those words, and the number of
  // bars it is talking about is given rather than a percentage on its own.
  const off = Math.round((1 - score) * bars);
  if (score >= 0.9) parts.push('every bar holds the right number of beats');
  else if (score >= 0.6) parts.push(`${off} of ${bars} bars hold the wrong number of beats — check the rhythm`);
  else parts.push(`${off} of ${bars} bars hold the wrong number of beats, so treat the rhythm as a draft`);

  return parts.join(' · ');
}
