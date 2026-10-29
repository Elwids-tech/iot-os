import type { Binding, NodeOutcome, Workflow, WorkflowNode } from "@iot-os/workflow-editor"
import { parseGeofenceGeometry } from "../geospatial/geofence-json"
import { stepLabels, type EvidenceValue } from "./timeline"

export type SimTrace = {
  node_id: string; status: string; reason: string; event_note?: string
  inputs: Record<string, EvidenceValue>; outputs: Record<string, EvidenceValue>; intent_ids?: string[]
}
export type SimIntent = { id: string; node_id: string; kind: string; trigger: string; transition?: string }
/** `POST …/{workflow}/simulate`: one runtime Result per supplied step, plus the pinned revision. */
export type SimResult = {
  draft_revision: number
  steps: { trace: SimTrace[]; intents: SimIntent[]; trace_truncated?: boolean }[]
  /** Client-side step names, in request order. */
  labels: string[]
}
export type SimOutcome = NodeOutcome & { trace: SimTrace }
type Point = { latitude: number; longitude: number }

/** Follow an input port back through correlation joins to the device parameter feeding it. */
export function sourceFor(graph: Workflow, nodeId: string, port: string, seen = new Set<string>()): WorkflowNode | undefined {
  const edge = graph.edges.find((e) => e.target === nodeId && e.target_port === port)
  if (!edge || seen.has(edge.source)) return undefined
  seen.add(edge.source)
  const node = graph.nodes.find((n) => n.id === edge.source)
  if (node?.type === "source.parameter.v1") return node
  // join.v1 forwards input a/b unchanged on output a/b.
  if (node?.type === "join.v1") return sourceFor(graph, node.id, edge.source_port, seen)
  return undefined
}

export type LocationInput = { geofence: WorkflowNode; latitude: string; longitude: string; polygon: number[][][] | null }
/** Latitude/longitude binding pairs that feed a geofence, with its boundary when valid. */
export function locationInputs(graph: Workflow): LocationInput[] {
  const pairs: LocationInput[] = []
  for (const geofence of graph.nodes.filter((n) => n.type === "geofence.v1")) {
    const latitude = sourceFor(graph, geofence.id, "latitude")?.config.binding
    const longitude = sourceFor(graph, geofence.id, "longitude")?.config.binding
    if (typeof latitude !== "string" || typeof longitude !== "string" || !latitude || !longitude || latitude === longitude) continue
    if (pairs.some((p) => [p.latitude, p.longitude].some((role) => role === latitude || role === longitude))) continue
    let polygon: number[][][] | null = null
    try { polygon = parseGeofenceGeometry(geofence.config.geometry).coordinates } catch { /* boundary drawn once valid */ }
    pairs.push({ geofence, latitude, longitude, polygon })
  }
  return pairs
}

/** Area-weighted centroid of a [longitude, latitude] ring; vertex mean for degenerate rings. */
export function centroid(ring: number[][]): Point | undefined {
  const points = ring.length > 1 && ring[0][0] === ring.at(-1)![0] && ring[0][1] === ring.at(-1)![1] ? ring.slice(0, -1) : ring
  if (!points.length) return undefined
  let area = 0, x = 0, y = 0
  points.forEach(([x0, y0], i) => {
    const [x1, y1] = points[(i + 1) % points.length]
    const cross = x0 * y1 - x1 * y0
    area += cross; x += (x0 + x1) * cross; y += (y0 + y1) * cross
  })
  if (Math.abs(area) < 1e-12) return { longitude: points.reduce((s, p) => s + p[0], 0) / points.length, latitude: points.reduce((s, p) => s + p[1], 0) / points.length }
  return { longitude: x / (3 * area), latitude: y / (3 * area) }
}

/** Ray casting on a [longitude, latitude] ring; an estimate only — the runtime decides. */
export function insideRing(point: Point, ring: number[][]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j]
    if (yi > point.latitude !== yj > point.latitude && point.longitude < ((xj - xi) * (point.latitude - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Bindings read by source nodes, i.e. the values a simulation must supply. */
export function simulationSources(graph: Workflow): Binding[] {
  return graph.bindings.filter((b) => graph.nodes.some((n) => n.type === "source.parameter.v1" && n.config.binding === b.role))
}

/** Pre-filled inputs: the geofence centroid for location pairs, false for booleans, otherwise empty. */
export function defaultSamples(graph: Workflow): Record<string, string> {
  const values: Record<string, string> = {}
  for (const b of simulationSources(graph)) if (b.data_type === "boolean") values[b.role] = "false"
  for (const pair of locationInputs(graph)) {
    const center = pair.polygon && centroid(pair.polygon[0])
    values[pair.latitude] = center ? center.latitude.toFixed(6) : ""
    values[pair.longitude] = center ? center.longitude.toFixed(6) : ""
  }
  return values
}

export function axisOf(graph: Workflow, role: string): "latitude" | "longitude" | undefined {
  const pair = locationInputs(graph).find((p) => p.latitude === role || p.longitude === role)
  return pair ? (pair.latitude === role ? "latitude" : "longitude") : undefined
}

export function sampleError(raw: string | undefined, binding: Binding, axis?: "latitude" | "longitude"): string | undefined {
  const text = (raw ?? "").trim()
  if (binding.data_type === "boolean") return text === "true" || text === "false" ? undefined : "Choose true or false."
  if (binding.data_type !== "number") return undefined
  if (!text) return axis ? `Enter a ${axis} or pick a point on the map.` : "Enter a value."
  const value = Number(text)
  if (!Number.isFinite(value)) return "Enter a number."
  if (axis === "latitude" && Math.abs(value) > 90) return "Latitude must be between -90 and 90."
  if (axis === "longitude" && Math.abs(value) > 180) return "Longitude must be between -180 and 180."
  return undefined
}

const readingValue = (raw: string, b: Binding) => b.data_type === "boolean" ? raw.trim() === "true" : b.data_type === "number" ? Number(raw) : raw

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a)

/**
 * Windows start on multiples of their slide, so begin where every window's first one does (a whole
 * minute at least). Otherwise the reading can land before the first window and the result depends
 * on the wall clock.
 */
export function alignedStart(graph: Workflow, now: number): number {
  let period = 60
  for (const n of graph.nodes) {
    const slide = Number(n.config.slide_seconds)
    if (n.type !== "window.v1" || !Number.isInteger(slide) || slide <= 0) continue
    const next = (period / gcd(period, slide)) * slide
    if (next <= 7 * 86400) period = next
  }
  return Math.floor(now / (period * 1000)) * period * 1000
}

/**
 * Start, then one committed telemetry event per device (its readings arrive together, as a
 * GPS fix does), then advance the clock until the first window closes and durations elapse.
 * The values hold steady: each device reports them again just before the clock advances, so a
 * sustained condition longer than the readings' freshness still sees a live signal.
 */
export function simulationSteps(graph: Workflow, values: Record<string, string>, org: string, now: number, id: () => string) {
  const start = alignedStart(graph, now)
  const iso = (seconds: number) => new Date(start + seconds * 1000).toISOString()
  const steps: { at: string; event: unknown }[] = [{ at: iso(0), event: null }]
  const labels = ["Start"]
  const devices = new Map<string, Binding[]>()
  for (const b of simulationSources(graph)) {
    const key = `${b.device_uuid}:${b.configuration_uuid}:${b.generation}`
    devices.set(key, [...(devices.get(key) ?? []), b])
  }
  const report = (second: number, again: boolean) => {
    for (const bindings of devices.values()) {
      const b = bindings[0]
      steps.push({
        at: iso(second),
        event: {
          schema_version: "telemetry.committed.v1", event_id: id(), telemetry_id: id(), sequence: String(steps.length),
          organization_uuid: org, device_uuid: b.device_uuid, configuration_uuid: b.configuration_uuid, generation: b.generation,
          readings: bindings.map((r) => ({
            parameter_uuid: r.parameter_uuid, key: r.role, data_type: r.data_type, unit: r.unit || null,
            value: readingValue(values[r.role] ?? "", r), quality: "good", observed_at: iso(second), received_at: iso(second), historical: false,
          })),
        },
      })
      labels.push(`${again ? `Same readings at +${second}s` : "Readings"} · ${bindings.map((r) => r.role.replaceAll("_", " ")).join(", ")}`)
    }
  }
  report(1, false)
  // Closing only the first window: a later one would hold no readings and hide the first one's result.
  const end = Math.max(2, ...graph.nodes.map((n) =>
    n.type === "window.v1" ? Number(n.config.duration_seconds) + Number(n.config.lateness_seconds)
      : n.type === "sustained.v1" ? Number(n.config.seconds) + 2 : 0))
  if (end > 3) report(end - 1, true)
  steps.push({ at: iso(end), event: null })
  labels.push(`Clock +${end}s`)
  return { steps, labels }
}

/**
 * One line per action node and transition. A device-state node requests one command per setting,
 * named after the binding at the end of its trigger; list those settings instead of repeating the node.
 */
export function requestedActions(graph: Workflow, intents: SimIntent[]) {
  const actions = new Map<string, SimIntent & { key: string; settings: string[] }>()
  for (const intent of intents) {
    const key = `${intent.node_id}:${intent.kind}:${intent.transition ?? ""}`
    const node = graph.nodes.find((n) => n.id === intent.node_id)
    const setting = node?.config.settings ? intent.trigger.split(":").at(-1)?.replaceAll("_", " ") : undefined
    const action = actions.get(key) ?? { ...intent, key, settings: [] }
    if (setting && !action.settings.includes(setting)) action.settings.push(setting)
    actions.set(key, action)
  }
  return [...actions.values()]
}

/**
 * Outcome per node for one step, or a summary across steps: an action that fired in any
 * step stays "Action requested"; otherwise the latest evaluation wins.
 */
export function nodeOutcomes(result: SimResult, step: number | "summary"): Record<string, SimOutcome> {
  const traces: Record<string, SimTrace> = {}
  for (const s of step === "summary" ? result.steps : result.steps.slice(step, step + 1))
    for (const t of s.trace) if (traces[t.node_id]?.status !== "triggered" || t.status === "triggered") traces[t.node_id] = t
  return Object.fromEntries(Object.entries(traces).map(([id, trace]) => [id, { status: trace.status, label: stepLabels[trace.status] ?? trace.status, reason: trace.reason, trace }]))
}
