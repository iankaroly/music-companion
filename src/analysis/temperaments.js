// Historical tuning systems for the tuner display, as cents offsets from
// equal temperament per scale degree above the chosen root. A note is "in
// tune" when it sits at ET + offset — e.g. a just major third reads pure
// when played 13.7 cents flat of equal.

const JUST = [0, 11.7, 3.9, 15.6, -13.7, -2.0, -9.8, 2.0, 13.7, -15.6, 17.6, -11.7];
const PYTHAGOREAN = [0, 13.7, 3.9, -5.9, 7.8, -2.0, 11.7, 2.0, -7.8, 5.9, -3.9, 9.8];

const TABLES = {
  equal: new Array(12).fill(0),
  just: JUST,
  pythagorean: PYTHAGOREAN,
};

export function temperamentOffsetCents(name, rootPc, midi) {
  const table = TABLES[name] ?? TABLES.equal;
  return table[(((midi - rootPc) % 12) + 12) % 12];
}
