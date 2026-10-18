import { describe, expect, it } from "vitest";
import {
  arrangeNodes,
  duration,
  estimatedSize,
  nodeSummary,
  NODE_SIZE,
} from "./presentation";
import type { Binding, Workflow, WorkflowNode } from "./types";

const binding = (role: string, unit = "", data_type: Binding["data_type"] = "number"): Binding => ({
  role,
  device_uuid: role.startsWith("cmd_") ? "led" : "tracker",
  configuration_uuid: "config",
  generation: 1,
  parameter_uuid: `p-${role}`,
  data_type,
  unit,
  fresh_seconds: 30,
});
const ring = [[-114.01, 51.01], [-114.0, 51.01], [-114.0, 51.02], [-114.01, 51.02], [-114.005, 51.025], [-114.01, 51.01]];
const gps: Workflow = {
  schema_version: "automation-workflow.v2",
  bindings: [
    binding("latitude", "deg"),
    binding("longitude", "deg"),
    binding("brightness", "%"),
    binding("cmd_alarm", "", "boolean"),
    binding("cmd_volume", "%"),
  ],
  nodes: [
    { id: "latitude", type: "source.parameter.v1", config: { binding: "latitude" } },
    { id: "longitude", type: "source.parameter.v1", config: { binding: "longitude" } },
    { id: "coordinates", type: "join.v1", config: { mode: "latest" } },
    { id: "inside_boundary", type: "geofence.v1", config: { condition: "outside", geometry: { type: "Polygon", coordinates: [ring] }, uncertainty_metres: 2 } },
    { id: "light", type: "source.parameter.v1", config: { binding: "brightness" } },
    { id: "node_1a2b3c4d", type: "compare.v1", config: { operator: "gt", value: 80 } },
    { id: "either", type: "boolean.v1", config: { operator: "or" } },
    { id: "sound_alarm", type: "action.command.v1", config: { settings: { cmd_alarm: true, cmd_volume: 20 }, cooldown_seconds: 60 } },
  ],
  edges: [
    { source: "latitude", source_port: "out", target: "coordinates", target_port: "a" },
    { source: "longitude", source_port: "out", target: "coordinates", target_port: "b" },
    { source: "coordinates", source_port: "a", target: "inside_boundary", target_port: "latitude" },
    { source: "coordinates", source_port: "b", target: "inside_boundary", target_port: "longitude" },
    { source: "light", source_port: "out", target: "node_1a2b3c4d", target_port: "in" },
    { source: "inside_boundary", source_port: "out", target: "either", target_port: "a" },
    { source: "node_1a2b3c4d", source_port: "out", target: "either", target_port: "b" },
    { source: "either", source_port: "out", target: "sound_alarm", target_port: "in" },
  ],
};
const names = {
  tracker: "GPS Demo Tracker",
  led: "RGB LED",
  "p-latitude": "Latitude",
  "p-brightness": "Brightness",
  "p-cmd_alarm": "Alarm",
  "p-cmd_volume": "Volume",
};
const node = (id: string) => gps.nodes.find((n) => n.id === id)!;
const alone = (type: string, config: Record<string, unknown>): WorkflowNode => ({ id: "node_x", type, config });

describe("node summaries", () => {
  it("shows the configured values from the mockup", () => {
    expect(nodeSummary(node("node_1a2b3c4d"), gps, names)).toBe("Brightness > 80 %");
    expect(nodeSummary(node("inside_boundary"), gps)).toBe("Outside · 5 points · ±2 m");
    expect(nodeSummary(node("sound_alarm"), gps, names)).toBe("RGB LED · alarm on, volume 20 %");
    expect(nodeSummary(node("latitude"), gps, names)).toBe("GPS Demo Tracker · fresh 30 s");
  });

  it("falls back to binding roles and units without host names", () => {
    expect(nodeSummary(node("node_1a2b3c4d"), gps)).toBe("Light > 80 %");
    expect(nodeSummary(node("latitude"), gps)).toBe("deg · fresh 30 s");
    expect(nodeSummary(node("sound_alarm"), gps)).toBe("2 settings · on, 20 %");
    expect(nodeSummary(node("coordinates"), gps)).toBe("Latitude + Longitude · latest");
  });

  it("names upstream conditions in boolean logic", () => {
    expect(nodeSummary(node("either"), gps, names)).toBe("Inside boundary OR Brightness > 80 %");
    const branch: Workflow = {
      ...gps,
      nodes: [...gps.nodes, { id: "node_route", type: "branch.v1", config: {} }, { id: "node_band", type: "hysteresis.v1", config: { activate_above: 90, clear_below: 70 } }],
      edges: [
        ...gps.edges,
        { source: "inside_boundary", source_port: "out", target: "node_route", target_port: "in" },
        { source: "light", source_port: "out", target: "node_band", target_port: "in" },
        { source: "node_band", source_port: "out", target: "either", target_port: "b" },
      ].filter((e) => !(e.source === "node_1a2b3c4d" && e.target === "either")),
    };
    expect(nodeSummary(branch.nodes.find((n) => n.id === "node_route")!, branch)).toBe("If inside boundary");
    expect(nodeSummary(branch.nodes.find((n) => n.id === "node_band")!, branch, names)).toBe("On > 90 % · off < 70 %");
    expect(nodeSummary(node("either"), branch, names)).toBe("Inside boundary OR Brightness > 90 %");
  });

  it("summarises each node type without a workflow", () => {
    expect(nodeSummary(alone("window.v1", { aggregate: "average", duration_seconds: 300, minimum_samples: 3 }))).toBe("Average over 5 min · ≥ 3 samples");
    expect(nodeSummary(alone("sustained.v1", { seconds: 90 }))).toBe("True for 1 min 30 s");
    expect(nodeSummary(alone("cooldown.v1", { seconds: 3600 }))).toBe("At most once per 1 h");
    expect(nodeSummary(alone("hysteresis.v1", { activate_above: 80, clear_below: 70 }))).toBe("On > 80 · off < 70");
    expect(nodeSummary(alone("convert.v1", { from: "C", to: "F" }))).toBe("°C → °F");
    expect(nodeSummary(alone("math.v1", { operator: "multiply" }))).toBe("A × B");
    expect(nodeSummary(alone("branch.v1", {}))).toBe("Route true or false");
    expect(nodeSummary(alone("geofence.v1", { condition: "inside", geometry: {} }))).toBe("Inside · No boundary");
    expect(nodeSummary(alone("action.alert.v1", { title: "" }))).toBe("No alert title");
    expect(nodeSummary(alone("action.command.v1", { settings: {} }))).toBe("Choose device settings");
    expect(nodeSummary(alone("source.parameter.v1", { binding: "" }))).toBe("Choose a device parameter");
    expect(nodeSummary(alone("compare.v1", { operator: "lte", value: "" }))).toBe("Value ≤ ?");
  });

  it("formats durations", () => {
    expect(duration(45)).toBe("45 s");
    expect(duration(5400)).toBe("1 h 30 min");
    expect(duration(0)).toBe("0 s");
    expect(duration("")).toBeUndefined();
  });
});

describe("arrange", () => {
  it("spaces columns and rows by node size", () => {
    const sizes: Record<string, { width: number; height: number }> = {
      inside_boundary: estimatedSize(2, 1),
      coordinates: estimatedSize(2, 2),
    };
    const positions = arrangeNodes(gps, (id) => sizes[id] ?? NODE_SIZE);
    expect(positions.latitude).toEqual({ x: 0, y: 0 });
    expect(positions.longitude.y).toBe(NODE_SIZE.height + 32);
    expect(positions.coordinates.x).toBe(NODE_SIZE.width + 72);
    // Every node in a column shares its x; later columns sit further right.
    expect(positions.inside_boundary.x).toBeGreaterThan(positions.coordinates.x);
    expect(positions.sound_alarm.x).toBeGreaterThan(positions.either.x);
  });

  it("lines cards up with their inputs when columns have different heights", () => {
    const zones = [1, 2, 3, 4];
    const fan: Workflow = {
      schema_version: "automation-workflow.v2",
      bindings: [],
      nodes: [
        { id: "pair", type: "join.v1", config: { mode: "latest" } },
        ...zones.map((z) => ({ id: `zone_${z}`, type: "geofence.v1", config: {} })),
        ...zones.map((z) => ({ id: `event_${z}`, type: "action.event.v1", config: {} })),
      ],
      edges: zones.flatMap((z) => [
        { source: "pair", source_port: "a", target: `zone_${z}`, target_port: "latitude" },
        { source: `zone_${z}`, source_port: "out", target: `event_${z}`, target_port: "in" },
      ]),
    };
    const size = (id: string) => (id.startsWith("event") ? NODE_SIZE : estimatedSize(2, 2));
    const positions = arrangeNodes(fan, size);
    const centre = (id: string) => positions[id].y + size(id).height / 2;
    for (const z of zones) expect(centre(`event_${z}`)).toBeCloseTo(centre(`zone_${z}`));
    // The single input sits level with the middle of the column it feeds.
    expect(centre("pair")).toBeCloseTo((centre("zone_1") + centre("zone_4")) / 2);
    expect(positions.zone_2.y - positions.zone_1.y).toBe(size("zone_1").height + 32);
    expect(Math.min(...Object.values(positions).map((p) => p.y))).toBe(0);
  });

  it("estimates taller cards for labelled port rows only", () => {
    expect(estimatedSize(1, 1)).toEqual(NODE_SIZE);
    expect(estimatedSize(2, 1).height).toBeGreaterThan(NODE_SIZE.height);
  });
});
