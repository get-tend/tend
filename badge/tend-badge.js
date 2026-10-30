// <tend-badge src="/footprint.json" variant="pill|label|stub" theme="auto|light|dark"></tend-badge>
// Reads a footprint file written by `tend link` and renders it. No dependencies.
const fmtTok = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : `${n}`);
const fmtKg = (k) => (k < 1 ? `${Math.round(k * 1000)} g` : `${k.toFixed(k < 10 ? 2 : 1)} kg`);
const fmtL = (l) => (l < 1 ? `${Math.round(l * 1000)} mL` : `${Math.round(l).toLocaleString('en-US')} L`);
const fmtKwh = (k) => (k < 1 ? `${Math.round(k * 1000)} Wh` : `${k.toFixed(2)} kWh`);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// "claude-opus-5-5" → "Opus"; other names pass through.
const modelName = (id) => {
  const m = /claude-(\w+)/.exec(id);
  return m ? m[1][0].toUpperCase() + m[1].slice(1) : id;
};
const modelMix = (models = {}) => {
  const byName = {};
  for (const [id, n] of Object.entries(models)) byName[modelName(id)] = (byName[modelName(id)] ?? 0) + n;
  const total = Object.values(byName).reduce((a, b) => a + b, 0);
  return Object.entries(byName).sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([name, n]) => `${Math.round((n / total) * 100)}% ${name}`).join(' · ');
};

const css = `
:host{--paper:#FCFCF8;--ink:#13201A;--muted:#55645C;--line:#C9D3CC;--moss:#2E6A4C;display:inline-block;font-family:"JetBrains Mono",ui-monospace,Menlo,monospace;font-variant-numeric:tabular-nums}
:host([data-mode="dark"]){--paper:#1C2621;--ink:#E4ECE6;--muted:#97A79E;--line:#2C3A33;--moss:#7CC39C}
a{color:inherit;text-decoration:none}
.pill{display:inline-flex;align-items:center;gap:9px;white-space:nowrap;background:var(--paper);color:var(--ink);border:1px solid var(--line);border-radius:999px;padding:5px 13px 5px 5px;font-size:12px}
.pill b{display:grid;place-items:center;width:24px;height:24px;border-radius:50%;background:var(--ink);color:var(--paper);font-size:10px}
.pill .m{color:var(--moss);font-weight:600}
.pill .p{color:var(--muted)}
.label{display:block;background:var(--paper);color:var(--ink);border:2px solid var(--ink);padding:10px 12px;width:240px;max-width:100%;box-sizing:border-box;font:12px/1.4 system-ui,sans-serif}
.label h4{font:800 20px/1 system-ui,sans-serif;margin:0 0 4px;letter-spacing:-.02em;border-bottom:6px solid var(--ink);padding-bottom:4px}
.label div{display:flex;justify-content:space-between;gap:10px;border-bottom:1px solid var(--ink);padding:3px 0;font-variant-numeric:tabular-nums}
.label div:last-of-type{border-bottom:0;font-weight:600}
.label .ok{color:var(--moss)}
.stub{display:block;background:var(--paper);color:var(--muted);border-left:3px dashed var(--line);padding:12px 14px;width:268px;max-width:100%;box-sizing:border-box;font-size:12px;line-height:1.5}
.stub strong{display:block;color:var(--ink);font:800 15px system-ui,sans-serif;margin-bottom:4px}
.stub span{display:block}
.stub em{font-style:normal;color:var(--ink)}
.stub .ok{color:var(--moss)}
`;

// Light or dark comes from the page the badge sits on: the first solid background behind it.
// A 1×1 canvas turns any CSS color (rgb, hsl, oklch…) into RGBA.
let paint;
const rgba = (color) => {
  paint ??= Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d', { willReadFrequently: true });
  paint.clearRect(0, 0, 1, 1);
  paint.fillStyle = '#0000';
  paint.fillStyle = color;
  paint.fillRect(0, 0, 1, 1);
  return paint.getImageData(0, 0, 1, 1).data;
};
const luminance = ([r, g, b]) => {
  const c = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
};
function pageIsDark(el) {
  for (let n = el.parentElement ?? el.getRootNode().host; n; n = n.parentElement ?? n.getRootNode().host) {
    const bg = rgba(getComputedStyle(n).backgroundColor);
    // 0.179 is where black and white text have equal contrast against the color.
    if (bg[3] > 128) return luminance(bg) < 0.179;
  }
  // No solid background anywhere: the canvas is white unless the page opts into a dark color scheme.
  const scheme = getComputedStyle(document.documentElement).colorScheme;
  return scheme.includes('dark') && (!scheme.includes('light') || matchMedia('(prefers-color-scheme: dark)').matches);
}

// What the badge may claim, decided here from the facts in the footprint file, so a rule change reaches every
// site with the next script release. "current": purchases cover the whole footprint. "grace": they covered it
// when bought, and the latest was within GRACE_DAYS (or within GRACE_DAYS of a method update). "partial": otherwise.
export const GRACE_DAYS = 30;
export function restoredState(rs, f, now = Date.now()) {
  if (!rs) return null;
  const coverage = Math.min(rs.co2Kg / f.co2Kg.mid, rs.waterL / f.waterL.mid);
  const pct = Math.min(100, Math.floor(coverage * 100));
  if (!(rs.multiplier >= 1)) return { state: 'partial', pct };
  if (coverage >= 1) return { state: 'current', pct };
  const funded = Date.parse(rs.lastFunded ?? rs.settledThrough);
  const released = rs.methodChange ? Date.parse(rs.methodChange.released) : 0;
  const graceEnd = Math.max(funded, released) + GRACE_DAYS * 864e5;
  return { state: now <= graceEnd ? 'grace' : 'partial', pct };
}

// Outside a browser (tests) there is no HTMLElement; the element is only defined where it can render.
class TendBadge extends (globalThis.HTMLElement ?? class {}) {
  static observedAttributes = ['src', 'variant', 'theme'];
  connectedCallback() {
    this.applyMode();
    // Follow the page when it switches themes: a class or data attribute on <html>/<body>, or the system setting.
    this.watch = new MutationObserver(() => this.applyMode());
    for (const n of [document.documentElement, document.body]) this.watch.observe(n, { attributes: true, attributeFilter: ['class', 'style', 'data-theme', 'data-mode'] });
    this.scheme = matchMedia('(prefers-color-scheme: dark)');
    this.onScheme = () => this.applyMode();
    this.scheme.addEventListener('change', this.onScheme);
    this.render();
  }
  disconnectedCallback() {
    this.watch?.disconnect();
    this.scheme?.removeEventListener('change', this.onScheme);
  }
  attributeChangedCallback(name) {
    if (!this.isConnected) return;
    if (name === 'theme') this.applyMode(); else this.render();
  }
  applyMode() {
    const t = this.getAttribute('theme');
    this.dataset.mode = t === 'light' || t === 'dark' ? t : pageIsDark(this) ? 'dark' : 'light';
  }

  async render() {
    const root = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
    const href = esc(this.getAttribute('href') ?? 'https://gettend.eco');
    let d;
    try {
      const res = await fetch(this.getAttribute('src') ?? '/footprint.json', { cache: 'no-cache' });
      d = await res.json();
    } catch {
      root.innerHTML = '';
      return;
    }
    const f = d.footprint;
    const range = `${fmtKg(f.co2Kg.low)}–${fmtKg(f.co2Kg.high)}`;
    const version = esc(d.method?.version ?? '');
    // "Restored" always carries its date. Older files have no status; treat a 1×+ purchase as current.
    const rs = d.restored ?? null;
    const st = restoredState(rs, f);
    const r = st && st.state !== 'partial' ? rs : null;
    const part = st?.state === 'partial' ? { coveredPercent: st.pct } : null;
    const through = rs ? esc(new Date(rs.settledThrough).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })) : '';
    const title = esc(`${d.project}: ${fmtTok(d.tokens.total)} tokens, about ${fmtKg(f.co2Kg.mid)} CO2e and ${fmtL(f.waterL.mid)} water (range ${range})`);
    const variant = this.getAttribute('variant');
    // Every variant's hover text carries the restored date.
    const note = r ? `. Restored through ${through}, with proof` : part ? `. ${part.coveredPercent}% restored, through ${through}` : '';

    let body;
    if (variant === 'label') {
      body = `<a class="label" href="${href}" target="_blank" rel="noopener" title="${title}${note}">
          <h4>Footprint facts</h4>
          <div><span>Tokens</span><span>${fmtTok(d.tokens.total)}</span></div>
          <div><span>Energy</span><span>${fmtKwh(f.kwh.mid)}</span></div>
          <div><span>Carbon</span><span>${fmtKg(f.co2Kg.mid)}</span></div>
          <div><span>Water</span><span>${fmtL(f.waterL.mid)}</span></div>
          <div><span>Estimate range</span><span>${range}</span></div>
          ${r ? `<div><span>CO₂ removed</span><span class="ok">${fmtKg(r.co2Kg)} ✓</span></div><div><span>Water restored</span><span class="ok">${fmtL(r.waterL)} ✓</span></div>` : ''}
          ${part ? `<div><span>Restored so far</span><span>${part.coveredPercent}%</span></div>` : ''}
          <div><span>Tend's method version</span><span>${version}</span></div>
        </a>`;
    } else if (variant === 'stub') {
      const month = new Date(d.lastActive).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      const mix = modelMix(d.models);
      body = `<a class="stub" href="${href}" target="_blank" rel="noopener" title="${title}${note}">
          <strong>Made with ${fmtTok(d.tokens.total)} tokens</strong>
          <span>Claude Code · ${month}</span>
          ${mix ? `<span>Models: ${esc(mix)}</span>` : ''}
          <span>Carbon: <em>${fmtKg(f.co2Kg.mid)}</em> CO₂e</span>
          <span>Water: <em>${fmtL(f.waterL.mid)}</em></span>
          <span>Range: <em>${range}</em></span>
          ${r ? `<span class="ok">Funded: ${fmtKg(r.co2Kg)} CO₂ removal · ${fmtL(r.waterL)} water ✓</span>` : ''}
          ${part ? `<span>Funded: ${part.coveredPercent}% of footprint</span>` : ''}
          <span>Tend's method version: ${version}</span>
        </a>`;
    } else {
      // The pill stays short, so a restored pill links to the proof.
      const link = r && rs.receiptUrl ? esc(rs.receiptUrl) : href;
      body = `<a class="pill" href="${link}" target="_blank" rel="noopener" title="${title}${note}">
          <b>t.</b><span>${fmtTok(d.tokens.total)} tok · ${fmtKg(f.co2Kg.mid)}</span>${r ? '<span class="m">✓ restored</span>' : part ? `<span class="p">${part.coveredPercent}% restored</span>` : ''}
        </a>`;
    }
    root.innerHTML = `<style>${css}</style>${body}`;
  }
}

if (globalThis.customElements && !customElements.get('tend-badge')) customElements.define('tend-badge', TendBadge);
