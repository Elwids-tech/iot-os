import { useState } from "react"
import type { DashboardRange, DashboardView } from "@iot-os/api-client"
import { Button } from "@iot-os/ui/components/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@iot-os/ui/components/popover"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@iot-os/ui/components/field"
import { Input } from "@iot-os/ui/components/input"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@iot-os/ui/components/tabs"
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@iot-os/ui/components/toggle-group"
import {
  CalendarClockIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  RefreshCwIcon,
  ZoomOutIcon,
} from "lucide-react"
import { Choice } from "../components/forms"
import {
  absoluteError,
  dateInput,
  inputDate,
  PRESETS,
  PRESET_LABELS,
  resolveRange,
  timeLabel,
} from "./model"

export function TimeControls({
  view,
  onChange,
  onRefresh,
  compact = false,
}: {
  view: DashboardView
  onChange: (view: DashboardView) => void
  onRefresh: () => void
  compact?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(view)
  const window = resolveRange(view.range)
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [error, setError] = useState<string | null>(null)
  function begin(next: boolean) {
    if (next) {
      setDraft(view)
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
  const label =
    view.range.mode === "relative"
      ? PRESET_LABELS[view.range.preset]
      : `${timeLabel(view.range.from, view.timezone)} – ${timeLabel(view.range.to, view.timezone)}`
  return (
    <div
      className={compact
        ? "flex min-w-0 flex-nowrap items-center gap-2"
        : "flex flex-wrap items-end gap-2"}
      aria-label="Dashboard time controls"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-1">
        <Button
          variant="outline"
          size="icon"
          aria-label="Previous interval"
          onClick={() => move(-1)}
        >
          <ChevronLeftIcon />
        </Button>
        <Popover open={open} onOpenChange={begin}>
          <PopoverTrigger asChild>
            <Button variant="outline" className={compact ? "max-w-44" : "max-w-full"} title={label}>
              <CalendarClockIcon data-icon="inline-start" />
              <span className="truncate">{label}</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            className="w-[min(40rem,calc(100vw-2rem))] max-h-[85svh] overflow-y-auto"
          >
            <form
              className="flex flex-col gap-4"
              onSubmit={(event) => {
                event.preventDefault()
                let range: DashboardRange = draft.range
                if (range.mode === "absolute") {
                  const start = inputDate(from, draft.timezone),
                    end = inputDate(to, draft.timezone)
                  const issue = absoluteError(start, end)
                  if (issue) {
                    setError(issue)
                    return
                  }
                  range = { mode: "absolute", from: start, to: end }
                }
                onChange({ ...draft, range })
                setOpen(false)
              }}
            >
              <div>
                <h2 className="font-semibold">Time range</h2>
                <p className="text-sm text-muted-foreground">
                  Explore chart history. Status panels always show latest
                  values.
                </p>
              </div>
              <Tabs
                value={draft.range.mode}
                onValueChange={(mode) => {
                  setError(null)
                  setDraft({
                    ...draft,
                    range:
                      mode === "relative"
                        ? { mode: "relative", preset: "6h" }
                        : { mode: "absolute", ...window },
                  })
                }}
              >
                <TabsList>
                  <TabsTrigger value="relative">Quick ranges</TabsTrigger>
                  <TabsTrigger value="absolute">Absolute range</TabsTrigger>
                </TabsList>
                <TabsContent value="relative">
                  <ToggleGroup
                    type="single"
                    variant="outline"
                    value={
                      draft.range.mode === "relative" ? draft.range.preset : ""
                    }
                    onValueChange={(preset) =>
                      preset &&
                      setDraft({
                        ...draft,
                        range: {
                          mode: "relative",
                          preset: preset as keyof typeof PRESETS,
                        },
                      })
                    }
                    className="flex w-full flex-wrap justify-start"
                  >
                    {Object.entries(PRESET_LABELS).map(([key, text]) => (
                      <ToggleGroupItem key={key} value={key}>
                        {text}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </TabsContent>
                <TabsContent value="absolute">
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
                </TabsContent>
              </Tabs>
              <FieldGroup>
                <Choice
                  label="Timezone"
                  value={draft.timezone}
                  onChange={(value) => {
                    const zone = value as DashboardView["timezone"]
                    const start = inputDate(from, draft.timezone),
                      end = inputDate(to, draft.timezone)
                    if (start) setFrom(dateInput(start, zone))
                    if (end) setTo(dateInput(end, zone))
                    setDraft({ ...draft, timezone: zone })
                  }}
                  options={[
                    {
                      value: "browser",
                      label: `Browser time (${Intl.DateTimeFormat().resolvedOptions().timeZone})`,
                    },
                    { value: "utc", label: "UTC" },
                  ]}
                />
                <FieldDescription>
                  Available history depends on device retention. Maximum
                  requested interval: 90 days. Absolute history stays fixed; use
                  Refresh to query it again.
                </FieldDescription>
              </FieldGroup>
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setOpen(false)}
                >
                  Cancel
                </Button>
                <Button type="submit">Apply time range</Button>
              </div>
            </form>
          </PopoverContent>
        </Popover>
        <Button
          variant="outline"
          size="icon"
          aria-label="Next interval"
          disabled={Date.parse(window.to) >= Date.now() - 1000}
          onClick={() => move(1)}
        >
          <ChevronRightIcon />
        </Button>
        <Button
          variant="outline"
          size="icon"
          aria-label="Zoom out"
          onClick={() => move(0)}
        >
          <ZoomOutIcon />
        </Button>
        {view.range.mode === "absolute" && (
          <Button
            variant="ghost"
            onClick={() =>
              onChange({ ...view, range: { mode: "relative", preset: "6h" } })
            }
          >
            Back to latest 6h
          </Button>
        )}
      </div>
      <div className={compact ? "min-w-28 [&_[data-slot=field-label]]:sr-only" : "min-w-28"}>
        <Choice
          label="Auto refresh"
          value={String(view.refresh)}
          onChange={(value) =>
            onChange({
              ...view,
              refresh: Number(value) as DashboardView["refresh"],
            })
          }
          options={[0, 5, 10, 30, 60].map((n) => ({
            value: String(n),
            label: n ? `${n} seconds` : "Off",
          }))}
        />
      </div>
      <Button
        variant="outline"
        size="icon"
        aria-label="Refresh dashboard"
        onClick={onRefresh}
      >
        <RefreshCwIcon />
      </Button>
    </div>
  )
}
