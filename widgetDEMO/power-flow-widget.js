/**
 * power-flow-widget.js
 * -----------------------------------------------------------------------
 * A dependency-free, standalone JS module that renders a "Power Flow"
 * card: a live value readout plus a line chart of that value over the
 * last N minutes, drawn on a *symmetric-log* y-axis centered on 0.
 *
 * Why symmetric log ("symlog") instead of plain log:
 *   A normal log axis can't represent 0 or negative numbers (log(0) and
 *   log(negative) are undefined). Since "net power flow" can swing
 *   positive (producing) or negative (consuming), we need an axis that:
 *     - treats 0 as the vertical center line
 *     - uses a log scale for the magnitude on either side of 0
 *     - falls back to a small linear region right around 0, so values
 *       near zero don't fly off to +/- infinity
 *   This is the same idea as matplotlib's `symlog` scale.
 *
 * Usage:
 *   import { PowerFlowWidget } from './power-flow-widget.js';
 *
 *   const widget = new PowerFlowWidget('#app', {
 *     unit: 'U',
 *     source: () => myLiveValue,   // sync or async fn returning a number
 *   });
 *   widget.start();                // begins 1s polling of `source`
 *
 *   // ...or push values manually instead of/alongside polling:
 *   widget.push(42.5);
 *
 * No build step, no dependencies. Works as a plain <script type="module">.
 * -----------------------------------------------------------------------
 */

const STYLE_ID = 'pfw-styles';

const CSS = `
.pfw-card {
  --pfw-bg: #0a0f0d;
  --pfw-panel: #0d1613;
  --pfw-border: #1e3a2c;
  --pfw-border-soft: #16281e;
  --pfw-accent: #4ade80;
  --pfw-accent-soft: #86efac;
  --pfw-negative: #f87171;
  --pfw-text: #e7f3ec;
  --pfw-text-dim: #7c9186;
  --pfw-grid: rgba(255, 255, 255, 0.08);
  --pfw-radius: 22px;

  box-sizing: border-box;
  width: 100%;
  max-width: 640px;
  background: radial-gradient(120% 140% at 20% 0%, #0e1613 0%, var(--pfw-bg) 60%);
  border: 1px solid var(--pfw-border);
  border-radius: var(--pfw-radius);
  padding: 22px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  color: var(--pfw-text);
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.02);
}
.pfw-card * { box-sizing: border-box; }

.pfw-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.pfw-header-left { display: flex; align-items: center; gap: 14px; }

.pfw-icon {
  width: 52px; height: 52px; flex: none;
  display: flex; align-items: center; justify-content: center;
  background: linear-gradient(160deg, #10231a, #0a1712);
  border: 1px solid var(--pfw-border);
  border-radius: 14px;
}
.pfw-icon svg { width: 24px; height: 24px; filter: drop-shadow(0 0 6px rgba(74, 222, 128, 0.65)); }

.pfw-titles { display: flex; flex-direction: column; gap: 3px; }
.pfw-title { margin: 0; font-size: 26px; font-weight: 800; letter-spacing: 0.02em; line-height: 1; color: #f3faf6; }
.pfw-subtitle { margin: 0; font-size: 11px; font-weight: 600; letter-spacing: 0.18em; color: var(--pfw-text-dim); }

.pfw-dots { display: flex; align-items: center; gap: 6px; padding-top: 6px; }
.pfw-dot { width: 9px; height: 9px; border-radius: 50%; background: #1f3327; }
.pfw-dot.is-live { background: var(--pfw-accent); box-shadow: 0 0 8px 1px rgba(74, 222, 128, 0.8); animation: pfw-pulse 2s ease-in-out infinite; }

@keyframes pfw-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.45; }
}

.pfw-readout {
  margin-top: 18px;
  display: flex; align-items: center; justify-content: space-between;
  border: 1px solid var(--pfw-border);
  background: var(--pfw-panel);
  border-radius: 14px;
  padding: 16px 18px;
}
.pfw-readout-label { font-size: 12px; font-weight: 700; letter-spacing: 0.14em; color: var(--pfw-text-dim); }
.pfw-readout-value { font-size: 30px; font-weight: 800; letter-spacing: 0.01em; color: var(--pfw-accent); text-shadow: 0 0 18px rgba(74, 222, 128, 0.45); font-variant-numeric: tabular-nums; }
.pfw-readout-value.is-negative { color: var(--pfw-negative); text-shadow: 0 0 18px rgba(248, 113, 113, 0.4); }
.pfw-readout-value.is-zero { color: var(--pfw-text); text-shadow: none; }

.pfw-chart-wrap { margin-top: 18px; }
.pfw-chart-wrap svg { display: block; width: 100%; height: auto; overflow: visible; }

.pfw-axis-label { fill: var(--pfw-text-dim); font-size: 13px; font-family: inherit; }
.pfw-axis-title { fill: var(--pfw-text-dim); font-size: 12px; font-family: inherit; letter-spacing: 0.02em; }
.pfw-grid-line { stroke: var(--pfw-grid); stroke-width: 1; stroke-dasharray: 4 5; }
.pfw-zero-line { stroke: rgba(255, 255, 255, 0.14); stroke-width: 1; stroke-dasharray: none; }
.pfw-y-axis-title { fill: var(--pfw-text-dim); font-size: 12px; }
`;

function injectStylesOnce() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

const BOLT_SVG = `
  <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" fill="#4ade80" stroke="#4ade80" stroke-width="1" stroke-linejoin="round"/>
  </svg>`;

/** Metric-prefix formatting, e.g. 0.0004 -> "400 u<unit>", 12000 -> "12 k<unit>". */
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

export class PowerFlowWidget {
  /**
   * @param {string|HTMLElement} target - container element or CSS selector
   * @param {object} [opts]
   * @param {string} [opts.title='POWER FLOW']
   * @param {string} [opts.subtitle='REAL-TIME NET POWER']
   * @param {string} [opts.label='CURRENT NET FLOW']
   * @param {string} [opts.unit='U'] - unit suffix shown after SI prefixes
   * @param {number} [opts.windowMs=300000] - how much history to keep/show (5 min default)
   * @param {number} [opts.pollIntervalMs=1000] - polling interval for `source`
   * @param {() => (number|Promise<number>)} [opts.source] - value provider used by start()
   * @param {number} [opts.linThreshold=0.001] - fallback |value| linear-zone threshold,
   *        used only while there's no data yet, or when `autoScale` is false.
   * @param {number} [opts.decades=7] - fallback number of log decades on each side of 0,
   *        used only while there's no data yet, or when `autoScale` is false.
   * @param {boolean} [opts.autoScale=true] - when true (default), the y-axis range is
   *        recomputed on every render from the magnitudes actually present in the
   *        current 5-minute window, so you only see the decades you need instead of a
   *        fixed nano-to-kilo range. Set to false to use a fixed `linThreshold`/`decades`.
   * @param {number} [opts.minDecades=2] - smallest span (in decades) auto-scale will use,
   *        even if all visible values are close in magnitude.
   * @param {number} [opts.maxDecades=6] - largest span (in decades) auto-scale will use,
   *        even if visible values range very widely.
   * @param {number} [opts.paddingDecades=0.35] - extra headroom (in decades) added above
   *        the largest visible magnitude, so the line doesn't touch the top gridline.
   * @param {number} [opts.chartHeight=260] - chart plot height in px (SVG viewBox units)
   * @param {number} [opts.chartWidth=600] - chart width in SVG viewBox units
   * @param {boolean} [opts.stretchToFit=false] - stretch the chart to fill its available width and height
   */
  constructor(target, opts = {}) {
    this.container = typeof target === 'string' ? document.querySelector(target) : target;
    if (!this.container) throw new Error('PowerFlowWidget: target container not found');

    this.title = opts.title ?? 'POWER FLOW';
    this.subtitle = opts.subtitle ?? 'REAL-TIME NET POWER';
    this.label = opts.label ?? 'CURRENT NET FLOW';
    this.unit = opts.unit ?? 'U';
    this.windowMs = opts.windowMs ?? 5 * 60 * 1000;
    this.pollIntervalMs = opts.pollIntervalMs ?? 1000;
    this.source = opts.source ?? null;
    this.linThreshold = opts.linThreshold ?? 0.001;
    this.decades = opts.decades ?? 7;
    this.autoScale = opts.autoScale ?? true;
    this.minDecades = opts.minDecades ?? 2;
    this.maxDecades = opts.maxDecades ?? 6;
    this.paddingDecades = opts.paddingDecades ?? 0.35;
    this.chartHeight = opts.chartHeight ?? 260;
    this.chartWidth = opts.chartWidth ?? 600;
    this.stretchToFit = opts.stretchToFit ?? false;

    /** @type {{t:number, v:number}[]} */
    this.data = [];
    this.currentValue = 0;
    this._timer = null;

    injectStylesOnce();
    this._buildDom();
    this.render();
  }

  // ---- public API ---------------------------------------------------

  /** Push a new sample. Defaults timestamp to now. Triggers a re-render. */
  push(value, t = Date.now()) {
    this.currentValue = value;
    this.data.push({ t, v: value });
    const cutoff = t - this.windowMs;
    while (this.data.length && this.data[0].t < cutoff) this.data.shift();
    this.render();
  }

  /** Alias for push(value) with the current timestamp. */
  setValue(value) {
    this.push(value, Date.now());
  }

  /** Begin polling `source` every `pollIntervalMs`. No-op if already running or no source given. */
  start() {
    if (this._timer || !this.source) return;
    const poll = async () => {
      try {
        const v = await this.source();
        if (typeof v === 'number' && Number.isFinite(v)) this.push(v);
      } catch (err) {
        console.error('PowerFlowWidget: source() threw', err);
      }
    };
    poll();
    this._timer = setInterval(poll, this.pollIntervalMs);
  }

  /** Stop polling. Existing data / rendering is left as-is. */
  stop() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
  }

  /** Stop polling and remove all DOM created by this widget. */
  destroy() {
    this.stop();
    this.container.innerHTML = '';
  }

  // ---- internal: DOM scaffold ----------------------------------------

  _buildDom() {
    this.container.innerHTML = '';
    const card = document.createElement('div');
    card.className = 'pfw-card';
    card.innerHTML = `
      <div class="pfw-header">
        <div class="pfw-header-left">
          <div class="pfw-icon">${BOLT_SVG}</div>
          <div class="pfw-titles">
            <p class="pfw-title">${this.title}</p>
            <p class="pfw-subtitle">${this.subtitle}</p>
          </div>
        </div>
        <div class="pfw-dots">
          <span class="pfw-dot is-live"></span>
          <span class="pfw-dot"></span>
          <span class="pfw-dot"></span>
        </div>
      </div>

      <div class="pfw-readout">
        <span class="pfw-readout-label">${this.label}</span>
        <span class="pfw-readout-value" data-role="value">-</span>
      </div>

      <div class="pfw-chart-wrap" data-role="chart"></div>
    `;
    this.container.appendChild(card);

    const glassDome = document.createElement('div');
    glassDome.className = 'power-flow-glass-dome';
    glassDome.setAttribute('aria-hidden', 'true');
    this.container.appendChild(glassDome);

    this.valueEl = card.querySelector('[data-role="value"]');
    this.chartEl = card.querySelector('[data-role="chart"]');
  }

  // ---- internal: symlog scale ----------------------------------------

  /**
   * Maps a value to a y-offset within [0, plotHeight], where plotHeight/2
   * (the vertical center) always represents 0. Positive values go up,
   * negative go down, both on a log scale beyond `linThreshold`.
   */
  _valueToY(value, plotHeight, linThreshold, decades) {
    const half = plotHeight / 2;
    const step = half / decades; // px per decade
    if (Math.abs(value) <= linThreshold) {
      return half - (value / linThreshold) * step;
    }
    const sign = Math.sign(value);
    let decadesAbove = Math.log10(Math.abs(value) / linThreshold);
    if (decadesAbove > decades - 1) decadesAbove = decades - 1; // clamp to top/bottom
    return half - sign * (1 + decadesAbove) * step;
  }

  /** Grid line values for one side (positive magnitudes); mirrored for the negative side. */
  _gridValues(linThreshold, decades) {
    const values = [];
    for (let j = 1; j <= decades; j++) {
      values.push(linThreshold * Math.pow(10, j - 1));
    }
    return values;
  }

  /**
   * Decides what the y-axis should currently cover.
   *
   * With `autoScale` on (default), this looks only at the values inside the
   * visible 5-minute window and picks the smallest power-of-ten range that
   * comfortably fits them: `linThreshold` becomes 10^(the decade of the
   * smallest nonzero magnitude present), and the range extends up to just
   * above the largest magnitude present (`paddingDecades` of headroom),
   * clamped between `minDecades` and `maxDecades` decades of total span.
   * That means a quiet signal only shows 2-3 nearby decades instead of the
   * full nano-to-kilo range, so the axis stays uncluttered.
   *
   * With `autoScale` off, this just returns the fixed `linThreshold`/`decades`
   * you configured.
   */
  _computeActiveScale() {
    if (!this.autoScale) {
      return { linThreshold: this.linThreshold, decades: this.decades };
    }

    let maxAbs = 0;
    let minAbsNonZero = Infinity;
    for (const d of this.data) {
      const a = Math.abs(d.v);
      if (a > maxAbs) maxAbs = a;
      if (a > 0 && a < minAbsNonZero) minAbsNonZero = a;
    }

    if (maxAbs === 0) {
      // No non-zero data yet - fall back to a small default span.
      return { linThreshold: this.linThreshold, decades: this.minDecades };
    }
    if (!Number.isFinite(minAbsNonZero)) minAbsNonZero = maxAbs;

    const topExp = Math.ceil(Math.log10(maxAbs) + this.paddingDecades);
    let bottomExp = Math.floor(Math.log10(minAbsNonZero));

    // Include both endpoint decades: the highest grid value is
    // linThreshold * 10^(decades - 1), not linThreshold * 10^decades.
    const span = topExp - bottomExp + 1;
    if (span < this.minDecades) bottomExp = topExp - this.minDecades + 1;
    if (span > this.maxDecades) bottomExp = topExp - this.maxDecades + 1;

    return {
      linThreshold: Math.pow(10, bottomExp),
      decades: topExp - bottomExp + 1,
    };
  }

  // ---- internal: render -----------------------------------------------

  render() {
    this._renderReadout();
    this._renderChart();
  }

  _renderReadout() {
    const v = this.currentValue;
    const sign = v > 0 ? '+' : v < 0 ? '' : ''; // formatSI already includes "-" for negatives
    this.valueEl.textContent = `${sign}${formatSI(v, this.unit)}`;
    this.valueEl.classList.toggle('is-negative', v < 0);
    this.valueEl.classList.toggle('is-zero', v === 0);
  }

  _renderChart() {
    const width = this.chartWidth;
    const height = this.chartHeight;
    // Reserve enough space for signed, unit-bearing labels (e.g. -100 mU/sec).
    const marginLeft = 104;
    const marginRight = 16;
    const marginTop = 10;
    // Leave room for both time labels and the second-line "min ago" caption.
    const marginBottom = 48;
    const plotW = width - marginLeft - marginRight;
    const plotH = height - marginTop - marginBottom;

    const now = Date.now();
    const startT = now - this.windowMs;

    const { linThreshold, decades } = this._computeActiveScale();

    const xFor = (t) => marginLeft + ((t - startT) / this.windowMs) * plotW;
    const yFor = (v) => marginTop + this._valueToY(v, plotH, linThreshold, decades);

    // ---- grid lines + axis labels (mirrored around the 0 / center line)
    let gridSvg = '';
    for (const gv of this._gridValues(linThreshold, decades)) {
      const yPos = yFor(gv);
      const yNeg = yFor(-gv);
      gridSvg += `<line class="pfw-grid-line" x1="${marginLeft}" y1="${yPos}" x2="${width - marginRight}" y2="${yPos}" />`;
      gridSvg += `<text class="pfw-axis-label" x="${marginLeft - 10}" y="${yPos + 4}" text-anchor="end">${formatSI(gv, this.unit, gv >= 100 || gv < 1 ? 0 : 1)}</text>`;
      if (decades > 0 && Math.abs(yPos - yNeg) > 1) {
        gridSvg += `<line class="pfw-grid-line" x1="${marginLeft}" y1="${yNeg}" x2="${width - marginRight}" y2="${yNeg}" />`;
        gridSvg += `<text class="pfw-axis-label" x="${marginLeft - 10}" y="${yNeg + 4}" text-anchor="end">-${formatSI(gv, this.unit, gv >= 100 || gv < 1 ? 0 : 1)}</text>`;
      }
    }
    const zeroY = yFor(0);
    gridSvg += `<line class="pfw-zero-line" x1="${marginLeft}" y1="${zeroY}" x2="${width - marginRight}" y2="${zeroY}" />`;
    gridSvg += `<text class="pfw-axis-label" x="${marginLeft - 10}" y="${zeroY + 4}" text-anchor="end">0</text>`;

    // ---- x axis (time) ticks, one per minute of the window
    let xAxisSvg = '';
    const totalMinutes = Math.round(this.windowMs / 60000);
    for (let m = totalMinutes; m >= 0; m--) {
      const t = now - m * 60000;
      const x = xFor(t);
      const label = m === 0 ? 'Now' : `${m}:00`;
      xAxisSvg += `<line class="pfw-grid-line" x1="${x}" y1="${marginTop}" x2="${x}" y2="${height - marginBottom}" />`;
      xAxisSvg += `<text class="pfw-axis-label" x="${x}" y="${height - marginBottom + 20}" text-anchor="${m === totalMinutes ? 'start' : m === 0 ? 'end' : 'middle'}">${label}</text>`;
      if (m === totalMinutes) {
        xAxisSvg += `<text class="pfw-axis-label" x="${x}" y="${height - marginBottom + 36}" text-anchor="start" opacity="0.8">min ago</text>`;
      }
    }

    // ---- data line + fill
    let lineSvg = '';
    let dotSvg = '';
    if (this.data.length) {
      const pts = this.data.map((d) => [xFor(d.t), yFor(d.v)]);
      const pathD = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(' ');
      const first = pts[0];
      const last = pts[pts.length - 1];
      const areaD = `${pathD} L${last[0].toFixed(2)},${zeroY.toFixed(2)} L${first[0].toFixed(2)},${zeroY.toFixed(2)} Z`;

      lineSvg = `
        <path d="${areaD}" fill="url(#pfw-area-grad)" stroke="none" />
        <path d="${pathD}" fill="none" stroke="#4ade80" stroke-width="2.5"
              stroke-linejoin="round" stroke-linecap="round" filter="url(#pfw-glow)" />
      `;
      const lastVal = this.data[this.data.length - 1].v;
      const dotColor = lastVal < 0 ? '#f87171' : '#4ade80';
      dotSvg = `<circle cx="${last[0].toFixed(2)}" cy="${last[1].toFixed(2)}" r="5" fill="${dotColor}" filter="url(#pfw-glow)" />`;
    }

    this.chartEl.innerHTML = `
      <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="${this.stretchToFit ? 'none' : 'xMidYMid meet'}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <filter id="pfw-glow" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="3.2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <linearGradient id="pfw-area-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#4ade80" stop-opacity="0.35" />
            <stop offset="100%" stop-color="#4ade80" stop-opacity="0" />
          </linearGradient>
        </defs>
        ${gridSvg}
        ${xAxisSvg}
        ${lineSvg}
        ${dotSvg}
        <text class="pfw-y-axis-title" x="${-height / 2}" y="18" text-anchor="middle" transform="rotate(-90)">Net Power (log scale)</text>
      </svg>
    `;
  }
}

export default PowerFlowWidget;
