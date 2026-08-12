// Moving the corners of a page by hand.
//
// The scanner finds the sheet of paper itself and is usually right; when it is
// not, the fix is the one every scanner app has — four dots on the corners and
// four on the edges, dragged until the outline sits on the paper. This is the
// arithmetic behind that, kept away from the pointer handling so it can be
// reasoned about and tested on its own.
//
// A quad is four [x, y] pairs in the picture's own 0–1 terms, in the order the
// page finder gives them: top-left, top-right, bottom-right, bottom-left.

const clamp01 = (n) => Math.min(1, Math.max(0, n));

export const CORNERS = 4;

// The midpoint of each edge, which is where the handle for dragging a whole
// edge lives. Edge i runs from corner i to corner i + 1.
export function edgeMidpoints(quad) {
  return quad.map((point, i) => {
    const next = quad[(i + 1) % CORNERS];
    return [(point[0] + next[0]) / 2, (point[1] + next[1]) / 2];
  });
}

// Does this still describe a page, rather than a bow tie?
//
// Dragging one corner past its neighbours crosses two edges, and the transform
// that pulls the page square would map it inside out. Every turn going the same
// way is exactly the condition that rules that out.
export function isSane(quad) {
  if (!Array.isArray(quad) || quad.length !== CORNERS) return false;
  if (quad.some((p) => !Number.isFinite(p?.[0]) || !Number.isFinite(p?.[1]))) return false;
  const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
  const turns = quad.map((_, i) => cross(quad[i], quad[(i + 1) % 4], quad[(i + 2) % 4]));
  if (!(turns.every((t) => t > 0) || turns.every((t) => t < 0))) return false;
  // …and it has to enclose something worth keeping. A quad squashed to a sliver
  // is a page nobody can read.
  return area(quad) > 0.02;
}

export function area(quad) {
  let sum = 0;
  for (let i = 0; i < CORNERS; i++) {
    const [x1, y1] = quad[i];
    const [x2, y2] = quad[(i + 1) % CORNERS];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

// One corner, put somewhere else. The move is refused — the quad comes back
// unchanged — if it would turn the page inside out, so a dragging finger stops
// at the fold instead of flipping it.
export function moveCorner(quad, index, x, y) {
  const next = quad.map((p, i) => (i === index ? [clamp01(x), clamp01(y)] : [...p]));
  return isSane(next) ? next : quad;
}

// A whole edge, dragged in or out: both of its corners move together, which is
// what "pull the line in" means to the hand doing it.
export function moveEdge(quad, index, dx, dy) {
  const next = quad.map((p, i) => (i === index || i === (index + 1) % CORNERS
    ? [clamp01(p[0] + dx), clamp01(p[1] + dy)]
    : [...p]));
  return isSane(next) ? next : quad;
}

// Which handle a finger landed on: the corners first, because they sit on top
// of the edges' ends and are the smaller target of the two.
export function handleAt(quad, x, y, reach) {
  const near = (point) => Math.hypot(point[0] - x, point[1] - y) <= reach;
  const corner = quad.findIndex(near);
  if (corner !== -1) return { kind: 'corner', index: corner };
  const edge = edgeMidpoints(quad).findIndex(near);
  if (edge !== -1) return { kind: 'edge', index: edge };
  return null;
}

// The whole picture, for when the finder cropped away half the music and the
// quickest fix is to start again from the edges of the photograph.
export const WHOLE_FRAME = [[0, 0], [1, 0], [1, 1], [0, 1]];
