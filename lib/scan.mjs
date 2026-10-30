// Reads Claude Code transcripts and totals token usage per project.
// Only counts, model names and timestamps are read into memory; message content is dropped.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { emptyTokens, addTokens } from './footprint.mjs';

export const CLAUDE_PROJECTS = path.join(os.homedir(), '.claude', 'projects');

function* walk(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.name.endsWith('.jsonl')) yield p;
  }
}

// Worktrees and subfolders roll up into the git repo they belong to.
const rootCache = new Map();
export function projectRoot(cwd) {
  if (!cwd) return null;
  const start = cwd.split(`${path.sep}.claude${path.sep}worktrees${path.sep}`)[0];
  if (rootCache.has(start)) return rootCache.get(start);
  let root = start;
  for (let dir = start; dir !== path.dirname(dir) && dir !== os.homedir(); dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, '.git'))) { root = dir; break; }
  }
  rootCache.set(start, root);
  return root;
}

export function isoWeek(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export async function scan({ root = CLAUDE_PROJECTS, since } = {}) {
  const seen = new Set();
  const projects = new Map();
  const sinceMs = since ? Date.parse(since) : 0;

  for (const file of walk(root)) {
    const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line.includes('"usage"')) continue;
      let entry;
      try { entry = JSON.parse(line); } catch { continue; }
      const msg = entry.message;
      const u = msg?.usage;
      if (entry.type !== 'assistant' || !u) continue;
      const ts = Date.parse(entry.timestamp);
      if (sinceMs && ts < sinceMs) continue;
      // Streaming writes the same message more than once.
      const key = `${msg.id}:${entry.requestId ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const root = projectRoot(entry.cwd) ?? '(unknown)';
      let p = projects.get(root);
      if (!p) {
        p = { path: root, name: path.basename(root), tokens: emptyTokens(), sessions: new Set(),
              models: {}, weeks: {}, firstSeen: ts, lastSeen: ts };
        projects.set(root, p);
      }
      const t = {
        input: u.input_tokens ?? 0,
        cacheWrite: u.cache_creation_input_tokens ?? 0,
        cacheRead: u.cache_read_input_tokens ?? 0,
        output: u.output_tokens ?? 0,
      };
      addTokens(p.tokens, t);
      if (entry.sessionId) p.sessions.add(entry.sessionId);
      const model = msg.model ?? 'unknown';
      p.models[model] = addTokens(p.models[model] ?? emptyTokens(), t);
      const wk = isoWeek(new Date(ts));
      p.weeks[wk] = addTokens(p.weeks[wk] ?? emptyTokens(), t);
      p.firstSeen = Math.min(p.firstSeen, ts);
      p.lastSeen = Math.max(p.lastSeen, ts);
    }
  }
  return [...projects.values()];
}
