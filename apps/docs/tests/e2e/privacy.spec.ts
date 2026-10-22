import { expect, test } from '@playwright/test'
import { sitemapPaths } from './sitemap'

// No cookies and no requests to other origins on any page (FR-008).
for (const path of sitemapPaths()) {
  test(`privacy ${path}`, async ({ page, baseURL }) => {
    const origin = new URL(baseURL!).origin
    const foreign: string[] = []
    const cookies: string[] = []
    page.on('request', (request) => {
      const url = new URL(request.url())
      if (!['data:', 'blob:'].includes(url.protocol) && url.origin !== origin) foreign.push(request.url())
    })
    page.on('response', async (response) => {
      const header = await response.headerValue('set-cookie')
      if (header) cookies.push(response.url())
    })
    await page.goto(path)
    await page.waitForLoadState('networkidle')
    expect(foreign).toEqual([])
    expect(cookies).toEqual([])
    expect(await page.evaluate(() => document.cookie)).toBe('')
  })
}
