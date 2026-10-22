import { defineConfig, devices } from '@playwright/test'

// Browser checks against the built site (run `pnpm build` first): accessibility and
// privacy on every page in the sitemap, the header and footer links, and the landing
// hero. Four projects: phone and desktop widths, each in light and dark.
// Astro runs one preview server per project, so reuse it locally when it's already up.
const port = Number(process.env.DOCS_E2E_PORT ?? 4321)

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  reporter: process.env.CI ? 'github' : 'list',
  timeout: 120_000,
  use: { baseURL: `http://localhost:${port}`, trace: 'retain-on-failure' },
  webServer: {
    command: `pnpm exec astro preview --port ${port} --host localhost`,
    port,
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    { name: 'phone-light', use: { ...devices['Pixel 7'], viewport: { width: 375, height: 812 }, colorScheme: 'light' } },
    { name: 'phone-dark', use: { ...devices['Pixel 7'], viewport: { width: 375, height: 812 }, colorScheme: 'dark' } },
    { name: 'desktop-light', use: { viewport: { width: 1440, height: 900 }, colorScheme: 'light' } },
    { name: 'desktop-dark', use: { viewport: { width: 1440, height: 900 }, colorScheme: 'dark' } },
  ],
})
