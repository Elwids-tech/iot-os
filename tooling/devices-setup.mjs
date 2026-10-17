#!/usr/bin/env node
import {
  mkdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
  chmodSync,
  rmSync,
} from "node:fs"
import { resolve, join } from "node:path"
import { generateKeyPairSync, randomBytes } from "node:crypto"
import { spawnSync } from "node:child_process"

const directory = resolve(process.argv[2] ?? ".local/devices")
mkdirSync(directory, { recursive: true, mode: 0o700 })
const certs = join(directory, "certs")
mkdirSync(certs, { recursive: true, mode: 0o755 })
const envFile = join(directory, "devices.env")
const existing = existsSync(envFile)
  ? Object.fromEntries(
      readFileSync(envFile, "utf8")
        .trim()
        .split("\n")
        .map((line) => {
          const i = line.indexOf("=")
          return [line.slice(0, i), line.slice(i + 1)]
        }),
    )
  : {}
// Agent token signing keys (spec 004), kept across runs. Compose reads \n inside double quotes.
function passportKeys() {
  if (existing.PASSPORT_PRIVATE_KEY && existing.PASSPORT_PUBLIC_KEY)
    return { PASSPORT_PRIVATE_KEY: existing.PASSPORT_PRIVATE_KEY, PASSPORT_PUBLIC_KEY: existing.PASSPORT_PUBLIC_KEY }
  const pair = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  })
  return {
    PASSPORT_PRIVATE_KEY: JSON.stringify(pair.privateKey),
    PASSPORT_PUBLIC_KEY: JSON.stringify(pair.publicKey),
  }
}
const values = {
  DEVICE_CERT_DIR: certs,
  DEVICE_RUNTIME_TOKEN:
    existing.DEVICE_RUNTIME_TOKEN ?? randomBytes(32).toString("hex"),
  // broker-admin's bearer token and the Mosquitto Dynamic Security admin password (ADR-019).
  DEVICE_BROKER_ADMIN_TOKEN:
    existing.DEVICE_BROKER_ADMIN_TOKEN ?? randomBytes(32).toString("hex"),
  MOSQUITTO_ADMIN_PASSWORD:
    existing.MOSQUITTO_ADMIN_PASSWORD ?? randomBytes(32).toString("hex"),
  DEVICE_TEST_DB_PASSWORD:
    existing.DEVICE_TEST_DB_PASSWORD ?? randomBytes(24).toString("hex"),
  ...passportKeys(),
}
writeFileSync(
  envFile,
  Object.entries(values)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n") + "\n",
  { mode: 0o600 },
)
chmodSync(envFile, 0o600)
function openssl(args) {
  const result = spawnSync("openssl", args, { cwd: certs, encoding: "utf8" })
  if (result.status !== 0)
    throw new Error(`Local certificate generation failed: ${result.stderr}`)
  return result.stdout
}
// Devices trust this CA, so it is kept; only the server certificate is reissued.
if (!existsSync(join(certs, "ca.crt"))) {
  openssl([
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-days",
    "365",
    "-keyout",
    "ca.key",
    "-out",
    "ca.crt",
    "-subj",
    "/CN=IoT Devices Local CA",
  ])
  chmodSync(join(certs, "ca.key"), 0o600)
}
// The broker's hostname inside Compose is mqtt. Certificates issued for the old
// EMQX service name are replaced. `-text` works with both OpenSSL and LibreSSL.
const serverCertificate = join(certs, "server.crt")
if (
  !existsSync(serverCertificate) ||
  !openssl(["x509", "-in", "server.crt", "-noout", "-text"]).includes("DNS:mqtt")
) {
  openssl([
    "req",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    "server.key",
    "-out",
    "server.csr",
    "-subj",
    "/CN=mqtt",
  ])
  writeFileSync(
    join(certs, "server.ext"),
    "subjectAltName=DNS:mqtt,DNS:localhost,IP:127.0.0.1\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n",
  )
  openssl([
    "x509",
    "-req",
    "-in",
    "server.csr",
    "-CA",
    "ca.crt",
    "-CAkey",
    "ca.key",
    "-CAcreateserial",
    "-out",
    "server.crt",
    "-days",
    "365",
    "-extfile",
    "server.ext",
  ])
}
// EMQX's bootstrap API keys; nothing reads them any more.
rmSync(join(certs, "api-keys"), { force: true })
// The containing setup directory is private. The broker's unprivileged UID must read its mounted files.
chmodSync(join(certs, "server.key"), 0o644)
console.log(`Device setup ready. Private environment: ${envFile}`)
