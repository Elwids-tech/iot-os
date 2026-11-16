import { defineConfig } from "@playwright/test"
import { tmpdir } from "node:os"
import { join } from "node:path"

/**
 * The installable app with its service worker (spec 033, installable.spec.ts). It builds
 * its own copy of the portal and serves it with `vite preview` on 4174, so the worker
 * registers as it does in production. The spec rebuilds into the same folder to check
 * that a new release reaches an installed app (SC-006).
 */
export const pwaPort = 4174
export const pwaOutDir = process.env.PWA_OUT_DIR ?? join(tmpdir(), "iot-portal-pwa-e2e")
process.env.PWA_OUT_DIR = pwaOutDir

export default defineConfig({
  testDir: "./e2e",
  testMatch: ["installable.spec.ts"],
  globalSetup: "./e2e/support/api-health.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 120000,
  expect: { timeout: 10000 },
  outputDir: join(process.env.STUDIO_ARTIFACTS ?? join(tmpdir(), "iot-studio-playwright"), "pwa"),
  reporter: "list",
  use: {
    baseURL: `http://127.0.0.1:${pwaPort}`,
    viewport: { width: 1440, height: 1000 },
    serviceWorkers: "allow",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: `pnpm exec vite build --outDir "${pwaOutDir}" --emptyOutDir && pnpm exec vite preview --outDir "${pwaOutDir}" --host 127.0.0.1 --port ${pwaPort} --strictPort`,
    url: `http://127.0.0.1:${pwaPort}`,
    env: { BUILD_ID: "pwa-a" },
    reuseExistingServer: false,
    timeout: 240000,
  },
})
