// The one place a take is sent anywhere.
//
// This runs on a SERVER — a Vercel function in production, a middleware in the
// dev server — for one reason: an API key in a browser bundle is a public API
// key. Nothing here is imported by the app; `src/ui/ask.js` talks to it over
// HTTP, so the client bundle keeps its zero runtime dependencies.
//
// WHAT LEAVES THE DEVICE, exactly: the text `digestTake` produced — note names,
// cents, milliseconds, and the take's name if it has one. Never the audio, and
// never a reading. That is still a change to the promise on the front of the
// README, which is why `src/ui/ask.js` will not send anything until the player
// turns this on themselves.
import Anthropic from '@anthropic-ai/sdk';

const MODEL = 'claude-opus-5';

// Medium rather than high: this is a chat panel where an answer that takes
// forty seconds is a worse answer, and every number it reasons over is already
// computed. Raise it if the questions get harder than the numbers.
const EFFORT = 'medium';

export const SYSTEM = `You are the practice partner inside a musician's recording app. You are talking to the person who played the take.

WHAT YOU CAN SEE
You are given a digest of one recording: every note the app detected, with its
onset time, its name, how many cents its sustained centre sat from equal
temperament, how many milliseconds its onset sat from the pulse, its duration,
and how long it took to settle onto its pitch after it spoke. You may also be
given a one-line index of the player's saved takes.

WHAT YOU CANNOT SEE, AND MUST SAY SO ABOUT
You are NOT listening to the audio. Nothing about tone, sound quality, bow
noise, scratch, breath, articulation, dynamics, or how something feels is
available to you — none of it is in the digest and none of it can be inferred
from pitch and timing numbers. When you are asked about any of that, say plainly
that the app measures pitch and timing and does not measure tone, and then
answer whatever part of the question the numbers CAN answer.

HOW TO ANSWER
- Every number you state must come from the digest. Never estimate, never round
  a figure into a different claim, never invent a note that is not listed.
- Cite times, so the player can find the note: "the F sharp at 7.2 s".
- The pulse is inferred from the player's own onsets unless the digest says a
  tempo was locked, so "late" means late against their own playing, not against
  a metronome. Say that when it matters.
- A note's cents figure is its sustained centre with vibrato averaged out; its
  settle time is how it arrived. They answer different questions and a note can
  be perfect in one and bad in the other. That gap is usually the interesting
  thing.
- If the digest says a section was not reported, or that its note list was
  trimmed, do not answer as though it were there.
- Be a musician talking to a musician: short, concrete, no praise sandwich, no
  bulleted lecture unless a list is genuinely the answer. Two or three sentences
  is usually right.`;

class AskError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Client construction is deferred, and the key is read at call time rather than
// at import: a dev server started before the key was exported must pick it up
// on the next request instead of needing a restart nobody will connect to the
// symptom.
function clientOrThrow() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new AskError(503, 'This build has no ANTHROPIC_API_KEY set, so nothing can be asked. Set one and restart, or turn the panel off.');
  }
  return new Anthropic();
}

const MAX_DIGEST = 400_000; // characters — a ten-minute take is ~60k

/**
 * Runs one question. `onText` is called with each chunk as it arrives.
 * Returns the full answer.
 */
export async function askAboutTake({
  question, digest = '', library = '', history = [],
}, onText = () => {}) {
  if (typeof question !== 'string' || question.trim() === '') {
    throw new AskError(400, 'There is no question in that request.');
  }
  if (digest.length + library.length > MAX_DIGEST) {
    throw new AskError(413, 'That take is too large to ask about.');
  }

  const client = clientOrThrow();

  // The digest goes in `system`, behind a cache breakpoint, because it is the
  // stable prefix of every question about the same take: the second question
  // costs a tenth of the first. The question itself is the only thing that
  // varies, which is exactly the shape prompt caching wants.
  const context = [digest, library].filter(Boolean).join('\n\n');

  let full = '';
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 8000,
    output_config: { effort: EFFORT },
    system: [
      { type: 'text', text: SYSTEM },
      { type: 'text', text: context, cache_control: { type: 'ephemeral' } },
    ],
    messages: [
      ...history
        .filter((m) => (m?.role === 'user' || m?.role === 'assistant') && typeof m.content === 'string')
        .slice(-12)
        .map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: question },
    ],
  });

  stream.on('text', (chunk) => { full += chunk; onText(chunk); });
  const message = await stream.finalMessage();
  if (message.stop_reason === 'refusal') {
    throw new AskError(422, 'That question was declined.');
  }
  return full;
}

// Reads a request body whatever shape the host handed it in: Vercel parses JSON
// for you, the dev server's middleware does not.
async function bodyOf(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new AskError(400, 'That request was not JSON.');
  }
}

// The Node handler both hosts share. Answers stream as plain text so the client
// reads them with a byte reader and no event-stream parser: the panel shows the
// words as they arrive, and there is no frame format to get wrong.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.end('POST only');
    return;
  }
  let started = false;
  try {
    const body = await bodyOf(req);
    res.statusCode = 200;
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    await askAboutTake(body, (chunk) => {
      started = true;
      res.write(chunk);
    });
    res.end();
  } catch (err) {
    const status = err instanceof AskError ? err.status
      : err instanceof Anthropic.RateLimitError ? 429
        : err instanceof Anthropic.AuthenticationError ? 401
          : err instanceof Anthropic.APIError ? (err.status ?? 502)
            : 500;
    const message = err instanceof AskError ? err.message
      : err instanceof Anthropic.RateLimitError ? 'Too many questions at once — try again in a moment.'
        : err instanceof Anthropic.AuthenticationError ? 'The key this build is using was refused.'
          : `Something went wrong asking: ${err.message}`;
    // A failure AFTER the first word has been written cannot become a status
    // code — the browser already has a 200 and half an answer. It is appended
    // to the answer instead, so the panel never shows a sentence that stops
    // mid-word with no explanation.
    if (started) {
      res.write(`\n\n[the answer stopped: ${message}]`);
      res.end();
    } else {
      res.statusCode = status;
      res.setHeader('content-type', 'text/plain; charset=utf-8');
      res.end(message);
    }
  }
}
