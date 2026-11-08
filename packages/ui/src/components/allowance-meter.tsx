import * as React from "react"

import { Freshness } from "@iot-os/ui/components/freshness"
import { Status } from "@iot-os/ui/components/status-mark"
import { formatNumber } from "@iot-os/ui/lib/format"
import { cn } from "@iot-os/ui/lib/utils"

const bars = {
  within: "bg-success",
  near: "bg-warning",
  used_up: "bg-destructive",
  over_limit: "bg-destructive",
  unlimited: "bg-muted-foreground/40",
}

export type AllowanceUse = keyof typeof bars

/**
 * Where a count stands against its allowance: under 80% is within it, from 80% it is
 * near, and at or past it it is used up (a level such as devices past its limit is
 * over it). Unlimited never runs out.
 */
export function allowanceUse(count: number, allowance: number | null, kind: "monthly" | "level" = "monthly"): AllowanceUse {
  if (allowance === null) return "unlimited"
  if (kind === "level" && count > allowance) return "over_limit"
  if (count >= allowance) return "used_up"
  return count * 100 >= allowance * 80 ? "near" : "within"
}

/**
 * The meter's last line: what is left, with the month's overage beside it when an
 * allowance was raised past the count (spec 028 FR-018); the overage once it is used up;
 * how far a level is over its limit. Null when unlimited. An earlier month gives only its
 * overage, as its allowance may have changed since.
 */
export function allowanceLine(
  count: number,
  allowance: number | null,
  {
    overage = 0,
    kind = "monthly",
    noun = ["", ""],
    earlier = false,
  }: { overage?: number; kind?: "monthly" | "level"; noun?: [string, string]; earlier?: boolean } = {},
): string | null {
  const counted = (value: number) => `${formatNumber(value)}${noun[0] ? ` ${value === 1 ? noun[0] : noun[1]}` : ""}`
  if (earlier) return overage > 0 ? `${counted(overage)} of overage` : null
  if (allowance === null) return null
  if (kind === "level" && count > allowance) return `${counted(count - allowance)} over the limit`
  const left = Math.max(0, allowance - count)
  if (overage > 0) return left > 0 ? `${counted(left)} left · ${counted(overage)} of overage` : `${counted(overage)} of overage`
  return `${counted(left)} left`
}

/**
 * One allowance: the count, of how much or "Unlimited", what is left or the overage, a
 * bar and a status (an unlimited allowance only counts). An `earlier` month shows its
 * count and overage only: the API keeps no history of the allowance (spec 029 FR-023). `kind="level"` is for something held at once, such as active
 * devices, which has no overage but can be over its limit. Counts the runtime reports
 * (data points) pass `freshness`: a final month says so, an open one reads
 * "Provisional" with when it was last reported, late after five minutes (the API's
 * default for `stale`).
 */
export function AllowanceMeter({
  label,
  count,
  allowance,
  overage = 0,
  kind = "monthly",
  noun = ["", ""],
  freshness,
  detail,
  earlier = false,
  now,
  className,
}: {
  label: string
  count: number
  /** Null is unlimited. */
  allowance: number | null
  overage?: number
  kind?: "monthly" | "level"
  /** Singular and plural for the "left" line, e.g. ["alert", "alerts"]. */
  noun?: [string, string]
  freshness?: { reportedAt: string | null; final: boolean }
  /** A note on the right of the last line when there is no freshness, e.g. a peak. */
  detail?: React.ReactNode
  /** A month before this one: no allowance, bar or status, as the allowance may have changed since. */
  earlier?: boolean
  now?: number
  className?: string
}) {
  const id = React.useId()
  const use = allowanceUse(count, allowance, kind)
  const share = allowance === null || allowance === 0 ? (count > 0 && allowance === 0 ? 100 : 0) : Math.min(100, (count / allowance) * 100)
  const left = allowanceLine(count, allowance, { overage, kind, noun, earlier })

  return (
    <div data-slot="allowance-meter" data-use={earlier ? undefined : use} className={cn("flex min-w-0 flex-col gap-2", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <span id={id} className="text-meta text-muted-foreground">
          {label}
        </span>
        {use === "unlimited" || earlier ? null : <Status value={use} domain="usage" className="text-meta" />}
      </div>
      <div className="flex items-baseline gap-1.5 tabular-nums">
        <span className="text-heading">{formatNumber(count)}</span>
        {earlier ? null : (
          <span className="text-meta text-muted-foreground">
            {allowance === null ? "· Unlimited" : `of ${formatNumber(allowance)}`}
          </span>
        )}
      </div>
      {earlier ? null : (
        <div
          role="meter"
          aria-labelledby={id}
          aria-valuemin={0}
          aria-valuemax={allowance ?? undefined}
          aria-valuenow={count}
          aria-valuetext={allowance === null ? `${formatNumber(count)}, unlimited` : `${formatNumber(count)} of ${formatNumber(allowance)}`}
          className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
        >
          <div className={cn("h-full rounded-full", bars[use])} style={{ width: `${share}%` }} />
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-meta text-muted-foreground">
        {left ? (
          <span className={cn(!earlier && (use === "used_up" || use === "over_limit") ? "text-foreground" : undefined)}>{left}</span>
        ) : null}
        {freshness ? (
          freshness.final ? (
            <span>Final</span>
          ) : freshness.reportedAt ? (
            <span className="inline-flex items-center gap-1">
              Provisional · last reported <Freshness at={freshness.reportedAt} expectedSeconds={150} now={now} />
            </span>
          ) : (
            <span>Provisional · not reported yet</span>
          )
        ) : (
          detail
        )}
      </div>
    </div>
  )
}
