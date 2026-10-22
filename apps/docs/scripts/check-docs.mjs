#!/usr/bin/env node
// Build checks for the docs site (spec 013, research R7). Each check prints the file
// and line of a problem and exits non-zero. `all` runs every check that reads the
// built site; `rename` builds a second time and runs on its own; `drafts` only lists.
//
//   literals   a configured name, domain or address written outside docs.config.ts
//   rename     a build with another product name still shows the configured one
//   names      a name from the private denylist in the source or the built site
//   features   a link to an unbuilt page: a switched-off feature, a draft, or a typo
//   reference  the API and events reference differ from the hosted contract
//   changelog  the newest versions or a contract change have no changelog entry
//   drafts     drafts the hosted commit now contains, ready to publish
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadLocalEnv, repoRoot } from './lib/env.mjs'

loadLocalEnv()

export const appRoot = fileURLToPath(new URL('..', import.meta.url))

function walk(dir, filter = () => true) {
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === 'node_modules' ? [] : walk(path, filter)
    return filter(path) ? [path] : []
  })
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Visible text and attribute values of an HTML file, without scripts and styles. */
export function htmlText(html) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
}

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length
}

function report(name, problems) {
  if (!problems.length) {
    console.log(`check-docs ${name}: ok`)
    return true
  }
  for (const problem of problems) console.error(`check-docs ${name}: ${problem}`)
  return false
}

const sourceFiles = (root) =>
  walk(join(root, 'src'), (path) => /\.(astro|ts|tsx|mjs|js|md|mdx|css|json)$/.test(path)).filter(
    (path) => !path.includes(`${sep}content${sep}docs${sep}docs${sep}guides${sep}`),
  )

// ---------- literals ----------
/** @param {{ root?: string, config?: Record<string, string> }} [options] */
export async function literals({ root = appRoot, config = undefined } = {}) {
  const { docsConfig } = config ? { docsConfig: config } : await import(join(root, 'docs.config.ts'))
  const needles = []
  for (const [key, value] of Object.entries(docsConfig)) {
    needles.push({ key, value })
    if (/^https:\/\//.test(value)) needles.push({ key: `${key} host`, value: new URL(value).host })
  }
  const problems = []
  for (const file of sourceFiles(root)) {
    const text = readFileSync(file, 'utf8')
    for (const { key, value } of needles) {
      const pattern = new RegExp(`(?<![@\\w/.-])${escapeRegExp(value)}(?![\\w-])`, 'g')
      for (const match of text.matchAll(pattern)) {
        problems.push(`${relative(root, file)}:${lineOf(text, match.index)} writes ${key} literally; use docs.config.ts`)
      }
    }
  }
  return report('literals', problems)
}

// ---------- names ----------
export function denylist(root = repoRoot) {
  // An unset Actions secret arrives as an empty string: treat it as no list.
  const fromEnv = process.env.DOCS_DENYLIST?.trim() ? process.env.DOCS_DENYLIST : undefined
  const file = join(root, '.local/docs/denylist.txt')
  const text = fromEnv ?? (existsSync(file) ? readFileSync(file, 'utf8') : undefined)
  if (text === undefined) return undefined
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
}

export function names({ root = appRoot, dist = join(appRoot, 'dist'), list = denylist() } = {}) {
  if (list === undefined) {
    if (process.env.DOCS_REQUIRE_DENYLIST === '1') return report('names', ['no denylist: set the DOCS_DENYLIST secret'])
    console.warn('check-docs names: skipped, no denylist (DOCS_DENYLIST or .local/docs/denylist.txt)')
    return true
  }
  const problems = []
  const files = [...sourceFiles(root), ...walk(dist, (path) => path.endsWith('.html'))]
  for (const file of files) {
    const raw = readFileSync(file, 'utf8')
    const text = file.endsWith('.html') ? htmlText(raw) : raw
    for (const name of list) {
      const match = new RegExp(`(?<![\\w])${escapeRegExp(name)}(?![\\w])`, 'i').exec(text)
      // Never print the name: the denylist is private and CI logs are public.
      if (match) problems.push(`${relative(root, file)}:${lineOf(text, match.index)} contains a denylisted name`)
    }
  }
  return report('names', problems)
}

// ---------- features ----------
function frontmatter(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---/)
  return match ? match[1] : ''
}

/** Routes of hand-written pages that must not be published. */
export function unpublishedRoutes(root = appRoot, features) {
  const contentRoot = join(root, 'src/content/docs')
  const routes = []
  for (const file of walk(contentRoot, (path) => /\.mdx?$/.test(path))) {
    const id = relative(contentRoot, file).replace(/\.mdx?$/, '').split(sep).join('/')
    const gated =
      (!features.adapters && id.split('/').includes('adapters')) ||
      (!features.agent_access && id.split('/').includes('agents'))
    const draft = /^draft:\s*true\s*$/m.test(frontmatter(readFileSync(file, 'utf8')))
    if (gated || draft) routes.push(`/${id.replace(/\/?index$/, '')}/`.replace(/\/+/g, '/'))
  }
  return routes
}

export function features({ root = appRoot, dist = join(appRoot, 'dist') } = {}) {
  const release = JSON.parse(readFileSync(join(root, 'hosted-release.json'), 'utf8'))
  const blocked = new Set(unpublishedRoutes(root, release.features))
  const pages = walk(dist, (path) => path.endsWith('.html'))
  const built = new Set(
    pages.map((path) => `/${relative(dist, path).split(sep).join('/')}`.replace(/index\.html$/, '').replace(/\.html$/, '')),
  )
  const problems = []
  for (const route of blocked) {
    if (built.has(route)) problems.push(`${route} is built, but it is a draft or its feature is switched off`)
  }
  for (const page of pages) {
    const html = readFileSync(page, 'utf8')
    for (const match of html.matchAll(/href="(\/[^"#?]*)/g)) {
      const target = match[1]
      if (target.startsWith('/_astro/') || target.startsWith('/pagefind/') || /\.[a-z0-9]+$/i.test(target)) continue
      const route = target.endsWith('/') ? target : `${target}/`
      const where = `${relative(dist, page)}:${lineOf(html, match.index)}`
      if (blocked.has(route)) problems.push(`${where} links to ${route}, a draft or switched-off page`)
      else if (!built.has(route)) problems.push(`${where} links to ${route}, which isn't built`)
    }
  }
  return report('features', problems)
}

// ---------- reference ----------
export function reference({ root = appRoot, dist = join(appRoot, 'dist'), hostedRef = process.env.DOCS_HOSTED_REF?.trim() } = {}) {
  const meta = JSON.parse(readFileSync(join(root, '.sources/meta.json'), 'utf8'))
  const problems = []
  const operationPages = walk(join(dist, 'docs/reference/api/operations'), (path) => path.endsWith('.html'))
  const found = new Map()
  for (const page of operationPages) {
    const text = htmlText(readFileSync(page, 'utf8')).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
    const matches = meta.operations.filter((operation) => {
      const [method, path] = operation.split(' ')
      return new RegExp(`\\b${method}\\s+${escapeRegExp(path)}(?![\\w/{])`).test(text)
    })
    const where = relative(dist, page)
    if (matches.length !== 1) problems.push(`${where} matches ${matches.length} contract operations, expected 1`)
    for (const operation of matches) found.set(operation, [...(found.get(operation) ?? []), where])
    if (!text.includes('Requires:')) problems.push(`${where} doesn't show the abilities it requires`)
    if (!text.includes('Rate limits:')) problems.push(`${where} doesn't show its rate limits`)
  }
  for (const operation of meta.operations) {
    const pages = found.get(operation) ?? []
    if (pages.length !== 1) problems.push(`${operation} has ${pages.length} reference pages, expected 1`)
  }
  const events = join(dist, 'docs/developers/events/index.html')
  if (!existsSync(events)) problems.push('the events page is not built')
  else {
    const listed = [...new Set([...readFileSync(events, 'utf8').matchAll(/data-event-type="([^"]+)"/g)].map((m) => m[1]))].sort()
    if (JSON.stringify(listed) !== JSON.stringify(meta.event_types)) {
      problems.push(`the events page lists ${listed.join(', ') || 'nothing'}; the contract has ${meta.event_types.join(', ')}`)
    }
  }
  if (hostedRef) {
    for (const file of walk(dist)) {
      const text = readFileSync(file).toString('latin1')
      if (text.includes(hostedRef.slice(0, 7))) problems.push(`${relative(dist, file)} contains the hosted commit`)
    }
  }
  return report('reference', problems)
}

// ---------- changelog ----------
export function changelog({ root = appRoot, update = false } = {}) {
  const meta = JSON.parse(readFileSync(join(root, '.sources/meta.json'), 'utf8'))
  const baselineFile = join(root, 'changelog-baseline.json')
  const current = { operations: meta.operations, event_types: meta.event_types }
  if (update) {
    writeFileSync(baselineFile, `${JSON.stringify(current, null, 2)}\n`)
    console.log('check-docs changelog: baseline refreshed')
    return true
  }
  const problems = []
  const entries = readFileSync(join(root, 'src/content/docs/docs/changelog.mdx'), 'utf8')
  if (meta.contract_version && !entries.includes(`Integration API ${meta.contract_version}`)) {
    problems.push(`changelog.mdx has no entry for Integration API ${meta.contract_version}`)
  }
  if (meta.sdk_version && !entries.includes(`SDK ${meta.sdk_version}`)) {
    problems.push(`changelog.mdx has no entry for SDK ${meta.sdk_version}`)
  }
  if (!existsSync(baselineFile)) problems.push('changelog-baseline.json is missing; run `check-docs changelog --update`')
  else {
    const baseline = JSON.parse(readFileSync(baselineFile, 'utf8'))
    for (const key of ['operations', 'event_types']) {
      const added = current[key].filter((item) => !baseline[key].includes(item))
      const removed = baseline[key].filter((item) => !current[key].includes(item))
      if (added.length || removed.length) {
        problems.push(
          `${key} changed (added: ${added.join(', ') || 'none'}; removed: ${removed.join(', ') || 'none'}): ` +
            'add a changelog entry, then run `check-docs changelog --update`',
        )
      }
    }
  }
  return report('changelog', problems)
}

// ---------- drafts ----------
export function drafts({ root = appRoot, hostedRef = process.env.DOCS_HOSTED_REF?.trim() } = {}) {
  if (!hostedRef) {
    console.warn('check-docs drafts: set DOCS_HOSTED_REF to compare drafts with the hosted commit')
    return true
  }
  const contentRoot = join(root, 'src/content/docs')
  const ready = []
  for (const file of walk(contentRoot, (path) => /\.mdx?$/.test(path))) {
    if (!/^draft:\s*true\s*$/m.test(frontmatter(readFileSync(file, 'utf8')))) continue
    const commits = execFileSync('git', ['log', '--diff-filter=A', '--format=%H', '--', file], { cwd: root, encoding: 'utf8' })
      .trim()
      .split('\n')
      .filter(Boolean)
    const introduced = commits.at(-1)
    if (!introduced) continue
    try {
      execFileSync('git', ['merge-base', '--is-ancestor', introduced, hostedRef], { cwd: root, stdio: 'ignore' })
      ready.push(relative(root, file))
    } catch {
      // Not in the hosted release yet.
    }
  }
  console.log(ready.length ? `Ready to publish (remove draft: true):\n${ready.map((path) => `  ${path}`).join('\n')}` : 'check-docs drafts: none ready')
  return true
}

// ---------- rename ----------
export async function rename({ root = appRoot } = {}) {
  const { docsConfig } = await import(join(root, 'docs.config.ts'))
  const original = docsConfig.productName
  const replacement = 'Renamed Product'
  const outDir = mkdtempSync(join(tmpdir(), 'docs-rename-'))
  const env = { ...process.env, PUBLIC_DOCS_PRODUCT_NAME: replacement }
  try {
    execFileSync('node', ['scripts/sources.mjs'], { cwd: root, env, stdio: 'ignore' })
    execFileSync('pnpm', ['exec', 'astro', 'build', '--outDir', outDir], { cwd: root, env, stdio: 'ignore' })
    const problems = []
    const pattern = new RegExp(`(?<![@\\w/.-])${escapeRegExp(original)}(?![\\w-])`)
    for (const file of walk(outDir, (path) => path.endsWith('.html'))) {
      const text = htmlText(readFileSync(file, 'utf8'))
      const match = pattern.exec(text)
      if (match) problems.push(`${relative(outDir, file)}:${lineOf(text, match.index)} still shows "${original}"`)
    }
    return report('rename', problems)
  } finally {
    rmSync(outDir, { recursive: true, force: true })
    // Put the generated sources back for the configured name.
    execFileSync('node', ['scripts/sources.mjs'], { cwd: root, stdio: 'ignore' })
  }
}

const commands = { literals, rename, names, features, reference, changelog, drafts }
const inBuild = ['literals', 'names', 'features', 'reference', 'changelog']

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command = 'all', ...flags] = process.argv.slice(2)
  const run = command === 'all' ? inBuild : [command]
  if (run.some((name) => !commands[name])) {
    console.error(`Usage: check-docs.mjs [all|${Object.keys(commands).join('|')}] [--update]`)
    process.exit(2)
  }
  let ok = true
  for (const name of run) ok = (await commands[name]({ update: flags.includes('--update') })) && ok
  process.exit(ok ? 0 : 1)
}
