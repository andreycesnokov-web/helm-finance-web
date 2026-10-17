'use strict';
// Preloaded with `node -r`: every outbound socket that is not loopback is refused and logged. fetch (undici),
// http/https, TLS and pg all connect through net.Socket, so nothing reaches Telegram, Resend, Anthropic or FX APIs.
const net = require('net');
const LOOP = new Set(['127.0.0.1', 'localhost', '::1', '0.0.0.0']);
const orig = net.Socket.prototype.connect;
net.Socket.prototype.connect = function guarded(...args) {
  let o = args[0];
  if (Array.isArray(o)) o = o[0];
  const host = (o && typeof o === 'object') ? (o.host || o.hostname || (o.path ? 'unix' : 'localhost')) : (typeof args[1] === 'string' ? args[1] : 'localhost');
  if (host !== 'unix' && !LOOP.has(String(host).replace(/^\[|\]$/g, ''))) {
    console.error(`[netguard] BLOCKED outbound connection to ${host}`);
    process.nextTick(() => this.destroy(Object.assign(new Error(`netguard: outbound ${host} blocked`), { code: 'ECONNREFUSED' })));
    return this;
  }
  return orig.apply(this, args);
};
