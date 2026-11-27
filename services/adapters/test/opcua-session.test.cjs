// Connecting to the simulated building: every security and sign-in choice, every
// failure reason, and a session kept across a server restart (spec 038 PR 2).
const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { after, before, describe, test } = require("node:test");
const { ConnectionFailed, Keeper, endpoints, open } = require("../lib/opcua/session.cjs");
const { NAMESPACE, freePort, live, platformCertificate, start } = require("./opcua-simulator.cjs");

const network = { allowPrivate: true }; // the simulator runs on loopback

describe("an OPC UA session", live(), () => {
  let sim;
  let platform;
  let pkiRoot;
  before(async () => {
    sim = await start();
    platform = await platformCertificate();
    pkiRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pki-"));
  });
  after(async () => {
    await sim?.stop();
    fs.rmSync(pkiRoot, { recursive: true, force: true });
  });

  const settings = (extra = {}) => ({
    endpointUrl: sim.url,
    network,
    pki: { root: pkiRoot, connection: "one", ...platform },
    serverFingerprint: sim.serverFingerprint(),
    ...extra,
  });

  async function failsWith(reason, promise) {
    await assert.rejects(promise, (error) => {
      assert.ok(error instanceof ConnectionFailed, `${error}`);
      assert.equal(error.reason, reason);
      assert.ok(error.message && error.fix);
      return true;
    });
  }

  test("lists what the server offers, strongest first", async () => {
    const offered = await endpoints(sim.url, { network });
    assert.deepEqual(offered.map((e) => `${e.policy} ${e.mode}`), ["Basic256Sha256 SignAndEncrypt", "None None"]);
    assert.equal(offered[0].label, "Encrypted (Basic256Sha256)");
    assert.equal(offered[1].warning, "Values and sign-in travel unencrypted");
    assert.deepEqual(offered[0].sign_in.sort(), ["anonymous", "certificate", "username"]);
    assert.equal(offered[0].server_fingerprint, sim.serverFingerprint());
  });

  for (const policy of ["None", "Basic256Sha256"]) {
    for (const auth of ["anonymous", "username", "certificate"]) {
      test(`connects with ${policy} and ${auth} sign-in, and reads`, async () => {
        const signIn = {
          anonymous: { type: "anonymous" },
          username: { type: "username", username: "operator", password: sim.operator.password },
          certificate: { type: "certificate", certificate: sim.operator.certificate, privateKey: sim.operator.privateKey },
        }[auth];
        const connection = await open(settings({ security: { policy }, auth: signIn }));
        try {
          assert.equal(connection.security.policy, policy);
          assert.ok(connection.namespaces.includes(NAMESPACE));
          assert.equal(connection.limits.MaxNodesPerRead, 10000);
          assert.ok(Math.abs(connection.clockDifferenceMs) < 60_000);
          const index = connection.namespaces.indexOf(NAMESPACE);
          const value = await connection.session.read({ nodeId: `ns=${index};s=L03-VAV-2.zone_temperature`, attributeId: 13 });
          assert.ok(value.statusCode.isGood());
          assert.ok(value.value.value > 10 && value.value.value < 35);
        } finally {
          await connection.close();
        }
      });
    }
  }

  test("refuses a closed port as unreachable", async () => {
    await failsWith("unreachable", open({ ...settings(), endpointUrl: `opc.tcp://127.0.0.1:${await freePort()}/` }));
  });

  test("refuses a private address unless the organization allows it", async () => {
    await failsWith("address_not_allowed", open({ ...settings(), network: {} }));
    await failsWith("address_not_allowed", open({ ...settings(), network: { privateRanges: ["127.0.0.0/8"] } }));
  });

  test("refuses a certificate other than the accepted one", async () => {
    await failsWith("server_certificate_changed", open(settings({ security: { policy: "Basic256Sha256" }, serverFingerprint: "00".repeat(32) })));
  });

  test("refuses the wrong password", async () => {
    await failsWith("sign_in_refused", open(settings({ auth: { type: "username", username: "operator", password: "not-it" } })));
  });

  test("notices a server clock far from its own", async () => {
    await failsWith("clock_difference", open(settings({ now: () => Date.now() + 3_600_000 })));
  });

  test("gives up on a server that never answers", async () => {
    const silent = net.createServer(() => {});
    await new Promise((resolve) => silent.listen(0, "127.0.0.1", resolve));
    try {
      await failsWith("timeout", open({ ...settings(), endpointUrl: `opc.tcp://127.0.0.1:${silent.address().port}/`, timeoutMs: 1500 }));
    } finally {
      silent.close();
    }
  });

  test("calls a full server busy", async () => {
    const first = await open(settings());
    await sim.scenario("session_limit", true);
    try {
      await failsWith("server_busy", open(settings()));
    } finally {
      await sim.scenario("session_limit", false);
      await first.close();
    }
  });

  test("keeps a session across a server restart", async () => {
    const keeper = new Keeper(settings(), { delays: { first: 500, max: 2000 } });
    const sessions = [];
    const events = [];
    keeper.on("session", (connection) => sessions.push(connection));
    keeper.on("lost", () => events.push("lost"));
    keeper.on("failed", (error) => events.push(error.reason));
    keeper.start();
    try {
      await waitFor(() => sessions.length === 1);
      await sim.scenario("server_restart", true, 2);
      await waitFor(() => sessions.length === 2, 30_000);
      assert.equal(events[0], "lost");
      const index = sessions[1].namespaces.indexOf(NAMESPACE);
      const value = await sessions[1].session.read({ nodeId: `ns=${index};s=RF-WX-1.outdoor_temperature`, attributeId: 13 });
      assert.ok(value.statusCode.isGood());
    } finally {
      await keeper.stop();
    }
  });
});

describe("a server with fewer choices", live(), () => {
  test("refuses security it does not offer", async () => {
    const sim = await start(["--security", "none"]);
    try {
      await assert.rejects(open({ endpointUrl: sim.url, network, security: { policy: "Basic256Sha256" } }), { reason: "no_shared_security" });
      await assert.rejects(open({ endpointUrl: sim.url, network, security: { policy: "Basic256" } }), { reason: "no_shared_security" });
    } finally {
      await sim.stop();
    }
  });

  test("names an untrusted platform certificate", async () => {
    const sim = await start(["--strict-trust"]);
    const pkiRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pki-"));
    const platform = await platformCertificate("strict");
    const settings = {
      endpointUrl: sim.url,
      network,
      security: { policy: "Basic256Sha256" },
      serverFingerprint: sim.serverFingerprint(),
      pki: { root: pkiRoot, connection: "strict", ...platform },
    };
    try {
      await assert.rejects(open(settings), { reason: "client_certificate_untrusted" });
      // The site adds the platform's certificate to its trusted list; then it connects.
      const rejected = fs.readdirSync(path.join(sim.certificates, "rejected"));
      assert.equal(rejected.length, 1);
      fs.copyFileSync(path.join(sim.certificates, "rejected", rejected[0]), path.join(sim.certificates, "trusted", rejected[0]));
      const connection = await open(settings);
      await connection.close();
    } finally {
      await sim.stop();
      fs.rmSync(pkiRoot, { recursive: true, force: true });
    }
  });
});

async function waitFor(check, timeout = 15_000) {
  const until = Date.now() + timeout;
  while (!check()) {
    if (Date.now() > until) throw Error("timed out waiting");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
