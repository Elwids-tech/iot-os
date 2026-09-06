import { defineConfig } from "@playwright/test"
import { tmpdir } from "node:os"
import { join } from "node:path"
export default defineConfig({
  testDir: "./e2e",
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
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
})
