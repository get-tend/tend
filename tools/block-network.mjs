// Loaded with --import before Tend runs in a test. Any attempt to reach a host other than this
// computer is recorded and fails, so the test catches it even if Tend swallows the error.
import fs from 'node:fs';
import net from 'node:net';
import dns from 'node:dns';

const log = process.env.TEND_NET_LOG;
const LOCAL = new Set(['127.0.0.1', '::1', 'localhost', undefined, '']);
const blocked = (what) => {
  if (log) fs.appendFileSync(log, `${what}\n`);
  return new Error(`Blocked outside request in test: ${what}`);
};

const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const o = typeof args[0] === 'object' ? args[0] : { port: args[0], host: args[1] };
  if (!o.path && !LOCAL.has(o.host)) throw blocked(`connect ${o.host}:${o.port}`);
  return connect.apply(this, args);
};

const lookup = dns.lookup;
dns.lookup = function (host, ...rest) {
  if (!LOCAL.has(host)) throw blocked(`dns ${host}`);
  return lookup.call(this, host, ...rest);
};

const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input.url);
  if (!LOCAL.has(url.hostname.replace(/^\[|\]$/g, ''))) throw blocked(`fetch ${url.href}`);
  return realFetch(input, init);
};
