// tend's local state (~/.tend) and the rules for settling. Shared by the CLI and `tend ui`.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FACTORS, footprint, totalTokens } from './footprint.mjs';
import { footprintSvg, svgPathFor } from './svg.mjs';

export const TEND_DIR = process.env.TEND_HOME ?? path.join(os.homedir(), '.tend');
export const LINKS = path.join(TEND_DIR, 'links.json');
export const SUMMARY = path.join(TEND_DIR, 'footprint.json');
export const SETTLEMENTS = path.join(TEND_DIR, 'settlements.json');
export const LITERS_PER_GALLON = 3.785;

export function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

export function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

export const readLinks = () => readJson(LINKS, {});
export const readSettlements = (project) => readJson(SETTLEMENTS, {})[project] ?? [];

// What the badge reads. No absolute paths, prompts or file names.
export function publicFootprint(p, { name, multiplier = 1 }) {
  const fp = footprint(p.tokens);
  const weeks = Object.keys(p.weeks).sort().slice(-12);
  const restored = restoredSection(p.path, fp);
  return {
    schema: 'tend/1',
    project: name ?? p.name,
    updated: new Date().toISOString(),
    firstActive: new Date(p.firstSeen).toISOString(),
    lastActive: new Date(p.lastSeen).toISOString(),
    sessions: p.sessions.size,
    tokens: { ...p.tokens, total: totalTokens(p.tokens) },
    footprint: fp,
    multiplier,
    restoreUsdAtMultiplier: Math.round(fp.restoreUsd * multiplier * 100) / 100,
    weekly: weeks.map((w) => ({ week: w, tokens: totalTokens(p.weeks[w]), co2Kg: footprint(p.weeks[w]).co2Kg.mid })),
    models: Object.fromEntries(Object.entries(p.models).map(([m, t]) => [m, totalTokens(t)])),
    method: { version: FACTORS.version, estimate: 'mid', note: 'Estimates from public data; low/high band included.' },
    ...(restored && { restored }),
  };
}

export function writeLinked(projects) {
  const written = [];
  for (const [projPath, cfg] of Object.entries(readLinks())) {
    const p = projects.find((x) => x.path === projPath);
    if (!p) continue;
    const pub = publicFootprint(p, cfg);
    writeJson(cfg.out, pub);
    // The README badge, next to the file the script badge reads.
    const svg = svgPathFor(cfg.out);
    fs.writeFileSync(svg, footprintSvg(pub));
    written.push(cfg.out, svg);
  }
  return written;
}

// What the badge shows once at least one settlement exists. The multiplier rounds down,
// and the smaller of the carbon and water ratios wins, so the badge never claims more than was bought.
// Proof is a certificate or receipt link. Tend checks that it comes from a provider or registry it knows;
// it can't yet confirm the purchase itself.
const PROOF_HOSTS = ['removecarbontoday.com', 'carbonmark.com', 'climeworks.com', 'b-e-f.org', 'climeco.com',
  'thefreshwatertrust.org', 'puro.earth', 'isometric.com', 'carbonfuture.earth', 'verra.org', 'goldstandard.org'];
export function proofStatus(e) {
  const links = [e.carbonCert, e.waterCert, e.receipt].filter(Boolean);
  if (!links.length) return 'missing';
  const known = (u) => { try { const h = new URL(u).hostname; return PROOF_HOSTS.some((d) => h === d || h.endsWith(`.${d}`)); } catch { return false; } };
  return links.some(known) ? 'checked' : 'unrecognized';
}

// What the badge shows. Only purchases with checked proof count. The multiplier rounds down,
// and the smaller of the carbon and water ratios wins, so the badge never claims more than was bought.
// Every claim is dated. Usage keeps growing after a purchase, so the badge keeps its check for
// GRACE_DAYS after the last one, then shows the share of the whole footprint funded so far.
export const GRACE_DAYS = 30;
// Purchases recorded before Tend saved a method version were all calculated with the first one.
const LEGACY_METHOD = '2026-10';
export function restoredSection(project, fp, now = Date.now()) {
  const entries = readSettlements(project).filter((e) => proofStatus(e) === 'checked');
  if (!entries.length) return null;
  const sum = (k) => entries.reduce((t, e) => t + e[k], 0);
  const unique = (k) => [...new Set(entries.map((e) => e[k]))].join(', ');
  const last = entries.at(-1);
  const multiplier = multiplierFor(sum('co2Kg'), sum('waterL'), sum('coveredCo2Kg'), sum('coveredWaterL'));
  // A method update re-estimates past usage. If the latest purchase used an earlier method, the check
  // holds for GRACE_DAYS after the update was released, so people can top up the difference.
  const lastMethod = last.method ?? LEGACY_METHOD;
  const methodChange = lastMethod !== FACTORS.version ? { from: lastMethod, to: FACTORS.version, released: FACTORS.released } : null;
  const graceEnd = Math.max(Date.parse(last.date), methodChange ? Date.parse(FACTORS.released) : 0) + GRACE_DAYS * 864e5;
  const graceUntil = new Date(graceEnd).toISOString();
  // Share of the whole footprint to date that purchases cover, against the middle estimate.
  const coverage = fp ? Math.min(sum('co2Kg') / fp.co2Kg.mid, sum('waterL') / fp.waterL.mid) : null;
  const coveredPercent = coverage === null ? null : Math.min(100, Math.floor(coverage * 100));
  const status = multiplier < 1 ? 'partial'
    : coverage === null || coverage >= 1 ? 'current'
    : now <= Date.parse(graceUntil) ? 'grace' : 'partial';
  return {
    status,
    coveredPercent,
    multiplier,
    co2Kg: round3(sum('co2Kg')),
    waterL: round3(sum('waterL')),
    usd: Math.round(sum('usd') * 100) / 100,
    carbon: unique('carbon'),
    watershed: unique('basin'),
    settledThrough: last.through,
    lastFunded: last.date,
    graceUntil,
    methodChange,
    receiptUrl: last.receipt ?? last.carbonCert ?? last.waterCert ?? 'https://gettend.eco',
    certificates: entries.flatMap((e) => [e.carbonCert, e.waterCert]).filter(Boolean),
    settlements: entries.length,
  };
}

// The badge says "restored" (with its date) only in these states.
export const showsRestored = (r) => !!r && (r.status === 'current' || r.status === 'grace');

// Adds proof links to a purchase recorded earlier.
export function addProof(project, index, { carbonCert, waterCert }, projects) {
  const problems = [];
  for (const [field, v] of Object.entries({ carbonCert, waterCert })) {
    if (v && !/^https:\/\//.test(v)) problems.push({ field, message: 'Links must start with https://' });
  }
  if (!carbonCert && !waterCert) problems.push({ field: null, message: 'Add at least one certificate or receipt link.' });
  const ledger = readJson(SETTLEMENTS, {});
  const e = ledger[project]?.[index];
  if (!e) problems.push({ field: null, message: 'That purchase no longer exists.' });
  if (problems.length) return { problems };
  if (carbonCert) e.carbonCert = carbonCert;
  if (waterCert) e.waterCert = waterCert;
  writeJson(SETTLEMENTS, ledger);
  return { status: proofStatus(e), written: writeLinked(projects) };
}

// Marks a purchase as added to the shared total on gettend.eco, so the page doesn't offer it twice.
export function markShared(project, index) {
  const ledger = readJson(SETTLEMENTS, {});
  const e = ledger[project]?.[index];
  if (!e) return { error: 'That purchase no longer exists.' };
  e.shared = new Date().toISOString();
  writeJson(SETTLEMENTS, ledger);
  return { shared: e.shared };
}

export function multiplierFor(co2Kg, waterL, coveredCo2Kg, coveredWaterL) {
  return Math.floor(Math.min(co2Kg / coveredCo2Kg, waterL / coveredWaterL) * 10) / 10;
}

// Where a project stands: what's unsettled since the last settlement, and what to buy to cover it.
export function quote(p, multiplierOverride) {
  const entries = readSettlements(p.path);
  const fp = footprint(p.tokens);
  const covered = entries.reduce((t, e) => ({ co2Kg: t.co2Kg + e.coveredCo2Kg, waterL: t.waterL + e.coveredWaterL }), { co2Kg: 0, waterL: 0 });
  const open = { co2Kg: Math.max(0, fp.co2Kg.mid - covered.co2Kg), waterL: Math.max(0, fp.waterL.mid - covered.waterL) };
  const multiplier = Number(multiplierOverride ?? readLinks()[p.path]?.multiplier ?? 1);
  const buyKg = Math.ceil(open.co2Kg * multiplier);
  const buyGal = Math.ceil((open.waterL * multiplier) / LITERS_PER_GALLON);
  const certificates = Math.ceil(buyGal / 1000);
  return {
    settled: open.co2Kg < 0.001,
    since: entries.at(-1)?.through ?? new Date(p.firstSeen).toISOString(),
    open,
    covered,
    multiplier,
    buy: {
      co2Kg: buyKg,
      waterGal: buyGal,
      certificates,
      usd: Math.round(((buyKg / 1000) * FACTORS.usdPerTonneRemoval + certificates * FACTORS.usdPerCertificate) * 100) / 100,
    },
  };
}

// Checks a purchase before recording it. Problems are keyed by field so the CLI and the page can each phrase them.
export function validatePurchase(input) {
  const problems = [];
  if (!(input.co2Kg > 0)) problems.push({ field: 'co2Kg', message: 'Enter the kg of CO₂ removal you bought.' });
  if (!(input.waterL > 0)) problems.push({ field: 'water', message: 'Enter the water restoration you bought.' });
  if (!(input.usd >= 0) || input.usd === null) problems.push({ field: 'usd', message: 'Enter what you paid in total.' });
  for (const field of ['carbonCert', 'waterCert', 'receipt']) {
    if (input[field] && !/^https:\/\//.test(input[field])) problems.push({ field, message: 'Links must start with https://' });
  }
  return problems;
}

export function recordPurchase(p, projects, input) {
  const problems = validatePurchase(input);
  const q = quote(p);
  if (!problems.length && q.settled) problems.push({ field: null, message: `${p.name} has no unsettled footprint to cover.` });
  if (problems.length) return { problems };

  const ledger = readJson(SETTLEMENTS, {});
  (ledger[p.path] ??= []).push({
    date: new Date().toISOString(),
    through: new Date(p.lastSeen).toISOString(),
    coveredCo2Kg: round3(q.open.co2Kg),
    coveredWaterL: round3(q.open.waterL),
    co2Kg: input.co2Kg,
    waterL: round3(input.waterL),
    usd: input.usd,
    carbon: input.carbon || 'carbon removal',
    carbonCert: input.carbonCert || null,
    basin: input.basin || 'watershed restoration',
    waterCert: input.waterCert || null,
    receipt: input.receipt || null,
    method: FACTORS.version,
  });
  writeJson(SETTLEMENTS, ledger);
  return { restored: restoredSection(p.path, footprint(p.tokens)), written: writeLinked(projects) };
}

export function undoPurchase(project, projects) {
  const ledger = readJson(SETTLEMENTS, {});
  const removed = (ledger[project] ?? []).pop();
  if (!removed) return { removed: null };
  writeJson(SETTLEMENTS, ledger);
  return { removed, written: writeLinked(projects) };
}

export function round3(n) { return Math.round(n * 1000) / 1000; }
