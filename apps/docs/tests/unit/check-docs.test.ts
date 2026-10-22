import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { changelog, features, literals, names, reference, unpublishedRoutes } from '../../scripts/check-docs.mjs'

let root: string
const write = (path: string, content: string) => {
  const file = join(root, path)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, content)
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'check-docs-'))
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

const config = {
  productName: 'Example Platform',
  companyName: 'Example Company',
  siteUrl: 'https://platform.example.com',
  apiBaseUrl: 'https://api.example.com',
}

describe('literals', () => {
  it('passes when values come from the config', async () => {
    write('src/pages/index.astro', '<p>{docsConfig.productName} on {docsConfig.apiBaseUrl}</p>\n')
    expect(await literals({ root, config })).toBe(true)
  })

  it('fails on a configured name or host written literally', async () => {
    write('src/pages/index.astro', '<p>Example Platform</p>\n<a href="https://api.example.com/x">api</a>\n')
    expect(await literals({ root, config })).toBe(false)
  })

  it('ignores package specifiers and generated guides', async () => {
    write('src/a.ts', "import x from '@example-platform/ui'\n")
    write('src/content/docs/docs/guides/x.md', 'Example Platform\n')
    expect(await literals({ root, config: { ...config, productName: 'example-platform' } })).toBe(true)
  })
})

describe('names', () => {
  it('fails without printing the name', () => {
    write('src/content/docs/docs/page.md', 'Thanks to Planted Prospect.\n')
    const error = vi.spyOn(console, 'error')
    expect(names({ root, dist: join(root, 'dist'), list: ['Planted Prospect'] })).toBe(false)
    expect(error.mock.calls.flat().join(' ')).not.toContain('Planted Prospect')
  })

  it('passes with no match, and warns when there is no list', () => {
    write('src/a.md', 'Nothing private.\n')
    expect(names({ root, dist: join(root, 'dist'), list: ['Planted Prospect'] })).toBe(true)
    expect(names({ root, dist: join(root, 'dist'), list: undefined })).toBe(true)
  })
})

describe('features', () => {
  beforeEach(() => {
    write('hosted-release.json', JSON.stringify({ schema_version: 'hosted-release.v1', features: { adapters: false, agent_access: true } }))
    write('src/content/docs/docs/hardware/adapters/vendor.md', '---\ntitle: x\n---\n')
    write('src/content/docs/docs/start.md', '---\ntitle: x\ndraft: true\n---\n')
    write('src/content/docs/docs/developers/agents/connect.md', '---\ntitle: x\n---\n')
    write('dist/index.html', '<a href="/docs/">docs</a>')
    write('dist/docs/index.html', '<a href="/docs/developers/agents/connect/">agents</a>')
    write('dist/docs/developers/agents/connect/index.html', '<p>x</p>')
  })

  it('lists gated and draft pages', () => {
    expect(unpublishedRoutes(root, { adapters: false, agent_access: true }).sort()).toEqual(['/docs/hardware/adapters/vendor/', '/docs/start/'])
  })

  it('passes when links only reach built, published pages', () => {
    expect(features({ root, dist: join(root, 'dist') })).toBe(true)
  })

  it('fails on a link to a switched-off page, a draft or an unbuilt page', () => {
    write('dist/docs/index.html', '<a href="/docs/hardware/adapters/vendor/">a</a><a href="/docs/start/">b</a><a href="/docs/missing/">c</a>')
    const error = vi.spyOn(console, 'error')
    expect(features({ root, dist: join(root, 'dist') })).toBe(false)
    expect(error).toHaveBeenCalledTimes(3)
  })
})

describe('reference', () => {
  beforeEach(() => {
    write('.sources/meta.json', JSON.stringify({ operations: ['GET /integration/v1/devices'], event_types: ['a.v1', 'b.v1'] }))
    write('dist/docs/reference/api/operations/devices/index.html', '<p>GET /integration/v1/devices</p><p>Requires: x</p><p>Rate limits: y</p>')
    write('dist/docs/developers/events/index.html', '<code data-event-type="a.v1"></code><code data-event-type="b.v1"></code>')
  })

  it('passes when pages match the contract one to one', () => {
    expect(reference({ root, dist: join(root, 'dist'), hostedRef: undefined })).toBe(true)
  })

  it('fails on a missing operation page, a missing event type or the hosted commit in dist', () => {
    write('.sources/meta.json', JSON.stringify({ operations: ['GET /integration/v1/devices', 'GET /integration/v1/alerts'], event_types: ['a.v1', 'b.v1', 'c.v1'] }))
    write('dist/assets/x.js', 'built from 0123456789abcdef')
    expect(reference({ root, dist: join(root, 'dist'), hostedRef: '0123456789abcdef0123456789abcdef01234567' })).toBe(false)
  })

  it('fails when a page lacks its abilities or rate limits', () => {
    write('dist/docs/reference/api/operations/devices/index.html', '<p>GET /integration/v1/devices</p>')
    expect(reference({ root, dist: join(root, 'dist'), hostedRef: undefined })).toBe(false)
  })
})

describe('changelog', () => {
  beforeEach(() => {
    write('.sources/meta.json', JSON.stringify({ contract_version: '1.0.0', sdk_version: '0.5.0', operations: ['GET /x'], event_types: ['a.v1'] }))
    write('src/content/docs/docs/changelog.mdx', '## Integration API 1.0.0 · SDK 0.5.0\n')
    write('changelog-baseline.json', JSON.stringify({ operations: ['GET /x'], event_types: ['a.v1'] }))
  })

  it('passes when versions have entries and the baseline matches', () => {
    expect(changelog({ root })).toBe(true)
  })

  it('fails when an event type changes until the baseline is refreshed', () => {
    write('.sources/meta.json', JSON.stringify({ contract_version: '1.0.0', sdk_version: '0.5.0', operations: ['GET /x'], event_types: ['a.v1', 'b.v1'] }))
    expect(changelog({ root })).toBe(false)
    expect(changelog({ root, update: true })).toBe(true)
    expect(changelog({ root })).toBe(true)
  })

  it('fails when the newest version has no entry', () => {
    write('.sources/meta.json', JSON.stringify({ contract_version: '1.1.0', sdk_version: '0.5.0', operations: ['GET /x'], event_types: ['a.v1'] }))
    expect(changelog({ root })).toBe(false)
  })
})
