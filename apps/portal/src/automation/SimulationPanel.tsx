import { lazy, Suspense } from "react"
import { nodeLabel, nodeName, type Binding, type NodeType, type Workflow } from "@iot-os/workflow-editor"
import { PlayIcon } from "lucide-react"
import { Button } from "@iot-os/ui/components/button"
import { Badge } from "@iot-os/ui/components/badge"
import { Input } from "@iot-os/ui/components/input"
import { Alert, AlertDescription } from "@iot-os/ui/components/alert"
import { Skeleton } from "@iot-os/ui/components/skeleton"
import { ToggleGroup, ToggleGroupItem } from "@iot-os/ui/components/toggle-group"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@iot-os/ui/components/field"
import { evidenceText } from "./timeline"
import { axisOf, insideRing, locationInputs, nodeOutcomes, requestedActions, sampleError, simulationSources, type SimResult } from "./simulation"

const LocationPicker = lazy(() => import("./LocationPicker"))
const outcomeVariant = (status: string) =>
  ({ matched: "success", triggered: "default", suppressed: "warning", waiting: "warning", evaluated: "info" } as const)[status] ?? "outline"

/** Inputs and results for one saved revision, docked beside the canvas so outcomes stay visible on the graph. */
export function SimulationPanel({ graph, labels, registry, revision, dirty, busy, values, onValuesChange, result, step, onStepChange, selected, onRun }: {
  graph: Workflow; labels?: Record<string, string>; registry: NodeType[]; revision?: number; dirty: boolean; busy: boolean
  values: Record<string, string>; onValuesChange: (values: Record<string, string>) => void
  result?: SimResult; step: number | "summary"; onStepChange: (step: number | "summary") => void
  selected: string; onRun: () => void
}) {
  const sources = simulationSources(graph)
  const pairs = locationInputs(graph)
  const paired = new Set(pairs.flatMap((p) => [p.latitude, p.longitude]))
  const errors = Object.fromEntries(sources.map((b) => [b.role, sampleError(values[b.role], b, axisOf(graph, b.role))]))
  const invalid = Object.values(errors).some(Boolean)
  const set = (role: string, value: string) => onValuesChange({ ...values, [role]: value })
  const label = (id: string) => {
    const node = graph.nodes.find((n) => n.id === id)
    return node ? nodeName(node, labels) ?? nodeLabel(node.type, registry.find((r) => r.type === node.type)?.label) : id
  }
  const sourceLabel = (b: Binding) => {
    const node = graph.nodes.find((n) => n.type === "source.parameter.v1" && n.config.binding === b.role)
    return node ? label(node.id) : b.role
  }
  const field = (b: Binding, text = sourceLabel(b)) => (
    <Field key={b.role} data-invalid={Boolean(errors[b.role])}>
      <FieldLabel id={`sample-${b.role}-label`} htmlFor={b.data_type === "boolean" ? undefined : `sample-${b.role}`} className="first-letter:uppercase">{text}{b.unit ? ` (${b.unit})` : ""}</FieldLabel>
      {b.data_type === "boolean" ? (
        <ToggleGroup aria-labelledby={`sample-${b.role}-label`} type="single" variant="outline" size="sm" value={values[b.role] ?? ""} onValueChange={(value) => value && set(b.role, value)}>
          <ToggleGroupItem value="true">True</ToggleGroupItem>
          <ToggleGroupItem value="false">False</ToggleGroupItem>
        </ToggleGroup>
      ) : (
        <Input id={`sample-${b.role}`} inputMode={b.data_type === "number" ? "decimal" : undefined} aria-invalid={Boolean(errors[b.role])} value={values[b.role] ?? ""} onChange={(e) => set(b.role, e.target.value)} />
      )}
      <FieldError>{errors[b.role]}</FieldError>
    </Field>
  )
  const outcomes = result ? nodeOutcomes(result, step) : {}
  const steps = result ? (step === "summary" ? result.steps : result.steps.slice(step, step + 1)) : []
  const intents = requestedActions(graph, steps.flatMap((s) => s.intents))
  const detail = outcomes[selected]?.trace
  return (
    <div className="flex flex-col gap-5">
      {dirty && <Alert><AlertDescription>Save the graph before simulating. Results always use a saved revision.</AlertDescription></Alert>}
      {!sources.length && <p className="text-sm text-muted-foreground">Bind a device parameter to a source node to supply simulated readings.</p>}
      <FieldGroup>
        {pairs.map((pair) => {
          const lat = sources.find((b) => b.role === pair.latitude), lon = sources.find((b) => b.role === pair.longitude)
          if (!lat || !lon) return null
          const point = errors[lat.role] || errors[lon.role] ? undefined : { latitude: Number(values[lat.role]), longitude: Number(values[lon.role]) }
          return (
            <FieldSet key={pair.geofence.id}>
              <FieldLegend variant="label">Location for {label(pair.geofence.id)}</FieldLegend>
              <div className="grid grid-cols-2 gap-3">{field(lat, "Latitude")}{field(lon, "Longitude")}</div>
              <Suspense fallback={<Skeleton className="h-56" />}>
                <LocationPicker polygon={pair.polygon} point={point} onPick={(p) => onValuesChange({ ...values, [lat.role]: p.latitude.toFixed(6), [lon.role]: p.longitude.toFixed(6) })} />
              </Suspense>
              <FieldDescription>
                Click the map to set both coordinates.{" "}
                {!pair.polygon ? "Draw or import the geofence boundary to show it here." : point ? `The point is ${insideRing(point, pair.polygon[0]) ? "inside" : "outside"} the boundary (map estimate; the simulation decides).` : ""}
              </FieldDescription>
            </FieldSet>
          )
        })}
        {sources.filter((b) => !paired.has(b.role)).map((b) => field(b))}
        <Button disabled={revision === undefined || dirty || busy || invalid || !sources.length} onClick={onRun}>
          <PlayIcon data-icon="inline-start" />
          {busy ? "Simulating…" : "Run simulation"}
        </Button>
        <p className="text-xs text-muted-foreground">
          {revision === undefined ? "Save the workflow to simulate it." : `Uses saved revision ${revision}. Readings arrive together per device and hold steady while the clock advances past configured windows and durations. No live actions are sent.`}
        </p>
      </FieldGroup>
      {result && (
        <section aria-label="Simulation results" className="flex flex-col gap-4 border-t pt-4">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-medium">Results</h3>
            <Badge variant="outline">Revision {result.draft_revision}</Badge>
          </div>
          <Field>
            <FieldLabel id="simulation-step-label">Show</FieldLabel>
            <ToggleGroup aria-labelledby="simulation-step-label" type="single" variant="outline" size="sm" className="flex-wrap" value={String(step)} onValueChange={(value) => value && onStepChange(value === "summary" ? "summary" : Number(value))}>
              <ToggleGroupItem value="summary">Summary</ToggleGroupItem>
              {result.labels.map((text, i) => <ToggleGroupItem key={i} value={String(i)} aria-label={`Step ${i + 1}: ${text}`} title={text}>{i + 1}</ToggleGroupItem>)}
            </ToggleGroup>
            <FieldDescription>{step === "summary" ? "Actions requested in any step, otherwise each node's latest result. Nodes are highlighted on the canvas." : `Step ${step + 1}: ${result.labels[step]}`}</FieldDescription>
          </Field>
          <div className="flex flex-col gap-1.5">
            <h4 className="text-xs font-medium text-muted-foreground">Actions requested</h4>
            {intents.length ? intents.map((a) => (
              <p key={a.key} className="text-sm">
                <span className="font-medium first-letter:uppercase">{label(a.node_id)}</span> · {nodeLabel(a.kind)}{a.transition ? ` · ${a.transition}` : ""}
                {a.settings.length > 0 && <span className="text-muted-foreground"> · {a.settings.join(", ")}</span>}
              </p>
            )) : <p className="text-sm text-muted-foreground">None — no live action would be sent.</p>}
          </div>
          <ul className="flex flex-col gap-2" aria-label="Node results">
            {graph.nodes.filter((n) => outcomes[n.id]).map((n) => (
              <li key={n.id} aria-current={n.id === selected || undefined} className="rounded-md border px-3 py-2 text-sm aria-[current=true]:border-primary">
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate font-medium first-letter:uppercase">{label(n.id)}</span>
                  <Badge variant={outcomeVariant(outcomes[n.id].status)}>{outcomes[n.id].label}</Badge>
                </div>
                <p className="text-xs text-muted-foreground">{outcomes[n.id].reason}</p>
              </li>
            ))}
          </ul>
          {detail ? (
            <div className="flex flex-col gap-1 text-xs">
              <h4 className="font-medium text-muted-foreground">Selected node values</h4>
              {Object.entries(detail.inputs).map(([port, value]) => <p key={`in-${port}`}>In <code>{port}</code>: {evidenceText(value)}</p>)}
              {Object.entries(detail.outputs).map(([port, value]) => <p key={`out-${port}`}>Out <code>{port}</code>: {evidenceText(value)}</p>)}
              {detail.event_note && <p className="text-muted-foreground">{detail.event_note}</p>}
            </div>
          ) : <p className="text-xs text-muted-foreground">Select a node on the canvas to see its input and output values.</p>}
          {result.steps.some((s) => s.trace_truncated) && <p className="text-xs text-muted-foreground">Some step traces were truncated to the latest 1,000 evaluations.</p>}
          <details>
            <summary className="cursor-pointer text-xs text-muted-foreground">Raw trace (JSON)</summary>
            <pre className="max-h-72 overflow-auto text-xs">{JSON.stringify(result.steps, null, 2)}</pre>
          </details>
        </section>
      )}
    </div>
  )
}
