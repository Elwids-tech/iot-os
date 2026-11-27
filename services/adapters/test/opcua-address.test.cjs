// The shared address check (spec 038, research R10), the point map rules and the
// ranking of what a server offers.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { allowedAddress, checkRanges, inRange, publicAddress, resolveAllowed } = require("../lib/opcua/address.cjs");
const { pointCount, problems } = require("../lib/opcua/point-map.cjs");
const { rankEndpoints } = require("../lib/opcua/security.cjs");

const CONTRACT = path.resolve(__dirname, "../../../contracts/pointmaps/v1");

test("public addresses pass, private ones only in an allowed range", () => {
  assert.equal(allowedAddress("8.8.8.8"), true);
  assert.equal(allowedAddress("2606:4700:4700::1111"), true);
  assert.equal(allowedAddress("10.20.30.40"), false);
  assert.equal(allowedAddress("10.20.30.40", { privateRanges: ["10.20.0.0/16"] }), true);
  assert.equal(allowedAddress("10.21.30.40", { privateRanges: ["10.20.0.0/16"] }), false);
  assert.equal(allowedAddress("fd12:3456::7", { privateRanges: ["fd12:3456::/32"] }), true);
  assert.equal(allowedAddress("::ffff:10.20.30.40", { privateRanges: ["10.20.0.0/16"] }), true);
});

test("loopback, link-local, metadata and the platform's networks are never reachable", () => {
  const wide = { privateRanges: ["0.0.0.0/0", "::/0"], platformRanges: ["172.18.0.0/16"] };
  for (const address of ["127.0.0.1", "169.254.169.254", "100.100.100.200", "::1", "fe80::1", "fd00:ec2::254", "172.18.0.5", "::ffff:127.0.0.1"])
    assert.equal(allowedAddress(address, wide), false, address);
  assert.equal(allowedAddress("not an address"), false);
});

test("an operator's range may not include what is never reachable", () => {
  assert.deepEqual(checkRanges(["10.20.0.0/16", "192.0.2.0/24"]), ["10.20.0.0/16", "192.0.2.0/24"]);
  assert.throws(() => checkRanges(["127.0.0.0/8"]), /never reachable/);
  assert.throws(() => checkRanges(["169.254.0.0/16"]), /never reachable/);
  assert.throws(() => checkRanges(["0.0.0.0/0"]), /never reachable/);
  assert.throws(() => checkRanges(["172.16.0.0/12"], ["172.18.0.0/16"]), /never reachable/);
  assert.throws(() => checkRanges(["10.0.0.0/33"]), /Not a network range/);
  assert.equal(inRange("192.0.2.17", "192.0.2.0/27"), true);
  assert.equal(inRange("192.0.2.17", "192.0.2.0/28"), false);
});

test("the broker check keeps its own rule", () => {
  assert.equal(publicAddress("8.8.8.8"), true);
  assert.equal(publicAddress("192.168.1.1"), false);
  assert.equal(publicAddress("2001:db8::1"), false);
});

test("a name is resolved and every address it has is checked", async () => {
  await assert.rejects(resolveAllowed("localhost"), { reason: "address_not_allowed" });
  assert.equal((await resolveAllowed("localhost", { allowPrivate: true })).address.length > 0, true);
  assert.deepEqual(await resolveAllowed("[2606:4700:4700::1111]"), { address: "2606:4700:4700::1111", family: 6 });
});

test("point map rules agree with the contract's rule cases", () => {
  const cases = JSON.parse(fs.readFileSync(path.join(CONTRACT, "point-map.v1.rules.json"), "utf8"));
  for (const c of cases) assert.deepEqual(problems(c.data), c.problems, c.description);
  const fixture = JSON.parse(fs.readFileSync(path.join(CONTRACT, "point-map.v1.fixture.json"), "utf8"));
  assert.equal(pointCount(fixture), 6 + 5); // the core box lacks carbon dioxide
});

test("what a server offers is ranked strongest first, unsafe policies refused", () => {
  const uri = (name) => `http://opcfoundation.org/UA/SecurityPolicy#${name}`;
  const offered = [
    { securityPolicyUri: uri("None"), securityMode: 1, userIdentityTokens: [{ tokenType: 0 }] },
    { securityPolicyUri: uri("Basic256"), securityMode: 3, userIdentityTokens: [] },
    { securityPolicyUri: uri("Basic256Sha256"), securityMode: 2, userIdentityTokens: [{ tokenType: 1 }] },
    { securityPolicyUri: uri("Aes256_Sha256_RsaPss"), securityMode: 3, userIdentityTokens: [{ tokenType: 2 }] },
    { securityPolicyUri: uri("Basic256Sha256"), securityMode: 3, userIdentityTokens: [{ tokenType: 0 }, { tokenType: 1 }] },
  ];
  const ranked = rankEndpoints(offered);
  assert.deepEqual(ranked.map((e) => `${e.policy} ${e.mode}`), [
    "Aes256_Sha256_RsaPss SignAndEncrypt", "Basic256Sha256 SignAndEncrypt", "Basic256Sha256 Sign", "None None", "Basic256 SignAndEncrypt",
  ]);
  assert.equal(ranked.at(-1).refused, "unsafe");
  assert.equal(ranked[3].warning, "Values and sign-in travel unencrypted");
  assert.deepEqual(ranked[1].sign_in, ["anonymous", "username"]);
});
