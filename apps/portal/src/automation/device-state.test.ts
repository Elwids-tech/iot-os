import { describe, expect, it } from "vitest"
import type { Workflow } from "@iot-os/workflow-editor"
import { commandGrants, commandSettings, initialSetting, updateDeviceSettings, type ControlResource } from "./device-state"
const parameter = { uuid: "11111111-1111-4111-a111-111111111111", key: "power", label: "Power", kind: "state" as const, data_type: "boolean" as const, accepts_command: true, reports_state: true, format: null, unit: null, validation: null, display: null, reporting: null, counter: null }
const device: ControlResource = { device_uuid: "device", configuration_uuid: "configuration", generation: 1, name: "Board", parameters: [parameter, { ...parameter, uuid: "22222222-2222-4222-a222-222222222222", key: "volume", label: "Volume", data_type: "integer", display: { min: 1, max: 100, widget: "slider" } }] }
const graph: Workflow = { schema_version: "automation-workflow.v2", bindings: [{ role: "shared", device_uuid: "device", configuration_uuid: "configuration", generation: 1, parameter_uuid: parameter.uuid, data_type: "boolean", unit: "", fresh_seconds: 30 }], nodes: [{ id: "source", type: "source.parameter.v1", config: { binding: "shared" } }, { id: "control", type: "action.command.v1", config: { binding: "shared", value: true, cooldown_seconds: 60, ttl_seconds: 15 } }], edges: [] }
describe("device settings authoring", () => {
 it("preserves shared source bindings when converting a legacy command to multiple settings", () => {
  const next = updateDeviceSettings(graph, graph.nodes[1], device, { [parameter.uuid]: false, [device.parameters[1].uuid]: 20 })
  expect(next.bindings.find(b => b.role === "shared")).toEqual(graph.bindings[0])
  expect(commandGrants(next).map(g => g.value)).toEqual([false, 20])
  expect(next.nodes[1].config).not.toHaveProperty("binding")
  expect(commandSettings(graph.nodes[1])).toEqual({ shared: true })
 })
 it("clears only owned command settings on a device change", () => {
  const next = updateDeviceSettings(graph, graph.nodes[1], device, { [parameter.uuid]: true, [device.parameters[1].uuid]: 20 })
  const cleared = updateDeviceSettings(next, next.nodes[1], undefined, {})
  expect(cleared.bindings).toEqual(graph.bindings)
  expect(commandGrants(cleared)).toEqual([])
 })
 it("uses typed defaults and preserves legacy grants", () => {
  expect(initialSetting(parameter)).toBe(false)
  expect(initialSetting(device.parameters[1])).toBe(1)
  expect(commandGrants(graph)).toEqual([{ node_id: "control", binding: "shared", value: true, cooldown_seconds: 60 }])
 })
})
