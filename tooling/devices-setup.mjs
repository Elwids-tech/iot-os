#!/usr/bin/env node
import {
  mkdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
  chmodSync,
} from "node:fs"
import { resolve, join } from "node:path"
import { randomBytes } from "node:crypto"
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
const values = {
  DEVICE_CERT_DIR: certs,
  DEVICE_RUNTIME_TOKEN:
    existing.DEVICE_RUNTIME_TOKEN ?? randomBytes(32).toString("hex"),
  DEVICE_EMQX_API_KEY:
    existing.DEVICE_EMQX_API_KEY ?? randomBytes(10).toString("hex"),
  DEVICE_EMQX_API_SECRET:
    existing.DEVICE_EMQX_API_SECRET ?? randomBytes(24).toString("hex"),
  DEVICE_TEST_DB_PASSWORD:
    existing.DEVICE_TEST_DB_PASSWORD ?? randomBytes(24).toString("hex"),
  DEVICE_TEST_COOKIE:
    existing.DEVICE_TEST_COOKIE ?? randomBytes(24).toString("hex"),
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
}
if (!existsSync(join(certs, "server.crt"))) {
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
    "/CN=emqx",
  ])
  writeFileSync(
    join(certs, "server.ext"),
    "subjectAltName=DNS:emqx,DNS:localhost,IP:127.0.0.1\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n",
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
  chmodSync(join(certs, "ca.key"), 0o600)
}
// The containing setup directory is private. The broker's unprivileged UID must read its mounted files.
writeFileSync(
  join(certs, "api-keys"),
  `${values.DEVICE_EMQX_API_KEY}:${values.DEVICE_EMQX_API_SECRET}:administrator\n`,
  { mode: 0o644 },
)
chmodSync(join(certs, "server.key"), 0o644)
console.log(`Device setup ready. Private environment: ${envFile}`)
