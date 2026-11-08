import * as React from "react"

import { Building2Icon } from "lucide-react"

import { AllowanceMeter } from "@iot-os/ui/components/allowance-meter"
import { Button } from "@iot-os/ui/components/button"
import { DataTable, type DataColumn } from "@iot-os/ui/components/data-table"
import { EmptyState } from "@iot-os/ui/components/empty-state"
import { Panel, PanelActions, PanelContent, PanelDescription, PanelHeader, PanelTitle } from "@iot-os/ui/components/panel"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@iot-os/ui/components/select"
import { Skeleton } from "@iot-os/ui/components/skeleton"
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

/** Picks a UTC month of usage, for a PanelActions slot. */
export function UsageMonthSelect({
  value,
  onChange,
  now,
  className,
}: {
  value: string
  onChange: (month: string) => void
  now?: Date
  className?: string
}) {
  const months = React.useMemo(() => usageMonths(now), [now])
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

/** Devices in an earlier month are its peak and have no shares: the API keeps no history per organization. */
const earlierDevices = (figure: UsageFigure, now?: number) =>
  figure.kind === "devices" && figure.month.slice(0, 7) !== monthKey(new Date(now ?? Date.now()))

/**
 * A meter per allowance, in the order alerts, SMS, devices, data points. Data points
 * read "Provisional" until their month is final; this month's devices note a peak above
 * the count, and an earlier month's devices are its peak.
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
                ? { reportedAt: figure.reported_at ?? null, final: figure.final ?? false }
                : undefined
            }
            detail={peak !== undefined && peak > figure.count ? `Peak ${formatNumber(peak)}` : undefined}
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
 * an earlier one picked in its header (`load`).
 */
export function UsagePanel({
  id,
  description,
  figures,
  load,
  shares = true,
  now,
}: {
  id: string
  description?: React.ReactNode
  figures: UsageFigure[]
  load: (month: string) => Promise<UsageFigure[]>
  shares?: boolean
  now?: number
}) {
  const thisMonth = monthKey(new Date(now ?? Date.now()))
  const [month, setMonth] = React.useState(thisMonth)
  const [earlier, setEarlier] = React.useState<{ month: string; figures: UsageFigure[] | "failed" } | null>(null)
  const [attempt, setAttempt] = React.useState(0)

  React.useEffect(() => {
    if (month === thisMonth) return
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
  }, [month, thisMonth, attempt])

  const shown = month === thisMonth ? figures : earlier?.month === month ? earlier.figures : undefined
  const titleId = `${id}-title`

  return (
    <Panel aria-labelledby={titleId}>
      <PanelHeader>
        <PanelTitle id={titleId}>Usage</PanelTitle>
        {description ? <PanelDescription>{description}</PanelDescription> : null}
        <PanelActions>
          <UsageMonthSelect value={month} onChange={setMonth} now={now === undefined ? undefined : new Date(now)} />
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
