import { describe, expect, it } from "vitest"
import type { Binding, Workflow } from "@iot-os/workflow-editor"
import { centroid, defaultSamples, insideRing, locationInputs, nodeOutcomes, requestedActions, sampleError, simulationSteps, type SimResult } from "./simulation"

const ring = [[-114.01, 51.01], [-114.0, 51.01], [-114.0, 51.02], [-114.01, 51.02], [-114.01, 51.01]]
const binding = (role: string, data_type: Binding["data_type"] = "number"): Binding => ({
  role, device_uuid: "tracker", configuration_uuid: "config", generation: 3, parameter_uuid: `p-${role}`, data_type, unit: data_type === "number" ? "deg" : "", fresh_seconds: 120,
})
const gps: Workflow = {
  schema_version: "automation-workflow.v2",
  bindings: [binding("latitude"), binding("longitude"), binding("armed", "boolean")],
  nodes: [
    { id: "latitude", type: "source.parameter.v1", config: { binding: "latitude" } },
    { id: "longitude", type: "source.parameter.v1", config: { binding: "longitude" } },
    { id: "armed", type: "source.parameter.v1", config: { binding: "armed" } },
    { id: "pair", type: "join.v1", config: { mode: "latest" } },
    { id: "boundary", type: "geofence.v1", config: { condition: "inside", geometry: { type: "Polygon", coordinates: [ring] } } },
  ],
  edges: [
    { source: "latitude", source_port: "out", target: "pair", target_port: "a" },
    { source: "longitude", source_port: "out", target: "pair", target_port: "b" },
    { source: "pair", source_port: "a", target: "boundary", target_port: "latitude" },
    { source: "pair", source_port: "b", target: "boundary", target_port: "longitude" },
  ],
}

describe("simulation inputs", () => {
  it("finds latitude/longitude sources through a correlation join", () => {
    const [pair] = locationInputs(gps)
    expect(pair).toMatchObject({ latitude: "latitude", longitude: "longitude" })
    expect(pair.polygon?.[0]).toHaveLength(5)
  })
  it("defaults a location to the geofence centroid instead of 0,0", () => {
    const center = centroid(ring)!
    expect(center.latitude).toBeCloseTo(51.015, 6)
    expect(center.longitude).toBeCloseTo(-114.005, 6)
    expect(insideRing(center, ring)).toBe(true)
    expect(defaultSamples(gps)).toEqual({ latitude: "51.015000", longitude: "-114.005000", armed: "false" })
  })
  it("leaves coordinates empty and invalid without a usable boundary", () => {
    const open = { ...gps, nodes: gps.nodes.map((n) => n.type === "geofence.v1" ? { ...n, config: { ...n.config, geometry: "" } } : n) }
    expect(defaultSamples(open).latitude).toBe("")
    expect(sampleError("", binding("latitude"), "latitude")).toMatch(/pick a point/)
    expect(sampleError("91", binding("latitude"), "latitude")).toMatch(/between -90 and 90/)
    expect(sampleError("-181", binding("longitude"), "longitude")).toMatch(/between -180 and 180/)
    expect(sampleError("0", binding("latitude"), "latitude")).toBeUndefined()
  })
  it("sends one event per device with its readings together", () => {
    let n = 0
    const { steps, labels } = simulationSteps(gps, { latitude: "51.015", longitude: "-114.005", armed: "true" }, "org", Date.UTC(2026, 9, 9), () => `id-${++n}`)
    expect(steps).toHaveLength(3)
    expect(labels).toEqual(["Start", "Readings · latitude, longitude, armed", "Clock +2s"])
    const event = steps[1].event as { readings: { parameter_uuid: string; value: unknown }[] }
    expect(event.readings.map((r) => r.value)).toEqual([51.015, -114.005, true])
  })
  it("repeats steady readings before the clock passes a sustained duration longer than their freshness", () => {
    let n = 0
    const held: Workflow = { ...gps, nodes: [...gps.nodes, { id: "held", type: "sustained.v1", config: { seconds: 300 } }] }
    const { steps, labels } = simulationSteps(held, { latitude: "51.015", longitude: "-114.005", armed: "true" }, "org", Date.UTC(2026, 9, 9), () => `id-${++n}`)
    expect(labels).toEqual(["Start", "Readings · latitude, longitude, armed", "Same readings at +301s · latitude, longitude, armed", "Clock +302s"])
    const again = steps[2].event as { event_id: string; readings: { observed_at: string; value: unknown }[] }
    // Fresh for 120 s, so only a repeat keeps the signal live at +302 s.
    expect(again.readings[0].observed_at).toBe(new Date(Date.UTC(2026, 9, 9) + 301_000).toISOString())
    expect(again.readings.map((r) => r.value)).toEqual([51.015, -114.005, true])
    expect(again.event_id).not.toBe((steps[1].event as { event_id: string }).event_id)
  })
  it("starts on a shared window boundary and closes only the first window", () => {
    const windowed: Workflow = { ...gps, nodes: [...gps.nodes, { id: "avg", type: "window.v1", config: { duration_seconds: 600, slide_seconds: 300, lateness_seconds: 5 } }] }
    // 07:04:10 rounds down to the 5-minute slide, not just the minute.
    const { steps, labels } = simulationSteps(windowed, { latitude: "1", longitude: "1", armed: "true" }, "org", Date.UTC(2026, 9, 9, 7, 4, 10), () => "id")
    expect(steps[0].at).toBe(new Date(Date.UTC(2026, 9, 9, 7, 0)).toISOString())
    expect(labels.at(-1)).toBe("Clock +605s")
  })
})

describe("simulation outcomes", () => {
  const trace = (node_id: string, status: string) => ({ node_id, status, reason: status, inputs: {}, outputs: {} })
  const result: SimResult = {
    draft_revision: 4, labels: ["Start", "Readings", "Clock"],
    steps: [
      { trace: [trace("boundary", "waiting"), trace("alarm", "not_matched")], intents: [] },
      { trace: [trace("boundary", "matched"), trace("alarm", "triggered")], intents: [{ id: "i", node_id: "alarm", kind: "action.command.v1", trigger: "episode:1" }] },
      { trace: [trace("boundary", "matched"), trace("alarm", "suppressed")], intents: [] },
    ],
  }
  it("keeps a fired action visible in the summary", () => {
    const summary = nodeOutcomes(result, "summary")
    expect(summary.alarm).toMatchObject({ status: "triggered", label: "Action requested" })
    expect(summary.boundary).toMatchObject({ status: "matched", label: "True" })
  })
  it("shows a single step as evaluated", () => {
    expect(nodeOutcomes(result, 2).alarm.label).toBe("Suppressed")
    expect(nodeOutcomes(result, 0).boundary.label).toBe("Waiting")
  })
})

describe("requested actions", () => {
  it("lists a device-state node once with the settings it would send", () => {
    const graph: Workflow = { ...gps, nodes: [...gps.nodes, { id: "lamp", type: "action.command.v1", config: { settings: { colour: "#FF0000", power_state: true } } }, { id: "notify", type: "action.alert.v1", config: {} }] }
    const intent = (node_id: string, kind: string, trigger: string) => ({ id: trigger, node_id, kind, trigger })
    expect(requestedActions(graph, [
      intent("lamp", "action.command.v1", "episode:1:colour"),
      intent("lamp", "action.command.v1", "episode:1:power_state"),
      intent("notify", "action.alert.v1", "episode:1"),
    ]).map((a) => [a.node_id, a.settings])).toEqual([["lamp", ["colour", "power state"]], ["notify", []]])
  })
})
