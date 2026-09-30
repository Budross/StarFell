/**
 * wattmeter-widget.js
 * -----------------------------------------------------------------------
 * A dependency-free, standalone JS module that renders an analog,
 * center-zero wattmeter panel for the Habitat terminal UI: a needle
 * dial, a live net-flow readout and peak charge / peak draw figures.
 *
 * Dial scale: symmetric log ("symlog"), same idea as power-flow-widget.js.
 *   - 0 sits at 12 o'clock; draw (negative) swings left, charge right
 *   - a small linear region surrounds 0 (|value| < linThreshold)
 *   - beyond that each major tick is one decade (x10) further out
 *
 * Usage:
 *   import { WattmeterWidget } from './wattmeter-widget.js';
 *
 *   const meter = new WattmeterWidget('#app', {
 *     unit: 'U',
 *     source: () => myLiveValue,   // sync or async fn returning a number
 *   });
 *   meter.start();                 // polls `source` every second
 *   meter.push(-0.1);              // ...or push values manually
 *
 * The needle is spring-damped (slight overshoot) for an analog feel.
 * Honors prefers-reduced-motion by snapping instead of animating.
 * -----------------------------------------------------------------------
 */

const STYLE_ID = 'wmw-styles';
const SVG_NS = 'http://www.w3.org/2000/svg';
let uid = 0;

const CSS = `
.wmw-card {
  --wmw-panel: #222a26;
  --wmw-face: #121714;
  --wmw-border: #333f38;
  --wmw-rule: #2c3731;
  --wmw-amber: #e8b94a;
  --wmw-amber-dim: #8c7332;
  --wmw-green: #3f9a6a;
  --wmw-red: #ef5d5d;
  --wmw-text: #d9d5c0;
  --wmw-dim: #7d8a80;
  --wmw-mono: 'JetBrains Mono', 'IBM Plex Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace;

  position: relative;
  box-sizing: border-box;
  width: 100%;
  max-width: 440px;
  padding: 14px 20px 16px;
  background: var(--wmw-panel);
  border: 1px solid var(--wmw-border);
  border-radius: 3px;
  font-family: var(--wmw-mono);
  color: var(--wmw-text);
  box-shadow: inset 0 0 0 1px rgba(255,255,255,0.02), 0 12px 32px rgba(0,0,0,0.35);
}
.wmw-card *, .wmw-card *::before, .wmw-card *::after { box-sizing: border-box; }
/* corner screws */
.wmw-card::before, .wmw-card::after {
  content: ''; position: absolute; top: 6px; width: 3px; height: 3px;
  border-radius: 50%; background: var(--wmw-dim); opacity: 0.7;
}
.wmw-card::before { left: 7px; }
.wmw-card::after { right: 7px; }

.wmw-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 6px 0 10px; border-bottom: 1px solid var(--wmw-rule);
  font-size: 11px; letter-spacing: 0.16em; text-transform: uppercase;
}
.wmw-index { color: var(--wmw-dim); margin-right: 14px; }
.wmw-tag { color: var(--wmw-dim); font-size: 9px; letter-spacing: 0.14em; }

.wmw-dial {
  margin-top: 14px; padding: 8px; background: #0a0d0b;
  border: 1px solid var(--wmw-border); border-radius: 4px;
  box-shadow: inset 0 2px 8px rgba(0,0,0,0.85), 0 1px 0 rgba(255,255,255,0.04);
}
.wmw-glass {
  position: relative; overflow: hidden; border-radius: 12px / 16px;
  background: radial-gradient(120% 100% at 50% 40%, #182019 0%, #0e1310 70%, #070a08 100%);
  box-shadow: inset 0 0 34px rgba(0,0,0,0.9), inset 0 0 2px rgba(232,185,74,0.3);
}
.wmw-glass svg { display: block; width: 100%; height: auto; }
.wmw-glass::before { /* scanlines */
  content: ''; position: absolute; inset: 0; pointer-events: none; z-index: 2;
  background: repeating-linear-gradient(0deg, rgba(0,0,0,0.3) 0 1px, transparent 1px 3px);
}
.wmw-glass::after { /* curved-glass vignette + slow refresh band */
  content: ''; position: absolute; inset: 0; pointer-events: none; z-index: 3;
  background:
    radial-gradient(130% 110% at 50% 45%, transparent 55%, rgba(0,0,0,0.6) 100%),
    linear-gradient(180deg, transparent 0 42%, rgba(232,185,74,0.06) 50%, transparent 58% 100%);
  background-size: 100% 100%, 100% 300%;
  animation: wmw-roll 7s linear infinite;
}
@keyframes wmw-roll { from { background-position: 0 0, 0 0%; } to { background-position: 0 0, 0 100%; } }
@media (prefers-reduced-motion: reduce) { .wmw-glass::after { animation: none; } }
.wmw-scale { filter: drop-shadow(0 0 2px rgba(232,185,74,0.55)); }
.wmw-tick { stroke: var(--wmw-amber); stroke-opacity: 0.75; stroke-width: 1; }
.wmw-tick.is-minor { stroke-opacity: 0.4; }
.wmw-tick.is-major { stroke-opacity: 1; stroke-width: 1.6; }
.wmw-label { fill: var(--wmw-amber); font-size: 8px; font-family: var(--wmw-mono); text-anchor: middle; dominant-baseline: middle; }
.wmw-title { fill: var(--wmw-amber); font-size: 13px; font-weight: 700; letter-spacing: 0.32em; font-family: var(--wmw-mono); text-anchor: middle; }
.wmw-legend { fill: var(--wmw-amber); fill-opacity: 0.6; font-size: 7px; letter-spacing: 0.16em; font-family: var(--wmw-mono); text-anchor: middle; }
.wmw-needle { fill: #f6e3a8; filter: drop-shadow(0 0 3px rgba(232,185,74,0.9)); }
.wmw-ghost { fill: var(--wmw-amber); opacity: 0.22; filter: blur(0.6px); }
.wmw-screw { fill: #1a211c; stroke: var(--wmw-amber-dim); stroke-width: 1; }
.wmw-slot { stroke: var(--wmw-amber-dim); stroke-width: 1.2; }

.wmw-readout {
  display: grid; grid-template-columns: 1fr auto; gap: 16px; align-items: end;
  margin-top: 16px;
}
.wmw-small { font-size: 9px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--wmw-dim); }
.wmw-value {
  text-shadow: 0 0 10px currentColor;
  margin-top: 6px; font-size: 26px; line-height: 1; color: var(--wmw-amber);
  font-variant-numeric: tabular-nums; white-space: nowrap;
}
.wmw-value.is-negative { color: var(--wmw-red); }
.wmw-value.is-positive { color: var(--wmw-green); }
.wmw-value.is-zero { color: var(--wmw-text); }
.wmw-peaks { display: grid; grid-template-columns: auto auto; gap: 4px 12px; font-size: 10px; font-variant-numeric: tabular-nums; text-align: right; }
.wmw-peaks dt { color: var(--wmw-dim); text-align: left; letter-spacing: 0.14em; font-size: 9px; text-transform: uppercase; }
.wmw-peaks dd { margin: 0; }
.wmw-status {
  display: flex; align-items: center; gap: 8px; margin-top: 12px;
  padding-top: 10px; border-top: 1px solid var(--wmw-rule);
}
.wmw-status-dot { width: 5px; height: 5px; border-radius: 50%; background: var(--wmw-amber); }
.wmw-status.is-negative .wmw-status-dot { background: var(--wmw-red); }
.wmw-status.is-positive .wmw-status-dot { background: var(--wmw-green); }
`;

function injectStylesOnce() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

/** Metric-prefix formatting, e.g. 0.0004 -> "400 uU", 12000 -> "12 kU". */
function formatSI(value, unit, decimals) {
  if (value === 0) return `0 ${unit}`;
  const prefixes = [
    { e: 9, s: 'G' }, { e: 6, s: 'M' }, { e: 3, s: 'k' },
    { e: 0, s: '' }, { e: -3, s: 'm' }, { e: -6, s: 'u' }, { e: -9, s: 'n' },
  ];
  const abs = Math.abs(value);
  let chosen = prefixes[prefixes.length - 1];
  for (const p of prefixes) {
    if (abs >= Math.pow(10, p.e)) { chosen = p; break; }
  }
  const scaled = value / Math.pow(10, chosen.e);
  const d = decimals ?? (Math.abs(scaled) >= 100 ? 0 : Math.abs(scaled) >= 10 ? 1 : 2);
  return `${scaled.toFixed(d)} ${chosen.s}${unit}`;
}

/** Tick label with prefix only, e.g. 0.01 -> "10m", 1 -> "1". */
function formatShort(value) {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  const table = [[1e6, 'M'], [1e3, 'k'], [1, ''], [1e-3, 'm'], [1e-6, 'u']];
  for (const [f, s] of table) {
    if (abs >= f * 0.999) return `${sign}${+(abs / f).toPrecision(3)}${s}`;
  }
  return `${sign}${abs}`;
}

function svgEl(name, attrs, parent) {
  const n = document.createElementNS(SVG_NS, name);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(n);
  return n;
}

export class WattmeterWidget {
  /**
   * @param {string|HTMLElement} target - container element or CSS selector
   * @param {object} [opts]
   * @param {string} [opts.index='03'] - panel index shown in the header
   * @param {string} [opts.title='POWER METER']
   * @param {string} [opts.tag='LIVE'] - right-hand header tag
   * @param {string} [opts.label='NET FLOW']
   * @param {string} [opts.unit='U'] - unit suffix shown after SI prefixes
   * @param {string} [opts.rate='/sec'] - suffix for readouts, e.g. "/sec"
   * @param {string} [opts.dialTitle='WATTS'] - title inside the analog dial
   * @param {string} [opts.dialLegend] - unit legend inside the dial
   * @param {number} [opts.windowMs=300000] - history used for peak in / out
   * @param {number} [opts.pollIntervalMs=1000] - polling interval for `source`
   * @param {() => (number|Promise<number>)} [opts.source] - value provider used by start()
   * @param {number} [opts.linThreshold=0.001] - |value| below this is on the linear scale
   * @param {number} [opts.decades=4] - major decades shown on each side of 0
   * @param {number} [opts.sweep=46] - needle travel in degrees each side of 0
   * @param {boolean} [opts.animate=true] - spring-damped needle
   * @param {(v:number) => string} [opts.statusText] - status line text for a value
   */
  constructor(target, opts = {}) {
    this.container = typeof target === 'string' ? document.querySelector(target) : target;
    if (!this.container) throw new Error('WattmeterWidget: target container not found');

    this.index = opts.index ?? '03';
    this.title = opts.title ?? 'POWER METER';
    this.tag = opts.tag ?? 'LIVE';
    this.label = opts.label ?? 'NET FLOW';
    this.unit = opts.unit ?? 'U';
    this.rate = opts.rate ?? '/sec';
    this.dialTitle = opts.dialTitle ?? 'WATTS';
    this.dialLegend = opts.dialLegend ?? `DC · ${this.unit}${this.rate}`.toUpperCase();
    this.windowMs = opts.windowMs ?? 5 * 60 * 1000;
    this.pollIntervalMs = opts.pollIntervalMs ?? 1000;
    this.source = opts.source ?? null;
    this.linThreshold = opts.linThreshold ?? 0.001;
    this.decades = opts.decades ?? 4;
    this.sweep = opts.sweep ?? 46;
    this.animate = opts.animate ?? true;
    this.statusText = opts.statusText ?? ((v) =>
      v < 0 ? 'DRAWING FROM RESERVE' : v > 0 ? 'CHARGING RESERVE' : 'BUS BALANCED');

    this.data = [];
    this.currentValue = 0;
    this._angle = 0; this._ghostAngle = 0; this._vel = 0; this._targetAngle = 0;
    this._raf = 0; this._last = 0; this._timer = null;
    this._reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    injectStylesOnce();
    this._buildDom();
    this._render();
  }

  // ---- public API ---------------------------------------------------

  /** Push a new sample. Moves the needle and updates readouts. */
  push(value, t = Date.now()) {
    this.currentValue = value;
    this.data.push({ t, v: value });
    const cutoff = t - this.windowMs;
    while (this.data.length && this.data[0].t < cutoff) this.data.shift();
    this._targetAngle = this._norm(value) * this.sweep;
    this._render();
    this._kick();
  }

  setValue(value) { this.push(value, Date.now()); }

  start() {
    if (this._timer || !this.source) return;
    const poll = async () => {
      try {
        const v = await this.source();
        if (typeof v === 'number' && Number.isFinite(v)) this.push(v);
      } catch (err) {
        console.error('WattmeterWidget: source() threw', err);
      }
    };
    poll();
    this._timer = setInterval(poll, this.pollIntervalMs);
  }

  stop() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
  }

  destroy() {
    this.stop();
    cancelAnimationFrame(this._raf);
    this.container.innerHTML = '';
  }

  // ---- scale ----------------------------------------------------------

  /** Symlog-normalise a value to -1..1. */
  _norm(v) {
    const lt = this.linThreshold, n = this.decades + 1, a = Math.abs(v);
    const m = a < lt ? a / lt : 1 + Math.log10(a / lt);
    return Math.sign(v) * Math.min(m / n, 1);
  }

  // ---- DOM ------------------------------------------------------------

  _pt(deg, r) {
    const a = (deg * Math.PI) / 180;
    return [this.cx + r * Math.sin(a), this.cy - r * Math.cos(a)];
  }

  _arc(a0, a1, r) {
    const [x0, y0] = this._pt(a0, r), [x1, y1] = this._pt(a1, r);
    return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
  }

  _buildDom() {
    const id = ++uid;
    this.cx = 160; this.cy = 235;
    const card = document.createElement('div');
    card.className = 'wmw-card';
    card.innerHTML = `
      <div class="wmw-header">
        <span><span class="wmw-index">${this.index}</span>${this.title}</span>
        <span class="wmw-tag">${this.tag}</span>
      </div>
      <div class="wmw-dial"><div class="wmw-glass"></div></div>
      <div class="wmw-readout">
        <div>
          <div class="wmw-small">${this.label}</div>
          <div class="wmw-value" data-role="value"></div>
        </div>
        <dl class="wmw-peaks">
          <dt>Peak charge</dt><dd data-role="peak-in"></dd>
          <dt>Peak draw</dt><dd data-role="peak-out"></dd>
        </dl>
      </div>
      <div class="wmw-status" data-role="status">
        <span class="wmw-status-dot"></span>
        <span class="wmw-small" data-role="status-text"></span>
      </div>`;
    this.container.innerHTML = '';
    this.container.appendChild(card);
    this.els = {
      value: card.querySelector('[data-role=value]'),
      peakIn: card.querySelector('[data-role=peak-in]'),
      peakOut: card.querySelector('[data-role=peak-out]'),
      status: card.querySelector('[data-role=status]'),
      statusText: card.querySelector('[data-role=status-text]'),
    };

    const svg = svgEl('svg', { viewBox: '0 0 320 170', role: 'img', 'aria-label': `${this.title} analog meter` });
    card.querySelector('.wmw-glass').appendChild(svg);

    // Shallow arc scale; the needle pivots well below the window, like a panel meter.
    const s = this.sweep, R = 175;
    const scale = svgEl('g', { class: 'wmw-scale' }, svg);
    const band = (a0, a1, col, op) => svgEl('path', { d: this._arc(a0, a1, R + 8), fill: 'none', stroke: col, 'stroke-opacity': op, 'stroke-width': 3 }, scale);
    band(-s, -1.5, '#ef5d5d', 0.7); band(1.5, s, '#3f9a6a', 0.85); band(-1.5, 1.5, '#e8b94a', 1);
    svgEl('path', { d: this._arc(-s, s, R), fill: 'none', stroke: '#e8b94a', 'stroke-opacity': 0.6, 'stroke-width': 1 }, scale);

    const addTick = (v, cls, r1) => {
      const d = this._norm(v) * s;
      const [x1, y1] = this._pt(d, r1), [x2, y2] = this._pt(d, R);
      svgEl('line', { x1, y1, x2, y2, class: `wmw-tick ${cls}` }, scale);
    };
    const lt = this.linThreshold;
    [0.25, 0.5, 0.75].forEach((f) => [1, -1].forEach((sg) => addTick(sg * lt * f, 'is-minor', R - 7)));
    for (let k = 0; k < this.decades; k++) {
      for (let j = 2; j <= 9; j++) [1, -1].forEach((sg) => addTick(sg * lt * Math.pow(10, k) * j, 'is-minor', R - 7));
    }
    const majors = [0];
    for (let k = 0; k <= this.decades; k++) majors.push(lt * Math.pow(10, k), -lt * Math.pow(10, k));
    majors.forEach((v) => {
      addTick(v, 'is-major', R - 14);
      const [x, y] = this._pt(this._norm(v) * s, R - 24);
      const t = svgEl('text', { x, y, class: 'wmw-label', transform: `rotate(${(this._norm(v) * s).toFixed(1)} ${x} ${y})` }, scale);
      t.textContent = formatShort(Math.abs(v));
    });
    // polarity marks
    [['\u2212', -s - 3], ['+', s + 3]].forEach(([ch, d]) => {
      const [x, y] = this._pt(d * 0.93, R - 40);
      svgEl('text', { x, y, class: 'wmw-label' }, scale).textContent = ch;
    });

    const title = svgEl('text', { x: 160, y: 112, class: 'wmw-title' }, svg);
    title.textContent = this.dialTitle;
    const leg = svgEl('text', { x: 160, y: 127, class: 'wmw-legend' }, svg);
    leg.textContent = this.dialLegend;

    // zero-adjust screw
    svgEl('circle', { cx: 160, cy: 156, r: 4.5, class: 'wmw-screw' }, svg);
    svgEl('line', { x1: 157, y1: 157.5, x2: 163, y2: 154.5, class: 'wmw-slot' }, svg);

    // needle + phosphor afterimage; both pivot at (cx, cy) below the window
    const pts = (w) => `${this.cx - w},${this.cy + 8} ${this.cx + w},${this.cy + 8} ${this.cx + 0.6},${this.cy - R - 12} ${this.cx - 0.6},${this.cy - R - 12}`;
    this.ghost = svgEl('g', {}, svg);
    svgEl('polygon', { points: pts(2.2), class: 'wmw-ghost' }, this.ghost);
    this.needle = svgEl('g', {}, svg);
    svgEl('polygon', { points: pts(1.6), class: 'wmw-needle' }, this.needle);

    this._setNeedle(0);
  }

  _setNeedle(deg, ghost = deg) {
    this.needle.setAttribute('transform', `rotate(${deg.toFixed(2)} ${this.cx} ${this.cy})`);
    this.ghost.setAttribute('transform', `rotate(${ghost.toFixed(2)} ${this.cx} ${this.cy})`);
  }

  _render() {
    const v = this.currentValue;
    const state = v < 0 ? 'negative' : v > 0 ? 'positive' : 'zero';
    const val = this.els.value;
    val.textContent = `${v > 0 ? '+' : ''}${formatSI(v, this.unit)}${this.rate}`;
    val.className = `wmw-value is-${state}`;
    this.els.status.className = `wmw-status is-${state}`;
    this.els.statusText.textContent = this.statusText(v);

    let hi = 0, lo = 0;
    for (const p of this.data) { if (p.v > hi) hi = p.v; if (p.v < lo) lo = p.v; }
    this.els.peakIn.textContent = `${formatSI(hi, this.unit)}${this.rate}`;
    this.els.peakOut.textContent = `${formatSI(lo, this.unit)}${this.rate}`;
  }

  // ---- needle physics ---------------------------------------------------

  _kick() {
    if (!this.animate || this._reduced) {
      this._angle = this._ghostAngle = this._targetAngle; this._vel = 0;
      this._setNeedle(this._angle);
      return;
    }
    if (this._raf) return;
    this._last = performance.now();
    this._raf = requestAnimationFrame((t) => this._step(t));
  }

  _step(now) {
    const dt = Math.min(0.05, (now - this._last) / 1000);
    this._last = now;
    const k = 70, c = 10; // stiffness, damping (~0.6 ratio: a little overshoot)
    const acc = k * (this._targetAngle - this._angle) - c * this._vel;
    this._vel += acc * dt;
    this._angle += this._vel * dt;
    this._ghostAngle += (this._angle - this._ghostAngle) * (1 - Math.exp(-dt / 0.4)); // phosphor persistence
    this._setNeedle(this._angle, this._ghostAngle);
    if (Math.abs(this._vel) < 0.02 && Math.abs(this._targetAngle - this._angle) < 0.02 && Math.abs(this._targetAngle - this._ghostAngle) < 0.05) {
      this._angle = this._ghostAngle = this._targetAngle; this._vel = 0; this._raf = 0;
      this._setNeedle(this._angle);
      return;
    }
    this._raf = requestAnimationFrame((t) => this._step(t));
  }
}
