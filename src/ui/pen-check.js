// What the Apple Pencil actually does on THIS iPad.
//
// Everything else about the reader can be measured from a laptop. Four things
// cannot, and all four decide how the ink feels:
//
//   the pressure the device reports, which drives the swell of the fountain
//   nib and the darkness of the pencil;
//   the coalesced events, which are the difference between recording a stroke
//   and sampling it — iPadOS gathers a pencil at 240Hz and hands the extra
//   positions over in one move event, and reading only the event itself throws
//   three points in four away;
//   the tilt, which nothing uses yet and which decides whether it is worth
//   using;
//   and whether the webview still tries to SELECT the page under a held pen,
//   which is the thing no amount of CSS read from a Mac can settle.
//
// Installed from the home screen there is no console and no way to open one.
// So the device is asked directly and answers on its own screen, the same way
// the microphone check does — one squiggle in a box, and every number that
// matters comes back in words.

const SAMPLE_MS = 4000;

function tally(box, report) {
  const seen = {
    kinds: new Set(),
    moves: 0,
    coalesced: 0,
    coalescedMax: 0,
    pressures: [],
    tilt: false,
    tiltMax: 0,
    altitude: false,
    palms: 0,
    selected: false,
    started: 0,
  };

  const ctx = box.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const fit = () => {
    const rect = box.getBoundingClientRect();
    box.width = Math.round(rect.width * dpr);
    box.height = Math.round(rect.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = getComputedStyle(document.documentElement)
      .getPropertyValue('--primary').trim() || '#6d4ef6';
  };
  fit();

  let drawing = false;
  let last = null;

  const note = (e) => {
    seen.kinds.add(e.pointerType);
    if (Number.isFinite(e.pressure) && e.pressure > 0) seen.pressures.push(e.pressure);
    if (e.tiltX || e.tiltY) {
      seen.tilt = true;
      seen.tiltMax = Math.max(seen.tiltMax, Math.abs(e.tiltX), Math.abs(e.tiltY));
    }
    if (typeof e.altitudeAngle === 'number') seen.altitude = true;
  };

  const down = (e) => {
    if (e.pointerType === 'touch' && drawing) { seen.palms++; return; }
    drawing = true;
    seen.started++;
    note(e);
    last = { x: e.offsetX, y: e.offsetY };
    try { box.setPointerCapture(e.pointerId); } catch { /* not needed to count */ }
  };

  const move = (e) => {
    if (!drawing) return;
    if (e.pointerType === 'touch' && seen.kinds.has('pen')) { seen.palms++; return; }
    seen.moves++;
    const batch = e.getCoalescedEvents?.() ?? null;
    if (batch) {
      seen.coalesced += batch.length;
      seen.coalescedMax = Math.max(seen.coalescedMax, batch.length);
    }
    for (const one of batch?.length ? batch : [e]) {
      note(one);
      const at = { x: one.offsetX, y: one.offsetY };
      if (last) {
        // Drawn at a width from the pressure, so the answer is visible as well
        // as counted: a stroke that tapers is a device reporting pressure.
        ctx.lineWidth = Math.max(0.6, (one.pressure > 0 ? one.pressure : 0.5) * 9);
        ctx.beginPath();
        ctx.moveTo(last.x, last.y);
        ctx.lineTo(at.x, at.y);
        ctx.stroke();
      }
      last = at;
    }
  };

  const up = () => { drawing = false; last = null; };

  box.addEventListener('pointerdown', down);
  box.addEventListener('pointermove', move);
  box.addEventListener('pointerup', up);
  box.addEventListener('pointercancel', up);

  // Whether anything on the page got highlighted while the pen was down — the
  // one question a laptop cannot answer, because Chrome is not WebKit.
  const watchSelection = setInterval(() => {
    const chosen = getSelection?.();
    if (chosen && !chosen.isCollapsed) seen.selected = true;
  }, 120);

  return new Promise((resolve) => {
    setTimeout(() => {
      clearInterval(watchSelection);
      box.removeEventListener('pointerdown', down);
      box.removeEventListener('pointermove', move);
      box.removeEventListener('pointerup', up);
      box.removeEventListener('pointercancel', up);
      resolve(seen);
    }, SAMPLE_MS);
  });
}

function verdict(seen) {
  const lines = [];
  const pen = seen.kinds.has('pen');
  if (!seen.started) {
    return ['Nothing touched the box. Tap the button and draw in it within four seconds.'];
  }
  lines.push(pen
    ? 'Pencil: recognised as a pen.'
    : `No pencil seen — this was drawn with ${[...seen.kinds].join(' and ') || 'nothing'}.`
      + ' Run it again with the Apple Pencil to answer the rest.');
  if (!pen) return lines;

  const force = seen.pressures;
  if (!force.length) {
    lines.push('Pressure: NOT reported. The fountain and pencil nibs will draw at one width.');
  } else {
    const low = Math.min(...force);
    const high = Math.max(...force);
    lines.push(high - low < 0.05
      ? `Pressure: reported but flat (${high.toFixed(2)}). Nothing will taper.`
      : `Pressure: working — ${low.toFixed(2)} to ${high.toFixed(2)}.`);
  }

  const per = seen.moves ? seen.coalesced / seen.moves : 0;
  if (!seen.coalesced) {
    lines.push('Coalesced events: NOT available. Fast strokes will come out as straight'
      + ' segments with visible corners.');
  } else {
    lines.push(per > 1.15
      ? `Coalesced events: working — ${per.toFixed(1)} positions per move, up to`
        + ` ${seen.coalescedMax}. Without them ${Math.round((1 - 1 / per) * 100)}% of the`
        + ' stroke would be thrown away.'
      : `Coalesced events: available but arriving one at a time (${per.toFixed(1)} per move).`
        + ' Draw faster and run it again — at speed is when they matter.');
  }

  lines.push(seen.tilt
    ? `Tilt: reported (up to ${Math.round(seen.tiltMax)}°). Nothing uses it yet.`
    : 'Tilt: not reported.');
  if (seen.altitude) lines.push('Altitude angle: reported.');

  lines.push(seen.palms
    ? `Palm: ${seen.palms} touch events arrived while the pencil was down, and were`
      + ' turned away. That is the rejection working.'
    : 'Palm: no stray touches arrived — rest your hand on the glass and run it again'
      + ' to test the rejection.');

  lines.push(seen.selected
    ? 'SELECTION: something on the page got highlighted during that. That is the'
      + ' copy/look-up bug, and it is still here.'
    : 'Selection: nothing was highlighted. The suppression held.');

  return lines;
}

// What the reader itself has to say about strokes that did not happen. It
// counts them as they occur, so this is a record of the whole session rather
// than of the four seconds just drawn.
async function readerTrouble() {
  try {
    const { inkReport } = await import('./reader.js');
    const report = inkReport?.();
    if (!report) return [];
    const lost = report.began - report.ended;
    const lines = [`Pencil strokes this session: ${report.began} began, ${report.ended} finished`
      + `${lost > 0 ? `  ← ${lost} never finished` : ''}.`];
    if (report.total) {
      lines.push(`The reader had ${report.total} thing(s) to say about them:`);
      lines.push(...report.reasons.map((r) => `  · ${r}`));
    } else {
      lines.push('Nothing was refused and nothing was rebuilt.');
    }
    return lines;
  } catch {
    return [];
  }
}

// --- and whether anything can be heard ---------------------------------------
//
// "I cannot hear the metronome" has three or four possible causes on an iPad
// and no way at all to tell them apart from the outside: a context the system
// left suspended, an audio session pinned to the recording category (which iOS
// routes quietly), a master volume somebody set to nothing, or a click level
// at zero. So the device is asked, and then made to click.
async function initSoundCheck() {
  const button = document.querySelector('#set-sound-check');
  const report = document.querySelector('#set-sound-report');
  if (!button || !report) return;
  button.addEventListener('click', async () => {
    button.disabled = true;
    report.dataset.tone = '';
    report.textContent = 'clicking…';
    try {
      const { audioState, wakeAudio, holdAudio, releaseAudio } = await import('../audio/context.js');
      const { scheduleClick } = await import('../audio/metronome.js');
      // Held for the length of the test, so nothing puts the context back to
      // sleep underneath it.
      holdAudio('sound-check');
      const ctx = wakeAudio();
      for (let i = 0; i < 4; i++) {
        scheduleClick(ctx, ctx.currentTime + 0.12 + i * 0.28, i === 0 ? 'accent' : 'beat');
      }
      await new Promise((go) => { setTimeout(go, 1400); });
      const now = audioState();
      releaseAudio('sound-check');
      const lines = [
        `Four clicks were just played. ${now.state === 'running' ? '' : 'Probably not audibly — '}`
          + `the audio is "${now.state}".`,
        `Output route: ${now.session}${now.session === 'play-and-record'
          ? '  ← iOS plays this one QUIETLY. Something is holding the microphone.' : ''}`,
        `Volume: ${now.volume.toFixed(2)}${now.volume < 0.2 ? '  ← this is nearly off' : ''}`,
        `Click level: ${now.click.toFixed(2)}${now.click < 0.2 ? '  ← this is nearly off' : ''}`,
        `Microphone: ${now.micListening ? 'LISTENING' : (now.micParked ? 'parked (not listening)' : 'not open')}`,
        `Holding audio: ${now.holds.length ? now.holds.join(', ') : 'nothing'}`,
        `Sample rate: ${now.sampleRate || 'unknown'}`,
      ];
      report.textContent = lines.join('\n');
      report.dataset.tone = (now.state !== 'running' || now.session === 'play-and-record'
        || now.volume < 0.2 || now.click < 0.2) ? 'bad' : '';
    } catch (err) {
      report.textContent = `The check itself failed: ${err.message}`;
      report.dataset.tone = 'bad';
    }
    button.disabled = false;
  });
}

export function initPenCheck() {
  initSoundCheck();
  const button = document.querySelector('#set-pen-check');
  const report = document.querySelector('#set-pen-report');
  const box = document.querySelector('#set-pen-box');
  if (!button || !report || !box) return;

  button.addEventListener('click', async () => {
    button.disabled = true;
    box.hidden = false;
    report.dataset.tone = '';
    report.textContent = 'Draw a fast squiggle in the box — press hard, then light. Four seconds…';
    const ctx = box.getContext('2d');
    ctx.clearRect(0, 0, box.width, box.height);
    let seen;
    try {
      seen = await tally(box, report);
    } catch (err) {
      report.textContent = `The check itself failed: ${err.message}`;
      report.dataset.tone = 'bad';
      button.disabled = false;
      return;
    }
    const lines = [...verdict(seen), '', ...(await readerTrouble())];
    report.textContent = lines.join('\n');
    report.dataset.tone = lines.some((l) => /NOT|SELECTION:/.test(l)) ? 'bad' : '';
    button.disabled = false;
  });
}
