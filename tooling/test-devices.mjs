#!/usr/bin/env node
import { spawn } from "node:child_process"
import { mkdtempSync, readFileSync, writeFileSync, openSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, resolve, join } from "node:path"
import { fileURLToPath } from "node:url"
import { createServer } from "node:net"
import { randomBytes } from "node:crypto"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const directory = mkdtempSync(join(tmpdir(), "iot-devices-v1-"))
const project = "iot-devices-test-" + randomBytes(3).toString("hex")
const ports = {
  postgres: 55435,
  mqtt: 18885,
  emqx: 18086,
  nats: 14225,
  api: 8016,
  runtime: 8086,
  portal: 4176,
  admin: 4177,
}
const children = []
let baseEnv = { ...process.env }
let dockerStarted = false
let cleaning = false
const compose = [
  "compose",
  "--project-name",
  project,
  "--env-file",
  join(directory, "devices.env"),
  "-f",
  join(root, "deploy/compose/compose.devices-test.yml"),
]

async function available(port) {
  await new Promise((resolve, reject) => {
    const server = createServer()
    server.once("error", reject)
    server.listen(port, "127.0.0.1", () => server.close(resolve))
  })
}
function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? root,
      env: options.env ?? baseEnv,
      stdio: options.stdio ?? "pipe",
    })
    let output = ""
    child.stdout?.on("data", (bytes) => {
      output += bytes
    })
    child.stderr?.on("data", (bytes) => {
      output += bytes
    })
    child.on("error", reject)
    child.on("exit", (code) =>
      code === 0
        ? resolve(output)
        : reject(
            new Error(`${command} failed (${code}): ${output.slice(-6000)}`),
          ),
    )
  })
}
function background(name, command, args, options = {}) {
  const log = openSync(join(directory, `${name}.log`), "a", 0o600)
  const child = spawn(command, args, {
    cwd: options.cwd ?? root,
    env: options.env ?? baseEnv,
    stdio: ["ignore", log, log],
    detached: true,
  })
  writeFileSync(
    join(directory, `${name}-process.json`),
    JSON.stringify({
      pid: child.pid,
      command,
      args,
      cwd: options.cwd ?? root,
      env: options.env ?? baseEnv,
    }),
    { mode: 0o600 },
  )
  children.push(child)
  child.on("exit", (code) => {
    if (!cleaning)
      console.error(`${name} exited (${code}); see ${directory}/${name}.log`)
  })
  return child
}
async function waitFor(url, seconds = 60) {
  const deadline = Date.now() + seconds * 1000
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`Service did not become ready: ${url}`)
}
async function cleanup() {
  if (cleaning) return
  cleaning = true
  for (const child of children.reverse()) {
    try {
      process.kill(-child.pid, "SIGTERM")
    } catch {}
  }
  if (dockerStarted)
    await run("docker", [
      ...compose,
      "down",
      "--volumes",
      "--remove-orphans",
    ]).catch(console.error)
}
process.on("SIGINT", () => cleanup().then(() => process.exit(0)))
process.on("SIGTERM", () => cleanup().then(() => process.exit(0)))

try {
  for (const port of Object.values(ports)) await available(port)
  console.log(`Isolated Devices environment: ${directory}`)
  await run(process.execPath, ["tooling/devices-setup.mjs", directory])
  const secrets = Object.fromEntries(
    readFileSync(join(directory, "devices.env"), "utf8")
      .trim()
      .split("\n")
      .map((line) => {
        const i = line.indexOf("=")
        return [line.slice(0, i), line.slice(i + 1)]
      }),
  )
  baseEnv = { ...baseEnv, ...secrets }
  console.log("Starting isolated TimescaleDB, EMQX TLS, and JetStream…")
  dockerStarted = true
  await run("docker", [
    ...compose,
    "up",
    "-d",
    "--wait",
    "--wait-timeout",
    "150",
  ])
  await waitFor(`http://127.0.0.1:${ports.emqx}/status`)
  const apiEnv = {
    ...baseEnv,
    APP_ENV: "testing",
    APP_DEBUG: "false",
    APP_KEY: "base64:" + randomBytes(32).toString("base64"),
    APP_URL: `http://127.0.0.1:${ports.api}`,
    APP_CONFIG_CACHE: join(directory, "config.php"),
    APP_SERVICES_CACHE: join(directory, "services.php"),
    APP_PACKAGES_CACHE: join(directory, "packages.php"),
    APP_ROUTES_CACHE: join(directory, "routes.php"),
    APP_EVENTS_CACHE: join(directory, "events.php"),
    DB_URL: "",
    DB_CONNECTION: "pgsql",
    DB_HOST: "127.0.0.1",
    DB_PORT: String(ports.postgres),
    DB_DATABASE: "iot_devices_test",
    DB_USERNAME: "devices_test",
    DB_PASSWORD: secrets.DEVICE_TEST_DB_PASSWORD,
    SESSION_DRIVER: "database",
    CACHE_STORE: "array",
    QUEUE_CONNECTION: "sync",
    MAIL_MAILER: "array",
    LOG_CHANNEL: "stderr",
    SANCTUM_STATEFUL_DOMAINS: `127.0.0.1:${ports.portal},127.0.0.1:${ports.admin},127.0.0.1:${ports.api}`,
    CORS_ALLOWED_ORIGINS: `http://127.0.0.1:${ports.portal},http://127.0.0.1:${ports.admin}`,
    DEVICE_RUNTIME_URL: `http://127.0.0.1:${ports.runtime}`,
    DEVICE_MQTT_URL: `ssl://localhost:${ports.mqtt}`,
    DEVICE_EMQX_API_URL: `http://127.0.0.1:${ports.emqx}/api/v5`,
  }
  const environment = { directory, project, ports, apiEnv, ...secrets }
  writeFileSync(
    join(directory, "environment.json"),
    JSON.stringify(environment, null, 2),
    { mode: 0o600 },
  )
  const apiDirectory = join(root, "apps/api")
  console.log("Migrating and seeding the disposable database…")
  await run("php", ["artisan", "migrate", "--force"], {
    cwd: apiDirectory,
    env: apiEnv,
  })
  await run("php", ["artisan", "db:seed", "--force"], {
    cwd: apiDirectory,
    env: apiEnv,
  })
  await run(
    "php",
    [
      "artisan",
      "devices:prepare-simulator",
      `--output=${directory}/simulator.json`,
      `--broker=ssl://localhost:${ports.mqtt}`,
      `--ca=${secrets.DEVICE_CERT_DIR}/ca.crt`,
    ],
    { cwd: apiDirectory, env: apiEnv },
  )
  background(
    "api",
    "php",
    [
      "artisan",
      "serve",
      "--host=127.0.0.1",
      `--port=${ports.api}`,
      "--no-reload",
    ],
    { cwd: apiDirectory, env: apiEnv },
  )
  await waitFor(`http://127.0.0.1:${ports.api}/up`)
  console.log("Checking protocol, storage, retention, and recovery contracts…")
  const runtimeTest = await run("go", ["test", "-race", "-p", "1", "./..."], {
    cwd: join(root, "services/runtime"),
    env: {
      ...baseEnv,
      DEVICE_TEST_DATABASE_URL: `postgres://devices_test:${secrets.DEVICE_TEST_DB_PASSWORD}@127.0.0.1:${ports.postgres}/iot_devices_test?sslmode=disable`,
      DEVICE_TEST_NATS_URL: `nats://127.0.0.1:${ports.nats}`,
    },
  })
  writeFileSync(join(directory, "runtime-tests.log"), runtimeTest)
  console.log("Building and starting the device runtime…")
  await run(
    "go",
    ["build", "-o", join(directory, "runtime"), "./cmd/runtime"],
    { cwd: join(root, "services/runtime") },
  )
  background("runtime", join(directory, "runtime"), [], {
    env: {
      ...baseEnv,
      IOT_RUNTIME_HTTP_ADDRESS: `127.0.0.1:${ports.runtime}`,
      DEVICE_CONTROL_URL: `http://127.0.0.1:${ports.api}/api/internal/devices`,
      DEVICE_DATABASE_URL: `postgres://devices_test:${secrets.DEVICE_TEST_DB_PASSWORD}@127.0.0.1:${ports.postgres}/iot_devices_test?sslmode=disable`,
      DEVICE_MQTT_CA_FILE: `${secrets.DEVICE_CERT_DIR}/ca.crt`,
      NATS_URL: `nats://127.0.0.1:${ports.nats}`,
    },
  })
  await waitFor(`http://127.0.0.1:${ports.runtime}/health/ready`)
  const python =
    process.env.DEVICE_SIMULATOR_PYTHON ?? join(directory, "python/bin/python")
  if (!process.env.DEVICE_SIMULATOR_PYTHON) {
    await run("python3", ["-m", "venv", join(directory, "python")])
    await run(python, [
      "-m",
      "pip",
      "install",
      "-r",
      "tooling/simulators/requirements.txt",
    ])
  }
  console.log(
    (await run(python, ["tooling/verify-devices-contracts.py"])).trim(),
  )
  background("simulator", python, [
    "tooling/simulators/sparkplug_simulator.py",
    "--config",
    join(directory, "simulator.json"),
    "--state-file",
    join(directory, "simulator-state"),
  ])
  const frontendEnv = {
    ...baseEnv,
    VITE_API_URL: `http://127.0.0.1:${ports.api}`,
    VITE_PORTAL_URL: `http://127.0.0.1:${ports.portal}`,
    VITE_ADMIN_URL: `http://127.0.0.1:${ports.admin}`,
  }
  background(
    "portal",
    "pnpm",
    [
      "exec",
      "vite",
      "--host",
      "127.0.0.1",
      "--port",
      String(ports.portal),
      "--strictPort",
    ],
    { cwd: join(root, "apps/portal"), env: frontendEnv },
  )
  background(
    "admin",
    "pnpm",
    [
      "exec",
      "vite",
      "--host",
      "127.0.0.1",
      "--port",
      String(ports.admin),
      "--strictPort",
    ],
    { cwd: join(root, "apps/admin"), env: frontendEnv },
  )
  await waitFor(`http://127.0.0.1:${ports.portal}`)
  console.log(
    `Devices environment ready: portal http://127.0.0.1:${ports.portal}; admin http://127.0.0.1:${ports.admin}`,
  )
  console.log(`Private test configuration and logs: ${directory}`)
  writeFileSync(join(directory, "harness.pid"), String(process.pid))
  if (process.argv.includes("--serve")) await new Promise(() => {})
  else {
    await run(
      process.execPath,
      ["tooling/verify-devices.mjs", join(directory, "environment.json")],
      { stdio: "inherit" },
    )
    await run(
      process.execPath,
      [
        "tooling/verify-devices-browser.mjs",
        join(directory, "environment.json"),
      ],
      { stdio: "inherit" },
    )
    await run(
      process.execPath,
      [
        "tooling/verify-devices-recovery.mjs",
        join(directory, "environment.json"),
      ],
      { stdio: "inherit" },
    )
    await cleanup()
  }
} catch (error) {
  console.error(error.message)
  if (dockerStarted) {
    const logs = await run("docker", [
      ...compose,
      "logs",
      "--no-color",
      "--tail",
      "80",
    ]).catch(() => "Unable to collect service logs")
    writeFileSync(join(directory, "services.log"), logs, { mode: 0o600 })
    console.error(logs.slice(-5000))
  }
  console.error(`Evidence retained in ${directory}`)
  await cleanup()
  process.exitCode = 1
}
