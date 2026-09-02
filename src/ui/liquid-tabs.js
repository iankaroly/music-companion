// The dock owns tab switching: a glass glider pill springs under the tab
// icons, and panels slide across when a tab is picked. Navigation is by
// dock tap or arrow keys only — no swipe gestures (they collided with
// scrolling and edge-of-screen browser gestures).

const SPRING = 'transform 420ms cubic-bezier(0.3, 1.35, 0.45, 1), width 420ms cubic-bezier(0.3, 1.35, 0.45, 1)';
const SLIDE = 'transform 320ms cubic-bezier(0.25, 0.9, 0.3, 1)';

export function initLiquidTabs({ nav, panes, order, initial, onShown, onReselect }) {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const buttons = new Map(
    [...nav.querySelectorAll('.tab-btn')].map((b) => [b.dataset.tab, b]),
  );
  const glider = document.createElement('span');
  glider.id = 'glider';
  glider.setAttribute('aria-hidden', 'true');
  nav.prepend(glider);

  let current = order.includes(initial) ? initial : order[0];
  let animating = false;
  // A tap that lands mid-slide used to be thrown away, which on a touch screen
  // reads as the dock simply not working: the slide plus its backstop timer is
  // most of a second, and two taps in a row is how people use a tab bar. Hold
  // the last one asked for and run it when the current slide settles.
  let pending = null;

  const panelOf = (name) => panes.querySelector(`#tab-${name}`);
  const idx = (name) => order.indexOf(name);

  // --- glider ---------------------------------------------------------------

  function gliderRect(name) {
    const b = buttons.get(name);
    return { x: b.offsetLeft, w: b.offsetWidth };
  }

  function placeGlider(name, animate = true) {
    const { x, w } = gliderRect(name);
    glider.style.transition = animate && !reduced.matches ? SPRING : 'none';
    glider.style.transform = `translateX(${x}px)`;
    glider.style.width = `${w}px`;
  }

  // --- switching ------------------------------------------------------------

  function setActive(name) {
    // The tab being left, so a pane can hand back anything it borrowed while
    // it was showing.
    const previous = current;
    current = name;
    for (const [tab, b] of buttons) b.setAttribute('aria-selected', String(tab === name));
    for (const p of panes.querySelectorAll('.tab-panel')) {
      p.classList.toggle('active', p.id === `tab-${name}`);
    }
    onShown?.(name, previous);
  }

  function cleanupPanels(...els) {
    for (const el of els) {
      el.style.cssText = '';
      el.classList.remove('sliding');
    }
    panes.style.height = '';
    panes.classList.remove('swiping');
  }

  function show(name, { animate = true } = {}) {
    if (!order.includes(name)) return;
    if (animating) {
      // queued, not dropped — settle() picks it up
      pending = name === current ? null : name;
      return;
    }
    if (name === current) {
      placeGlider(name);
      return;
    }
    if (!animate || reduced.matches) {
      setActive(name);
      placeGlider(name, false);
      window.scrollTo({ top: 0, behavior: 'instant' });
      return;
    }
    const dir = idx(name) > idx(current) ? 1 : -1;
    slide(current, name, dir);
  }

  // Animate a full slide between two (possibly non-adjacent) tabs.
  function slide(from, to, dir) {
    // Unless the device has asked for less of that. A slide with its motion
    // taken away is not a faster slide — it is the same second of waiting on a
    // transition that will never report finishing, ended by the backstop timer.
    // The tab simply arrives instead.
    if (reduced.matches) {
      setActive(to);
      placeGlider(to, false);
      window.scrollTo({ top: 0, behavior: 'instant' });
      return;
    }
    const a = panelOf(from);
    const b = panelOf(to);
    const w = panes.clientWidth;
    animating = true;
    beginOverlay(a, b, dir, w);
    requestAnimationFrame(() => {
      a.style.transition = SLIDE;
      b.style.transition = SLIDE;
      a.style.transform = `translateX(${-dir * w}px)`;
      b.style.transform = 'translateX(0)';
      placeGlider(to);
      settle(a, b, to);
    });
  }

  // Lay both panels out side by side inside the pane box so they can move.
  function beginOverlay(a, b, dir, w) {
    const top = Math.max(0, Math.round(window.scrollY - panes.offsetTop));
    panes.classList.add('swiping');
    panes.style.height = `${Math.max(a.offsetHeight, window.innerHeight * 0.6)}px`;
    for (const el of [a, b]) {
      el.classList.add('sliding');
      el.style.position = 'absolute';
      el.style.left = '0';
      el.style.right = '0';
      el.style.display = 'block';
      el.style.transition = 'none';
    }
    a.style.top = '0';
    b.style.top = `${top}px`;
    a.style.transform = 'translateX(0)';
    b.style.transform = `translateX(${dir * w}px)`;
  }

  function settle(a, b, to) {
    let ran = false;
    const done = () => {
      if (ran) return;
      ran = true;
      b.removeEventListener('transitionend', done);
      cleanupPanels(a, b);
      setActive(to);
      placeGlider(to, false);
      window.scrollTo({ top: 0, behavior: 'instant' });
      animating = false;
      const queued = pending;
      pending = null;
      if (queued) show(queued);
    };
    b.addEventListener('transitionend', done);
    // transitionend can be swallowed if the tab is backgrounded — backstop it
    setTimeout(done, 450);
  }

  // --- dock input -----------------------------------------------------------

  // A PRESS ON THE TAB YOU ARE ALREADY ON IS NOT NOTHING.
  //
  // `show` returns early for it — rightly, there is no slide to make — and
  // `setActive` is the only thing that calls `onShown`, so a second press on
  // the tab you are standing on was heard by nobody. That is the press that
  // should take you back to the top of that tab: "if i have a recording open
  // in library, and i click the library tab at the bottom again, it should go
  // back to the main library".
  //
  // TOLD FROM THE CLICK AND NEVER FROM `show`, which is the part that matters.
  // `showTab` reaches `show` too, and main.js calls `showTab('library')` at the
  // moment it OPENS a take there — so a reselect fired from inside `show` would
  // close the take view in the same breath as opening it.
  for (const [name, b] of buttons) b.addEventListener('click', () => {
    if (name === current) onReselect?.(name);
    show(name);
  });
  nav.addEventListener('keydown', (e) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    // Step over any tab that is not currently in the dock — the Score tab is
    // hidden until there is a score, and arrowing onto a button nobody can see
    // strands the focus ring somewhere invisible.
    let at = idx(current) + step;
    while (order[at] && buttons.get(order[at])?.hidden) at += step;
    const next = order[at];
    if (next) {
      show(next);
      buttons.get(next).focus();
    }
  });

  window.addEventListener('resize', () => placeGlider(current, false));
  document.fonts?.ready.then(() => placeGlider(current, false));

  setActive(current);
  placeGlider(current, false);

  return { show, get current() { return current; } };
}
