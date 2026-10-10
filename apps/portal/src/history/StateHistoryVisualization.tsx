import type {
  DeviceConfiguration,
  StateHistory,
  StateHistorySegment,
} from "@iot-os/api-client"
import { Badge } from "@iot-os/ui/components/badge"
import { cn } from "@iot-os/ui/lib/utils"
import {
  configurationMeta,
  formatDuration,
  stateColor,
  stateLabel,
  validHexColor,
} from "./model"
import { stateFor, TONE_COLOR, type StateLabel } from "../dashboards/profileDisplay"

function segmentColor(segment: Pick<StateHistorySegment, "value" | "known" | "data_type">, colour: boolean, states: StateLabel[] = []) {
  if (colour)
    return segment.known && validHexColor(segment.value)
      ? segment.value
      : "#94a3b8"
  const state = segment.known ? stateFor(states, segment.value) : undefined
  if (state?.tone) return TONE_COLOR[state.tone]
  return stateColor(segment.value, segment.known, segment.data_type)
}

function segmentLabel(segment: Pick<StateHistorySegment, "value" | "known" | "data_type">, colour: boolean, states: StateLabel[] = []) {
  const state = !colour && segment.known ? stateFor(states, segment.value) : undefined
  if (state) return state.label
  if (!colour) return stateLabel(segment.value, segment.known, segment.data_type)
  if (!segment.known) return "Unknown"
  return validHexColor(segment.value)
    ? String(segment.value)
    : `Invalid colour: ${String(segment.value)}`
}

function timeLabel(value: string, timezone: "browser" | "utc") {
  return new Date(value).toLocaleString(undefined, {
    ...(timezone === "utc" ? { timeZone: "UTC" } : {}),
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export function StateHistoryVisualization({
  history,
  configurations,
  colour = false,
  timezone = "browser",
  states = [],
}: {
  history: StateHistory
  configurations: DeviceConfiguration[]
  colour?: boolean
  timezone?: "browser" | "utc"
  /** Profile labels and tones for the parameter's values. */
  states?: StateLabel[]
}) {
  const total = Math.max(1, Date.parse(history.to) - Date.parse(history.from))
  const observedColours = colour
    ? [
        ...new Set(
          history.timeline
            .filter((segment) => segment.known && validHexColor(segment.value))
            .map((segment) => String(segment.value).toUpperCase()),
        ),
      ]
    : []
  const hasInvalidColours =
    colour &&
    history.timeline.some(
      (segment) => segment.known && !validHexColor(segment.value),
    )
  if (!history.timeline.length)
    return (
      <p className="text-sm text-muted-foreground">
        No reported state in this range.
      </p>
    )
  return (
    <div className="flex flex-col gap-4">
      {!colour && (
        <div className="flex flex-col gap-3">
          <div
            className="flex h-4 overflow-hidden rounded-full border bg-muted"
            aria-hidden="true"
          >
            {history.durations.map((duration, index) => (
              <span
                key={`${duration.known}:${String(duration.value)}:${index}`}
                className={cn(!duration.known && "history-unknown")}
                style={{
                  width: `${duration.percentage}%`,
                  backgroundColor: segmentColor(duration, false, states),
                }}
              />
            ))}
          </div>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {history.durations.map((duration, index) => (
              <div
                key={`${duration.known}:${String(duration.value)}:${index}`}
                className="flex items-center gap-2 text-sm"
              >
                <span
                  aria-hidden
                  className={cn(
                    "size-3 rounded-sm border",
                    !duration.known && "history-unknown",
                  )}
                  style={{
                    backgroundColor: segmentColor(duration, false, states),
                  }}
                />
                <span className="min-w-0 flex-1 truncate">
                  {segmentLabel(duration, false, states)}
                </span>
                <span className="font-mono text-xs tabular-nums text-muted-foreground">
                  {formatDuration(duration.duration_ms)} ·{" "}
                  {duration.percentage.toFixed(1)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="flex flex-col gap-2">
        {/* One label summarizes the strip; segments keep hover titles only. */}
        <div
          className="flex h-12 min-w-0 overflow-hidden rounded-md border bg-muted"
          role="img"
          aria-label={`${colour ? "Colour" : "State"} history timeline, ${timeLabel(history.from, timezone)} to ${timeLabel(history.to, timezone)}: ${[
            ...history.timeline
              .reduce((totals, segment) => {
                const label = segmentLabel(segment, colour, states)
                return totals.set(
                  label,
                  (totals.get(label) ?? 0) +
                    Date.parse(segment.to) -
                    Date.parse(segment.from),
                )
              }, new Map<string, number>())
              .entries(),
          ]
            .map(([label, ms]) => `${label} ${formatDuration(ms)}`)
            .join(", ")}`}
        >
          {history.timeline.map((segment, index) => {
            const configuration = segment.configuration_uuid
              ? configurationMeta(configurations, segment.configuration_uuid)
              : null
            const description = `${segmentLabel(segment, colour, states)} · ${timeLabel(segment.from, timezone)} to ${timeLabel(segment.to, timezone)}${configuration ? ` · ${configuration.configurationLabel} · ${configuration.profileLabel}` : ""}`
            return (
              <span
                key={`${segment.from}:${index}`}
                className={cn(
                  "min-w-px border-r border-black/10 last:border-r-0",
                  (!segment.known ||
                    (colour && !validHexColor(segment.value))) &&
                    "history-unknown",
                )}
                style={{
                  width: `${((Date.parse(segment.to) - Date.parse(segment.from)) / total) * 100}%`,
                  backgroundColor: segmentColor(segment, colour, states),
                }}
                title={description}
              />
            )
          })}
        </div>
        {/* The image label summarizes; this list gives screen readers every
            segment in order. One text node per item keeps text matches exact. */}
        <ol
          className="sr-only"
          aria-label={`${colour ? "Colour" : "State"} history segments in order`}
        >
          {history.timeline.map((segment, index) => (
            <li key={`${segment.from}:${index}`}>
              {`${segmentLabel(segment, colour, states)}, ${timeLabel(segment.from, timezone)} to ${timeLabel(segment.to, timezone)}, ${formatDuration(Date.parse(segment.to) - Date.parse(segment.from))}`}
            </li>
          ))}
        </ol>
        <div className="flex justify-between gap-3 text-xs text-muted-foreground">
          <span>{timeLabel(history.from, timezone)}</span>
          <span>{timeLabel(history.to, timezone)}</span>
        </div>
        <p className="text-xs text-muted-foreground">
          Based on platform-received reports. Each state continues until the
          next report or the end of the selected range.
          {history.sampled
            ? " The visual timeline is sampled; duration totals remain exact."
            : ""}
        </p>
      </div>
      {colour && (observedColours.length > 0 || hasInvalidColours) && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Colours observed">
          {observedColours.slice(0, 20).map((value) => (
            <Badge key={value} variant="outline" className="gap-1.5 font-mono">
              <span
                aria-hidden
                className="size-3 rounded-sm border"
                style={{ backgroundColor: value }}
              />
              {value}
            </Badge>
          ))}
          {observedColours.length > 20 && (
            <Badge variant="secondary">+{observedColours.length - 20}</Badge>
          )}
          {hasInvalidColours && (
            <Badge variant="outline" className="gap-1.5">
              <span
                aria-hidden
                className="history-unknown size-3 rounded-sm border bg-slate-400"
              />
              Invalid value
            </Badge>
          )}
        </div>
      )}
    </div>
  )
}
