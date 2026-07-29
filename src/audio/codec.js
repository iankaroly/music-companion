// Stored audio, compressed.
//
// A take was kept as raw mono Float32 at the capture rate — 10.1 MB per minute,
// so a ten-minute practice session cost 101 MB and a week of daily practice ran
// to gigabytes. Nobody would keep a library like that on a phone, and the app's
// whole premise is that you keep every take forever so the coach can read them.
//
// Opus at 32 kbps mono is 2.3 MB for that same ten minutes — about forty times
// smaller — and the audio only has to be good enough to listen back to: the
// pitch analysis is done at record time and stored separately as `readings`, so
// nothing downstream re-measures it from these samples.
//
// WebCodecs isn't everywhere, so there is a plain 16-bit PCM path underneath
// that halves the size and works in any browser. Both formats decode back to
// the Float32Array the rest of the app expects.

export const RAW = 'f32';     // what old recordings are; still readable
export const PCM16 = 'pcm16';
export const OPUS = 'opus';

const OPUS_BITRATE = 32000;
const OPUS_RATE = 48000; // the only rate the codec is defined at

export function codecSupported() {
  return typeof globalThis.AudioEncoder === 'function'
    && typeof globalThis.AudioDecoder === 'function'
    && typeof globalThis.AudioData === 'function';
}

// --- 16-bit PCM: the floor -------------------------------------------------

function toPcm16(samples) {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

function fromPcm16(buffer) {
  const src = new Int16Array(buffer);
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i++) out[i] = src[i] / 0x8000;
  return out;
}

// --- resampling: Opus only speaks 48 kHz ------------------------------------

function resample(samples, from, to) {
  if (from === to) return samples;
  const ratio = to / from;
  const out = new Float32Array(Math.round(samples.length * ratio));
  for (let i = 0; i < out.length; i++) {
    const at = i / ratio;
    const i0 = Math.floor(at);
    const frac = at - i0;
    const a = samples[i0] ?? 0;
    const b = samples[i0 + 1] ?? a;
    out[i] = a + (b - a) * frac; // linear is plenty for playback material
  }
  return out;
}

// --- Opus via WebCodecs -----------------------------------------------------
//
// Raw packets and their lengths are stored side by side rather than in a
// container: there is no container format the platform will both mux and demux
// for us here, and the decoder only needs the same config back.

const CHUNK_FRAMES = 960; // 20 ms at 48 kHz, the codec's natural frame

async function encodeOpus(samples, sampleRate) {
  const at48 = resample(samples, sampleRate, OPUS_RATE);
  const packets = [];
  const lengths = [];
  let failed = null;

  const encoder = new AudioEncoder({
    output: (chunk) => {
      const buf = new Uint8Array(chunk.byteLength);
      chunk.copyTo(buf);
      packets.push(buf);
      lengths.push(buf.length);
    },
    error: (e) => { failed = e; },
  });
  encoder.configure({
    codec: 'opus',
    sampleRate: OPUS_RATE,
    numberOfChannels: 1,
    bitrate: OPUS_BITRATE,
  });

  for (let i = 0; i < at48.length; i += CHUNK_FRAMES) {
    const frames = Math.min(CHUNK_FRAMES, at48.length - i);
    const slice = new Float32Array(CHUNK_FRAMES); // the codec wants full frames
    slice.set(at48.subarray(i, i + frames));
    encoder.encode(new AudioData({
      format: 'f32',
      sampleRate: OPUS_RATE,
      numberOfFrames: CHUNK_FRAMES,
      numberOfChannels: 1,
      timestamp: Math.round((i / OPUS_RATE) * 1e6),
      data: slice,
    }));
  }
  await encoder.flush();
  encoder.close();
  if (failed) throw failed;

  const total = lengths.reduce((a, b) => a + b, 0);
  const data = new Uint8Array(total);
  let at = 0;
  for (const p of packets) { data.set(p, at); at += p.length; }
  return {
    format: OPUS,
    data: data.buffer,
    lengths: Uint32Array.from(lengths).buffer,
    sampleRate: OPUS_RATE,
    frames: at48.length,
  };
}

async function decodeOpus(record) {
  const data = new Uint8Array(record.data);
  const lengths = new Uint32Array(record.lengths);
  const chunks = [];
  let failed = null;

  const decoder = new AudioDecoder({
    output: (audioData) => {
      const buf = new Float32Array(audioData.numberOfFrames);
      audioData.copyTo(buf, { planeIndex: 0, format: 'f32-planar' });
      chunks.push(buf);
      audioData.close();
    },
    error: (e) => { failed = e; },
  });
  decoder.configure({ codec: 'opus', sampleRate: OPUS_RATE, numberOfChannels: 1 });

  let at = 0;
  for (let i = 0; i < lengths.length; i++) {
    const len = lengths[i];
    decoder.decode(new EncodedAudioChunk({
      type: 'key', // every Opus packet stands alone
      timestamp: Math.round((i * CHUNK_FRAMES / OPUS_RATE) * 1e6),
      data: data.subarray(at, at + len),
    }));
    at += len;
  }
  await decoder.flush();
  decoder.close();
  if (failed) throw failed;

  const total = chunks.reduce((a, c) => a + c.length, 0);
  const out = new Float32Array(total);
  let cursor = 0;
  for (const c of chunks) { out.set(c, cursor); cursor += c.length; }
  return out;
}

// --- what the store calls ---------------------------------------------------

// Returns a plain object safe to hand to IndexedDB. Falls back a step at a
// time: a browser without WebCodecs, or an encoder that refuses the config,
// still gets a recording — just a larger one.
export async function encodeStoredAudio(samples, sampleRate) {
  if (codecSupported()) {
    try {
      return await encodeOpus(samples, sampleRate);
    } catch { /* fall through to PCM */ }
  }
  return {
    format: PCM16,
    data: toPcm16(samples).buffer,
    sampleRate,
    frames: samples.length,
  };
}

// Accepts anything the app has ever written, including the bare ArrayBuffer of
// Float32 that recordings saved before this existed still hold.
export async function decodeStoredAudio(stored, fallbackRate = 44100) {
  if (!stored) return { samples: new Float32Array(0), sampleRate: fallbackRate };
  if (stored instanceof ArrayBuffer) {
    return { samples: new Float32Array(stored), sampleRate: fallbackRate };
  }
  if (stored.format === OPUS) {
    try {
      return { samples: await decodeOpus(stored), sampleRate: OPUS_RATE };
    } catch {
      return { samples: new Float32Array(0), sampleRate: OPUS_RATE };
    }
  }
  if (stored.format === PCM16) {
    return { samples: fromPcm16(stored.data), sampleRate: stored.sampleRate ?? fallbackRate };
  }
  return { samples: new Float32Array(stored.data ?? []), sampleRate: stored.sampleRate ?? fallbackRate };
}

export function storedBytes(stored) {
  if (!stored) return 0;
  if (stored instanceof ArrayBuffer) return stored.byteLength;
  return (stored.data?.byteLength ?? 0) + (stored.lengths?.byteLength ?? 0);
}
