import { expect, test } from '@playwright/test'

// The landing page (US4, FR-022, SC-006).
test('the ways in are one click away', async ({ page }) => {
  await page.goto('/')
  const hero = page.locator('[data-hero]')
  await expect(hero.locator('h1')).toBeVisible()
  await expect(hero.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', /^https:\/\//)
  await expect(hero.getByRole('link', { name: 'Read the docs' })).toHaveAttribute('href', '/docs/')
  await expect(hero.getByRole('link', { name: 'API reference' })).toHaveAttribute('href', '/docs/reference/api/')
  await expect(page.locator('.company a')).toHaveAttribute('href', /^https:\/\//)
})

test('names no outcome figures', async ({ page }) => {
  await page.goto('/')
  const text = await page.locator('main').innerText()
  expect(text).not.toMatch(/\d+(\.\d+)?\s?%|\b\d+\s?[–-]\s?\d+\s?%|\b\d+x\b/)
})

test('the intro plays and ends with the slogan shown', async ({ page }) => {
  await page.goto('/')
  const hero = page.locator('[data-hero]')
  await expect(hero).toHaveAttribute('data-animate', 'done', { timeout: 15_000 })
  for (const word of await hero.locator('[data-word]').all()) await expect(word).toHaveCSS('opacity', '1')
})

test.describe('with reduced motion', () => {
  test.use({ contextOptions: { reducedMotion: 'reduce' } })
  test('shows the final state at once, with no animation', async ({ page }) => {
    await page.goto('/')
    const hero = page.locator('[data-hero]')
    await expect(hero).not.toHaveAttribute('data-animate', /.+/)
    await expect(hero.locator('[data-slogan]')).toBeVisible()
    await expect(hero).not.toHaveAttribute('data-scene', /.+/)
  })
})
