import { describe, expect, it } from "vitest"
import type { Workflow } from "@iot-os/workflow-editor"
import { draftSignature, changedNodes } from "./assistant-draft"

const graph: Workflow = { schema_version: "automation-workflow.v2", bindings: [], nodes: [{ id: "limit", type: "compare.v1", config: { operator: "gt", value: 25 } }], edges: [] }

describe("assistant draft review", () => {
  it("detects concurrent changes to values, bindings, connections and name", () => {
    const baseline = draftSignature("Alarm", graph)
    expect(draftSignature("Renamed", graph)).not.toBe(baseline)
    expect(draftSignature("Alarm", { ...graph, nodes: [{ ...graph.nodes[0], config: { operator: "gt", value: 30 } }] })).not.toBe(baseline)
    expect(draftSignature("Alarm", { ...graph, edges: [{ source: "limit", source_port: "out", target: "alarm", target_port: "in" }] })).not.toBe(baseline)
    expect(draftSignature("Alarm", { ...graph, bindings: [{ role: "temperature", device_uuid: "changed", parameter_uuid: "p", configuration_uuid: "c", generation: 2, data_type: "number", unit: "C", fresh_seconds: 60 }] })).not.toBe(baseline)
  })
  it("ignores server metadata and object property order", () => {
    expect(draftSignature("Alarm", { ...graph, uuid: "server", version_uuid: "revision", nodes: [{ ...graph.nodes[0], config: { value: 25, operator: "gt" } }] })).toBe(draftSignature("Alarm", graph))
  })
  it("summarizes additions, removals and settings changes", () => {
    const next: Workflow = { ...graph, nodes: [{ id: "alarm", type: "action.command.v1", config: { settings: { alarm: true, volume: 20 } } }] }
    expect(changedNodes(graph, next).map(item => [item.change, item.node.id])).toEqual([["Add", "alarm"], ["Remove", "limit"]])
    expect(changedNodes(next, { ...next, nodes: [{ ...next.nodes[0], config: { settings: { alarm: false } } }] })[0].change).toBe("Update")
  })
})
