import { describe, expect, it } from "vitest"
import type { Binding, Resource, Workflow } from "@iot-os/workflow-editor"
import { bindParameter, currentBinding, pruneBindings, refreshBindings, staleBindings, unusedBindings } from "./bindings"

const temperature = { uuid: "11111111-1111-4111-a111-111111111111", key: "temperature", data_type: "number", unit: "°C", accepts_command: false, reports_state: true }
const humidity = { uuid: "22222222-2222-4222-a222-222222222222", key: "humidity", data_type: "integer", unit: "%", accepts_command: false, reports_state: true }
const tracker: Resource = { device_uuid: "device", name: "Tracker", configuration_uuid: "configuration-2", generation: 2, poll_interval_seconds: 3600, parameters: [temperature, humidity] }
const bound: Binding = { role: "temperature", device_uuid: "device", configuration_uuid: "configuration-1", generation: 1, parameter_uuid: temperature.uuid, data_type: "number", unit: "°C", fresh_seconds: 7200 }
// A saved draft whose node ID differs from its binding role.
const graph: Workflow = {
  schema_version: "automation-workflow.v2",
  bindings: [bound],
  nodes: [{ id: "temp", type: "source.parameter.v1", config: { binding: "temperature" } }, { id: "cold", type: "compare.v1", config: { operator: "lt", value: 2 } }],
  edges: [{ source: "temp", source_port: "value", target: "cold", target_port: "in" }],
}
const current = { device_uuid: "device", configuration_uuid: "configuration-2", generation: 2, parameter_uuid: humidity.uuid, data_type: "number" as const, unit: "%", fresh_seconds: 7200 }

describe("stale bindings", () => {
  it("flags a binding to an earlier generation or configuration and rewrites it in place", () => {
    const stale = staleBindings(graph, { device: tracker })
    expect(stale).toEqual([{ binding: bound, current: { ...bound, configuration_uuid: "configuration-2", generation: 2 } }])
    const refreshed = refreshBindings(graph, stale)
    expect(refreshed.bindings).toEqual([{ ...bound, configuration_uuid: "configuration-2", generation: 2 }])
    expect(refreshed.nodes).toBe(graph.nodes)
    expect(staleBindings(refreshed, { device: tracker })).toEqual([])
  })
  it("flags a generation change alone, with the configuration unchanged", () => {
    expect(staleBindings(graph, { device: { ...tracker, configuration_uuid: "configuration-1" } })).toHaveLength(1)
  })
  it("waits for the device and keeps bindings it cannot refresh", () => {
    expect(staleBindings(graph, {})).toEqual([])
    const gone = staleBindings(graph, { device: null })
    expect(gone).toEqual([{ binding: bound, current: undefined }])
    expect(refreshBindings(graph, gone)).toBe(graph)
    expect(currentBinding(bound, { ...tracker, parameters: [humidity] })).toBeUndefined()
  })
  it("takes the parameter's current type and unit, which deploy also checks", () => {
    const fahrenheit = { ...tracker, parameters: [{ ...temperature, data_type: "integer", unit: "°F" }] }
    expect(currentBinding(bound, fahrenheit)).toMatchObject({ data_type: "number", unit: "°F", fresh_seconds: 7200, role: "temperature" })
  })
  it("ignores unused bindings, which saving drops", () => {
    const orphaned = { ...graph, bindings: [bound, { ...bound, role: "temp", configuration_uuid: "configuration-2", generation: 2 }] }
    expect(staleBindings({ ...orphaned, nodes: [{ ...graph.nodes[0], config: { binding: "temp" } }, graph.nodes[1]] }, { device: tracker })).toEqual([])
  })
})

describe("re-binding a parameter node", () => {
  it("rewrites the node's own binding instead of adding one under the node ID", () => {
    const next = bindParameter(graph, graph.nodes[0], current)
    expect(next.bindings).toEqual([{ role: "temperature", ...current }])
    expect(next.nodes[0].config.binding).toBe("temperature")
    expect(unusedBindings(next)).toEqual([])
  })
  it("names a new binding after the node", () => {
    const unbound = { ...graph, bindings: [], nodes: [{ ...graph.nodes[0], config: {} }, graph.nodes[1]] }
    const next = bindParameter(unbound, unbound.nodes[0], current)
    expect(next.bindings.map(b => b.role)).toEqual(["temp"])
    expect(next.nodes[0].config.binding).toBe("temp")
  })
  it("leaves a binding shared with a legacy command to that command", () => {
    const shared = { ...graph, nodes: [...graph.nodes, { id: "fan", type: "action.command.v1", config: { binding: "temperature", value: 1 } }, { id: "heater", type: "action.command.v1", config: { settings: { temp: 0, temp_2: 1 } } }] }
    const next = bindParameter(shared, shared.nodes[0], current)
    expect(next.bindings.find(b => b.role === "temperature")).toEqual(bound)
    expect(next.nodes[0].config.binding).toBe("temp_3")
    expect(next.bindings.find(b => b.role === "temp_3")).toEqual({ role: "temp_3", ...current })
  })
})

describe("pruning", () => {
  it("drops bindings no node reads or commands and keeps command settings", () => {
    const withCommand: Workflow = {
      ...graph,
      bindings: [bound, { ...bound, role: "temp" }, { ...bound, role: "cmd_fan" }],
      nodes: [...graph.nodes, { id: "fan", type: "action.command.v1", config: { settings: { cmd_fan: true } } }],
    }
    expect(unusedBindings(withCommand).map(b => b.role)).toEqual(["temp"])
    expect(pruneBindings(withCommand).bindings.map(b => b.role)).toEqual(["temperature", "cmd_fan"])
    expect(pruneBindings(graph)).toBe(graph)
  })
})
