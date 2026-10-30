// `tend ui`: a local page for setting up tracking and settling, served only on this machine.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { scan, isoWeek, logsFingerprint } from './scan.mjs';
import { FACTORS, footprint, totalTokens } from './footprint.mjs';
import {
  LINKS, LITERS_PER_GALLON, writeJson, readLinks, readSettlements, writeLinked,
  restoredSection, quote, recordPurchase, undoPurchase,
  proofStatus, addProof, publicFootprint, markShared,
} from './store.mjs';
import { footprintSvg } from './svg.mjs';
import { hookInstalled, hookPreview, refreshApp, setHook } from './hook.mjs';
import { SERVICE_PORT, serviceOn, serviceSupported, setService } from './service.mjs';

const PAGE = new URL('../ui/index.html', import.meta.url);

// The last n ISO weeks, oldest first, so weeks without usage still show as empty bars.
function lastWeeks(n) {
  const weeks = [];
  for (let i = n - 1; i >= 0; i--) weeks.push(isoWeek(new Date(Date.now() - i * 7 * 864e5)));
  return weeks;
}

// Scanning every log takes seconds on a busy machine, so the page reuses the last scan until a log changes.
let lastScan = { key: null, projects: null };
async function scanIfChanged() {
  const key = logsFingerprint();
  if (key !== lastScan.key) lastScan = { key, projects: await scan() };
  return lastScan.projects;
}

async function state() {
  const projects = await scanIfChanged();
  const links = readLinks();
  const rows = projects.map((p) => ({
    path: p.path,
    name: links[p.path]?.name ?? p.name,
    folder: p.name,
    link: links[p.path] ?? null,
    tokens: totalTokens(p.tokens),
    sessions: p.sessions.size,
    lastActive: new Date(p.lastSeen).toISOString(),
    footprint: footprint(p.tokens),
    quote: quote(p),
    restored: restoredSection(p.path, footprint(p.tokens)),
    svg: links[p.path] ? footprintSvg(publicFootprint(p, links[p.path])) : null,
    settlements: readSettlements(p.path).map((e) => ({ ...e, proof: proofStatus(e) })),
    weekly: lastWeeks(12).map((week) => {
      const t = p.weeks[week];
      const f = t ? footprint(t) : null;
      return { week, tokens: t ? totalTokens(t) : 0, co2Kg: f ? f.co2Kg.mid : 0, waterL: f ? f.waterL.mid : 0 };
    }),
    models: Object.entries(p.models).map(([model, t]) => ({ model, tokens: totalTokens(t), co2Kg: footprint(t).co2Kg.mid }))
      .sort((a, b) => b.tokens - a.tokens),
  }));
  rows.sort((a, b) => (!!b.link - !!a.link) || b.tokens - a.tokens);
  const service = { supported: serviceSupported(), on: serviceOn(), url: `http://127.0.0.1:${SERVICE_PORT}` };
  const prices = { usdPerKg: FACTORS.usdPerTonneRemoval / 1000, usdPerCertificate: FACTORS.usdPerCertificate };
  return { prices, methodVersion: FACTORS.version, hook: hookInstalled(), hookPreview: hookPreview(), service, projects: rows, projectsRaw: projects };
}

const actions = {
  async state() {
    const { projectsRaw, ...rest } = await state();
    return rest;
  },
  async track({ project, multiplier, out }, { projectsRaw }) {
    const p = projectsRaw.find((x) => x.path === project);
    if (!p) return { error: 'That folder has no Claude Code usage.' };
    const links = readLinks();
    links[project] = {
      out: path.resolve(project, out || links[project]?.out || 'public/footprint.json'),
      name: links[project]?.name ?? p.name,
      multiplier: Number(multiplier ?? links[project]?.multiplier ?? 1),
    };
    writeJson(LINKS, links);
    return { written: writeLinked(projectsRaw) };
  },
  async untrack({ project }) {
    const links = readLinks();
    delete links[project];
    writeJson(LINKS, links);
    return {};
  },
  async service({ on }) {
    return setService(!!on);
  },
  async hook({ install }) {
    return setHook(!!install);
  },
  async settle(body, { projectsRaw }) {
    const p = projectsRaw.find((x) => x.path === body.project);
    if (!p) return { error: 'That folder has no Claude Code usage.' };
    const num = (v) => (v === '' || v === null || v === undefined ? null : Number(v));
    return recordPurchase(p, projectsRaw, {
      co2Kg: num(body.co2Kg),
      waterL: num(body.waterGal) === null ? null : num(body.waterGal) * LITERS_PER_GALLON,
      usd: num(body.usd),
      carbon: body.carbon,
      carbonCert: body.carbonCert,
      basin: body.basin,
      waterCert: body.waterCert,
    });
  },
  async proof({ project, index, carbonCert, waterCert }, { projectsRaw }) {
    return addProof(project, Number(index), { carbonCert: carbonCert?.trim(), waterCert: waterCert?.trim() }, projectsRaw);
  },
  async shared({ project, index }) {
    return markShared(project, Number(index));
  },
  async undo({ project }, { projectsRaw }) {
    return undoPurchase(project, projectsRaw);
  },
};

export async function serve({ port, open }) {
  refreshApp();
  const origin = `http://127.0.0.1:${port}`;
  const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);

  const server = http.createServer(async (req, res) => {
    const send = (status, body, type = 'application/json') => {
      res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(type === 'application/json' ? JSON.stringify(body) : body);
    };
    // Only this machine's own page may talk to the server, so other websites can't read or change your ledger.
    if (!allowedHosts.has(req.headers.host)) return send(403, { error: 'Not allowed.' });
    const url = new URL(req.url, origin);

    if (req.method === 'GET' && url.pathname === '/') return send(200, fs.readFileSync(PAGE), 'text/html; charset=utf-8');
    if (!url.pathname.startsWith('/api/')) return send(404, { error: 'Not found.' });
    const name = url.pathname.slice(5);
    if (!actions[name]) return send(404, { error: 'Not found.' });

    let body = {};
    if (req.method === 'POST') {
      const o = req.headers.origin;
      if (!o || !allowedHosts.has(o.replace(/^http:\/\//, ''))) return send(403, { error: 'Not allowed.' });
      if (!String(req.headers['content-type']).startsWith('application/json')) return send(415, { error: 'Send JSON.' });
      let raw = '';
      for await (const chunk of req) { raw += chunk; if (raw.length > 64_000) return send(413, { error: 'Too large.' }); }
      try { body = JSON.parse(raw || '{}'); } catch { return send(400, { error: 'Invalid JSON.' }); }
    } else if (name !== 'state') {
      return send(405, { error: 'Use POST.' });
    }

    try {
      const ctx = name === 'state' ? {} : await state();
      send(200, await actions[name](body, ctx));
    } catch (err) {
      send(500, { error: err.message });
    }
  });

  try {
    await new Promise((resolve, reject) => server.once('error', reject).listen(port, '127.0.0.1', resolve));
  } catch (err) {
    if (err.code !== 'EADDRINUSE') throw err;
    // Probably tend is already open in another Terminal window; show that page instead.
    console.log(`Something is already running at ${origin}. If it's tend, it's opening now. Otherwise try --port ${port + 1}.`);
    if (open) openBrowser(origin);
    return;
  }
  console.log(`tend is open at ${origin}\nPress Ctrl+C to stop.`);
  if (open) openBrowser(origin);
}

function openBrowser(url) {
  if (process.platform === 'darwin') execFile('open', [url], () => {});
  else if (process.platform === 'win32') execFile('cmd', ['/c', 'start', '', url], () => {});
  else execFile('xdg-open', [url], () => {});
}
