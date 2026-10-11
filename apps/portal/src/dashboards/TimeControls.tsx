import { useState, type ReactNode } from "react"
import type { DashboardView } from "@iot-os/api-client"
import { Button } from "@iot-os/ui/components/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@iot-os/ui/components/popover"
import { Field, FieldError, FieldGroup, FieldLabel } from "@iot-os/ui/components/field"
import { Input } from "@iot-os/ui/components/input"
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@iot-os/ui/components/toggle-group"
import { Toggle } from "@iot-os/ui/components/toggle"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@iot-os/ui/components/select"
import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  RefreshCwIcon,
  ZoomOutIcon,
} from "lucide-react"
import {
  absoluteError,
  dateInput,
  inputDate,
  MAX_ABSOLUTE_DAYS,
  PRESETS,
  PRESET_LABELS,
  resolveRange,
  timeLabel,
} from "./model"

/** Dashboard time bar: quick ranges apply on click; only a custom range needs Apply. */
export function TimeControls({
  view,
  defaults,
  compare,
  children,
  onChange,
  onCompare,
  onRefresh,
}: {
  view: DashboardView
  /** Saved dashboard defaults; "Back to latest" returns to their relative range. */
  defaults: DashboardView
  compare: boolean
  /** Right end of the bar, e.g. the "Updated" time. */
  children?: ReactNode
  onChange: (view: DashboardView) => void
  onCompare: (compare: boolean) => void
  onRefresh: () => void
}) {
  const [open, setOpen] = useState(false)
  const window = resolveRange(view.range)
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [error, setError] = useState<string | null>(null)
  const absolute = view.range.mode === "absolute"
  function begin(next: boolean) {
    if (next) {
      setFrom(dateInput(window.from, view.timezone))
      setTo(dateInput(window.to, view.timezone))
      setError(null)
    }
    setOpen(next)
  }
  function move(direction: -1 | 1 | 0) {
    const start = Date.parse(window.from),
      end = Date.parse(window.to),
      duration = end - start
    const nextEnd = Math.min(
      Date.now(),
      direction === 0 ? end : end + direction * duration,
    )
    const nextDuration =
      direction === 0 ? Math.min(duration * 2, PRESETS["30d"] * 3) : duration
    onChange({
      ...view,
      range: {
        mode: "absolute",
        from: new Date(nextEnd - nextDuration).toISOString(),
        to: new Date(nextEnd).toISOString(),
      },
    })
  }
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  return (
    <div
      role="group"
      aria-label="Dashboard time controls"
      className="flex w-full flex-wrap items-center gap-x-2 gap-y-1 py-0.5"
    >
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        spacing={0}
        aria-label="Quick ranges"
        value={view.range.mode === "relative" ? view.range.preset : ""}
        onValueChange={(preset) =>
          preset &&
          onChange({
            ...view,
            range: { mode: "relative", preset: preset as keyof typeof PRESETS },
          })
        }
      >
        {Object.entries(PRESET_LABELS).map(([key, text]) => (
          <ToggleGroupItem key={key} value={key} aria-label={text} title={text}>
            {key}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <Popover open={open} onOpenChange={begin}>
        <PopoverTrigger asChild>
          <Button
            variant={absolute ? "secondary" : "outline"}
            size="sm"
            className="max-w-full min-w-0"
            title={
              absolute
                ? `${timeLabel(window.from, view.timezone)} to ${timeLabel(window.to, view.timezone)}`
                : undefined
            }
          >
            <span className="truncate">
              {absolute
                ? `${timeLabel(window.from, view.timezone)} to ${timeLabel(window.to, view.timezone)}`
                : "Custom"}
            </span>
            <ChevronDownIcon data-icon="inline-end" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-[min(30rem,calc(100vw-2rem))]"
        >
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault()
              const start = inputDate(from, view.timezone),
                end = inputDate(to, view.timezone)
              const issue = absoluteError(start, end)
              if (issue) {
                setError(issue)
                return
              }
              onChange({ ...view, range: { mode: "absolute", from: start, to: end } })
              setOpen(false)
            }}
          >
            <h2 className="text-sm font-medium">Custom range</h2>
            <FieldGroup className="grid gap-4 sm:grid-cols-2">
              <Field data-invalid={Boolean(error)}>
                <FieldLabel htmlFor="range-from">From</FieldLabel>
                <Input
                  id="range-from"
                  type="datetime-local"
                  step="1"
                  value={from}
                  aria-invalid={Boolean(error)}
                  onChange={(e) => {
                    setFrom(e.target.value)
                    setError(null)
                  }}
                />
              </Field>
              <Field data-invalid={Boolean(error)}>
                <FieldLabel htmlFor="range-to">To</FieldLabel>
                <Input
                  id="range-to"
                  type="datetime-local"
                  step="1"
                  value={to}
                  aria-invalid={Boolean(error)}
                  onChange={(e) => {
                    setTo(e.target.value)
                    setError(null)
                  }}
                />
              </Field>
            </FieldGroup>
            <p className="text-xs text-muted-foreground">
              {view.timezone === "utc" ? "UTC" : `Browser time (${zone})`}. Up
              to {MAX_ABSOLUTE_DAYS} days; device retention may be shorter.
            </p>
            {error && <FieldError>{error}</FieldError>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit">Apply time range</Button>
            </div>
          </form>
        </PopoverContent>
      </Popover>
      {absolute && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            onChange({
              ...view,
              range:
                defaults.range.mode === "relative"
                  ? defaults.range
                  : { mode: "relative", preset: "6h" },
            })
          }
        >
          Back to latest
        </Button>
      )}
      <div className="flex">
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Previous interval"
          onClick={() => move(-1)}
        >
          <ChevronLeftIcon />
        </Button>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Next interval"
          disabled={Date.parse(window.to) >= Date.now() - 1000}
          onClick={() => move(1)}
        >
          <ChevronRightIcon />
        </Button>
      </div>
      <Button
        variant="outline"
        size="icon-sm"
        aria-label="Zoom out"
        onClick={() => move(0)}
      >
        <ZoomOutIcon />
      </Button>
      <Toggle
        variant="outline"
        size="sm"
        pressed={compare}
        onPressedChange={onCompare}
        aria-label="Compare previous period"
        title="Compare previous period"
      >
        Compare
      </Toggle>
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        spacing={0}
        aria-label="Timezone"
        value={view.timezone}
        onValueChange={(timezone) =>
          timezone &&
          onChange({ ...view, timezone: timezone as DashboardView["timezone"] })
        }
      >
        <ToggleGroupItem value="browser" title={zone}>
          Browser
        </ToggleGroupItem>
        <ToggleGroupItem value="utc">UTC</ToggleGroupItem>
      </ToggleGroup>
      <div className="flex items-center gap-1.5">
        <Select
          value={String(view.refresh)}
          disabled={absolute}
          onValueChange={(value) =>
            onChange({ ...view, refresh: Number(value) as DashboardView["refresh"] })
          }
        >
          <SelectTrigger
            size="sm"
            aria-label="Auto refresh"
            aria-describedby={absolute ? "refresh-reason" : undefined}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {[0, 5, 10, 30, 60].map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n ? `Auto ${n} s` : "Auto off"}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        {absolute && (
          <span id="refresh-reason" className="text-xs text-muted-foreground">
            Fixed range
          </span>
        )}
      </div>
      <Button
        variant="outline"
        size="icon-sm"
        aria-label="Refresh dashboard"
        onClick={onRefresh}
      >
        <RefreshCwIcon />
      </Button>
      <span className="ml-auto">{children}</span>
    </div>
  )
}
