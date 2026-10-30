// Footprint model. Middle estimates with a low/high band; see the Method section in README.md.
export const FACTORS = {
  // Bump version (YYYY-MM) and released whenever a factor changes, and add a changelog entry to the methodology page.
  version: '2026-10',
  released: '2026-10-01',
  whPer1k: { output: 1.0, input: 0.2, cacheWrite: 0.2, cacheRead: 0.05 },
  pue: 1.2,
  band: { low: 0.4, high: 2.5 },
  kgCo2PerKwh: 0.35, // EPA eGRID 2023 US average, 770.9 lb CO2e/MWh
  litersPerKwh: 3.5, // on-site cooling plus water consumed generating the power (US average)
  usdPerTonneRemoval: 200, // durable removal from about $0.20/kg (biochar, 2026)
  usdPerCertificate: 4, // one Water Restoration Certificate = 1,000 gallons, about $4 online (2026)
  usdPerLiterWater: 4 / 3785,
};

export function emptyTokens() {
  return { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 };
}

export function addTokens(a, b) {
  a.input += b.input; a.cacheWrite += b.cacheWrite; a.cacheRead += b.cacheRead; a.output += b.output;
  return a;
}

export function totalTokens(t) {
  return t.input + t.cacheWrite + t.cacheRead + t.output;
}

export function footprint(t, f = FACTORS) {
  const wh = Object.keys(f.whPer1k).reduce((sum, k) => sum + (t[k] / 1000) * f.whPer1k[k], 0);
  const kwh = (wh / 1000) * f.pue;
  const co2Kg = kwh * f.kgCo2PerKwh;
  const waterL = kwh * f.litersPerKwh;
  const band = (v) => ({ low: round(v * f.band.low), mid: round(v), high: round(v * f.band.high) });
  return {
    kwh: band(kwh),
    co2Kg: band(co2Kg),
    waterL: band(waterL),
    restoreUsd: round((co2Kg / 1000) * f.usdPerTonneRemoval + waterL * f.usdPerLiterWater, 4),
  };
}

function round(n, d = 3) {
  const p = 10 ** d;
  return Math.round(n * p) / p;
}
