import { useMemo } from "react"
import type { Meta, StoryObj } from "@storybook/react-vite"
import {
  EChart,
  gaugeOption,
  timelineOption,
  timeSeriesOption,
  useChartTheme,
  type TimeLine,
} from "@iot-os/charts"
import { Panel, PanelContent, PanelHeader, PanelTitle } from "@iot-os/ui/components/panel"
import { now } from "../fixtures"

const meta: Meta = { title: "Components/Charts" }
export default meta

const minute = 60_000
const start = now - 24 * 60 * minute
const clock = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "UTC" })
const stamp = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })

// Stable sample data: three phase voltages over a day, with one excursion on L2.
function phase(base: number, amplitude: number, offset: number) {
  return Array.from({ length: 289 }, (_, index) => {
    const time = start + index * 5 * minute
    const hour = (time / 3_600_000) % 24
    const excursion = offset === 1 && index > 200 && index < 210 ? 22 : 0
    return { time, value: Math.round((base + Math.sin(((hour - 6) / 24) * Math.PI * 2) * amplitude + Math.sin(index * 1.7 + offset) * 0.6 + excursion) * 10) / 10 }
  })
}
const lines: TimeLine[] = [
  { key: "l1", name: "Voltage L1 · Line 2 main meter", color: "var(--series-1)", points: phase(231, 3.2, 0) },
  { key: "l2", name: "Voltage L2 · Line 2 main meter", color: "var(--series-2)", points: phase(232.5, 3.6, 1) },
  { key: "l3", name: "Voltage L3 · Line 2 main meter", color: "var(--series-3)", points: phase(229.6, 2.9, 2) },
]

function Voltage({ compare = false, group }: { compare?: boolean; group?: string }) {
  const theme = useChartTheme()
  const option = useMemo(
    () =>
      timeSeriesOption(theme, {
        lines: compare
          ? [lines[0], { ...lines[0], key: "previous", name: "Voltage L1, previous period", ghost: true, points: phase(230, 2.4, 3) }]
          : lines,
        from: start,
        to: now,
        formatTick: (time) => clock.format(time),
        formatTime: (time) => stamp.format(time),
        formatValue: (value) => `${value.toFixed(1)} V`,
        thresholds: [{ value: 245, color: "var(--warning)", label: "Warning 245 V" }],
        bands: [{ from: 245, to: null, color: "var(--warning)" }],
        areas: [{ from: start + 201 * 5 * minute, to: start + 209 * 5 * minute, color: "var(--warning)" }],
        markers: [{ at: start + 230 * 5 * minute, color: "var(--commanded)" }],
        selectable: true,
      }),
    [theme, compare],
  )
  return <EChart option={option} group={group} label="Phase voltage over time" className="h-64 w-full" onSelectRange={() => {}} />
}

/**
 * Time series from timeSeriesOption: a threshold band and dashed line, an
 * alert episode shaded across the plot, a command mark, and a tooltip that
 * lists every line. Drag across the plot to select a range.
 */
export const TimeSeries: StoryObj = {
  render: () => (
    <Panel className="max-w-4xl">
      <PanelHeader>
        <PanelTitle>Phase voltage</PanelTitle>
      </PanelHeader>
      <PanelContent>
        <Voltage />
      </PanelContent>
    </Panel>
  ),
}

/** Compare draws the previous period as a faded, dashed line. */
export const Compare: StoryObj = {
  render: () => (
    <Panel className="max-w-4xl">
      <PanelHeader>
        <PanelTitle>Voltage L1, this day and the day before</PanelTitle>
      </PanelHeader>
      <PanelContent>
        <Voltage compare />
      </PanelContent>
    </Panel>
  ),
}

function Gauge({ value, label }: { value: number | null; label: string }) {
  const theme = useChartTheme()
  const tone = value === null ? "var(--series-1)" : value >= 72 ? "var(--destructive)" : value >= 64 ? "var(--warning)" : "var(--series-1)"
  const option = useMemo(
    () =>
      gaugeOption(theme, {
        min: 0,
        max: 80,
        value,
        color: tone,
        bands: [
          { to: 0.8, color: "var(--muted-foreground)", neutral: true },
          { to: 0.9, color: "var(--warning)" },
          { to: 1, color: "var(--destructive)" },
        ],
      }),
    [theme, value, tone],
  )
  return (
    <div className="flex flex-col gap-1">
      <span className="text-body">{label}</span>
      <div className="relative">
        <EChart option={option} label={`${label} gauge`} className="h-32 w-full" />
        <p className="absolute inset-x-0 top-[46%] text-center font-mono text-2xl tabular-nums">
          {value === null ? "—" : value.toFixed(1)}
          <span className="ml-1 text-sm text-muted-foreground">kW</span>
        </p>
      </div>
      <div className="flex justify-between font-mono text-meta text-muted-foreground">
        <span>0</span>
        <span>80</span>
      </div>
    </div>
  )
}

/** Gauges from gaugeOption: bands tint the track and the arc takes the colour of the band the value is in. */
export const Gauges: StoryObj = {
  render: () => (
    <Panel className="max-w-3xl">
      <PanelContent className="grid gap-6 sm:grid-cols-4">
        <Gauge value={42.7} label="Normal" />
        <Gauge value={66.1} label="Warning" />
        <Gauge value={78.4} label="Critical" />
        <Gauge value={null} label="No reading" />
      </PanelContent>
    </Panel>
  ),
}

function Breaker({ group }: { group?: string }) {
  const theme = useChartTheme()
  const at = (index: number) => start + index * 60 * minute
  const option = useMemo(
    () =>
      timelineOption(theme, {
        from: start,
        to: now,
        formatTick: (time) => clock.format(time),
        formatTime: (time) => stamp.format(time),
        formatDuration: (ms) => `${Math.round(ms / minute)} min`,
        segments: [
          { from: at(0), to: at(15), color: "var(--success)", label: "Closed", detail: "Revision 3" },
          { from: at(15), to: at(15.5), color: "var(--destructive)", label: "Tripped", detail: "Revision 3" },
          { from: at(15.5), to: at(19), color: "var(--success)", label: "Closed", detail: "Revision 3" },
          { from: at(19), to: at(20), color: "var(--muted-foreground)", label: "Unknown", unknown: true },
          { from: at(20), to: now, color: "var(--success)", label: "Closed", detail: "Revision 4" },
        ],
      }),
    [theme],
  )
  return <EChart option={option} group={group} label="Main breaker state history timeline" className="h-20 w-full" />
}

/** A state timeline from timelineOption. Unknown stretches are pale with a dashed outline; hover a segment for its span and duration. */
export const StateTimeline: StoryObj = {
  render: () => (
    <Panel className="max-w-4xl">
      <PanelHeader>
        <PanelTitle>Main breaker</PanelTitle>
      </PanelHeader>
      <PanelContent>
        <Breaker />
      </PanelContent>
    </Panel>
  ),
}

/**
 * Charts in one group share a crosshair: hover the voltage chart and the
 * breaker timeline follows. Dashboards put every time chart in one group.
 */
export const Linked: StoryObj = {
  render: () => (
    <Panel className="max-w-4xl">
      <PanelContent className="flex flex-col gap-4">
        <Voltage group="story-linked" />
        <Voltage compare group="story-linked" />
        <Breaker group="story-linked" />
      </PanelContent>
    </Panel>
  ),
}
