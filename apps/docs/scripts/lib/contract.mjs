// Filters the public API contract down to the integration API, the part external
// applications use, and writes each operation's abilities and rate limits into
// its description, because the reference renderer ignores vendor extensions.
const METHODS = ['get', 'put', 'post', 'delete', 'patch', 'options', 'head', 'trace']
const PREFIX = '/integration/v1'

function describeAbilities(abilities, label) {
  if (!abilities || typeof abilities !== 'object') throw new Error(`${label} has no x-abilities`)
  const parts = []
  if (Array.isArray(abilities.all) && abilities.all.length) {
    parts.push(abilities.all.map((ability) => `\`${ability}\``).join(' and '))
  }
  for (const group of abilities.any_of ?? []) {
    parts.push(`one of ${group.map((ability) => `\`${ability}\``).join(' or ')}`)
  }
  if (!parts.length) throw new Error(`${label} has an empty x-abilities`)
  return `**Requires:** ${parts.join(', plus ')}`
}

function describeLimits(limits, label) {
  if (!Array.isArray(limits) || !limits.length) throw new Error(`${label} has no x-rate-limits`)
  const keys = { ip: 'address', application: 'application' }
  const text = limits
    .map(({ limit, per, key }) => `${limit} a ${per} per ${keys[key] ?? key}`)
    .join(', ')
  return `**Rate limits:** ${text}`
}

function pointer(contract, ref) {
  const segments = ref
    .slice(2)
    .split('/')
    .map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'))
  let node = contract
  for (const segment of segments) {
    node = node?.[segment]
    if (node === undefined) throw new Error(`unresolved $ref ${ref}`)
  }
  return { segments, node }
}

// Names an external schema file after its folder and file: ../location/v1/fix.schema.json
// becomes LocationFix.
function externalName(ref) {
  const parts = ref.replace(/\.schema\.json$/, '').split('/').filter((part) => part && part !== '..' && !/^v\d+$/.test(part))
  return parts.map((part) => part.replace(/(^|[-_])(\w)/g, (_, __, letter) => letter.toUpperCase())).join('')
}

// Walks every node reachable from the paths and webhooks, copying the components they
// reference and inlining external schema files as components, so the filtered contract
// stands alone.
function bundle(root, contract, readExternal) {
  const components = {}
  const added = new Set()
  const queue = [root]
  const visit = (node) => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item)
      return
    }
    if (!node || typeof node !== 'object') return
    for (const [key, value] of Object.entries(node)) {
      if (key !== '$ref' || typeof value !== 'string') {
        visit(value)
        continue
      }
      if (value.startsWith('#/')) {
        const { segments, node: target } = pointer(contract, value)
        if (segments[0] !== 'components' || segments.length !== 3) throw new Error(`unsupported $ref ${value}`)
        const [, section, name] = segments
        if (!added.has(value)) {
          added.add(value)
          const copy = structuredClone(target)
          components[section] ??= {}
          components[section][name] = copy
          queue.push(copy)
        }
      } else {
        const name = externalName(value)
        const local = `#/components/schemas/${name}`
        if (!added.has(local)) {
          added.add(local)
          const schema = structuredClone(readExternal(value))
          delete schema.$schema
          delete schema.$id
          components.schemas ??= {}
          components.schemas[name] = schema
          queue.push(schema)
        }
        node.$ref = local
      }
    }
  }
  while (queue.length) visit(queue.pop())
  return components
}

/** @returns {Record<string, any>} */
export function filterIntegrationContract(contract, { apiBaseUrl, productName, readExternal }) {
  const paths = structuredClone(
    Object.fromEntries(Object.entries(contract.paths ?? {}).filter(([path]) => path.startsWith(PREFIX))),
  )
  if (!Object.keys(paths).length) throw new Error(`the contract has no ${PREFIX} paths`)
  const webhooks = structuredClone(contract.webhooks ?? {})

  const schemes = new Set()
  for (const [path, item] of Object.entries(paths)) {
    for (const method of METHODS) {
      const operation = item[method]
      if (!operation) continue
      const label = `${method.toUpperCase()} ${path}`
      const lines = [describeAbilities(operation['x-abilities'], label), describeLimits(operation['x-rate-limits'], label)]
      operation.description = [...lines, operation.description].filter(Boolean).join('\n\n')
      for (const requirement of operation.security ?? []) for (const name of Object.keys(requirement)) schemes.add(name)
    }
  }

  const components = bundle({ paths, webhooks }, contract, readExternal)
  for (const name of schemes) {
    const scheme = contract.components?.securitySchemes?.[name]
    if (!scheme) throw new Error(`unknown security scheme ${name}`)
    components.securitySchemes ??= {}
    components.securitySchemes[name] = scheme
  }

  const usedTags = new Set(
    Object.values(paths).flatMap((item) => METHODS.flatMap((method) => item[method]?.tags ?? [])),
  )
  return {
    openapi: contract.openapi,
    info: {
      title: `${productName} integration API`,
      version: contract.info?.version,
      description:
        'The scoped API that external applications use with an application token. ' +
        'Generated from the platform\'s API contract at the release the hosted service runs.',
    },
    servers: [{ url: `${apiBaseUrl}/api` }],
    tags: (contract.tags ?? []).filter((tag) => usedTags.has(tag.name)),
    paths,
    webhooks,
    components,
  }
}

export function operationList(filtered) {
  return Object.entries(filtered.paths)
    .flatMap(([path, item]) => METHODS.filter((method) => item[method]).map((method) => `${method.toUpperCase()} ${path}`))
    .sort()
}

export function eventTypes(filtered) {
  const values = filtered.components?.schemas?.IntegrationEventType?.enum
  if (!Array.isArray(values) || !values.length) throw new Error('the contract has no IntegrationEventType values')
  return [...values].sort()
}
