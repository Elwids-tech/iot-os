// The committed half of the hosted release record: which deployment-switched
// features the hosted service has on. The hosted commit itself is the
// DOCS_HOSTED_REF secret and never appears here.
import Ajv from 'ajv/dist/2020.js'
import record from '../../hosted-release.json' with { type: 'json' }
import schema from '../../schemas/hosted-release.schema.json' with { type: 'json' }

export interface HostedRelease {
  schema_version: 'hosted-release.v1'
  features: { adapters: boolean; agent_access: boolean }
}

const validate = new Ajv({ allErrors: true }).compile<HostedRelease>(schema)
if (!validate(record)) {
  throw new Error(`apps/docs/hosted-release.json is invalid: ${JSON.stringify(validate.errors)}`)
}

export const hostedRelease: HostedRelease = record
