// Reads the files scripts/sources.mjs generated in .sources/. Astro builds run from
// apps/docs, so paths resolve from the working directory.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export function readSource<T = unknown>(path: string): T {
  return JSON.parse(readFileSync(join(process.cwd(), '.sources', path), 'utf8')) as T
}

export interface SourcesMeta {
  contract_version: string | null
  sdk_version: string | null
  operations: string[]
  event_types: string[]
  guide_sections: { section: string; slugs: string[] }[]
}
