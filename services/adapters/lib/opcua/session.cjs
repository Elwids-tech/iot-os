// Connecting to an OPC UA server: the address check, the endpoint and its certificate,
// sign-in, the server's limits and clock, and a session kept alive across failures
// (spec 038; failure reasons from contracts/api.md, reconnect from research R12).
const { EventEmitter } = require("node:events");
const crypto = require("node:crypto");
const os = require("node:os");
const path = require("node:path");
const {
  AttributeIds,
  MessageSecurityMode,
  OPCUAClient,
  SecurityPolicy,
  UserTokenType,
  VariableIds,
} = require("node-opcua-client");
const { keyOperationsFromPrivateKey } = require("node-opcua-crypto");
const { AddressNotAllowed, resolveAllowed } = require("./address.cjs");
const { OPCUACertificateManager } = require("node-opcua-certificate-manager");
const { CertificateChanged, der, pkiFolder, rankEndpoints, trustPinned } = require("./security.cjs");

const REASONS = {
  unreachable: {
    message: "The server's address could not be reached",
    fix: "Check the address and port, and that the server is running and reachable from the platform",
  },
  address_not_allowed: {
    message: "This address is not allowed for the organization",
    fix: "Use a public address, or ask the platform operator to allow the server's private range",
  },
  no_shared_security: {
    message: "The server does not offer the chosen security",
    fix: "Choose one of the security options the server offers, or enable Basic256Sha256 or stronger on the server",
  },
  server_certificate_changed: {
    message: "The server presented a different certificate from the one accepted",
    fix: "Check with the site that the server's certificate was renewed, then accept the new one",
  },
  client_certificate_untrusted: {
    message: "The server does not trust the platform's certificate",
    fix: "Download the platform's certificate and add it to the server's trusted certificates",
  },
  sign_in_refused: {
    message: "Sign-in was refused",
    fix: "Check the user name and password, or the certificate the server expects for this user",
  },
  server_busy: {
    message: "The server is too busy or allows no more sessions",
    fix: "Close another client's session, or raise the server's session limit",
  },
  clock_difference: {
    message: "The server's clock is too far from the platform's",
    fix: "Set the server's clock from a time server; certificates and timestamps depend on it",
  },
  timeout: {
    message: "The server did not answer in time",
    fix: "Check the network path to the server and that the server is not overloaded",
  },
};

const DEFAULTS = {
  timeoutMs: 15_000,
  maxClockDifferenceMs: 5 * 60_000,
  sessionTimeoutMs: 600_000,
};
const LIMIT_NAMES = [
  "MaxNodesPerRead",
  "MaxNodesPerBrowse",
  "MaxNodesPerTranslateBrowsePathsToNodeIds",
  "MaxMonitoredItemsPerCall",
];

class ConnectionFailed extends Error {
  constructor(reason, detail) {
    super(REASONS[reason].message);
    this.reason = reason;
    this.fix = REASONS[reason].fix;
    this.detail = detail ? String(detail.message || detail) : null;
  }

  toJSON() {
    return { reason: this.reason, message: this.message, fix: this.fix };
  }
}

// What a low-level error means to the person setting up the connection.
function classify(error, stage) {
  if (error instanceof ConnectionFailed) return error;
  if (error instanceof AddressNotAllowed) return new ConnectionFailed("address_not_allowed", error);
  if (error instanceof CertificateChanged) return new ConnectionFailed("server_certificate_changed", error);
  const text = `${error?.code || ""} ${error?.message || error}`;
  if (/BadTooManySessions|BadMaxConnectionsReached|BadTooManyOperations|BadServerHalted/.test(text))
    return new ConnectionFailed("server_busy", error);
  if (/BadUserAccessDenied|BadIdentityToken|BadUserSignatureInvalid/.test(text))
    return new ConnectionFailed("sign_in_refused", error);
  if (/BadCertificate|BadSecurityChecksFailed|BadNoValidCertificates/.test(text))
    return new ConnectionFailed("client_certificate_untrusted", error);
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|EHOSTDOWN|does not resolve/.test(text))
    return new ConnectionFailed("unreachable", error);
  if (/ETIMEDOUT|timeout|Timeout/.test(text)) return new ConnectionFailed("timeout", error);
  // The TCP connection opened and the server closed it before answering: a server at
  // its connection or session limit does exactly that.
  if (stage === "channel" && /ECONNRESET|premature|socket has been disconnected|Connection Break|closed/i.test(text))
    return new ConnectionFailed("server_busy", error);
  return new ConnectionFailed("unreachable", error);
}

function withTimeout(promise, ms, onTimeout) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        onTimeout?.();
        reject(new ConnectionFailed("timeout"));
      }, ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

// The URL to dial: the checked address in place of the name, so a later DNS answer
// cannot point the connection elsewhere.
async function dial(endpointUrl, network = {}) {
  let url;
  try {
    url = new URL(endpointUrl);
  } catch {
    throw new ConnectionFailed("unreachable", "Not an opc.tcp:// address");
  }
  if (url.protocol !== "opc.tcp:" || url.username || url.password)
    throw new ConnectionFailed("unreachable", "Use an opc.tcp:// address without credentials");
  let resolved;
  try {
    resolved = await resolveAllowed(url.hostname, network);
  } catch (error) {
    throw classify(error, "address");
  }
  // node-opcua cannot dial a bracketed IPv6 literal, so an IPv6-only server keeps its
  // checked name; an IPv4 address is dialled directly.
  const host = resolved.family === 6 ? url.hostname : resolved.address;
  return { url: `opc.tcp://${host}:${url.port || 4840}${url.pathname === "/" ? "" : url.pathname}`, address: resolved.address };
}

function client(options) {
  return OPCUAClient.create({
    applicationName: "IoT OS OPC UA connector",
    endpointMustExist: false,
    keepSessionAlive: true,
    requestedSessionTimeout: DEFAULTS.sessionTimeoutMs,
    connectionStrategy: { maxRetry: 0, initialDelay: 1000, maxDelay: 1000 },
    ...options,
  });
}

// Every client names its certificate store; left alone, node-opcua would make one in
// the user's home folder. Discovery and unencrypted sessions without a platform
// certificate use a store under `pkiRoot` (the runtime's data folder, or a temporary one).
const discoveryStores = new Map();
async function discoveryStore(pkiRoot = path.join(os.tmpdir(), "iot-os-opcua")) {
  const root = path.join(pkiRoot, "discovery");
  if (!discoveryStores.has(root)) {
    const manager = new OPCUACertificateManager({ rootFolder: root, automaticallyAcceptUnknownCertificate: false });
    discoveryStores.set(root, manager.initialize().then(() => manager));
  }
  return discoveryStores.get(root);
}

// What a server offers, asked over an unencrypted channel as every client must.
async function endpoints(endpointUrl, { network, timeoutMs = DEFAULTS.timeoutMs, pkiRoot, pki } = {}) {
  const { url } = await dial(endpointUrl, network);
  const discovery = client({ clientCertificateManager: await discoveryStore(pkiRoot || pki?.root) });
  try {
    await withTimeout(discovery.connect(url), timeoutMs, () => discovery.disconnect().catch(() => {}));
    return rankEndpoints(await discovery.getEndpoints());
  } catch (error) {
    throw classify(error, "channel");
  } finally {
    await discovery.disconnect().catch(() => {});
  }
}

function identity(auth = {}) {
  if (!auth.type || auth.type === "anonymous") return { type: UserTokenType.Anonymous };
  if (auth.type === "username") return { type: UserTokenType.UserName, userName: auth.username, password: auth.password };
  if (auth.type === "certificate") {
    // node-opcua-crypto's PrivateKey holds Node's key object as `hidden`.
    const keyOperations = keyOperationsFromPrivateKey({ hidden: crypto.createPrivateKey(auth.privateKey) });
    return { type: UserTokenType.Certificate, certificateData: der(auth.certificate), keyOperations };
  }
  throw Error(`Unknown sign-in ${auth.type}`);
}

async function readLimits(session) {
  const nodes = LIMIT_NAMES.map((name) => ({
    nodeId: `ns=0;i=${VariableIds[`Server_ServerCapabilities_OperationLimits_${name}`]}`,
    attributeId: AttributeIds.Value,
  }));
  const values = await session.read(nodes);
  const limits = {};
  LIMIT_NAMES.forEach((name, i) => {
    const value = values[i].statusCode.isGood() ? Number(values[i].value.value) : 0;
    limits[name] = value > 0 ? value : null; // 0 or missing: the server sets no limit
  });
  return limits;
}

async function clockDifference(session, now) {
  const value = await session.read({ nodeId: `ns=0;i=${VariableIds.Server_ServerStatus_CurrentTime}`, attributeId: AttributeIds.Value });
  const time = value.value?.value;
  return time instanceof Date ? time.getTime() - now() : null;
}

/**
 * Open one session.
 *
 * settings: {
 *   endpointUrl, security: { policy: "Basic256Sha256" | "None" | …, mode: "SignAndEncrypt" | "Sign" | "None" },
 *   serverFingerprint (the accepted SHA-256, required unless the policy is None),
 *   auth: { type: "anonymous" } | { type: "username", username, password } |
 *         { type: "certificate", certificate, privateKey },
 *   pki: { root, connection, certificate, privateKey } (the platform's certificate for it),
 *   network: { allowPrivate, privateRanges, platformRanges },
 *   timeoutMs, maxClockDifferenceMs, now
 * }
 */
async function open(settings) {
  const options = { ...DEFAULTS, ...settings };
  const now = options.now || Date.now;
  const policy = options.security?.policy || "None";
  const mode = options.security?.mode || (policy === "None" ? "None" : "SignAndEncrypt");
  const { url } = await dial(options.endpointUrl, options.network);
  const offered = await endpoints(options.endpointUrl, options);
  const chosen = offered.find((e) => e.policy === policy && e.mode === mode && !e.refused);
  if (!chosen) throw new ConnectionFailed("no_shared_security", `${policy} ${mode} is not offered`);
  const signIn = options.auth?.type || "anonymous";
  if (!chosen.sign_in.includes(signIn)) throw new ConnectionFailed("sign_in_refused", `${signIn} sign-in is not offered`);

  const clientOptions = {
    securityMode: MessageSecurityMode[mode],
    securityPolicy: SecurityPolicy[policy],
  };
  if (policy !== "None") {
    if (!options.pki) throw new ConnectionFailed("client_certificate_untrusted", "No platform certificate for this connection");
    const store = await pkiFolder(options.pki.root, options.pki.connection, options.pki);
    try {
      await trustPinned(store.manager, chosen.server_certificate, options.serverFingerprint);
    } catch (error) {
      throw Object.assign(classify(error, "certificate"), { presented: chosen.server_certificate });
    }
    Object.assign(clientOptions, {
      certificateFile: store.certificateFile,
      privateKeyFile: store.privateKeyFile,
      applicationUri: store.applicationUri,
      clientCertificateManager: store.manager,
      serverCertificate: chosen.server_certificate,
    });
  } else {
    if (options.serverFingerprint && chosen.server_fingerprint && chosen.server_fingerprint !== options.serverFingerprint)
      throw Object.assign(new ConnectionFailed("server_certificate_changed"), { presented: chosen.server_certificate });
    if (options.pki) {
      const store = await pkiFolder(options.pki.root, options.pki.connection, options.pki);
      Object.assign(clientOptions, {
        certificateFile: store.certificateFile,
        privateKeyFile: store.privateKeyFile,
        applicationUri: store.applicationUri,
        clientCertificateManager: store.manager,
      });
    } else {
      clientOptions.clientCertificateManager = await discoveryStore(options.pkiRoot);
    }
  }

  const opcua = client(clientOptions);
  let stage = "channel";
  try {
    await withTimeout(opcua.connect(url), options.timeoutMs, () => opcua.disconnect().catch(() => {}));
    stage = "session";
    const session = await withTimeout(opcua.createSession(identity(options.auth)), options.timeoutMs);
    const [namespaces, limits, difference] = await Promise.all([
      session.readNamespaceArray(),
      readLimits(session),
      clockDifference(session, now),
    ]);
    if (difference !== null && Math.abs(difference) > options.maxClockDifferenceMs) {
      await session.close().catch(() => {});
      throw new ConnectionFailed("clock_difference", `${Math.round(difference / 1000)} s`);
    }
    return {
      client: opcua,
      session,
      namespaces,
      limits,
      clockDifferenceMs: difference,
      security: { policy, mode, label: chosen.label, warning: chosen.warning, server_fingerprint: chosen.server_fingerprint },
      async close() {
        await session.close().catch(() => {});
        await opcua.disconnect().catch(() => {});
      },
    };
  } catch (error) {
    await opcua.disconnect().catch(() => {});
    throw classify(error, stage);
  }
}

// One session kept open: rebuilt after a failure with pauses growing from 1 second to
// 5 minutes. Emits "session" with each new session, "lost" when one drops and "failed"
// with the reason of each attempt that did not connect.
class Keeper extends EventEmitter {
  constructor(settings, { delays = { first: 1000, max: 300_000 } } = {}) {
    super();
    this.settings = settings;
    this.delays = delays;
    this.current = null;
    this.stopped = false;
    this.attempt = 0;
    this.timer = null;
  }

  start() {
    this.stopped = false;
    this._connect();
    return this;
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    const current = this.current;
    this.current = null;
    if (current) await current.close();
  }

  nextDelay() {
    return Math.min(this.delays.first * 2 ** Math.max(0, this.attempt - 1), this.delays.max);
  }

  async _connect() {
    if (this.stopped) return;
    this.attempt += 1;
    try {
      const connection = await open(this.settings);
      if (this.stopped) return connection.close();
      this.attempt = 0;
      this.current = connection;
      const lost = () => this._lost(connection);
      connection.client.once("connection_lost", lost);
      connection.client.once("close", lost);
      connection.session.once("session_closed", lost);
      this.emit("session", connection);
    } catch (error) {
      this.emit("failed", classify(error));
      this._later();
    }
  }

  _lost(connection) {
    if (this.current !== connection) return;
    this.current = null;
    this.emit("lost");
    connection.close();
    this._later();
  }

  _later() {
    if (this.stopped) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this._connect(), this.nextDelay());
    this.timer.unref?.();
  }
}

module.exports = { ConnectionFailed, Keeper, REASONS, classify, dial, endpoints, open };
