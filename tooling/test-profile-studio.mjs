import { spawn } from "node:child_process"
import { mkdtempSync, writeFileSync, openSync, closeSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { randomBytes } from "node:crypto"
import { fileURLToPath } from "node:url"

const root = resolve(fileURLToPath(new URL("..", import.meta.url)))
const directory = mkdtempSync(join(tmpdir(), "iot-studio-e2e-"))
const database = join(directory, "database.sqlite")
writeFileSync(database, "")
const baseURL = process.env.STUDIO_BASE_URL ?? "http://127.0.0.1:4173"
const apiURL = process.env.STUDIO_API_URL ?? "http://127.0.0.1:8013"
if (
  ![baseURL, apiURL].every((value) =>
    ["127.0.0.1", "localhost"].includes(new URL(value).hostname),
  )
)
  throw new Error("Studio tests only run on local test servers.")
const environment = {
  ...process.env,
  APP_ENV: "testing",
  APP_CONFIG_CACHE: join(directory, "config.php"),
  APP_ROUTES_CACHE: join(directory, "routes.php"),
  APP_KEY: "base64:" + randomBytes(32).toString("base64"),
  DB_CONNECTION: "sqlite",
  DB_DATABASE: database,
  DB_URL: "",
  CACHE_STORE: "array",
  SESSION_DRIVER: "database",
  SESSION_COOKIE: "iot_studio_e2e_session",
  FRONTEND_URL: baseURL,
  SANCTUM_STATEFUL_DOMAINS: new URL(baseURL).host,
  CORS_ALLOWED_ORIGINS: baseURL,
  MAIL_MAILER: "array",
  VITE_API_URL: apiURL,
  STUDIO_API_URL: apiURL,
  STUDIO_BASE_URL: baseURL,
  STUDIO_ARTIFACTS: join(directory, "artifacts"),
}
const processes = []
function launch(command, args, cwd = root) {
  const log =
    command === "php" ? openSync(join(directory, "api.log"), "a") : null
  const child = spawn(command, args, {
    cwd,
    env: environment,
    stdio: log === null ? "inherit" : ["ignore", log, log],
    detached: process.platform !== "win32",
  })
  if (log !== null) closeSync(log)
  processes.push(child)
  return child
}
function finish(child) {
  return new Promise((resolve, reject) => {
    child.once("error", reject)
    child.once("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error("Test command exited with " + code)),
    )
  })
}
async function waitFor(url) {
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      if ((await fetch(url)).ok) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error("Test server did not become ready: " + url)
}
function cleanup() {
  for (const child of processes) {
    if (child.exitCode === null && child.pid) {
      try {
        process.kill(
          process.platform === "win32" ? child.pid : -child.pid,
          "SIGTERM",
        )
      } catch {}
    }
  }
}
process.on("SIGINT", () => {
  cleanup()
  process.exit(130)
})
process.on("SIGTERM", () => {
  cleanup()
  process.exit(143)
})
console.log("Disposable Studio test data and screenshots: " + directory)
try {
  for (const url of [baseURL, apiURL]) {
    try {
      await fetch(url)
      throw new Error(
        "A server already uses " +
          url +
          ". Stop it or choose an unused test port.",
      )
    } catch (error) {
      if (!String(error).includes("fetch failed")) throw error
    }
  }
  await finish(
    launch(
      "php",
      ["artisan", "migrate", "--seed", "--force"],
      join(root, "apps/api"),
    ),
  )
  await finish(
    launch(
      "php",
      ["artisan", "db:seed", "--class=StudioBrowserSeeder", "--force"],
      join(root, "apps/api"),
    ),
  )
  launch(
    "php",
    [
      "artisan",
      "serve",
      "--host=" + new URL(apiURL).hostname,
      "--port=" + new URL(apiURL).port,
      "--no-reload",
    ],
    join(root, "apps/api"),
  )
  launch("pnpm", [
    "--filter",
    "@iot-os/portal",
    "dev",
    "--host",
    new URL(baseURL).hostname,
    "--port",
    new URL(baseURL).port,
  ])
  await Promise.all([waitFor(apiURL + "/up"), waitFor(baseURL)])
  await finish(
    launch("pnpm", [
      "--filter",
      "@iot-os/portal",
      "test:e2e",
      ...process.argv.slice(2),
    ]),
  )
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
} finally {
  cleanup()
  console.log("Studio test artifacts retained at: " + directory)
}
