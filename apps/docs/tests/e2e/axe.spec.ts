import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { settled, sitemapPaths } from './sitemap'

// WCAG 2.2 AA on every page (SC-004). The hero's intro is skipped (reduced motion) so
// contrast is checked on the final colours, not mid-fade.
test.use({ contextOptions: { reducedMotion: 'reduce' } })

for (const path of sitemapPaths()) {
  test(`axe ${path}`, async ({ page }) => {
    await page.goto(path)
    await page.evaluate(settled)
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
    const serious = results.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
    expect(serious.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`)).toEqual([])
    // Reflow (1.4.10): no sideways scrolling. Phone emulation widens innerWidth to fit
    // overflowing content, so compare with the layout width.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(0)
  })
}
