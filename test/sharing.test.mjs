// The ways a footprint gets shown: the README badge, the status line, and the shared-total marker.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tend-sharing-'));
process.env.HOME = home;
process.env.USERPROFILE = home;
process.env.TEND_HOME = path.join(home, '.tend');
after(() => fs.rmSync(home, { recursive: true, force: true }));

const { footprintSvg, svgPathFor } = await import('../lib/svg.mjs');
const store = await import('../lib/store.mjs');
const { isoWeek } = await import('../lib/scan.mjs');
const sl = await import('../lib/statusline.mjs');
const { SETTINGS } = await import('../lib/hook.mjs');

const pub = (restored) => ({ project: 'site', footprint: { co2Kg: { mid: 5.6 } }, ...(restored && { restored }) });

test('README badge shows the footprint, and "restored" only with a current claim', () => {
  assert.match(footprintSvg(pub()), /5\.6 kg CO₂e<\/text>/);
  assert.match(footprintSvg(pub({ status: 'grace', coveredPercent: 80, settledThrough: '2026-10-20T00:00:00Z' })), /✓ restored/);
  const partial = footprintSvg(pub({ status: 'partial', coveredPercent: 74, settledThrough: '2026-10-20T00:00:00Z' }));
  assert.match(partial, /74% restored/);
  assert.doesNotMatch(partial, /✓/);
  assert.equal(svgPathFor('/a/public/footprint.json'), '/a/public/footprint.svg');
});

test('status line shows this project\'s week, from the saved summary', () => {
  const week = isoWeek(new Date());
  store.writeJson(store.SUMMARY, { projects: [{ path: '/code/site', project: 'site', weekly: [{ week, co2Kg: 1.24 }],
    restored: { status: 'current' } }] });
  assert.equal(sl.tendPart(JSON.stringify({ workspace: { current_dir: '/code/site' } })), '☘ site · 1.2 kg this week · ✓ restored');
  assert.equal(sl.tendPart(JSON.stringify({ workspace: { current_dir: '/code/other' } })), '');
  assert.equal(sl.tendPart('not json'), '');
});

test('installing keeps an existing status line, and uninstalling puts it back', () => {
  const theirs = { type: 'command', command: 'echo "my line"' };
  store.writeJson(SETTINGS, { theme: 'dark', statusLine: theirs });
  sl.setStatusLine(true);
  const on = store.readJson(SETTINGS, {});
  assert.equal(on.theme, 'dark');
  assert.ok(sl.statusLineInstalled());
  assert.equal(sl.statusLinePreview().keeps, null); // already Tend's: nothing else to keep
  assert.match(sl.renderStatusLine(JSON.stringify({ workspace: { current_dir: '/code/site' } })), /^my line {2}☘ site/);
  sl.setStatusLine(false);
  assert.deepEqual(store.readJson(SETTINGS, {}).statusLine, theirs);
});

test('a purchase added to the shared total is marked so it is not offered twice', () => {
  store.writeJson(store.SETTLEMENTS, { '/code/site': [{ co2Kg: 10, waterL: 100 }] });
  assert.ok(store.markShared('/code/site', 0).shared);
  assert.ok(store.readSettlements('/code/site')[0].shared);
  assert.ok(store.markShared('/code/site', 5).error);
});
