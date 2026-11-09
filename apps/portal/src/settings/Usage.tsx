import { useQuery } from "@tanstack/react-query"
import type { OrganizationRetention, OrganizationUsage, UsageKind } from "@iot-os/api-client"
import { allowanceUse, type AllowanceUse } from "@iot-os/ui/components/allowance-meter"
import { EmptyState } from "@iot-os/ui/components/empty-state"
import { Freshness } from "@iot-os/ui/components/freshness"
import { Panel, PanelContent, PanelDescription, PanelHeader, PanelTitle } from "@iot-os/ui/components/panel"
import { Skeleton } from "@iot-os/ui/components/skeleton"
import { Status } from "@iot-os/ui/components/status-mark"
import { formatDateTime, formatNumber } from "@iot-os/ui/lib/format"
import { CollectionPage } from "@iot-os/ui/templates/collection-page"
import { api } from "../lib/api"
import { RequestError } from "../components/forms"
import { useDeviceOrganization } from "../devices/shared"

export const organizationUsageKey = (org: string) => ["organization-usage", org] as const

/**
 * This organization's usage and retention; only for members who may manage devices
 * (spec 029 FR-024). Asked again every minute while shown, as the runtime reports.
 */
export function useOrganizationUsage() {
  const { org, capabilities } = useDeviceOrganization()
  return useQuery({
    queryKey: organizationUsageKey(org),
    queryFn: () => api.organizationUsage(org),
    enabled: capabilities.manage,
    refetchInterval: 60_000,
  })
}

const kinds: Record<UsageKind, { label: string; noun: [string, string] }> = {
  devices: { label: "Active devices", noun: ["device", "devices"] },
  data_points: { label: "Data points this month", noun: ["data point", "data points"] },
  alerts: { label: "Alerts this month", noun: ["alert", "alerts"] },
  sms: { label: "SMS this month", noun: ["SMS", "SMS"] },
}

const retentionSources: Record<OrganizationRetention["source"], string> = {
  organization: "Set for this organization",
  billing_account: "From the billing plan",
  platform: "The platform setting",
  default: "The deployment default",
}

const counted = (value: number, noun: [string, string]) => `${formatNumber(value)} ${value === 1 ? noun[0] : noun[1]}`

/**
 * What the billing account has left, never its own count: "120 alerts left on the
 * account", with the month's overage beside it after the allowance was raised past it,
 * the overage once used up, or no limit. A level over its limit says so.
 */
function accountLine(usage: OrganizationUsage, noun: [string, string]): string {
  if (usage.allowance === null) return "No limit on the account"
  if (usage.over_limit) return "The account is over its device limit"
  const left = usage.left ?? 0
  if (usage.overage > 0 && left > 0) return `${counted(left, noun)} left on the account · ${counted(usage.overage, noun)} of overage`
  if (usage.overage > 0) return `${counted(usage.overage, noun)} of overage on the account`
  return `${counted(left, noun)} left on the account`
}

/** Where the billing account stands, from what it has left: the account's own count stays hidden. */
function accountUse(usage: OrganizationUsage): AllowanceUse {
  if (usage.allowance === null) return "unlimited"
  if (usage.over_limit) return "over_limit"
  if (usage.left === 0) return "used_up"
  return allowanceUse(usage.allowance - (usage.left ?? 0), usage.allowance)
}

/**
 * This organization's count of each allowance and what is left of it on the billing
 * account, in the order given. Where the account is unlimited, only the count shows.
 */
export function OrganizationAllowances({ usage, kinds: shown }: { usage: OrganizationUsage[]; kinds: UsageKind[] }) {
  const rows = shown.flatMap((kind) => usage.filter((item) => item.kind === kind))
  return (
    <dl className="grid min-w-0 gap-x-6 gap-y-4 sm:grid-cols-2">
      {rows.map((item) => {
        const text = kinds[item.kind]
        const use = accountUse(item)
        return (
          <div key={item.kind} data-kind={item.kind} className="flex min-w-0 flex-col gap-1">
            <dt className="flex items-baseline justify-between gap-3 text-meta text-muted-foreground">
              {text.label}
              {use === "unlimited" ? null : <Status value={use} domain="usage" className="text-meta" />}
            </dt>
            <dd className="text-heading tabular-nums">{formatNumber(item.count)}</dd>
            <dd className="text-meta text-muted-foreground">{accountLine(item, text.noun)}</dd>
            {item.kind === "data_points" ? (
              <dd className="inline-flex flex-wrap items-center gap-1 text-meta text-muted-foreground">
                {item.final ? (
                  "Final"
                ) : item.reported_at ? (
                  <>
                    Provisional · last reported{" "}
                    <Freshness at={item.reported_at} expectedSeconds={(item.stale_after_seconds ?? 300) / 2} late={item.stale ?? false} />
                  </>
                ) : (
                  "Provisional · not reported yet"
                )}
              </dd>
            ) : null}
          </div>
        )
      })}
    </dl>
  )
}

/** "400 days · From the billing plan", with a pending reduction and its date. */
function RetentionSummary({ retention }: { retention: OrganizationRetention }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-heading tabular-nums">
        {formatNumber(retention.days)} {retention.days === 1 ? "day" : "days"}
      </p>
      <p className="text-meta text-muted-foreground">{retentionSources[retention.source]}</p>
      {retention.pending_reduction ? (
        <p className="text-meta">
          History older than {counted(retention.pending_reduction.days, ["day", "days"])} is deleted from{" "}
          {formatDateTime(retention.pending_reduction.from)}.
        </p>
      ) : null}
    </div>
  )
}

/**
 * Settings → Usage (spec 029 US5): this organization's active devices, data points,
 * alerts and SMS this month (UTC), what is left of each on its billing account, and its
 * telemetry retention. It never names the account or its other organizations.
 */
export function UsageSettings() {
  const { capabilities, query: organization } = useDeviceOrganization()
  const usage = useOrganizationUsage()
  const denied = !organization.isPending && !capabilities.manage
  return (
    <CollectionPage
      embedded
      title="Usage"
      description="This organization's use this month (UTC) and what is left on its billing account."
    >
      {denied ? (
        <EmptyState title="Usage unavailable" description="You need device management access in this organization." />
      ) : usage.error ? (
        <RequestError error={usage.error} />
      ) : !usage.data ? (
        <div className="flex flex-col gap-3" aria-busy="true">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : (
        <>
          <Panel aria-labelledby="usage-allowances">
            <PanelHeader>
              <PanelTitle id="usage-allowances">Allowances</PanelTitle>
              <PanelDescription>Organizations on the same billing account share what is left.</PanelDescription>
            </PanelHeader>
            <PanelContent>
              <OrganizationAllowances usage={usage.data.usage} kinds={["devices", "data_points", "alerts", "sms"]} />
            </PanelContent>
          </Panel>
          <Panel aria-labelledby="usage-retention">
            <PanelHeader>
              <PanelTitle id="usage-retention">Telemetry retention</PanelTitle>
              <PanelDescription>How long readings are kept before cleanup deletes them.</PanelDescription>
            </PanelHeader>
            <PanelContent>
              <RetentionSummary retention={usage.data.retention} />
            </PanelContent>
          </Panel>
        </>
      )}
    </CollectionPage>
  )
}
