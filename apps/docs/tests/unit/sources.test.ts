import { describe, expect, it } from 'vitest'
import { eventTypes, filterIntegrationContract, operationList } from '../../scripts/lib/contract.mjs'
import { convertGuide, orderGuideSections } from '../../scripts/lib/guides.mjs'

const operation = (extra: Record<string, unknown> = {}) => ({
  summary: 'List devices',
  description: 'The granted devices.',
  security: [{ applicationToken: [] }],
  'x-abilities': { all: ['devices:read'] },
  'x-rate-limits': [
    { key: 'ip', limit: 240, per: 'minute' },
    { key: 'application', limit: 60, per: 'minute' },
  ],
  responses: { '200': { $ref: '#/components/responses/Devices' } },
  ...extra,
})

const contract = () => ({
  openapi: '3.1.0',
  info: { title: 'Platform API', version: '1.2.0' },
  paths: {
    '/integration/v1/devices': { get: operation() },
    '/v1/admin/users': { get: { summary: 'First-party only', responses: { '200': { $ref: '#/components/responses/Users' } } } },
  },
  webhooks: { integrationEvent: { post: { requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Event' } } } } } } },
  components: {
    responses: {
      Devices: { description: 'ok', content: { 'application/json': { schema: { $ref: '#/components/schemas/Device' } } } },
      Users: { description: 'ok' },
    },
    schemas: {
      Device: { type: 'object', properties: { fix: { $ref: '../location/v1/fix.schema.json' } } },
      Event: { type: 'object', properties: { type: { $ref: '#/components/schemas/IntegrationEventType' } } },
      IntegrationEventType: { type: 'string', enum: ['b.v1', 'a.v1'] },
      AdminOnly: { type: 'object' },
    },
    securitySchemes: { applicationToken: { type: 'http', scheme: 'bearer' }, session: { type: 'apiKey' } },
  },
})

const options = {
  apiBaseUrl: 'https://api.example.com',
  productName: 'Example Platform',
  readExternal: () => ({ $schema: 'x', $id: 'y', type: 'object', title: 'Fix' }),
}

describe('filterIntegrationContract', () => {
  it('keeps only the integration paths, the webhook and the components they reference', () => {
    const filtered = filterIntegrationContract(contract(), options)
    expect(Object.keys(filtered.paths)).toEqual(['/integration/v1/devices'])
    expect(Object.keys(filtered.components.schemas).sort()).toEqual(['Device', 'Event', 'IntegrationEventType', 'LocationFix'])
    expect(Object.keys(filtered.components.responses)).toEqual(['Devices'])
    expect(Object.keys(filtered.components.securitySchemes)).toEqual(['applicationToken'])
    expect(filtered.servers).toEqual([{ url: 'https://api.example.com/api' }])
    expect(filtered.info.title).toBe('Example Platform integration API')
  })

  it('inlines external schema files as components', () => {
    const filtered = filterIntegrationContract(contract(), options)
    expect(filtered.components.schemas.Device.properties.fix.$ref).toBe('#/components/schemas/LocationFix')
    expect(filtered.components.schemas.LocationFix).toEqual({ type: 'object', title: 'Fix' })
  })

  it('writes abilities and rate limits into each operation description', () => {
    const description = filterIntegrationContract(contract(), options).paths['/integration/v1/devices'].get.description
    expect(description).toContain('**Requires:** `devices:read`')
    expect(description).toContain('**Rate limits:** 240 a minute per address, 60 a minute per application')
    expect(description).toContain('The granted devices.')
  })

  it('describes "one of" abilities', () => {
    const source = contract()
    source.paths['/integration/v1/devices'].get = operation({ 'x-abilities': { all: ['events:read'], any_of: [['alerts:read', 'geofences:read']] } })
    const description = filterIntegrationContract(source, options).paths['/integration/v1/devices'].get.description
    expect(description).toContain('`events:read`, plus one of `alerts:read` or `geofences:read`')
  })

  it('fails on an unresolved $ref', () => {
    const source = contract()
    source.components.schemas.Device = { type: 'object', properties: { owner: { $ref: '#/components/schemas/Missing' } } } as never
    expect(() => filterIntegrationContract(source, options)).toThrow('unresolved $ref #/components/schemas/Missing')
  })

  it('fails on an operation without x-abilities', () => {
    const source = contract()
    delete (source.paths['/integration/v1/devices'].get as Record<string, unknown>)['x-abilities']
    expect(() => filterIntegrationContract(source, options)).toThrow('GET /integration/v1/devices has no x-abilities')
  })

  it('lists operations and event types sorted', () => {
    const filtered = filterIntegrationContract(contract(), options)
    expect(operationList(filtered)).toEqual(['GET /integration/v1/devices'])
    expect(eventTypes(filtered)).toEqual(['a.v1', 'b.v1'])
  })
})

const guide = (front: Record<string, unknown>, body = '## Purpose\nSee [alerts](/help/alerts) and [Devices](/devices).\n') =>
  `---\n${JSON.stringify(front, null, 2)}\n---\n${body}`
const front = {
  slug: 'devices',
  title: 'Register devices',
  section: 'Devices',
  contexts: ['devices'],
  keywords: ['device'],
  required_capabilities: ['devices.view'],
  revision: 2,
  summary: 'Register and watch devices.',
  questions: ['How do I add one?'],
}
const settings = { file: 'devices.md', slugs: new Set(['devices', 'alerts']), portalUrl: 'https://app.example.com' }

describe('convertGuide', () => {
  it('maps the front matter and rewrites help and portal links', () => {
    const page = convertGuide(guide(front), settings)
    expect(page.frontmatter).toEqual({
      title: 'Register devices',
      description: 'Register and watch devices.',
      help_revision: 2,
      requires: ['devices.view'],
      sidebar: { label: 'Register devices' },
    })
    expect(page.body).toContain('](/docs/guides/alerts/)')
    expect(page.body).toContain('](https://app.example.com/devices)')
  })

  it('fails on an unknown front matter field', () => {
    expect(() => convertGuide(guide({ ...front, extra: true }), settings)).toThrow('unknown fields extra')
  })

  it('fails on a missing field', () => {
    const { summary: _summary, ...rest } = front
    expect(() => convertGuide(guide(rest), settings)).toThrow('missing summary')
  })

  it('fails on a link to an unknown guide', () => {
    expect(() => convertGuide(guide(front, 'See [x](/help/nowhere).\n'), settings)).toThrow('unknown guide nowhere')
  })
})

describe('orderGuideSections', () => {
  it('orders sections by the known order and guides by title length', () => {
    const sections = orderGuideSections([
      { slug: 'b', section: 'Devices', title: 'Device history' },
      { slug: 'a', section: 'Devices', title: 'Devices' },
      { slug: 'c', section: 'Getting started', title: 'Getting started' },
      { slug: 'd', section: 'Zebra', title: 'Zebra' },
    ])
    expect(sections).toEqual([
      { section: 'Getting started', slugs: ['c'] },
      { section: 'Devices', slugs: ['a', 'b'] },
      { section: 'Zebra', slugs: ['d'] },
    ])
  })
})
