// Taking the lighting out of a photograph of a page.
//
// A phone photograph of paper is unevenly lit: the lamp is on one side, your
// own head is on the other, and one corner of the page goes grey-brown. Blur
// the picture until the notes disappear and what is left is exactly that
// lighting; divide the photograph by it and the page comes back as if it had
// been lit evenly.
//
// What this deliberately does NOT do is sharpen, thicken or blacken the music.
// Scanner apps push the ink to black and the paper to white, and on a page of
// music that is a lie: a pencilled fingering comes back looking like print, a
// faint slur comes back looking like a beam, an editor's grey hairpin turns
// into a black smudge. Your page is your page. The light is the only thing that
// was wrong with it, so the light is the only thing that changes.

const GAIN = 2.2;      // the most a shadow may be lifted

// The lighting, taken out of a page of RGBA pixels in place. Kept apart from
// the canvas so it can be looked at on its own: given a page with a shadow
// across it, the paper should come out one shade all over and the ink should
// come out no darker than it went in.
export function unshadow(data, w, h) {
  const count = w * h;
  const gray = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    gray[i] = data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114;
  }
  // The lighting: the picture, very blurred. The radius is a fraction of the
  // page, so it follows the shadow without following the notes.
  const radius = Math.max(8, Math.round(Math.min(w, h) / 14));
  const light = blur(gray, w, h, radius);
  // What the paper is worth where the light is best — the ninetieth percentile
  // rather than the average, because the average is paper mixed with ink and
  // would leave the whole page a shade grey.
  const sample = [];
  for (let i = 0; i < count; i += Math.max(1, Math.floor(count / 4000))) sample.push(light[i]);
  sample.sort((a, b) => a - b);
  const target = Math.max(1, sample[Math.floor(sample.length * 0.9)] ?? 200);
  for (let i = 0; i < count; i++) {
    // How much this corner of the page was in shadow, capped: past a point the
    // pixel is not shadowed paper, it is a dark photograph, and multiplying it
    // up is multiplying up the noise with it.
    const gain = Math.min(GAIN, target / Math.max(1, light[i]));
    const at = i * 4;
    data[at] = Math.min(255, data[at] * gain);
    data[at + 1] = Math.min(255, data[at + 1] * gain);
    data[at + 2] = Math.min(255, data[at + 2] * gain);
  }
  return data;
}

// A separable box blur — two passes, no per-pixel cost beyond a running sum.
function blur(src, w, h, radius) {
  const tmp = new Float32Array(w * h);
  const dst = new Float32Array(w * h);
  const span = radius * 2 + 1;
  for (let y = 0; y < h; y++) {
    let sum = 0;
    for (let x = -radius; x <= radius; x++) sum += src[y * w + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = sum / span;
      sum += src[y * w + Math.min(w - 1, x + radius + 1)] - src[y * w + Math.max(0, x - radius)];
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = -radius; y <= radius; y++) sum += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      dst[y * w + x] = sum / span;
      sum += tmp[Math.min(h - 1, y + radius + 1) * w + x] - tmp[Math.max(0, y - radius) * w + x];
    }
  }
  return dst;
}

