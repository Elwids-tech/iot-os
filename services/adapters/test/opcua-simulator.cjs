// Starts the simulated building of spec 038 (tooling/simulators/bms_server.py) for a
// test: free ports, its own sign-in file and certificates, and helpers for its control
// port. Needs a Python with the simulator's requirements: IOT_BMS_SIMULATOR_PYTHON, or
// python3. Without one the live tests skip, unless IOT_BMS_SIMULATOR_REQUIRED is set
// (as in CI), when they fail.
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const SERVER = path.resolve(__dirname, "../../../tooling/simulators/bms_server.py");
const PYTHON = process.env.IOT_BMS_SIMULATOR_PYTHON || "python3";
const NAMESPACE = "urn:example:bms:example-tower";

let available;
function simulatorAvailable() {
  if (available === undefined) {
    const check = spawnSync(PYTHON, ["-c", "import asyncua, yaml, jsonschema"], { stdio: "ignore" });
    available = check.status === 0;
    if (!available && process.env.IOT_BMS_SIMULATOR_REQUIRED)
      throw Error(`The BMS simulator needs ${PYTHON} with tooling/simulators/requirements.txt installed`);
  }
  return available;
}

// node:test option: skip a live test when no simulator can run here.
function live() {
  return simulatorAvailable() ? {} : { skip: "no Python with the BMS simulator's requirements" };
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function start(args = [], { folder } = {}) {
  const port = await freePort();
  const controlPort = await freePort();
  const home = folder || fs.mkdtempSync(path.join(os.tmpdir(), "bms-"));
  const secrets = path.join(home, "bms-simulator.json");
  const certificates = path.join(home, "certificates");
  const child = spawn(
    PYTHON,
    [SERVER, "--port", String(port), "--control-port", String(controlPort), "--secrets", secrets,
      "--certificates", certificates, "--speed", "60", ...args],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let output = "";
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error(`The simulator did not start:\n${output}`)), 60_000);
    const seen = (chunk) => {
      output += chunk;
      if (output.includes("controls at")) {
        clearTimeout(timer);
        resolve();
      }
    };
    child.stdout.on("data", seen);
    child.stderr.on("data", (chunk) => (output += chunk));
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(Error(`The simulator exited (${code}):\n${output}`));
    });
  });
  const control = `http://127.0.0.1:${controlPort}`;
  const call = async (method, route, body) => {
    const response = await fetch(control + route, {
      method,
      headers: body ? { "content-type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    return response.json();
  };
  const sign = JSON.parse(fs.readFileSync(secrets, "utf8"));
  return {
    url: `opc.tcp://127.0.0.1:${port}/`,
    port,
    home,
    certificates,
    operator: {
      username: "operator",
      password: sign.operator.password,
      certificate: fs.readFileSync(sign.operator.certificate),
      privateKey: fs.readFileSync(sign.operator.private_key, "utf8"),
    },
    serverFingerprint: () => JSON.parse(fs.readFileSync(secrets, "utf8")).server.fingerprint,
    state: () => call("GET", "/state"),
    scenario: (name, on = true, target = null) => call("POST", `/scenarios/${name}`, { on, target }),
    write: (point, value) => call("POST", "/write", { point, value }),
    values: (...points) => call("GET", `/values?points=${points.join(",")}`),
    async stop() {
      if (child.exitCode === null) {
        child.kill("SIGTERM");
        await new Promise((resolve) => child.once("exit", resolve));
      }
      if (!folder) fs.rmSync(home, { recursive: true, force: true });
    },
  };
}

// A platform certificate for a connection, made here the way Laravel will make it.
async function platformCertificate(connection = "test-connection") {
  const crypto = require("node-opcua-crypto");
  const key = await crypto.generatePrivateKey(2048);
  const { privPem } = await crypto.privateKeyToPEM(key);
  const { cert } = await crypto.createSelfSignedCertificate({
    privateKey: key,
    subject: "/CN=IoT OS OPC UA connector",
    applicationUri: `urn:iot-os:test:opcua:${connection}`,
    purpose: crypto.CertificatePurpose.ForApplication,
    validity: 365,
  });
  return { certificate: cert, privateKey: privPem };
}

module.exports = { NAMESPACE, freePort, live, platformCertificate, simulatorAvailable, start };
