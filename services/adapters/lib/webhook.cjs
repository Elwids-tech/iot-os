const crypto = require("node:crypto");

// Webhook delivery checks shared by the receiver and its tests (spec 020,
// FR-012 to FR-019). Every secret comparison is constant-time.
const TOLERANCE_MS = 5 * 60 * 1000;
const DROPPED_HEADERS = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "forwarded",
  "x-real-ip",
  "host",
  "content-length",
  "connection",
  "transfer-encoding",
]);

const sha256 = (value) => crypto.createHash("sha256").update(value).digest();
const hashToken = (token) => sha256(String(token)).toString("hex");

function same(a, b) {
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function active(secret, now) {
  return !secret.expires_at || Date.parse(secret.expires_at) > now;
}

// "/w/<ingest id>/<rest>" → the identifier and the remaining path segments.
function parsePath(pathname) {
  const match = /^\/w\/([A-Za-z0-9]{16,64})(\/.*)?$/.exec(pathname);
  if (!match) return null;
  const rest = (match[2] || "").split("/").filter(Boolean);
  return { id: match[1], segments: rest };
}

function parseTimestamp(value) {
  if (!value) return NaN;
  if (/^\d{10}$/.test(value)) return Number(value) * 1000;
  if (/^\d{13}$/.test(value)) return Number(value);
  return Date.parse(value);
}

function matchToken(route, token, now) {
  if (!token) return null;
  const digest = sha256(token);
  let found = null;
  for (const secret of route.secrets || [])
    if (secret.sha256 && active(secret, now) && same(digest, Buffer.from(secret.sha256, "hex")) && !found)
      found = secret;
  return found;
}

// Returns {ok, secret, segments} or {ok: false, reason}. The receiver answers 401
// for every failure; the reason is only for the adapter's diagnostics.
function authenticate(route, { headers, body, segments, now = Date.now() }) {
  const auth = route.auth || {};
  if (auth.mode === "url") {
    const secret = matchToken(route, segments[0], now);
    return secret
      ? { ok: true, secret, segments: segments.slice(1) }
      : { ok: false, reason: "unauthenticated" };
  }
  if (auth.mode === "header") {
    const raw = String(headers[(auth.header || "authorization").toLowerCase()] || "");
    // The routing file always states the scheme; null or empty means the raw secret.
    const scheme = auth.scheme || "";
    let token = raw;
    if (scheme) {
      const prefix = scheme.toLowerCase() + " ";
      token = raw.toLowerCase().startsWith(prefix) ? raw.slice(prefix.length).trim() : "";
    }
    const secret = matchToken(route, token, now);
    return secret ? { ok: true, secret, segments } : { ok: false, reason: "unauthenticated" };
  }
  if (auth.mode !== "hmac") return { ok: false, reason: "unauthenticated" };
  let signature = String(headers[(auth.signature_header || "").toLowerCase()] || "").trim();
  if (!signature) return { ok: false, reason: "unauthenticated" };
  if (auth.prefix) {
    if (signature.slice(0, auth.prefix.length).toLowerCase() !== auth.prefix.toLowerCase())
      return { ok: false, reason: "unauthenticated" };
    signature = signature.slice(auth.prefix.length);
  }
  const given =
    auth.encoding === "base64"
      ? Buffer.from(signature, "base64")
      : /^[0-9a-f]+$/i.test(signature)
        ? Buffer.from(signature, "hex")
        : Buffer.alloc(0);
  if (given.length !== 32) return { ok: false, reason: "unauthenticated" };
  let signed = body;
  if (auth.timestamp_header) {
    const stamp = String(headers[auth.timestamp_header.toLowerCase()] || "");
    const time = parseTimestamp(stamp);
    if (!Number.isFinite(time)) return { ok: false, reason: "unauthenticated" };
    signed = Buffer.concat([Buffer.from(stamp + "."), body]);
    let found = null;
    for (const secret of route.secrets || [])
      if (secret.key && active(secret, now) && same(given, crypto.createHmac("sha256", secret.key).update(signed).digest()) && !found)
        found = secret;
    if (!found) return { ok: false, reason: "unauthenticated" };
    if (Math.abs(now - time) > TOLERANCE_MS) return { ok: false, reason: "stale_signature" };
    return { ok: true, secret: found, segments };
  }
  let found = null;
  for (const secret of route.secrets || [])
    if (secret.key && active(secret, now) && same(given, crypto.createHmac("sha256", secret.key).update(signed).digest()) && !found)
      found = secret;
  return found ? { ok: true, secret: found, segments } : { ok: false, reason: "unauthenticated" };
}

// Request headers the decoder may see: lower-case, bounded, and without anything
// that authenticates the delivery or describes the platform's proxies.
function decoderHeaders(headers, auth = {}) {
  const dropped = new Set(DROPPED_HEADERS);
  for (const name of [auth.header, auth.signature_header, auth.timestamp_header])
    if (name) dropped.add(name.toLowerCase());
  const result = {};
  for (const [name, value] of Object.entries(headers)) {
    const key = name.toLowerCase();
    if (dropped.has(key) || key.startsWith("x-forwarded-")) continue;
    if (Object.keys(result).length >= 32) break;
    result[key] = (Array.isArray(value) ? value.join(", ") : String(value)).slice(0, 1000);
  }
  return result;
}

// Token buckets keyed by adapter or organization.
class Buckets {
  constructor(rate, burst, now = Date.now) {
    this.rate = rate;
    this.burst = burst;
    this.now = now;
    this.state = new Map();
  }
  take(key) {
    const now = this.now();
    const current = this.state.get(key) || { tokens: this.burst, at: now };
    const tokens = Math.min(this.burst, current.tokens + ((now - current.at) / 1000) * this.rate);
    if (tokens < 1) {
      this.state.set(key, { tokens, at: now });
      return { ok: false, retryAfter: Math.max(1, Math.ceil((1 - tokens) / this.rate)) };
    }
    this.state.set(key, { tokens: tokens - 1, at: now });
    if (this.state.size > 10000) this.state.delete(this.state.keys().next().value);
    return { ok: true };
  }
}

// After `limit` failed authentications within a minute an address is refused for
// `banMs` (FR-018).
class FailureLimiter {
  constructor(limit = 30, banMs = 5 * 60 * 1000, now = Date.now) {
    this.limit = limit;
    this.banMs = banMs;
    this.now = now;
    this.state = new Map();
  }
  banned(address) {
    const entry = this.state.get(address);
    return !!entry?.until && entry.until > this.now();
  }
  retryAfter(address) {
    const entry = this.state.get(address);
    return entry?.until ? Math.max(1, Math.ceil((entry.until - this.now()) / 1000)) : 0;
  }
  fail(address) {
    const now = this.now();
    const entry = this.state.get(address);
    const times = (entry?.times || []).filter((t) => t > now - 60000);
    times.push(now);
    this.state.set(address, { times, until: times.length > this.limit ? now + this.banMs : entry?.until });
    if (this.state.size > 10000) this.state.delete(this.state.keys().next().value);
  }
}

module.exports = { Buckets, FailureLimiter, authenticate, decoderHeaders, hashToken, parsePath, parseTimestamp };
