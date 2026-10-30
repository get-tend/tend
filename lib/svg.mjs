// A README badge, written as footprint.svg beside footprint.json. Plain SVG, so it renders anywhere
// Markdown does (GitHub, npm, docs) without a script or a server: "tend | 5.6 kg CO₂e ✓ restored".
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const fmtKg = (k) => (k < 1 ? `${Math.round(k * 1000)} g` : `${k.toFixed(k < 10 ? 1 : 0)} kg`);

// Rough Verdana 11px widths, the shields.io convention: narrow letters and digits differ, the rest average out.
const width = (text) => [...text].reduce((w, ch) => w + (/[ilj.,:!|'·]/.test(ch) ? 3.6 : /[mwMW@]/.test(ch) ? 10 : /[A-Z0-9₂✓]/.test(ch) ? 7.4 : 6.6), 0);

export function footprintSvg(pub) {
  const r = pub.restored;
  const restored = r && (r.status === 'current' || r.status === 'grace');
  const value = `${fmtKg(pub.footprint.co2Kg.mid)} CO₂e${restored ? ' · ✓ restored' : r?.coveredPercent != null ? ` · ${r.coveredPercent}% restored` : ''}`;
  const label = 'tend';
  const lw = Math.round(width(label) + 20), vw = Math.round(width(value) + 20), w = lw + vw;
  const right = restored ? '#2E6A4C' : '#55645C';
  const title = `${pub.project}: about ${fmtKg(pub.footprint.co2Kg.mid)} CO₂e from Claude Code, middle estimate${restored ? `, restored through ${r.settledThrough.slice(0, 10)}` : ''}. Estimated by Tend.`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="20" role="img" aria-label="${esc(`${label}: ${value}`)}">
<title>${esc(title)}</title>
<linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#fff" stop-opacity=".08"/><stop offset="1" stop-opacity=".08"/></linearGradient>
<clipPath id="r"><rect width="${w}" height="20" rx="3" fill="#fff"/></clipPath>
<g clip-path="url(#r)"><rect width="${lw}" height="20" fill="#13201A"/><rect x="${lw}" width="${vw}" height="20" fill="${right}"/><rect width="${w}" height="20" fill="url(#s)"/></g>
<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
<text x="${lw / 2}" y="14">${esc(label)}</text>
<text x="${lw + vw / 2}" y="14">${esc(value)}</text>
</g>
</svg>
`;
}

// footprint.json → footprint.svg; any other name gets .svg in place of its extension.
export const svgPathFor = (jsonPath) => jsonPath.replace(/(\.json)?$/i, '.svg');
