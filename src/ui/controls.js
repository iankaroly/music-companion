// Custom pickers that replace native <select> elements so choosing an option
// feels like the rest of the app instead of a browser menu. Two shapes:
//   - segmented: an inline pill group, every option visible
//   - menu:      a pill button that opens a floating glass pop-over
// The native select stays in the DOM (hidden) as the source of truth; we set
// its value and dispatch 'change' so all existing wiring keeps working.

function fireChange(sel) {
  sel.dispatchEvent(new Event('change', { bubbles: true }));
}

// Keep the custom control alive across dynamic option rebuilds (presets,
// temperament roots) and hidden-toggles from report.js.
function mirror(sel, wrap, render) {
  wrap.hidden = sel.hidden;
  new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === 'attributes') wrap.hidden = sel.hidden;
      else render();
    }
  }).observe(sel, { childList: true, attributes: true, attributeFilter: ['hidden'] });
  sel.addEventListener('change', render);
  // for callers that set sel.value programmatically and can't fire 'change'
  // (a change on some selects triggers heavy work like a page reload)
  sel.addEventListener('refresh-label', render);
  sel.classList.add('native-hidden');
  sel.tabIndex = -1;
  sel.setAttribute('aria-hidden', 'true');
  sel.after(wrap);
}

export function segmented(sel, { format } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'seg';
  wrap.setAttribute('role', 'group');
  const label = sel.getAttribute('aria-label');
  if (label) wrap.setAttribute('aria-label', label);

  function render() {
    wrap.replaceChildren(...[...sel.options].map((o) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'seg-btn';
      const custom = format?.(o);
      if (custom instanceof Node) b.append(custom);
      else b.textContent = custom ?? o.textContent;
      b.title = o.textContent;
      b.setAttribute('aria-pressed', String(o.value === sel.value));
      b.classList.toggle('on', o.value === sel.value);
      b.addEventListener('click', () => {
        if (sel.value === o.value) return;
        sel.value = o.value;
        fireChange(sel);
      });
      return b;
    }));
  }
  render();
  mirror(sel, wrap, render);
}

let openPop = null;
// Shutting whatever is open, from outside.
//
// Every one of these popups is anchored to a button and lives in the body, so
// a screen that goes away while one is up leaves it hanging over whatever is
// underneath — pointing at a button that is no longer there, and closing only
// when something else is tapped. The reader says this on its way out.
export function closeAnyPop() {
  closePop();
}

function closePop() {
  if (!openPop) return;
  openPop.pop.remove();
  openPop.btn.setAttribute('aria-expanded', 'false');
  openPop = null;
}
document.addEventListener('pointerdown', (e) => {
  if (openPop && !openPop.pop.contains(e.target) && e.target !== openPop.btn) closePop();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closePop();
});
window.addEventListener('resize', closePop);

// Anchor a floating pop-over to the pill that opened it, flipping above when
// the dock is in the way. Shared by the select menus and the library's ⋯ menu.
function placePop(pop, btn) {
  const r = btn.getBoundingClientRect();
  const pw = pop.offsetWidth;
  const ph = pop.offsetHeight;
  const x = Math.min(Math.max(8, r.left + r.width / 2 - pw / 2), window.innerWidth - pw - 8);
  const below = r.bottom + 8 + ph < window.innerHeight - 90;
  pop.style.left = `${x}px`;
  pop.style.top = `${below ? r.bottom + 8 : Math.max(8, r.top - 8 - ph)}px`;
  pop.classList.add(below ? 'from-top' : 'from-bottom');
}

// A menu of toggles that stays open, so several rows can be switched on in one
// visit — picking a drone note, or stacking up notes to compare against.
// `build()` re-runs after every pick, which keeps the ticks honest without the
// caller having to track row elements.
export function toggleMenu(btn, build, { columns = false } = {}) {
  if (openPop?.btn === btn) { closePop(); return; }
  closePop();
  const pop = document.createElement('div');
  pop.className = columns ? 'pick-pop cols' : 'pick-pop';
  pop.setAttribute('role', 'menu');
  const render = () => {
    pop.replaceChildren(...build().map((item) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = item.on ? 'pick-row on' : 'pick-row';
      row.setAttribute('role', 'menuitemcheckbox');
      row.setAttribute('aria-checked', String(!!item.on));
      row.textContent = item.label;
      row.addEventListener('click', () => {
        item.onPick();
        render(); // the pop stays put; only the ticks change
      });
      return row;
    }));
  };
  render();
  document.body.append(pop);
  placePop(pop, btn);
  btn.setAttribute('aria-expanded', 'true');
  openPop = { pop, btn };
}

// A pop-over that explains a number rather than offering a choice. Same glass
// and the same anchoring as the menus, so "what does this mean" is one tap on
// the thing you're asking about instead of a paragraph nobody reads.
export function explainPop(btn, { title, body }) {
  if (openPop?.btn === btn) { closePop(); return; }
  closePop();
  const pop = document.createElement('div');
  pop.className = 'pick-pop explain';
  pop.setAttribute('role', 'dialog');
  const h = document.createElement('b');
  h.textContent = title;
  const p = document.createElement('p');
  p.textContent = body;
  pop.append(h, p);
  document.body.append(pop);
  placePop(pop, btn);
  btn.setAttribute('aria-expanded', 'true');
  openPop = { pop, btn };
}

// A one-shot action menu: rows of [{ label, hint, danger, onPick }]. Nothing is
// "selected" here, unlike the select-backed menus below.
//
// It is set as a MENU rather than as a row of pills: the system UI face, the
// label ranged left where the eye goes for it, a hairline between one choice
// and the next, and a second line of explanation where a choice deserves one.
// A menu is a list of things to do, and it should read like one.
export function actionMenu(btn, items) {
  if (openPop?.btn === btn) { closePop(); return; }
  closePop();
  const pop = document.createElement('div');
  pop.className = 'pick-pop menu';
  pop.setAttribute('role', 'menu');
  for (const item of items) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = item.danger ? 'pick-row danger' : 'pick-row';
    row.setAttribute('role', 'menuitem');
    if (item.hint) {
      const label = document.createElement('span');
      label.className = 'pick-label';
      label.textContent = item.label;
      const hint = document.createElement('span');
      hint.className = 'pick-hint';
      hint.textContent = item.hint;
      row.append(label, hint);
    } else {
      row.textContent = item.label;
    }
    row.addEventListener('click', () => {
      closePop();
      item.onPick();
    });
    pop.append(row);
  }
  document.body.append(pop);
  placePop(pop, btn);
  btn.setAttribute('aria-expanded', 'true');
  openPop = { pop, btn };
}

export function menu(sel, { format, search = false } = {}) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'pick-btn';
  btn.setAttribute('aria-haspopup', 'listbox');
  btn.setAttribute('aria-expanded', 'false');
  const label = sel.getAttribute('aria-label');
  if (label) btn.setAttribute('aria-label', label);
  const text = document.createElement('span');
  const chev = document.createElement('span');
  chev.className = 'pick-chev';
  chev.setAttribute('aria-hidden', 'true');
  btn.append(text, chev);

  function currentLabel() {
    const o = sel.options[sel.selectedIndex];
    return o ? (format?.(o) ?? o.textContent) : '…';
  }
  function render() { text.textContent = currentLabel(); }

  // A LIST LONG ENOUGH TO SCROLL GETS A SEARCH BOX.
  //
  // "When you click 'Playing from' in the Record tab, there should also be an
  // option to search in the drop-down menu of the different scores." A shelf of
  // forty pieces in a pop-over is a scroll, and the piece you want is the one
  // you already know the name of.
  //
  // Gated on the LENGTH of the list rather than on which control it is,
  // because the same function draws "same note / fifth up / fifth down" and a
  // search field in a list of three is worse than no search field at all. The
  // fixed lists in this app never cross the line.
  //
  // …EXCEPT WHERE THE CALLER ASKS FOR IT OUTRIGHT. "when you choose what score
  // to play from the playing from section, make sure there is a way to search
  // for the score inside of the dropdown" — and the shelf a player is building
  // is small on the day they look for the field and large by the time they need
  // it, so a field that appears at the eighth piece is a field they never find
  // out about. `search: true` on the score picker means always.
  const SEARCH_PAST = 8;

  function open() {
    closePop();
    const pop = document.createElement('div');
    pop.className = 'pick-pop';
    pop.setAttribute('role', 'listbox');
    const rows = [];
    for (const o of sel.options) {
      if (o.value === '' && sel.options.length > 1) continue; // placeholder rows stay out of the list
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'pick-row';
      row.setAttribute('role', 'option');
      row.textContent = format?.(o) ?? o.textContent;
      row.setAttribute('aria-selected', String(o.value === sel.value));
      row.classList.toggle('on', o.value === sel.value);
      row.addEventListener('click', () => {
        closePop();
        if (sel.value !== o.value) {
          sel.value = o.value;
          fireChange(sel);
        }
      });
      rows.push(row);
      pop.append(row);
    }
    let find = null;
    if (search || rows.length > SEARCH_PAST) {
      find = document.createElement('input');
      find.type = 'search';
      find.className = 'pick-find';
      find.placeholder = 'Search';
      find.setAttribute('aria-label', `Search ${label ?? 'the list'}`);
      find.addEventListener('input', () => {
        const needle = find.value.trim().toLowerCase();
        for (const row of rows) {
          row.hidden = !!needle && !row.textContent.toLowerCase().includes(needle);
        }
      });
      // Typing must not close the pop-over the way a press outside it does.
      find.addEventListener('click', (e) => e.stopPropagation());
      find.addEventListener('pointerdown', (e) => e.stopPropagation());
      pop.prepend(find);
    }
    document.body.append(pop);
    placePop(pop, btn);
    btn.setAttribute('aria-expanded', 'true');
    pop.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
    // NOT focused on a phone. Focusing it raises the keyboard over the list it
    // is there to filter, so the search is there to be reached for rather than
    // put in the way of somebody who was going to tap the second row.
    if (find && !window.matchMedia?.('(max-width: 700px)')?.matches) find.focus();
    openPop = { pop, btn };
  }

  btn.addEventListener('click', () => {
    if (openPop?.btn === btn) closePop();
    else open();
  });
  render();
  mirror(sel, btn, render);
}

// One glyph over a small word — lets dense options read at a glance.
function stacked(glyphOf) {
  return (o) => {
    const frag = document.createDocumentFragment();
    const g = document.createElement('span');
    g.className = 'seg-glyph';
    g.textContent = glyphOf(o);
    const w = document.createElement('small');
    w.textContent = o.textContent.replace(glyphOf(o), '').trim();
    frag.append(g, w);
    return frag;
  };
}

// Sliders are drawn from CSS rather than by the browser (see the comment on
// input[type=range] in index.html), so the filled share of the track has to be
// published as a custom property. Also runs on 'change' for the code paths that
// set .value programmatically — tap tempo and the tempo trainer.
function initRangeFill(root) {
  for (const el of root.querySelectorAll('input[type="range"]')) {
    const paint = () => {
      const min = Number(el.min || 0);
      const max = Number(el.max || 100);
      const share = max > min ? (Number(el.value) - min) / (max - min) : 0;
      el.style.setProperty('--pct', `${(share * 100).toFixed(2)}%`);
    };
    el.addEventListener('input', paint);
    el.addEventListener('change', paint);
    // Setting .value from code fires nothing and doesn't touch the attribute,
    // so those callers (tap tempo, the tempo trainer) repaint via
    // refreshRangeFill below.
    el._paintFill = paint;
    paint();
  }
}

// Called after code sets a slider's value directly.
export function refreshRangeFill(el) {
  el?._paintFill?.();
}

export function initControls(root) {
  const seg = (id, opts) => { const s = root.querySelector(id); if (s) segmented(s, opts); };
  const pick = (id, opts) => { const s = root.querySelector(id); if (s) menu(s, opts); };

  initRangeFill(root);

  seg('#drone-octave', { format: (o) => o.value });
  seg('#drone-timbre');
  pick('#transpose');
  seg('#temperament');
  pick('#temperament-root');
  pick('#preset-list');
  pick('#ref-interval');
  pick('#ref-octave');
  // `#held-least` used to be picked here, when it was a <select>. It is a
  // number field now — `menu()` reads `options[selectedIndex]`, which an
  // <input> does not have, and leaving this line in threw during startup and
  // left every other picker in the app as a raw browser widget.
  // Its options arrive from IndexedDB after this runs, and change again on
  // every upload — the observer inside menu() is what keeps the list honest.
  pick('#score-pick', { search: true });
  pick('#score-target');
  seg('#count-in', { format: (o) => o.value === '0' ? 'none' : `${o.value} bar${o.value === '1' ? '' : 's'}` });
  seg('#beats-per-bar', { format: (o) => o.value });
  seg('#subdivision', { format: stacked((o) => o.textContent.split(' ')[0]) });
  pick('#timer-mins');
  seg('#trainer-step');
  seg('#trainer-bars');
}
