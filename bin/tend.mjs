#!/usr/bin/env node
// tend: track the energy and water behind your Claude Code tokens, per project.
import fs from 'node:fs';
import path from 'node:path';
import { scan, projectRoot } from '../lib/scan.mjs';
import { FACTORS, footprint, totalTokens } from '../lib/footprint.mjs';
import {
  SUMMARY, LINKS, LITERS_PER_GALLON, writeJson, readLinks, readSettlements,
  publicFootprint, writeLinked, restoredSection, quote, recordPurchase, undoPurchase,
} from '../lib/store.mjs';
import { hookStatus, setHook, hookPreview } from '../lib/hook.mjs';
import { footprintSvg, svgPathFor } from '../lib/svg.mjs';
import { statusLineInstalled, statusLinePreview, setStatusLine, renderStatusLine } from '../lib/statusline.mjs';
import readline from 'node:readline/promises';

// No command, or only flags like --port, opens the page.
const args = process.argv.slice(2);
const cmd = args[0] && (!args[0].startsWith('-') || ['--help', '-h', '--version'].includes(args[0])) ? args.shift() : 'ui';
const rest = args;
const flags = parseFlags(rest);

const commands = { status, scan: runScan, link, unlink, export: exportCmd, settle, ui, service, hook, statusline, help, '--help': help, '-h': help, '--version': version };
if (!commands[cmd]) { console.error(`Unknown command "${cmd}". Run "tend help".`); process.exit(1); }
await commands[cmd]();

// ---------- commands ----------

async function status() {
  const projects = await scan({ since: flags.since });
  printTable(projects);
}

async function runScan() {
  const projects = await scan({ since: flags.since });
  writeJson(SUMMARY, { schema: 'tend-summary/1', updated: new Date().toISOString(),
    projects: projects.map((p) => ({ ...publicFootprint(p, {}), path: p.path })) });
  const written = writeLinked(projects);
  if (!flags.quiet) {
    printTable(projects);
    console.log(`\nSaved summary to ${SUMMARY}`);
    for (const w of written) console.log(`Updated ${w}`);
  }
}

async function link() {
  const project = projectRoot(path.resolve(flags._[0] ?? process.cwd()));
  const out = path.resolve(project, flags.out ?? 'public/footprint.json');
  const links = readLinks();
  links[project] = {
    out,
    name: flags.name ?? links[project]?.name ?? path.basename(project),
    multiplier: Number(flags.multiplier ?? links[project]?.multiplier ?? 1),
  };
  writeJson(LINKS, links);
  console.log(`Linked ${project}\n  writes ${out}`);
  const written = writeLinked(await scan());
  if (!written.includes(out)) console.log('  No Claude Code usage found for this folder yet. The file appears after your first session here.');
  else console.log('  Wrote the first footprint file.');
}

async function unlink() {
  const project = projectRoot(path.resolve(flags._[0] ?? process.cwd()));
  const links = readLinks();
  if (!links[project]) return console.log(`${project} is not linked.`);
  delete links[project];
  writeJson(LINKS, links);
  console.log(`Unlinked ${project}. The existing footprint file was left in place.`);
}

async function exportCmd() {
  const project = projectRoot(path.resolve(flags._[0] ?? process.cwd()));
  const p = (await scan({ since: flags.since })).find((x) => x.path === project);
  if (!p) { console.error(`No Claude Code usage found for ${project}.`); process.exit(1); }
  const data = publicFootprint(p, { name: flags.name, multiplier: Number(flags.multiplier ?? 1) });
  if (flags.out) {
    const out = path.resolve(flags.out), svg = svgPathFor(out);
    writeJson(out, data);
    fs.writeFileSync(svg, footprintSvg(data));
    console.log(`Wrote ${out}\nWrote ${svg}`);
  }
  else console.log(JSON.stringify(data, null, 2));
}

async function ui() {
  const { serve } = await import('../lib/ui.mjs');
  await serve({ port: Number(flags.port ?? 4317), open: !flags['no-open'] });
}

async function service() {
  const { serviceOn, serviceSupported, setService, SERVICE_PORT } = await import('../lib/service.mjs');
  const action = flags._[0] ?? 'status';
  if (!serviceSupported()) { console.error('Keeping Tend available in the background works on macOS only for now.'); process.exit(1); }
  if (action === 'status') return console.log(serviceOn() ? `On. Tend is always available at http://127.0.0.1:${SERVICE_PORT}` : 'Off.');
  if (action !== 'on' && action !== 'off') { console.error('Use: npx gettend-cli service on | off | status'); process.exit(1); }
  setService(action === 'on');
  console.log(action === 'on'
    ? `On. Bookmark http://127.0.0.1:${SERVICE_PORT}. Tend now starts quietly when you log in.`
    : 'Off. Run npx gettend-cli whenever you want the page.');
}

async function hook() {
  const action = flags._[0] ?? 'status';
  if (action === 'status') {
    for (const [ev, on] of Object.entries(hookStatus())) console.log(`${ev}: ${on ? 'installed' : 'not installed'}`);
    return;
  }
  if (action !== 'install' && action !== 'uninstall') { console.error('Use: tend hook install | uninstall | status'); process.exit(1); }
  if (action === 'install' && !flags.yes) {
    const p = hookPreview();
    console.log(`Tend will add these entries under "hooks" in ${p.settings}:\n`);
    console.log(JSON.stringify(p.entries, null, 2).replace(/^/gm, '  '));
    console.log(`\nYour other settings and hooks stay as they are. Before writing, Tend saves a backup to\n${p.backup}\nand copies itself to ${p.appDir} so the hook keeps working if npm clears its cache.\nThe hook runs "tend scan", which reads token counts from your Claude Code logs and sends nothing anywhere.\n`);
    if (!process.stdin.isTTY) { console.error('Run "npx gettend-cli hook install --yes" to add it without this question.'); process.exit(1); }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = (await rl.question('Add this hook? [y/N] ')).trim().toLowerCase();
    rl.close();
    if (answer !== 'y' && answer !== 'yes') { console.log('Nothing changed.'); return; }
  }
  const { backup } = setHook(action === 'install');
  console.log(action === 'install'
    ? `Installed. Linked projects now update after every Claude Code turn.\nBackup of your previous settings: ${backup}`
    : 'Removed the tend hooks from Claude Code.');
}

// `tend statusline` prints the line Claude Code shows; `install` / `uninstall` / `status` manage the setting.
async function statusline() {
  const action = flags._[0];
  if (!action) {
    // Claude Code passes session details on stdin. Never fail loudly here: a broken line is worse than none.
    let input = '';
    if (!process.stdin.isTTY) for await (const chunk of process.stdin) input += chunk;
    try { console.log(renderStatusLine(input)); } catch { console.log(''); }
    return;
  }
  if (action === 'status') return console.log(statusLineInstalled() ? 'Installed.' : 'Not installed.');
  if (action !== 'install' && action !== 'uninstall') { console.error('Use: tend statusline install | uninstall | status'); process.exit(1); }
  if (action === 'install' && !flags.yes) {
    const p = statusLinePreview();
    console.log(`Tend will set "statusLine" in ${p.settings} to:\n`);
    console.log(JSON.stringify(p.entry, null, 2).replace(/^/gm, '  '));
    console.log(p.keeps
      ? `\nYour current status line (${p.keeps.command}) keeps running, and Tend's part shows after it. Uninstalling puts it back.`
      : '\nUninstalling removes it again.');
    console.log(`It shows this project's carbon this week, from the summary Tend's scans keep. It reads nothing else and sends nothing anywhere.\nA backup of your settings goes to ${p.settings}.tend-backup first.\n`);
    if (!process.stdin.isTTY) { console.error('Run "npx gettend-cli statusline install --yes" to add it without this question.'); process.exit(1); }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = (await rl.question('Add it? [y/N] ')).trim().toLowerCase();
    rl.close();
    if (answer !== 'y' && answer !== 'yes') { console.log('Nothing changed.'); return; }
  }
  setStatusLine(action === 'install');
  console.log(action === 'install'
    ? 'Installed. Claude Code shows this project\'s footprint at the bottom from the next message.\nIt updates when Tend scans, so install the hook too: npx gettend-cli hook install'
    : 'Removed Tend from the status line.');
}

// Settlements are real purchases you made, recorded so the badge can say what was restored.
// Each one covers the usage since the previous one, at the mid estimate.
async function settle() {
  const action = ['record', 'list', 'undo'].includes(flags._[0]) ? flags._.shift() : 'quote';
  const project = projectRoot(path.resolve(flags._[0] ?? process.cwd()));

  if (action === 'list') {
    const entries = readSettlements(project);
    if (!entries.length) return console.log(`No settlements recorded for ${path.basename(project)} yet.`);
    for (const e of entries) {
      console.log(`${day(e.date)}  ${fmtKg(e.co2Kg)} CO2 removed (${e.carbon}) · ${fmtL(e.waterL)} water (${e.basin}) · $${e.usd.toFixed(2)}  covers ${fmtKg(e.coveredCo2Kg)} through ${day(e.through)}`);
    }
    const r = restoredSection(project);
    return console.log(r ? `\nRestored ${r.multiplier}× the footprint covered so far.` : '\nNo purchase has checked proof yet, so the badge doesn\'t say restored.');
  }

  const projects = await scan();

  if (action === 'undo') {
    const { removed } = undoPurchase(project, projects);
    if (!removed) return console.log(`No settlements recorded for ${path.basename(project)}.`);
    return console.log(`Removed the settlement from ${day(removed.date)} (${fmtKg(removed.co2Kg)}, $${removed.usd.toFixed(2)}).`);
  }

  const p = projects.find((x) => x.path === project);
  if (!p) { console.error(`No Claude Code usage found for ${project}.`); process.exit(1); }

  if (action === 'quote') {
    const q = quote(p, flags.multiplier);
    if (q.settled) return console.log(`${p.name} is fully settled through ${day(q.since)}.`);
    const { buy } = q;
    console.log(`${p.name}: unsettled since ${day(q.since)}
  Used          ${fmtKg(q.open.co2Kg)} CO2e · ${fmtL(q.open.waterL)} water (mid estimate)

To restore ${q.multiplier === 1 ? 'your footprint' : `${q.multiplier}× your footprint`}, buy at least:
  Carbon        ${buy.co2Kg} kg of durable removal (biochar, rock weathering, direct air capture)
  Water         ${buy.waterGal.toLocaleString('en-US')} gallon${buy.waterGal === 1 ? '' : 's'} → ${buy.certificates} Water Restoration Certificate${buy.certificates > 1 ? 's' : ''} (1,000 gallons each)
  About         $${buy.usd.toFixed(2)} at about $${(FACTORS.usdPerTonneRemoval / 1000).toFixed(2)}/kg removal and $${FACTORS.usdPerCertificate} per certificate

After you buy, record exactly what you bought (or open the Tend page with "npx gettend-cli"):
  npx gettend-cli settle record --co2 ${buy.co2Kg} --carbon biochar --carbon-cert <url> \\
    --water-gal ${buy.certificates * 1000} --basin "Colorado River basin" --water-cert <url> --usd <total>`);
    return;
  }

  // record
  const num = (v) => (v === undefined || v === true ? null : Number(v));
  const result = recordPurchase(p, projects, {
    co2Kg: num(flags.co2),
    waterL: flags['water-gal'] !== undefined ? num(flags['water-gal']) * LITERS_PER_GALLON : num(flags['water-l']),
    usd: num(flags.usd),
    carbon: flags.carbon,
    carbonCert: flags['carbon-cert'],
    basin: flags.basin,
    waterCert: flags['water-cert'],
    receipt: flags.receipt,
  });
  if (result.problems) {
    const flag = { co2Kg: '--co2 <kg>', water: '--water-gal <gallons>', usd: '--usd <amount>', carbonCert: '--carbon-cert', waterCert: '--water-cert', receipt: '--receipt' };
    console.error(`Couldn't record it:\n  ${result.problems.map((x) => (x.field ? `${flag[x.field]}: ${x.message}` : x.message)).join('\n  ')}`);
    process.exit(1);
  }
  const r = result.restored;
  console.log(r
    ? `Recorded. ${p.name} is settled through ${day(r.settledThrough)}: restored ${r.multiplier}× its footprint.`
    : `Recorded. The badge says restored once a certificate or receipt link from a known provider is added.`);
  if (!flags['carbon-cert'] && !flags['water-cert']) console.log('Add certificate links with --carbon-cert and --water-cert so visitors can check the retirement.');
  for (const w of result.written) console.log(`Updated ${w}`);
}

async function version() {
  const pkg = JSON.parse(await import('node:fs').then((fs) => fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')));
  console.log(pkg.version);
}

function help() {
  console.log(`gettend-cli: the footprint of your Claude Code tokens, per project
(run with npx gettend-cli; after "npm i -g gettend-cli", "gettend" and "tend" work too)

  npx gettend-cli                           Open the Tend page in your browser (--port <n>, --no-open)
  npx gettend-cli status                    Show every project's tokens, energy, CO2e and water
  npx gettend-cli scan                      Rescan and update every linked project's footprint file
  npx gettend-cli link [dir]                Keep a footprint file updated for a project
      --out <file>                          Where to write it (default: public/footprint.json)
      --name <name>                         Name shown on the badge
      --multiplier <n>                      "Leave it better" multiplier shown on the badge
  npx gettend-cli unlink [dir]              Stop updating a project's footprint file
  npx gettend-cli export [dir]              Print or write one footprint file once (--out <file>)
  npx gettend-cli settle [dir]              Show what to buy to restore the unsettled footprint
  npx gettend-cli settle record [dir]       Record a purchase you made, so the badge shows it
      --co2 <kg>                            CO2 removal bought          --carbon <method>, --carbon-cert <url>
      --water-gal <gal>                     Water restoration bought    --basin <name>, --water-cert <url>
      --usd <amount>                        What you paid in total      --receipt <url> (optional)
  npx gettend-cli settle list [dir]         Show recorded settlements
  npx gettend-cli settle undo [dir]         Remove the last recorded settlement
  npx gettend-cli service on                Keep the page running in the background (macOS) so you can bookmark it
  npx gettend-cli service off               Stop it
  npx gettend-cli hook install              Rescan after each Claude Code turn (shows the change to
                                            ~/.claude/settings.json and asks first; --yes skips the question)
  npx gettend-cli hook uninstall            Remove that hook
  npx gettend-cli hook status               Show whether the hook is installed
  npx gettend-cli statusline install        Show this project's footprint in Claude Code's status line
                                            (keeps any status line you already have; asks first)
  npx gettend-cli statusline uninstall      Remove it

  --since <date>                            Only count usage on or after this date, e.g. 2026-10-01`);
}

// ---------- output ----------

function printTable(projects) {
  if (!projects.length) return console.log('No Claude Code usage found in ~/.claude/projects.');
  projects.sort((a, b) => totalTokens(b.tokens) - totalTokens(a.tokens));
  const links = readLinks();
  const rows = projects.map((p) => {
    const fp = footprint(p.tokens);
    return [p.name + (links[p.path] ? ' •' : ''), fmtTok(totalTokens(p.tokens)), fmtKwh(fp.kwh.mid),
      fmtKg(fp.co2Kg.mid), fmtL(fp.waterL.mid), `$${buyCost(fp).toFixed(2)}`];
  });
  const all = projects.reduce((t, p) => {
    for (const k of Object.keys(t)) t[k] += p.tokens[k]; return t;
  }, { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 });
  const fa = footprint(all);
  rows.push(['Total', fmtTok(totalTokens(all)), fmtKwh(fa.kwh.mid), fmtKg(fa.co2Kg.mid), fmtL(fa.waterL.mid), `$${buyCost(fa).toFixed(2)}`]);
  const head = ['Project', 'Tokens', 'Energy', 'CO2e', 'Water', 'To restore'];
  const w = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (r) => r.map((c, i) => (i === 0 ? c.padEnd(w[i]) : c.padStart(w[i]))).join('   ');
  console.log(line(head));
  console.log(w.map((n) => '─'.repeat(n)).join('   '));
  rows.forEach((r, i) => { if (i === rows.length - 1) console.log(w.map((n) => '─'.repeat(n)).join('   ')); console.log(line(r)); });
  console.log(`\nMid estimates. Range is ${FACTORS.band.low}x to ${FACTORS.band.high}x.${Object.keys(links).length ? ' • = linked' : ''}`);
}

// ---------- helpers ----------

function parseFlags(args) {
  const out = { _: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const key = a.slice(2);
    const next = args[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else { out[key] = next; i++; }
  }
  return out;
}

// What restoring costs if you buy it today: whole kilos of removal and whole 1,000-gallon water certificates.
function buyCost(fp) {
  const kg = Math.max(1, Math.ceil(fp.co2Kg.mid));
  const certs = Math.max(1, Math.ceil(fp.waterL.mid / LITERS_PER_GALLON / 1000));
  return (kg / 1000) * FACTORS.usdPerTonneRemoval + certs * FACTORS.usdPerCertificate;
}

function fmtTok(n) { return n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n); }
function fmtKwh(k) { return k < 1 ? `${Math.round(k * 1000)} Wh` : `${k.toFixed(2)} kWh`; }
function fmtKg(k) { return k < 1 ? `${Math.round(k * 1000)} g` : `${k.toFixed(2)} kg`; }
function fmtL(l) { return l < 1 ? `${Math.round(l * 1000)} mL` : `${l.toFixed(1)} L`; }
function day(iso) { return new Date(iso).toLocaleDateString('en-CA'); } // YYYY-MM-DD, local time
