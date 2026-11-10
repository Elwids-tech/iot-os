import * as React from "react"

import { Building2Icon } from "lucide-react"

import { AllowanceMeter } from "@iot-os/ui/components/allowance-meter"
import { Button } from "@iot-os/ui/components/button"
import { DataTable, type DataColumn } from "@iot-os/ui/components/data-table"
import { EmptyState } from "@iot-os/ui/components/empty-state"
import { Panel, PanelActions, PanelContent, PanelDescription, PanelHeader, PanelTitle } from "@iot-os/ui/components/panel"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@iot-os/ui/components/select"
import { Skeleton } from "@iot-os/ui/components/skeleton"
import { useNow } from "@iot-os/ui/hooks/use-now"
import { formatNumber } from "@iot-os/ui/lib/format"
import { cn } from "@iot-os/ui/lib/utils"

export type UsageKind = "alerts" | "sms" | "data_points" | "devices"

/**
 * One allowance's usage in one UTC month, the shape the billing API sends (specs 028
 * and 029). `organizations` is each organization's share, left out where the viewer may
 * not see other organizations. Data points carry `final` and `reported_at`; devices are
 * a level whose earlier months show their peak.
 */
export type UsageFigure = {
  kind: UsageKind
  month: string
  count: number
  allowance: number | null
  overage: number
  organizations?: { organization_uuid: string; name: string; count: number }[]
  final?: boolean
  reported_at?: string | null
  stale?: boolean
  stale_after_seconds?: number
  peak_this_month?: number
}

const kinds: Record<UsageKind, { label: string; noun: [string, string]; level?: boolean }> = {
  alerts: { label: "Alerts", noun: ["alert", "alerts"] },
  sms: { label: "SMS", noun: ["SMS", "SMS"] },
  devices: { label: "Active devices", noun: ["device", "devices"], level: true },
  data_points: { label: "Data points", noun: ["data point", "data points"] },
}
const order: UsageKind[] = ["alerts", "sms", "devices", "data_points"]

/** `YYYY-MM` of a date's UTC month. */
export function monthKey(at: Date): string {
  return at.toISOString().slice(0, 7)
}

/** This UTC month and the `count - 1` before it, newest first, as select options. */
export function usageMonths(now: Date = new Date(), count = 12): { value: string; label: string }[] {
  return Array.from({ length: count }, (_, index) => {
    const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - index, 1))
    const name = month.toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" })
    return { value: monthKey(month), label: index === 0 ? `This month (${name})` : name }
  })
}

/** How many UTC months from `since`'s to `now`'s, both included; twelve without `since`. */
export function monthsSince(since: string | null | undefined, now: Date = new Date()): number {
  const start = since ? new Date(since) : null
  if (!start || Number.isNaN(start.getTime())) return 12
  return Math.max(1, (now.getUTCFullYear() - start.getUTCFullYear()) * 12 + now.getUTCMonth() - start.getUTCMonth() + 1)
}

/** Picks a UTC month of usage, back to `since` (the account's start), for a PanelActions slot. */
export function UsageMonthSelect({
  value,
  onChange,
  since,
  now,
  className,
}: {
  value: string
  onChange: (month: string) => void
  since?: string | null
  now?: Date
  className?: string
}) {
  // Keyed by the month, so the list turns over when a UTC month ends and not on every render.
  const current = monthKey(now ?? new Date())
  const months = React.useMemo(() => {
    const start = new Date(`${current}-01T00:00:00Z`)
    return usageMonths(start, monthsSince(since, start))
  }, [current, since])
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger size="sm" aria-label="Month" className={cn("w-60", className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper" align="end">
        {months.map((month) => (
          <SelectItem key={month.value} value={month.value}>
            {month.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/** A figure for a month before this one. */
const earlierMonth = (figure: UsageFigure, now?: number) => figure.month.slice(0, 7) !== monthKey(new Date(now ?? Date.now()))

/** Devices in an earlier month are its peak and have no shares: the API keeps no history per organization. */
const earlierDevices = (figure: UsageFigure, now?: number) => figure.kind === "devices" && earlierMonth(figure, now)

/**
 * A meter per allowance, in the order alerts, SMS, devices, data points. Data points
 * read "Provisional" until their month is final; this month's devices note a peak above
 * the count, and an earlier month's devices are its peak. An earlier month shows counts
 * and overage without today's allowance (spec 029 FR-023).
 */
export function UsageMeters({ figures, now, className }: { figures: UsageFigure[]; now?: number; className?: string }) {
  const sorted = order.flatMap((kind) => figures.filter((figure) => figure.kind === kind))
  return (
    <div className={cn("grid min-w-0 gap-6 sm:grid-cols-2 xl:grid-cols-4", className)}>
      {sorted.map((figure) => {
        const text = kinds[figure.kind]
        const peak = figure.peak_this_month
        return (
          <AllowanceMeter
            key={figure.kind}
            label={earlierDevices(figure, now) ? "Peak devices" : text.label}
            count={figure.count}
            allowance={figure.allowance}
            overage={figure.overage}
            kind={text.level ? "level" : "monthly"}
            noun={text.noun}
            freshness={
              figure.kind === "data_points"
                ? {
                    reportedAt: figure.reported_at ?? null,
                    final: figure.final ?? false,
                    stale: figure.stale,
                    staleAfterSeconds: figure.stale_after_seconds,
                  }
                : undefined
            }
            detail={peak !== undefined && peak > figure.count ? `Peak ${formatNumber(peak)}` : undefined}
            earlier={earlierMonth(figure, now)}
            now={now}
          />
        )
      })}
    </div>
  )
}

type ShareRow = { uuid: string; name: string } & Partial<Record<UsageKind, number>>

/**
 * Each organization's share of the month, one column per allowance the figures cover;
 * devices only for this month.
 */
export function UsageShares({ id, figures, now }: { id: string; figures: UsageFigure[]; now?: number }) {
  const present = order.filter((kind) => figures.some((figure) => figure.kind === kind && !earlierDevices(figure, now)))
  const rows = React.useMemo(() => {
    const byOrganization = new Map<string, ShareRow>()
    for (const figure of figures) {
      for (const share of figure.organizations ?? []) {
        const row = byOrganization.get(share.organization_uuid) ?? { uuid: share.organization_uuid, name: share.name }
        row[figure.kind] = share.count
        byOrganization.set(share.organization_uuid, row)
      }
    }
    return [...byOrganization.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [figures])
  const columns = React.useMemo<DataColumn<ShareRow>[]>(
    () => [
      {
        id: "name",
        header: "Organization",
        mobile: "title",
        value: (row) => row.name,
        cell: (row) => <span className="font-medium">{row.name}</span>,
      },
      ...present.map<DataColumn<ShareRow>>((kind) => ({
        id: kind,
        header: kinds[kind].label,
        align: "end",
        hideable: false,
        summary: "sum",
        value: (row) => row[kind] ?? 0,
        cell: (row) => <span className="tabular-nums">{formatNumber(row[kind] ?? 0)}</span>,
      })),
    ],
    // present is derived from figures.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [present.join()],
  )
  return (
    <DataTable
      id={id}
      label="Usage by organization"
      noun={["organization", "organizations"]}
      rowKey={(row) => row.uuid}
      rowLabel={(row) => row.name}
      columns={columns}
      rows={rows}
      empty={<EmptyState inset icon={<Building2Icon />} title="No organizations" description="The account had no organizations this month." />}
    />
  )
}

/**
 * A billing account's Usage panel: a meter per allowance and, with `shares`, each
 * organization's part, for this UTC month (`figures`, already loaded with the page) or
 * an earlier one picked in its header (`load`), back to `since`. With `refreshEvery` it
 * reloads this month itself, for a page that loads it once (spec 028 SC-004); an
 * earlier month still waiting for its usage reloads every minute until it is final,
 * trying again after a failure. Left open past the end of a UTC month, the panel moves
 * to the new one and loads it until the page's figures catch up.
 */
export function UsagePanel({
  id,
  description,
  figures,
  load,
  since,
  shares = true,
  refreshEvery,
  now,
}: {
  id: string
  description?: React.ReactNode
  figures: UsageFigure[]
  load: (month: string) => Promise<UsageFigure[]>
  /** The account's start; the month picker goes back to it (twelve months when left out). */
  since?: string | null
  shares?: boolean
  /** Milliseconds between reloads of this month through `load`; off when the page refetches it. */
  refreshEvery?: number
  now?: number
}) {
  const clock = useNow()
  const thisMonth = monthKey(new Date(now ?? clock))
  // Null follows this month, so the panel moves on when a UTC month ends.
  const [picked, setPicked] = React.useState<string | null>(null)
  const month = picked ?? thisMonth
  const [earlier, setEarlier] = React.useState<{ month: string; figures: UsageFigure[] | "failed" } | null>(null)
  const [attempt, setAttempt] = React.useState(0)
  // This month as last reloaded here; the page's own figures win again when they change.
  const [latest, setLatest] = React.useState<UsageFigure[] | null>(null)
  // The month the page's figures were this month's: after a UTC month ends they are the last one's.
  const [figuresOf, setFiguresOf] = React.useState(thisMonth)
  React.useEffect(() => {
    setLatest(null)
    setFiguresOf(thisMonth)
    // Only when the page's figures change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [figures])
  const fromPage = month === thisMonth && figuresOf === thisMonth

  React.useEffect(() => {
    if (!refreshEvery || !fromPage) return
    let current = true
    const timer = window.setInterval(() => {
      load(thisMonth)
        .then((loaded) => current && setLatest(loaded))
        .catch(() => undefined)
    }, refreshEvery)
    return () => {
      current = false
      window.clearInterval(timer)
    }
    // load is a fresh closure on every render of the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshEvery, fromPage, thisMonth])

  const provisional =
    earlier !== null && earlier.month === month && earlier.figures !== "failed" && earlier.figures.some((figure) => figure.final === false)
  React.useEffect(() => {
    if (!provisional) return
    let current = true
    let timer = 0
    const reload = () => {
      timer = window.setTimeout(() => {
        load(month)
          .then((loaded) => current && setEarlier({ month, figures: loaded }))
          // A failed reload keeps the figures shown and tries again a minute later.
          .catch(() => current && reload())
      }, 60_000)
    }
    reload()
    return () => {
      current = false
      window.clearTimeout(timer)
    }
    // load is a fresh closure on every render of the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provisional, month, earlier])

  React.useEffect(() => {
    if (fromPage) return
    let current = true
    setEarlier(null)
    load(month)
      .then((loaded) => current && setEarlier({ month, figures: loaded }))
      .catch(() => current && setEarlier({ month, figures: "failed" }))
    return () => {
      current = false
    }
    // load is a fresh closure on every render of the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, fromPage, attempt])

  const shown = fromPage ? (latest ?? figures) : earlier?.month === month ? earlier.figures : undefined
  const titleId = `${id}-title`

  return (
    <Panel aria-labelledby={titleId}>
      <PanelHeader>
        <PanelTitle id={titleId}>Usage</PanelTitle>
        {description ? <PanelDescription>{description}</PanelDescription> : null}
        <PanelActions>
          <UsageMonthSelect
            value={month}
            onChange={(value) => setPicked(value === thisMonth ? null : value)}
            since={since}
            now={new Date(now ?? clock)}
          />
        </PanelActions>
      </PanelHeader>
      {shown === "failed" ? (
        <PanelContent className="flex flex-wrap items-center gap-3">
          <p className="text-muted-foreground">That month&apos;s usage could not be loaded.</p>
          <Button size="sm" variant="outline" onClick={() => setAttempt((count) => count + 1)}>
            Try again
          </Button>
        </PanelContent>
      ) : shown === undefined ? (
        <PanelContent aria-busy="true" className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
          {order.map((kind) => (
            <Skeleton key={kind} className="h-24 w-full" />
          ))}
        </PanelContent>
      ) : (
        <>
          <PanelContent>
            <UsageMeters figures={shown} now={now} />
          </PanelContent>
          {shares ? (
            <PanelContent flush className="border-t">
              <UsageShares id={`${id}-organizations`} figures={shown} now={now} />
            </PanelContent>
          ) : null}
        </>
      )}
    </Panel>
  )
}
