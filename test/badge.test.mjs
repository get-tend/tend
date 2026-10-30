// The badge decides what it may claim on its own, and must agree with the CLI's restoredSection.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tend-badge-'));
process.env.TEND_HOME = home;
after(() => fs.rmSync(home, { recursive: true, force: true }));
const { restoredState, GRACE_DAYS } = await import('../badge/tend-badge.js');
const store = await import('../lib/store.mjs');

const DAY = 864e5;
const bought = Date.parse('2026-10-01T12:00:00Z');
const fp = (co2, water) => ({ co2Kg: { mid: co2 }, waterL: { mid: water } });
const purchase = (over = {}) => ({
  date: new Date(bought).toISOString(), through: new Date(bought).toISOString(),
  coveredCo2Kg: 58, coveredWaterL: 580, co2Kg: 58, waterL: 580, usd: 20, method: '2026-10',
  carbon: 'biochar', carbonCert: 'https://www.removecarbontoday.com/c/1', basin: 'Colorado', waterCert: null, receipt: null, ...over,
});

const cases = [
  ['fully covered', [purchase()], fp(58, 580), bought + DAY, 'current'],
  ['grew, within the window', [purchase()], fp(78, 780), bought + 10 * DAY, 'grace'],
  ['grew, past the window', [purchase()], fp(78, 780), bought + (GRACE_DAYS + 1) * DAY, 'partial'],
  ['bought less than covered', [purchase({ waterL: 290 })], fp(58, 580), bought + DAY, 'partial'],
  ['3× still covers growth', [purchase({ co2Kg: 174, waterL: 1740 })], fp(150, 1500), bought + 90 * DAY, 'current'],
];

for (const [name, entries, f, now, expected] of cases) {
  test(`badge and CLI agree: ${name}`, () => {
    fs.writeFileSync(store.SETTLEMENTS, JSON.stringify({ '/p': entries }));
    const fromCli = store.restoredSection('/p', f, now);
    assert.equal(fromCli.status, expected);
    assert.equal(restoredState(fromCli, f, now).state, expected);
    assert.equal(restoredState(fromCli, f, now).pct, fromCli.coveredPercent);
  });
}

test('the badge reads files written before status existed', () => {
  // An older footprint file: no status, lastFunded or methodChange.
  const old = { multiplier: 1, co2Kg: 58, waterL: 580, settledThrough: new Date(bought).toISOString() };
  assert.equal(restoredState(old, fp(58, 580), bought + DAY).state, 'current');
  assert.equal(restoredState(old, fp(78, 780), bought + 5 * DAY).state, 'grace');
  assert.equal(restoredState(null, fp(58, 580)), null);
});
