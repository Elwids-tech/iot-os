import { defineConfig } from "@playwright/test"
import { tmpdir } from "node:os"
import { join } from "node:path"
export default defineConfig({
  testDir: "./e2e",
  // The installable app runs with its service worker under playwright.pwa.config.ts.
  testIgnore: ["installable.spec.ts"],
  globalSetup: "./e2e/support/api-health.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  expect: { timeout: 10000 },
  outputDir:
    process.env.STUDIO_ARTIFACTS ?? join(tmpdir(), "iot-studio-playwright"),
  reporter: "list",
  use: {
    baseURL: process.env.STUDIO_BASE_URL ?? "http://127.0.0.1:4173",
    viewport: { width: 1440, height: 1000 },
    // A service worker would answer requests before page.route sees them.
    serviceWorkers: "block",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
})
