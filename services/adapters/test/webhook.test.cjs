const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { Buckets, FailureLimiter, authenticate, decoderHeaders, hashToken, parsePath } = require("../lib/webhook.cjs");

const body = Buffer.from('[{"deviceId":"SNS-2001","temperature_c":21.5}]');
const sign = (key, data, encoding = "hex") => crypto.createHmac("sha256", key).update(data).digest(encoding);
const hmacRoute = (auth = {}, secrets = [{ uuid: "s1", key: "vendor-signing-secret-1234" }]) => ({
  auth: { mode: "hmac", signature_header: "x-signature", encoding: "hex", prefix: "sha256=", ...auth },
  secrets,
});
const now = Date.parse("2026-10-27T10:00:00Z");

test("an HMAC signature of the raw body authenticates, with its prefix and in either encoding", () => {
  const route = hmacRoute();
  const headers = { "x-signature": "sha256=" + sign("vendor-signing-secret-1234", body) };
  const result = authenticate(route, { headers, body, segments: [], now });
  assert.equal(result.ok, true);
  assert.equal(result.secret.uuid, "s1");
  const base64 = hmacRoute({ encoding: "base64", prefix: null });
  assert.equal(authenticate(base64, { headers: { "x-signature": sign("vendor-signing-secret-1234", body, "base64") }, body, segments: [], now }).ok, true);
  assert.equal(authenticate(route, { headers: { "x-signature": sign("vendor-signing-secret-1234", body) }, body, segments: [], now }).ok, false);
});

test("a wrong, missing, stale or other adapter's signature is refused", () => {
  const route = hmacRoute({ timestamp_header: "x-timestamp" });
  const stamp = String(Math.floor(now / 1000));
  const good = { "x-signature": "sha256=" + sign("vendor-signing-secret-1234", stamp + "." + body), "x-timestamp": stamp };
  assert.equal(authenticate(route, { headers: good, body, segments: [], now }).ok, true);
  assert.deepEqual(authenticate(route, { headers: good, body, segments: [], now: now + 6 * 60000 }), { ok: false, reason: "stale_signature" });
  assert.equal(authenticate(route, { headers: { ...good, "x-signature": "sha256=" + "0".repeat(64) }, body, segments: [], now }).reason, "unauthenticated");
  assert.equal(authenticate(route, { headers: {}, body, segments: [], now }).reason, "unauthenticated");
  const other = hmacRoute({ timestamp_header: "x-timestamp" }, [{ uuid: "s2", key: "another-adapters-secret" }]);
  assert.equal(authenticate(other, { headers: good, body, segments: [], now }).ok, false);
  const tampered = Buffer.from(body.toString().replace("21.5", "99"));
  assert.equal(authenticate(route, { headers: good, body: tampered, segments: [], now }).ok, false);
});

test("an expired secret stops working after rotation; the new one keeps working", () => {
  const route = hmacRoute({}, [
    { uuid: "old", key: "old-signing-secret-12345", expires_at: new Date(now - 1000).toISOString() },
    { uuid: "new", key: "new-signing-secret-12345", expires_at: null },
  ]);
  const signed = (key) => ({ "x-signature": "sha256=" + sign(key, body) });
  assert.equal(authenticate(route, { headers: signed("old-signing-secret-12345"), body, segments: [], now }).ok, false);
  assert.equal(authenticate(route, { headers: signed("new-signing-secret-12345"), body, segments: [], now }).secret.uuid, "new");
});

test("header tokens and URL tokens compare hashes, and the URL token never reaches the decoder", () => {
  const token = "generated-token-with-enough-entropy";
  const header = { auth: { mode: "header", header: "authorization", scheme: "Bearer" }, secrets: [{ uuid: "h", sha256: hashToken(token) }] };
  assert.equal(authenticate(header, { headers: { authorization: "Bearer " + token }, body, segments: [], now }).ok, true);
  assert.equal(authenticate(header, { headers: { authorization: token }, body, segments: [], now }).ok, false);
  const raw = { auth: { mode: "header", header: "x-api-token", scheme: "" }, secrets: header.secrets };
  assert.equal(authenticate(raw, { headers: { "x-api-token": token }, body, segments: [], now }).ok, true);
  const url = { auth: { mode: "url" }, secrets: header.secrets };
  const result = authenticate(url, { headers: {}, body, segments: [token, "uplink", "env"], now });
  assert.deepEqual(result.segments, ["uplink", "env"]);
  assert.equal(authenticate(url, { headers: {}, body, segments: ["guess"], now }).ok, false);
});

test("ingest paths need an unguessable identifier", () => {
  assert.deepEqual(parsePath("/w/3Hk9QmZ1pL7vX2cR8tY4nB6dF0gJ5sWe/a/b"), { id: "3Hk9QmZ1pL7vX2cR8tY4nB6dF0gJ5sWe", segments: ["a", "b"] });
  assert.equal(parsePath("/w/short"), null);
  assert.equal(parsePath("/admin"), null);
});

test("the decoder sees request headers without credentials or proxy details", () => {
  const headers = decoderHeaders(
    { "Content-Type": "application/json", authorization: "Bearer x", cookie: "a", "x-signature": "s", "x-forwarded-for": "203.0.113.9", "x-vendor-event": "uplink" },
    { mode: "hmac", signature_header: "x-signature" },
  );
  assert.deepEqual(headers, { "content-type": "application/json", "x-vendor-event": "uplink" });
});

test("rate limits allow a burst, then refuse with a retry time; failed authentications ban an address", () => {
  let clock = 0;
  const buckets = new Buckets(10, 100, () => clock);
  for (let i = 0; i < 100; i++) assert.equal(buckets.take("a").ok, true);
  const refused = buckets.take("a");
  assert.equal(refused.ok, false);
  assert.ok(refused.retryAfter >= 1);
  assert.equal(buckets.take("b").ok, true);
  clock += 1000;
  assert.equal(buckets.take("a").ok, true);
  const limiter = new FailureLimiter(30, 300000, () => clock);
  for (let i = 0; i < 30; i++) limiter.fail("203.0.113.7");
  assert.equal(limiter.banned("203.0.113.7"), false);
  limiter.fail("203.0.113.7");
  assert.equal(limiter.banned("203.0.113.7"), true);
  clock += 300001;
  assert.equal(limiter.banned("203.0.113.7"), false);
});

test("a header token without a scheme is the raw secret, as the routing file writes it", () => {
  const token = "generated-token-with-enough-entropy";
  const route = { auth: { mode: "header", header: "x-api-token", scheme: null }, secrets: [{ uuid: "h", sha256: hashToken(token) }] };
  assert.equal(authenticate(route, { headers: { "x-api-token": token }, body, segments: [], now }).ok, true);
});
