import type { DeviceProfileParameter } from "@iot-os/api-client"
import type { Binding, Resource, Workflow, WorkflowNode } from "@iot-os/workflow-editor"
import { controlSpec, type ControlValue } from "../controls/model"

export type ControlResource = Omit<Resource, "parameters"> & { parameters: DeviceProfileParameter[] }
export function commandSettings(node: WorkflowNode): Record<string, unknown> {
  if (node.config.settings && typeof node.config.settings === "object" && !Array.isArray(node.config.settings))
    return node.config.settings as Record<string, unknown>
  return typeof node.config.binding === "string" ? { [node.config.binding]: node.config.value } : {}
}
export function initialSetting(parameter: DeviceProfileParameter): ControlValue {
  const spec = controlSpec(parameter)
  if (spec.kind === "switch") return false
  if (spec.kind === "color") return "#000000"
  if (spec.options?.length) return spec.options[0]
  if (["number", "slider"].includes(spec.kind)) return spec.min ?? 0
  return ""
}
export function updateDeviceSettings(graph: Workflow, node: WorkflowNode, device: ControlResource | undefined, values: Record<string, unknown>): Workflow {
  const oldRoles = new Set(Object.keys(commandSettings(node)))
  const usedElsewhere = new Set(graph.nodes.filter(n => n.id !== node.id).flatMap(n => [String(n.config.binding ?? ""), ...Object.keys(commandSettings(n))]))
  const bindings = graph.bindings.filter(b => !oldRoles.has(b.role) || usedElsewhere.has(b.role))
  const settings: Record<string, unknown> = {}
  for (const [parameterUuid, value] of Object.entries(values)) {
    const p = device?.parameters.find(p => p.uuid === parameterUuid)
    if (!p || !device) continue
    // Own bindings avoid changing a source node that shares a legacy command binding.
    const previous = graph.bindings.find(b => oldRoles.has(b.role) && !usedElsewhere.has(b.role) && b.parameter_uuid === p.uuid)
    const role = previous?.role ?? `cmd_${crypto.randomUUID().replaceAll("-", "")}`
    const binding: Binding = { role, device_uuid: device.device_uuid, configuration_uuid: device.configuration_uuid, generation: device.generation, parameter_uuid: p.uuid, data_type: ["number", "integer"].includes(p.data_type) ? "number" : p.data_type === "boolean" ? "boolean" : "string", unit: p.unit ?? "", fresh_seconds: 120 }
    const existing = bindings.findIndex(b => b.role === role)
    if (existing >= 0) bindings[existing] = binding
    else bindings.push(binding)
    settings[role] = value
  }
  const { binding: _binding, value: _value, ...config } = node.config
  return { ...graph, bindings, nodes: graph.nodes.map(n => n.id === node.id ? { ...node, config: { ...config, settings } } : n) }
}
export function commandGrants(graph: Workflow) {
  return graph.nodes.filter(n => n.type === "action.command.v1").flatMap(n => Object.entries(commandSettings(n)).map(([binding, value]) => ({ node_id: n.id, binding, value, cooldown_seconds: n.config.cooldown_seconds })))
}
