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
export async function omrAvailable({ timeoutMs = 1500 } = {}) {
  const url = omrUrl();
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
function filesFrom(payload, name) {
  const stem = String(name || 'score').replace(/[^\w. -]/g, '_');

  // A PDF goes as it is. It is the best input the pipeline can have — it can
  // choose its own resolution from it, retry a page bigger, and fall back page
  // by page — and re-rendering it here would only throw detail away.
  if (payload?.source === 'pdf' && payload.data) {
    return [new File([payload.data], `${stem}.pdf`, { type: 'application/pdf' })];
  }

  // Photographs go as the SQUARED-UP pages, not the originals. The app has
  // already found the sheet of paper in each photograph, pulled it flat and
  // taken the lighting off it, and that is a better page than the snapshot it
  // came from. The service combines them into one document, in this order.
  const pages = payload?.pages ?? [];
  if (pages.length) {
    return pages.map((page, i) => new File(
      [page],
      `${stem}-page-${String(i + 1).padStart(3, '0')}.${page.type === 'image/png' ? 'png' : 'jpg'}`,
      { type: page.type || 'image/jpeg' },
    ));
  }
  throw new Error('there are no pages in that score to send');
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
  const files = filesFrom(payload, name);

  const form = new FormData();
  for (const file of files) form.append('file', file);
  form.append('title', name);

  onProgress?.({ stage: files.length > 1 ? `sending ${files.length} pages` : 'sending the scan', percent: 0 });

  const started = await fetch(`${url}/v1/scores`, {
    method: 'POST', body: form, signal, headers: headers(),
  });
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
  for (;;) {
    if (signal?.aborted) throw new Error('stopped');
    const response = await fetch(`${url}/v1/jobs/${jobId}`, { signal, headers: headers() });
    if (!response.ok) throw new Error('lost contact with the service');
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

  if (score >= 0.9) parts.push('the bars add up');
  else if (score >= 0.6) parts.push(`${Math.round((1 - score) * 100)}% of bars do not add up — check the rhythm`);
  else parts.push(`only ${Math.round(score * 100)}% of bars add up, so treat the notes as a draft`);

  return parts.join(' · ');
}
