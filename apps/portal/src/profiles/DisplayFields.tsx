import type { JsonValue } from "@iot-os/api-client"
import { FieldDescription, FieldGroup, FieldLegend, FieldSet } from "@iot-os/ui/components/field"
import { Choice, TextField } from "../components/forms"

type StateLabel = { value: string | boolean; label: string; tone?: string }

const TONES = [
  { value: "", label: "No colour" },
  { value: "good", label: "Good" },
  { value: "info", label: "Info" },
  { value: "warning", label: "Warning" },
  { value: "critical", label: "Critical" },
  { value: "muted", label: "Muted" },
]

/**
 * Display metadata that dashboards read to choose and configure panels: the
 * display range, the preferred aggregation, a visualization hint, and labels and
 * tones for enum and boolean values.
 */
export function DisplayFields({
  dataType,
  kind,
  display,
  allowedValues,
  disabled,
  onChange,
}: {
  dataType: string
  kind: string
  display: Record<string, JsonValue>
  /** Enum values from the Validation tab. */
  allowedValues: JsonValue[]
  disabled?: boolean
  onChange: (field: string, value: JsonValue | undefined) => void
}) {
  const numeric = dataType === "number" || dataType === "integer"
  const stateful = dataType === "enum" || dataType === "boolean"
  const values: Array<string | boolean> =
    dataType === "boolean"
      ? [true, false]
      : allowedValues.filter((value): value is string => typeof value === "string")
  const states: StateLabel[] = Array.isArray(display.states)
    ? (display.states as StateLabel[])
    : []
  function setState(value: string | boolean, patch: Partial<StateLabel>) {
    const current = states.find((state) => state.value === value) ?? { value, label: "" }
    const next = { ...current, ...patch }
    const rest = states.filter((state) => state.value !== value)
    const updated = next.label.trim()
      ? [...rest, { value, label: next.label, ...(next.tone ? { tone: next.tone } : {}) }]
      : rest
    const ordered = values
      .map((candidate) => updated.find((state) => state.value === candidate))
      .filter((state): state is StateLabel => Boolean(state))
    onChange("states", ordered.length ? (ordered as unknown as JsonValue) : undefined)
  }
  const visualizations = numeric
    ? [
        { value: "stat", label: "Stat" },
        { value: "gauge", label: "Gauge" },
        { value: "meter", label: "Meter" },
        { value: "timeseries", label: "Time series" },
        ...(kind === "counter" ? [{ value: "consumption", label: "Consumption bars" }] : []),
        { value: "table", label: "Table" },
      ]
    : stateful
      ? [
          { value: "state", label: "State card" },
          { value: "state_timeline", label: "State timeline" },
          { value: "table", label: "Table" },
        ]
      : [{ value: "table", label: "Table" }]
  return (
    <FieldSet>
      <FieldLegend variant="label">Dashboards</FieldLegend>
      <FieldDescription>
        Dashboards use these to suggest and configure panels. They never change
        stored values or alarms.
      </FieldDescription>
      <FieldGroup>
        {numeric && (
          <FieldGroup className="grid gap-4 sm:grid-cols-2">
            <TextField
              title="display_config.min"
              label="Display range from"
              type="number"
              step="any"
              disabled={disabled}
              value={typeof display.min === "number" ? display.min : ""}
              onChange={(event) =>
                onChange("min", event.target.value === "" ? undefined : Number(event.target.value))
              }
            />
            <TextField
              title="display_config.max"
              label="Display range to"
              type="number"
              step="any"
              disabled={disabled}
              help="Gauges and meters use this scale. Validation limits stay separate."
              value={typeof display.max === "number" ? display.max : ""}
              onChange={(event) =>
                onChange("max", event.target.value === "" ? undefined : Number(event.target.value))
              }
            />
          </FieldGroup>
        )}
        {numeric && (
          <div title="display_config.aggregation" className="contents">
            <Choice
              label="Chart aggregation"
              disabled={disabled}
              value={typeof display.aggregation === "string" ? display.aggregation : ""}
              options={[
                { value: "", label: kind === "counter" ? "Automatic (consumption)" : "Automatic (average)" },
                { value: "avg", label: "Average" },
                { value: "min", label: "Minimum" },
                { value: "max", label: "Maximum" },
                { value: "last", label: "Last value" },
                { value: "sum", label: "Sum" },
                ...(kind === "counter" ? [{ value: "increase", label: "Consumption" }] : []),
              ]}
              help="How charts combine readings within each time bucket."
              onChange={(value) => onChange("aggregation", value || undefined)}
            />
          </div>
        )}
        <div title="display_config.visualization" className="contents">
          <Choice
            label="Suggested visualization"
            disabled={disabled}
            value={typeof display.visualization === "string" ? display.visualization : ""}
            options={[{ value: "", label: "Automatic" }, ...visualizations]}
            help="Shown first when someone adds this parameter to a dashboard."
            onChange={(value) => onChange("visualization", value || undefined)}
          />
        </div>
        {stateful && values.length > 0 && (
          <FieldSet title="display_config.states">
            <FieldLegend variant="label">State labels</FieldLegend>
            <FieldDescription>
              Shown on state cards, timelines and tables instead of the raw value.
            </FieldDescription>
            {values.map((value) => {
              const state = states.find((candidate) => candidate.value === value)
              return (
                <FieldGroup key={String(value)} className="grid gap-4 sm:grid-cols-2">
                  <TextField
                    label={`Label for ${String(value)}`}
                    disabled={disabled}
                    placeholder={dataType === "boolean" ? (value ? "On" : "Off") : String(value)}
                    value={state?.label ?? ""}
                    onChange={(event) => setState(value, { label: event.target.value })}
                  />
                  <Choice
                    label={`Tone for ${String(value)}`}
                    disabled={disabled || !state?.label}
                    value={state?.tone ?? ""}
                    options={TONES}
                    onChange={(tone) => setState(value, { tone: tone || undefined })}
                  />
                </FieldGroup>
              )
            })}
          </FieldSet>
        )}
      </FieldGroup>
    </FieldSet>
  )
}
