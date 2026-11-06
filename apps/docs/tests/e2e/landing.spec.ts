import { expect, test } from '@playwright/test'

// The landing page (US4, FR-022, SC-006).
test('the ways in are one click away', async ({ page }) => {
  await page.goto('/')
  const hero = page.locator('[data-hero]')
  await expect(hero.locator('h1')).toBeVisible()
  await expect(hero.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', /^https:\/\//)
  await expect(hero.getByRole('link', { name: 'Read the docs' })).toHaveAttribute('href', '/docs/')
  await expect(hero.getByRole('link', { name: 'API reference' })).toHaveAttribute('href', '/docs/reference/api/')
  await expect(page.locator('.landing-footer').getByRole('link', { name: /website$/ })).toHaveAttribute('href', /^https:\/\//)
})

test('the slogan is one colour, with no highlighted initials', async ({ page }) => {
  await page.goto('/')
  const colours = await page.locator('[data-slogan]').evaluate((slogan) =>
    [slogan, ...slogan.querySelectorAll('*')].map((element) => getComputedStyle(element).color),
  )
  expect(new Set(colours).size).toBe(1)
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

test('without a WebGL context, the slogan shows', async ({ page }) => {
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      return type.startsWith('webgl') ? null : getContext.call(this, type, ...(rest as []))
    } as typeof getContext
  })
  await page.goto('/')
  const hero = page.locator('[data-hero]')
  await expect(hero).toHaveAttribute('data-animate', 'done')
  for (const word of await hero.locator('[data-word]').all()) await expect(word).toHaveCSS('opacity', '1')
})

// The stage: one device from firmware to an alert, as a transcript beside an illustration.
test('the stage plays, can be paused and can be stepped', async ({ page }) => {
  await page.goto('/')
  const stage = page.locator('[data-stage]')
  await stage.scrollIntoViewIfNeeded()
  await expect(stage).toHaveAttribute('data-motion', 'playing', { timeout: 15_000 })
  await expect(stage.getByRole('button', { name: 'Illustration' })).toHaveCount(0)
  await expect(stage.getByText('Illustration', { exact: true })).toBeVisible()
  const pause = stage.getByRole('button', { name: 'Pause' })
  await expect(pause).toBeVisible()
  await pause.click()
  await expect(stage.getByRole('button', { name: 'Play' })).toHaveAttribute('aria-pressed', 'true')
  const alert = stage.getByRole('button', { name: /Alert$/ })
  await alert.click()
  await expect(alert).toHaveAttribute('aria-current', 'step')
  // Paused at the step's start, the transcript shows exactly the lines up to it.
  const start = Number(await alert.getAttribute('data-start'))
  const lines = stage.locator('[data-lines] > li')
  const upToStart = await lines.evaluateAll((items, at) => items.filter((item) => Number((item as HTMLElement).dataset.at) <= at).length, start)
  expect(upToStart).toBeGreaterThan(0)
  await expect(lines.locator('visible=true').and(stage.locator('[data-shown]'))).toHaveCount(upToStart)
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

  test('the stage is a complete transcript with nothing moving', async ({ page }) => {
    await page.goto('/')
    const stage = page.locator('[data-stage]')
    await stage.scrollIntoViewIfNeeded()
    await expect(stage).not.toHaveAttribute('data-motion', /.+/)
    await expect(stage.getByRole('button', { name: 'Pause' })).toBeHidden()
    for (const line of await stage.locator('[data-lines] > li').all()) await expect(line).toHaveCSS('opacity', '1')
    await expect(stage.getByText('email sent')).toBeVisible()
  })
})
