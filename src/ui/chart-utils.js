// Hit-testing and status tiers shared by the chart and the note boxes.

// The note whose span contains `time`, or the nearest one within
// `tolerance` seconds of a span edge (clicks in the tiny gaps between
// fast notes should still land).
export function findNoteAt(notes, time, tolerance = 0.15) {
  let best = null;
  let bestDistance = Infinity;
  for (const note of notes) {
    const distance = time < note.start ? note.start - time
      : time > note.end ? time - note.end
      : 0;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = note;
    }
  }
  return bestDistance <= tolerance ? best : null;
}

// good: in tune (<8¢) · off: audibly off (8–25¢) · bad: badly off (≥25¢)
export function intonationStatus(cents) {
  const c = Math.abs(cents);
  if (c < 8) return 'good';
  if (c < 25) return 'off';
  return 'bad';
}
