// The shared total on gettend.eco: what Tend users have restored, added one purchase at a time by people who
// choose to. GET returns the total; POST adds one purchase. Stored in Upstash Redis (set UPSTASH_REDIS_REST_URL
// and UPSTASH_REDIS_REST_TOKEN in the Vercel project). Nothing personal is stored: each purchase is kept only as
// the amounts and a hash of its proof link, which stops the same purchase being counted twice.
import { createHash } from 'node:crypto';

// Keep in step with PROOF_HOSTS in the package's lib/store.mjs.
const PROOF_HOSTS = ['removecarbontoday.com', 'carbonmark.com', 'climeworks.com', 'b-e-f.org', 'climeco.com',
  'thefreshwatertrust.org', 'puro.earth', 'isometric.com', 'carbonfuture.earth', 'verra.org', 'goldstandard.org'];
const MAX_KG = 10000, MAX_L = 1e7, PER_HOUR = 20;

const known = (u) => {
  try { const x = new URL(u); return x.protocol === 'https:' && PROOF_HOSTS.some((d) => x.hostname === d || x.hostname.endsWith(`.${d}`)); }
  catch { return false; }
};

async function redis(commands) {
  const res = await fetch(`${process.env.UPSTASH_REDIS_REST_URL}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(commands),
  });
  if (!res.ok) throw new Error(`redis ${res.status}`);
  return (await res.json()).map((r) => r.result);
}

const readTotal = async () => {
  const [co2, water, n] = await redis([['GET', 'tend:co2Kg'], ['GET', 'tend:waterL'], ['GET', 'tend:purchases']]);
  return { co2Kg: Number(co2 ?? 0), waterL: Number(water ?? 0), purchases: Number(n ?? 0) };
};

export default async function handler(req, res) {
  // The dashboard runs on the person's own computer (127.0.0.1), so the add request comes from another origin.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!process.env.UPSTASH_REDIS_REST_URL) return res.status(503).json({ error: 'The shared total is not set up yet.' });

  try {
    if (req.method === 'GET') {
      res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
      return res.status(200).json(await readTotal());
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Use GET or POST.' });

    const { co2Kg, waterL, proof } = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
    const links = (Array.isArray(proof) ? proof : []).filter(known);
    if (!(co2Kg >= 0 && co2Kg <= MAX_KG && waterL >= 0 && waterL <= MAX_L && co2Kg + waterL > 0)) return res.status(400).json({ error: 'Amounts are out of range.' });
    if (!links.length) return res.status(400).json({ error: 'A certificate or receipt link from a known provider is required.' });

    // A rough limit per address, so one script can't flood the total.
    const ip = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || 'unknown';
    const rate = `tend:rate:${createHash('sha256').update(ip).digest('hex').slice(0, 16)}`;
    const [count] = await redis([['INCR', rate], ['EXPIRE', rate, 3600, 'NX']]);
    if (count > PER_HOUR) return res.status(429).json({ error: 'Too many additions from here. Try again in an hour.' });

    const id = createHash('sha256').update(links.map((u) => u.trim().toLowerCase()).sort().join(' ')).digest('hex');
    const [added] = await redis([['SADD', 'tend:proofs', id]]);
    if (added) await redis([['INCRBYFLOAT', 'tend:co2Kg', String(co2Kg)], ['INCRBYFLOAT', 'tend:waterL', String(waterL)], ['INCR', 'tend:purchases']]);
    return res.status(200).json({ added: !!added, ...(await readTotal()) });
  } catch {
    return res.status(500).json({ error: 'The shared total is unavailable right now.' });
  }
}
