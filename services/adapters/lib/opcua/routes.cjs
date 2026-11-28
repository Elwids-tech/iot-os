// The adapter manager's OPC UA routes (spec 038, contracts/manager-api.md): what a server
// offers, testing a connection, and browsing it before anything is deployed. Laravel
// sends the connection, its secrets and the organization's private ranges with each
// call. A session is kept per connection and closed after 2 idle minutes (research R8).
//
// A connection that cannot be made answers { reason, message, fix } with HTTP 200, so
// the API can show the reason and its fix.
const crypto = require("node:crypto");
const os = require("node:os");
const path = require("node:path");
const { exploreCertificate } = require("node-opcua-crypto");
const { children, read, search, similar } = require("./browse.cjs");
const { check } = require("./check.cjs");
const { checkRanges } = require("./address.cjs");
const { ConnectionFailed, endpoints, open } = require("./session.cjs");

const IDLE_MS = 2 * 60_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function ensure(condition, message) {
  if (!condition) throw Error(message);
}

function certificateInfo(der) {
  if (!der) return null;
  const buffer = Buffer.from(der);
  const info = exploreCertificate(buffer).tbsCertificate;
  const names = { commonName: "CN", organizationName: "O", organizationalUnitName: "OU", localityName: "L", stateOrProvinceName: "ST", countryName: "C", domainComponent: "DC" };
  const subject = Object.entries(info.subject || {})
    .filter(([key, value]) => names[key] && typeof value === "string")
    .map(([key, value]) => `${names[key]}=${value}`)
    .join(", ");
  return {
    subject,
    fingerprint: crypto.createHash("sha256").update(buffer).digest("hex"),
    valid_from: info.validity?.notBefore?.toISOString?.() ?? null,
    valid_to: info.validity?.notAfter?.toISOString?.() ?? null,
    application_uri: info.extensions?.subjectAltName?.uniformResourceIdentifier?.[0] ?? null,
    der: buffer.toString("base64"),
  };
}

// The session settings of a connection as Laravel sends it: the connection, its secrets
// and the organization's private ranges. Shared by the manager's routes and the tenant
// runtime's source.
function settingsOf(body, { pkiRoot, allowPrivate = false }) {
  const c = body.connection || {};
  ensure(UUID.test(String(c.uuid)), "A connection uuid is required");
  ensure(typeof c.endpoint_url === "string" && c.endpoint_url.startsWith("opc.tcp://"), "An opc.tcp:// endpoint is required");
  const secrets = body.secrets || {};
  const platformRanges = body.platform_ranges || [];
  const privateRanges = checkRanges(body.private_ranges || [], platformRanges);
  const identity = c.identity || "anonymous";
  return {
    endpointUrl: c.endpoint_url,
    security: { policy: c.security_policy || "None", mode: c.security_mode || "None" },
    serverFingerprint: c.server_fingerprint || null,
    auth: identity === "username" ? { type: "username", username: secrets.username, password: secrets.password }
      : identity === "certificate" ? { type: "certificate", certificate: secrets.user_certificate, privateKey: secrets.user_private_key }
        : { type: "anonymous" },
    pki: secrets.client_certificate
      ? { root: pkiRoot, connection: c.uuid, certificate: secrets.client_certificate, privateKey: secrets.client_private_key }
      : null,
    pkiRoot,
    network: { allowPrivate, privateRanges, platformRanges },
  };
}

class Routes {
  constructor({ pkiRoot = path.join(os.tmpdir(), "iot-os-opcua"), allowPrivate = () => false, idleMs = IDLE_MS } = {}) {
    this.pkiRoot = pkiRoot;
    this.allowPrivate = allowPrivate;
    this.idleMs = idleMs;
    this.sessions = new Map(); // connection uuid -> { key, connection: Promise, timer }
  }

  settings(body) {
    return settingsOf(body, { pkiRoot: this.pkiRoot, allowPrivate: this.allowPrivate() });
  }

  // One session per connection, replaced when its settings change.
  async session(body) {
    const settings = this.settings(body);
    const uuid = body.connection.uuid;
    const key = crypto.createHash("sha256").update(JSON.stringify(settings)).digest("hex");
    let held = this.sessions.get(uuid);
    if (held && held.key !== key) {
      await this.close(uuid);
      held = null;
    }
    if (!held) {
      held = { key, connection: open(settings), timer: null };
      this.sessions.set(uuid, held);
      held.connection.catch(() => this.sessions.get(uuid) === held && this.sessions.delete(uuid));
      held.connection.then((c) => c.client.once("close", () => this.sessions.get(uuid) === held && this.sessions.delete(uuid)), () => {});
    }
    clearTimeout(held.timer);
    held.timer = setTimeout(() => this.close(uuid), this.idleMs);
    held.timer.unref?.();
    return held.connection;
  }

  async close(uuid) {
    const held = this.sessions.get(uuid);
    if (!held) return;
    this.sessions.delete(uuid);
    clearTimeout(held.timer);
    const connection = await held.connection.catch(() => null);
    await connection?.close();
  }

  async closeAll() {
    await Promise.all([...this.sessions.keys()].map((uuid) => this.close(uuid)));
  }

  // A failure to connect answers its reason; anything else is a request error.
  async guarded(run) {
    try {
      return await run();
    } catch (error) {
      if (error instanceof ConnectionFailed) {
        const answer = error.toJSON();
        if (error.reason === "server_certificate_changed" && error.presented) answer.server_certificate = certificateInfo(error.presented);
        return answer;
      }
      // A session that broke under a call is dropped, so the next call opens a new one.
      if (/BadSession|closed|disconnected|ECONNRESET/i.test(String(error?.message))) {
        return new ConnectionFailed("unreachable", error).toJSON();
      }
      throw error;
    }
  }

  async handle(route, body) {
    switch (route) {
      case "/opcua/endpoints":
        return this.guarded(async () => {
          const settings = this.settings(body);
          const offered = await endpoints(settings.endpointUrl, settings);
          return { endpoints: offered.map(({ server_certificate: der, ...rest }) => ({ ...rest, server_certificate: certificateInfo(der) })) };
        });
      case "/opcua/test":
        return this.guarded(async () => {
          await this.close(body.connection?.uuid);
          const connection = await this.session(body);
          return { connected: true, limits: connection.limits, clock_difference_ms: connection.clockDifferenceMs, security: connection.security };
        });
      case "/opcua/browse":
        return this.guarded(async () => children(await this.session(body), body.parent || null, { cursor: body.cursor || null }));
      case "/opcua/read":
        return this.guarded(async () => {
          ensure(Array.isArray(body.points) && body.points.length >= 1 && body.points.length <= 200, "Read 1 to 200 points");
          return { points: await read(await this.session(body), body.points) };
        });
      case "/opcua/search":
        return this.guarded(async () => {
          ensure(typeof body.text === "string" && body.text.trim().length > 0, "Search for some text");
          return search(await this.session(body), body.root || null, body.text.trim());
        });
      case "/opcua/similar":
        return this.guarded(async () => {
          const e = body.equipment || {};
          ensure(typeof e.namespace_uri === "string" && Array.isArray(e.path) && e.path.length > 0, "Name the equipment with its namespace URI and path");
          ensure(Array.isArray(body.points) && body.points.length >= 1 && body.points.length <= 500, "Name 1 to 500 points");
          const by = body.by || "type";
          ensure(["type", "names", "pattern"].includes(by), "Look for similar equipment by type, names or pattern");
          const found = await similar(await this.session(body), e, body.points, { by, root: body.root || null });
          return { matches: [...found], truncated: Boolean(found.truncated) };
        });
      case "/opcua/check":
        return this.guarded(async () => {
          const map = body.point_map;
          ensure(map && Array.isArray(map.readings) && Array.isArray(map.equipment), "A point map is required");
          return check(await this.session(body), map);
        });
      default:
        return undefined;
    }
  }
}

module.exports = { Routes, certificateInfo, settingsOf };
