import * as React from "react"

import { useNow } from "@iot-os/ui/hooks/use-now"
import {
  formatAge,
  formatDateTime,
  freshnessState,
} from "@iot-os/ui/lib/format"
import { cn } from "@iot-os/ui/lib/utils"

/**
 * "6 d ago" with the absolute time on hover. Missing times read as `never`
 * (pass null to render nothing). `bare` drops "ago" for dense readouts. Without `now`
 * it keeps ageing on its own (`useNow`).
 */
function RelativeTime({
  at,
  never = "Never",
  now,
  timezone = "browser",
  bare = false,
  className,
}: {
  at: string | null | undefined
  never?: React.ReactNode
  now?: number
  timezone?: "browser" | "utc"
  bare?: boolean
  className?: string
}) {
  const clock = useNow()
  if (!at) {
    if (never === null) return null
    return <span className={cn("text-muted-foreground", className)}>{never}</span>
  }
  return (
    <time
      dateTime={at}
      title={formatDateTime(at, timezone) + (timezone === "utc" ? " UTC" : "")}
      className={cn("tabular-nums", className)}
    >
      {formatAge(at, now ?? clock)}
      {!bare && " ago"}
    </time>
  )
}

const dots = {
  fresh: "bg-success",
  late: "bg-warning",
  never: "bg-muted-foreground/60",
  unrated: "bg-muted-foreground/60",
}

/**
 * When something last reported, rated against its expected interval: a dot
 * plus the relative time. Late readings also say so in text and colour. Without `now`
 * the rating and the time keep ageing on their own. `late` marks it late whatever its
 * age, for a server that already says so.
 */
function Freshness({
  at,
  expectedSeconds,
  late = false,
  never = "Never",
  now,
  timezone,
  className,
}: {
  at: string | null | undefined
  expectedSeconds?: number | null
  late?: boolean
  never?: string
  now?: number
  timezone?: "browser" | "utc"
  className?: string
}) {
  const clock = useNow()
  const rated = freshnessState(at, expectedSeconds, now ?? clock)
  const state = late && at ? "late" : rated
  return (
    <span
      data-slot="freshness"
      data-state={state}
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap",
        state === "late" && "text-warning",
        className,
      )}
    >
      <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", dots[state])} />
      <RelativeTime at={at} never={never} now={now} timezone={timezone} />
      {state === "late" && <span className="sr-only">, late</span>}
    </span>
  )
}

export { RelativeTime, Freshness }
