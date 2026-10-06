/**
 * card-reader.js
 * Standalone vanilla-JS widget: a front-facing dip card reader. An ID badge slides in
 * (overflowing the widget), turns flat, and slots into a horizontal slot; the LED goes
 * red -> amber -> green. Eject reverses it.
 *
 * Exports:
 *   initCardReader(container, options)            -> controller
 *   playCardAnimation(target, direction, options) -> Promise<'in' | 'out'>
 *
 * No dependencies. Styles are injected once and scoped under the `.ccr` prefix.
 * Theme colours are CSS variables (`--ccr-*`, defined on `.ccr`) and can be overridden
 * from the game stylesheet on the widget or any ancestor, e.g.
 *   .ccr { --ccr-amber: #e0b45a; }
 */

const STYLE_ID = 'ccr-styles';
const instances = new WeakMap(); // container element or controller element -> controller
const REDUCED = '(prefers-reduced-motion: reduce)';

// Geometry (px). Single source of truth for CSS and animation targets.
const G = {
  stageH: 100, // the widget itself is short; the card overflows it
  cardW: 100,
  cardH: 150,
  slotY: 34, // slot centre, px from the top of the stage
  slide: 110, // how far above its ready position the card starts (it fades in over this travel)
  perspective: 520,
  originX: 50, // perspective origin, % from left
  originY: 90, // % from top; the viewer sits below the slot so the flat-turned card shows a sliver
  protrude: 40, // how much of the card's trailing edge stays outside the slot when seated
  gap: 6, // clearance between the face plane and the card's trailing edge while turning
};
const Z_READY = G.cardH / 2 + G.gap; // card centre depth in front of the reader face
const Z_SEAT = G.protrude - G.cardH / 2; // card centre depth when seated
const CARD_TOP = G.slotY - G.cardH / 2; // negative: the card overflows above the stage
const SLOT_TOP = G.slotY - 5;
const SLOT_W = G.cardW + 20;

/** Card transform: slide (y), depth (z) and turn (deg about the horizontal axis). */
const tf = (y, z, deg) => `translate3d(0, ${y}px, ${z}px) rotateX(${deg}deg)`;
const T_OUT = tf(-G.slide, Z_READY, 0);
const T_READY = tf(0, Z_READY, 0);
const T_TURNED = tf(0, Z_READY, -90);
const T_SEATED = tf(0, Z_SEAT, -90);

const NUDGE = 5; // px of overshoot / tug at the seat point

const DEFAULTS = {
  title: 'ACCESS READER',
  index: null, // e.g. '02'. Omit to hide the number.
  tag: 'SLOT A',
  card: { label: 'HABITAT 05', id: 'ID 0005-A', svg: null },
  status: { empty: 'NO CARD', reading: 'READING', seated: 'CARD SEATED' },
  duration: 2000, // ms for a full insert (eject uses the same total)
  onComplete: null,
};

const DEFAULT_ART =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l9 9-9 9-9-9z" fill="currentColor"/></svg>';

/* ------------------------------------------------------------------ styles */

function buildCss() {
  return `
.ccr {
  --ccr-panel: #18221d;
  --ccr-panel-2: #121a16;
  --ccr-line: #2c3a32;
  --ccr-amber: #e3b95f;
  --ccr-amber-dim: #8f7a45;
  --ccr-text: #b9c7b9;
  --ccr-green: #6fe3a1;
  --ccr-red: #d4503f;
  --ccr-font: ui-monospace, "SFMono-Regular", "JetBrains Mono", Menlo, Consolas, monospace;
  position: relative; box-sizing: border-box; width: 100%;
  background: var(--ccr-panel); border: 1px solid var(--ccr-line);
  font-family: var(--ccr-font); color: var(--ccr-text);
}
.ccr[data-busy] { z-index: 1000; } /* card passes over neighbouring UI while it moves */
.ccr *, .ccr *::before, .ccr *::after { box-sizing: border-box; }
.ccr::before, .ccr::after {
  content: ""; position: absolute; top: 6px; width: 3px; height: 3px;
  border-radius: 50%; background: var(--ccr-line);
}
.ccr::before { left: 7px; } .ccr::after { right: 7px; }

.ccr-head {
  display: flex; align-items: center; gap: 12px; padding: 14px 18px 10px;
  font-size: 11px; letter-spacing: .14em; text-transform: uppercase;
}
.ccr-idx { color: var(--ccr-amber-dim); }
.ccr-title { color: var(--ccr-text); }
.ccr-tag { margin-left: auto; color: var(--ccr-amber-dim); font-size: 9px; }

.ccr-stage {
  position: relative; height: ${G.stageH}px; margin: 0 14px 14px; /* overflow stays visible */
  border: 1px solid var(--ccr-line); border-radius: 4px;
  perspective: ${G.perspective}px; perspective-origin: ${G.originX}% ${G.originY}%;
  background: var(--ccr-panel-2); box-shadow: inset 0 0 28px rgba(0,0,0,.55);
}
.ccr-scene { position: absolute; inset: 0; transform-style: preserve-3d; }
/* the reader's front panel: a flat plane at depth 0 */
.ccr-face {
  position: absolute; inset: 0; border-radius: 3px;
  background:
    repeating-linear-gradient(0deg, rgba(0,0,0,.2) 0 1px, transparent 1px 3px),
    linear-gradient(180deg, #263329 0%, #1a251e 100%);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.05);
}
.ccr-slot {
  position: absolute; left: 50%; top: ${SLOT_TOP}px; width: ${SLOT_W}px; height: 10px; margin-left: -${SLOT_W / 2}px;
  border-radius: 3px; background: #050806; border: 1px solid #3a4a40;
  box-shadow: inset 0 0 4px #000, 0 0 0 3px rgba(0,0,0,.25);
}
.ccr-panel-row {
  position: absolute; left: 14px; right: 14px; bottom: 12px;
  display: flex; align-items: center; gap: 10px;
}
.ccr-card {
  position: absolute; left: 50%; top: ${CARD_TOP}px; width: ${G.cardW}px; height: ${G.cardH}px;
  margin-left: -${G.cardW / 2}px; overflow: hidden; text-align: center;
  transform: ${T_OUT}; opacity: 0; pointer-events: none; will-change: transform, opacity;
  border: 1px solid var(--ccr-amber-dim); border-radius: 8px;
  background: linear-gradient(170deg, #2a3b30 0%, #1d2a22 100%);
  box-shadow: 0 6px 14px rgba(0,0,0,.5);
}
.ccr-card-band {
  position: relative; height: 22px;
  background: linear-gradient(180deg, #8f7a45, #6e5d34); border-bottom: 1px solid rgba(0,0,0,.35);
}
.ccr-card-hole {
  position: absolute; left: 50%; top: 8px; width: 30px; height: 7px; margin-left: -15px;
  border-radius: 4px; background: #0b110e; box-shadow: inset 0 1px 2px rgba(0,0,0,.9);
}
.ccr-card-art {
  width: 40px; height: 40px; margin: 9px auto 0; padding: 6px;
  color: var(--ccr-amber); border: 1px solid var(--ccr-amber-dim); border-radius: 3px; background: rgba(0,0,0,.28);
}
.ccr-card-art > svg, .ccr-card-art > * { width: 100%; height: 100%; display: block; }
.ccr-card-label {
  margin: 7px 8px 0; color: var(--ccr-amber); font-size: 10px; letter-spacing: .1em;
  text-transform: uppercase; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.ccr-card-id { margin-top: 4px; color: var(--ccr-amber-dim); font-size: 8px; letter-spacing: .1em; }
.ccr-card-bar {
  position: absolute; left: 14px; right: 14px; bottom: 12px; height: 18px; opacity: .75;
  background: repeating-linear-gradient(90deg, var(--ccr-amber-dim) 0 2px, transparent 2px 4px, var(--ccr-amber-dim) 4px 5px, transparent 5px 8px);
}
.ccr-led {
  width: 11px; height: 11px; flex: none; border-radius: 50%;
  background: var(--ccr-red); box-shadow: 0 0 8px 1px rgba(212,80,63,.65);
  border: 1px solid rgba(0,0,0,.5);
  transition: background-color .18s linear, box-shadow .18s linear;
}
.ccr-led[data-led="reading"] {
  background: var(--ccr-amber); box-shadow: 0 0 9px 1px rgba(227,185,95,.7);
  animation: ccr-blink .32s steps(1, end) infinite;
}
.ccr-led[data-led="ok"] {
  background: var(--ccr-green); box-shadow: 0 0 10px 2px rgba(111,227,161,.7);
}
@keyframes ccr-blink { 50% { opacity: .25; } }
.ccr-readout {
  flex: 1; padding: 4px 8px; border: 1px solid var(--ccr-line); border-radius: 2px;
  background: #0b110e; font-size: 9px; letter-spacing: .16em; text-transform: uppercase;
  color: var(--ccr-amber-dim); white-space: nowrap;
}
.ccr[data-state="in"] .ccr-readout { color: var(--ccr-green); }

@media (prefers-reduced-motion: reduce) {
  .ccr-led { transition: none; } .ccr-led[data-led="reading"] { animation: none; }
}`;
}

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = buildCss();
  document.head.appendChild(el);
}

/* ----------------------------------------------------------------- helpers */

function h(tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  return el;
}

function prefersReduced() {
  return typeof matchMedia === 'function' && matchMedia(REDUCED).matches;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Run a Web Animation, commit its end state to inline style, resolve when done. */
async function animate(el, keyframes, options, endTransform, endOpacity) {
  const anim = el.animate(keyframes, options);
  try {
    await anim.finished;
  } catch (_) {
    /* cancelled (e.g. destroy) */
  }
  if (el.isConnected) {
    el.style.transform = endTransform;
    if (endOpacity != null) el.style.opacity = endOpacity;
  }
  anim.cancel();
}


/* -------------------------------------------------------------- controller */

function setLed(ctrl, state) {
  ctrl._led.dataset.led = state; // 'off' | 'reading' | 'ok'
}

function setStatus(ctrl, key) {
  ctrl._readout.textContent = ctrl.options.status[key];
}

function applyCard(ctrl, card) {
  const c = { ...DEFAULTS.card, ...(card || {}) };
  ctrl._label.textContent = c.label || '';
  ctrl._id.textContent = c.id || '';
  ctrl._art.replaceChildren();
  if (c.svg instanceof Element) ctrl._art.appendChild(c.svg);
  else ctrl._art.innerHTML = typeof c.svg === 'string' && c.svg ? c.svg : DEFAULT_ART; // developer-supplied markup
}

function setResting(ctrl, state) {
  ctrl.state = state;
  ctrl.element.dataset.state = state;
  ctrl._cardEl.style.transform = state === 'in' ? T_SEATED : T_OUT;
  ctrl._cardEl.style.opacity = state === 'in' ? 1 : 0;
  setLed(ctrl, state === 'in' ? 'ok' : 'off');
  setStatus(ctrl, state === 'in' ? 'seated' : 'empty');
}

async function runInsert(ctrl, duration) {
  const el = ctrl._cardEl;
  const opts = (f) => ({ duration: duration * f, fill: 'forwards' });

  // 1. slide into view, facing the viewer
  await animate(
    el,
    [
      { transform: T_OUT, opacity: 0 },
      { opacity: 1, offset: 0.35 },
      { transform: T_READY, opacity: 1 },
    ],
    { ...opts(0.27), easing: 'cubic-bezier(.2,.7,.25,1)' },
    T_READY,
    1
  );
  if (ctrl._destroyed) return;
  await sleep(duration * 0.05);

  // 2. turn 90deg (leaning back) so the bottom edge points at the slot
  await animate(el, [{ transform: T_READY }, { transform: T_TURNED }], { ...opts(0.22), easing: 'cubic-bezier(.5,0,.3,1)' }, T_TURNED);
  if (ctrl._destroyed) return;
  await sleep(duration * 0.04);

  // 3. push into the slot from the front, with a small settle
  await animate(
    el,
    [
      { transform: T_TURNED, easing: 'cubic-bezier(.5,0,.8,.6)' },
      { transform: tf(0, Z_SEAT - NUDGE, -90), offset: 0.85, easing: 'ease-out' },
      { transform: T_SEATED },
    ],
    opts(0.26),
    T_SEATED
  );
  if (ctrl._destroyed) return;

  // 4. seated: brief "reading" blink, then go green
  setLed(ctrl, 'reading');
  setStatus(ctrl, 'reading');
  await sleep(duration * 0.16);
  if (ctrl._destroyed) return;

  setLed(ctrl, 'ok');
  setStatus(ctrl, 'seated');
  ctrl._led.animate([{ transform: 'scale(1.35)' }, { transform: 'scale(1)' }], { duration: 260, easing: 'ease-out' });
  ctrl.element.dataset.state = 'in';
}

async function runEject(ctrl, duration) {
  const el = ctrl._cardEl;
  const opts = (f) => ({ duration: duration * f, fill: 'forwards' });

  // power drops as soon as the card starts to leave
  setLed(ctrl, 'off');
  setStatus(ctrl, 'empty');

  // 1. pull out of the slot (small tug first)
  await animate(
    el,
    [
      { transform: T_SEATED, easing: 'ease-out' },
      { transform: tf(0, Z_SEAT - NUDGE, -90), offset: 0.15, easing: 'cubic-bezier(.2,.4,.5,1)' },
      { transform: T_TURNED },
    ],
    opts(0.26),
    T_TURNED
  );
  if (ctrl._destroyed) return;
  await sleep(duration * 0.04);

  // 2. turn back to face the viewer
  await animate(el, [{ transform: T_TURNED }, { transform: T_READY }], { ...opts(0.22), easing: 'cubic-bezier(.5,0,.3,1)' }, T_READY);
  if (ctrl._destroyed) return;
  await sleep(duration * 0.05);

  // 3. slide away
  await animate(
    el,
    [
      { transform: T_READY, opacity: 1 },
      { opacity: 1, offset: 0.6 },
      { transform: T_OUT, opacity: 0 },
    ],
    { ...opts(0.27), easing: 'cubic-bezier(.6,0,.8,.3)' },
    T_OUT,
    0
  );
  ctrl.element.dataset.state = 'out';
}

/* ------------------------------------------------------------------ public */

/**
 * Build the reader inside `container` and return its controller.
 *
 * @param {HTMLElement} container
 * @param {object}  [options]
 * @param {string}  [options.title]     Panel title.
 * @param {string}  [options.index]     Optional panel number, e.g. '02'.
 * @param {string}  [options.tag]       Right-aligned header tag.
 * @param {{label?:string, id?:string, svg?:string|Element}} [options.card]
 *        Card content. `svg` accepts an SVG string or element; defaults to a diamond glyph.
 * @param {{empty?:string, reading?:string, seated?:string}} [options.status] Readout text.
 * @param {number}  [options.duration]  Full animation length in ms.
 * @param {(state:'in'|'out')=>void} [options.onComplete]
 * @returns {{element:HTMLElement, state:'in'|'out', setCard:Function, destroy:Function}}
 */
export function initCardReader(container, options = {}) {
  if (!(container instanceof Element)) throw new TypeError('initCardReader: container must be an element');
  if (instances.has(container)) return instances.get(container);
  injectStyles();

  const opts = {
    ...DEFAULTS,
    ...options,
    card: { ...DEFAULTS.card, ...(options.card || {}) },
    status: { ...DEFAULTS.status, ...(options.status || {}) },
  };

  const root = h('section', 'ccr');
  root.setAttribute('aria-label', opts.title);

  const head = h('header', 'ccr-head');
  if (opts.index) head.appendChild(h('span', 'ccr-idx', opts.index));
  head.appendChild(h('span', 'ccr-title', opts.title));
  if (opts.tag) head.appendChild(h('span', 'ccr-tag', opts.tag));

  const stage = h('div', 'ccr-stage');
  const scene = h('div', 'ccr-scene');

  const cardEl = h('div', 'ccr-card');
  const band = h('div', 'ccr-card-band');
  band.appendChild(h('span', 'ccr-card-hole'));
  const art = h('div', 'ccr-card-art');
  const label = h('div', 'ccr-card-label');
  const id = h('div', 'ccr-card-id');
  cardEl.append(band, art, label, id, h('div', 'ccr-card-bar'));

  const face = h('div', 'ccr-face');
  const led = h('span', 'ccr-led');
  const readout = h('span', 'ccr-readout');
  const row = h('div', 'ccr-panel-row');
  row.append(led, readout);
  face.append(h('div', 'ccr-slot'), row);

  scene.append(face, cardEl);
  stage.append(scene);
  root.append(head, stage);
  container.appendChild(root);

  const ctrl = {
    element: root,
    state: 'out',
    options: opts,
    _cardEl: cardEl,
    _led: led,
    _readout: readout,
    _label: label,
    _id: id,
    _art: art,
    _queue: Promise.resolve(),
    _destroyed: false,

    /** Replace the card's content: { label, id, svg }. */
    setCard(card) {
      applyCard(ctrl, card);
    },

    /** Remove the widget and stop any running animation. */
    destroy() {
      ctrl._destroyed = true;
      cardEl.getAnimations().forEach((a) => a.cancel());
      root.remove();
      instances.delete(container);
      instances.delete(root);
    },
  };

  applyCard(ctrl, opts.card);
  setResting(ctrl, 'out');
  instances.set(container, ctrl);
  instances.set(root, ctrl);
  return ctrl;
}

/**
 * Play the insert or eject animation.
 *
 * Calls are queued, so firing insert then eject back-to-back plays them in order.
 * Requesting the state the reader is already in is a no-op.
 *
 * @param {object|HTMLElement} target     Controller from initCardReader, or its container.
 * @param {'insert'|'eject'} [direction='insert']  'reverse' is accepted as an alias for 'eject'.
 * @param {object} [options]
 * @param {number} [options.duration]     Override duration (ms) for this call.
 * @param {(state:'in'|'out')=>void} [options.onComplete]  Fires after the animation finishes.
 * @returns {Promise<'in'|'out'>} Resolves with the final state.
 */
export function playCardAnimation(target, direction = 'insert', options = {}) {
  const ctrl = target instanceof Element ? instances.get(target) : target;
  if (!ctrl || !ctrl._cardEl) {
    return Promise.reject(new Error('playCardAnimation: no card reader found for target'));
  }
  if (direction !== 'insert' && direction !== 'eject' && direction !== 'reverse') {
    return Promise.reject(new Error(`playCardAnimation: unknown direction "${direction}"`));
  }
  const wantIn = direction === 'insert';

  ctrl._queue = ctrl._queue.then(async () => {
    if (ctrl._destroyed) return ctrl.state;
    const goal = wantIn ? 'in' : 'out';
    if (ctrl.state === goal) return ctrl.state; // already there: no-op

    const duration = options.duration ?? ctrl.options.duration;
    if (prefersReduced()) {
      setResting(ctrl, goal);
    } else {
      ctrl.state = goal;
      ctrl.element.dataset.busy = '1';
      await (wantIn ? runInsert(ctrl, duration) : runEject(ctrl, duration));
    }
    delete ctrl.element.dataset.busy;
    if (ctrl._destroyed) return goal;

    ctrl.state = goal;
    ctrl.element.dataset.state = goal;
    const cb = options.onComplete ?? ctrl.options.onComplete;
    if (typeof cb === 'function') cb(goal);
    return goal;
  });

  return ctrl._queue;
}
