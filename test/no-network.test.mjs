// Tend promises to send nothing anywhere. These tests run every command, and the page,
// against a throwaway home folder with outside requests blocked and recorded.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const bin = path.join(root, 'bin', 'tend.mjs');
const guard = path.join(root, 'tools', 'block-network.mjs');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tend-test-'));
const site = path.join(home, 'site');
const netLog = path.join(home, 'net.log');
after(() => fs.rmSync(home, { recursive: true, force: true }));

// A small fake Claude Code history: one project, two sessions, one duplicated streaming entry.
fs.mkdirSync(path.join(site, '.git'), { recursive: true });
fs.mkdirSync(path.join(home, '.claude', 'projects', 'p'), { recursive: true });
const usage = (id, out) => JSON.stringify({ type: 'assistant', requestId: `r-${id}`, sessionId: 's1', cwd: site, timestamp: '2026-10-20T10:00:00Z',
  message: { id, model: 'claude-test', usage: { input_tokens: 1000, cache_creation_input_tokens: 2000, cache_read_input_tokens: 80000, output_tokens: out }, content: 'PROMPT-TEXT-SHOULD-NOT-LEAK' } });
fs.writeFileSync(path.join(home, '.claude', 'projects', 'p', 's.jsonl'), [usage('m1', 1500), usage('m1', 1500), usage('m2', 500)].join('\n'));
fs.writeFileSync(path.join(home, '.claude', 'settings.json'), JSON.stringify({ theme: 'dark', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo mine' }] }] } }));

const env = { ...process.env, HOME: home, USERPROFILE: home, TEND_NET_LOG: netLog };
const run = (...args) => spawnSync(process.execPath, ['--import', guard, bin, ...args], { env, encoding: 'utf8' });
const outside = () => (fs.existsSync(netLog) ? fs.readFileSync(netLog, 'utf8').trim() : '');

test('commands make no outside requests', () => {
  for (const args of [
    ['--version'], ['status'], ['link', site, '--multiplier', '3'], ['scan'], ['export', site],
    ['settle', site],
    ['settle', 'record', site, '--co2', '1', '--carbon', 'biochar', '--carbon-cert', 'https://example.org/c',
      '--water-gal', '1000', '--basin', 'Colorado River basin', '--water-cert', 'https://example.org/w', '--usd', '2'],
    ['settle', 'list', site], ['hook', 'install', '--yes'], ['hook', 'status'], ['hook', 'uninstall'],
  ]) {
    const r = run(...args);
    assert.equal(r.status, 0, `gettend ${args.join(' ')} failed:\n${r.stderr}`);
  }
  assert.equal(outside(), '', 'Tend tried to reach the internet');
});

test('nothing Tend writes contains prompt or response text', () => {
  const files = [path.join(site, 'public', 'footprint.json'), ...fs.readdirSync(path.join(home, '.tend')).filter((f) => f.endsWith('.json')).map((f) => path.join(home, '.tend', f))];
  for (const f of files) assert.ok(!fs.readFileSync(f, 'utf8').includes('PROMPT-TEXT'), `${f} contains message text`);
});

test('hook install keeps other settings and uninstall removes only Tend', () => {
  run('hook', 'install', '--yes');
  let s = JSON.parse(fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8'));
  assert.equal(s.theme, 'dark');
  assert.ok(s.hooks.Stop.some((g) => g.hooks.some((h) => h.command === 'echo mine')));
  assert.ok(s.hooks.SessionEnd.length === 1);
  run('hook', 'uninstall');
  s = JSON.parse(fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8'));
  assert.deepEqual(s, { theme: 'dark', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo mine' }] }] } });
});

test('hook install asks first and changes nothing without --yes when it cannot ask', () => {
  const before = fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8');
  const r = run('hook', 'install');
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /Tend will add these entries/);
  assert.equal(fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8'), before);
});

test('the page loads no outside resources and makes no outside requests', async () => {
  const html = fs.readFileSync(path.join(root, 'ui', 'index.html'), 'utf8');
  const loads = [...html.matchAll(/<(?:link|script|img|iframe)[^>]+(?:href|src)="(https?:)?\/\/[^"]+"/g)].map((m) => m[0]);
  assert.deepEqual(loads, [], 'ui/index.html loads something from another site');

  const port = String(47700 + Math.floor(Math.random() * 200));
  const child = spawn(process.execPath, ['--import', guard, bin, '--no-open', '--port', port], { env });
  try {
    await new Promise((resolve, reject) => {
      child.stdout.on('data', (d) => String(d).includes('open at') && resolve());
      child.on('exit', (c) => reject(new Error(`page exited with ${c}`)));
      setTimeout(() => reject(new Error('page did not start')), 8000);
    });
    const page = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(page.status, 200);
    const state = await fetch(`http://127.0.0.1:${port}/api/state`);
    assert.equal(state.status, 200);
    const evil = await fetch(`http://127.0.0.1:${port}/api/hook`, { method: 'POST', headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' }, body: '{"install":true}' });
    assert.equal(evil.status, 403, 'another website could change your settings');
  } finally {
    child.kill();
  }
  assert.equal(outside(), '', 'The page tried to reach the internet');
});
