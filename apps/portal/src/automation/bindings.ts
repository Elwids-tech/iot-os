import type { Binding, Resource, Workflow, WorkflowNode } from "@iot-os/workflow-editor"
import { commandSettings } from "./device-state"

/** The runtime types integer parameters as numbers and everything but booleans as strings. */
export function bindingDataType(dataType: string): Binding["data_type"] {
  return dataType === "integer" || dataType === "number" ? "number" : dataType === "boolean" ? "boolean" : "string"
}

/** Roles a node reads or commands. */
function nodeRoles(node: WorkflowNode): string[] {
  const own = typeof node.config.binding === "string" && node.config.binding ? [node.config.binding] : []
  return node.type === "action.command.v1" ? [...own, ...Object.keys(commandSettings(node))] : own
}

export const nodesUsing = (graph: Workflow, role: string) => graph.nodes.filter(n => nodeRoles(n).includes(role))

/** Bindings no node uses. The runtime checks every binding on deploy, so a stale one fails activation all the same. */
export function unusedBindings(graph: Workflow): Binding[] {
  const used = new Set(graph.nodes.flatMap(nodeRoles))
  return graph.bindings.filter(b => !used.has(b.role))
}

export function pruneBindings(graph: Workflow): Workflow {
  const unused = new Set(unusedBindings(graph))
  return unused.size ? { ...graph, bindings: graph.bindings.filter(b => !unused.has(b)) } : graph
}

/**
 * Binds a parameter node, rewriting the binding it already owns so no orphan stays behind. A role
 * another node also reads (a legacy command shares its source's) is left alone for that node.
 */
export function bindParameter(graph: Workflow, node: WorkflowNode, binding: Omit<Binding, "role">): Workflow {
  const elsewhere = new Set(graph.nodes.filter(n => n.id !== node.id).flatMap(nodeRoles))
  const own = typeof node.config.binding === "string" && node.config.binding && !elsewhere.has(node.config.binding) ? node.config.binding : undefined
  let role = own ?? node.id
  for (let i = 2; !own && elsewhere.has(role); i++) role = `${node.id}_${i}`
  return {
    ...graph,
    bindings: [...graph.bindings.filter(b => b.role !== role), { role, ...binding }],
    nodes: graph.nodes.map(n => n.id === node.id ? { ...n, config: { ...n.config, binding: role } } : n),
  }
}

/** The binding on its device's current configuration, keeping its role, parameter and freshness; undefined once the parameter is gone. */
export function currentBinding(binding: Binding, device: Resource): Binding | undefined {
  const p = device.parameters.find(p => p.uuid === binding.parameter_uuid)
  if (!p || device.device_uuid !== binding.device_uuid) return undefined
  return { ...binding, configuration_uuid: device.configuration_uuid, generation: device.generation, data_type: bindingDataType(p.data_type), unit: p.unit ?? "" }
}

/** Each re-activation of a device configuration advances its generation; deploy refuses a binding that names an older one. */
export const bindingChanged = (binding: Binding, current: Binding) =>
  binding.configuration_uuid !== current.configuration_uuid || binding.generation !== current.generation || binding.data_type !== current.data_type || binding.unit !== current.unit

/** A used binding that deploy would refuse; `current` is its replacement, absent when the device or parameter is gone. */
export type StaleBinding = { binding: Binding; current?: Binding }

/** `devices` maps device UUIDs to their current resource, null once a device is unavailable, or nothing while it loads. */
export function staleBindings(graph: Workflow, devices: Record<string, Resource | null | undefined>): StaleBinding[] {
  return pruneBindings(graph).bindings.flatMap(binding => {
    const device = devices[binding.device_uuid]
    if (device === undefined) return []
    const current = device ? currentBinding(binding, device) : undefined
    return !current || bindingChanged(binding, current) ? [{ binding, current }] : []
  })
}

/** Moves every stale binding that still has a replacement onto its device's current configuration. */
export function refreshBindings(graph: Workflow, stale: StaleBinding[]): Workflow {
  const current = new Map(stale.flatMap(s => s.current ? [[s.binding.role, s.current] as const] : []))
  return current.size ? { ...graph, bindings: graph.bindings.map(b => current.get(b.role) ?? b) } : graph
}
