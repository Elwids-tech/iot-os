// Loads .local/docs/docs.env (ignored by git) into process.env when it exists.
// Values already in the environment win, so CI variables and secrets override it.
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url))
export const localEnvFile = fileURLToPath(new URL('../../../../.local/docs/docs.env', import.meta.url))

export function loadLocalEnv() {
  if (existsSync(localEnvFile)) process.loadEnvFile(localEnvFile)
}
