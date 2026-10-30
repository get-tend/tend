// What the badge may claim after a purchase, as usage keeps growing.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tend-restored-'));
process.env.TEND_HOME = home;
after(() => fs.rmSync(home, { recursive: true, force: true }));
const { restoredSection, showsRestored, recordPurchase, readSettlements, GRACE_DAYS, SETTLEMENTS } = await import('../lib/store.mjs');
const { FACTORS } = await import('../lib/footprint.mjs');

const DAY = 864e5;
const bought = Date.parse('2026-10-01T12:00:00Z');
const fp = (co2, water) => ({ co2Kg: { mid: co2 }, waterL: { mid: water } });
const purchase = (over = {}) => ({
  date: new Date(bought).toISOString(), through: new Date(bought).toISOString(),
  coveredCo2Kg: 58, coveredWaterL: 580, co2Kg: 58, waterL: 580, usd: 20,
  carbon: 'biochar', carbonCert: 'https://www.removecarbontoday.com/c/1', basin: 'Colorado', waterCert: null, receipt: null, ...over,
});
const ledger = (project, entries) => fs.writeFileSync(SETTLEMENTS, JSON.stringify({ [project]: entries }));

test('fully funded footprint is current', () => {
  ledger('/a', [purchase()]);
  const r = restoredSection('/a', fp(58, 580), bought + DAY);
  assert.equal(r.status, 'current');
  assert.equal(r.coveredPercent, 100);
  assert.ok(showsRestored(r));
});

test('usage after funding keeps the check during the grace window', () => {
  ledger('/a', [purchase()]);
  const r = restoredSection('/a', fp(78, 780), bought + 10 * DAY);
  assert.equal(r.status, 'grace');
  assert.equal(r.coveredPercent, 74);
  assert.equal(r.graceUntil, new Date(bought + GRACE_DAYS * DAY).toISOString());
  assert.ok(showsRestored(r));
});

test('after the grace window the badge shows the share funded', () => {
  ledger('/a', [purchase()]);
  const r = restoredSection('/a', fp(78, 780), bought + (GRACE_DAYS + 1) * DAY);
  assert.equal(r.status, 'partial');
  assert.equal(r.coveredPercent, 74);
  assert.ok(!showsRestored(r));
});

test('a 3× purchase still covers later growth up to 3×', () => {
  ledger('/a', [purchase({ co2Kg: 174, waterL: 1740 })]);
  const r = restoredSection('/a', fp(150, 1500), bought + 90 * DAY);
  assert.equal(r.status, 'current');
  assert.equal(r.multiplier, 3);
});

test('the weaker of carbon and water decides', () => {
  ledger('/a', [purchase({ waterL: 290 })]);
  const r = restoredSection('/a', fp(58, 580), bought + DAY);
  assert.equal(r.status, 'partial');
  assert.equal(r.coveredPercent, 50);
});

test('purchases without checked proof never count', () => {
  ledger('/a', [purchase({ carbonCert: 'https://example.com/receipt' })]);
  assert.equal(restoredSection('/a', fp(58, 580), bought + DAY), null);
});

test('recording a purchase saves the method version it used', () => {
  const project = { path: '/rec', name: 'rec', tokens: { input: 0, cacheWrite: 0, cacheRead: 1e9, output: 0 }, firstSeen: bought - 7 * DAY, lastSeen: bought };
  ledger('/other', []);
  const result = recordPurchase(project, [], { co2Kg: 30, waterL: 300, usd: 10, carbonCert: 'https://www.removecarbontoday.com/c/2' });
  assert.ok(!result.problems, JSON.stringify(result.problems));
  assert.equal(readSettlements('/rec').at(-1).method, FACTORS.version);
});

test('a method update keeps the check for 30 days after its release', (t) => {
  const was = { version: FACTORS.version, released: FACTORS.released };
  t.after(() => Object.assign(FACTORS, was));
  Object.assign(FACTORS, { version: '2027-01', released: '2027-01-05T00:00:00Z' });
  // Bought under the old method long ago; the new method estimates more.
  ledger('/a', [purchase({ method: '2026-10' })]);
  const released = Date.parse(FACTORS.released);
  const during = restoredSection('/a', fp(70, 700), released + 10 * DAY);
  assert.equal(during.status, 'grace');
  assert.deepEqual(during.methodChange, { from: '2026-10', to: '2027-01', released: FACTORS.released });
  assert.equal(restoredSection('/a', fp(70, 700), released + (GRACE_DAYS + 1) * DAY).status, 'partial');
});

test('purchases saved before versions existed count as the first method', (t) => {
  const was = { version: FACTORS.version, released: FACTORS.released };
  t.after(() => Object.assign(FACTORS, was));
  ledger('/a', [purchase()]);
  assert.equal(restoredSection('/a', fp(58, 580), bought + DAY).methodChange, null);
  Object.assign(FACTORS, { version: '2027-01', released: '2027-01-05T00:00:00Z' });
  assert.equal(restoredSection('/a', fp(58, 580), bought + DAY).methodChange.from, '2026-10');
});
