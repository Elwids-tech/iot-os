import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/** Every page path in the built sitemap. */
export function sitemapPaths(): string[] {
  const dist = join(process.cwd(), 'dist')
  return readdirSync(dist)
    .filter((name) => /^sitemap-\d+\.xml$/.test(name))
    .flatMap((name) => [...readFileSync(join(dist, name), 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => new URL(match[1]).pathname))
}

/** Waits until no CSS animation or transition is running, so colour checks see final values. */
export const settled = () =>
  new Promise<void>((resolve) => {
    const check = () => (document.getAnimations().length === 0 ? resolve() : requestAnimationFrame(check))
    check()
  })
