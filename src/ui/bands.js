// How a photographed page is laid on a screen.
//
// A page of music is roughly square; a screen is not, quite. Fitting one inside
// the other leaves a band of nothing above and below — on a phone, a third of
// the screen.
//
// The music is never rearranged to fix that. A photographed page is shown as a
// photographed page: the same systems in the same order at the same spacing,
// exactly as it looked on the stand. What changes is only which PART of the
// paper the screen is showing.
//
// Two things get it to the edges. The margins come off first, which is most of
// the problem — a phone photograph of a book is a third white paper. Then, if
// what is left is still a different shape from the glass, the page is split at
// the gaps BETWEEN systems, never through one, so a band is the top half of the
// page and the next band is the bottom half. Whatever shape is still missing is
// taken back out of the margins the crop removed, so the music reaches the
// edges instead of sitting in a white frame.
export const MAX_BANDS = 6;

// Where a page may be cut: half way down a gap between two systems. Never
// inside a system, and never where the page could not be read — an unreadable
// page is shown whole, because a blind cut through a photograph is worse than a
// margin. Each cut carries the room either side of it — the bottom of the
// system above, the top of the system below — which is how far the bands may be
// stretched afterwards without any of the music being shown twice.
function bandCuts(staves, count) {
  const gaps = [];
  for (let i = 1; i < staves.length; i++) {
    gaps.push({
      at: (staves[i - 1].bottom + staves[i].top) / 2,
      above: staves[i - 1].bottom,
      below: staves[i].top,
    });
  }
  const cuts = [];
  let start = 0;
  for (let k = 1; k < count; k++) {
    const ideal = k / count;
    let best = null;
    let nearest = Infinity;
    for (const gap of gaps) {
      if (gap.at <= start + 0.05) continue;
      const away = Math.abs(gap.at - ideal);
      if (away < nearest) { nearest = away; best = gap; }
    }
    if (best === null) break;
    cuts.push(best);
    start = best.at;
  }
  return cuts;
}

// The band, grown back into the paper until it is the shape of the screen.
//
// Sideways it may go as far as the edge of the photograph: that is white paper
// either side of the music, and taking it back is what puts the staves against
// the edges of the glass. Up and down it may take only the empty space it was
// cut out of — the rest of the gap it was split at, the margin at the head or
// the foot of the page. It stops at the next system, so no line of music is
// ever half on one screen and half on the next.
export function fillScreen(band, room, crop, size, target) {
  const edge = { x0: -crop.x / crop.w, x1: (1 - crop.x) / crop.w };
  const rect = { ...band };
  const aspect = (rect.w * crop.w * size.w) / (rect.h * crop.h * size.h);
  if (aspect < target) {
    const want = Math.min(edge.x1 - edge.x0, rect.w * (target / aspect));
    rect.x = Math.min(edge.x1 - want, Math.max(edge.x0, rect.x - (want - rect.w) / 2));
    rect.w = want;
  } else if (aspect > target) {
    const want = Math.min(Math.max(rect.h, room.y1 - room.y0), rect.h * (aspect / target));
    rect.y = Math.min(room.y1 - want, Math.max(room.y0, rect.y - (want - rect.h) / 2));
    rect.h = want;
  }
  return rect;
}

// The bands of one page: which part of the paper each screen shows.
//   staves — what the page reader found, in cropped-page terms
//   crop   — the margins already taken off, in the photograph's terms
//   size   — the photograph, in pixels
//   target — the shape of the screen, width over height
//   zoom   — the reading size, which buys more bands rather than bigger notes
export function bandsOfPage({ staves = [], crop, size, target, zoom = 1 }) {
  const out = [];
  {
    const shape = (crop.w * size.w) / (crop.h * size.h);
    const lines = staves.length;
    // As many bands as it takes for one to be the shape of the screen, and
    // never more than there are gaps to cut at. ± is honoured by splitting
    // more, never by re-cutting the music: two bands of a page are that same
    // page at twice the size.
    const wanted = Math.round((target / shape) * zoom);
    const count = lines >= 2
      ? Math.max(1, Math.min(MAX_BANDS, lines - 1, wanted))
      : 1;
    const cuts = count > 1 ? bandCuts(staves, count) : [];
    // The head of the paper, every cut, the foot of the paper.
    const head = { at: 0, above: -crop.y / crop.h, below: 0 };
    const foot = { at: 1, above: 1, below: (1 - crop.y) / crop.h };
    const edges = [head, ...cuts, foot];
    for (let i = 0; i + 1 < edges.length; i++) {
      const band = { x: 0, y: edges[i].at, w: 1, h: edges[i + 1].at - edges[i].at };
      const room = { y0: edges[i].above, y1: edges[i + 1].below };
      out.push(fillScreen(band, room, crop, size, target));
    }
  }
  return out;
}

