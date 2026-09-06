#!/usr/bin/env node
import { readFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const metadata = JSON.parse(
  readFileSync(resolve(root, "contracts/sparkplug/upstream.json"), "utf8"),
)
const source = readFileSync(
  resolve(root, "contracts/sparkplug/sparkplug_b.proto"),
)
if (createHash("sha256").update(source).digest("hex") !== metadata.sha256)
  throw new Error(
    "The vendored official protobuf does not match its recorded checksum",
  )
const protoc = process.env.PROTOC ?? "protoc"
const version = spawnSync(protoc, ["--version"], { encoding: "utf8" })
if (
  version.status !== 0 ||
  version.stdout.trim() !== "libprotoc " + metadata.protoc
)
  throw new Error(`Use protoc ${metadata.protoc}; set PROTOC to its executable`)
const run = (args) => {
  const result = spawnSync(protoc, args, { cwd: root, stdio: "inherit" })
  if (result.status !== 0) process.exit(result.status ?? 1)
}
run([
  "-Icontracts/sparkplug",
  "--go_out=services/runtime/internal/sparkplug/pb",
  "--go_opt=paths=source_relative",
  "--go_opt=Msparkplug_b.proto=github.com/Elwids-tech/iot-os/services/runtime/internal/sparkplug/pb",
  "contracts/sparkplug/sparkplug_b.proto",
])
run([
  "-Icontracts/sparkplug",
  "--python_out=tooling/simulators",
  "contracts/sparkplug/sparkplug_b.proto",
])
console.log(
  `Generated Go and Python bindings from Eclipse Tahu ${metadata.commit}`,
)
