// The shape a scrawl was trying to be.
//
// Hold the pen still at the end of a stroke and the mark becomes the thing it
// was drawing: a straight line, a box round a bar, a ring round an accidental,
// a bracket, a triangle. It is the one gesture GoodNotes gets exactly right —
// you draw first and ask for tidiness afterwards, rather than choosing a shape
// tool before you know you want one.
//
// Everything here is screen points in, screen points out, and nothing here
// knows what a stave is. The rule it works to: a wrong guess is worse than no
// guess. A slur is a deliberate curve and a hand-drawn line is a hand-drawn
// line, so a shape is only ever returned when the ideal is a great deal closer
// to what was drawn than a hand's own wobble.

const CIRCLE_STEPS = 64;

// Straight-line distance between the ends, against the length actually walked.
function pathLength(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return total;
}

function farthestFromChord(points, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  let worst = 0;
  let at = 0;
  for (const [i, p] of points.entries()) {
    const d = Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len;
    if (d > worst) { worst = d; at = i; }
  }
  return { distance: worst, at };
}

// Ramer–Douglas–Peucker: the corners of a scrawl, without the scrawl.
function corners(points, tolerance) {
  if (points.length < 3) return [...points];
  const { distance, at } = farthestFromChord(points, points[0], points.at(-1));
  if (distance <= tolerance) return [points[0], points.at(-1)];
  return [
    ...corners(points.slice(0, at + 1), tolerance).slice(0, -1),
    ...corners(points.slice(at), tolerance),
  ];
}

// …and the same thing for a loop, which the plain version cannot do: it starts
// from the chord between the first point and the last, and on a closed shape
// those are the same point. Every corner of every box measured zero away from a
// chord of no length, so a box came back as two points and lost to the ellipse
// fitted round it. Cut the loop at the point furthest from where it started and
// it is two open paths, which RDP does understand.
function cornersOfLoop(points, tolerance) {
  const from = points[0];
  let split = 0;
  let worst = -1;
  for (const [i, p] of points.entries()) {
    const d = Math.hypot(p.x - from.x, p.y - from.y);
    if (d > worst) { worst = d; split = i; }
  }
  if (split < 1 || split >= points.length - 1) return corners(points, tolerance);
  return [
    ...corners(points.slice(0, split + 1), tolerance).slice(0, -1),
    ...corners(points.slice(split), tolerance),
  ];
}

const boxOf = (points) => ({
  left: Math.min(...points.map((p) => p.x)),
  right: Math.max(...points.map((p) => p.x)),
  top: Math.min(...points.map((p) => p.y)),
  bottom: Math.max(...points.map((p) => p.y)),
});

function traceLine(a, b) {
  const steps = 12;
  return Array.from({ length: steps + 1 }, (_, i) => ({
    x: a.x + ((b.x - a.x) * i) / steps,
    y: a.y + ((b.y - a.y) * i) / steps,
  }));
}

function tracePolygon(vertices) {
  const out = [];
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % vertices.length];
    out.push(...traceLine(a, b).slice(0, -1));
  }
  out.push({ ...vertices[0] });
  return out;
}

function traceEllipse(box) {
  const cx = (box.left + box.right) / 2;
  const cy = (box.top + box.bottom) / 2;
  const rx = (box.right - box.left) / 2;
  const ry = (box.bottom - box.top) / 2;
  return Array.from({ length: CIRCLE_STEPS + 1 }, (_, i) => {
    const angle = (i / CIRCLE_STEPS) * Math.PI * 2;
    return { x: cx + rx * Math.cos(angle), y: cy + ry * Math.sin(angle) };
  });
}

// --- how wrong is each guess, in pixels ---------------------------------------
//
// A single threshold cannot tell a box from a ring: a rectangle sits close
// enough to the ellipse round its own bounding box to slip past any tolerance
// loose enough to accept a hand-drawn circle, which is exactly what it did.
// So nothing is thresholded on its own — the candidates are FITTED and the one
// that is actually closer to what was drawn wins.

function distanceToSegment(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (!len2) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

const mean = (list) => list.reduce((a, b) => a + b, 0) / (list.length || 1);

// Mean distance from the drawn points to the outline of a polygon.
function polygonError(points, vertices, { closed = true } = {}) {
  const edges = [];
  for (let i = 0; i < vertices.length - 1; i++) edges.push([vertices[i], vertices[i + 1]]);
  if (closed && vertices.length > 2) edges.push([vertices.at(-1), vertices[0]]);
  if (!edges.length) return Infinity;
  return mean(points.map((p) => Math.min(...edges.map(([a, b]) => distanceToSegment(p, a, b)))));
}

// …and to the ellipse drawn round the bounding box, in the same currency.
function ellipseError(points, box) {
  const cx = (box.left + box.right) / 2;
  const cy = (box.top + box.bottom) / 2;
  const rx = Math.max(1, (box.right - box.left) / 2);
  const ry = Math.max(1, (box.bottom - box.top) / 2);
  const scale = (rx + ry) / 2;
  return mean(points.map((p) => Math.abs(Math.hypot((p.x - cx) / rx, (p.y - cy) / ry) - 1) * scale));
}

// The shape a run of screen points was trying to be, traced back out as screen
// points — or null, when it was not trying to be anything and should be left
// exactly as it was drawn. A wrong guess is worse than no guess.
export function shapeFrom(points) {
  if (points.length < 4) return null;
  const first = points[0];
  const last = points.at(-1);
  const walked = pathLength(points);
  const box = boxOf(points);
  const across = Math.hypot(box.right - box.left, box.bottom - box.top);
  if (walked < 24 || across < 16) return null;   // a dot or a fidget, not a shape

  const closed = Math.hypot(last.x - first.x, last.y - first.y) < Math.max(24, walked * 0.22);

  // Nothing may be snapped that is not a good deal closer to the ideal than a
  // hand's own wobble: past this, whatever was drawn was meant.
  const allowed = Math.max(5, across * 0.06);

  if (!closed) {
    // Straight, or left alone. A slur is a deliberate curve and snapping it to
    // its own chord would be vandalism, so the tolerance here is tight.
    const { distance } = farthestFromChord(points, first, last);
    if (distance < Math.max(4, walked * 0.045)) return traceLine(first, last);
    // A corner or two, drawn without lifting: a bracket, an arrow's shaft and
    // head, the zig of a page-turn mark. Two or three segments, no more —
    // beyond that it is handwriting, and handwriting fits four chords nicely
    // enough to be ruined by them. The fit has to be tight for the same reason:
    // a slur sits about a tenth of its length off a two-chord fit, and a slur
    // is a deliberate curve.
    const bones = corners(points, allowed);
    if (bones.length >= 3 && bones.length <= 4
      && polygonError(points, bones, { closed: false }) < allowed * 0.25) {
      const out = [];
      for (let i = 0; i < bones.length - 1; i++) out.push(...traceLine(bones[i], bones[i + 1]).slice(0, -1));
      out.push(bones.at(-1));
      return out;
    }
    return null;
  }

  // Closed: round, or cornered. Both are fitted and the closer one is taken.
  const loop = points.slice(0, -1);
  const round = ellipseError(loop, box);
  const bones = cornersOfLoop(points, allowed);
  const vertices = bones.slice(0, -1);   // the last point is the first again
  const cornered = vertices.length >= 3 && vertices.length <= 6
    ? polygonError(loop, vertices) : Infinity;

  // Corners have to win CLEARLY. A circle cut into six chords fits itself
  // almost as well as its own ellipse does, and a hexagon is not what anybody
  // drawing a ring round an accidental is asking for.
  if (cornered < round * 0.7 && cornered < allowed) {
    if (vertices.length === 4) {
      // Four corners drawn nearly square become the box round the bar, which is
      // what somebody drawing a box round a bar is asking for.
      const sides = vertices.map((v, i) => {
        const w = vertices[(i + 1) % 4];
        return Math.abs(w.x - v.x) > Math.abs(w.y - v.y) ? 'flat' : 'upright';
      });
      const alternating = sides[0] !== sides[1] && sides[1] !== sides[2] && sides[2] !== sides[3];
      const upright = mean(vertices.map((v, i) => {
        const w = vertices[(i + 1) % 4];
        return Math.min(Math.abs(w.x - v.x), Math.abs(w.y - v.y));
      }));
      if (alternating && upright < across * 0.08) {
        return tracePolygon([
          { x: box.left, y: box.top },
          { x: box.right, y: box.top },
          { x: box.right, y: box.bottom },
          { x: box.left, y: box.bottom },
        ]);
      }
    }
    return tracePolygon(vertices);
  }
  if (round < allowed) return traceEllipse(box);
  return null;
}
