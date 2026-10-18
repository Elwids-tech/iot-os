import { useState } from "react"
import type { Meta, StoryObj } from "@storybook/react-vite"
import {
  WorkflowEditor,
  type Diagnostic,
  type Layout,
  type NodeOutcome,
  type NodeType,
  type ResourceNames,
  type Workflow,
} from "@iot-os/workflow-editor"

const meta: Meta<typeof WorkflowEditor> = {
  title: "Components/WorkflowEditor",
  component: WorkflowEditor,
  parameters: { layout: "fullscreen" },
}
export default meta

// Ports mirror services/runtime/internal/dag/registry.go.
const number = { in: "number" }
const boolean = { in: "boolean" }
const ports: Record<string, [string, Record<string, string> | null, Record<string, string> | null]> = {
  "source.parameter.v1": ["Device parameter", null, { out: "binding" }],
  "constant.v1": ["Constant", null, { out: "number" }],
  "geofence.v1": ["Geofence", { latitude: "number", longitude: "number" }, { out: "boolean" }],
  "math.v1": ["Arithmetic", { a: "number", b: "number" }, { out: "number" }],
  "convert.v1": ["Unit conversion", number, { out: "number" }],
  "compare.v1": ["Compare", number, { out: "boolean" }],
  "boolean.v1": ["Boolean logic", { a: "boolean", b: "boolean" }, { out: "boolean" }],
  "window.v1": ["Time window", number, { out: "number" }],
  "join.v1": ["Correlate inputs", { a: "any", b: "any" }, { a: "input:a", b: "input:b" }],
  "branch.v1": ["Branch", boolean, { true: "boolean", false: "boolean" }],
  "hysteresis.v1": ["Hysteresis", number, { out: "boolean" }],
  "sustained.v1": ["Sustained condition", boolean, { out: "boolean" }],
  "cooldown.v1": ["Cooldown", boolean, { out: "boolean" }],
  "action.alert.v1": ["Alert", boolean, null],
  "action.event.v1": ["Integration event", boolean, null],
  "action.command.v1": ["Set device state", boolean, null],
}
const registry: NodeType[] = Object.entries(ports).map(([type, [label, inputs, outputs]]) => ({
  type,
  label,
  inputs,
  outputs,
  config_schema: {},
  stateful: false,
  permissions: null,
  simulation: true,
}))

const bind = (role: string, device: string, unit = "", data_type: "number" | "boolean" | "string" = "number") => ({
  role,
  device_uuid: device,
  configuration_uuid: `${device}-config`,
  generation: 1,
  parameter_uuid: `${device}-${role}`,
  data_type,
  unit,
  fresh_seconds: 30,
})
const ring = [[-114.01, 51.01], [-114.0, 51.01], [-114.0, 51.02], [-114.01, 51.02], [-114.005, 51.025], [-114.01, 51.01]]
const names: ResourceNames = {
  tracker: "GPS Demo Tracker",
  "tracker-latitude": "Latitude",
  "tracker-longitude": "Longitude",
  led: "RGB LED",
  "led-cmd_alarm": "Alarm",
  "led-cmd_volume": "Volume",
  plant: "Boiler room sensor",
  "plant-temperature": "Temperature",
  "plant-pressure": "Pressure",
  "plant-flow": "Flow rate",
}

const gps: Workflow = {
  schema_version: "automation-workflow.v2",
  bindings: [
    bind("latitude", "tracker", "deg"),
    bind("longitude", "tracker", "deg"),
    bind("cmd_alarm", "led", "", "boolean"),
    bind("cmd_volume", "led", "%"),
  ],
  nodes: [
    { id: "latitude", type: "source.parameter.v1", config: { binding: "latitude" } },
    { id: "longitude", type: "source.parameter.v1", config: { binding: "longitude" } },
    { id: "coordinates", type: "join.v1", config: { mode: "latest" } },
    { id: "outside_boundary", type: "geofence.v1", config: { condition: "outside", geometry: { type: "Polygon", coordinates: [ring] }, uncertainty_metres: 2 } },
    { id: "sound_alarm", type: "action.command.v1", config: { settings: { cmd_alarm: true, cmd_volume: 20 }, cooldown_seconds: 60 } },
  ],
  edges: [
    { source: "latitude", source_port: "out", target: "coordinates", target_port: "a" },
    { source: "longitude", source_port: "out", target: "coordinates", target_port: "b" },
    { source: "coordinates", source_port: "a", target: "outside_boundary", target_port: "latitude" },
    { source: "coordinates", source_port: "b", target: "outside_boundary", target_port: "longitude" },
    { source: "outside_boundary", source_port: "out", target: "sound_alarm", target_port: "in" },
  ],
}

/** Every node type once, with generated IDs so titles fall back to the node kind. */
const plant: Workflow = {
  schema_version: "automation-workflow.v2",
  bindings: [bind("temperature", "plant", "°C"), bind("pressure", "plant", "bar"), bind("flow", "plant", "L/min")],
  nodes: [
    { id: "temperature", type: "source.parameter.v1", config: { binding: "temperature" } },
    { id: "pressure", type: "source.parameter.v1", config: { binding: "pressure" } },
    { id: "flow", type: "source.parameter.v1", config: { binding: "flow" } },
    { id: "node_minutes", type: "constant.v1", config: { value: 60 } },
    { id: "node_window", type: "window.v1", config: { aggregate: "average", duration_seconds: 300, minimum_samples: 3 } },
    { id: "node_convert", type: "convert.v1", config: { from: "C", to: "F" } },
    { id: "node_hot", type: "compare.v1", config: { operator: "gt", value: 176 } },
    { id: "node_pressure", type: "hysteresis.v1", config: { activate_above: 6, clear_below: 5 } },
    { id: "node_hourly", type: "math.v1", config: { operator: "multiply" } },
    { id: "node_join", type: "join.v1", config: { mode: "window" } },
    { id: "node_either", type: "boolean.v1", config: { operator: "or" } },
    { id: "node_sustained", type: "sustained.v1", config: { seconds: 90 } },
    { id: "node_branch", type: "branch.v1", config: {} },
    { id: "node_cooldown", type: "cooldown.v1", config: { seconds: 900 } },
    { id: "node_alert", type: "action.alert.v1", config: { title: "Boiler overheating" } },
    { id: "node_event", type: "action.event.v1", config: { name: "boiler.normal", cooldown_seconds: 60 } },
  ],
  edges: [
    { source: "temperature", source_port: "out", target: "node_window", target_port: "in" },
    { source: "node_window", source_port: "out", target: "node_convert", target_port: "in" },
    { source: "node_convert", source_port: "out", target: "node_join", target_port: "a" },
    { source: "pressure", source_port: "out", target: "node_join", target_port: "b" },
    { source: "node_join", source_port: "a", target: "node_hot", target_port: "in" },
    { source: "node_join", source_port: "b", target: "node_pressure", target_port: "in" },
    { source: "flow", source_port: "out", target: "node_hourly", target_port: "a" },
    { source: "node_minutes", source_port: "out", target: "node_hourly", target_port: "b" },
    { source: "node_hot", source_port: "out", target: "node_either", target_port: "a" },
    { source: "node_pressure", source_port: "out", target: "node_either", target_port: "b" },
    { source: "node_either", source_port: "out", target: "node_sustained", target_port: "in" },
    { source: "node_sustained", source_port: "out", target: "node_branch", target_port: "in" },
    { source: "node_branch", source_port: "true", target: "node_cooldown", target_port: "in" },
    { source: "node_cooldown", source_port: "out", target: "node_alert", target_port: "in" },
    { source: "node_branch", source_port: "false", target: "node_event", target_port: "in" },
  ],
}

function Editor({ workflow, diagnostics = [], outcomes }: { workflow: Workflow; diagnostics?: Diagnostic[]; outcomes?: Record<string, NodeOutcome> }) {
  const [graph, setGraph] = useState(workflow)
  const [layout, setLayout] = useState<Layout>({ positions: {} })
  return (
    <div className="p-4">
      <WorkflowEditor
        workflow={graph}
        layout={layout}
        registry={registry}
        diagnostics={diagnostics}
        onChange={setGraph}
        onLayoutChange={setLayout}
        renderBinding={() => null}
        resourceNames={names}
        outcomes={outcomes}
      />
    </div>
  )
}

/** Compact cards: one header row and the configured value. Single ports are unlabelled handles on the edges. */
export const GpsAlarm: StoryObj = { render: () => <Editor workflow={gps} /> }

/** All sixteen node types. Geofence, Arithmetic, Boolean logic, Correlate inputs and Branch keep labelled port rows. */
export const EveryNodeType: StoryObj = { render: () => <Editor workflow={plant} /> }

/** Issues show as a count in the header; simulation outcomes add a chip under the summary. */
export const IssuesAndOutcomes: StoryObj = {
  render: () => (
    <Editor
      workflow={gps}
      diagnostics={[
        { node_id: "sound_alarm", field: "config.settings", code: "required", message: "Select at least one setting." },
        { node_id: "sound_alarm", field: "config.ttl_seconds", code: "range", message: "Use 1 to 300 seconds." },
      ]}
      outcomes={{
        latitude: { status: "evaluated", label: "51.0123" },
        longitude: { status: "evaluated", label: "-114.0021" },
        coordinates: { status: "matched", label: "Matched" },
        outside_boundary: { status: "matched", label: "Outside", reason: "1.2 km from the boundary" },
        sound_alarm: { status: "suppressed", label: "Cooldown", reason: "Sent 20 s ago" },
      }}
    />
  ),
}
