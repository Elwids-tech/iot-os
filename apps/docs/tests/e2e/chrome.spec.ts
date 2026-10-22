import { expect, test } from '@playwright/test'

// Header and footer links on docs pages (FR-002, FR-017), and readable content without
// JavaScript. Sideways scrolling is checked on every page in axe.spec.ts.
const pages = ['/docs/', '/docs/developers/events/', '/docs/guides/getting-started/', '/docs/changelog/', '/docs/reference/api/operations/readdevices/']

for (const path of pages) {
  test(`chrome ${path}`, async ({ page, isMobile }) => {
    await page.goto(path)
    const report = page.getByRole('link', { name: 'Report a problem with this page' })
    await expect(report).toHaveAttribute('href', new RegExp(`page=${encodeURIComponent(path).replaceAll('%', '%')}`))
    if (!isMobile) await expect(page.locator('header').getByRole('link', { name: 'Sign in' })).toBeVisible()
  })
}

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false })
  for (const path of ['/', ...pages]) {
    test(`readable ${path}`, async ({ page }) => {
      await page.goto(path)
      await expect(page.locator('h1').first()).toBeVisible()
    })
  }
})
