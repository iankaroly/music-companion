// Holds a model's reply to the facts it was given.
//
// A small language model asked "was I flatter on Friday?" will happily produce
// a number that sounds right. Instructions telling it not to do that lower the
// rate; they do not make it zero, and there is no measurement here that could
// ever tell the two apart after the fact. So the check is mechanical and does
// not ask the model for anything: every number in the reply must already be in
// a fact, or in the question. A reply that fails is thrown away and the facts
// are shown as they stand, which is always correct if a little stiff.

const NUMBER = /\d+(?:\.\d+)?/g;

export function numbersIn(text) {
  return (String(text ?? '').match(NUMBER) ?? []).map(Number);
}

function allowedFrom(texts) {
  return texts.flatMap((t) => numbersIn(t));
}

function matches(x, allowed) {
  return allowed.some((a) => Math.abs(x - a) <= 0.051 || (Number.isInteger(x) && Math.round(a) === x));
}

// -> { ok, stray: [numbers not found in any fact] }
export function checkReply(reply, facts, question = '') {
  const text = String(reply ?? '').trim();
  if (text.length === 0) return { ok: false, stray: [], reason: 'empty' };
  if (text.length > 1200) return { ok: false, stray: [], reason: 'too long' };

  const allowed = allowedFrom([...facts, question]);
  const stray = numbersIn(text).filter((x) => !matches(x, allowed));
  return stray.length ? { ok: false, stray, reason: 'numbers not in the measurements' } : { ok: true, stray: [] };
}
