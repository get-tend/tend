// Tend in Claude Code's status line: "☘ checkout · 5.6 kg this week · ✓ restored".
// Claude Code runs the status line command after each message and shows what it prints. Tend reads the summary
// its scans already keep (~/.tend/footprint.json), so this never reads Claude Code's logs and stays fast.
// Someone may already have a status line; Tend keeps theirs and adds its part after it.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { SUMMARY, TEND_DIR, readJson, writeJson } from './store.mjs';
import { SETTINGS, APP_DIR, installApp } from './hook.mjs';
import { projectRoot, isoWeek } from './scan.mjs';

export const STATUSLINE_CMD = `node "${path.join(APP_DIR, 'bin', 'tend.mjs')}" statusline`;
const SAVED = path.join(TEND_DIR, 'statusline.json'); // the status line someone had before Tend's
const isTend = (cmd) => typeof cmd === 'string' && /[/\\]bin[/\\]tend\.mjs" statusline/.test(cmd);

export const statusLineInstalled = () => isTend(readJson(SETTINGS, {}).statusLine?.command);

// What setStatusLine(true) will write, shown before anything changes.
export function statusLinePreview() {
  const current = readJson(SETTINGS, {}).statusLine ?? null;
  return { settings: SETTINGS, entry: { type: 'command', command: STATUSLINE_CMD }, keeps: current && !isTend(current.command) ? current : null };
}

export function setStatusLine(install) {
  const settings = readJson(SETTINGS, {});
  if (fs.existsSync(SETTINGS)) fs.copyFileSync(SETTINGS, `${SETTINGS}.tend-backup`);
  const current = settings.statusLine;
  if (install) {
    installApp();
    if (current && !isTend(current.command)) writeJson(SAVED, current);
    settings.statusLine = { type: 'command', command: STATUSLINE_CMD };
  } else if (isTend(current?.command)) {
    const previous = readJson(SAVED, null);
    if (previous) settings.statusLine = previous; else delete settings.statusLine;
    fs.rmSync(SAVED, { force: true });
  }
  writeJson(SETTINGS, settings);
  return { backup: `${SETTINGS}.tend-backup` };
}

const fmtKg = (k) => (k < 1 ? `${Math.round(k * 1000)} g` : `${k.toFixed(1)} kg`);

// Tend's part of the line, from Claude Code's session details (raw JSON on stdin). Empty when there's nothing to show.
export function tendPart(input, now = new Date()) {
  let cwd = process.cwd();
  try { const d = JSON.parse(input || '{}'); cwd = d.workspace?.current_dir ?? d.cwd ?? cwd; } catch {}
  const root = projectRoot(cwd);
  const p = readJson(SUMMARY, {}).projects?.find((x) => x.path === root);
  if (!p) return '';
  const week = p.weekly?.find((w) => w.week === isoWeek(now));
  const r = p.restored;
  const mark = r && (r.status === 'current' || r.status === 'grace') ? ' · ✓ restored' : r?.coveredPercent != null ? ` · ${r.coveredPercent}% restored` : '';
  return `☘ ${p.project} · ${fmtKg(week?.co2Kg ?? 0)} this week${mark}`;
}

// The whole line: the status line someone had before, if any, then Tend's part.
export function renderStatusLine(input) {
  let theirs = '';
  const previous = readJson(SAVED, null);
  if (previous?.command) {
    const run = spawnSync(previous.command, { shell: true, input, encoding: 'utf8', timeout: 1500 });
    theirs = (run.stdout ?? '').split('\n')[0].trim();
  }
  const ours = tendPart(input);
  return [theirs, ours].filter(Boolean).join('  ');
}
