// Running an external tool safely.
//
// Every OMR engine here is a foreign process fed a file a stranger uploaded, so
// each of the ways that goes wrong is handled once, here, rather than three
// times in the adapters:
//
//   - argv only, never a shell, so a filename can never become a command
//   - a hard timeout with SIGKILL after SIGTERM, because OMR on a bad scan can
//     spin for hours instead of failing
//   - bounded output capture, because a chatty engine can print a gigabyte of
//     progress and take the server's memory with it
//   - the tail of stderr on failure, which is the only thing that makes an OMR
//     failure debuggable after the fact

import { spawn } from 'node:child_process';

const MAX_CAPTURE = 256 * 1024; // keep the last quarter-megabyte of each stream
const MAX_LINE = 300;           // one log line, however chatty the tool is


// THE LINES THAT SAY WHY.
//
// The tail of a failed run is the death rattle — "Error in export", the stack
// of the CLI that noticed. The cause is hundreds of lines above it: "Sheet
// ignored", "too low interline value", "OutOfMemory". Keeping only the tail
// cost three separate diagnoses on a real server, each one needing the machine
// opened up by hand to run the same command again.
//
// So the whole capture is sifted for the lines that carry a cause, and those
// travel with the error.
const WHY = /(sheet ignored|interline|no staff|could not|out ?of ?memory|unsupported|corrupt|Caused by|UnsatisfiedLink|Exception in|refused)/i;
const NOISE = /^\s*at [\w.$]+\(|^\s*\.\.\. \d+ more|^WARNING: /;

function why(text, limit = 10) {
  const seen = new Set();
  const lines = [];
  const asides = [];
  for (const raw of String(text).split('\n')) {
    const line = raw.trim();
    if (!line || NOISE.test(raw) || !WHY.test(line)) continue;
    // A tool that logs "interline(28,30,32)" at INFO is describing the page,
    // not complaining about it — and that line was quoted back to a player as
    // the reason their scan could not be read. Anything that is not a warning
    // goes to the back of the queue.
    if (/^INFO\b/.test(line)) {
      if (asides.length < limit) asides.push(line.length > 300 ? `${line.slice(0, 300)}…` : line);
      continue;
    }
    const key = line.slice(0, 120);
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(line.length > 300 ? `${line.slice(0, 300)}…` : line);
    if (lines.length >= limit) break;
  }
  return [...lines, ...asides].slice(0, limit);
}

export class ProcessError extends Error {
  constructor(message, details) {
    super(message);
    this.details = details;
  }
}

/**
 * @param {string} command
 * @param {string[]} args
 * @param {{timeoutMs?:number, cwd?:string, env?:object, onLog?:(line:string)=>void,
 *          signal?:AbortSignal}} [options]
 * @returns {Promise<{stdout:string, stderr:string, code:number, ms:number}>}
 */
export function run(command, args, options = {}) {
  const { timeoutMs = 10 * 60 * 1000, cwd, env, onLog, signal } = options;

  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let killedByTimeout = false;

    const collect = (stream, into) => {
      stream.setEncoding('utf8');
      stream.on('data', (chunk) => {
        if (into === 'out') stdout = tail(stdout + chunk);
        else stderr = tail(stderr + chunk);
        // Split on carriage returns as well as newlines: a download progress
        // bar redraws itself with \r and never sends a newline, so splitting on
        // \n alone hands the log one line several megabytes long.
        if (onLog) {
          for (const line of String(chunk).split(/[\r\n]+/)) {
            const trimmed = line.trim();
            if (trimmed) onLog(trimmed.length > MAX_LINE ? `${trimmed.slice(0, MAX_LINE)}…` : trimmed);
          }
        }
      });
    };
    collect(child.stdout, 'out');
    collect(child.stderr, 'err');

    const timer = setTimeout(() => {
      killedByTimeout = true;
      stop();
    }, timeoutMs);

    // STOPPING ONE THAT IS NO LONGER WANTED.
    //
    // A page is read two ways at once and the slower one is often not needed:
    // the moment the first comes back good, the other is a JVM holding two
    // cores and a gigabyte for an answer nobody will read — on a machine that
    // takes one job at a time, that is the NEXT person's scan waiting. Killed
    // the same way the timeout kills one, politely and then not.
    let dropped = false;
    function stop() {
      child.kill('SIGTERM');
      // Give it a moment to die politely; OMR engines hold big buffers.
      setTimeout(() => child.kill('SIGKILL'), 5000).unref();
    }
    const giveUp = () => {
      dropped = true;
      clearTimeout(timer);
      stop();
      reject(new ProcessError(`${command} was stopped: it was no longer needed`, {
        command, args, dropped: true, ms: Date.now() - startedAt,
      }));
    };
    if (signal) {
      if (signal.aborted) { giveUp(); return; }
      signal.addEventListener('abort', giveUp, { once: true });
    }

    child.on('error', (err) => {
      if (dropped) return;
      clearTimeout(timer);
      reject(new ProcessError(
        // ENOENT here means the command OR its working directory is missing;
        // saying only the first sends people hunting for an installed binary.
        err.code === 'ENOENT'
          ? `could not start ${command} — the command is not on PATH, or its working directory does not exist`
          : err.message,
        { command, args, cause: err.code },
      ));
    });

    child.on('close', (code) => {
      if (dropped) return;
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', giveUp);
      const ms = Date.now() - startedAt;
      if (killedByTimeout) {
        reject(new ProcessError(`${command} did not finish within ${Math.round(timeoutMs / 1000)}s`, {
          command, args, ms, why: why(`${stdout}\n${stderr}`), stderr: stderr.slice(-2000),
        }));
        return;
      }
      if (code !== 0) {
        reject(new ProcessError(`${command} exited with code ${code}`, {
          command, args, code, ms,
          // The lines that carry a cause, from ANYWHERE in the run — see `why`.
          why: why(`${stdout}\n${stderr}`),
          stderr: stderr.slice(-2000), stdout: stdout.slice(-2000),
        }));
        return;
      }
      resolve({ stdout, stderr, code, ms });
    });
  });
}

function tail(text) {
  return text.length > MAX_CAPTURE ? text.slice(text.length - MAX_CAPTURE) : text;
}

/** Is this command runnable on this machine? Used by the engine probe. */
export async function canRun(command, args = ['--version']) {
  try {
    await run(command, args, { timeoutMs: 20000 });
    return true;
  } catch (err) {
    // A tool that runs but exits non-zero for `--version` still exists.
    return err instanceof ProcessError && typeof err.details?.code === 'number';
  }
}
