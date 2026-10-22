// Helpers for rendering JSON Schema properties from the filtered contract.
export interface Schema {
  $ref?: string
  type?: string | string[]
  format?: string
  const?: unknown
  enum?: unknown[]
  items?: Schema
  anyOf?: Schema[]
  oneOf?: Schema[]
  properties?: Record<string, Schema>
  required?: string[]
  description?: string
  discriminator?: { propertyName: string; mapping: Record<string, string> }
  [key: string]: unknown
}

export const refName = (ref: string) => ref.split('/').pop() ?? ref

export function resolveSchema(schemas: Record<string, Schema>, node: Schema | undefined): Schema | undefined {
  if (!node) return undefined
  return node.$ref ? schemas[refName(node.$ref)] : node
}

export function typeLabel(node: Schema | undefined): string {
  if (!node) return ''
  if (node.$ref) return refName(node.$ref)
  if (node.const !== undefined) return JSON.stringify(node.const)
  if (node.enum) return node.enum.map((value) => JSON.stringify(value)).join(' | ')
  const variants = node.anyOf ?? node.oneOf
  if (variants) return variants.map(typeLabel).join(' or ')
  const types = Array.isArray(node.type) ? node.type : node.type ? [node.type] : []
  return types
    .map((type) => (type === 'array' ? `${typeLabel(node.items)}[]` : node.format && type !== 'null' ? `${type} (${node.format})` : type))
    .join(' or ')
}
