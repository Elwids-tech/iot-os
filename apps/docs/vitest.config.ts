import { defineConfig } from 'vitest/config'

// Unit tests for the build scripts. Browser checks live in tests/e2e (Playwright).
export default defineConfig({
  test: { include: ['tests/unit/**/*.test.ts'] },
})
