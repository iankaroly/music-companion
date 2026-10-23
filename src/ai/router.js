// What a player asked, turned into WHICH measurements are needed — before any
// model is involved.
//
// This is deliberately keyword rules and not a model. The model's job in this
// feature is to put finished numbers into words; picking the measurements with
// it as well would put the part that can be wrong in front of the part that
// cannot. A rule that misreads a question costs an answer about the wrong
// thing, which the player can see in the "based on" list under every reply. A
// model that misreads one costs the same and cannot be unit-tested.

const INTENTS = [
  ['compare', /compar|versus|\bvs\b|differen|better|worse|improv|last (time|take)|previous|before|since|than\b|against/],
  ['worst', /worst|hardest|struggl|trouble|problem|mistake|wrong|out of tune|which (notes|bars?)|where (am|do|did)|weak/],
  ['habits', /habit|tend|always|usually|typically|pull|lean|sharp|flat/],
  ['tone', /tone|vibrato|bright|dark|sound|quality|clear|breath|rough|dynamic|loud|soft|volume|wobbl|shak|steady (pitch|note)|arriv|land|settle|settling/],
  ['tempo', /tempo|rhythm|rush|drag|speed|fast|slow|timing|\bbeat\b|even(ly|ness)?\b|\bpulse\b/],
  ['trend', /trend|progress|over time|this week|last week|month|streak|getting better|improving/],
];

const MAX_TAKES = 4;

const norm = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

export function intentsOf(question) {
  const q = norm(question);
  const found = INTENTS.filter(([, re]) => re.test(q)).map(([name]) => name);
  return found.length ? found : ['summary'];
}

// Which takes the question is about. A take is named by what the player called
// it; with no name in the question it is the latest take, or the latest two
// when the question is a comparison.
export function takesFor(question, takes, intents) {
  const q = norm(question);
  const usable = (takes ?? [])
    .filter((t) => (t.noteStats?.length ?? 0) > 0)
    .sort((a, b) => b.date - a.date);
  if (usable.length === 0) return [];

  const named = usable.filter((t) => {
    const name = norm(t.name);
    return name.length >= 3 && q.includes(name);
  });
  if (named.length > 0) return named.slice(0, MAX_TAKES);

  // "the last two", "my last 3 takes"
  const countWords = { two: 2, three: 3, four: 4 };
  const m = q.match(/last (\d|two|three|four) (takes|recordings|tries|attempts)/);
  if (m) {
    const n = Number.isFinite(Number(m[1])) ? Number(m[1]) : countWords[m[1]];
    return usable.slice(0, Math.min(MAX_TAKES, Math.max(1, n)));
  }

  if (intents.includes('compare')) {
    // Two takes of the same piece when the latest has a name to match on —
    // comparing a Bach prelude with a scale says nothing about either.
    const latest = usable[0];
    const same = latest.name
      ? usable.filter((t) => norm(t.name) === norm(latest.name))
      : [];
    return (same.length >= 2 ? same : usable).slice(0, 2);
  }
  return usable.slice(0, 1);
}

// What has to be loaded from the stored audio before the facts can be built.
// Loading a take decodes it, so it is only done for the intents that need it.
export function needsOf(intents) {
  return {
    quality: intents.includes('tone') || intents.includes('compare'),
    rhythm: intents.includes('tempo'),
  };
}

export function plan(question, takes) {
  const intents = intentsOf(question);
  const chosen = takesFor(question, takes, intents);
  return { intents, takeIds: chosen.map((t) => t.id), needs: needsOf(intents) };
}
