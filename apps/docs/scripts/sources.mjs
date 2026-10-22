#!/usr/bin/env node
// Prepares everything the docs generate from this repository, read at the commit
// the hosted service runs (DOCS_HOSTED_REF), so the published docs describe what
// customers can use today (spec 013, research R4 and R5):
//
//   .sources/                        extracted contract, agent tools, help guides, SDK manifest
//   .sources/integration-openapi.json  the integration API only, with abilities and limits in descriptions
//   .sources/meta.json               versions, operations, event types and guide sections (never the commit)
//   src/content/docs/docs/guides/    the in-product guides as docs pages (generated, ignored by git)
//
// DOCS_SOURCES=worktree reads the working tree instead, for development and for
// builds without the secret (forks). The hosted commit is never printed.
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stringify } from 'yaml'
import { loadLocalEnv, repoRoot } from './lib/env.mjs'
import { filterIntegrationContract, operationList, eventTypes } from './lib/contract.mjs'
import { convertGuide, orderGuideSections } from './lib/guides.mjs'

loadLocalEnv()

const appRoot = fileURLToPath(new URL('..', import.meta.url))
const sourcesDir = join(appRoot, '.sources')
const guidesDir = join(appRoot, 'src/content/docs/docs/guides')
const inputs = [
  'contracts/openapi',
  'contracts/agents',
  'contracts/location',
  'apps/api/resources/help',
  'packages/integration-sdk/package.json',
  'tooling/simulators',
]

function fail(message) {
  console.error(`sources: ${message}`)
  process.exit(1)
}

rmSync(sourcesDir, { recursive: true, force: true })
rmSync(guidesDir, { recursive: true, force: true })
mkdirSync(sourcesDir, { recursive: true })

const ref = process.env.DOCS_HOSTED_REF?.trim()
const worktree = process.env.DOCS_SOURCES === 'worktree'

if (worktree) {
  for (const input of inputs) {
    const from = join(repoRoot, input)
    if (!existsSync(from)) fail(`missing ${input} in the working tree`)
    const to = join(sourcesDir, input)
    mkdirSync(dirname(to), { recursive: true })
    cpSync(from, to, { recursive: true, filter: (path) => !path.includes('__pycache__') })
  }
  console.log('sources: read from the working tree (DOCS_SOURCES=worktree)')
} else {
  if (!ref) fail('set DOCS_HOSTED_REF to the hosted commit, or DOCS_SOURCES=worktree for a local build')
  if (!/^[0-9a-f]{40}$/.test(ref)) fail('DOCS_HOSTED_REF must be a full 40-character commit SHA')
  try {
    execFileSync('git', ['cat-file', '-e', `${ref}^{commit}`], { cwd: repoRoot, stdio: 'ignore' })
  } catch {
    fail('the hosted commit is not in this clone: set DOCS_HOSTED_REF and fetch history (fetch-depth: 0)')
  }
  // An older hosted commit may not have every input yet (the simulators, say).
  const present = inputs.filter((input) => {
    try {
      execFileSync('git', ['cat-file', '-e', `${ref}:${input}`], { cwd: repoRoot, stdio: 'ignore' })
      return true
    } catch {
      return false
    }
  })
  const archive = execFileSync('git', ['archive', '--format=tar', ref, ...present], {
    cwd: repoRoot,
    maxBuffer: 256 * 1024 * 1024,
  })
  execFileSync('tar', ['-x', '-C', sourcesDir], { input: archive })
  console.log('sources: read from the hosted commit (DOCS_HOSTED_REF)')
}

// docs.config.ts is TypeScript, so read the same variables it reads, with the same
// placeholders.
const setting = (name, fallback) => (process.env[name]?.trim() || fallback).replace(/\/$/, '')
const apiBaseUrl = setting('PUBLIC_DOCS_API_BASE_URL', 'https://api.example.com')
const portalUrl = setting('PUBLIC_DOCS_PORTAL_URL', 'https://app.example.com')
const productName = setting('PUBLIC_DOCS_PRODUCT_NAME', 'IoT OS')

const contract = JSON.parse(readFileSync(join(sourcesDir, 'contracts/openapi/openapi.json'), 'utf8'))
let filtered
try {
  filtered = filterIntegrationContract(contract, {
    apiBaseUrl,
    productName,
    readExternal: (ref) => {
      const file = resolve(sourcesDir, 'contracts/openapi', ref)
      if (!file.startsWith(join(sourcesDir, 'contracts'))) throw new Error(`external $ref outside contracts: ${ref}`)
      if (!existsSync(file)) throw new Error(`unresolved $ref ${ref}`)
      return JSON.parse(readFileSync(file, 'utf8'))
    },
  })
} catch (error) {
  fail(`contracts/openapi/openapi.json: ${error.message}`)
}
writeFileSync(join(sourcesDir, 'integration-openapi.json'), `${JSON.stringify(filtered, null, 2)}\n`)

const helpDir = join(sourcesDir, 'apps/api/resources/help')
const guides = readdirSync(helpDir)
  .filter((name) => name.endsWith('.md'))
  .map((name) => ({ file: name, source: readFileSync(join(helpDir, name), 'utf8') }))
const slugs = new Set(guides.map(({ file }) => file.replace(/\.md$/, '')))
mkdirSync(guidesDir, { recursive: true })
const converted = []
for (const { file, source } of guides) {
  try {
    const page = convertGuide(source, { file, slugs, portalUrl })
    converted.push(page)
    writeFileSync(join(guidesDir, `${page.slug}.md`), `---\n${stringify(page.frontmatter)}---\n\n${page.body}`)
  } catch (error) {
    fail(`${file}: ${error.message}`)
  }
}

const sdk = JSON.parse(readFileSync(join(sourcesDir, 'packages/integration-sdk/package.json'), 'utf8'))
const meta = {
  contract_version: contract.info?.version ?? null,
  sdk_version: sdk.version ?? null,
  operations: operationList(filtered),
  event_types: eventTypes(filtered),
  guide_sections: orderGuideSections(converted),
}
writeFileSync(join(sourcesDir, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`)
console.log(
  `sources: ${meta.operations.length} operations, ${meta.event_types.length} event types, ${converted.length} guides`,
)
