import { describe, it, expect } from 'vitest';
import { shapeFrom } from '../src/analysis/shape-snap.js';

// A hand, drawing. Nothing a person draws is smooth, and a recogniser tested
// only on clean input is a recogniser tested on input it will never see.
const wobble = (i, size = 4) => Math.sin(i * 1.7) * size + Math.cos(i * 3.1) * (size / 2);

function line(from, to, steps = 30, jitter = 4) {
  return Array.from({ length: steps + 1 }, (_, i) => ({
    x: from.x + ((to.x - from.x) * i) / steps + wobble(i, jitter),
    y: from.y + ((to.y - from.y) * i) / steps + wobble(i * 1.3, jitter),
  }));
}

function around(vertices, perSide = 14, jitter = 4) {
  const out = [];
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % vertices.length];
    out.push(...line(a, b, perSide, jitter).slice(0, -1));
  }
  out.push({ ...out[0] });
  return out;
}

function ring(rx, ry, jitter = 4, steps = 48) {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const angle = (i / steps) * Math.PI * 2;
    return {
      x: 400 + Math.cos(angle) * rx + wobble(i, jitter),
      y: 300 + Math.sin(angle) * ry + wobble(i * 1.1, jitter),
    };
  });
}

const box = (points) => ({
  left: Math.min(...points.map((p) => p.x)),
  right: Math.max(...points.map((p) => p.x)),
  top: Math.min(...points.map((p) => p.y)),
  bottom: Math.max(...points.map((p) => p.y)),
});

// How far the returned shape strays from a straight chord between its ends.
function bend(points) {
  const a = points[0];
  const b = points.at(-1);
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return Math.max(...points.map((p) => Math.abs((p.x - a.x) * (b.y - a.y) - (p.y - a.y) * (b.x - a.x)) / len));
}

// Corners: where the path turns by more than a right angle's worth of half.
// A closed shape is walked round the seam too, or the corner the trace both
// starts and ends at goes uncounted.
function turnsSharply(points) {
  const shut = Math.hypot(points.at(-1).x - points[0].x, points.at(-1).y - points[0].y) < 0.5;
  const walk = shut ? [...points.slice(0, -1), ...points.slice(0, 2)] : points;
  let sharp = 0;
  for (let i = 1; i < walk.length - 1; i++) {
    const a = walk[i - 1]; const b = walk[i]; const c = walk[i + 1];
    const one = Math.atan2(b.y - a.y, b.x - a.x);
    const two = Math.atan2(c.y - b.y, c.x - b.x);
    let turn = Math.abs(two - one);
    if (turn > Math.PI) turn = Math.PI * 2 - turn;
    if (turn > 0.9) sharp++;
  }
  return sharp;
}

describe('what a scrawl was trying to be', () => {
  it('makes a wobbly line straight', () => {
    const drawn = line({ x: 200, y: 300 }, { x: 800, y: 316 });
    const shape = shapeFrom(drawn);
    expect(shape).not.toBeNull();
    expect(bend(shape)).toBeLessThan(0.5);
    // …and it still runs between the two ends it was drawn between.
    expect(Math.hypot(shape[0].x - drawn[0].x, shape[0].y - drawn[0].y)).toBeLessThan(12);
    expect(Math.hypot(shape.at(-1).x - drawn.at(-1).x, shape.at(-1).y - drawn.at(-1).y)).toBeLessThan(12);
  });

  it('closes a rough ring into an ellipse', () => {
    const shape = shapeFrom(ring(90, 62));
    expect(shape).not.toBeNull();
    expect(turnsSharply(shape)).toBe(0);          // round, not cornered
    const b = box(shape);
    expect(b.right - b.left).toBeGreaterThan(b.bottom - b.top);   // wider than tall, as drawn
  });

  it('squares a box round a bar, and squares it up', () => {
    const shape = shapeFrom(around([
      { x: 600, y: 350 }, { x: 900, y: 344 }, { x: 905, y: 470 }, { x: 596, y: 476 },
    ]));
    expect(shape).not.toBeNull();
    expect(turnsSharply(shape)).toBe(4);
    // Every point sits on one of the four sides of an upright rectangle.
    const b = box(shape);
    for (const p of shape) {
      const onEdge = Math.min(
        Math.abs(p.x - b.left), Math.abs(p.x - b.right),
        Math.abs(p.y - b.top), Math.abs(p.y - b.bottom),
      );
      expect(onEdge).toBeLessThan(0.6);
    }
  });

  it('finds a triangle', () => {
    const shape = shapeFrom(around([
      { x: 300, y: 500 }, { x: 520, y: 496 }, { x: 410, y: 330 },
    ]));
    expect(shape).not.toBeNull();
    expect(turnsSharply(shape)).toBe(3);
  });

  it('straightens a bracket without rounding its corner', () => {
    const shape = shapeFrom([
      ...line({ x: 300, y: 200 }, { x: 300, y: 400 }, 16, 3).slice(0, -1),
      ...line({ x: 300, y: 400 }, { x: 500, y: 400 }, 16, 3),
    ]);
    expect(shape).not.toBeNull();
    expect(turnsSharply(shape)).toBe(1);
  });
});

describe('what it must leave exactly as drawn', () => {
  it('leaves a slur alone', () => {
    // A deliberate arc: snapping this to its own chord would be vandalism.
    const slur = Array.from({ length: 40 }, (_, i) => {
      const t = i / 39;
      return { x: 300 + t * 400, y: 400 - Math.sin(t * Math.PI) * 90 };
    });
    expect(shapeFrom(slur)).toBeNull();
  });

  it('leaves handwriting alone', () => {
    // "3" written as a fingering: two arcs, closing on itself, no corners.
    const scrawl = Array.from({ length: 44 }, (_, i) => {
      const t = (i / 43) * Math.PI * 3.4;
      return { x: 400 + Math.sin(t) * 26 + i * 0.4, y: 300 + i * 1.6 };
    });
    expect(shapeFrom(scrawl)).toBeNull();
  });

  it('leaves a trill squiggle alone', () => {
    // Thirty small oscillations along a straight axis: never far from its own
    // chord, and ironing it flat would delete the mark entirely.
    const trill = Array.from({ length: 120 }, (_, i) => ({
      x: 200 + i * 5,
      y: 300 + Math.sin(i * 0.9) * 7,
    }));
    expect(shapeFrom(trill)).toBeNull();
  });

  it('leaves a dot alone', () => {
    expect(shapeFrom([{ x: 10, y: 10 }, { x: 11, y: 11 }, { x: 12, y: 10 }, { x: 11, y: 9 }]))
      .toBeNull();
  });

  it('has nothing to say about two points', () => {
    expect(shapeFrom([{ x: 0, y: 0 }, { x: 90, y: 90 }])).toBeNull();
  });
});
