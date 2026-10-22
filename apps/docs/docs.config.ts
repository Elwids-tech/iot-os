// The only place the product name, company name, tagline, domains and addresses
// live (contracts/docs-config.md). Real values come from PUBLIC_DOCS_* variables
// at build time, or from .local/docs/docs.env locally; the committed defaults are
// placeholders. `check-docs literals` fails when a configured value is written
// anywhere else in src/.
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const localEnvFile = fileURLToPath(new URL('../../.local/docs/docs.env', import.meta.url))
if (existsSync(localEnvFile)) process.loadEnvFile(localEnvFile)

function text(name: string, fallback: string): string {
  const value = process.env[name]?.trim()
  return value ? value : fallback
}

function httpsUrl(name: string, fallback: string, { root = false } = {}): string {
  const value = text(name, fallback)
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`${name} must be an absolute https URL`)
  }
  if (url.protocol !== 'https:') throw new Error(`${name} must use https`)
  if (root && url.pathname !== '/') throw new Error(`${name} must be a domain root, with no path`)
  return root ? url.origin : value.replace(/\/$/, '')
}

function hostname(name: string, fallback: string): string {
  const value = text(name, fallback)
  if (!/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i.test(value)) {
    throw new Error(`${name} must be a bare hostname`)
  }
  return value
}

export const docsConfig = {
  productName: text('PUBLIC_DOCS_PRODUCT_NAME', 'IoT OS'),
  companyName: text('PUBLIC_DOCS_COMPANY_NAME', 'Example Company'),
  companyTagline: text('PUBLIC_DOCS_COMPANY_TAGLINE', 'Example Company tagline'),
  siteUrl: httpsUrl('PUBLIC_DOCS_SITE_URL', 'https://platform.example.com', { root: true }),
  marketingUrl: httpsUrl('PUBLIC_DOCS_MARKETING_URL', 'https://www.example.com'),
  contactUrl: httpsUrl('PUBLIC_DOCS_CONTACT_URL', 'https://www.example.com/contact'),
  portalUrl: httpsUrl('PUBLIC_DOCS_PORTAL_URL', 'https://app.example.com'),
  apiBaseUrl: httpsUrl('PUBLIC_DOCS_API_BASE_URL', 'https://api.example.com'),
  brokerHost: hostname('PUBLIC_DOCS_BROKER_HOST', 'mqtt.example.com'),
} as const

export type DocsConfig = typeof docsConfig
