/**
 * CircularProgress
 * ---------------------------------------------------------------------------
 * A progress indicator made of `ringCount` concentric square or circular rings,
 * each split into `segmentCount` segments — ringCount * segmentCount cells total.
 * With the defaults (10 x 10 = 100), each cell represents exactly 1% of
 * progress, filling outer ring → inner ring, segment by segment. Rings that
 * have already filled stay lit as progress advances further inward.
 *
 * No build step required — drop this file into any project and import it:
 *
 *   import { CircularProgress } from './circular-progress.js';
 *
 *   const bar = new CircularProgress('#progress-holder', {
 *     shape: 'square', // default; use 'circle' for the original arcs
 *     hueStart: 195,   // outer ring color
 *     hueEnd: 305,     // inner ring color
 *     scaleX: 1.5,     // horizontal size multiplier (1 = original size)
 *     scaleY: 0.75,    // vertical size multiplier (1 = original size)
 *     brightness: 1.2, // color brightness multiplier (1 = unchanged)
 *     saturation: 80,  // generated ring color saturation, 0-100%
 *   });
 *
 *   bar.setProgress(42);              // animates the fill to 42%
 *   bar.setProgress(80, { animate: false }); // jumps instantly, no transition
 * ---------------------------------------------------------------------------
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

// Named defaults are also available to import alongside CircularProgress.
export const scaleX = 1;
export const scaleY = 1;
export const brightness = 1;
export const saturation = 68;

export class CircularProgress {
  static defaults = {
    ringCount: 10,
    segmentCount: 10,

    // ---- COLORS ---------------------------------------------------------
    // Easiest way to customize: give one CSS color per ring, outer → inner.
    // If provided, this fully overrides the hue gradient below.
    //   ringColors: ['#2dd4bf', '#22d3ee', '#38bdf8', ...]  (needs ringCount entries)
    ringColors: null,

    // Otherwise, colors are generated as a gradient between these two hues.
    hueStart: 195,   // outer ring hue, 0-360
    hueEnd: 305,     // inner ring hue, 0-360
    saturation,     // %, generated colors only; ringColors overrides this
    lightness: 44,   // %
    brightness,     // nonnegative multiplier for all ring colors; 1 = unchanged

    // ---- geometry (SVG viewBox is fixed at 0 0 200 200) ------------------
    shape: 'square',    // 'square' or 'circle'
    size: 320,          // base rendered CSS pixel size, before scaling
    scaleX,            // horizontal size multiplier
    scaleY,            // vertical size multiplier
    outerRadius: 96,    // square radii are half-side lengths
    innerRadius: 16,
    ringGap: 0.7,        // radial gap between rings
    segmentGap: 3,        // degrees; for squares, gap / 360 of the perimeter

    // ---- appearance -------------------------------------------------------
    restOpacity: 0.16,   // opacity of not-yet-filled track segments
    glow: true,          // brief glow/pop when a segment fills in
    showPercentage: true,

    // ---- motion ------------------------------------------------------------
    stepDuration: 35,    // ms stagger between successive segments filling
    fillDuration: 260,   // ms for a single segment's own fill transition

    initialProgress: 0,
  };

  constructor(target, options = {}) {
    this.el = typeof target === 'string' ? document.querySelector(target) : target;
    if (!this.el) throw new Error('CircularProgress: target element not found');

    this.options = { ...CircularProgress.defaults, ...options };
    this._progress = 0;
    this._litCount = 0;
    this._cells = [];   // { path, ring, seg, color }
    this._anims = [];   // active Animation per cell index, for interrupting mid-flight transitions

    this._reduceMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    this._build();

    if (this.options.initialProgress) {
      this.setProgress(this.options.initialProgress, { animate: false });
    }
  }

  // ---- public API -----------------------------------------------------------

  /** Animate (or jump) the fill to `pct` (0-100). */
  setProgress(pct, { animate = true } = {}) {
    const total = this.options.ringCount * this.options.segmentCount;
    pct = Math.max(0, Math.min(100, pct));
    const target = Math.round((pct / 100) * total);
    const from = this._litCount;

    this._progress = pct;
    this._litCount = target;
    if (this._percentEl) this._percentEl.textContent = `${Math.round(pct)}%`;

    if (target === from) return;

    const rising = target > from;
    const indices = [];
    if (rising) {
      for (let i = from; i < target; i++) indices.push(i);
    } else {
      for (let i = from - 1; i >= target; i--) indices.push(i);
    }

    if (!animate || this._reduceMotion) {
      indices.forEach((i) => this._setCellState(i, rising));
      return;
    }

    indices.forEach((i, batchPos) => {
      this._animateCell(i, rising, batchPos * this.options.stepDuration);
    });
  }

  /** Current progress value, 0-100. */
  getProgress() {
    return this._progress;
  }

  /** Swap in a new set of ring colors (array, outer → inner) at any time. */
  setColors(ringColors) {
    this.options.ringColors = ringColors;
    this._cells.forEach((cell) => {
      cell.color = this._ringColor(cell.ring);
      cell.path.setAttribute('fill', cell.color);
      cell.path.style.setProperty('--phosphor', cell.color);
    });
  }

  /** Remove the rendered element and cancel any in-flight animations. */
  destroy() {
    this._anims.forEach((a) => a && a.cancel());
    this.el.innerHTML = '';
  }

  // ---- internals --------------------------------------------------------------

  _ringColor(ringIndex) {
    const { ringColors, hueStart, hueEnd, saturation, lightness, ringCount } = this.options;
    if (ringColors && ringColors[ringIndex]) return ringColors[ringIndex];
    const t = ringCount === 1 ? 0 : ringIndex / (ringCount - 1);
    const hue = hueStart + (hueEnd - hueStart) * t;
    return `hsl(${hue} ${saturation}% ${lightness}%)`;
  }

  _build() {
    const {
      shape, size, scaleX, scaleY, brightness, ringCount, segmentCount,
      outerRadius, innerRadius, ringGap, segmentGap,
      showPercentage, restOpacity,
    } = this.options;

    this.el.classList.add('circular-progress');
    if (!this.el.style.position) this.el.style.position = 'relative';
    this.el.style.display = 'inline-block';
    this.el.style.width = `${size * scaleX}px`;
    this.el.style.height = `${size * scaleY}px`;
    this.el.style.setProperty('--progress-brightness', String(brightness));

    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 200 200');
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    svg.style.overflow = 'visible';
    svg.style.display = 'block';
    this.svg = svg;
    this.el.appendChild(svg);

    const ringThickness = (outerRadius - innerRadius) / ringCount;
    const cx = 100, cy = 100;

    const toRad = (deg) => ((deg - 90) * Math.PI) / 180;
    const polar = (r, deg) => {
      const a = toRad(deg);
      return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
    };
    const wedgePath = (rOuter, rInner, a0, a1) => {
      const [x1, y1] = polar(rOuter, a0);
      const [x2, y2] = polar(rOuter, a1);
      const [x3, y3] = polar(rInner, a1);
      const [x4, y4] = polar(rInner, a0);
      return [
        `M ${x1} ${y1}`,
        `A ${rOuter} ${rOuter} 0 0 1 ${x2} ${y2}`,
        `L ${x3} ${y3}`,
        `A ${rInner} ${rInner} 0 0 0 ${x4} ${y4}`,
        'Z',
      ].join(' ');
    };

    // Parameterize by perimeter distance, starting at the top midpoint and
    // moving clockwise. A full turn covers 8 * r, with corners at 45 + 90 * k.
    // Unlike a ray/square intersection, this advances uniformly along each edge.
    const squarePoint = (r, deg) => {
      const d = (((deg / 360) * 8 + 1) % 8 + 8) % 8;
      if (d < 2) return [cx + r * (d - 1), cy - r];
      if (d < 4) return [cx + r, cy + r * (d - 3)];
      if (d < 6) return [cx + r * (5 - d), cy + r];
      return [cx - r, cy + r * (7 - d)];
    };
    const squarePath = (rOuter, rInner, a0, a1) => {
      const stops = [a0];
      // Include every crossed corner on BOTH boundaries so neither edge cuts
      // diagonally across a corner, even when one segment spans several sides.
      for (let k = Math.floor((a0 - 45) / 90) + 1; 45 + k * 90 < a1; k++) {
        stops.push(45 + k * 90);
      }
      stops.push(a1);
      const points = [
        ...stops.map((a) => squarePoint(rOuter, a)),
        ...stops.slice().reverse().map((a) => squarePoint(rInner, a)),
      ];
      return points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${x} ${y}`).join(' ') + ' Z';
    };
    const segmentPath = shape === 'square' ? squarePath : wedgePath;

    for (let ring = 0; ring < ringCount; ring++) {
      const rOuterRaw = outerRadius - ring * ringThickness;
      const rInnerRaw = rOuterRaw - ringThickness;
      const rOuter = rOuterRaw - ringGap;
      const rInner = rInnerRaw + ringGap;
      const color = this._ringColor(ring);

      for (let seg = 0; seg < segmentCount; seg++) {
        const a0 = seg * (360 / segmentCount) + segmentGap / 2;
        const a1 = (seg + 1) * (360 / segmentCount) - segmentGap / 2;

        const path = document.createElementNS(SVG_NS, 'path');
        path.setAttribute('d', segmentPath(rOuter, rInner, a0, a1));
        path.setAttribute('fill', color);
        path.setAttribute('data-lit', 'false');
        path.style.setProperty('--phosphor', color);
        path.style.transformBox = 'fill-box';
        path.style.transformOrigin = 'center';
        path.style.opacity = String(restOpacity);
        path.style.filter = `brightness(${brightness}) drop-shadow(0 0 0 transparent)`;
        svg.appendChild(path);

        this._cells.push({ path, ring, seg, color });
      }
    }

    if (showPercentage) {
      const text = document.createElementNS(SVG_NS, 'text');
      // The SVG is intentionally allowed to stretch the progress shape to its
      // scaled width and height. Counter-scale the label around its center so
      // the percentage keeps its proportions, then size it from the smaller
      // axis so it remains inside the available area.
      const labelScale = Math.min(Math.abs(scaleX), Math.abs(scaleY));
      text.setAttribute('x', '100');
      text.setAttribute('y', '100');
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('dominant-baseline', 'central');
      text.setAttribute('font-family', '-apple-system, Segoe UI, Helvetica Neue, Arial, sans-serif');
      text.setAttribute('font-size', String(13 * labelScale));
      text.setAttribute(
        'transform',
        `translate(100 100) scale(${1 / scaleX} ${1 / scaleY}) translate(-100 -100)`,
      );
      text.setAttribute('fill', 'currentColor');
      text.textContent = '0%';
      svg.appendChild(text);
      this._percentEl = text;
    }

    const glassDome = document.createElement('div');
    glassDome.className = 'crt-glass-dome';
    glassDome.setAttribute('aria-hidden', 'true');
    this.el.appendChild(glassDome);
  }

  _setCellState(index, lit) {
    const cell = this._cells[index];
    if (!cell) return;
    if (this._anims[index]) {
      this._anims[index].cancel();
      this._anims[index] = null;
    }
    cell.path.style.opacity = lit ? '1' : String(this.options.restOpacity);
    cell.path.style.filter = `brightness(${this.options.brightness}) drop-shadow(0 0 0 transparent)`;
    cell.path.style.transform = 'scale(1)';
    cell.path.setAttribute('data-lit', String(lit));
  }

  _animateCell(index, lightingUp, delay) {
    const cell = this._cells[index];
    if (!cell) return;
    if (this._anims[index]) this._anims[index].cancel();

    // Keep the settled-state phosphor rule out of the way while Web Animations
    // handles the delayed transition, then expose the final state to CSS.
    cell.path.setAttribute('data-lit', 'false');

    const filter = `brightness(${this.options.brightness}) drop-shadow(0 0 0 transparent)`;
    const rest = { opacity: this.options.restOpacity, filter, transform: 'scale(1)' };
    const litSettled = { opacity: 1, filter, transform: 'scale(1)' };
    const peak = this.options.glow
      ? { opacity: 1, filter: `brightness(${this.options.brightness * 1.6}) drop-shadow(0 0 7px ${cell.color})`, transform: 'scale(1.05)' }
      : litSettled;

    const keyframes = lightingUp
      ? [{ ...rest, offset: 0 }, { ...peak, offset: 0.4 }, { ...litSettled, offset: 1 }]
      : [{ ...litSettled, offset: 0 }, { ...peak, offset: 0.3 }, { ...rest, offset: 1 }];

    this._anims[index] = cell.path.animate(keyframes, {
      duration: this.options.fillDuration,
      delay,
      easing: 'ease-out',
      fill: 'forwards',
    });
    this._anims[index].onfinish = () => {
      cell.path.setAttribute('data-lit', String(lightingUp));
      cell.path.style.opacity = lightingUp ? '1' : String(this.options.restOpacity);
      cell.path.style.filter = filter;
      cell.path.style.transform = 'scale(1)';
      this._anims[index] = null;
    };
  }
}
