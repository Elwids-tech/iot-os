import type { DeviceProfileParameter } from "@iot-os/api-client"
import { validationRange } from "../controls/model"
import { booleanValue } from "../history/model"

/** Profile display hints, read at render time so profile edits flow into panels. */
export type StateTone = "good" | "info" | "warning" | "critical" | "muted"
export type StateLabel = { value: string | boolean; label: string; tone?: StateTone }

const TONES: StateTone[] = ["good", "info", "warning", "critical", "muted"]

/** Semantic colour for a profile state tone; follows the skin and theme. */
export const TONE_COLOR: Record<StateTone, string> = {
  good: "var(--success)",
  info: "var(--info)",
  warning: "var(--warning)",
  critical: "var(--destructive)",
  muted: "var(--muted-foreground)",
}

function display(parameter?: Pick<DeviceProfileParameter, "display">) {
  return (parameter?.display ?? {}) as Record<string, unknown>
}

/** Labels and tones the profile defines for enum and boolean values. */
export function displayStates(parameter?: Pick<DeviceProfileParameter, "display">): StateLabel[] {
  const states = display(parameter).states
  if (!Array.isArray(states)) return []
  return states.flatMap((state) => {
    if (!state || typeof state !== "object") return []
    const { value, label, tone } = state as Record<string, unknown>
    if ((typeof value !== "string" && typeof value !== "boolean") || typeof label !== "string" || !label.trim())
      return []
    return [{ value, label, tone: TONES.includes(tone as StateTone) ? (tone as StateTone) : undefined }]
  })
}

/** The profile label for a reported value; booleans also match 1/0 and "true"/"false". */
export function stateFor(states: StateLabel[], value: unknown): StateLabel | undefined {
  if (!states.length) return undefined
  const asBoolean = booleanValue(value)
  return states.find((state) =>
    typeof state.value === "boolean" ? asBoolean === state.value : state.value === value,
  )
}

/**
 * The scale for gauges and meters: the profile's display range, else its
 * validation limits, else 0–100 for percentages. Null when unknown.
 */
export function displayRange(
  parameter?: Pick<DeviceProfileParameter, "display" | "validation" | "unit" | "data_type">,
): { min: number; max: number } | null {
  if (!parameter) return null
  const hints = display(parameter)
  const range = validationRange(parameter as DeviceProfileParameter)
  const min = typeof hints.min === "number" ? hints.min : range.min ?? (parameter.unit === "%" ? 0 : undefined)
  const max = typeof hints.max === "number" ? hints.max : range.max ?? (parameter.unit === "%" ? 100 : undefined)
  return min !== undefined && max !== undefined && max > min ? { min, max } : null
}

/** A visualization the profile suggests, if any. */
export function visualizationHint(parameter?: Pick<DeviceProfileParameter, "display">): string | null {
  const hint = display(parameter).visualization
  return typeof hint === "string" && hint ? hint : null
}
