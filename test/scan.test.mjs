// What the scan counts, and the fingerprint the page uses to skip rescans.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scan, logsFingerprint } from '../lib/scan.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tend-scan-'));
after(() => fs.rmSync(root, { recursive: true, force: true }));
const line = (id, model, out) => JSON.stringify({ type: 'assistant', requestId: `r-${id}`, sessionId: 's', cwd: '/code/app', timestamp: '2026-10-20T10:00:00Z',
  message: { id, model, usage: { input_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: out } } });
const file = path.join(root, 'p', 's.jsonl');
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, [line('a', 'claude-opus-5-5', 100), line('b', '<synthetic>', 0)].join('\n'));

test('placeholder "<synthetic>" replies are not counted as a model', async () => {
  const [p] = await scan({ root });
  assert.deepEqual(Object.keys(p.models), ['claude-opus-5-5']);
  assert.equal(p.tokens.output, 100);
});

test('the fingerprint changes only when a log changes', () => {
  const before = logsFingerprint(root);
  assert.equal(logsFingerprint(root), before);
  fs.appendFileSync(file, '\n' + line('c', 'claude-opus-5-5', 5));
  assert.notEqual(logsFingerprint(root), before);
});
